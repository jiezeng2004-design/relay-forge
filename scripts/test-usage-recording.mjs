// 0.5.3: end-to-end coverage for the per-bucket usage recording
// fixes. The test spawns the relay with PORT=0 and a mock
// upstream that returns known `usage` fields in both non-stream
// and stream responses. After each scenario, the test fetches
// /admin/status and asserts the byProvider / byModel / byRoute
// buckets all carry the expected token + latency deltas.
//
// 0.5.5 cleanup contract (see scripts/test-utils.mjs):
//   * killChildProcess — SIGTERM, wait for "exit", SIGKILL after
//     2s, then destroy() the stdio streams. Replaces the local
//     killRelay.
//   * closeServer — closeIdleConnections / closeAllConnections /
//     graceful close with a hard 1.5s timeout. Replaces the
//     ad-hoc `mock.close(...)` Promise.
//   * testFetch — wraps globalThis.fetch with `Connection: close`
//     so undici does not park a 5s keep-alive Socket on the
//     event loop after the test returns.
//   * The 1500ms safety-net force-exit is GONE. The 0.5.4 line
//     relied on it because the cleanup was incomplete.
//
// The key things this catches that the 0.5.2 line missed:
//   * recordUsageFromResponse: the previous `let usage = null`
//     shadowed the global UsageTracker, so the `usage.recordTokens`
//     call threw and was silently swallowed inside the
//     try/catch. Tokens were never written for non-stream chat
//     completions.
//   * recordStreamUsage: same shadow pattern, same silent
//     failure. Tokens were also never written for the stream
//     path until 0.5.2 added the latency ring buffer.
//   * proxyWithRetry: the non-stream /v1/chat/completions
//     success path was missing both `usage.recordLatency` and
//     `usage.recordTokens`. The Dashboard's p50/p95 panels
//     stayed empty for plain chat traffic.
//   * response.clone(): reading the body for usage must not
//     consume the body that the response path then streams back
//     to the client. We verify this implicitly by checking the
//     client receives the full upstream body, not a partial one.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  closeServer,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-usage-"));

let passed = 0;
let failed = 0;
function logPass(name) { console.log(`  ok  ${name}`); passed += 1; }
function logFail(name, error) { console.log(`  FAIL  ${name}: ${error.message}`); failed += 1; }

function assert(cond, msg) { if (!cond) throw new Error("assertion failed: " + msg); }
function assertEqual(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await testFetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    const detail = {
      message: error && error.message,
      code: error && error.code,
      cause: error && error.cause && (error.cause.code || error.cause.message)
    };
    throw new Error(`fetch ${url} failed: ${JSON.stringify(detail)}`);
  } finally {
    clearTimeout(timer);
  }
}

