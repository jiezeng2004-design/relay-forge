// 0.5.3: the server entry point used to call
//   detectRuntimeRootDir(resolve(dirname(fileURLToPath(import.meta.url)), ".."))
// which short-circuited the OPENRELAY_ROOT / exe / cwd branches
// and made the packaged `bun build --compile` binary unable to
// find .env / config.json / data/ next to the executable.
//
// The fix: pass through an explicitRootDir only when the
// operator passes `--root=<dir>` on the command line. Otherwise
// the function walks the full fallback chain.
//
// This script tests the four documented branches plus the new
// CLI option. The existing test-config-root.mjs already covers
// the function in isolation; this file is the
// "does-the-entry-point-respect-the-fallback" version.

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRuntimeRootDir } from "../src/config.js";

const tests = [];
let passed = 0;
let failed = 0;

function test(name, fn) { tests.push({ name, fn }); }
function assert(cond, msg) { if (!cond) throw new Error("assertion failed: " + msg); }
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

test("explicitRootDir argument wins (legacy behavior preserved)", () => {
  const explicit = "/tmp/operator-overrode-this";
  assertEqual(detectRuntimeRootDir(explicit), explicit, "explicit arg wins");
});

test("OPENRELAY_ROOT env var wins when no explicit arg (the previously-broken branch)", () => {
  const previous = process.env.OPENRELAY_ROOT;
  try {
    process.env.OPENRELAY_ROOT = "/tmp/runtime-root-env";
    assertEqual(detectRuntimeRootDir(), "/tmp/runtime-root-env", "env path");
  } finally {
    if (previous === undefined) delete process.env.OPENRELAY_ROOT;
    else process.env.OPENRELAY_ROOT = previous;
  }
});

test("script form (no explicit / no env) falls back to project root via import.meta.url", () => {
  const detected = detectRuntimeRootDir();
  const expected = resolve(rootDir).replace(/\\/g, "/");
  const actual = resolve(detected).replace(/\\/g, "/");
  assertEqual(actual, expected, "project root via import.meta.url");
});

test("process.execPath containing openrelay prefix is treated as the exe root (the second previously-broken branch)", () => {
  // Probe via a child process so we can safely mutate process.execPath.
  const probeFile = resolve(rootDir, "scripts/.probe-execpath-runtime.mjs");
  const fakeExe = `${rootDir.replace(/\\/g, "/")}/dist/openrelay-windows-x64.exe`;
  writeFileSync(probeFile, `
const fakeExe = "${fakeExe}";
Object.defineProperty(process, "execPath", { value: fakeExe, configurable: true });
process.env.OPENRELAY_ROOT = "";
const m = await import("../src/config.js");
const result = m.detectRuntimeRootDir();
console.log(JSON.stringify({ result }));
`);
  try {
    const out = execSync(`node "${probeFile}"`, { cwd: rootDir, encoding: "utf8" });
    const parsed = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
    const expected = `${rootDir.replace(/\\/g, "/")}/dist`;
    assertEqual(parsed.result, expected, "exe dir used as root when no env / no explicit");
  } finally {
    try { unlinkSync(probeFile); } catch { /* best effort */ }
  }
});

test("CLI: --root=<dir> forces detectRuntimeRootDir to the operator path", () => {
  // The server entry point is the only consumer of --root, so
  // we exercise it via a child process that mimics the call
  // site (`detectRuntimeRootDir(cliOptions.rootDir)`). The CLI
  // parser itself is a tiny loop in server.js; this test
  // guards the contract.
  const probeFile = resolve(rootDir, "scripts/.probe-cli-root.mjs");
  writeFileSync(probeFile, `
import { detectRuntimeRootDir } from "../src/config.js";
const cliRoot = "/tmp/from-cli-flag";
const result = detectRuntimeRootDir(cliRoot);
console.log(JSON.stringify({ result }));
`);
  try {
    const out = execSync(`node "${probeFile}"`, { cwd: rootDir, encoding: "utf8" });
    const parsed = JSON.parse(out.trim().split("\n").filter(Boolean).pop());
    assertEqual(parsed.result, "/tmp/from-cli-flag", "cli --root wins");
  } finally {
    try { unlinkSync(probeFile); } catch { /* best effort */ }
  }
});

test("empty string explicitRootDir falls through (no crash, no short-circuit)", () => {
  // The server entry passes `cliOptions.rootDir` which is
  // `null` when no --root is set. We also defensively handle
  // the "" case so a malformed flag never blocks startup.
  const result = detectRuntimeRootDir("");
  assert(typeof result === "string" && result.length > 0, "result is a non-empty string");
});

test("entry-point change: the server no longer hard-codes the import.meta.url path", async () => {
  // Static guard: grep the source for the old call site. If a
  // future refactor accidentally re-introduces the hard-coded
  // explicitRootDir, this test fails immediately.
  const { readFileSync } = await import("node:fs");
  const serverSrc = readFileSync(resolve(rootDir, "src/server.js"), "utf8");
  const match = serverSrc.match(/detectRuntimeRootDir\(\s*resolve\(\s*dirname\(\s*fileURLToPath\(\s*import\.meta\.url/);
  assert(!match, "server.js must not pass a hard-coded import.meta.url path into detectRuntimeRootDir; got: " + (match ? match[0] : ""));
});

for (const t of tests) {
  try { await t.fn(); console.log(`  ok  ${t.name}`); passed += 1; }
  catch (error) { console.log(`  FAIL  ${t.name}: ${error.message}`); failed += 1; }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
