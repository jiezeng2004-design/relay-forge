import { buildIdeProxyStartPlan } from "../src/ide-proxy-start-plan.js";

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

const basePortCheck = {
  ok: true,
  mode: "dry-run",
  proxies: [
    { id: "cursor", name: "Cursor", host: "127.0.0.1", port: 39211, listenUrl: "http://127.0.0.1:39211", relayUrl: "http://127.0.0.1:39210/v1", portStatus: "available" },
    { id: "windsurf", name: "Windsurf", host: "127.0.0.1", port: 39212, listenUrl: "http://127.0.0.1:39212", relayUrl: "http://127.0.0.1:39210/v1", portStatus: "available" },
    { id: "vscode-copilot", name: "VS Code Copilot", host: "127.0.0.1", port: 39213, listenUrl: "http://127.0.0.1:39213", relayUrl: "http://127.0.0.1:39210/v1", portStatus: "available" },
    { id: "antigravity", name: "Antigravity", host: "127.0.0.1", port: 39214, listenUrl: "http://127.0.0.1:39214", relayUrl: "http://127.0.0.1:39210/v1", portStatus: "available" }
  ]
};

test("buildIdeProxyStartPlan returns dry-run plan for four proxies", () => {
  const result = buildIdeProxyStartPlan(basePortCheck, { model: "local:model" });
  assert(result.ok === true, "ok is true");
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assertEqual(result.summary.total, 4, "summary total");
  assertEqual(result.summary.ready, 4, "summary ready");
  assertEqual(result.summary.blocked, 0, "summary blocked");
  assertEqual(result.summary.needsReview, 0, "summary needsReview");
  assertEqual(result.proxies.length, 4, "proxy count");
});

test("available ports become ready but canStartNow stays false", () => {
  const result = buildIdeProxyStartPlan(basePortCheck, { model: "local:model" });
  for (const proxy of result.proxies) {
    assertEqual(proxy.readiness, "ready", `${proxy.id} readiness`);
    assert(proxy.canStartNow === false, `${proxy.id} canStartNow false`);
    assert(proxy.dryRunCommand.includes("--dry-run"), `${proxy.id} command is dry-run`);
  }
});

test("occupied and unknown ports become blockers/review", () => {
  const result = buildIdeProxyStartPlan({
    ...basePortCheck,
    proxies: [
      { ...basePortCheck.proxies[0], portStatus: "occupied" },
      { ...basePortCheck.proxies[1], portStatus: "unknown" }
    ]
  });
  assertEqual(result.summary.ready, 0, "ready");
  assertEqual(result.summary.blocked, 1, "blocked");
  assertEqual(result.summary.needsReview, 1, "needsReview");
  assertEqual(result.proxies[0].readiness, "blocked", "occupied readiness");
  assert(result.proxies[0].blockers[0].includes("occupied"), "occupied blocker");
  assertEqual(result.proxies[1].readiness, "needs_review", "unknown readiness");
});

test("missing port check falls back to needs_port_check", () => {
  const result = buildIdeProxyStartPlan({
    proxies: [{ id: "cursor", name: "Cursor", port: 39211 }]
  });
  assertEqual(result.summary.notChecked, 1, "notChecked");
  assertEqual(result.proxies[0].readiness, "needs_port_check", "readiness");
  assert(result.proxies[0].blockers[0].includes("not been checked"), "blocker mentions check");
});

test("generatedAt can be injected", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildIdeProxyStartPlan(basePortCheck, { generatedAt: fixed });
  assertEqual(result.generatedAt, fixed, "generatedAt");
});

test("safety booleans prohibit real startup and credential/config access", () => {
  const result = buildIdeProxyStartPlan(basePortCheck);
  assert(result.safety.dryRunOnly === true, "top dryRunOnly");
  assert(result.safety.startsProxyListener === false, "top startsProxyListener false");
  assert(result.safety.readsIdeCredentials === false, "top readsIdeCredentials false");
  assert(result.safety.modifiesIdeConfig === false, "top modifiesIdeConfig false");
  assert(result.safety.writesConfig === false, "top writesConfig false");
  for (const proxy of result.proxies) {
    assert(proxy.safety.dryRunOnly === true, `${proxy.id} dryRunOnly`);
    assert(proxy.safety.startsProxyListener === false, `${proxy.id} startsProxyListener false`);
    assert(proxy.safety.readsIdeCredentials === false, `${proxy.id} readsIdeCredentials false`);
    assert(proxy.safety.modifiesIdeConfig === false, `${proxy.id} modifiesIdeConfig false`);
    assert(proxy.safety.writesConfig === false, `${proxy.id} writesConfig false`);
    assert(proxy.safety.requiresExplicitConsentBeforeRealStart === true, `${proxy.id} explicit consent`);
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
