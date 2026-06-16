// Build single-file executables for each platform via
// `bun build --compile`. The project is zero-deps so a
// fully-bundled binary is small (~30 MB) and starts without a
// Node.js install on the target machine.
//
// Run:  node scripts/build-exe.mjs
// Output: dist/openrelay-<os>-<arch><.exe>
//
// Requires `bun` >= 1.1 on the PATH. The script fails fast with
// a clear error if bun is missing — Node's --experimental-sea-config
// could be a future alternative, but bun's --compile produces
// smaller, faster binaries and a single dependency.
//
// The produced binary reads .env / config.json from the directory
// of process.execPath (not the cwd), so a user can double-click
// the exe from any location and it finds its sibling files.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { platform, arch } from "node:process";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = resolve(rootDir, "dist");

function checkBun() {
  try {
    const out = execFileSync("bun", ["--version"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const match = String(out).trim().match(/^(\d+)\.(\d+)/);
    if (!match) throw new Error("bun version parse failed: " + out);
    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major < 1 || (major === 1 && minor < 1)) {
      throw new Error(`bun >= 1.1 required, found ${out.trim()}. Run: npm install -g bun`);
    }
    return out.trim();
  } catch (error) {
    if (error && error.code === "ENOENT") {
      throw new Error("bun not found on PATH. Install: npm install -g bun  (https://bun.sh)");
    }
    throw error;
  }
}

const TARGETS = [
  // Windows x64 (the project's primary platform)
  { platform: "win32", arch: "x64", bun: "bun-windows-x64", ext: ".exe" },
  // macOS x64 + arm64 (Apple Silicon)
  { platform: "darwin", arch: "x64", bun: "bun-darwin-x64", ext: "" },
  { platform: "darwin", arch: "arm64", bun: "bun-darwin-arm64", ext: "" },
  // Linux x64
  { platform: "linux", arch: "x64", bun: "bun-linux-x64", ext: "" }
];

function targetName(target) {
  return `openrelay-${target.platform}-${target.arch}${target.ext}`;
}

function build(target) {
  const outFile = resolve(distDir, targetName(target));
  mkdirSync(distDir, { recursive: true });
  const args = [
    "build",
    "--compile",
    `--target=${target.bun}`,
    `--outfile=${outFile}`,
    resolve(rootDir, "src/server.js")
  ];
  console.log(`[build-exe] bun ${args.join(" ")}`);
  execFileSync("bun", args, { stdio: "inherit", cwd: rootDir });
  if (!existsSync(outFile)) {
    throw new Error(`build did not produce ${outFile}`);
  }
  const size = statSync(outFile).size;
  if (size < 100_000) {
    throw new Error(`produced binary is suspiciously small (${size} bytes)`);
  }
  if (size > 200_000_000) {
    throw new Error(`produced binary is suspiciously large (${size} bytes; > 200MB)`);
  }
  return { outFile, size };
}

function skip(target) {
  // Don't waste time building for a different host platform unless
  // explicitly requested. Pass --all to build everything.
  const all = process.argv.includes("--all");
  if (all) return false;
  return target.platform !== platform || target.arch !== arch;
}

function main() {
  const bunVersion = checkBun();
  console.log(`[build-exe] bun ${bunVersion} detected`);
  const built = [];
  for (const target of TARGETS) {
    if (skip(target)) {
      console.log(`[build-exe] skip ${targetName(target)} (host is ${platform}/${arch}; pass --all to build anyway)`);
      continue;
    }
    const result = build(target);
    built.push(result);
  }
  if (built.length === 0) {
    console.log("[build-exe] no targets built");
    process.exit(0);
  }
  console.log("[build-exe] built:");
  for (const { outFile, size } of built) {
    console.log(`  - ${outFile}  (${(size / 1024 / 1024).toFixed(1)} MB)`);
  }
}

main();
