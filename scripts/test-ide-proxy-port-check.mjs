import {
  buildIdeProxyPortCheck,
  clampIdeProxyPortCheckTimeout
} from "../src/ide-proxy-port-check.js";

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

test("buildIdeProxyPortCheck returns all available with injected probe", async () => {
  const result = await buildIdeProxyPortCheck(mockPreview, {
    port: 39210,
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  assert(result.ok === true, "ok is true");
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assertEqual(result.summary.total, 4, "total is 4");
  assertEqual(result.summary.available, 4, "available is 4");
  assertEqual(result.summary.occupied, 0, "occupied is 0");
  assertEqual(result.summary.unknown, 0, "unknown is 0");
});

test("buildIdeProxyPortCheck detects occupied ports", async () => {
  const result = await buildIdeProxyPortCheck(mockPreview, {
    port: 39210,
    probe: async ({ id }) => id === "cursor"
      ? { portStatus: "occupied", reason: "connect_succeeded" }
      : { portStatus: "available", reason: "connection_refused" }
  });
  assertEqual(result.summary.available, 3, "available is 3");
  assertEqual(result.summary.occupied, 1, "occupied is 1");
  assertEqual(result.proxies[0].portStatus, "occupied", "cursor is occupied");
  assertEqual(result.proxies[0].reason, "connect_succeeded", "cursor reason");
});

test("buildIdeProxyPortCheck handles unknown probe results", async () => {
  const result = await buildIdeProxyPortCheck(mockPreview, {
    probe: async ({ id }) => id === "windsurf"
      ? { portStatus: "unknown", reason: "timeout" }
      : { portStatus: "available", reason: "connection_refused" }
  });
  assertEqual(result.summary.available, 3, "available is 3");
  assertEqual(result.summary.unknown, 1, "unknown is 1");
  const windsurf = result.proxies.find((proxy) => proxy.id === "windsurf");
  assertEqual(windsurf.portStatus, "unknown", "windsurf unknown");
  assertEqual(windsurf.reason, "timeout", "windsurf timeout");
});

test("buildIdeProxyPortCheck clamps timeoutMs", async () => {
  const low = await buildIdeProxyPortCheck(mockPreview, {
    timeoutMs: 1,
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  const high = await buildIdeProxyPortCheck(mockPreview, {
    timeoutMs: 99999,
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  assertEqual(low.timeoutMs, 50, "low timeout clamps to 50");
  assertEqual(high.timeoutMs, 1000, "high timeout clamps to 1000");
  assertEqual(clampIdeProxyPortCheckTimeout("bad"), 250, "bad timeout uses default");
});

test("buildIdeProxyPortCheck generatedAt can be injected", async () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = await buildIdeProxyPortCheck(mockPreview, {
    generatedAt: fixed,
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  assertEqual(result.generatedAt, fixed, "generatedAt matches");
});

test("buildIdeProxyPortCheck safety booleans stay dry-run", async () => {
  const result = await buildIdeProxyPortCheck(mockPreview, {
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  for (const proxy of result.proxies) {
    assert(proxy.canStart === false, `${proxy.id} canStart false`);
    assert(proxy.canStop === false, `${proxy.id} canStop false`);
    assert(proxy.safety.dryRunOnly === true, `${proxy.id} dryRunOnly true`);
    assert(proxy.safety.readsIdeCredentials === false, `${proxy.id} readsIdeCredentials false`);
    assert(proxy.safety.modifiesIdeConfig === false, `${proxy.id} modifiesIdeConfig false`);
    assert(proxy.safety.startsProxyListener === false, `${proxy.id} startsProxyListener false`);
    assert(proxy.safety.writesConfig === false, `${proxy.id} writesConfig false`);
  }
});

test("buildIdeProxyPortCheck propagates selected model and planned ports", async () => {
  const result = await buildIdeProxyPortCheck(mockPreview, {
    port: 41000,
    model: "local:local-model",
    probe: async () => ({ portStatus: "available", reason: "connection_refused" })
  });
  assertEqual(result.proxies[0].port, 41001, "cursor port");
  assertEqual(result.proxies[3].port, 41004, "antigravity port");
  for (const proxy of result.proxies) {
    assertEqual(proxy.selectedModel, "local:local-model", `${proxy.id} selectedModel`);
    assert(proxy.listenUrl.startsWith("http://127.0.0.1:"), `${proxy.id} listenUrl loopback`);
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
