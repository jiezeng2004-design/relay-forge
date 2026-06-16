// Pure unit tests for src/config-schema.js. No server, no I/O.
// Covers the validation surface used by the Dashboard's save
// flow: missing fields, wrong types, bad URLs, bad strategies,
// duplicate names, dangling references, forbidden secret fields,
// real-key-looking values in keyEnv, and cross-reference checks
// (defaultProvider / activeProfile / route candidates / profile
// defaultModel / healthChecks.providers).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMA_VERSION, VALIDATION_FORBIDDEN_FIELDS, validateConfig } from "../src/config-schema.js";

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
function assertHasError(result, pathFragment, msg) {
  if (result.ok) throw new Error(`expected validation to fail: ${msg}`);
  if (!result.errors.some((e) => e.path === pathFragment || e.path.startsWith(pathFragment + ".") || e.path.startsWith(pathFragment + "["))) {
    throw new Error(`expected error at ${pathFragment}; got: ${result.errors.map((e) => e.path).join(", ")}`);
  }
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const exampleConfig = JSON.parse(readFileSync(resolve(rootDir, "config.example.json"), "utf8"));

// ---- happy path ----

test("example config validates without errors", () => {
  const r = validateConfig(exampleConfig);
  if (!r.ok) {
    throw new Error("example config should validate: " + JSON.stringify(r.errors, null, 2));
  }
});

test("schema version is exposed", () => {
  assert(typeof SCHEMA_VERSION === "string" && /^\d+\.\d+\.\d+$/.test(SCHEMA_VERSION), "semver");
});

test("VALIDATION_FORBIDDEN_FIELDS includes all sensitive keys", () => {
  for (const f of ["apikey", "token", "secret", "password", "cookie", "authorization"]) {
    assert(VALIDATION_FORBIDDEN_FIELDS.includes(f), `${f} listed`);
  }
});

// ---- root ----

test("non-object config rejected", () => {
  assertEqual(validateConfig(null).ok, false, "null");
  assertEqual(validateConfig([]).ok, false, "array");
  assertEqual(validateConfig("hello").ok, false, "string");
  assertEqual(validateConfig(42).ok, false, "number");
});

test("missing providers rejected", () => {
  const r = validateConfig({ providers: [] });
  assertEqual(r.ok, false, "empty providers");
  assertHasError(r, "providers", "empty providers");
});

test("providers not an array rejected", () => {
  const r = validateConfig({ providers: "nope" });
  assertEqual(r.ok, false, "string providers");
  assertHasError(r, "providers", "string providers");
});

// ---- provider ----

test("provider without name rejected", () => {
  const r = validateConfig({ providers: [{ baseUrl: "https://x" }] });
  assertEqual(r.ok, false, "no name");
  assertHasError(r, "providers[0].name", "no name");
});

test("provider without baseUrl rejected", () => {
  const r = validateConfig({ providers: [{ name: "p" }] });
  assertEqual(r.ok, false, "no baseUrl");
  assertHasError(r, "providers[0].baseUrl", "no baseUrl");
});

test("provider baseUrl must be http(s)", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "ftp://x" }] });
  assertEqual(r.ok, false, "ftp baseUrl");
  assertHasError(r, "providers[0].baseUrl", "ftp baseUrl");
});

test("provider apiFormat must be openai or anthropic", () => {
  const r1 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x", apiFormat: "google" }] });
  assertEqual(r1.ok, false, "google apiFormat");
  assertHasError(r1, "providers[0].apiFormat", "google apiFormat");
  const r2 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }] });
  assertEqual(r2.ok, true, "omitted apiFormat OK (defaults to openai)");
});

test("duplicate provider name rejected", () => {
  const r = validateConfig({ providers: [
    { name: "dup", baseUrl: "https://x" },
    { name: "dup", baseUrl: "https://y" }
  ] });
  assertEqual(r.ok, false, "dup");
  assertHasError(r, "providers[1].name", "dup at index 1");
});

