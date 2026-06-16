// Provider fallback tests with real mock upstream servers.
// Verifies that when provider A is unhealthy/unavailable, the relay
// falls back to provider B, then provider C.
//
// Uses three mock upstream servers. Provider A returns 503, provider B
// returns 503, provider C returns success �?tests that the fallback chain works.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));

// ---- Three mock upstream servers ----
let mockRequests = [];

function startMock(name, port, opts = {}) {
  const { failWith } = opts;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      mockRequests.push({ url: req.url, method: req.method, body, name });
      if (failWith) {
        res.writeHead(failWith, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: `mock_${name}_error`, message: `Simulated ${failWith} from ${name}` }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-fallback-stub",
        object: "chat.completion",
        model: `fallback-model`,
        choices: [{ index: 0, message: { role: "assistant", content: `from-${name}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

const mockAPort = 15820;
const mockBPort = 15821;
const mockCPort = 15822;

// Provider A fails with 503, Provider B fails with 503, Provider C succeeds
const mockA = startMock("A", mockAPort, { failWith: 503 });
const mockB = startMock("B", mockBPort, { failWith: 503 });
const mockC = startMock("C", mockCPort);

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  profiles: [{ name: "default", defaultModel: "fallback-route" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["fallback-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: null, apiFormat: "openai", models: ["fallback-model"], allowInsecureHttp: true },
    { name: "provider-c", baseUrl: `http://127.0.0.1:${mockCPort}`, keyEnv: null, apiFormat: "openai", models: ["fallback-model"], allowInsecureHttp: true }
  ],
  routes: [
    {
      name: "fallback-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "fallback-model", weight: 1 },
        { provider: "provider-b", model: "fallback-model", weight: 1 },
        { provider: "provider-c", model: "fallback-model", weight: 1 }
      ]
    },
    {
      name: "partial-fallback",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "fallback-model", weight: 1 },
        { provider: "provider-c", model: "fallback-model", weight: 1 }
      ]
    }
  ],
  retry: {
    maxAttempts: 1,     // Only 1 attempt per provider so we test fallback, not retry
    cooldownMs: 1000,
    timeoutMs: 5000,
    streamIdleTimeoutMs: 10000
  },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-fallback-"));
const configPath = resolve(tmpRoot, "config.json");
const statePath = resolve(tmpRoot, "state.json");
const keystoreDir = resolve(tmpRoot, "keys");

await writeFile(configPath, JSON.stringify(testConfig));

const proc = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: "0",
    OPENRELAY_ALLOW_NO_AUTH: "true",
    OPENRELAY_CONFIG: configPath,
    OPENRELAY_STATE: statePath,
    OPENRELAY_KEYSTORE_DIR: keystoreDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});
proc.stderr.on("data", () => {});

const failures = [];
function check(cond, msg) {
  if (!cond) { failures.push(msg); console.log(`  FAIL ${msg}`); }
  else { console.log(`  ok  ${msg}`); }
}

function waitForRelayPort(child) {
  return new Promise((resolvePort, reject) => {
    let buffer = "";
    const timer = setTimeout(() => { cleanup(); reject(new Error("relay did not print its listening port in time")); }, 5000);
    function cleanup() { clearTimeout(timer); child.stdout.removeListener("data", onData); }
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { cleanup(); resolvePort(Number(match[1])); }
    }
    child.stdout.on("data", onData);
    child.once("error", (err) => { cleanup(); reject(err); });
    child.once("exit", (code) => { cleanup(); reject(new Error(`relay exited with code ${code}`)); });
  });
}

