// Provider direct path routing tests with real mock upstream verification.
// Uses two mock upstream servers (A and B) with the same model name,
// then asserts that /provider-b/v1/chat/completions actually hits
// server B and NOT server A.

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

// ---- Two mock upstream servers ----
let mockARequests = [];
let mockBRequests = [];

function startMock(name, port) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      if (name === "A") mockARequests.push({ url: req.url, method: req.method, body });
      else mockBRequests.push({ url: req.url, method: req.method, body });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-stub",
        object: "chat.completion",
        model: "same-model",
        choices: [{ index: 0, message: { role: "assistant", content: `from-mock-${name}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

const mockAPort = 15780;
const mockBPort = 15781;
const mockA = startMock("A", mockAPort);
const mockB = startMock("B", mockBPort);

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  profiles: [{ name: "default", defaultModel: "same-model" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["same-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: null, apiFormat: "openai", models: ["same-model"], allowInsecureHttp: true },
    { name: "local", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["local-model"], allowInsecureHttp: true }
  ],
  routes: [{ name: "default-route", candidates: [{ provider: "provider-a", model: "same-model" }] }],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-direct-route-"));
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

  // Reset mock request tracking
  const resetMocks = () => { mockARequests = []; mockBRequests = []; };

  // === Real forwarding verification ===

  // 1. POST /provider-b/v1/chat/completions â€?must hit mock B only
  resetMocks();
  const chatResp = await testFetch(`http://127.0.0.1:${port}/provider-b/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(chatResp.status === 200, "POST /provider-b/v1/chat/completions returns 200");
  const chatBody = await chatResp.json();
  check(chatBody.choices[0].message.content === "from-mock-B", "response came from mock B (content proof)");
  check(mockBRequests.length === 1, "mock B received exactly 1 request");
  check(mockARequests.length === 0, "mock A received 0 requests (correct provider routing)");

  // 2. POST /provider-b/v1/chat/completions with stream=true
  resetMocks();
  const streamResp = await testFetch(`http://127.0.0.1:${port}/provider-b/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: true, max_tokens: 8 })
  });
  check(streamResp.status === 200, "POST /provider-b/v1/chat/completions?stream returns 200");
  check(mockBRequests.length >= 1, "mock B received stream request");
  check(mockARequests.length === 0, "mock A received 0 requests (stream path)");

  // 3. POST /provider-a/v1/chat/completions â€?must hit mock A
  resetMocks();
  const chatAResp = await testFetch(`http://127.0.0.1:${port}/provider-a/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(chatAResp.status === 200, "POST /provider-a/v1/chat/completions returns 200");
  const chatABody = await chatAResp.json();
  check(chatABody.choices[0].message.content === "from-mock-A", "response came from mock A");
  check(mockARequests.length === 1, "mock A received 1 request");
  check(mockBRequests.length === 0, "mock B received 0 requests");

  // 4. GET /{provider}/v1/models
  const modelsB = await testFetch(`http://127.0.0.1:${port}/provider-b/v1/models`);
  check(modelsB.status === 200, "GET /provider-b/v1/models returns 200");
  const modelsBBody = await modelsB.json();
  check(modelsBBody.data[0].id === "provider-b:same-model", "model id is provider-b:same-model");

  // 5. Unknown provider returns 404
  const models404 = await testFetch(`http://127.0.0.1:${port}/no-such/v1/models`);
  check(models404.status === 404, "GET /no-such/v1/models returns 404");
  const models404Body = await models404.json();
  check(models404Body.error === "provider_not_found", "404 error is provider_not_found");
  check(models404Body.message.includes("no-such"), "404 message mentions provider name");

  const chat404 = await testFetch(`http://127.0.0.1:${port}/ghost/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: "ping" }] })
  });
  check(chat404.status === 404, "POST /ghost/v1/chat/completions returns 404");

  // 6. Invalid path format returns 404
  const badPath = await testFetch(`http://127.0.0.1:${port}/provider-b/v1/chat`);
  check(badPath.status === 404, "GET /provider-b/v1/chat (no completions) returns 404");

  // 7. Standard /v1/* still works
  const stdModels = await testFetch(`http://127.0.0.1:${port}/v1/models`);
  check(stdModels.status === 200, "GET /v1/models still works");
  const stdChat = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(stdChat.status === 200, "POST /v1/chat/completions still works");

  // 8. Admin paths not affected
  const adminStatus = await testFetch(`http://127.0.0.1:${port}/admin/status`);
  check(adminStatus.status === 200, "GET /admin/status still works");

  // === Auth-required test (without ALLOW_NO_AUTH) ===
  // Spawn a second relay without ALLOW_NO_AUTH to test auth gating
  mockARequests = []; mockBRequests = [];
  const tmpRoot2 = await mkdtemp(resolve(tmpdir(), "openrelay-direct-auth-"));
  const configPath2 = resolve(tmpRoot2, "config.json");
  const statePath2 = resolve(tmpRoot2, "state.json");
  const keystoreDir2 = resolve(tmpRoot2, "keys");
  await writeFile(configPath2, JSON.stringify(testConfig));

  const proc2 = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      RELAY_TOKEN: "test-token-123",
      OPENRELAY_CONFIG: configPath2,
      OPENRELAY_STATE: statePath2,
      OPENRELAY_KEYSTORE_DIR: keystoreDir2
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc2.stderr.on("data", () => {});

  const port2 = await new Promise((resolvePort, reject) => {
    let buf = "";
    const timer = setTimeout(() => { reject(new Error("relay2 did not print port")); }, 5000);
    const cleanup = () => { clearTimeout(timer); proc2.stdout.removeListener("data", onData); };
    const onData = (chunk) => {
      buf += chunk.toString();
      const m = buf.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (m) { cleanup(); resolvePort(Number(m[1])); }
    };
    proc2.stdout.on("data", onData);
    proc2.once("error", (err) => { cleanup(); reject(err); });
    proc2.once("exit", (code) => { cleanup(); reject(new Error("relay2 exited " + code)); });
  });

  // Wait for health
  const deadline2 = Date.now() + 5000;
  while (Date.now() < deadline2) {
    try { const r = await testFetch(`http://127.0.0.1:${port2}/health`); if (r.ok) break; } catch {}
    await sleep(100);
  }

  // Auth-required: no Authorization â†?401
  const unauthChat = await testFetch(`http://127.0.0.1:${port2}/provider-a/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(unauthChat.status === 401, "no auth â†?401 on direct provider path");

  const unauthModels = await testFetch(`http://127.0.0.1:${port2}/provider-a/v1/models`);
  check(unauthModels.status === 401, "no auth â†?401 on GET /provider-a/v1/models");

  // Auth-required: correct Bearer â†?non-401
  const authChat = await testFetch(`http://127.0.0.1:${port2}/provider-b/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-token-123" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }], stream: false, max_tokens: 8 })
  });
  check(authChat.status !== 401, "correct Bearer token â†?not 401 on direct path");
  check(authChat.status === 200, "correct Bearer token â†?200 on direct path");

  await killChildProcess(proc2);
  await cleanupTempDir(tmpRoot2);

} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
  mockA.close();
  mockB.close();
}

if (failures.length > 0) {
  console.log(`${failures.length} failed`);
  process.exit(1);
} else {
  console.log("all passed");
}