test("provider keyEnv that looks like a real API key is rejected", () => {
  const r = validateConfig({ providers: [
    { name: "p", baseUrl: "https://x", keyEnv: "sk-1234567890abcdef" }
  ] });
  assertEqual(r.ok, false, "key in keyEnv");
  assertHasError(r, "providers[0].keyEnv", "key in keyEnv");
});

test("provider keyEnv must match env var name pattern", () => {
  const r = validateConfig({ providers: [
    { name: "p", baseUrl: "https://x", keyEnv: "1FOO" }
  ] });
  assertEqual(r.ok, false, "starts with digit");
  assertHasError(r, "providers[0].keyEnv", "starts with digit");
});

test("provider models must be string array", () => {
  const r1 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x", models: "nope" }] });
  assertEqual(r1.ok, false, "string models");
  assertHasError(r1, "providers[0].models", "string models");
  const r2 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x", models: ["ok", 42] }] });
  assertEqual(r2.ok, false, "non-string element");
  assertHasError(r2, "providers[0].models[1]", "non-string element");
});

test("provider allowInsecureHttp must be boolean", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x", allowInsecureHttp: "yes" }] });
  assertEqual(r.ok, false, "string flag");
  assertHasError(r, "providers[0].allowInsecureHttp", "string flag");
});

test("balanceEndpoint.url must be http(s)", () => {
  const r = validateConfig({ providers: [
    { name: "p", baseUrl: "https://x", balanceEndpoint: { url: "ftp://y" } }
  ] });
  assertEqual(r.ok, false, "balance ftp");
  assertHasError(r, "providers[0].balanceEndpoint.url", "balance ftp");
});

test("forbidden secret fields in provider rejected", () => {
  for (const f of ["apiKey", "token", "secret", "password", "cookie", "authorization"]) {
    const provider = { name: "p", baseUrl: "https://x" };
    provider[f] = "leaked";
    const r = validateConfig({ providers: [provider] });
    assertEqual(r.ok, false, `forbidden field ${f}`);
    assertHasError(r, `providers[0].${f}`, `forbidden field ${f}`);
  }
});

// ---- route ----

test("route without name rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ strategy: "fallback", candidates: [{ provider: "p", model: "m" }] }] });
  assertEqual(r.ok, false, "no route name");
  assertHasError(r, "routes[0].name", "no route name");
});

test("route without candidates rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r" }] });
  assertEqual(r.ok, false, "no candidates");
  assertHasError(r, "routes[0].candidates", "no candidates");
});

test("empty route candidates rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r", candidates: [] }] });
  assertEqual(r.ok, false, "empty candidates");
  assertHasError(r, "routes[0].candidates", "empty candidates");
});

test("route strategy must be fallback / round_robin / weighted", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r", strategy: "random", candidates: [{ provider: "p", model: "m" }] }] });
  assertEqual(r.ok, false, "random strategy");
  assertHasError(r, "routes[0].strategy", "random strategy");
});

test("route candidate with missing provider flagged", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r", candidates: [{ provider: "ghost", model: "m" }] }] });
  assertEqual(r.ok, false, "missing provider");
  assertHasError(r, "routes[0].candidates[0].provider", "missing provider");
});

test("route candidate with non-integer weight flagged", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r", candidates: [{ provider: "p", model: "m", weight: 0.5 }] }] });
  assertEqual(r.ok, false, "non-integer weight");
  assertHasError(r, "routes[0].candidates[0].weight", "non-integer weight");
});

test("route candidate with negative weight flagged", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], routes: [{ name: "r", candidates: [{ provider: "p", model: "m", weight: -1 }] }] });
  assertEqual(r.ok, false, "negative weight");
  assertHasError(r, "routes[0].candidates[0].weight", "negative weight");
});

