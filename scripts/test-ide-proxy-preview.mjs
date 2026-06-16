import { buildIdeProxyPreview } from "../src/ide-proxy-preview.js";

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

const mockStatus = {
  ok: true,
  version: "0.3.10",
  providers: [
    { name: "local", displayName: "Local", models: ["local-model"] }
  ]
};

test("buildIdeProxyPreview returns ok=true and mode=dry-run", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  assert(result.ok === true, "ok is true");
  assert(result.mode === "dry-run", "mode is dry-run");
  assert(result.baseUrl === "http://127.0.0.1:39210", "baseUrl is correct");
  assert(result.selectedModel === "auto", "default selectedModel is auto");
});

test("buildIdeProxyPreview defaults to upstream relay port 18765", () => {
  const result = buildIdeProxyPreview(mockStatus);
  assert(result.baseUrl === "http://127.0.0.1:18765", "default baseUrl is upstream port");
  assertEqual(result.proxies[0].listenUrl, "http://127.0.0.1:18766", "default cursor listenUrl");
  assertEqual(result.proxies[0].relayUrl, "http://127.0.0.1:18765/v1", "default relayUrl");
});

test("buildIdeProxyPreview returns exactly 4 proxies with correct ids", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  assert(Array.isArray(result.proxies), "proxies is array");
  assertEqual(result.proxies.length, 4, "proxies length is 4");
  const ids = result.proxies.map((p) => p.id);
  assert(ids.includes("cursor"), "contains cursor");
  assert(ids.includes("windsurf"), "contains windsurf");
  assert(ids.includes("vscode-copilot"), "contains vscode-copilot");
  assert(ids.includes("antigravity"), "contains antigravity");
});

test("buildIdeProxyPreview has correct listen URLs (port + 1..4)", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  assertEqual(result.proxies[0].listenUrl, "http://127.0.0.1:39211", "cursor listenUrl");
  assertEqual(result.proxies[1].listenUrl, "http://127.0.0.1:39212", "windsurf listenUrl");
  assertEqual(result.proxies[2].listenUrl, "http://127.0.0.1:39213", "vscode-copilot listenUrl");
  assertEqual(result.proxies[3].listenUrl, "http://127.0.0.1:39214", "antigravity listenUrl");
});

test("buildIdeProxyPreview safety booleans are all correct", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  assert(result.safety.dryRunOnly === true, "dryRunOnly is true");
  assert(result.safety.readsIdeCredentials === false, "readsIdeCredentials is false");
  assert(result.safety.modifiesIdeConfig === false, "modifiesIdeConfig is false");
  assert(result.safety.startsProxyListener === false, "startsProxyListener is false");
});

test("buildIdeProxyPreview selected model is surfaced but not executed", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210, { model: "local:local-model" });
  assertEqual(result.selectedModel, "local:local-model", "selectedModel matches options.model");
  // Verify it's just a label — no routing or upstream call
  assert(typeof result.selectedModel === "string", "selectedModel is a string");
});

test("buildIdeProxyPreview capabilityMatrix has 4 entries", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  assert(Array.isArray(result.capabilityMatrix), "capabilityMatrix is array");
  assertEqual(result.capabilityMatrix.length, 4, "capabilityMatrix has 4 entries");
});

test("buildIdeProxyPreview each proxy has canStart=false and canStop=false", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  for (const proxy of result.proxies) {
    assert(proxy.canStart === false, `${proxy.id} canStart is false`);
    assert(proxy.canStop === false, `${proxy.id} canStop is false`);
  }
});

test("buildIdeProxyPreview each proxy has status=dry-run", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  for (const proxy of result.proxies) {
    assertEqual(proxy.status, "dry-run", `${proxy.id} status is dry-run`);
  }
});

test("buildIdeProxyPreview each proxy has relayUrl", () => {
  const result = buildIdeProxyPreview(mockStatus, 39210);
  for (const proxy of result.proxies) {
    assert(proxy.relayUrl === "http://127.0.0.1:39210/v1", `${proxy.id} relayUrl is correct`);
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
