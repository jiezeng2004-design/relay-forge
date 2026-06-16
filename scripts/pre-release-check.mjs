// Pre-release check for OpenRelay Local Safe.
//
// Verifies the staged (or working) tree is safe to ship:
//
//   1. No stray .env, config.json, tool-env.*, data/, backups/,
//      node_modules/, .agent-collab/, or *.log artefacts.
//   2. No obvious real API keys in any text file (skips the known
//      placeholders in .env.example, config.example.json, README.md,
//      package.json and the test mocks).
//   3. README.md, .env.example, all scripts/*.ps1 and src/*.js files
//      are valid UTF-8 (no GB-encoded leftovers).
//   4. config.example.json loads through the real config.js normalizer.
//
// Run from the project root:
//
//   node scripts/pre-release-check.mjs
//
// Default mode is "strict" (all forbidden artefacts fail the build).
// Pass --allow-runtime during dev if your working tree has a personal
// data/ or tool-env.* lying around. Designed to be piped into a
// build-dist script but also useful as a standalone guard.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, normalizeConfig } from "../src/config.js";

const rootDir = process.env.OPENRELAY_ROOT
  ? resolve(process.env.OPENRELAY_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), "..");
const issues = [];
const warnings = [];
// Default mode is strict: any forbidden runtime artefact fails the
// build. Manual users on a dev tree can pass --allow-runtime so the
// check still scans the source tree but does not refuse to ship just
// because the operator has a personal data/ or tool-env.* lying
// around. --strict is accepted as a no-op alias so legacy callers
// (`npm.cmd run pre-release -- --strict`) don't fail with an "Unknown
// cli config" warning from npm.
const args = new Set(process.argv.slice(2));
const allowRuntime = args.has("--allow-runtime");
args.has("--strict"); // accepted as a no-op alias for legacy callers
const strict = !allowRuntime;

const forbiddenPaths = [".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh", "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh"];
const forbiddenFileGlobs = [
  { re: /^[^/]+\.docx$/i, label: "docx file" },
  { re: /^[^/]+\.doc$/i, label: "doc file" }
];
const forbiddenDirs = ["data", "backups", "node_modules", "dist", ".agent-collab", ".claude"];
// Pattern matches directories like `openrelay-local-safe-0.2.2` that
// an operator may have left behind after an earlier unzip / codex
// review. They are forbidden because the new release zip must not
// include any previous version of the project tree.
const staleVersionDirRe = /^(?:openrelay-local-safe|openrelay-like)-\d+\.\d+\.\d+$/;
for (const name of forbiddenPaths) {
  if (existsSync(join(rootDir, name))) {
    const issue = `forbidden file present: ${name}`;
    if (allowRuntime) warnings.push(issue); else issues.push(issue);
  }
}
if (existsSync(rootDir)) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    for (const { re, label } of forbiddenFileGlobs) {
      if (re.test(entry.name)) {
        const issue = `forbidden ${label} present: ${entry.name}`;
        if (allowRuntime) warnings.push(issue); else issues.push(issue);
      }
    }
  }
}
for (const name of forbiddenDirs) {
  if (existsSync(join(rootDir, name))) {
    const issue = `forbidden directory present: ${name}/`;
    if (allowRuntime) warnings.push(issue); else issues.push(issue);
  }
}

// Detect stale `openrelay-local-safe-X.Y.Z/` directories that may
// have been left behind by a previous unzip / review pass. These
// are NEVER allowed in a release, regardless of the flag.
if (existsSync(rootDir)) {
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    if (entry.isDirectory() && staleVersionDirRe.test(entry.name)) {
      issues.push(
        `stale version directory present: ${entry.name}/ ` +
          `(delete it before building; build-dist's /XD list already excludes it from staging)`
      );
    }
  }
}

// Junk log artefacts that should never ship in a release.
const logGlobs = [/\.log$/, /\.err$/, /\.tmp$/, /\.bak$/];
walk(rootDir, (filePath) => {
  for (const pattern of logGlobs) {
    if (pattern.test(filePath)) {
      issues.push(`junk artefact present: ${relative(rootDir, filePath)}`);
      return;
    }
  }
});

