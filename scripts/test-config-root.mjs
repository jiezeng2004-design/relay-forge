// Pure unit tests for src/config.js detectRuntimeRootDir + the
// runtime root resolution path. No server, no I/O.

import { execSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { detectRuntimeRootDir } from "../src/config.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const rootDir = resolve(fileURLToPath(import.meta.url), "../..");

test("explicit rootDir argument wins over everything", () => {
  const explicit = "/tmp/somewhere";
  assertEqual(detectRuntimeRootDir(explicit), explicit, "explicit path");
});

test("OPENRELAY_ROOT env var wins when no explicit arg", () => {
  const previous = process.env.OPENRELAY_ROOT;
  try {
    process.env.OPENRELAY_ROOT = "/tmp/from-env";
    assertEqual(detectRuntimeRootDir(), "/tmp/from-env", "env path");
  } finally {
    if (previous === undefined) delete process.env.OPENRELAY_ROOT;
    else process.env.OPENRELAY_ROOT = previous;
  }
});

test("script form (no explicit / no env) falls back to the project root via import.meta.url", () => {
  // When tests run via `node scripts/test-config-root.mjs`,
  // import.meta.url points at this test file. detectRuntimeRootDir
  // should resolve up two levels to the project root (which
  // contains package.json).
  const detected = detectRuntimeRootDir();
  // Normalize for Windows separators when comparing.
  const expected = resolve(rootDir).replace(/\\/g, "/");
  const actual = resolve(detected).replace(/\\/g, "/");
  assertEqual(actual, expected, "project root matches package.json parent");
});

test("process.execPath containing openrelay prefix is treated as the exe root", () => {
  // We can't actually rewire process.execPath in this test, so we
  // exercise the detection via a small child Node process that
  // fakes execPath. This keeps the assertion honest without
  // mutating globals.
  const probeFile = resolve(rootDir, "scripts/.probe-execpath.mjs");
  writeFileSync(probeFile, `
const fakeExe = "${rootDir.replace(/\\/g, "/")}/dist/openrelay-windows-x64.exe";
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
    assertEqual(parsed.result, expected, "execPath-derived root");
  } finally {
    try { unlinkSync(probeFile); } catch { /* best effort */ }
  }
});

test("bad input still returns a string (no crash)", () => {
  // Pass an empty string; falls through all branches and returns
  // process.cwd() at worst.
  const result = detectRuntimeRootDir("");
  assert(typeof result === "string" && result.length > 0, "result is a non-empty string");
});

// ---- runner ----

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ok  ${t.name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${t.name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
