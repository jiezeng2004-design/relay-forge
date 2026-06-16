// Lightweight collaborator sanity check for OpenRelay Local Safe.
//
// Verifies, in a read-only way, that the working tree is in a sane
// state for a new contributor to pick up:
//
//   1. package.json is present and parseable.
//   2. Key src/*.js source files (those imported by src/server.js)
//      are present on disk.
//   3. Existing test scripts (referenced from package.json
//      `scripts.test` and `scripts.smoke`) are present on disk.
//   4. config.example.json is parseable JSON.
//
// Prints a compact JSON report and exits with a non-zero status if
// any check fails. Intentionally does NOT read .env or config.json,
// does not start the server, and does not create any data files.
//
// Run from the project root:
//
//   node scripts/collab-check.mjs
//   npm.cmd run collab:check

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeConfig } from "../src/config.js";

const rootDir = process.env.OPENRELAY_ROOT
  ? resolve(process.env.OPENRELAY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");

const checks = [];
const warnings = [];
let allPassed = true;

function record(name, passed, detail) {
  checks.push({ name, passed, ...(detail ? { detail } : {}) });
  if (!passed) allPassed = false;
}

function warn(name, detail) {
  warnings.push({ name, detail });
}

// 1. package.json present + parseable.
const pkgPath = resolve(rootDir, "package.json");
if (!existsSync(pkgPath)) {
  record("package.json.present", false, "file missing");
} else {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    record("package.json.present", true, `version=${pkg.version || "unknown"}`);
  } catch (error) {
    record("package.json.present", false, `parse error: ${error.message}`);
    pkg = null;
  }

  if (pkg) {
    record(
      "package.json.version",
      typeof pkg.version === "string" && /^\d+\.\d+\.\d+$/.test(pkg.version),
      `version=${pkg.version || "missing"}`
    );

    // 0.5.1: README is split into README.md (root, auto-redirect
    // page), README.en.md, README.zh.md. The version check accepts
    // any of the three.
    const readmePaths = [
      resolve(rootDir, "README.md"),
      resolve(rootDir, "README.en.md"),
      resolve(rootDir, "README.zh.md")
    ];
    const readmeHits = readmePaths
      .filter((p) => existsSync(p))
      .map((p) => ({ path: p, text: readFileSync(p, "utf8") }));
    if (readmeHits.length === 0) {
      record("README.version", false, "README.md / README.en.md / README.zh.md all missing");
    } else {
      const merged = readmeHits.map((r) => r.text).join("\n");
      record(
        "README.version",
        merged.includes(pkg.version),
        `README ${merged.includes(pkg.version) ? "mentions" : "does not mention"} ${pkg.version} (${readmeHits.length} file(s))`
      );
    }

    // 2. Key source files. Pulled from src/server.js imports so the
    //    list stays in sync with what the runtime actually loads.
    const serverJs = resolve(rootDir, "src", "server.js");
    let sourceFiles = [];
    if (existsSync(serverJs)) {
      const text = readFileSync(serverJs, "utf8");
      // Match `from "./foo.js"` and `from './foo.js'`.
      const re = /from\s+["']\.\/([^"']+)["']/g;
      const seen = new Set();
      let m;
      while ((m = re.exec(text)) !== null) {
        const rel = m[1];
        if (rel.startsWith("node:")) continue;
        if (seen.has(rel)) continue;
        seen.add(rel);
        sourceFiles.push(rel);
      }
    }
    if (sourceFiles.length === 0) {
      // Fallback to a known baseline if the scan yielded nothing.
      sourceFiles = [
        "src/config.js",
        "src/key-pool.js",
        "src/usage.js",
        "src/dashboard.js",
        "src/secret-store.js",
        "src/format-convert.js",
        "src/balance.js",
        "src/http-helpers.js",
        "src/server.js"
      ];
    }
    // server.js's relative imports are relative to src/, so prepend
    // the directory if the scanned entry doesn't already include it.
    const normalizedSources = sourceFiles.map((rel) =>
      rel.startsWith("src/") ? rel : `src/${rel}`
    );
    const missingSources = normalizedSources.filter(
      (rel) => !existsSync(resolve(rootDir, rel))
    );
    record(
      "srcFiles.present",
      missingSources.length === 0,
      missingSources.length === 0
        ? `${normalizedSources.length} files`
        : `missing: ${missingSources.join(", ")}`
    );

    // 3. Test scripts. Pulled from package.json `test` and `smoke`
    //    entries by extracting `scripts/<name>.mjs` references.
    const testScriptRefs = collectTestScripts(pkg);
    const missingTests = testScriptRefs.filter(
      (rel) => !existsSync(resolve(rootDir, rel))
    );
    record(
      "testScripts.present",
      missingTests.length === 0,
      missingTests.length === 0
        ? `${testScriptRefs.length} scripts`
        : `missing: ${missingTests.join(", ")}`
    );

    // 4. config.example.json parseable and normalizable.
    const examplePath = resolve(rootDir, "config.example.json");
    if (!existsSync(examplePath)) {
      record("config.example.json.parseable", false, "file missing");
    } else {
      try {
        const parsed = JSON.parse(readFileSync(examplePath, "utf8"));
        const normalized = normalizeConfig(JSON.parse(JSON.stringify(parsed)));
        const providerCount = Array.isArray(parsed.providers)
          ? parsed.providers.length
          : 0;
        record(
          "config.example.json.normalizable",
          true,
          `providers=${providerCount}, normalizedProviders=${normalized.providers.length}`
        );
      } catch (error) {
        record(
          "config.example.json.normalizable",
          false,
          `parse/normalize error: ${error.message}`
        );
      }
    }

    const forbidden = findForbiddenRuntimePaths(pkg);
    record(
      "forbiddenPaths.checked",
      true,
      forbidden.length === 0
        ? "no forbidden runtime paths present"
        : `present in source tree: ${forbidden.join(", ")}`
    );
    if (forbidden.length > 0) {
      warn("forbiddenPaths.present", `source tree has runtime artifacts; run npm run clean only after backing up any real keys: ${forbidden.join(", ")}`);
    }

    const checkResult = awaitCheckReadonly(pkg);
    record("server.check.readonly", checkResult.passed, checkResult.detail);
  }
}

