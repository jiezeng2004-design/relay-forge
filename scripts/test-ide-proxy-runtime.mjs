import { buildIdeProxyRuntimeStatus } from "../src/ide-proxy-runtime.js";

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

const mockPreview = {
  ok: true,
  mode: "dry-run",
  baseUrl: "http://127.0.0.1:39210",
  selectedModel: "auto",
  proxies: [
    { id: "cursor", name: "Cursor" },
    { id: "windsurf", name: "Windsurf" },
    { id: "vscode-copilot", name: "VS Code Copilot" },
    { id: "antigravity", name: "Antigravity" }
  ]
};

test("buildIdeProxyRuntimeStatus returns ok=true and mode=dry-run", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  assert(result.ok === true, "ok is true");
  assert(result.mode === "dry-run", "mode is dry-run");
  assert(result.dryRunOnly === true, "dryRunOnly is true");
});

test("buildIdeProxyRuntimeStatus returns exactly 4 proxies with correct ids", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  assert(Array.isArray(result.proxies), "proxies is array");
  assertEqual(result.proxies.length, 4, "proxies length is 4");
  const ids = result.proxies.map((p) => p.id);
  assert(ids.includes("cursor"), "contains cursor");
  assert(ids.includes("windsurf"), "contains windsurf");
  assert(ids.includes("vscode-copilot"), "contains vscode-copilot");
  assert(ids.includes("antigravity"), "contains antigravity");
});

test("buildIdeProxyRuntimeStatus summary total/running/stopped/error is correct", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  assertEqual(result.summary.total, 4, "summary.total is 4");
  assertEqual(result.summary.running, 0, "summary.running is 0");
  assertEqual(result.summary.stopped, 4, "summary.stopped is 4");
  assertEqual(result.summary.error, 0, "summary.error is 0");
});

test("buildIdeProxyRuntimeStatus all proxies have status=stopped and phase=preview-only", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  for (const proxy of result.proxies) {
    assertEqual(proxy.status, "stopped", `${proxy.id} status is stopped`);
    assertEqual(proxy.phase, "preview-only", `${proxy.id} phase is preview-only`);
  }
});

test("buildIdeProxyRuntimeStatus safety booleans are correct", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  for (const proxy of result.proxies) {
    assert(proxy.safety.dryRunOnly === true, `${proxy.id} safety.dryRunOnly is true`);
    assert(proxy.safety.readsIdeCredentials === false, `${proxy.id} safety.readsIdeCredentials is false`);
    assert(proxy.safety.modifiesIdeConfig === false, `${proxy.id} safety.modifiesIdeConfig is false`);
    assert(proxy.safety.startsProxyListener === false, `${proxy.id} safety.startsProxyListener is false`);
  }
});

test("buildIdeProxyRuntimeStatus selected model propagates", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview, { model: "local:local-model" });
  for (const proxy of result.proxies) {
    assertEqual(proxy.selectedModel, "local:local-model", `${proxy.id} selectedModel matches`);
  }
});

test("buildIdeProxyRuntimeStatus each proxy has canStart=false and canStop=false", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  for (const proxy of result.proxies) {
    assert(proxy.canStart === false, `${proxy.id} canStart is false`);
    assert(proxy.canStop === false, `${proxy.id} canStop is false`);
  }
});

test("buildIdeProxyRuntimeStatus each proxy has pid=null and startedAt=null and lastError=null", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  for (const proxy of result.proxies) {
    assertEqual(proxy.pid, null, `${proxy.id} pid is null`);
    assertEqual(proxy.startedAt, null, `${proxy.id} startedAt is null`);
    assertEqual(proxy.lastError, null, `${proxy.id} lastError is null`);
  }
});

test("buildIdeProxyRuntimeStatus generatedAt is ISO string", () => {
  const result = buildIdeProxyRuntimeStatus(mockPreview);
  assert(typeof result.generatedAt === "string", "generatedAt is a string");
  assert(!isNaN(Date.parse(result.generatedAt)), "generatedAt is parseable as ISO date");
});

test("buildIdeProxyRuntimeStatus generatedAt can be injected via options", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildIdeProxyRuntimeStatus(mockPreview, { generatedAt: fixed });
  assertEqual(result.generatedAt, fixed, "generatedAt matches injected value");
});

test("buildIdeProxyRuntimeStatus works without preview input", () => {
  const result = buildIdeProxyRuntimeStatus(null);
  assert(result.ok === true, "ok is true with null preview");
  assertEqual(result.proxies.length, 4, "proxies length is 4 with null preview");
  assertEqual(result.summary.total, 4, "summary.total is 4 with null preview");
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