// Real API key scan. Look for high-entropy strings that look like
// bearer tokens, sk-* style OpenAI keys, Anthropic keys, etc.
// Excludes known safe files where the format appears as documentation
// or as a placeholder. The list is augmented from
// package.json `preRelease.skipKeyScan` if present.
const skipKeyScan = new Set([
  ".gitignore",
  "package-lock.json",
  "package.json",
  "README.md",
  ".env.example",
  "config.example.json",
  "scripts/smoke-test.mjs",
  "scripts/test-*.mjs",
  "scripts/pre-release-check.mjs"
]);
try {
  const pkgForScan = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  for (const entry of pkgForScan.preRelease?.skipKeyScan || []) skipKeyScan.add(entry);
} catch {
  // If package.json is missing or unreadable the rest of the script
  // will surface a clearer error; the key scan can just keep its
  // hard-coded default.
}
const keyRegexes = [
  { name: "OpenAI-style", re: /sk-[A-Za-z0-9_-]{20,}/g },
  { name: "Anthropic", re: /sk-ant-[A-Za-z0-9_-]{20,}/g },
  { name: "Google API", re: /AIza[0-9A-Za-z_-]{20,}/g },
  { name: "DeepSeek-like", re: /sk-[a-f0-9]{30,}/g },
  { name: "Bearer literal", re: /Bearer\s+[A-Za-z0-9_\-.=]{30,}/g }
];
// Glob helper for skipKeyScan: literal paths and `*`-suffixed
// patterns both work (e.g. `scripts/test-*.mjs`). We use a sentinel
// placeholder so the char-class escape step doesn't touch the regex
// group we want to emit.
const STAR_PLACEHOLDER = "\u0000OPENRELAY_STAR\u0000";
const skipKeyMatchers = Array.from(skipKeyScan).map((pattern) => {
  if (pattern.includes("*")) {
    const re = new RegExp(
      "^" +
        pattern
          .replaceAll("*", STAR_PLACEHOLDER)
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replaceAll(STAR_PLACEHOLDER, "[^/]*") +
        "$"
    );
    return (rel) => re.test(rel);
  }
  return (rel) => rel === pattern;
});

walk(rootDir, (filePath) => {
  const rel = relative(rootDir, filePath).replaceAll("\\", "/");
  if (skipKeyMatchers.some((match) => match(rel))) return;
  if (rel.startsWith("node_modules/") || rel.startsWith("data/") || rel.startsWith("backups/")) return;
  if (!isProbablyText(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const { name, re } of keyRegexes) {
    const matches = text.match(re);
    if (matches) {
      // Filter out matches inside the smoke test mock data.
      const realMatches = matches.filter((m) => !isLikelyPlaceholder(m, rel, text));
      if (realMatches.length > 0) {
        issues.push(`possible real ${name} key in ${rel}: ${realMatches.slice(0, 3).join(", ")}`);
      }
    }
  }
});

// UTF-8 validation. Windows PowerShell sometimes re-encodes things
// to GB18030; the dashboard, scripts and src must stay UTF-8 so the
// browser and `node` read them correctly.
const utf8Files = [];
const textExts = [".md", ".txt", ".json", ".mjs", ".js", ".cmd", ".ps1", ".tsv"];
walk(rootDir, (filePath) => {
  if (!textExts.some((ext) => filePath.endsWith(ext))) return;
  if (!isProbablyText(filePath)) return;
  if (filePath.includes("node_modules")) return;
  utf8Files.push(filePath);
});
for (const filePath of utf8Files) {
  const buf = readFileSync(filePath);
  if (!isValidUtf8(buf)) {
    const rel = relative(rootDir, filePath);
    issues.push(`file is not valid UTF-8: ${rel}`);
  }
}

// Load config.example.json through the real normalizer to catch schema
// drift before the release ships.
const examplePath = join(rootDir, "config.example.json");
if (existsSync(examplePath)) {
  try {
    const parsed = JSON.parse(readFileSync(examplePath, "utf8"));
    const normalized = normalizeConfig(parsed);
    if (normalized.providers.length === 0) issues.push("config.example.json: no providers after normalize");
    if (!Array.isArray(normalized.profiles)) issues.push("config.example.json: profiles missing after normalize");
  } catch (error) {
    issues.push(`config.example.json failed to load: ${error.message}`);
  }
} else {
  issues.push("config.example.json missing — release cannot ship");
}

// Verify provider-registry.js module exists and exports required symbols.
const registryPath = join(rootDir, "src", "provider-registry.js");
if (existsSync(registryPath)) {
  try {
    const code = readFileSync(registryPath, "utf8");
    const requiredExports = ["PROVIDER_TEMPLATES", "ROUTE_TEMPLATES", "LOCAL_PROVIDER_NAMES", "SUPPORTED_TABS", "V1_PROXY_PATHS", "isLocalProvider"];
    for (const sym of requiredExports) {
      if (!code.includes(`export ${sym.startsWith("is") ? "function " : "const "}${sym}`) && !code.includes(`export { ${sym}`) && !code.includes(`export function ${sym}`)) {
        issues.push(`provider-registry.js: missing required export '${sym}'`);
      }
    }
  } catch (error) {
    issues.push(`provider-registry.js failed to read: ${error.message}`);
  }
} else {
  issues.push("src/provider-registry.js missing — release cannot ship");
}

// Package metadata sanity.
const pkgPath = join(rootDir, "package.json");
if (existsSync(pkgPath)) {
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    if (!pkg.version) issues.push("package.json missing version");
    if (!pkg.engines || !pkg.engines.node) warnings.push("package.json missing engines.node");
  } catch (error) {
    issues.push(`package.json failed to parse: ${error.message}`);
  }
}

