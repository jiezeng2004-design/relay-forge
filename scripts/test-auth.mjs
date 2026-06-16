import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOpenRelayKey, resolveRelayAuth, maskToken } from "../src/auth.js";
import { isAuthorized, isAuthorizedV1, setAuthContext } from "../src/http-helpers.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${name}: ${error.message}`);
    failed += 1;
  }
}

const rootDir = mkdtempSync(join(tmpdir(), "openrelay-auth-"));
const fakeRandom = () => Buffer.from("0123456789abcdef0123456789abcdef");
const noDisk = {
  fileExists: () => false,
  readFile: () => "",
  writeFile: () => { throw new Error("writeFile should not be called"); },
  mkdir: () => { throw new Error("mkdir should not be called"); },
  chmod: () => {}
};

test("RELAY_TOKEN remains the preferred environment token", () => {
  const auth = resolveRelayAuth({
    rootDir,
    env: { RELAY_TOKEN: "relay-token-value", OPENRELAY_TOKEN: "openrelay-token-value" },
    random: fakeRandom,
    ...noDisk
  });
  assert.equal(auth.token, "relay-token-value");
  assert.equal(auth.source, "env");
  assert.equal(auth.note, "RELAY_TOKEN from environment (openrelay compat)");
});

test("OPENRELAY_TOKEN is accepted as an upstream-compatible alias", () => {
  const auth = resolveRelayAuth({
    rootDir,
    env: { OPENRELAY_TOKEN: "openrelay-token-value" },
    random: fakeRandom,
    ...noDisk
  });
  assert.equal(auth.token, "openrelay-token-value");
  assert.equal(auth.source, "openrelay_env");
  assert.equal(auth.note, "OPENRELAY_TOKEN from environment (openrelay compat)");
  assert.match(auth.masked, /^openre/);
});

test("RELAYFORGE_TOKEN takes priority over RELAY_TOKEN and OPENRELAY_TOKEN", () => {
  const auth = resolveRelayAuth({
    rootDir,
    env: {
      RELAYFORGE_TOKEN: "relayforge-token-value",
      RELAY_TOKEN: "relay-token-value",
      OPENRELAY_TOKEN: "openrelay-token-value"
    },
    random: fakeRandom,
    ...noDisk
  });
  assert.equal(auth.token, "relayforge-token-value");
  assert.equal(auth.source, "env");
});

test("maskToken never returns full token for short inputs", () => {
  assert.notEqual(maskToken("testtoken"), "testtoken");
  assert.ok(maskToken("testtoken").includes("****"));
  assert.ok(maskToken("abcdefghijklmnop").includes("..."));
  assert.equal(maskToken(""), "");
  assert.equal(maskToken(null), "");
});

test("blank RELAY_TOKEN falls through to OPENRELAY_TOKEN", () => {
  const auth = resolveRelayAuth({
    rootDir,
    env: { RELAY_TOKEN: "  ", OPENRELAY_TOKEN: "openrelay-token-value" },
    random: fakeRandom,
    ...noDisk
  });
  assert.equal(auth.token, "openrelay-token-value");
  assert.equal(auth.source, "openrelay_env");
});

test("legacy isAuthorized fallback accepts OPENRELAY_TOKEN when no auth context is set", () => {
  const previousRelay = process.env.RELAY_TOKEN;
  const previousOpenRelay = process.env.OPENRELAY_TOKEN;
  try {
    setAuthContext(null);
    delete process.env.RELAY_TOKEN;
    process.env.OPENRELAY_TOKEN = "legacy-openrelay-token";
    assert.equal(isAuthorized({ headers: { authorization: "Bearer legacy-openrelay-token" } }), true);
    assert.equal(isAuthorized({ headers: { authorization: "Bearer wrong" } }), false);
  } finally {
    if (previousRelay === undefined) delete process.env.RELAY_TOKEN;
    else process.env.RELAY_TOKEN = previousRelay;
    if (previousOpenRelay === undefined) delete process.env.OPENRELAY_TOKEN;
    else process.env.OPENRELAY_TOKEN = previousOpenRelay;
    setAuthContext(null);
  }
});

test("parseOpenRelayKey accepts route targets and provider:model targets", () => {
  assert.deepEqual(parseOpenRelayKey("sk-or-coding-local-abcdef"), {
    target: "coding-local",
    hex: "abcdef"
  });
  assert.deepEqual(parseOpenRelayKey("sk-or-provider-b:alias-model-ABCDEF1234"), {
    target: "provider-b:alias-model",
    hex: "ABCDEF1234"
  });
  assert.deepEqual(parseOpenRelayKey("sk-or-openai:gpt-4.1-mini-abcdef1234"), {
    target: "openai:gpt-4.1-mini",
    hex: "abcdef1234"
  });
});

test("parseOpenRelayKey rejects malformed sk-or keys", () => {
  assert.equal(parseOpenRelayKey("sk-or-provider-b:-abcdef"), null);
  assert.equal(parseOpenRelayKey("sk-or-provider-b:alias-model-abcde"), null);
  assert.equal(parseOpenRelayKey("sk-or--abcdef"), null);
  assert.equal(parseOpenRelayKey("sk-or-provider-b:alias:model-abcdef"), null);
});

test("isAuthorizedV1 only self-authorizes valid sk-or keys", () => {
  try {
    setAuthContext({ token: "relay-token-value", allowNoAuth: false });
    const valid = { headers: { authorization: "Bearer sk-or-provider-b:alias-model-abcdef1234" } };
    assert.equal(isAuthorizedV1(valid), true);
    assert.equal(valid.__openrelayRouting, "sk-or-provider-b:alias-model-abcdef1234");

    const invalid = { headers: { authorization: "Bearer sk-or-provider-b:alias-model-abcde" } };
    assert.equal(isAuthorizedV1(invalid), false);
    assert.equal(invalid.__openrelayRouting, undefined);
  } finally {
    setAuthContext(null);
  }
});

if (failed > 0) {
  console.error(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
console.log(`${passed} passed, ${failed} failed`);
