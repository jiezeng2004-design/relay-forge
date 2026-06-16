// Quota-aware fallback test.
// Verifies that when an upstream provider returns HTTP 429 (rate limit /
// quota exhausted), the relay immediately tries the next candidate instead
// of retrying the same provider with the next key.
//
// Uses three mock upstream servers. Provider-A returns 429, Provider-B returns
// 429, Provider-C returns success. Each provider has 3 keys and maxAttempts=3
// to prove that 429 skips the inner retry loop (1 attempt instead of 3).

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

// ---- Mock upstream servers ----
let mockRequests = [];

function startMock(name, port, opts = {}) {
  const { failWith, retryAfter } = opts;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      mockRequests.push({ url: req.url, method: req.method, body, name });
      if (failWith) {
        res.writeHead(failWith, {
          "content-type": "application/json",
          ...(retryAfter ? { "retry-after": retryAfter } : {})
        });
        res.end(JSON.stringify({ error: `mock_${name}_error`, message: `Simulated ${failWith} from ${name}` }));
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-qaf-stub",
        object: "chat.completion",
        model: "qaf-model",
        choices: [{ index: 0, message: { role: "assistant", content: `from-${name}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

const mockAPort = 15920;
const mockBPort = 15921;
const mockCPort = 15922;

const mockA = startMock("A", mockAPort, { failWith: 429, retryAfter: "60" });
const mockB = startMock("B", mockBPort, { failWith: 429, retryAfter: "60" });
const mockC = startMock("C", mockCPort);

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  profiles: [{ name: "default", defaultModel: "qaf-route" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: "TEST_KEYS_A", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: "TEST_KEYS_B", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
    { name: "provider-c", baseUrl: `http://127.0.0.1:${mockCPort}`, keyEnv: "TEST_KEYS_C", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true }
  ],
  routes: [
    {
      name: "qaf-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "qaf-model", weight: 1 },
        { provider: "provider-b", model: "qaf-model", weight: 1 },
        { provider: "provider-c", model: "qaf-model", weight: 1 }
      ]
    },
    {
      // Route for 401/403 no-fallback test: only A→C, A returns 401
      name: "auth-fallback-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "qaf-model", weight: 1 },
        { provider: "provider-c", model: "qaf-model", weight: 1 }
      ]
    }
  ],
  retry: {
    maxAttempts: 3,     // 3 keys × 3 maxAttempts �?old code would try A 3× before moving on
    cooldownMs: 5000,
    timeoutMs: 5000,
    streamIdleTimeoutMs: 10000
  },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-quota-aware-"));
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
    OPENRELAY_KEYSTORE_DIR: keystoreDir,
    TEST_KEYS_A: "k-a-1,k-a-2,k-a-3",
    TEST_KEYS_B: "k-b-1,k-b-2,k-b-3",
    TEST_KEYS_C: "k-c-1,k-c-2,k-c-3"
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

  // === Test 1: Non-stream 429 failover ===
  // Provider-A returns 429, immediately skip to B (also 429), then C (200).
  // Old code would try A 3 times (3 keys), then B 3 times, then C.
  // New code: A once �?B once �?C once.
  resetMocks();
  const resp1 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qaf-route", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(resp1.status === 200, "429 fallback: final status is 200");
  const body1 = await resp1.json();
  check(body1.choices[0].message.content === "from-C", "429 fallback: response came from provider-C");

  const hitsA = mockRequests.filter(r => r.name === "A").length;
  const hitsB = mockRequests.filter(r => r.name === "B").length;
  const hitsC = mockRequests.filter(r => r.name === "C").length;
  check(hitsA === 1, "429 fallback: provider-A was attempted exactly once (not 3×)");
  check(hitsB === 1, "429 fallback: provider-B was attempted exactly once (not 3×)");
  check(hitsC === 1, "429 fallback: provider-C handled the request exactly once");

  // Verify recentErrors contains upstream_429 entries
  const statusResp = await testFetch(`http://127.0.0.1:${port}/admin/status`);
  check(statusResp.status === 200, "admin/status returns 200");
  const statusBody = await statusResp.json();
  const errors429 = (statusBody.recentErrors || []).filter(e => e.category === "upstream_429");
  check(errors429.length >= 1, "recentErrors contains at least 1 upstream_429 entry");
  check(statusBody.providerHealth?.["provider-a"]?.rateLimited === true, "Retry-After 429 marks provider-A rateLimited");
  check(statusBody.providerHealth?.["provider-b"]?.rateLimited === true, "Retry-After 429 marks provider-B rateLimited");
  check(typeof statusBody.providerHealth?.["provider-a"]?.rateLimitedUntil === "number", "provider-A exposes rateLimitedUntil");

  resetMocks();
  const resp1b = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qaf-route", messages: [{ role: "user", content: "ping after cooldown record" }], stream: false, max_tokens: 8 })
  });
  check(resp1b.status === 200, "Retry-After cooldown: follow-up request still succeeds");
  const body1b = await resp1b.json();
  check(body1b.choices[0].message.content === "from-C", "Retry-After cooldown: follow-up request uses provider-C");
  check(mockRequests.filter(r => r.name === "A").length === 0, "Retry-After cooldown: provider-A is skipped on follow-up");
  check(mockRequests.filter(r => r.name === "B").length === 0, "Retry-After cooldown: provider-B is skipped on follow-up");
  check(mockRequests.filter(r => r.name === "C").length === 1, "Retry-After cooldown: provider-C handles follow-up once");

  // === Test 2: Stream with 429 fallback ===
  resetMocks();
  // Create a streaming mock for C on a separate port
  const streamCPort = 15923;
  let streamCRequests = [];
  const streamMockC = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      streamCRequests.push({ body: parsed });
      mockRequests.push({ url: req.url, method: req.method, body, name: "C-stream" });
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      });
      res.write(`data: {"id":"chatcmpl-qaf","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"streamed-"},"finish_reason":null}]}\n\n`);
      res.write(`data: {"id":"chatcmpl-qaf","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"from-C-stream"},"finish_reason":null}]}\n\n`);
      res.write(`data: {"id":"chatcmpl-qaf","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
      res.end(`data: [DONE]\n\n`);
    });
  });
  streamMockC.listen(streamCPort, "127.0.0.1");
  streamMockC.unref();
  await sleep(200);

  // Use a temp config that points provider-c to the streaming mock
  const streamConfig = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: "TEST_KEYS_A", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
      { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: "TEST_KEYS_B", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
      { name: "provider-c", baseUrl: `http://127.0.0.1:${streamCPort}`, keyEnv: "TEST_KEYS_C", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true }
    ]
  };
  const tmpRootStream = await mkdtemp(resolve(tmpdir(), "openrelay-qaf-stream-"));
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
      OPENRELAY_KEYSTORE_DIR: keystoreDirStream,
      TEST_KEYS_A: "k-a-1,k-a-2,k-a-3",
      TEST_KEYS_B: "k-b-1,k-b-2,k-b-3",
      TEST_KEYS_C: "k-c-1,k-c-2,k-c-3"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  procStream.stderr.on("data", () => {});

  const portStream = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("stream relay did not start")), 5000);
    function onData(chunk) {
      buf += chunk.toString("utf8");
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolvePort(Number(m[1])); }
    }
    procStream.stdout.on("data", onData);
    procStream.once("error", (e) => { clearTimeout(timer); reject(e); });
  });

  // Wait for stream relay to be healthy
  const deadline2 = Date.now() + 5000;
  let healthy2 = false;
  while (Date.now() < deadline2) {
    try { const r = await testFetch(`http://127.0.0.1:${portStream}/health`); if (r.ok) { healthy2 = true; break; } } catch {}
    await sleep(100);
  }
  check(healthy2, "stream relay becomes healthy within 5s");

  const resp2 = await testFetch(`http://127.0.0.1:${portStream}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qaf-route", messages: [{ role: "user", content: "ping stream" }], stream: true, max_tokens: 8 })
  });
  check(resp2.status === 200, "stream with 429 fallback returns 200");

  // Collect SSE chunks
  const reader2 = resp2.body.getReader();
  const decoder2 = new TextDecoder();
  let streamContent2 = "";
  let done2 = false;
  while (!done2) {
    const { value, done: d } = await reader2.read();
    done2 = d;
    if (value) streamContent2 += decoder2.decode(value, { stream: true });
  }
  check(streamContent2.includes("from-C-stream"), "stream response contains content from provider-C");

  // Clean up stream relay
  await killChildProcess(procStream);
  await cleanupTempDir(tmpRootStream);
  streamMockC.close();

  // === Test 3: /v1/responses respects existing Retry-After cooldown ===
  resetMocks();
  const resp3 = await testFetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "qaf-route", input: "ping", stream: false, max_tokens: 8 })
  });
  check(resp3.status === 200, "/v1/responses with Retry-After cooldown returns 200");

  const hitsA3 = mockRequests.filter(r => r.name === "A").length;
  const hitsB3 = mockRequests.filter(r => r.name === "B").length;
  const hitsC3 = mockRequests.filter(r => r.name === "C").length;
  check(hitsA3 === 0, "/v1/responses: provider-A skipped while rate-limited");
  check(hitsB3 === 0, "/v1/responses: provider-B skipped while rate-limited");
  check(hitsC3 === 1, "/v1/responses: provider-C handled the request");

  // === Test 4: 401/403 still cause fallback (no regression) ===
  // Using a separate relay config where provider-a returns 401
  const authFailPort = 15924;
  const authMockA = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      mockRequests.push({ url: req.url, method: req.method, body, name: "A-401" });
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
    });
  });
  authMockA.listen(authFailPort, "127.0.0.1");
  authMockA.unref();
  await sleep(200);

  resetMocks();
  const authConfig = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${authFailPort}`, keyEnv: "TEST_KEYS_A", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
      { name: "provider-c", baseUrl: `http://127.0.0.1:${mockCPort}`, keyEnv: "TEST_KEYS_C", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true }
    ],
    routes: [{
      name: "auth-fallback-route", strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "qaf-model" },
        { provider: "provider-c", model: "qaf-model" }
      ]
    }],
    profiles: [{ name: "default", defaultModel: "auth-fallback-route" }]
  };
  const tmpRootAuth = await mkdtemp(resolve(tmpdir(), "openrelay-qaf-auth-"));
  const configPathAuth = resolve(tmpRootAuth, "config.json");
  const statePathAuth = resolve(tmpRootAuth, "state.json");
  const keystoreDirAuth = resolve(tmpRootAuth, "keys");
  await writeFile(configPathAuth, JSON.stringify(authConfig));

  const procAuth = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPathAuth,
      OPENRELAY_STATE: statePathAuth,
      OPENRELAY_KEYSTORE_DIR: keystoreDirAuth,
      TEST_KEYS_A: "k-a-1,k-a-2,k-a-3",
      TEST_KEYS_C: "k-c-1,k-c-2,k-c-3"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  procAuth.stderr.on("data", () => {});

  const portAuth = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("auth relay did not start")), 5000);
    function onData(chunk) {
      buf += chunk.toString("utf8");
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolvePort(Number(m[1])); }
    }
    procAuth.stdout.on("data", onData);
    procAuth.once("error", (e) => { clearTimeout(timer); reject(e); });
  });

  const deadline4 = Date.now() + 5000;
  let healthy4 = false;
  while (Date.now() < deadline4) {
    try { const r = await testFetch(`http://127.0.0.1:${portAuth}/health`); if (r.ok) { healthy4 = true; break; } } catch {}
    await sleep(100);
  }
  check(healthy4, "auth relay becomes healthy");

  const resp4 = await testFetch(`http://127.0.0.1:${portAuth}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "auth-fallback-route", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(resp4.status === 200, "401 no regression: final status is 200");
  const body4 = await resp4.json();
  check(body4.choices[0].message.content === "from-C", "401 no regression: response came from provider-C (A 401→fallback)");

  // Verify A was attempted (got 401) and C succeeded
  const hitsA4 = mockRequests.filter(r => r.name === "A-401").length;
  const hitsC4 = mockRequests.filter(r => r.name === "C").length;
  check(hitsA4 === 1, "401 no regression: provider-A was attempted and got 401");
  check(hitsC4 >= 1, "401 no regression: provider-C handled the request");

  // Cleanup auth relay
  await killChildProcess(procAuth);
  await cleanupTempDir(tmpRootAuth);
  authMockA.close();

  // === Test 5: All providers return 429 => final error ===
  resetMocks();
  // We need a config where all providers return 429. We already have A and B
  // returning 429. We can create a new config for this.
  const all429Config = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: "TEST_KEYS_A", apiFormat: "openai", models: ["fail-model"], allowInsecureHttp: true },
      { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: "TEST_KEYS_B", apiFormat: "openai", models: ["fail-model"], allowInsecureHttp: true }
    ],
    routes: [{
      name: "all-429-route", strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "fail-model" },
        { provider: "provider-b", model: "fail-model" }
      ]
    }],
    profiles: [{ name: "default", defaultModel: "all-429-route" }]
  };
  const tmpRoot429 = await mkdtemp(resolve(tmpdir(), "openrelay-all429-"));
  const configPath429 = resolve(tmpRoot429, "config.json");
  const statePath429 = resolve(tmpRoot429, "state.json");
  const keystoreDir429 = resolve(tmpRoot429, "keys");
  await writeFile(configPath429, JSON.stringify(all429Config));

  const proc429 = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPath429,
      OPENRELAY_STATE: statePath429,
      OPENRELAY_KEYSTORE_DIR: keystoreDir429,
      TEST_KEYS_A: "k-a-1,k-a-2,k-a-3",
      TEST_KEYS_B: "k-b-1,k-b-2,k-b-3"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc429.stderr.on("data", () => {});

  const port429 = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("all-429 relay did not start")), 5000);
    function onData(chunk) {
      buf += chunk.toString("utf8");
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { clearTimeout(timer); resolvePort(Number(m[1])); }
    }
    proc429.stdout.on("data", onData);
    proc429.once("error", (e) => { clearTimeout(timer); reject(e); });
  });

  const deadline5 = Date.now() + 5000;
  let healthy5 = false;
  while (Date.now() < deadline5) {
    try { const r = await testFetch(`http://127.0.0.1:${port429}/health`); if (r.ok) { healthy5 = true; break; } } catch {}
    await sleep(100);
  }
  check(healthy5, "all-429 relay becomes healthy");

  const resp5 = await testFetch(`http://127.0.0.1:${port429}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "all-429-route", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(resp5.status >= 429 && resp5.status < 600, "all providers 429 returns error status (got " + resp5.status + ")");

  // Verify upstream_429 entries exist
  const status429Resp = await testFetch(`http://127.0.0.1:${port429}/admin/status`);
  const status429Body = await status429Resp.json();
  const errors429all = (status429Body.recentErrors || []).filter(e => e.category === "upstream_429");
  check(errors429all.length >= 1, "all-429: recentErrors contains upstream_429 entries");

  // Cleanup all-429 relay
  await killChildProcess(proc429);
  await cleanupTempDir(tmpRoot429);

  // === Test 6: Local per-model daily limit skips one candidate and falls back ===
  const modelLimitAPort = 15925;
  const modelLimitCPort = 15926;
  const modelLimitMockA = startMock("ML-A", modelLimitAPort);
  const modelLimitMockC = startMock("ML-C", modelLimitCPort);
  await sleep(200);

  resetMocks();
  const modelLimitConfig = {
    ...testConfig,
    providers: [
      { name: "provider-a", baseUrl: `http://127.0.0.1:${modelLimitAPort}`, keyEnv: "TEST_KEYS_A", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true },
      { name: "provider-c", baseUrl: `http://127.0.0.1:${modelLimitCPort}`, keyEnv: "TEST_KEYS_C", apiFormat: "openai", models: ["qaf-model"], allowInsecureHttp: true }
    ],
    routes: [{
      name: "model-limit-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "qaf-model" },
        { provider: "provider-c", model: "qaf-model" }
      ]
    }],
    profiles: [{ name: "default", defaultModel: "model-limit-route" }],
    limits: {
      models: {
        "provider-a:qaf-model": { dailyRequests: 1 }
      }
    }
  };
  const tmpRootModelLimit = await mkdtemp(resolve(tmpdir(), "openrelay-model-limit-"));
  const configPathModelLimit = resolve(tmpRootModelLimit, "config.json");
  const statePathModelLimit = resolve(tmpRootModelLimit, "state.json");
  const keystoreDirModelLimit = resolve(tmpRootModelLimit, "keys");
  await writeFile(configPathModelLimit, JSON.stringify(modelLimitConfig));

  const procModelLimit = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPathModelLimit,
      OPENRELAY_STATE: statePathModelLimit,
      OPENRELAY_KEYSTORE_DIR: keystoreDirModelLimit,
      TEST_KEYS_A: "k-a-1",
      TEST_KEYS_C: "k-c-1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  procModelLimit.stderr.on("data", () => {});

  const portModelLimit = await waitForRelayPort(procModelLimit);
  const deadline6 = Date.now() + 5000;
  let healthy6 = false;
  while (Date.now() < deadline6) {
    try { const r = await testFetch(`http://127.0.0.1:${portModelLimit}/health`); if (r.ok) { healthy6 = true; break; } } catch {}
    await sleep(100);
  }
  check(healthy6, "model-limit relay becomes healthy");

  const modelLimitResp1 = await testFetch(`http://127.0.0.1:${portModelLimit}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "model-limit-route", messages: [{ role: "user", content: "first" }], stream: false, max_tokens: 8 })
  });
  check(modelLimitResp1.status === 200, "model limit: first request succeeds");
  const modelLimitBody1 = await modelLimitResp1.json();
  check(modelLimitBody1.choices[0].message.content === "from-ML-A", "model limit: first request uses provider-A");

  const modelLimitResp2 = await testFetch(`http://127.0.0.1:${portModelLimit}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "model-limit-route", messages: [{ role: "user", content: "second" }], stream: false, max_tokens: 8 })
  });
  check(modelLimitResp2.status === 200, "model limit: second request falls back and succeeds");
  const modelLimitBody2 = await modelLimitResp2.json();
  check(modelLimitBody2.choices[0].message.content === "from-ML-C", "model limit: second request uses provider-C after provider-A model is limited");

  const hitsMLA = mockRequests.filter(r => r.name === "ML-A").length;
  const hitsMLC = mockRequests.filter(r => r.name === "ML-C").length;
  check(hitsMLA === 1, "model limit: provider-A model was attempted exactly once");
  check(hitsMLC === 1, "model limit: provider-C handled exactly one fallback request");

  const statusModelLimitResp = await testFetch(`http://127.0.0.1:${portModelLimit}/admin/status`);
  const statusModelLimitBody = await statusModelLimitResp.json();
  check(statusModelLimitBody.usage?.limits?.models?.["provider-a:qaf-model"]?.dailyRequests === 1, "model limit: admin/status exposes configured model limit");
  check(statusModelLimitBody.usage?.daily?.models?.["provider-a:qaf-model"] === 1, "model limit: daily usage records provider:model attempts");
  const localModelLimitErrors = (statusModelLimitBody.recentErrors || []).filter(e =>
    e.category === "local_limit" && /local_model_limit_exceeded/.test(e.error || e.message || "")
  );
  check(localModelLimitErrors.length >= 1, "model limit: recentErrors records local model limit hit");

  await killChildProcess(procModelLimit);
  await cleanupTempDir(tmpRootModelLimit);
  modelLimitMockA.close();
  modelLimitMockC.close();

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
