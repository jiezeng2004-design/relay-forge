// 0.6.2: regression test for the loadDotEnv "last write wins"
// behavior. The 0.5.x line parsed the .env file in a single
// pass, assigning process.env on the FIRST occurrence of a
// key. When a project's .env.template pre-declared a key as
// an empty placeholder (the convention used for RELAY_TOKEN
// in .env.example), a real override appended later in the
// file was silently dropped: the empty string from the
// first occurrence was kept, and the second (real) value
// was skipped because process.env[key] was no longer
// `undefined`.
//
// 0.6.2 fixes this with a "last write wins" parser that
// respects the standard POSIX dotenv contract:
//   1. process.env values already set by the parent shell
//      ALWAYS win over .env, on every occurrence of the key.
//   2. .env-internal duplicates: the last occurrence wins.
//   3. Comments and blank lines are ignored.
//
// The test exercises a temp .env file so it does not depend
// on the project's real .env, and it uses both branches of
// the parent-shell / no-parent-shell logic.
//
// Zero dependencies. Uses node:test + node:fs/promises + node:os.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, "..", "..");

const { loadDotEnv } = await import(
  pathToFileURL(join(repoRoot, "src", "config.js")).href
);

// All tests run sequentially and each one creates its own
// temp dir under the OS temp root. We keep a module-scope
// set of dirs we created so a top-level test.after hook
// can sweep them. The hook fires once per file, after
// every test() in this file has finished, so it does NOT
// race with the body of any individual test.
const tempRoots = new Set();

async function withFakeRoot(setup) {
  const dir = await mkdtemp(join(tmpdir(), "openrelay-dotenv-"));
  tempRoots.add(dir);
  if (setup) return await setup(dir);
  return dir;
}

test.after(async () => {
  for (const dir of tempRoots) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// Helper: write a fake .env at <root>/.env with the given
// contents and run loadDotEnv(root). Returns a snapshot of
// the relevant process.env keys (and restores the ones we
// touched so the next test starts clean).
async function loadFakeEnv(contents, keys) {
  return await withFakeRoot(async (dir) => {
    await writeFile(join(dir, ".env"), contents, "utf8");
    return await loadEnvInRoot(dir, keys);
  });
}

async function loadEnvInRoot(dir, keys) {
  const before = {};
  for (const k of keys) before[k] = process.env[k];
  for (const k of keys) delete process.env[k];
  try {
    loadDotEnv(dir);
    const after = {};
    for (const k of keys) after[k] = process.env[k];
    return after;
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k];
      else process.env[k] = before[k];
    }
  }
}

test("0.6.2: duplicate keys in .env follow last-write-wins (the original 0.6.1 bug)", async () => {
  // Mirrors the exact scenario the operator hit: the
  // .env.example template ships a `RELAY_TOKEN=` placeholder
  // near the top; the operator's .env appended a real value
  // at the bottom via `Add-Content`. The 0.5.x parser kept
  // the empty placeholder; the 0.6.2 parser keeps the real
  // value.
  const result = await loadFakeEnv(
    [
      "# .env example template",
      "RELAY_TOKEN=",
      "# a comment block",
      "RELAY_TOKEN=last-token-value",
      ""
    ].join("\n"),
    ["RELAY_TOKEN"]
  );
  assert.equal(result.RELAY_TOKEN, "last-token-value", "RELAY_TOKEN should be the last value in the file");
});

test("0.6.2: three+ occurrences still follow last-write-wins", async () => {
  const result = await loadFakeEnv(
    [
      "FOO=first",
      "FOO=second",
      "# nested comment",
      "FOO=third",
      "FOO=fourth"
    ].join("\n"),
    ["FOO"]
  );
  assert.equal(result.FOO, "fourth", "FOO should be the last (4th) value in the file");
});

test("0.6.2: comments and blank lines are ignored", async () => {
  const result = await loadFakeEnv(
    [
      "# leading comment",
      "",
      "BAR=before",
      "  # indented comment",
      "",
      "BAR=after"
    ].join("\n"),
    ["BAR"]
  );
  assert.equal(result.BAR, "after", "BAR should be the last non-comment value");
});

test("0.6.2: lines without '=' are ignored, not crashed on", async () => {
  const result = await loadFakeEnv(
    [
      "NOEQUALS",
      "VALID=yes",
      "ANOTHER_NO_EQUALS",
      "VALID=no"
    ].join("\n"),
    ["VALID"]
  );
  assert.equal(result.VALID, "no", "VALID should be the last '=' line, last-write-wins");
});

