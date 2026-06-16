import { buildLocalConnectorPlan } from "../src/local-connector-plan.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

test("buildLocalConnectorPlan returns exactly 11 connectors", () => {
  const result = buildLocalConnectorPlan();
  assertEqual(result.connectors.length, 11, "connector count is 11");
  assertEqual(result.summary.total, 11, "summary total is 11");
});

test("all required connector ids are present", () => {
  const result = buildLocalConnectorPlan();
  const ids = result.connectors.map((c) => c.id).sort();
  const expected = [
    "antigravity", "claude-code", "claude-desktop", "gemini-cli",
    "kiro", "opencode", "openai-codex", "qclaw", "rovo-dev",
    "vscode-copilot", "windsurf"
  ].sort();
  assertEqual(JSON.stringify(ids), JSON.stringify(expected), "all 11 connector ids match");
});

test("summary counts are correct (all planned, 0 implemented)", () => {
  const result = buildLocalConnectorPlan();
  assertEqual(result.summary.total, 11, "total");
  assertEqual(result.summary.planned, 11, "planned");
  assertEqual(result.summary.implemented, 0, "implemented");
  assertEqual(result.summary.credentialReads, 0, "credentialReads");
  assertEqual(result.summary.configWrites, 0, "configWrites");
});

test("platform selection works for windows", () => {
  const result = buildLocalConnectorPlan({ platform: "windows" });
  assertEqual(result.platform, "windows", "platform is windows");
  for (const c of result.connectors) {
    if (c.id === "claude-desktop") {
      assert(c.availableOnSelectedPlatform === true, "claude-desktop available on windows");
    }
  }
});

test("platform selection works for linux", () => {
  const result = buildLocalConnectorPlan({ platform: "linux" });
  assertEqual(result.platform, "linux", "platform is linux");
  for (const c of result.connectors) {
    if (c.id === "claude-desktop") {
      assert(c.availableOnSelectedPlatform === false, "claude-desktop not available on linux");
    }
    if (c.id === "claude-code") {
      assert(c.availableOnSelectedPlatform === true, "claude-code available on linux");
    }
  }
});

test("platform selection works for darwin", () => {
  const result = buildLocalConnectorPlan({ platform: "darwin" });
  assertEqual(result.platform, "darwin", "platform is darwin");
});

test("all safety booleans prevent credential/config/listener actions", () => {
  const result = buildLocalConnectorPlan();
  const top = result.safety;
  assert(top.dryRunOnly === true, "top dryRunOnly");
  assert(top.readsTokens === false, "top readsTokens false");
  assert(top.readsCookies === false, "top readsCookies false");
  assert(top.readsSessionStorage === false, "top readsSessionStorage false");
  assert(top.readsBrowserProfiles === false, "top readsBrowserProfiles false");
  assert(top.readsIdeCredentials === false, "top readsIdeCredentials false");
  assert(top.modifiesConfig === false, "top modifiesConfig false");
  assert(top.writesSystemEnv === false, "top writesSystemEnv false");
  assert(top.startsNetworkListener === false, "top startsNetworkListener false");
  for (const c of result.connectors) {
    const s = c.safety;
    assert(s.dryRunOnly === true, `${c.id} dryRunOnly`);
    assert(s.readsTokens === false, `${c.id} readsTokens false`);
    assert(s.readsCookies === false, `${c.id} readsCookies false`);
    assert(s.readsSessionStorage === false, `${c.id} readsSessionStorage false`);
    assert(s.readsBrowserProfiles === false, `${c.id} readsBrowserProfiles false`);
    assert(s.readsIdeCredentials === false, `${c.id} readsIdeCredentials false`);
    assert(s.modifiesConfig === false, `${c.id} modifiesConfig false`);
    assert(s.writesSystemEnv === false, `${c.id} writesSystemEnv false`);
    assert(s.startsNetworkListener === false, `${c.id} startsNetworkListener false`);
  }
});

test("generatedAt can be injected", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildLocalConnectorPlan({ generatedAt: fixed });
  assertEqual(result.generatedAt, fixed, "generatedAt injected");
});

test("version can be injected", () => {
  const result = buildLocalConnectorPlan({ version: "0.3.15-test" });
  assertEqual(result.version, "0.3.15-test", "version injected");
});

test("mode is dry-run, dryRunOnly is true", () => {
  const result = buildLocalConnectorPlan();
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assert(result.dryRunOnly === true, "dryRunOnly is true");
});

test("each connector has requiredConsent and nextSteps arrays", () => {
  const result = buildLocalConnectorPlan();
  for (const c of result.connectors) {
    assert(Array.isArray(c.requiredConsent) && c.requiredConsent.length > 0, `${c.id} has requiredConsent`);
    assert(Array.isArray(c.nextSteps) && c.nextSteps.length > 0, `${c.id} has nextSteps`);
  }
});

test("each connector has kind, credentialSource, upstreamStatus, localStatus, platforms", () => {
  const result = buildLocalConnectorPlan();
  for (const c of result.connectors) {
    assert(typeof c.kind === "string", `${c.id} has kind`);
    assert(typeof c.credentialSource === "string", `${c.id} has credentialSource`);
    assert(typeof c.upstreamStatus === "string", `${c.id} has upstreamStatus`);
    assert(typeof c.localStatus === "string", `${c.id} has localStatus`);
    assert(Array.isArray(c.platforms), `${c.id} has platforms array`);
    assert(typeof c.availableOnSelectedPlatform === "boolean", `${c.id} has availableOnSelectedPlatform`);
    assert(c.readsCredentials === false, `${c.id} readsCredentials false`);
    assert(c.modifiesAppConfig === false, `${c.id} modifiesAppConfig false`);
    assert(c.startsGateway === false, `${c.id} startsGateway false`);
  }
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