const report = {
  tool: "collab-check",
  root: rootDir,
  passed: allPassed,
  failed: checks.filter((c) => !c.passed).length,
  warnings,
  checks
};

process.stdout.write(JSON.stringify(report) + "\n");
process.exit(allPassed ? 0 : 1);

// --- helpers ---

// Walk the `test` and `smoke` npm script entries and return a
// de-duplicated list of `scripts/<name>.mjs` paths referenced from
// them. Supports `node scripts/foo.mjs` and chains joined with `&&`.
function collectTestScripts(pkg) {
  const refs = new Set();
  const scripts = pkg.scripts || {};
  for (const key of ["test", "smoke"]) {
    const value = scripts[key];
    if (typeof value !== "string") continue;
    for (const part of value.split("&&")) {
      const match = part.match(/(?:^|\s)(scripts\/[\w-]+\.mjs)\b/);
      if (match) refs.add(match[1]);
    }
  }
  // Always include the pre-release check so contributors see the
  // full inventory of helper scripts.
  if (existsSync(resolve(rootDir, "scripts", "pre-release-check.mjs"))) {
    refs.add("scripts/pre-release-check.mjs");
  }
  return Array.from(refs).sort();
}

function findForbiddenRuntimePaths(pkg) {
  const pre = pkg.preRelease || {};
  const names = [
    ...(Array.isArray(pre.forbiddenFiles) ? pre.forbiddenFiles : [".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh"]),
    ...(Array.isArray(pre.forbiddenDirs) ? pre.forbiddenDirs : ["data", "backups", "node_modules", ".agent-collab"])
  ];
  return names.filter((name) => existsSync(resolve(rootDir, name)));
}

function awaitCheckReadonly(pkg) {
  const tmpRoot = mkdtempSync(resolve(tmpdir(), "openrelay-collab-check-"));
  try {
    const configPath = resolve(tmpRoot, "config.json");
    writeFileSync(configPath, JSON.stringify({
      defaultProvider: "local",
      providers: [{ name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] }],
      routes: [],
      profiles: [{ name: "default", defaultModel: "local-model" }],
      activeProfile: "default"
    }, null, 2));
    const dataDir = resolve(tmpRoot, "data");
    const statePath = resolve(tmpRoot, "runtime-state.json");
    const result = spawnSyncNode(["src/server.js", "--check"], {
      cwd: rootDir,
      env: {
        ...process.env,
        OPENRELAY_CONFIG: configPath,
        OPENRELAY_STATE: statePath,
        OPENRELAY_KEYSTORE_DIR: dataDir
      }
    });
    if (result.code !== 0) {
      return { passed: false, detail: `exit=${result.code}; stderr=${result.stderr.slice(0, 500)}` };
    }
    const created = [dataDir, resolve(dataDir, "master.key"), resolve(dataDir, "keys.enc.json"), statePath]
      .filter((item) => existsSync(item));
    return {
      passed: created.length === 0,
      detail: created.length === 0 ? "--check created no runtime files" : `created: ${created.join(", ")}`
    };
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function spawnSyncNode(args, options) {
  const result = spawnSync(process.execPath, args, {
    ...options,
    encoding: "utf8",
    timeout: 8000,
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    code: result.status === null ? 124 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || (result.error ? result.error.message : "")
  };
}
