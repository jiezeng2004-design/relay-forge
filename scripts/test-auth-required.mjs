// 0.5.3: end-to-end coverage for the default-on /v1/* auth gate.
//
// Strategy: spawn the relay as a child process with PORT=0
// (ephemeral) and OPENRELAY_ROOT pointing at a tmp dir so the
// auto-generated token lands at <tmp>/data/security/relay-token
// rather than the real project dir. Read the token from disk,
// then exercise the 16 cases the spec requires.
//
// 0.5.5 cleanup contract (see scripts/test-utils.mjs):
//   * killChildProcess replaces the local killRelay. We now
//     wait for the relay to fully exit (SIGTERM + 2s SIGKILL
//     fallback + stdio destroy) so the test's rm(tmpDir) never
//     races the relay's state.json rename.
//   * closeServer replaces the ad-hoc `mock.close(...)` Promise.
//     The 0.5.4 line dropped closeIdleConnections /
//     closeAllConnections, which is what caused the safety net
//     to fire with "handles=2 (Socket, Socket)".
//   * testFetch wraps globalThis.fetch with `Connection: close`
//     so undici does not park a 5s keep-alive Socket on the
//     event loop after the test scenarios return.
//   * The 1500ms safety-net force-exit is GONE. The 0.5.4 line
//     relied on it because the cleanup was incomplete. With
//     the helpers above, the loop drains naturally; if a future
//     change does leak a handle, we want to see the actual
//     failure, not a force-exit hiding it.
//
// Critical: the test functions run INSIDE the try block (so
// the relay is still alive). The previous iteration queued
// them as deferred callbacks and the killRelay() in finally
// tore the relay down before any HTTP call fired.

import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
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
let passed = 0;
let failed = 0;
const failures = [];

function logPass(name) { console.log(`  ok  ${name}`); passed += 1; }
function logFail(name, error) { console.log(`  FAIL  ${name}: ${error.message}`); failed += 1; failures.push({ name, error }); }

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

function assert(cond, msg) { if (!cond) throw new Error("assertion failed: " + msg); }
function assertEqual(actual, expected, msg) { if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); }

async function startMockUpstream() {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({
        id: "chatcmpl-stub",
        object: "chat.completion",
        model: "stub",
        choices: [{ index: 0, message: { role: "assistant", content: "pong" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 }
      }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  // 0.5.4: don't let the server keep the event loop alive
  // after the test finishes. closeIdleConnections() and a
  // graceful close() on its own are not always enough on
  // Windows when undici has keep-alive sockets cached.
  server.unref();
  return server;
}

function spawnRelay({ env, rootOverride, tmpDir } = {}) {
  let stderrBuf = "";
  const proc = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_ROOT: rootOverride || tmpDir,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpDir, "state.json"),

      // Test isolation: do not let CI or the developer shell force auth mode.
      // Each stage can re-enable the no-auth path or set an explicit token
      // via the `env` argument that follows.
      RELAYFORGE_ALLOW_NO_AUTH: "",
      OPENRELAY_ALLOW_NO_AUTH: "",
      RELAYFORGE_TOKEN: "",
      RELAY_TOKEN: "",
      OPENRELAY_TOKEN: "",

      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
  });
  // 0.5.4: remove the stderr dumper after the process exits.
  // Otherwise a long-lived reference to the closed proc keeps
  // the event loop aware of the (already-drained) stdio
  // streams and prevents the loop from idling out.
  proc.once("exit", () => {
    if (stderrBuf) process.stderr.write("relay stderr: " + stderrBuf);
    proc.stderr.removeAllListeners("data");
  });
  return proc;
}