test("duplicate route name rejected", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    routes: [
      { name: "r", candidates: [{ provider: "p", model: "m" }] },
      { name: "r", candidates: [{ provider: "p", model: "m" }] }
    ]
  });
  assertEqual(r.ok, false, "dup");
  assertHasError(r, "routes[1].name", "dup at index 1");
});

test("route limits.dailyRequests must be positive integer", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    routes: [{ name: "r", candidates: [{ provider: "p", model: "m" }], limits: { dailyRequests: 0 } }]
  });
  assertEqual(r.ok, false, "zero limit");
  assertHasError(r, "routes[0].limits.dailyRequests", "zero limit");
});

test("route limits.dailyRequests accepts null (= unlimited)", () => {
  const r1 = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    routes: [{ name: "r", candidates: [{ provider: "p", model: "m" }], limits: { dailyRequests: null } }]
  });
  assertEqual(r1.ok, true, "null is valid (= unlimited)");
  // Top-level limits.dailyRequests also accepts null.
  const r2 = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    limits: { dailyRequests: null }
  });
  assertEqual(r2.ok, true, "top-level null is valid");
  // limits.providers.*.dailyRequests, limits.routes.*.dailyRequests, and
  // limits.models.*.dailyRequests also accept null.
  const r3 = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    limits: { providers: { p: { dailyRequests: null } } }
  });
  assertEqual(r3.ok, true, "limits.providers.*.dailyRequests null is valid");
  const r4 = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    limits: { models: { "p:m": { dailyRequests: null } } }
  });
  assertEqual(r4.ok, true, "limits.models.*.dailyRequests null is valid");
});

test("limits.models dailyRequests must be positive integer, null, or omitted", () => {
  const good = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["m"] }],
    limits: { models: { "p:m": { dailyRequests: 3 } } }
  });
  assertEqual(good.ok, true, "positive model limit");

  const zero = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["m"] }],
    limits: { models: { "p:m": { dailyRequests: 0 } } }
  });
  assertEqual(zero.ok, false, "zero model limit");
  assertHasError(zero, "limits.models.p:m.dailyRequests", "zero model limit");

  const badType = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["m"] }],
    limits: { models: { "p:m": { dailyRequests: "3" } } }
  });
  assertEqual(badType.ok, false, "string model limit");
  assertHasError(badType, "limits.models.p:m.dailyRequests", "string model limit");
});

// ---- profile ----

test("profile without name rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], profiles: [{ defaultModel: "m" }] });
  assertEqual(r.ok, false, "no name");
  assertHasError(r, "profiles[0].name", "no name");
});

test("profile without defaultModel rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], profiles: [{ name: "pr" }] });
  assertEqual(r.ok, false, "no default");
  assertHasError(r, "profiles[0].defaultModel", "no default");
});

test("profile defaultModel pointing nowhere produces a warning, not an error", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["known"] }],
    profiles: [{ name: "pr", defaultModel: "unknown-model" }]
  });
  assertEqual(r.ok, true, "warning is not an error");
  assert(r.warnings && r.warnings.length > 0, `expected a warning; got ${JSON.stringify(r.warnings)}`);
});

test("profile defaultModel referencing known model passes", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["known"] }],
    profiles: [{ name: "pr", defaultModel: "known" }]
  });
  assertEqual(r.ok, true, "known default");
});

test("profile defaultModel referencing provider:model passes", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["m"] }],
    profiles: [{ name: "pr", defaultModel: "p:m" }]
  });
  assertEqual(r.ok, true, "p:m default");
});

test("profile defaultModel referencing known route passes", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x", models: ["m"] }],
    routes: [{ name: "r", candidates: [{ provider: "p", model: "m" }] }],
    profiles: [{ name: "pr", defaultModel: "r" }]
  });
  assertEqual(r.ok, true, "route default");
});

test("duplicate profile name rejected", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    profiles: [
      { name: "pr", defaultModel: "m" },
      { name: "pr", defaultModel: "m" }
    ]
  });
  assertEqual(r.ok, false, "dup");
  assertHasError(r, "profiles[1].name", "dup at index 1");
});

