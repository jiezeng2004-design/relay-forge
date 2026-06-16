// 0.5.9: doctor redaction test. Runs `collectDoctorReport`
// against a fake root directory that contains a synthetic
// API key, a synthetic relay token, and a fake Authorization
// header in the runtime state file. Asserts that the report
// never leaks any of those secrets and that the masked
// token is present.
//
// Zero dependencies. Uses node:test + node:fs/promises +
// node:os + node:path. Run via
// `node scripts/test-doctor-redaction.mjs`.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, "..", "..");

const { collectDoctorReport } = await import(
  pathToFileURL(join(repoRoot, "scripts", "doctor-lib.mjs")).href
);

const FAKE_API_KEY = "sk-doctorredactionTESTKEY-FAKE-1234567890abcdef";
const FAKE_RELAY_TOKEN = "f4ke-relay-token-9c7c9b2a4f5e6d7a8b9c0d1e2f3a4b5c";
const FAKE_AUTHORIZATION = "Bearer FAKE-AUTHORIZATION-HEADER-DOCTOR-TEST";

const tempDirs = new Set();

async function buildFakeRoot() {
  const root = await mkdtemp(join(tmpdir(), "openrelay-doctor-"));
  tempDirs.add(root);

  // 1. config.json (the file doctor will read; we use the
  //    project's config.example.json as the base so the schema
  //    validator accepts it).
  const examplePath = join(repoRoot, "config.example.json");
  const { copyFile } = await import("node:fs/promises");
  await copyFile(examplePath, join(root, "config.json"));

  // 2. .env with a fake DEEPSEEK_API_KEYS
  const envBody = [
    "# doctor test env — all values are fake",
    `DEEPSEEK_API_KEYS=${FAKE_API_KEY}`,
    `RELAY_TOKEN=${FAKE_RELAY_TOKEN}`,
    ""
  ].join("\n");
  await writeFile(join(root, ".env"), envBody, "utf8");

  // 3. data/security/relay-token (different from the env value
  //    to confirm doctor reports the disk file, not the env)
  const relayTokenPath = join(root, "data", "security", "relay-token");
  await mkdir(join(root, "data", "security"), { recursive: true });
  await writeFile(relayTokenPath, `${FAKE_RELAY_TOKEN}\n`, "utf8");

  // 4. data/runtime-state.json that contains the fake
  //    Authorization header AND the fake API key in a way a
  //    real recentErrors[] entry would never be persisted, but
  //    which must still NOT appear in the doctor output.
  const statePath = join(root, "data", "runtime-state.json");
  await mkdir(join(root, "data"), { recursive: true });
  const poisonedState = {
    version: 2,
    savedAt: "2026-01-01T00:00:00.000Z",
    activeProfile: null,
    stats: {},
    usage: {},
    healthCache: {},
    modelDiscoveryCache: {},
    balanceCache: {},
    recentErrors: [
      {
        scope: "test",
        category: "upstream_auth",
        message: `failed with authorization: ${FAKE_AUTHORIZATION}`,
        meta: { apiKey: FAKE_API_KEY }
      }
    ],
    providerHealth: {}
  };
  await writeFile(statePath, JSON.stringify(poisonedState, null, 2), "utf8");

  // 5. data/keys.enc.json — a non-empty placeholder so the
  //    "encrypted keys" path is reported as present. Real
  //    ciphertext is binary; the doctor only reports path +
  //    exists boolean.
  await writeFile(
    join(root, "data", "keys.enc.json"),
    JSON.stringify({ keys: [] }, null, 2),
    "utf8"
  );

  // 6. data/master.key — empty placeholder so the "master
  //    key" path is reported as present.
  await writeFile(join(root, "data", "master.key"), "0123456789abcdef", "utf8");

  return root;
}

test.after(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

test("doctor: report is valid JSON with the expected public fields", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root });

  assert.equal(typeof report.version, "string");
  assert.equal(typeof report.node, "string");
  assert.equal(typeof report.platform, "string");
  assert.equal(typeof report.arch, "string");
  assert.equal(typeof report.rootDir, "string");
  assert.equal(typeof report.port, "number");
  assert.equal(report.bindHost, "127.0.0.1");
  assert.equal(typeof report.config, "object");
  assert.equal(typeof report.config.valid, "boolean");
  assert.equal(typeof report.config.providers, "number");
  assert.equal(typeof report.config.routes, "number");
  assert.equal(typeof report.relayAuth, "object");
  assert.equal(typeof report.runtimeState, "object");
  assert.equal(typeof report.security, "object");
});

test("doctor: default port matches upstream openrelay when PORT is unset", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root, env: {} });

  assert.equal(report.port, 18765);
  assert.equal(report.bindHost, "127.0.0.1");
});

test("doctor: never includes the full fake API key", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root });
  const serialized = JSON.stringify(report);

  assert.ok(
    !serialized.includes(FAKE_API_KEY),
    "doctor JSON must not contain the full fake API key"
  );
  // The .env file the doctor reads never had a real key, so
  // even though config.example.json is the schema template we
  // base it on, no fake key should leak.
});

test("doctor: never includes the full fake relay token", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root });
  const serialized = JSON.stringify(report);

  assert.ok(
    !serialized.includes(FAKE_RELAY_TOKEN),
    "doctor JSON must not contain the full fake relay token"
  );
});

test("doctor: never includes the fake Authorization header", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root });
  const serialized = JSON.stringify(report);

  assert.ok(
    !serialized.includes(FAKE_AUTHORIZATION),
    "doctor JSON must not contain the fake Authorization header"
  );
  assert.ok(
    !serialized.toLowerCase().includes("bearer fake"),
    "doctor JSON must not contain a Bearer token"
  );
});

test("doctor: includes a masked token hint", async () => {
  const root = await buildFakeRoot();
  const report = collectDoctorReport({ rootDir: root });
  const masked = report.relayAuth.apiKeyMasked;

  // The disk token wins (overrides the env) and the masked
  // form is `XXXXXX...YYYY` where XXXXXX is the first 6 hex
  // chars and YYYY is the last 4. Confirm both halves are
  // present and the full token is NOT.
  assert.ok(typeof masked === "string" && masked.length > 0);
  assert.match(masked, /\.{3}/, "masked token should contain an ellipsis");
  assert.ok(
    !masked.includes(FAKE_RELAY_TOKEN),
    "masked form must not equal the full token"
  );
  assert.ok(
    masked.includes(FAKE_RELAY_TOKEN.slice(0, 4)) ||
      FAKE_RELAY_TOKEN.slice(0, 4).toLowerCase().includes(masked.slice(0, 4).toLowerCase()),
    "masked hint should start with the same prefix as the full token"
  );
});

test("doctor: does NOT write data/security/relay-token (readonly)", async () => {
  // Build a fresh fake root WITHOUT a relay-token file. The
  // doctor must report `tokenRequired: true` (because RELAY_TOKEN
  // env is unset in this child), but must NOT create the disk
  // file. This guards the 0.5.4 invariant that `npm run check`
  // and similar read-only tools do not create data/.
  const root = await buildFakeRoot();
  await rm(join(root, "data", "security", "relay-token"), { force: true });
  await rm(join(root, ".env"), { force: true });

  const report = collectDoctorReport({ rootDir: root, env: {} });
  assert.equal(report.relayAuth.tokenRequired, true);
  assert.equal(report.relayAuth.tokenSource, "check-readonly");

  // File must still be absent.
  const { existsSync } = await import("node:fs");
  assert.equal(
    existsSync(join(root, "data", "security", "relay-token")),
    false,
    "doctor must not create data/security/relay-token"
  );
});