function waitForBanner(proc) {
  return new Promise((resolveBanner, reject) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    const onChunk = (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      // Banner can also arrive on stderr (console.warn writes
      // there), so check both.
      // Match the "running at" line specifically to avoid matching
      // warning messages that also contain 127.0.0.1:PORT.
      const runningMatch = (stdoutBuf + "\n" + stderrBuf).match(/is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (runningMatch) {
        proc.stdout.off("data", onChunk);
        proc.stderr.off("data", onChunk);
        setTimeout(() => resolveBanner({ port: Number(runningMatch[1]), stdout: stdoutBuf, stderr: stderrBuf }), 200);
      }
    };
    proc.stdout.on("data", onChunk);
    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
      const text = stderrBuf;
      const runningMatch = (stdoutBuf + "\n" + text).match(/is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (runningMatch) {
        proc.stdout.off("data", onChunk);
        proc.stderr.off("data", onChunk);
        setTimeout(() => resolveBanner({ port: Number(runningMatch[1]), stdout: stdoutBuf, stderr: stderrBuf }), 200);
      }
    });
    proc.on("exit", (code) => {
      if (!stdoutBuf.includes("is running at")) {
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

// Stage 1: tmp project root with a minimal config.json. The
// mock upstream is shared between the auth-required and
// no-auth scenarios.
const mock = await startMockUpstream();
const mockPort = mock.address().port;
const configJson = JSON.stringify({
  defaultProvider: "local",
  providers: [
    { name: "local", baseUrl: `http://127.0.0.1:${mockPort}/v1`, keyEnv: null, models: ["stub"] }
  ],
  routes: [{ name: "r", strategy: "fallback", candidates: [{ provider: "local", model: "stub" }] }],
  profiles: [{ name: "default", defaultModel: "r" }],
  activeProfile: "default",
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: { maxBodyBytes: 1048576 },
  history: { retentionDays: 3 },
  healthChecks: { enabled: false }
}, null, 2);

const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-auth-"));
await writeFile(resolve(tmpRoot, "config.json"), configJson);

let relayA = null;
let portA = null;
let generatedToken = null;
let bannerText = "";

try {
  relayA = spawnRelay({ tmpDir: tmpRoot });
  const banner = await waitForBanner(relayA);
  portA = banner.port;
  bannerText = banner.stdout;

  const tokenPath = resolve(tmpRoot, "data", "security", "relay-token");
  const tokenRaw = await readFile(tokenPath, "utf8");
  generatedToken = tokenRaw.trim();

  await run("auto-generated token file exists on first start", () => {
    assert(generatedToken.length >= 32, `token has at least 32 chars (got ${generatedToken.length})`);
    assert(/^[a-f0-9]+$/i.test(generatedToken), "token is hex-encoded");
  });

  await run("startup banner logs the masked token, never the full one", () => {
    assert(bannerText.includes("local relay token:"), "banner contains 'local relay token:'");
    const maskedMatch = bannerText.match(/local relay token:\s+(\S+)/);
    assert(maskedMatch, "banner contains a masked token form");
    const masked = maskedMatch[1].replace(/[()]/g, "");
    assert(!masked.includes(generatedToken), "masked form does NOT leak the full token");
    assert(masked.includes("..."), "masked form uses '...' separator");
  });

  await run("no Authorization -> 401 from /v1/chat/completions", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assertEqual(res.status, 401, "status code");
    const body = await res.text();
    assert(body.includes("unauthorized"), `body contains 'unauthorized' (got: ${body.slice(0, 200)})`);
    assert(!body.includes(generatedToken), "response body does not echo the token");
  });

  await run("wrong token -> 401 from /v1/chat/completions", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer wrong-token-value" },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assertEqual(res.status, 401, "status code with wrong token");
  });

  await run("right token -> not 401 (proxied to upstream)", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${generatedToken}` },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assert(res.status !== 401, `status is not 401 (got ${res.status})`);
    assert(res.status >= 200 && res.status < 500, `status is in 2xx-4xx (got ${res.status})`);
  });

  await run("x-relay-token header is accepted as a legacy alias", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-relay-token": generatedToken },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assert(res.status !== 401, `x-relay-token grants access (got ${res.status})`);
  });

  await run("/v1/models requires auth by default (401 without token)", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/models`);
    assertEqual(res.status, 401, "status code without token");
  });

  await run("/v1/models with valid token returns 200", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/v1/models`, {
      headers: { authorization: `Bearer ${generatedToken}` }
    });
    assertEqual(res.status, 200, "status code with token");
  });

  // auth.publicModels=true allows /v1/models without token (future test with custom config)

  await run("/admin/auth/token returns the full token when the caller is admin-authed", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/admin/auth/token`, {
      headers: { authorization: `Bearer ${generatedToken}` }
    });
    assertEqual(res.status, 200, "status code");
    const body = await res.json();
    assertEqual(body.token, generatedToken, "full token returned");
    assertEqual(body.source, "generated", "source is 'generated' on first start");
  });

  // 0.5.4: /admin/auth/token without Authorization returns 401.
  await run("/admin/auth/token without Authorization -> 401", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/admin/auth/token`);
    assertEqual(res.status, 401, "status code without auth");
  });

  // 0.5.4: /admin/auth/token with the wrong token returns 401.
  await run("/admin/auth/token with wrong token -> 401", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/admin/auth/token`, {
      headers: { authorization: "Bearer wrong-token-value" }
    });
    assertEqual(res.status, 401, "status code with wrong token");
  });

  // 0.5.4: /admin/status in the AUTHED stage (relayA) must
  // not carry the full relay token. The previous shape had
  // relayAuth.apiKey = "<full token>"; the new shape exposes
  // only masked hints. We hit /admin/status with the
  // generated token (since /admin/* already requires auth via
  // the dispatcher's isAdminPath && !isAuthorized check).
  await run("/admin/status does NOT include the full relay token (0.5.4)", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portA}/admin/status`, {
      headers: { authorization: `Bearer ${generatedToken}` }
    });
    assertEqual(res.status, 200, "status code");
    const body = await res.json();
    assert(body.relayAuth, "relayAuth field present");
    assert(!("apiKey" in body.relayAuth), `relayAuth.apiKey must NOT be present (was leaked). body=${JSON.stringify(body.relayAuth).slice(0, 200)}`);
    assert(!("token" in body.relayAuth), `relayAuth.token must NOT be present (was leaked). body=${JSON.stringify(body.relayAuth).slice(0, 200)}`);
    assert(typeof body.relayAuth.apiKeyHint === "string", "apiKeyHint is a string (masked form)");
    assert(body.relayAuth.apiKeyHint.length < generatedToken.length, "apiKeyHint is shorter than the full token");
  });
} finally {
  // 0.5.5: order matters. killChildProcess waits for the relay
  // to fully exit, so its state.json rename has either
  // completed or been aborted by the OS. Only then do we rm.
  await killChildProcess(relayA);
  // 0.5.4: drop the reference so the ChildProcess + its stdio
  // Sockets can be GC'd. Without this the variables stay in
  // top-level scope and pin the event loop.
  relayA = null;
}

// Stage 2: tmp root with OPENRELAY_ALLOW_NO_AUTH=true. No
// token file should be created and the dashboard should show
// the warning copy.
const tmpRootNoAuth = await mkdtemp(resolve(tmpdir(), "openrelay-noauth-"));
await writeFile(resolve(tmpRootNoAuth, "config.json"), configJson);
const tmpRootOpenRelayToken = await mkdtemp(resolve(tmpdir(), "openrelay-token-alias-"));
await writeFile(resolve(tmpRootOpenRelayToken, "config.json"), configJson);
let relayB = null;
let portB = null;
let bannerB = "";
let relayC = null;

try {
  relayB = spawnRelay({
    env: { OPENRELAY_ALLOW_NO_AUTH: "true" },
    tmpDir: tmpRootNoAuth
  });
  const banner = await waitForBanner(relayB);
  portB = banner.port;
  bannerB = banner.stdout + "\n" + (banner.stderr || "");

  await run("OPENRELAY_ALLOW_NO_AUTH=true prints a warning banner", () => {
    assert(bannerB.toLowerCase().includes("warning") && (bannerB.includes("allowNoAuth") || bannerB.includes("running without authentication")), "startup banner contains the warning");
  });

  await run("OPENRELAY_ALLOW_NO_AUTH=true does NOT create a token file", async () => {
    const tokenPath = resolve(tmpRootNoAuth, "data", "security", "relay-token");
    const fs = await import("node:fs/promises");
    let exists = true;
    try { await fs.access(tokenPath); } catch { exists = false; }
    assert(!exists, `token file should not exist at ${tokenPath}`);
  });

  await run("OPENRELAY_ALLOW_NO_AUTH=true -> /v1/chat/completions is open (no 401)", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portB}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assert(res.status !== 401, `no auth required (got ${res.status})`);
  });

  await run("Dashboard HTML in no-auth mode contains the warning copy", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portB}/`);
    assertEqual(res.status, 200, "status code");
    const html = await res.text();
    assert(
      html.includes("OPENRELAY_ALLOW_NO_AUTH") || html.includes("无鉴权模式") || html.includes("data-no-auth-banner"),
      "dashboard HTML includes the no-auth warning copy"
    );
  });

  await run("/admin/status in no-auth mode reports allowNoAuth=true", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portB}/admin/status`);
    assertEqual(res.status, 200, "status code");
    const body = await res.json();
    assertEqual(body.relayAuth?.allowNoAuth, true, "relayAuth.allowNoAuth is true");
    assertEqual(body.relayAuth?.tokenRequired, false, "relayAuth.tokenRequired is false");
    assertEqual(body.relayAuth?.tokenSource, "allowNoAuth", "tokenSource is 'allowNoAuth'");
  });

  // Stage 3: upstream-compatible OPENRELAY_TOKEN env var. RELAY_TOKEN
  // remains preferred, but operators migrating from upstream can set
  // OPENRELAY_TOKEN without creating a generated disk token.
  relayC = spawnRelay({
    env: { OPENRELAY_TOKEN: "openrelay-token-e2e" },
    tmpDir: tmpRootOpenRelayToken
  });
  const bannerC = await waitForBanner(relayC);
  const portC = bannerC.port;

  await run("OPENRELAY_TOKEN env alias does NOT create a generated token file", async () => {
    const tokenPath = resolve(tmpRootOpenRelayToken, "data", "security", "relay-token");
    const fs = await import("node:fs/promises");
    let exists = true;
    try { await fs.access(tokenPath); } catch { exists = false; }
    assert(!exists, `token file should not exist at ${tokenPath}`);
  });

  await run("OPENRELAY_TOKEN env alias protects /v1/chat/completions", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portC}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assertEqual(res.status, 401, "missing token should be rejected");
  });

  await run("OPENRELAY_TOKEN env alias authorizes correct Bearer token", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portC}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer openrelay-token-e2e" },
      body: JSON.stringify({ model: "r", messages: [{ role: "user", content: "ping" }] })
    });
    assert(res.status !== 401, `correct OPENRELAY_TOKEN should authorize (got ${res.status})`);
  });

  await run("/admin/status reports OPENRELAY_TOKEN source without leaking the token", async () => {
    const res = await fetchWithTimeout(`http://127.0.0.1:${portC}/admin/status`, {
      headers: { authorization: "Bearer openrelay-token-e2e" }
    });
    assertEqual(res.status, 200, "status code");
    const body = await res.json();
    assertEqual(body.relayAuth?.tokenRequired, true, "tokenRequired");
    assertEqual(body.relayAuth?.tokenSource, "openrelay_env", "tokenSource");
    const serialized = JSON.stringify(body);
    assert(!serialized.includes("openrelay-token-e2e"), "full OPENRELAY_TOKEN must not leak");
  });
} finally {
  // 0.5.5: await full relay exit before rm. See Stage 1 finally
  // for the full rationale.
  await killChildProcess(relayB);
  await killChildProcess(relayC);
  // 0.5.4: drop the reference so the ChildProcess + its stdio
  // Sockets can be GC'd.
  relayB = null;
  // 0.5.5: close the mock with the shared helper. The 0.5.4
  // line's ad-hoc close + setTimeout was the source of the
  // "handles=2 (Socket, Socket)" safety-net fire. closeServer
  // does closeIdleConnections + closeAllConnections + a bounded
  // graceful close so the loop can drain naturally.
  await closeServer(mock);
  await cleanupTempDir(tmpRoot);
  await cleanupTempDir(tmpRootNoAuth);
  await cleanupTempDir(tmpRootOpenRelayToken);
}

console.log(`${passed} passed, ${failed} failed`);
// 0.5.8: the 0.5.5 line removed the safety-net force-exit on
// principle ("if a future change leaks a handle, we want to
// see the test failure"). In practice, undici keep-alive
// sockets from this test's testFetch() calls, the relay child's
// stdio streams, and other unref'd handles can keep the event
// loop alive after the test scenarios have completed. When
// this script runs as a step in `npm test`'s `&&` chain, a
// non-exiting child process blocks the next step from
// starting. By the time we get here the test results are
// already on stdout (so any actual test failure is visible),
// and the deterministic exit lets the chain runner move on.
// This is NOT the old 1500ms safety-net timer — there is no
// fallback deadline here. The test result is final, and we
// exit with it.
process.exit(failed > 0 ? 1 : 0);