// ---- top-level cross-refs ----

test("defaultProvider referencing missing provider flagged", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    defaultProvider: "ghost"
  });
  assertEqual(r.ok, false, "missing default");
  assertHasError(r, "defaultProvider", "missing default");
});

test("activeProfile referencing missing profile flagged", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    profiles: [{ name: "real", defaultModel: "x" }],
    activeProfile: "ghost"
  });
  assertEqual(r.ok, false, "missing active");
  assertHasError(r, "activeProfile", "missing active");
});

test("healthChecks.providers referencing missing provider flagged", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    healthChecks: { enabled: true, providers: ["ghost"] }
  });
  assertEqual(r.ok, false, "missing hc");
  assertHasError(r, "healthChecks.providers[0]", "missing hc");
});

// ---- retry / limits / history / healthChecks shape ----

test("retry.timeoutMs must be positive integer", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], retry: { timeoutMs: -1 } });
  assertEqual(r.ok, false, "negative timeout");
  assertHasError(r, "retry.timeoutMs", "negative timeout");
});

test("history.retentionDays must be in [1, 365]", () => {
  const r1 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], history: { retentionDays: 0 } });
  assertEqual(r1.ok, false, "zero");
  assertHasError(r1, "history.retentionDays", "zero");
  const r2 = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], history: { retentionDays: 1000 } });
  assertEqual(r2.ok, false, "1000");
  assertHasError(r2, "history.retentionDays", "1000");
});

test("healthChecks.intervalMinutes must be >= 5", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], healthChecks: { intervalMinutes: 1 } });
  assertEqual(r.ok, false, "1 minute");
  assertHasError(r, "healthChecks.intervalMinutes", "1 minute");
});

test("unknown key in limits is rejected", () => {
  const r = validateConfig({ providers: [{ name: "p", baseUrl: "https://x" }], limits: { weirdKey: 1 } });
  assertEqual(r.ok, false, "unknown key");
  assertHasError(r, "limits.weirdKey", "unknown key");
});

// ---- local connector consent ledger ----

test("localConnectorConsents accepts approved metadata records", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    localConnectorConsents: {
      opencode: {
        approved: true,
        approvedAt: "2026-06-14T00:00:00.000Z",
        consentVersion: "local-connector-consent.v1",
        connectorId: "opencode",
        connectorName: "OpenCode",
        credentialScope: "cli_config",
        riskLevel: "medium",
        requiredConsent: ["select_connector"],
        futureActions: ["read_cli_config"],
        reviewTags: ["cli_config"]
      }
    }
  });
  assertEqual(r.ok, true, "approved consent metadata valid");
});

test("localConnectorConsents rejects bad connector ids and unapproved records", () => {
  const r = validateConfig({
    providers: [{ name: "p", baseUrl: "https://x" }],
    localConnectorConsents: {
      "Bad ID": { approved: true },
      qclaw: { approved: false }
    }
  });
  assertEqual(r.ok, false, "bad consent ledger");
  assertHasError(r, "localConnectorConsents.Bad ID", "bad connector id");
  assertHasError(r, "localConnectorConsents.qclaw.approved", "approved must be true");
});

// ---- error message quality ----

test("every error has path + message + expected", () => {
  const r = validateConfig({
    providers: [{ name: "", baseUrl: "ftp://x", keyEnv: "sk-1234567890abcdef" }],
    routes: [{ name: "r", strategy: "junk", candidates: [] }]
  });
  if (r.ok) throw new Error("should not validate");
  for (const err of r.errors) {
    assert(typeof err.path === "string" && err.path.length > 0, `path on ${JSON.stringify(err)}`);
    assert(typeof err.message === "string" && err.message.length > 0, `message on ${JSON.stringify(err)}`);
    assert(err.expected !== undefined, `expected on ${JSON.stringify(err)}`);
  }
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