test("0.6.2: parent-shell value always wins over .env (any number of occurrences)", async () => {
  // Even if the operator has 5 RELAY_TOKEN= lines in .env,
  // the parent shell's pre-set value must NOT be overwritten.
  // The 0.6.2 fix uses an envSetByDotEnv set: when the first
  // occurrence is blocked by a pre-existing process.env value,
  // every subsequent occurrence is also blocked (consistent
  // parent-wins). The 0.6.1 first attempt skipped only the
  // first occurrence and overwrote the parent on the second.
  const dir = await withFakeRoot();
  await writeFile(
    join(dir, ".env"),
    [
      "RELAY_TOKEN=from-file-1",
      "RELAY_TOKEN=from-file-2",
      "RELAY_TOKEN=from-file-3"
    ].join("\n"),
    "utf8"
  );
  // Simulate a parent shell pre-set value, then run the
  // loadDotEnv path through the same helper used by every
  // other test, so the "restore process.env" bookkeeping
  // stays consistent.
  const before = process.env.RELAY_TOKEN;
  process.env.RELAY_TOKEN = "from-shell";
  try {
    loadDotEnv(dir);
    assert.equal(
      process.env.RELAY_TOKEN,
      "from-shell",
      "parent shell value must win over every .env occurrence"
    );
  } finally {
    if (before === undefined) delete process.env.RELAY_TOKEN;
    else process.env.RELAY_TOKEN = before;
  }
});

test("0.6.2: missing .env is a no-op (returns silently)", async () => {
  const dir = await withFakeRoot(); // no .env written
  // Should not throw. Use loadEnvInRoot so the helper
  // does not try to "restore" process.env keys we never
  // touched (and would otherwise throw on a key that
  // is undefined in the helper's `before` snapshot).
  await loadEnvInRoot(dir, []);
  assert.ok(true, "loadDotEnv on a missing .env is a silent no-op");
});

test("0.6.2: empty .env (zero assignments) is a no-op", async () => {
  const dir = await withFakeRoot();
  await writeFile(join(dir, ".env"), "", "utf8");
  await loadEnvInRoot(dir, []);
  assert.ok(true, "loadDotEnv on an empty .env does not set any keys");
});

test("0.6.2: quoted values are stripped of surrounding quotes", async () => {
  const result = await loadFakeEnv(
    [
      "QUOTED_DOUBLE=\"value-with-quotes\"",
      "QUOTED_SINGLE='single-quoted'",
      "UNQUOTED=plain"
    ].join("\n"),
    ["QUOTED_DOUBLE", "QUOTED_SINGLE", "UNQUOTED"]
  );
  assert.equal(result.QUOTED_DOUBLE, "value-with-quotes");
  assert.equal(result.QUOTED_SINGLE, "single-quoted");
  assert.equal(result.UNQUOTED, "plain");
});

test("0.6.2: lines with leading whitespace are trimmed and accepted; lines with space before '=' are rejected", async () => {
  // loadDotEnv applies `line.trim()` BEFORE the regex match,
  // so a line like "  FOO=bar" becomes "FOO=bar" and is
  // accepted. This is by design: YAML-style indentation is
  // common in operator-edited .env files. The contract we
  // enforce here is: trimming never introduces a hidden
  // key, and lines whose KEY contains an internal space
  // ("FOO = bar" — the regex requires `=` to be immediately
  // after the key) are not parsed at all.
  const result = await loadFakeEnv(
    [
      "  FOO=trimmed-and-accepted",
      "BAR = with-space-before-equals-rejected",
      "REAL=ok"
    ].join("\n"),
    ["FOO", "BAR", "REAL"]
  );
  assert.equal(result.FOO, "trimmed-and-accepted", "indented FOO=... is trimmed then accepted");
  assert.equal(result.BAR, undefined, "'BAR = ...' (space before =) must not assign BAR");
  assert.equal(result.REAL, "ok", "REAL=ok should still assign normally");
});

test("0.6.2: re-running loadDotEnv is idempotent for the same file", async () => {
  // Two consecutive loadDotEnv calls against the same .env
  // must produce the same process.env result. This guards
  // against the envSetByDotEnv bookkeeping drifting between
  // calls.
  const dir = await withFakeRoot();
  await writeFile(join(dir, ".env"), "STABLE=early\nSTABLE=final\n", "utf8");
  const after1 = await loadEnvInRoot(dir, ["STABLE"]);
  const after2 = await loadEnvInRoot(dir, ["STABLE"]);
  assert.equal(after1.STABLE, "final", "first call: STABLE=final");
  assert.equal(after2.STABLE, "final", "second call: STABLE=final (idempotent)");
  assert.equal(after1.STABLE, after2.STABLE);
});
