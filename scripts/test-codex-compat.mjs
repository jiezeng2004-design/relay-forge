// 0.5.7: end-to-end coverage for the cross-format streaming
// bridges (0.5.0) and the error attribution paths added through
// 0.5.x. Strategy: spawn a mock upstream + a relay child,
// exercise each scenario sequentially, then tear down BOTH in
// the finally block.
//
// 0.5.7 reliability contract (see scripts/test-utils.mjs):
//   * killChildProcess  -- SIGTERM, wait for "exit", SIGKILL after
//     2s, then destroy() the stdio streams.
//   * closeServer  -- closeIdleConnections / closeAllConnections /
//     graceful close with a hard 1.5s timeout.
//   * testFetch  -- wraps globalThis.fetch with `Connection: close`
//     so undici does not park the loop on a 5s keep-alive Socket
//     after the test scenario returns.
//   * testFetchWithTimeout  -- fetch-phase-only timeout. For
//     non-stream / response.status / response.json() callers.
//   * fetchTextWithTimeout  -- 0.5.7 fix. The 0.5.6 version
//     protected only the fetch phase, so `response.text()`
//     could pin the loop for the OS TCP keepalive (120s on
//     Windows) when an upstream never closed the body  -- //     the codex-idle-stream hang. 0.5.7 threads the same
//     AbortController through both phases and cancels
//     `response.body` on timeout so the body read unblocks
//     with a recognizable error. USE THIS HELPER for every
//     streaming scenario in this file.
//
// 0.5.7 cleanup contract  -- finally stages are wrapped
// individually so a hang or throw in any one of them is visible
// in the test output. If a future regression makes the relay
// hang, the failure is attributed to the right cleanup stage
// instead of an opaque "test exited 1".

// 0.5.7: optional per-stage logging. When OPENRELAY_TEST_DEBUG=1
// is set in the environment, every scenario block prints a
// short `[codex-compat] running <stage> …` line and an
// elapsed-ms line on completion, so a CI failure shows the
// exact stage that hung / failed. When the env is unset (the
// default), the test stays quiet and just prints the
// "codex compat test passed" / "codex compat test failed"
// summary. We use console.error so the lines survive a stdout
// redirect and end up in the npm test log file.
const DEBUG = process.env.OPENRELAY_TEST_DEBUG === "1" || process.env.OPENRELAY_TEST_DEBUG === "true";
function stage(name, fn) {
  if (DEBUG) console.error(`[codex-compat] running ${name} …`);
  const started = Date.now();
  return fn().then((value) => {
    if (DEBUG) console.error(`[codex-compat] ${name} ok (${Date.now() - started}ms)`);
    return value;
  }, (error) => {
    if (DEBUG) console.error(`[codex-compat] ${name} failed after ${Date.now() - started}ms: ${error && error.message ? error.message : String(error)}`);
    throw error;
  });
}

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  closeServer,
  fetchTextWithTimeout,
  killChildProcess,
  sleep,
  testFetch,
  testFetchWithTimeout
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = await mkdtemp(resolve(tmpdir(), "openrelay-codex-compat-"));
let mockServer;
let relayProcess;
let mockPort;
let relayPort;
let relayExitCode = null;

// Default per-request timeout for all outgoing HTTP calls in this
// test. 0.5.5 had no client-side timeout, so a single hung
// upstream could pin the test for the OS default (120s on
// Windows). 30s is enough for any well-behaved scenario (the
// codex-anthropic-fallback path adds ~100ms per candidate, the
// longest path is well under 1s end-to-end) and short enough
// that a real hang surfaces inside npm test's normal window.
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

// codex-idle-stream gets a tighter budget than the default
// 30s because the relay's streamIdleTimeoutMs is 1s (enabled
// by the OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT env on the
// relay child) and the mock holds the body open for ~2s. The
// scenario should normally complete in ~1.5s. 5s leaves a
// 3x safety margin for slow CI hosts but is well above the
// 1s relay idle timer and below the OS-level TCP keepalive
// (120s on Windows) that was the 0.5.6 failure mode. If the
// relay's idle timer fails to fire for any reason, the
// fetchTextWithTimeout body-read cancellation in test-utils.mjs
// (0.5.7) guarantees the test fails in 5s instead of hanging.
const IDLE_STREAM_TIMEOUT_MS = 5000;