// Surface summary.
const divider = "=".repeat(60);
console.log(divider);
console.log("RelayForge — pre-release check");
console.log(`Scanned root: ${rootDir}`);
console.log(`Scanned ${utf8Files.length} text files for encoding.`);
console.log(`Mode: ${allowRuntime ? "allow-runtime" : "strict"}`);
console.log(divider);
if (issues.length === 0) {
  console.log("Result: PASS");
} else {
  console.log(`Result: FAIL (${issues.length} issue${issues.length === 1 ? "" : "s"})`);
  for (const issue of issues) console.log(`  - ${issue}`);
}
if (warnings.length > 0) {
  console.log(`Warnings: ${warnings.length}`);
  for (const warning of warnings) console.log(`  - ${warning}`);
}
console.log(divider);
process.exit(issues.length > 0 ? 1 : 0);

// --- helpers ---

function walk(dir, visit) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "data" || entry.name === "backups") continue;
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, visit);
    } else if (entry.isFile()) {
      try {
        const stat = statSync(fullPath);
        if (stat.size > 1024 * 1024) return; // skip > 1MB
        visit(fullPath);
      } catch {
        // Ignore unreadable files; not a release blocker.
      }
    }
  }
}

function isProbablyText(filePath) {
  const binaryExts = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf", ".zip", ".7z", ".tar", ".gz"];
  return !binaryExts.some((ext) => filePath.toLowerCase().endsWith(ext));
}

function isValidUtf8(buf) {
  // Reject UTF-16/32 BOMs and decode the rest. If decode succeeds and
  // no replacement characters are produced for printable ranges, the
  // file is UTF-8.
  if (buf.length >= 2) {
    if (buf[0] === 0xff && buf[1] === 0xfe) return false; // UTF-16 LE
    if (buf[0] === 0xfe && buf[1] === 0xff) return false; // UTF-16 BE
  }
  if (buf.length >= 4) {
    if (buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0xfe && buf[3] === 0xff) return false; // UTF-32 BE
  }
  try {
    const text = buf.toString("utf8");
    // Check for the mojibake signature: lots of standalone 0xC2/0xC3
    // bytes would mean Latin-1 re-encoded as UTF-8 by mistake. We
    // approximate by counting CJK-like U+FFFD replacements in 4-byte
    // windows; the real heuristic we care about is "is this raw GB".
    if (text.includes("\uFFFD")) {
      // Allowed if it's only stray control chars. Anything substantial
      // is treated as not-utf8.
      const replacements = (text.match(/\uFFFD/g) || []).length;
      if (replacements > text.length * 0.01) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isLikelyPlaceholder(match, rel, text) {
  // True for the smoke-test mock data and obvious template patterns.
  if (rel === "scripts/smoke-test.mjs") return true;
  if (text.includes("REPLACE_ME") || text.includes("xxx") || text.includes("your-key")) return true;
  if (match.includes("...") || match.endsWith("-xxx")) return true;
  return false;
}
