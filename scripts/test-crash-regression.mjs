import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = pathResolve(fileURLToPath(new URL("..", import.meta.url)));
const RELAY_PORT = 19392;
const HOST = "127.0.0.1";

let relayProcess;

function startRelay(config) {
  const configPath = pathResolve(ROOT, "data", "test-crash-config.json");
  const dataDir = pathResolve(ROOT, "data");
  const statePath = pathResolve(ROOT, "data", "test-crash-state.json");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(configPath, JSON.stringify(config));

  return new Promise((done, fail) => {
    const child = spawn(process.execPath, ["src/server.js"], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(RELAY_PORT),
        OPENRELAY_ALLOW_NO_AUTH: "true",
        OPENRELAY_CONFIG: configPath,
        OPENRELAY_STATE: statePath,
        OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT: "true"
      },
      stdio: ["ignore", "pipe", "pipe"],
      shell: false
    });
    let started = false;
    const outBuf = [];
    child.stdout.on("data", (d) => {
      const text = d.toString();
      outBuf.push(text);
      if (!started && text.includes("is running at")) {
        started = true;
        done(child);
      }
    });
    child.stderr.on("data", (d) => {
      outBuf.push(d.toString());
    });
    child.on("exit", (code) => {
      if (!started) fail(new Error(`relay exited before start (code=${code}): ${outBuf.join("").slice(-500)}`));
    });
    setTimeout(() => { if (!started) fail(new Error("relay start timeout. Output: " + outBuf.join("").slice(-500))); }, 15000);
  });
}

function postChat(model, bodyOverrides = {}) {
  return fetch(`http://${HOST}:${RELAY_PORT}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }], ...bodyOverrides })
  });
}

async function ensureAlive() {
  const healthRes = await fetch(`http://${HOST}:${RELAY_PORT}/health`);
  assert.equal(healthRes.status, 200, "Process must be alive");
}

async function restartRelay(config) {
  if (relayProcess && typeof relayProcess.kill === "function") {
    relayProcess.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
  }
  try {
    relayProcess = await startRelay(config);
    await new Promise((r) => setTimeout(r, 500));
  } catch (err) {
    throw new Error(`Failed to start relay: ${err.message}`);
  }
}

describe("crash regression", { timeout: 45000 }, () => {
  after(() => {
    if (relayProcess && typeof relayProcess.kill === "function") {
      relayProcess.kill("SIGTERM");
    }
  });

  it("no-available-key returns 503 without crashing", async () => {
    await restartRelay({
      defaultProvider: "keyless-provider",
      providers: [{
        name: "keyless-provider",
        baseUrl: "http://127.0.0.1:19999/v1",
        keyEnv: "NONEXISTENT_KEY",
        apiFormat: "openai",
        models: ["test-model"]
      }],
      profiles: [{ name: "default", defaultModel: "test-model" }],
      activeProfile: "default",
      retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
      limits: { maxBodyBytes: 10485760, dailyRequests: null, providers: {}, routes: {}, models: {} },
      history: { retentionDays: 14 },
      healthChecks: { enabled: false, intervalMinutes: 60, providers: [] }
    });
    const res = await postChat("test-model");
    assert.equal(res.status, 503, "no-key -> 503, not crash");
    const data = await res.json();
    assert.ok(data.error === "no_available_upstream" || data.error === "no_available_key" || data.error === "proxy_failed", `error: ${data.error}`);
    await ensureAlive();
  });

  it("unreachable upstream returns 502 without crashing", async () => {
    await restartRelay({
      defaultProvider: "dead-provider",
      providers: [{
        name: "dead-provider",
        baseUrl: "http://127.0.0.1:19998/v1",
        keyEnv: null,
        apiFormat: "openai",
        models: ["test-model"]
      }],
      profiles: [{ name: "default", defaultModel: "test-model" }],
      activeProfile: "default",
      retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
      limits: { maxBodyBytes: 10485760, dailyRequests: null, providers: {}, routes: {}, models: {} },
      history: { retentionDays: 14 },
      healthChecks: { enabled: false, intervalMinutes: 60, providers: [] }
    });
    const res = await postChat("test-model");
    assert.ok(res.status === 502 || res.status === 503, `unreachable -> 502/503, got ${res.status}`);
    await ensureAlive();
  });

  it("/admin/status recentRequests records failures without prompt content", async () => {
    const statusRes = await fetch(`http://${HOST}:${RELAY_PORT}/admin/status`);
    const status = await statusRes.json();
    assert.ok(Array.isArray(status.recentRequests), "recentRequests must be array");
    const failed = status.recentRequests.filter((r) => r.status >= 400);
    if (failed.length > 0) {
      const json = JSON.stringify(failed[0]);
      assert.ok(!json.includes('"hi"'), "recentRequests must NOT contain original prompt");
      assert.ok(typeof failed[0].elapsedMs === "number");
    }
    await ensureAlive();
  });

  it("streaming to unreachable upstream does not crash", async () => {
    const res = await postChat("test-model", { stream: true });
    assert.ok(res.status === 502 || res.status === 503, `stream fail -> 502/503, got ${res.status}`);
    await ensureAlive();
  });

  it("multiple concurrent failures do not crash", async () => {
    const results = await Promise.allSettled([
      postChat("test-model"),
      postChat("test-model"),
      postChat("test-model")
    ]);
    for (const r of results) {
      assert.equal(r.status, "fulfilled", "All requests must complete without crashing");
      if (r.status === "fulfilled") {
        assert.ok(r.value.status >= 400, "All should be error responses");
      }
    }
    await ensureAlive();
  });
});
