// Unit tests for the secret store. Run: node scripts/test-secret-store.mjs

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { SecretStore } from "../src/secret-store.js";

const fixedNow = () => new Date("2026-06-02T12:00:00.000Z");

// Incrementing mock random: each call returns a different buffer of
// the requested size, so ids and IVs are unique per call.
let counter = 0;
function makeMockRandom() {
  return (n) => {
    counter += 1;
    return Buffer.alloc(n, counter & 0xff);
  };
}

function makeStore({ env, random } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "secret-store-test-"));
  return {
    store: new SecretStore({ dataDir: dir, env: env || {}, now: fixedNow, random: random || makeMockRandom() }),
    dir
  };
}

test("add() returns a public view that does not include encryptedValue", () => {
  const { store } = makeStore();
  const record = store.add({ provider: "deepseek", value: "sk-test-1234567890abcdef", label: "涓?key" });
  assert.equal(record.provider, "deepseek", "provider echoed");
  assert.equal(record.label, "涓?key", "label echoed");
  assert.equal(record.masked, "sk-tes...cdef", "masked key");
  assert.equal(record.hash.length, 12, "hash is 12 hex chars");
  assert.equal(record.enabled, true, "enabled by default");
  assert.equal(record.encryptedValue, undefined, "encryptedValue must never appear in public view");
  assert(record.id.startsWith("key_"), "id has key_ prefix");
  assert(!("value" in record), "plaintext value must not appear in public view");
  assert(!("secret" in record), "no 'secret' field");
  assert(!("apiKey" in record), "no 'apiKey' field");
});

test("getDecryptedValue() recovers the original value", () => {
  const { store } = makeStore();
  const record = store.add({ provider: "openai", value: "sk-openai-1234567890" });
  const decrypted = store.getDecryptedValue(record.id);
  assert.equal(decrypted, "sk-openai-1234567890", "round-trip");
});

test("encryptedValue blob is opaque and different each time (random IV)", () => {
  const { store } = makeStore({ random: randomBytes });
  const a = store.add({ provider: "x", value: "sk-same-value" });
  const b = store.add({ provider: "x", value: "sk-same-value" });
  assert.notDeepEqual(a, b, "records differ in id and timestamp");
  // The internal encryptedValue (we can read it via get() and re-decrypt)
  const decryptA = store.getDecryptedValue(a.id);
  const decryptB = store.getDecryptedValue(b.id);
  assert.equal(decryptA, decryptB, "both decrypt to the same plaintext");
  // The encryptedValue blobs themselves are different (random IVs)
  //  -- ?peek via internal map to verify
  const rawA = store.records.get(a.id).encryptedValue;
  const rawB = store.records.get(b.id).encryptedValue;
  assert.notEqual(rawA.iv, rawB.iv, "IVs differ between encryptions");
});

test("list() filters by provider and never returns encryptedValue", () => {
  const { store } = makeStore();
  store.add({ provider: "deepseek", value: "sk-deepseek-1" });
  store.add({ provider: "deepseek", value: "sk-deepseek-2" });
  store.add({ provider: "openai", value: "sk-openai-1" });
  const all = store.list();
  assert.equal(all.length, 3, "3 total");
  for (const r of all) assert.equal(r.encryptedValue, undefined, "no encryptedValue in any list entry");
  const onlyDeepseek = store.list({ provider: "deepseek" });
  assert.equal(onlyDeepseek.length, 2, "2 for deepseek");
  for (const r of onlyDeepseek) assert.equal(r.provider, "deepseek", "all are deepseek");
});

test("update() changes label / enabled and persists", () => {
  const { store } = makeStore();
  const record = store.add({ provider: "x", value: "sk-1", label: "old" });
  const updated = store.update(record.id, { label: "new", enabled: false });
  assert.equal(updated.label, "new", "label updated");
  assert.equal(updated.enabled, false, "enabled updated");
  assert.equal(updated.updatedAt, "2026-06-02T12:00:00.000Z", "updatedAt bumped to now()");
  // Disabled keys return null from getDecryptedValue
  assert.equal(store.getDecryptedValue(record.id), null, "disabled key returns null");
});