// Top-level guard: any uncaught exception (a promise rejection that
// escaped the try/catch, or a throw from a setImmediate callback)
// gets annotated with the listening ports and the relay's exit code
// so debugging is fast, then marked as failed so the process exits
// non-zero. We deliberately do not print request bodies, prompts, or
// API keys  -- the test inputs are fixed model names.
process.on("uncaughtException", (error) => {
  console.error("codex compat test crashed");
  console.error("  mockPort: " + (mockPort ?? "n/a"));
  console.error("  relayPort: " + (relayPort ?? "n/a"));
  console.error("  relayExitCode: " + (relayExitCode ?? "n/a"));
  console.error("  error: " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
});
// Mirror handler for unhandled promise rejections, which Node routes
// separately from uncaughtException. error.reason holds the actual
// rejection value in modern Node; .message is the safe text surface.
process.on("unhandledRejection", (reason) => {
  const message = reason && reason.message ? reason.message : String(reason);
  console.error("codex compat test unhandled rejection");
  console.error("  mockPort: " + (mockPort ?? "n/a"));
  console.error("  relayPort: " + (relayPort ?? "n/a"));
  console.error("  relayExitCode: " + (relayExitCode ?? "n/a"));
  console.error("  error: " + message);
  process.exitCode = 1;
});

try {
  // Use ephemeral ports (OS-picked) for both servers. This avoids
  // TIME_WAIT collisions when the chain runs back-to-back on
  // Windows. The mock server gives us its port synchronously via
  // address(); the relay child process prints its port to stdout
  // ("openrelay-like is running at http://127.0.0.1:PORT")
  // which we parse before running the test scenarios.
  mockServer = await startMockServer(0);
  mockPort = mockServer.address().port;
  const configPath = resolve(tmpDir, "config.json");
  await writeFile(configPath, JSON.stringify({
    defaultProvider: "primary",
    providers: [
      { name: "primary", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: null, models: ["ok", "stream", "tool", "broken-stream", "idle-stream", "destroy-stream", "malformed-stream"] },
      { name: "rate-limit", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: null, models: ["rate-limit"] },
      { name: "network-down", baseUrl: `http://127.0.0.1:${mockPort + 1}/v1`, keyEnv: null, models: ["network-down"] },
      { name: "fallback", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: null, models: ["fallback-ok"] },
      { name: "needs-key", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: "MISSING_CODEX_COMPAT_KEYS", models: ["needs-key"] },
      // Cross-format bridge fixtures. The mock server detects
      // /messages on these providers and responds with Anthropic
      // SSE; the relay transcodes into the right client shape.
      { name: "anthropic-up", baseUrl: `http://127.0.0.1:${mockPort}`, keyEnv: null, apiFormat: "anthropic", models: ["anthropic-stream"] },
      { name: "anthropic-down", baseUrl: `http://127.0.0.1:${mockPort + 2}/v1`, keyEnv: null, apiFormat: "anthropic", models: ["anthropic-down"] }
    ],
    routes: [
      { name: "codex", strategy: "fallback", candidates: [{ provider: "primary", model: "ok" }] },
      { name: "codex-stream", strategy: "fallback", candidates: [{ provider: "primary", model: "stream" }] },
      { name: "codex-tool", strategy: "fallback", candidates: [{ provider: "primary", model: "tool" }] },
      { name: "codex-fallback", strategy: "fallback", candidates: [{ provider: "rate-limit", model: "rate-limit" }, { provider: "fallback", model: "fallback-ok" }] },
      { name: "codex-network-fallback", strategy: "fallback", candidates: [{ provider: "network-down", model: "network-down" }, { provider: "fallback", model: "fallback-ok" }] },
      { name: "codex-no-key", strategy: "fallback", candidates: [{ provider: "needs-key", model: "needs-key" }] },
      { name: "codex-broken-stream", strategy: "fallback", candidates: [{ provider: "primary", model: "broken-stream" }] },
      { name: "codex-idle-stream", strategy: "fallback", candidates: [{ provider: "primary", model: "idle-stream" }] },
      { name: "codex-destroy-stream", strategy: "fallback", candidates: [{ provider: "primary", model: "destroy-stream" }] },
      { name: "codex-malformed-stream", strategy: "fallback", candidates: [{ provider: "primary", model: "malformed-stream" }] },
      // Cross-format streaming routes (0.5.0)
      { name: "codex-anthropic-stream", strategy: "fallback", candidates: [{ provider: "anthropic-up", model: "anthropic-stream" }] },
      { name: "codex-anthropic-fallback", strategy: "fallback", candidates: [{ provider: "anthropic-down", model: "anthropic-down" }, { provider: "anthropic-up", model: "anthropic-stream" }] }
    ],
    profiles: [{ name: "default", defaultModel: "codex" }],
    activeProfile: "default",
    // 0.5.8: bump cooldownMs to 1000 (was 100) for a wider
    // margin between candidate retries in the relay, and keep
    // streamIdleTimeoutMs at 1000 (the test-only floor  --     // production clamps to 10000 unless the
    // OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT env opts the
    // relay out). The 1 s idle timer is the key knob that
    // makes the codex-idle-stream regression deterministic
    // and fast; the wider cooldown gives the relay's event
    // loop room to drain pending microtasks from the
    // previous scenario's persistRuntimeState() before the
    // next one starts. Without the wider cooldown, the
    // codex-network-fallback scenario's fallback path can
    // race the previous scenario's persist on Windows and
    // surface as a flaky ECONNRESET.
    retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 1000 },
    limits: { maxBodyBytes: 1048576 },
    history: { retentionDays: 3 },
    healthChecks: { enabled: false }
  }, null, 2));

  relayProcess = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      // 0.5.3: the relay now requires a Bearer token on /v1/* by
      // default. The codex-compat test focuses on the cross-format
      // bridge + streaming logic, not the auth gate (covered by
      // test-auth-required.mjs), so we opt out of auth for this
      // scenario. The startup WARNING is expected and asserted
      // elsewhere; we explicitly do not assert on it here.
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPath,
      OPENRELAY_STATE: resolve(tmpDir, "state.json"),
      OPENRELAY_KEYSTORE_DIR: tmpDir,
      // 0.5.7: opt the relay child into the test-only short
      // streamIdleTimeoutMs floor. See normalizeConfig in
      // src/config.js for the matching guard. Without this,
      // the production 10s minimum silently clamps our 1000
      // and the codex-idle-stream scenario can no longer
      // reach the test's 1.2s end-to-end target.
      OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT: "true"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  relayProcess.on("exit", (code) => { relayExitCode = code; });
  // 0.5.9: surface relay stderr in debug mode so a mid-scenario
  // crash (e.g. relay process killed by a port-reuse race on
  // Windows) shows up in the test log instead of as an opaque
  // ECONNREFUSED on the next request. By default the relay's
  // stderr is silent (the project's CHANGELOG explicitly notes
  // that the relay never logs API keys, Authorization headers,
  // or request bodies, so the worst case here is a stack trace
  // of an internal failure).
  if (process.env.OPENRELAY_TEST_DEBUG) {
    relayProcess.stderr?.on("data", (chunk) => {
      const text = String(chunk || "");
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) console.error(`[relay stderr] ${line}`);
      }
    });
  }
  relayPort = await waitForRelayPort(relayProcess);
  await waitForHealth(relayPort);
  // Warm-up request: probe /v1/models a couple of times so the relay
  // and the mock server's TCP backends are fully settled before the
  // first real /v1/responses call. This prevents the sporadic
  // ECONNRESET that Windows can return on a freshly opened loopback
  // socket. The retry is bounded; we never print request bodies.
  await warmupRelay(relayPort);

  const nonStream = await stage("non-stream responses", () => responses(relayPort, "codex"));
  assert(nonStream.object === "response", "/v1/responses non-stream should return response object");
  assert(nonStream.output_text === "ok", "/v1/responses non-stream should expose output_text");
  assert(nonStream.output.some((item) => item.type === "reasoning"), "reasoning should convert to Responses output");

  const streamText = await stage("stream responses", () => responsesStream(relayPort, "codex-stream"));
  assert(streamText.includes("event: response.created"), "responses stream should emit response.created");
  assert(streamText.includes("event: response.output_text.delta"), "responses stream should emit text delta");
  assert(streamText.includes("event: response.completed"), "responses stream should complete");

  const toolResult = await stage("tool call", () => responses(relayPort, "codex-tool", {
    tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object", properties: {} } } }]
  }));
  assert(toolResult.output.some((item) => item.type === "function_call" && item.name === "lookup"), "tool_call output should convert");

  const fallbackResult = await stage("429 fallback", () => responses(relayPort, "codex-fallback"));
  assert(fallbackResult.output_text === "fallback-ok", "upstream 429 should fall back to next provider");

  const networkFallback = await stage("network fallback", () => responsesStream(relayPort, "codex-network-fallback"));
  assert(networkFallback.includes("fallback-ok"), "responses stream network error should fall back to next candidate");

  const noKey = await stage("no-key", () => fetchJsonAllowError(`http://127.0.0.1:${relayPort}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "codex-no-key", input: "hi" })
  }));
  assert(noKey.error === "no_available_upstream", `no upstream error should be clear, got ${JSON.stringify(noKey)}`);
  assert(Array.isArray(noKey.attempts), "no key response should include attempts array");
  assert(noKey.attempts.some((a) => a.status === "missing_key"), "attempts should include missing_key status");
  if (noKey.message) assert(noKey.message.includes("MISSING_CODEX_COMPAT_KEYS") || noKey.message.includes("no_available"), "message should hint at missing config");

  const broken = await stage("broken stream", () => responsesStream(relayPort, "codex-broken-stream"));
  assert(broken.includes("broken"), "broken stream should return available chunk");
  const errors = await fetchJson(`http://127.0.0.1:${relayPort}/admin/error-log`);
  assert(Array.isArray(errors), "error log should stay readable after broken stream");

  // 0.5.7: explicit per-scenario timeout. The relay's
  // streamIdleTimeoutMs is 1s (via
  // OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT) and the mock
  // holds the body open for ~2s. The expected end-to-end
  // time is ~1.5s. IDLE_STREAM_TIMEOUT_MS (5s) is the hard
  // ceiling: if the relay's idle timer fails to fire (e.g.
  // because the codex-anthropic path left the relay in a
  // state where the read loop is wedged), the
  // fetchTextWithTimeout body-read cancellation in
  // test-utils.mjs (0.5.7) cancels the response body and
  // the test fails in 5s instead of letting the OS TCP
  // keepalive (120s) hold npm test hostage. The 0.5.6
  // version had a 20s ceiling and only protected the fetch
  // phase, which was the root cause of the original hang.
  const idle = await stage("idle stream", () => responsesStream(relayPort, "codex-idle-stream", IDLE_STREAM_TIMEOUT_MS));
  assert(idle.includes("event: response.failed"), "idle responses stream should emit response.failed");
  assert(idle.includes("stream_idle_timeout"), `idle responses stream should report stream_idle_timeout, got:\n${idle}`);
  assert(!idle.includes("event: response.completed"), "failed responses stream must not emit response.completed");

  const destroyed = await stage("destroy stream", () => responsesStream(relayPort, "codex-destroy-stream"));
  assert(destroyed.includes("stream_read_failed"), "reader failure should report stream_read_failed");
  assert(!destroyed.includes("event: response.completed"), "reader failure must not emit response.completed");

  const malformed = await stage("malformed stream", () => responsesStream(relayPort, "codex-malformed-stream"));
  assert(malformed.includes("stream_parse_failed"), "malformed SSE JSON should report stream_parse_failed");
  assert(!malformed.includes("event: response.completed"), "parse failure must not emit response.completed");

  // 0.5.0 cross-format streaming bridges
  // Client speaks Anthropic Messages; upstream speaks OpenAI chat
  // completions. The relay transcodes OpenAI chat.completion.chunk
  // into Anthropic messages SSE event-by-event.
  const anthropicStream = await stage("anthropic bridge", () => anthropicMessagesStream(relayPort, "codex-anthropic-stream"));
  assert(anthropicStream.includes("event: message_start"), "anthropic client should receive message_start");
  assert(anthropicStream.includes("event: content_block_delta"), "anthropic client should receive content_block_delta");
  assert(anthropicStream.includes("event: message_stop"), "anthropic client should receive message_stop");
  assert(anthropicStream.includes("anthropic-stream"), "anthropic client should see the upstream text content");
  assert(!anthropicStream.includes("data: [DONE]"), "anthropic client should not see OpenAI's [DONE] sentinel");

  // Client speaks OpenAI chat.completion; upstream speaks Anthropic
  // Messages. The relay transcodes Anthropic messages SSE into
  // chat.completion.chunk event-by-event.
  const openaiFromAnthropic = await stage("openai-from-anthropic", () => chatCompletionsStream(relayPort, "codex-anthropic-stream"));
  assert(openaiFromAnthropic.includes("\"chat.completion.chunk\""), "openai client should receive chat.completion.chunk");
  assert(openaiFromAnthropic.includes("anthropic-stream"), "openai client should see the upstream text content");
  assert(openaiFromAnthropic.endsWith("data: [DONE]\n\n") || openaiFromAnthropic.includes("data: [DONE]\n\n"), "openai client should see [DONE] sentinel");

  // Cross-format fallback: a route whose first candidate is
  // unreachable, with a working anthropic upstream as the second
  // candidate. The relay should demote the unhealthy provider to
  // the tail of orderCandidates() and still succeed.
  const crossFormatFallback = await stage("cross-format fallback", () => anthropicMessagesStream(relayPort, "codex-anthropic-fallback"));
  assert(crossFormatFallback.includes("anthropic-stream"), "cross-format fallback should yield upstream text");

  // 0.5.5: let any pending fire-and-forget persist (the
  // recordUsageFromResponse().finally(persistRuntimeState) chain)
  // drain BEFORE we kill the relay. The chain's microtask is
  // scheduled after the response is sent, so by the time the
  // client awaits the response body, the persist is still in
  // flight. A short, bounded sleep gives the relay's event loop
  // a chance to run the microtask; without it, the relay may be
  // SIGTERM'd mid-persist and the temp state.json file is left
  // behind (Windows holds the handle until the OS reaps the
  // process). The sleep never prints request bodies, prompts, or
  // API keys  -- it is purely a timing fence.
  await sleep(150);

  console.log("codex compat test passed");
} catch (error) {
  // Annotate failures with the listening ports and the relay's exit
  // code so debugging is fast. Never print the request body, prompt
  // contents, or any upstream API key  -- the test inputs are fixed
  // model names like "codex" and "ok" that contain no secrets.
  console.error("codex compat test failed");
  console.error("  mockPort: " + (mockPort ?? "n/a"));
  console.error("  relayPort: " + (relayPort ?? "n/a"));
  console.error("  relayExitCode: " + (relayExitCode ?? "n/a"));
  console.error("  error: " + (error && error.message ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  // 0.5.6: each cleanup stage is wrapped in its own try/catch so
  // a hang or throw in one stage does not silently skip the rest.
  // The 0.5.5 finally was a single await chain; if killChildProcess
  // hung, the test exited 1 with no diagnostic about which stage
  // failed. Now each stage logs an explicit "cleanup failed" line
  // and marks the process exit code so npm test can attribute the
  // failure to the cleanup, not the scenario.
  await runCleanupStage("killChildProcess", () => killChildProcess(relayProcess));
  await runCleanupStage("closeServer", () => closeServer(mockServer));
  await runCleanupStage("cleanupTempDir", () => cleanupTempDir(tmpDir));
  // 0.5.5: drop the top-level references so the ChildProcess +
  // its stdio Sockets can be GC'd. The 0.5.4 line let these
  // variables stay in scope, which pinned the event loop until
  // the safety net fired.
  relayProcess = null;
  mockServer = null;
}

async function runCleanupStage(label, fn) {
  try {
    await fn();
  } catch (error) {
    console.error(`codex compat cleanup failed: ${label}: ${error && error.message ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

function startMockServer(port) {
  const server = createServer(async (req, res) => {
    // Cross-format bridge fixture: Anthropic-format upstream serving
    // /messages with stream:true. Emits a valid Anthropic messages
    // SSE envelope so the relay can transcode it into both client
    // shapes (OpenAI chat.completion.chunk and OpenAI Responses).
    if (req.method === "POST" && req.url === "/messages") {
      const body = await readJson(req);
      if (body.stream) {
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
        res.write(`event: message_start\ndata: ${JSON.stringify({
          type: "message_start",
          message: { id: "msg_mock", type: "message", role: "assistant", model: "claude-3-5-haiku", usage: { input_tokens: 3, output_tokens: 0 } }
        })}\n\n`);
        res.write(`event: content_block_start\ndata: ${JSON.stringify({
          type: "content_block_start", index: 0, content_block: { type: "text", text: "" }
        })}\n\n`);
        res.write(`event: content_block_delta\ndata: ${JSON.stringify({
          type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "anthropic-stream" }
        })}\n\n`);
        res.write(`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`);
        res.write(`event: message_delta\ndata: ${JSON.stringify({
          type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 }
        })}\n\n`);
        res.write(`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "msg_mock", type: "message", role: "assistant", model: "claude-3-5-haiku",
        content: [{ type: "text", text: "anthropic-non-stream" }],
        stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }
      }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const body = await readJson(req);
    if (body.model === "rate-limit") {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "rate_limited" }));
      return;
    }
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl-codex-stream",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: { reasoning: "think ", content: body.model === "broken-stream" ? "broken" : body.model === "fallback-ok" ? "fallback-ok" : "stream" }, finish_reason: null }]
      })}\n\n`);
      if (typeof res.flushHeaders === "function") res.flushHeaders();
      if (body.model === "broken-stream") return res.end();
      // 0.5.6: the mock used to sleep 15s here so the relay's
      // 0.5.7: keep the upstream half-open after the first chunk.
      // The relay's 1s test-only idle timer should fire and
      // emit stream_idle_timeout. If it does not, the
      // client's fetchTextWithTimeout ceiling (5 s) fails
      // this scenario cleanly instead of pinning npm test on
      // the OS TCP keepalive.
      //
      // 0.5.8: bump the sleep from 2s to 3s. The relay's
      // stream reader needs ~1s of no data to fire the idle
      // timer, but the relay's persistRuntimeState() from the
      // previous request can race the new request's read
      // loop on Windows; a longer mock sleep widens the
      // detection window so the relay reliably observes 1s of
      // true idle before the test scenario completes.
      if (body.model === "idle-stream") {
        await sleep(3000);
        return;
      }
      if (body.model === "destroy-stream") {
        await sleep(100);
        res.destroy(new Error("mock upstream stream destroyed"));
        return;
      }
      if (body.model === "malformed-stream") {
        res.write("data: {not-json}\n\n");
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({
        id: "chatcmpl-codex-stream",
        object: "chat.completion.chunk",
        model: body.model,
        choices: [{ index: 0, delta: { content: "-ok" }, finish_reason: "stop" }]
      })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    const message = body.model === "tool"
      ? {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_lookup", type: "function", function: { name: "lookup", arguments: "{\"q\":\"hi\"}" } }]
        }
      : { role: "assistant", content: body.model === "fallback-ok" ? "fallback-ok" : "ok", reasoning: "short reasoning" };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "chatcmpl-codex",
      object: "chat.completion",
      model: body.model,
      choices: [{ index: 0, message, finish_reason: "stop" }]
    }));
  });
  return new Promise((resolveListen) => server.listen(port, "127.0.0.1", () => resolveListen(server)));
}

async function responses(port, model, extra = {}) {
  return fetchJson(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }], ...extra })
  });
}

// 0.5.6: every streaming helper accepts an explicit per-scenario
// timeoutMs (default DEFAULT_REQUEST_TIMEOUT_MS). The 0.5.5
// helpers had no client-side timeout at all; a hung read on a
// half-closed upstream connection could pin the test for the OS
// TCP keepalive (120s on Windows). The hard ceiling turns a
// hang into a clean assertion failure.
//
// 0.5.9: the 0.5.8 CHANGELOG documented that
// `codex-malformed-stream` (and `codex-network-fallback`)
// could still surface a single ECONNREFUSED on the fallback /
// mock path when run back-to-back with the previous e2e
// scenarios. The root cause is a TCP-level port-reuse race
// between the relay's connect attempt and the OS releasing
// the prior half-open socket from the previous scenario's
// `codex-destroy-stream` (which calls `res.destroy()` on the
// mock upstream). The real fix for that race is the
// single-flight runtime-state persister (so the relay's
// response loop is never blocked waiting on a rename()), but
// the client-side `testFetchWithTimeout` surface was not
// retrying on a pure connect-level ECONNREFUSED. We now wrap
// `responsesStream` with a single 80ms retry for ECONNREFUSED
// / ECONNRESET so the intermittent race is not a hard test
// failure. The retry NEVER re-sends a stream body that
// partially succeeded  -- the helper aborts the request on the
// first attempt via the AbortController inside
// `fetchTextWithTimeout`, so a retried call is a fresh
// request.
async function responsesStream(port, model, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const started = Date.now();
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(
        `http://127.0.0.1:${port}/v1/responses`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, stream: true, input: "hi" })
        },
        timeoutMs,
        `responsesStream(${model})`
      );
      if (!response.ok) throw new Error(`responses stream failed: ${response.status} ${text}`);
      if (Date.now() - started > timeoutMs - 1000) {
        console.error(`[codex-compat] responsesStream(${model}) used ${Date.now() - started}ms (ceiling ${timeoutMs}ms)`);
      }
      return text;
    } catch (error) {
      // Only retry pure connect-level failures. A 4xx / 5xx
      // already came from a real relay response  -- the test
      // should fail on that, not paper over it.
      //
      // 0.5.9: Node 24's undici fetch surfaces the connect
      // failure as a stringified `cause` (e.g.
      // `{cause: "ECONNREFUSED"}`) instead of a nested object,
      // while older versions used `{cause: {code: "ECONNREFUSED"}}`.
      // Check both shapes so the retry actually fires.
      const errString = JSON.stringify({
        code: error && error.code,
        cause: error && error.cause,
        message: error && error.message
      });
      const causeCode = error && (
        error.code
        || (typeof error.cause === "string" ? error.cause : null)
        || (error.cause && error.cause.code)
        || (typeof error.message === "string" && /(ECONNREFUSED|ECONNRESET)/.test(error.message) ? RegExp.$1 : null)
      );
      const transient = causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET";
      if (process.env.OPENRELAY_TEST_DEBUG) {
        console.error(`[codex-compat] responsesStream(${model}) attempt ${attempt} failed: cause=${causeCode || "?"} detail=${errString}`);
      }
      if (!transient || attempt >= maxAttempts) throw error;
      // 0.5.9: linear backoff (80ms / 160ms) instead of a fixed
      // 80ms. The Windows port-reuse window after a res.destroy()
      // is closer to ~120-200ms in practice; the longer backoff
      // gives the OS a chance to settle.
      // 0.6.0: bumped to 100ms * attempt (up to 500ms) and 6
      // attempts. The chained `npm test` can pile multiple
      // res.destroy() half-open sockets into the OS port-reuse
      // window; the wider backoff + more attempts keeps the
      // scenario green across 5+ consecutive full-chain runs.
      await sleep(100 * attempt);
    }
  }
  // Unreachable: the loop always either returns or throws.
  throw new Error(`responsesStream(${model}) exhausted retries`);
}

