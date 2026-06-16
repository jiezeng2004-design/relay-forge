// Model alias tests with mock upstream verification.
// Tests that config.modelAliases correctly routes user-requested model
// names to provider:model or route targets.
//
// Uses two mock upstream servers: alias resolution should hit the
// correct provider even though the user requested a different model name.

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

function startMock(name, port) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      mockRequests.push({ url: req.url, method: req.method, body, name });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-alias-stub",
        object: "chat.completion",
        model: `alias-mock-${name}`,
        choices: [{ index: 0, message: { role: "assistant", content: `from-${name}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

const mockAPort = 15810;
const mockBPort = 15811;
const mockCPort = 15812;
const mockA = startMock("A", mockAPort);
const mockB = startMock("B", mockBPort);

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  modelAliases: {
    "gpt-4-mini": "provider-b:alias-model",       // direct provider:model alias
    "fast-chat": "alias-route",                     // alias pointing to a route name
    "my-default": "provider-a:alias-model",          // alias pointing to provider-a
    "claude-mini": "anthropic-provider:claude-model" // alias for anthropic-format provider
  },
  profiles: [{ name: "default", defaultModel: "fast-chat" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["alias-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: null, apiFormat: "openai", models: ["alias-model"], allowInsecureHttp: true },
    { name: "anthropic-provider", baseUrl: `http://127.0.0.1:${mockCPort}`, keyEnv: null, apiFormat: "openai", models: ["claude-model"], allowInsecureHttp: true }
  ],
  routes: [
    { name: "alias-route", candidates: [{ provider: "provider-b", model: "alias-model" }] },
    { name: "default-route", candidates: [{ provider: "provider-a", model: "alias-model" }] }
  ],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-model-alias-"));
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
proc.stderr.on("data", (chunk) => { console.error("relay stderr:", chunk.toString()); });

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

  // === Test 1: modelAlias pointing to provider:model ===
  // User requests "gpt-4-mini" â†?alias resolves to "provider-b:alias-model"
  resetMocks();
  const resp1 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4-mini", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp1.status === 200, "POST /v1/chat/completions with model alias returns 200");
  const body1 = await resp1.json();
  check(body1.choices[0].message.content === "from-B", "alias 'gpt-4-mini' resolved to provider-b (content proof)");
  const hitsB = mockRequests.filter(r => r.name === "B").length;
  const hitsA = mockRequests.filter(r => r.name === "A").length;
  check(hitsB === 1, "alias 'gpt-4-mini' â†?provider-b got exactly 1 request");
  check(hitsA === 0, "alias 'gpt-4-mini' â†?provider-a got 0 requests");

  // === Test 2: modelAlias pointing to a route name ===
  // "fast-chat" â†?alias-route â†?provider-b
  resetMocks();
  const resp2 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fast-chat", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp2.status === 200, "alias pointing to route name returns 200");
  const body2 = await resp2.json();
  check(body2.choices[0].message.content === "from-B", "alias 'fast-chat' â†?route 'alias-route' â†?provider-b (content proof)");

  // === Test 3: modelAlias with stream request ===
  resetMocks();
  const resp3 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "gpt-4-mini", messages: [{ role: "user", content: "hello" }], stream: true, max_tokens: 8 })
  });
  check(resp3.status === 200, "alias with stream=true returns 200");

  // === Test 4: Alias with explicit provider:model syntax ===
  // "my-default" â†?"provider-a:alias-model" â†?direct route to provider-a
  resetMocks();
  const resp4 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "my-default", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp4.status === 200, "alias 'my-default' returns 200");
  const body4 = await resp4.json();
  check(body4.choices[0].message.content === "from-A", "alias 'my-default' â†?provider-a:alias-model â†?provider-a");

  // === Test 5: Direct model name without alias still works ===
  resetMocks();
  const resp5 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "alias-model", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp5.status === 200, "direct model name (no alias) returns 200");
  const body5 = await resp5.json();
  check(body5.choices[0].message.content === "from-A", "direct model name resolves to defaultProvider");

  // === Test 6: model alias with Anthropic messages endpoint ===
  // Alias "claude-mini" â†?"anthropic-provider:claude-model"
  // The relay converts Anthropic message format â†?OpenAI chat format for upstream,
  // so the mock responds in OpenAI format. The upstream model should be "claude-model".
  resetMocks();
  let mockCRequests = [];
  const mockC = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      mockCRequests.push({ url: req.url, method: req.method, body: parsed });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-c-stub",
        object: "chat.completion",
        model: parsed.model || "unknown",
        choices: [{ index: 0, message: { role: "assistant", content: "from-anthropic-provider" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  mockC.listen(mockCPort, "127.0.0.1");
  mockC.unref();

  await sleep(200); // let mockC start

  const resp6 = await testFetch(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "claude-mini",
      messages: [{ role: "user", content: "hello from messages" }],
      max_tokens: 50
    })
  });
  check(resp6.status === 200, "POST /v1/messages with model alias returns 200");
  const body6 = await resp6.json();
  check(body6.content !== undefined, "anthropic messages response has content");
  check(body6.content[0]?.text === "from-anthropic-provider" || body6.choices?.[0]?.message?.content === "from-anthropic-provider",
    "alias 'claude-mini' â†?anthropic-provider (response content proof)");

  // Verify upstream (mockC) received the mapped model, not the alias
  const reqToC = mockCRequests.find(r => r.body && r.body.model === "claude-model");
  check(reqToC !== undefined, "alias 'claude-mini' â†?mockC received upstream model 'claude-model'");
  const reqAlias = mockCRequests.find(r => r.body && r.body.model === "claude-mini");
  check(reqAlias === undefined, "alias 'claude-mini' â†?mockC did NOT receive alias name as upstream model");

  // Also verify the alias is exposed in admin/config
  const configResp = await testFetch(`http://127.0.0.1:${port}/admin/config`);
  check(configResp.status === 200, "admin/config returns 200 after alias test");
  const configBody = await configResp.json();
  check(configBody.modelAliases !== undefined, "admin/config includes modelAliases field");
  check(configBody.modelAliases["claude-mini"] === "anthropic-provider:claude-model", "admin/config modelAliases['claude-mini'] preserved");

  mockC.close();

} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
  mockA.close();
  mockB.close();
  try { if (typeof mockC !== "undefined") mockC.close(); } catch {}
}

if (failures.length > 0) {
  console.log(`\n${failures.length} test(s) failed`);
  process.exit(1);
} else {
  console.log("all passed");
}