test("update() can replace the encrypted value, hash and masked refresh", () => {
  const { store, dir } = makeStore();
  const record = store.add({ provider: "x", value: "sk-original-aaaaaaaaaaaa" });
  const oldHash = record.hash;
  const oldMasked = record.masked;
  const updated = store.update(record.id, { value: "sk-replacement-bbbbbbbbbb" });
  assert.equal(updated.hash, store.get(record.id).hash, "hash returned in public view matches storage");
  assert.notEqual(updated.hash, oldHash, "hash changes when value is replaced");
  assert.notEqual(updated.masked, oldMasked, "masked refreshes");
  // Decryption works against the new value.
  assert.equal(store.getDecryptedValue(record.id), "sk-replacement-bbbbbbbbbb", "new value decrypts");
  // Persisted to disk.
  const reloaded = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  assert.equal(reloaded.getDecryptedValue(record.id), "sk-replacement-bbbbbbbbbb", "new value persists across reload");
});

test("remove() drops the record and persists", () => {
  const { store, dir } = makeStore();
  const record = store.add({ provider: "x", value: "sk-1" });
  assert.equal(store.remove(record.id), true, "remove returns true on first call");
  assert.equal(store.remove(record.id), false, "remove returns false on second call");
  assert.equal(store.list().length, 0, "no records left");
  // Reload from disk to confirm persistence
  const reloaded = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  assert.equal(reloaded.list().length, 0, "still empty after reload");
});

test("reload from disk preserves records", () => {
  const { store, dir } = makeStore();
  store.add({ provider: "a", value: "sk-aaa-1" });
  store.add({ provider: "a", value: "sk-aaa-2" });
  store.add({ provider: "b", value: "sk-bbb-1" });
  const reloaded = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  assert.equal(reloaded.list().length, 3, "3 records after reload");
  const a = reloaded.list({ provider: "a" });
  assert.equal(a.length, 2, "2 for provider a");
  assert.equal(reloaded.getDecryptedValue(a[0].id), a[0].value || "sk-aaa-1", "decryption works after reload");
});

test("OPENRELAY_KEYSTORE_SECRET env var produces a deterministic key", () => {
  // Same env var = same derived key. Different env vars = different keys.
  const env = { OPENRELAY_KEYSTORE_SECRET: "the-master-passphrase" };
  const a = makeStore({ env });
  const b = makeStore({ env });
  // Cannot inspect masterKey directly, but we can verify cross-instance
  // decrypt by adding a record in one and reading in another.
  const record = a.store.add({ provider: "x", value: "sk-shared-secret" });
  // b.store reads the same file with the same env-derived key  -- ?should decrypt
  // (we'd need a shared dataDir; use a single dir for this test)
  const c = new SecretStore({ dataDir: a.dir, env, now: fixedNow, random: makeMockRandom() });
  assert.equal(c.getDecryptedValue(record.id), "sk-shared-secret", "env var derives consistent key");
});

test("different OPENRELAY_KEYSTORE_SECRET values produce different keys", () => {
  // Two stores with different env vars, same dataDir, must NOT be able
  // to cross-decrypt.
  const a = makeStore({ env: { OPENRELAY_KEYSTORE_SECRET: "passphrase-one" } });
  const b = makeStore({ env: { OPENRELAY_KEYSTORE_SECRET: "passphrase-two" } });
  const record = a.store.add({ provider: "x", value: "sk-secret" });
  // b was created on a different tmpDir so its records is empty.
  // Reconstruct it pointing at a's dataDir but with the wrong env var.
  const wrong = new SecretStore({ dataDir: a.dir, env: { OPENRELAY_KEYSTORE_SECRET: "passphrase-two" }, now: fixedNow, random: makeMockRandom() });
  assert.throws(() => wrong.getDecryptedValue(record.id), /unsupported|final|auth/i, "wrong env var must not decrypt");
});

