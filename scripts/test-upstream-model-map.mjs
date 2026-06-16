// Upstream model mapping test.
// Verifies that the user-requested model name can differ from the
// upstream model sent to the provider. This is core to the route system:
// a route candidate specifies both provider AND upstream model, allowing
// transparent model renaming/mapping.
//
// Uses two mock upstream servers. The route maps user request model "fast-model"
// to upstream model "deep-model" on provider B. The test verifies that:
// 1. Provider B receives the upstream model name in its request body
// 2. Provider A (which has "fast-model" directly) still works for direct requests
// 3. Stream requests also send the mapped model name upstream

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
      const parsed = JSON.parse(body || "{}");
      mockRequests.push({
        url: req.url, method: req.method, name,
        receivedModel: parsed.model,
        userModel: parsed.user_model,
        body: parsed
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-map-stub",
        object: "chat.completion",
        model: parsed.model || "unknown",
        choices: [{ index: 0, message: { role: "assistant", content: `from-${name}-via-${parsed.model}` }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  server.listen(port, "127.0.0.1");
  server.unref();
  return server;
}

const mockAPort = 15830;
const mockBPort = 15831;
const streamMockPort = 15832;
const mockA = startMock("A", mockAPort);
const mockB = startMock("B", mockBPort);

// Streaming mock server â€?listens from the start but is only hit when
// the stream-rename route directs stream requests here.
let streamMockRequests = [];
function startStreamMock() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => body += c);
    req.on("end", () => {
      const parsed = JSON.parse(body || "{}");
      streamMockRequests.push({ receivedModel: parsed.model, body: parsed });
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      });
      res.write(`data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"streamed-"},"finish_reason":null}]}\n\n`);
      res.write(`data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":"from-deep-stream-model"},"finish_reason":null}]}\n\n`);
      res.write(`data: {"id":"chatcmpl-stream","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
      res.end(`data: [DONE]\n\n`);
    });
  });
  server.listen(streamMockPort, "127.0.0.1");
  server.unref();
  return server;
}
const streamMock = startStreamMock();

const testConfig = {
  defaultProvider: "provider-a",
  activeProfile: "default",
  profiles: [{ name: "default", defaultModel: "mapped-route" }],
  providers: [
    { name: "provider-a", baseUrl: `http://127.0.0.1:${mockAPort}`, keyEnv: null, apiFormat: "openai", models: ["fast-model", "slow-model"], allowInsecureHttp: true },
    { name: "provider-b", baseUrl: `http://127.0.0.1:${mockBPort}`, keyEnv: null, apiFormat: "openai", models: ["deep-model", "fast-model"], allowInsecureHttp: true },
    { name: "provider-stream", baseUrl: `http://127.0.0.1:${streamMockPort}`, keyEnv: null, apiFormat: "openai", models: ["deep-stream-model"], allowInsecureHttp: true }
  ],
  routes: [
    {
      // User requests "fast-model", but upstream model is "deep-model" on provider-b
      name: "mapped-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-a", model: "fast-model", weight: 1 },   // same name, no mapping
        { provider: "provider-b", model: "deep-model", weight: 1 }    // mapped: user "fast-model" â†?upstream "deep-model"
      ]
    },
    {
      // Route that maps a user model to a completely different upstream model
      name: "rename-route",
      strategy: "fallback",
      candidates: [
        { provider: "provider-b", model: "deep-model", weight: 1 }
      ]
    },
    {
      // Route for stream testing: user "stream-me" â†?upstream "deep-stream-model"
      name: "stream-me",
      strategy: "fallback",
      candidates: [
        { provider: "provider-stream", model: "deep-stream-model", weight: 1 }
      ]
    }
  ],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: {},
  healthChecks: { enabled: false },
  history: { retentionDays: 14 }
};

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-upstream-map-"));
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

  const resetMocks = () => { mockRequests = []; streamMockRequests = []; };

  // === Test 1: Route that maps user model to different upstream model ===
  // User requests "fast-model" which routes to mapped-route.
  // The first candidate (provider-a, model:"fast-model") does NOT map.
  // If provider-a is healthy, it should receive "fast-model" upstream.
  resetMocks();
  const resp1 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fast-model", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp1.status === 200, "model mapping request returns 200");
  const body1 = await resp1.json();
  check(body1.choices[0].message.content === "from-A-via-fast-model", "response from provider-a with fast-model (no mapping)");

  // Check that provider-a received model "fast-model" (same as requested)
  if (mockRequests.length > 0) {
    const reqToA = mockRequests.find(r => r.name === "A");
    check(reqToA !== undefined, "provider-a received the request");
    if (reqToA) {
      check(reqToA.receivedModel === "fast-model", "provider-a received upstream model 'fast-model' (same as user model)");
    }
  }

  // === Test 2: Route that renames model ===
  // User requests "rename-route" which maps to provider-b with model "deep-model"
  resetMocks();
  const resp2 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "rename-route", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp2.status === 200, "rename-route returns 200");
  const body2 = await resp2.json();
  check(body2.choices[0].message.content === "from-B-via-deep-model", "response from provider-b via deep-model");

  // Verify provider B received "deep-model" not "rename-route"
  if (mockRequests.length > 0) {
    const reqToB = mockRequests.find(r => r.name === "B");
    check(reqToB !== undefined, "provider-b received the request");
    if (reqToB) {
      check(reqToB.receivedModel === "deep-model", "provider-b received upstream model 'deep-model' (different from user request 'rename-route')");
      check(reqToB.receivedModel !== "rename-route", "provider-b did NOT receive user model name 'rename-route'");
    }
  }

  // === Test 3: Direct model match (no route, no mapping) ===
  // "fast-model" is in provider-a's models list. It should match directly.
  // The upstream model should be "fast-model" (no mapping).
  resetMocks();
  const resp3 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "fast-model", messages: [{ role: "user", content: "hello" }], stream: false, max_tokens: 8 })
  });
  check(resp3.status === 200, "direct model match returns 200");
  // Should go to provider-a (first matching via route mapped-route)
  if (mockRequests.length > 0) {
    const reqToA = mockRequests.find(r => r.name === "A");
    if (reqToA) {
      check(reqToA.receivedModel === "fast-model", "direct match: upstream model = user model = 'fast-model'");
    }
  }

  // === Test 4: Stream request with upstream model mapping ===
  // User sends stream=true with model "stream-me".
  // Route "stream-rename" maps "stream-me" â†?"deep-stream-model" on provider-stream.
  // The streaming mock (already listening on streamMockPort) must receive
  // "deep-stream-model" in its request body, not "stream-me".
  resetMocks();
  const resp4 = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "stream-me", messages: [{ role: "user", content: "hello stream" }], stream: true, max_tokens: 8 })
  });
  check(resp4.status === 200, "stream with model mapping returns 200");

  // Collect SSE chunks to verify content
  const reader4 = resp4.body.getReader();
  const decoder = new TextDecoder();
  let streamContent = "";
  let done = false;
  while (!done) {
    const { value, done: d } = await reader4.read();
    done = d;
    if (value) streamContent += decoder.decode(value, { stream: true });
  }
  check(streamContent.includes("from-deep-stream-model"), "stream response contains content from deep-stream-model");

  // Verify the streaming mock received the mapped upstream model
  const streamReq = streamMockRequests.find(r => r.receivedModel === "deep-stream-model");
  check(streamReq !== undefined, "stream mock received upstream model 'deep-stream-model'");

  const streamAliasReq = streamMockRequests.find(r => r.receivedModel === "stream-me");
  check(streamAliasReq === undefined, "stream mock did NOT receive alias name 'stream-me' as upstream model");

  // === Test 5: Responses API tool-call history maps to upstream Chat payload ===
  // The Responses API represents assistant tool calls as `function_call`
  // items and tool results as `function_call_output`. The relay should
  // convert those to Chat Completions tool_calls/tool messages before
  // sending the request upstream.
  resetMocks();
  const resp5 = await testFetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: "rename-route",
      instructions: "be brief",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "weather?" }] },
        { type: "function_call", call_id: "call_weather", name: "get_weather", arguments: "{\"city\":\"sf\"}" },
        { type: "function_call_output", call_id: "call_weather", output: "{\"temp\":18}" }
      ],
      tools: [{
        type: "function",
        name: "get_weather",
        description: "weather",
        parameters: { type: "object", properties: { city: { type: "string" } } },
        strict: true
      }],
      tool_choice: { type: "function", name: "get_weather" },
      max_output_tokens: 8
    })
  });
  check(resp5.status === 200, "responses tool-call mapping returns 200");
  const responsesReqToB = mockRequests.find(r => r.name === "B");
  check(responsesReqToB !== undefined, "responses tool-call mapping reached provider-b");
  if (responsesReqToB) {
    const upstream = responsesReqToB.body;
    check(upstream.model === "deep-model", "responses tool-call mapping preserves upstream model mapping");
    check(upstream.messages[0].role === "system" && upstream.messages[0].content === "be brief", "responses instructions mapped to system message");
    check(upstream.messages[1].role === "user" && upstream.messages[1].content === "weather?", "responses input message mapped to user");
    check(upstream.messages[2].role === "assistant", "responses function_call mapped to assistant");
    check(upstream.messages[2].tool_calls[0].id === "call_weather", "responses function_call id preserved");
    check(upstream.messages[2].tool_calls[0].function.name === "get_weather", "responses function_call name preserved");
    check(upstream.messages[2].tool_calls[0].function.arguments === "{\"city\":\"sf\"}", "responses function_call arguments preserved");
    check(upstream.messages[3].role === "tool", "responses function_call_output mapped to tool message");
    check(upstream.messages[3].tool_call_id === "call_weather", "responses function_call_output id preserved");
    check(upstream.messages[3].content === "{\"temp\":18}", "responses function_call_output content preserved");
    check(upstream.tools[0].function.name === "get_weather", "responses function tool normalized upstream");
    check(upstream.tools[0].function.strict === true, "responses function tool strict preserved upstream");
    check(upstream.tool_choice.function.name === "get_weather", "responses tool_choice normalized upstream");
  }

} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
  mockA.close();
  mockB.close();
  try { streamMock.close(); } catch {}
}

if (failures.length > 0) {
  console.log(`\n${failures.length} test(s) failed`);
  process.exit(1);
} else {
  console.log("all passed");
}