try {
  const port = await waitForRelayPort(proc);
  const deadline = Date.now() + 5000;
  let healthy = false;
  while (Date.now() < deadline) {
    try { const r = await testFetch(`http://127.0.0.1:${port}/health`); if (r.ok) { healthy = true; break; } } catch {}
    await sleep(100);
  }
  check(healthy, "relay becomes healthy within 5s");

  const resetMocks = () => { mockRequests = []; };

  // === Test 1: A→B→C fallback chain ===
  // Provider A returns 503, B returns 503, C returns 200
  resetMocks();
  const resp1 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fallback-route", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(resp1.status === 200, "fallback chain A→B→C returns 200");
  const body1 = await resp1.json();
  check(body1.choices[0].message.content === "from-C", "fallback succeeded: response comes from provider-C");

  const hitsA = mockRequests.filter(r => r.name === "A").length;
  const hitsB = mockRequests.filter(r => r.name === "B").length;
  const hitsC = mockRequests.filter(r => r.name === "C").length;
  check(hitsA >= 1, "provider-A was attempted (got 503)");
  check(hitsB >= 1, "provider-B was attempted (got 503)");
  check(hitsC === 1, "provider-C handled the request (got 200)");

  // === Test 2: A→C fallback (skip B) ===
  resetMocks();
  const resp2 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "partial-fallback", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(resp2.status === 200, "fallback A→C returns 200");
  const body2 = await resp2.json();
  check(body2.choices[0].message.content === "from-C", "A→C fallback: response from provider-C");

  const hitsA2 = mockRequests.filter(r => r.name === "A").length;
  const hitsC2 = mockRequests.filter(r => r.name === "C").length;
  check(hitsA2 >= 1, "partial-fallback: provider-A was attempted");
  check(hitsC2 === 1, "partial-fallback: provider-C handled the request");

  // === Test 3: All providers fail => 502 ===
  // Use a separate failing mock on a port not used by the config
  // so there's no port-reuse timing issue
  const failPort = 15823;
  const failAllServer = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      mockRequests.push({ url: req.url, method: req.method, body, name: "FAIL" });
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "mock_fail_error" }));
    });
  });
  failAllServer.listen(failPort, "127.0.0.1");
  failAllServer.unref();

  // Create a config override that uses the failing port for all providers
  const failConfig = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${failPort}`, keyEnv: null, apiFormat: "openai", models: ["fail-model"], allowInsecureHttp: true },
      { name: "provider-b", baseUrl: `http://127.0.0.1:${failPort}`, keyEnv: null, apiFormat: "openai", models: ["fail-model"], allowInsecureHttp: true }
    ],
    routes: [{ name: "all-fail-route", strategy: "fallback", candidates: [{ provider: "provider-a", model: "fail-model" }, { provider: "provider-b", model: "fail-model" }] }],
    profiles: [{ name: "default", defaultModel: "all-fail-route" }]
  };
  const tmpRootFail = await mkdtemp(resolve(tmpdir(), "openrelay-fallback-fail-"));
  const configPathFail = resolve(tmpRootFail, "config.json");
  const statePathFail = resolve(tmpRootFail, "state.json");
  const keystoreDirFail = resolve(tmpRootFail, "keys");
  await writeFile(configPathFail, JSON.stringify(failConfig));

  const procFail = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPathFail,
      OPENRELAY_STATE: statePathFail,
      OPENRELAY_KEYSTORE_DIR: keystoreDirFail
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  procFail.stderr.on("data", () => {});

  const portFail = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("fail relay did not print port")), 5000);
    const cleanup = () => { clearTimeout(timer); procFail.stdout.removeListener("data", onData); };
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { cleanup(); resolvePort(Number(m[1])); }
    };
    procFail.stdout.on("data", onData);
    procFail.once("error", (e) => { cleanup(); reject(e); });
    procFail.once("exit", (c) => { cleanup(); reject(new Error("fail relay exited " + c)); });
  });

  // Wait for health
  const deadlineFail = Date.now() + 5000;
  while (Date.now() < deadlineFail) {
    try { const r = await testFetch(`http://127.0.0.1:${portFail}/health`); if (r.ok) break; } catch {}
    await sleep(100);
  }

  resetMocks();
  const resp3 = await testFetch(`http://127.0.0.1:${portFail}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "all-fail-route", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  const resp3body = await resp3.text();
  check(resp3.status === 503, `all providers fail => returns last error status (got ${resp3.status}: ${resp3body.slice(0,120)})`);

  await killChildProcess(procFail);
  await cleanupTempDir(tmpRootFail);
  failAllServer.close();

  // === Test 4: Stream with fallback ===
  // Use a separate streaming mock on a different port
  const streamPort = 15824;
  let streamMockRequests = [];
  const streamMock = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      streamMockRequests.push({ url: req.url, method: req.method, body, name: "stream-C" });
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      });
      res.write(`data: {"id":"chatcmpl-stub","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n`);
      res.write(`data: {"id":"chatcmpl-stub","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
      res.end(`data: [DONE]\n\n`);
    });
  });
  streamMock.listen(streamPort, "127.0.0.1");
  streamMock.unref();

  const streamConfig = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["stream-model"], allowInsecureHttp: true },
      { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: null, apiFormat: "openai", models: ["stream-model"], allowInsecureHttp: true },
      { name: "provider-c", baseUrl: `http://127.0.0.1:${streamPort}`, keyEnv: null, apiFormat: "openai", models: ["stream-model"], allowInsecureHttp: true }
    ],
    routes: [{ name: "stream-route", strategy: "fallback", candidates: [
      { provider: "provider-a", model: "stream-model" },
      { provider: "provider-b", model: "stream-model" },
      { provider: "provider-c", model: "stream-model" }
    ]}],
    profiles: [{ name: "default", defaultModel: "stream-route" }]
  };
  const tmpRootStream = await mkdtemp(resolve(tmpdir(), "openrelay-fallback-stream-"));
  const configPathStream = resolve(tmpRootStream, "config.json");
  const statePathStream = resolve(tmpRootStream, "state.json");
  const keystoreDirStream = resolve(tmpRootStream, "keys");
  await writeFile(configPathStream, JSON.stringify(streamConfig));

  const procStream = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPathStream,
      OPENRELAY_STATE: statePathStream,
      OPENRELAY_KEYSTORE_DIR: keystoreDirStream
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  procStream.stderr.on("data", () => {});

  const portStream = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("stream relay did not print port")), 5000);
    const cleanup = () => { clearTimeout(timer); procStream.stdout.removeListener("data", onData); };
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { cleanup(); resolvePort(Number(m[1])); }
    };
    procStream.stdout.on("data", onData);
    procStream.once("error", (e) => { cleanup(); reject(e); });
    procStream.once("exit", (c) => { cleanup(); reject(new Error("stream relay exited " + c)); });
  });

  const deadlineStream = Date.now() + 5000;
  while (Date.now() < deadlineStream) {
    try { const r = await testFetch(`http://127.0.0.1:${portStream}/health`); if (r.ok) break; } catch {}
    await sleep(100);
  }

  streamMockRequests = [];
  const resp4 = await testFetch(`http://127.0.0.1:${portStream}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "stream-route", messages: [{ role: "user", content: "ping" }], stream: true, max_tokens: 8 })
  });
  check(resp4.status === 200, "stream with fallback returns 200");
  const text4 = await resp4.text();
  check(text4.includes("hello"), "stream response contains expected content");

  await killChildProcess(procStream);
  await cleanupTempDir(tmpRootStream);
  streamMock.close();

  // === Test 5: /v1/responses with fallback ===
  resetMocks();
  const resp5 = await testFetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fallback-route", input: "ping", stream: false, max_tokens: 8 })
  });
  check(resp5.status === 200, "responses API with fallback returns 200");

} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
  mockA.close();
  mockB.close();
  mockC.close();
}

if (failures.length > 0) {
  console.log(`\n${failures.length} test(s) failed`);
  process.exit(1);
} else {
  console.log("all passed");
}
