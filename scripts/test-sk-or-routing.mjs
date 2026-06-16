// sk-or routing-key integration tests.
// Verifies that upstream-compatible routing keys can target either a
// named route or an explicit provider:model pair.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  closeServer,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await readFile(resolve(rootDir, "package.json"), "utf8");

function startMock(name) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body || "{}"); } catch {}
      requests.push({ name, url: req.url, method: req.method, body: parsed });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: `chatcmpl-sk-or-${name}`,
        object: "chat.completion",
        model: parsed.model || "unknown",
        choices: [{ index: 0, message: { role: "assistant", content: `from-${name}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 }
      }));
    });
  });
  return new Promise((resolveServer) => {
    server.listen(0, "127.0.0.1", () => {
      server.unref();
      resolveServer({ server, port: server.address().port, requests });
    });
  });
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

const failures = [];
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  } else {
    console.log(`  ok  ${msg}`);
  }
}

const mockA = await startMock("A");
const mockB = await startMock("B");
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-sk-or-routing-"));
const configPath = resolve(tmpRoot, "config.json");
const statePath = resolve(tmpRoot, "state.json");
const keystoreDir = resolve(tmpRoot, "keys");

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  profiles: [{ name: "default", defaultModel: "default-route" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockA.port}`, keyEnv: null, apiFormat: "openai", models: ["same-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockB.port}`, keyEnv: null, apiFormat: "openai", models: ["alias-model"], allowInsecureHttp: true }
  ],
  routes: [
    { name: "default-route", candidates: [{ provider: "provider-a", model: "same-model" }] }
  ],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

await writeFile(configPath, JSON.stringify(testConfig), "utf8");

const proc = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: "0",
    RELAY_TOKEN: "test-admin-token",
    OPENRELAY_ALLOW_NO_AUTH: "false",
    OPENRELAY_CONFIG: configPath,
    OPENRELAY_STATE: statePath,
    OPENRELAY_KEYSTORE_DIR: keystoreDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});
proc.stderr.on("data", () => {});

try {
  const port = await waitForRelayPort(proc);
  const deadline = Date.now() + 5000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const r = await testFetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) { healthy = true; break; }
    } catch {}
    await sleep(100);
  }
  check(healthy, "relay becomes healthy within 5s");

  const resetMocks = () => {
    mockA.requests.length = 0;
    mockB.requests.length = 0;
  };

  resetMocks();
  const unauth = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "default-route", messages: [{ role: "user", content: "ping" }] })
  });
  check(unauth.status === 401, "missing Authorization is rejected when relay auth is enabled");

  resetMocks();
  const invalid = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-or-provider-b:alias-model-abcde" },
    body: JSON.stringify({ model: "default-route", messages: [{ role: "user", content: "ping" }] })
  });
  check(invalid.status === 401, "malformed sk-or key is rejected");
  check(mockA.requests.length === 0 && mockB.requests.length === 0, "malformed sk-or key does not reach upstream");

  resetMocks();
  const normal = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-admin-token" },
    body: JSON.stringify({ model: "same-model", messages: [{ role: "user", content: "ping" }] })
  });
  check(normal.status === 200, "regular relay token still works");
  const normalBody = await normal.json();
  check(normalBody.choices?.[0]?.message?.content === "from-A", "regular relay token routes by request model");
  check(mockA.requests.length === 1 && mockB.requests.length === 0, "regular relay token hit provider-a only");

  resetMocks();
  const providerModel = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-or-provider-b:alias-model-abcdef1234" },
    body: JSON.stringify({ model: "ignored-model", messages: [{ role: "user", content: "ping" }] })
  });
  check(providerModel.status === 200, "sk-or provider:model key returns 200");
  const providerModelBody = await providerModel.json();
  check(providerModelBody.choices?.[0]?.message?.content === "from-B", "sk-or provider:model key hit provider-b");
  check(mockA.requests.length === 0 && mockB.requests.length === 1, "sk-or provider:model did not hit provider-a");
  check(mockB.requests[0]?.body?.model === "alias-model", "provider-b received upstream model alias-model");

  resetMocks();
  const routeKey = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer sk-or-default-route-abcdef1234" },
    body: JSON.stringify({ model: "ignored-model", messages: [{ role: "user", content: "ping" }] })
  });
  check(routeKey.status === 200, "sk-or route key returns 200");
  const routeBody = await routeKey.json();
  check(routeBody.choices?.[0]?.message?.content === "from-A", "sk-or route key hit provider-a");
  check(mockA.requests.length === 1 && mockB.requests.length === 0, "sk-or route key did not hit provider-b");
  check(mockA.requests[0]?.body?.model === "same-model", "provider-a received route candidate model same-model");
} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
  await closeServer(mockA.server);
  await closeServer(mockB.server);
}

if (failures.length > 0) {
  console.log(`${failures.length} failed`);
  process.exit(1);
}

console.log("all passed");