async function anthropicMessagesStream(port, model, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(
        `http://127.0.0.1:${port}/v1/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model, stream: true, max_tokens: 64, messages: [{ role: "user", content: "hi" }] })
        },
        timeoutMs,
        `anthropicMessagesStream(${model})`
      );
      if (!response.ok) throw new Error(`anthropic messages stream failed: ${response.status} ${text}`);
      return text;
    } catch (error) {
      const causeCode = error && (
        error.code
        || (typeof error.cause === "string" ? error.cause : null)
        || (error.cause && error.cause.code)
        || (typeof error.message === "string" && /(ECONNREFUSED|ECONNRESET)/.test(error.message) ? RegExp.$1 : null)
      );
      const transient = causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET";
      if (process.env.OPENRELAY_TEST_DEBUG) {
        console.error(`[codex-compat] anthropicMessagesStream(${model}) attempt ${attempt} failed: cause=${causeCode || "?"} error=${error && error.message}`);
      }
      if (!transient || attempt >= maxAttempts) throw error;
      await sleep(80 * attempt);
    }
  }
  throw new Error(`anthropicMessagesStream(${model}) exhausted retries`);
}

async function chatCompletionsStream(port, model, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const { response, text } = await fetchTextWithTimeout(
        `http://127.0.0.1:${port}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "hi" }] })
        },
        timeoutMs,
        `chatCompletionsStream(${model})`
      );
      if (!response.ok) throw new Error(`chat completions stream failed: ${response.status} ${text}`);
      return text;
    } catch (error) {
      const causeCode = error && (
        error.code
        || (typeof error.cause === "string" ? error.cause : null)
        || (error.cause && error.cause.code)
        || (typeof error.message === "string" && /(ECONNREFUSED|ECONNRESET)/.test(error.message) ? RegExp.$1 : null)
      );
      const transient = causeCode === "ECONNREFUSED" || causeCode === "ECONNRESET";
      if (process.env.OPENRELAY_TEST_DEBUG) {
        console.error(`[codex-compat] chatCompletionsStream(${model}) attempt ${attempt} failed: cause=${causeCode || "?"} error=${error && error.message}`);
      }
      if (!transient || attempt >= maxAttempts) throw error;
      await sleep(80 * attempt);
    }
  }
  throw new Error(`chatCompletionsStream(${model}) exhausted retries`);
}

async function waitForHealth(port) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await testFetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("relay did not become healthy in time");
}

// Hit /v1/models a few times to make sure the relay's listening
// socket is fully ready. Windows can return ECONNRESET on the very
// first request after a process opens its listening socket, so a
// couple of probes is enough to stabilize the stack. Bounded to ~1s
// so a hung relay still fails fast. We never print request bodies.
async function warmupRelay(port) {
  const deadline = Date.now() + 1500;
  for (let i = 0; i < 3 && Date.now() < deadline; i += 1) {
    try {
      const r = await testFetch(`http://127.0.0.1:${port}/v1/models`);
      await r.text();
      if (r.ok) return;
    } catch {
      await sleep(80);
    }
  }
}

// Retry a single raw fetch up to maxAttempts times on connect-level
// failures. We never retry once the server has returned a 4xx / 5xx
// status. This is the small safety net that lets the test scenario
// survive the very first ECONNRESET a freshly spawned relay can
// produce on Windows without papering over real 5xx failures.
// 0.5.6: every attempt goes through testFetchWithTimeout so a
// hung connect also gets the abort treatment.
async function fetchWithRetry(url, options, maxAttempts = 2) {
  let lastError;
  for (let i = 0; i < maxAttempts; i += 1) {
    try {
      return await testFetchWithTimeout(url, options, DEFAULT_REQUEST_TIMEOUT_MS, `fetchWithRetry(${url})`);
    } catch (error) {
      lastError = error;
      if (i + 1 < maxAttempts) await sleep(80);
    }
  }
  throw lastError;
}

// When started with PORT=0, the relay picks an ephemeral port
// and prints it in the "OpenRelay Local Safe is running at
// http://127.0.0.1:PORT" banner. Drain stdout until we see the
// banner, then return the port. 5s timeout matches waitForHealth.
//
// 0.5.6: cleanup() now also removes the once("error") and
// once("exit") listeners. The 0.5.5 cleanup only removed the
// stdout "data" listener, so the error/exit listeners stayed
// attached to the child after the promise resolved. If the
// relay later printed a stderr line that triggered an "error"
// event (or exited after a successful banner but with a
// non-zero code), the orphan handler would reject() the
// already-resolved promise  -- visible in Node as an
// "UnhandledPromiseRejection" or, in older versions, a silent
// event-loop pin.
function waitForRelayPort(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("relay did not print its listening port in time"));
    }, 5000);
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    }
    function onError(err) {
      cleanup();
      reject(err);
    }
    function onExit(code) {
      cleanup();
      reject(new Error(`relay exited prematurely with code ${code}`));
    }
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener("data", onData);
      child.removeListener("error", onError);
      child.removeListener("exit", onExit);
    }
    child.stdout.on("data", onData);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

async function fetchJson(url, options) {
  const response = await fetchWithRetry(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function fetchJsonAllowError(url, options) {
  const response = await fetchWithRetry(url, options);
  return JSON.parse(await response.text());
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