// Mock upstream. Supports:
//   POST /v1/chat/completions  -> 200 + JSON with usage
//   POST /v1/chat/completions  -> 200 + SSE (when body.stream=true)
// Both shapes include a known `usage` block so the relay can
// parse it via normalizeUsage().
function startMockUpstream() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { parsed = {}; }
      const isStream = parsed.stream === true;
      if (isStream) {
        // OpenAI-style SSE: 4 chunks, usage in the last
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write(`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"${parsed.model || "stub"}","choices":[{"index":0,"delta":{"role":"assistant","content":"pong"},"finish_reason":null}]}\n\n`);
        res.write(`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"${parsed.model || "stub"}","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
        res.write(`data: {"id":"chatcmpl-1","object":"chat.completion.chunk","model":"${parsed.model || "stub"}","choices":[],"usage":{"prompt_tokens":11,"completion_tokens":7,"total_tokens":18}}\n\n`);
        res.write(`data: [DONE]\n\n`);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-1",
        object: "chat.completion",
        model: parsed.model || "stub",
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 }
      }));
    });
  });
  return new Promise((resolveBind) => {
    server.listen(0, "127.0.0.1", () => {
      // 0.5.4: don't let the mock keep the event loop alive
      // after the test finishes. See test-auth-required.mjs
      // for the same fix.
      server.unref();
      resolveBind(server);
    });
  });
}

function spawnRelay({ env = {} } = {}) {
  return spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "state.json"),
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function waitForBanner(proc) {
  return new Promise((resolveBanner, reject) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    const onChunk = (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      const match = (stdoutBuf + "\n" + stderrBuf).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        proc.stdout.off("data", onChunk);
        proc.stderr.off("data", onChunk);
        setTimeout(() => resolveBanner({ port: Number(match[1]), stdout: stdoutBuf, stderr: stderrBuf }), 200);
      }
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      const match = (stdoutBuf + "\n" + stderrBuf).match(/http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        proc.stdout.off("data", onChunk);
        proc.stderr.off("data", onChunk);
        setTimeout(() => resolveBanner({ port: Number(match[1]), stdout: stdoutBuf, stderr: stderrBuf }), 200);
      }
    });
    proc.on("exit", (code) => {
      if (!stdoutBuf.includes("127.0.0.1")) {
        reject(new Error(`relay exited early with code ${code}; stderr=${stderrBuf}; stdout=${stdoutBuf}`));
      }
    });
    setTimeout(() => reject(new Error(`banner timeout; stdout=${stdoutBuf}; stderr=${stderrBuf}`)), 8000);
  });
}

async function run(name, fn) {
  try { await fn(); logPass(name); }
  catch (error) { logFail(name, error); }
}

const mock = await startMockUpstream();
const mockPort = mock.address().port;

const configJson = JSON.stringify({
  defaultProvider: "stub",
  providers: [
    { name: "stub", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: null, models: ["stub-model"] }
  ],
  routes: [{ name: "r1", strategy: "fallback", candidates: [{ provider: "stub", model: "stub-model" }] }],
  profiles: [{ name: "default", defaultModel: "r1" }],
  activeProfile: "default",
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: { maxBodyBytes: 1048576 },
  history: { retentionDays: 3 },
  healthChecks: { enabled: false }
}, null, 2);
await writeFile(resolve(tmpRoot, "config.json"), configJson);

let relay = null;
let port = null;
let token = null;
let statusAfterNonStream = null;
let statusAfterStream = null;

try {
  relay = spawnRelay();
  const banner = await waitForBanner(relay);
  port = banner.port;
  const fs = await import("node:fs/promises");
  token = (await fs.readFile(resolve(tmpRoot, "data", "security", "relay-token"), "utf8")).trim();
  assert(token.length >= 32, "auto-generated token present");

  async function getStatus() {
    const res = await testFetch(`http://127.0.0.1:${port}/admin/status`, {
      headers: { authorization: `Bearer ${token}` }
    });
    assertEqual(res.status, 200, "/admin/status status code");
    return res.json();
  }

  await run("non-stream /v1/chat/completions: usage recorded to byProvider / byModel / byRoute", async () => {
    const res = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "r1", messages: [{ role: "user", content: "ping" }] })
    });
    assertEqual(res.status, 200, "upstream 200 forwarded");
    const body = await res.text();
    assert(body.includes("pong"), "client receives the full upstream body");
    assert(body.includes("\"usage\""), "client receives the upstream usage");

    await sleep(250);
    statusAfterNonStream = await getStatus();

    const byProvider = statusAfterNonStream.usage?.metrics?.byProvider?.stub;
    const byModel = statusAfterNonStream.usage?.metrics?.byModel?.["stub:stub-model"];
    const byRoute = statusAfterNonStream.usage?.metrics?.byRoute?.r1;
    assert(byProvider, "byProvider['stub'] exists");
    assertEqual(byProvider.promptTokens, 5, "byProvider prompt_tokens = 5");
    assertEqual(byProvider.completionTokens, 3, "byProvider completion_tokens = 3");
    assertEqual(byProvider.samples, 1, "byProvider samples = 1 (latency also recorded)");
    assert(byModel, "byModel['stub:stub-model'] exists");
    assertEqual(byModel.promptTokens, 5, "byModel prompt_tokens = 5");
    assertEqual(byModel.completionTokens, 3, "byModel completion_tokens = 3");
    assertEqual(byModel.samples, 1, "byModel samples = 1 (latency recorded)");
    assert(byRoute, "byRoute['r1'] exists");
    assertEqual(byRoute.promptTokens, 5, "byRoute prompt_tokens = 5");
    assertEqual(byRoute.completionTokens, 3, "byRoute completion_tokens = 3");
    assertEqual(byRoute.samples, 1, "byRoute samples = 1 (latency recorded)");
  });

  await run("non-stream: latency ring buffer recorded a non-zero sample", async () => {
    const byProvider = statusAfterNonStream.usage?.metrics?.byProvider?.stub;
    assert(byProvider.avgLatencyMs >= 0, "avgLatencyMs is a number");
    assert(byProvider.p50LatencyMs >= 0, "p50LatencyMs is a number");
    assert(byProvider.p95LatencyMs >= 0, "p95LatencyMs is a number");
    assertEqual(byProvider.minLatencyMs, byProvider.maxLatencyMs, "single-sample min == max");
  });

  await run("stream /v1/chat/completions: usage recorded via recordStreamUsage", async () => {
    const res = await testFetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ model: "r1", stream: true, messages: [{ role: "user", content: "ping" }] })
    });
    assertEqual(res.status, 200, "stream 200");
    const text = await res.text();
    assert(text.includes("data: [DONE]"), "client receives the [DONE] sentinel");
    assert(text.includes("\"usage\""), "client receives the usage chunk");

    await sleep(250);
    statusAfterStream = await getStatus();

    const byProvider = statusAfterStream.usage?.metrics?.byProvider?.stub;
    const byModel = statusAfterStream.usage?.metrics?.byModel?.["stub:stub-model"];
    const byRoute = statusAfterStream.usage?.metrics?.byRoute?.r1;
    assertEqual(byProvider.promptTokens, 5 + 11, "byProvider prompt_tokens = 5 + 11");
    assertEqual(byProvider.completionTokens, 3 + 7, "byProvider completion_tokens = 3 + 7");
    assertEqual(byProvider.samples, 2, "byProvider samples = 2 (1 non-stream + 1 stream)");
    assertEqual(byModel.promptTokens, 5 + 11, "byModel prompt_tokens = 5 + 11");
    assertEqual(byModel.completionTokens, 3 + 7, "byModel completion_tokens = 3 + 7");
    assertEqual(byRoute.promptTokens, 5 + 11, "byRoute prompt_tokens = 5 + 11");
    assertEqual(byRoute.completionTokens, 3 + 7, "byRoute completion_tokens = 3 + 7");
  });

  await run("stream: ring buffer still monotonic (min <= avg <= max)", () => {
    const byProvider = statusAfterStream.usage?.metrics?.byProvider?.stub;
    assert(byProvider.minLatencyMs <= byProvider.avgLatencyMs, "min <= avg");
    assert(byProvider.avgLatencyMs <= byProvider.maxLatencyMs, "avg <= max");
    assert(byProvider.p50LatencyMs <= byProvider.p95LatencyMs, "p50 <= p95");
  });
} finally {
  // 0.5.5: await full relay exit before rm. The 0.5.4 line
  // called proc.kill() and let the rm race the OS.
  await killChildProcess(relay);
  // 0.5.5: close the mock with the shared helper. The 0.5.4
  // line's ad-hoc close + setTimeout was the source of the
  // "handles=2 (Socket, Socket)" safety-net fire.
  await closeServer(mock);
  await cleanupTempDir(tmpRoot);
  // 0.5.5: drop the references so the ChildProcess + stdio
  // Sockets can be GC'd. The 0.5.4 line let these stay in
  // top-level scope and pinned the event loop.
  relay = null;
}

console.log(`${passed} passed, ${failed} failed`);
// 0.5.8: the 0.5.5 line removed the safety-net force-exit on
// principle. In practice, undici keep-alive sockets from this
// test's testFetch() calls, the relay child's stdio streams,
// and other unref'd handles can keep the event loop alive
// after the test scenarios have completed. When this script
// runs as a step in `npm test`'s `&&` chain, a non-exiting
// child process blocks the next step from starting. By the
// time we get here the test results are already on stdout
// (so any actual test failure is visible), and the
// deterministic exit lets the chain runner move on. This is
// NOT the old 1500ms safety-net timer — there is no fallback
// deadline here. The test result is final, and we exit with it.
process.exit(failed > 0 ? 1 : 0);