test("a wrong master.key file is detected and rejected", async () => {
  // First store with default env (no env var) writes a master.key.
  // Manually overwrite master.key with a different value, then a new
  // store should refuse to load the existing keys.
  const { dir } = makeStore();
  // After the first makeStore() the data dir has a master.key.
  // Overwrite it with the wrong content.
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(dir, "master.key"), Buffer.alloc(32, 0x99));
  // Now construct a new store on the same dir  -- ?add() will fail
  // because _decrypt() of any pre-existing record will produce a
  // tag mismatch; but our test only added to the first store before
  // overwriting, so let's add one record with the wrong master.
  const wrong = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  wrong.add({ provider: "x", value: "sk-1" });
  // Now corrupt the master.key again
  writeFileSync(join(dir, "master.key"), Buffer.alloc(32, 0xab));
  // New store will load the records but decryption will fail.
  const reloaded = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  // The list still works (no decryption needed).
  assert.equal(reloaded.list().length, 1, "list still works");
  // getDecryptedValue will throw because the auth tag won't match.
  assert.throws(() => reloaded.getDecryptedValue(reloaded.list()[0].id), /auth|final|unsupported/i, "wrong key throws on decrypt");
});

test("getDecryptedValuesForProvider() only returns enabled keys for that provider", () => {
  const { store } = makeStore();
  store.add({ provider: "a", value: "sk-a-1", label: "a1" });
  store.add({ provider: "a", value: "sk-a-2", label: "a2" });
  store.add({ provider: "b", value: "sk-b-1" });
  const aList = store.add({ provider: "a", value: "sk-a-3", label: "a3" });
  store.update(aList.id, { enabled: false });
  const decrypted = store.getDecryptedValuesForProvider("a");
  assert.equal(decrypted.length, 2, "only enabled keys for a");
  const values = decrypted.map((d) => d.value).sort();
  assert.deepEqual(values, ["sk-a-1", "sk-a-2"], "values match");
  // b has 1
  const bList = store.getDecryptedValuesForProvider("b");
  assert.equal(bList.length, 1, "1 for b");
  assert.equal(bList[0].value, "sk-b-1", "b value");
});

test("markUsed() updates lastUsedAt in memory; recordTestResult() persists", () => {
  const { store, dir } = makeStore();
  const record = store.add({ provider: "x", value: "sk-1" });
  assert.equal(record.lastUsedAt, null, "no lastUsedAt initially");
  // markUsed: in-memory only.
  store.markUsed(record.id);
  assert.equal(store.get(record.id).lastUsedAt, "2026-06-02T12:00:00.000Z", "lastUsedAt set");
  // Reload from disk  -- ?lastUsedAt is NOT persisted (intentional to
  // avoid hammering the disk on every request).
  const reloaded = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  assert.equal(reloaded.get(record.id).lastUsedAt, null, "lastUsedAt not persisted");
  // recordTestResult IS persisted.
  store.recordTestResult(record.id, { ok: true, status: 200 });
  const reloaded2 = new SecretStore({ dataDir: dir, env: {}, now: fixedNow, random: makeMockRandom() });
  const r = reloaded2.get(record.id);
  assert(r.lastTestResult?.ok === true, "lastTestResult persisted");
  assert(r.lastTestAt, "lastTestAt set");
});

test("add rejects missing provider / value", () => {
  const { store } = makeStore();
  assert.throws(() => store.add({ value: "sk-1" }), /provider/, "missing provider");
  assert.throws(() => store.add({ provider: "x" }), /value/, "missing value");
  assert.throws(() => store.add({ provider: "x", value: "" }), /value/, "empty value");
});

test("label is truncated to 80 chars", () => {
  const { store } = makeStore();
  const long = "a".repeat(200);
  const record = store.add({ provider: "x", value: "sk-1", label: long });
  assert.equal(record.label.length, 80, "label capped at 80");
});

test("masked format follows the same shape as .env keys (first 6 + ... + last 4)", () => {
  const { store } = makeStore();
  const record = store.add({ provider: "x", value: "sk-abcdefghijklmnopqrstuvwxyz" });
  assert.equal(record.masked, "sk-abc...wxyz", "masked format consistent with KeyPool");
});

test("hash is the first 12 hex chars of sha256(value)", async () => {
  const { store } = makeStore();
  const value = "sk-test";
  const { createHash } = await import("node:crypto");
  const expectedHash = createHash("sha256").update(value).digest("hex").slice(0, 12);
  const record = store.add({ provider: "x", value });
  assert.equal(record.hash, expectedHash, "hash format matches");
  assert.equal(record.hash.length, 12, "hash 12 hex");
});
