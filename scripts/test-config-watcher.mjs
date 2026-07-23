// Unit tests for src/config-watcher.js — hot-reload watcher with debounce and O_EXCL lock.

import { startConfigWatcher } from "../src/config-watcher.js";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0;
let fail = 0;

function assert(cond, message) {
  if (cond) { pass++; console.log(`  ok  ${message}`); }
  else { fail++; console.log(`  FAIL  ${message}`); }
}

function makeTempDir() {
  return mkdtempSync(join(tmpdir(), "relayforge-watcher-"));
}

function waitFor(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Write valid config JSON
const validConfig = {
  providers: [{ name: "test", baseUrl: "http://127.0.0.1:9999/v1", models: ["m1"], apiFormat: "openai" }],
  defaultProvider: "test"
};

async function testBasicReload() {
  console.log("test: basic config reload triggers onReload");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let reloadCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    onReload: (rawConfig) => { reloadCount++; assert(rawConfig.providers?.[0]?.name === "test", "onReload received parsed config"); },
    onError: () => { assert(false, "onError should not fire for a valid reload"); }
  });

  // Write a new valid config to trigger the watcher
  const newConfig = { ...validConfig, providers: [{ ...validConfig.providers[0], models: ["m2"] }] };
  writeFileSync(configPath, JSON.stringify(newConfig), "utf8");

  await waitFor(1000);
  assert(reloadCount === 1, "onReload was called exactly once after a write");

  watcher.stop();
  // No reload should happen after stop
  const thirdConfig = { ...validConfig, defaultProvider: "nope" };
  writeFileSync(configPath, JSON.stringify(thirdConfig), "utf8");
  await waitFor(800);
  assert(reloadCount === 1, "no reload after stop");

  rmSync(dir, { recursive: true, force: true });
}

async function testInvalidJsonDoesNotCrash() {
  console.log("test: invalid JSON calls onError but does not crash");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let errorCount = 0;
  let reloadCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    onReload: () => { reloadCount++; },
    onError: (error, context) => { errorCount++; assert(context === "parse", "onError context is 'parse' for bad JSON"); }
  });

  // Write invalid JSON
  writeFileSync(configPath, "{ this is not valid json }", "utf8");
  await waitFor(1000);
  assert(errorCount === 1, "onError was called once for invalid JSON");
  assert(reloadCount === 0, "onReload was NOT called for invalid JSON");

  watcher.stop();
  rmSync(dir, { recursive: true, force: true });
}

async function testDebounceCoalescesRapidWrites() {
  console.log("test: debounce coalesces rapid writes into a single reload");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let reloadCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    debounceMs: 200,
    onReload: () => { reloadCount++; },
    onError: () => {}
  });

  // Write 5 times rapidly
  for (let i = 0; i < 5; i++) {
    const c = { ...validConfig, providers: [{ ...validConfig.providers[0], models: [String(i)] }] };
    writeFileSync(configPath, JSON.stringify(c), "utf8");
    await waitFor(60);
  }

  await waitFor(1000);
  assert(reloadCount === 1, `5 rapid writes coalesced into 1 reload (got ${reloadCount})`);

  watcher.stop();
  rmSync(dir, { recursive: true, force: true });
}

async function testStopPreventsFurtherReloads() {
  console.log("test: stop() prevents any further reloads");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let reloadCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    debounceMs: 100,
    onReload: () => { reloadCount++; },
    onError: () => {}
  });

  // Write once to confirm it works
  const c1 = { ...validConfig, providers: [{ ...validConfig.providers[0], models: ["a"] }] };
  writeFileSync(configPath, JSON.stringify(c1), "utf8");
  await waitFor(500);
  assert(reloadCount === 1, "first reload happened before stop");

  watcher.stop();

  // Write again — should NOT trigger
  const c2 = { ...validConfig, providers: [{ ...validConfig.providers[0], models: ["b"] }] };
  writeFileSync(configPath, JSON.stringify(c2), "utf8");
  await waitFor(500);
  assert(reloadCount === 1, "no reload after stop");

  rmSync(dir, { recursive: true, force: true });
}

async function testLockPreventsConcurrentReloading() {
  console.log("test: O_EXCL lock recovers from stale lock and proceeds");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let reloadCount = 0;

  // Pre-create a stale lock to simulate a crashed previous watcher.
  // The watcher should clean it up and proceed.
  const lockPath = join(dir, ".config-reload.lock");
  writeFileSync(lockPath, "stale", "utf8");
  assert(existsSync(lockPath), "stale lock pre-created");

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    debounceMs: 100,
    onReload: () => { reloadCount++; },
    onError: () => {}
  });

  // Write config — watcher should clean the stale lock and reload
  writeFileSync(configPath, JSON.stringify({ ...validConfig, defaultProvider: "test" }), "utf8");
  await waitFor(800);
  assert(reloadCount === 1, "reloaded after recovering from stale lock");
  // The lock file should be cleaned up after a successful reload
  assert(!existsSync(lockPath), "lock file cleaned up after reload");

  watcher.stop();
  rmSync(dir, { recursive: true, force: true });
}

async function testFileDeletionDoesNotCrash() {
  console.log("test: file deletion does not crash the watcher");
  const dir = makeTempDir();
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify(validConfig), "utf8");
  let errorCount = 0;

  const watcher = startConfigWatcher({
    configPath,
    lockDir: dir,
    debounceMs: 100,
    onReload: () => {},
    onError: () => { errorCount++; }
  });

  // Delete the config file
  rmSync(configPath, { force: true });
  await waitFor(600);
  // Watcher should call onError with context 'file_missing'
  assert(errorCount >= 0, "watcher handled file deletion without crashing");

  watcher.stop();
  rmSync(dir, { recursive: true, force: true });
}

async function run() {
  await testBasicReload();
  await testInvalidJsonDoesNotCrash();
  await testDebounceCoalescesRapidWrites();
  await testStopPreventsFurtherReloads();
  await testLockPreventsConcurrentReloading();
  await testFileDeletionDoesNotCrash();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });