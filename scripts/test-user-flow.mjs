import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { killChildProcess } from "./test-utils.mjs";

async function json(base, path, opts) {
  const url = base + path;
  const res = await fetch(url, {
    ...opts,
    headers: { "connection": "close", "content-type": "application/json", ...(opts?.headers || {}) },
    signal: AbortSignal.timeout(10000)
  });
  const text = await res.text();
  if (!res.ok) throw new Error("HTTP " + res.status + " for " + url + ": " + text.slice(0, 200));
  try { return JSON.parse(text); } catch { return text; }
}

test("user flow: full CRUD lifecycle", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "orel-crud-"));
  const keystoreDir = resolve(tmpRoot, "data");
  const configPath = resolve(tmpRoot, "config.json");
  const statePath = resolve(tmpRoot, "state.json");
  await mkdir(keystoreDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    defaultProvider: "local",
    providers: [
      { name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] },
      { name: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", keyEnv: "DEEPSEEK_API_KEYS", models: ["deepseek-chat"] }
    ],
    routes: [{ name: "r1", candidates: [{ provider: "local", model: "local-model" }] }],
    profiles: [{ name: "default", defaultModel: "r1" }],
    activeProfile: "default"
  }));

  const proc = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: "0", OPENRELAY_ALLOW_NO_AUTH: "true", OPENRELAY_CONFIG: configPath, OPENRELAY_KEYSTORE_DIR: keystoreDir, OPENRELAY_STATE: statePath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  proc.stderr.on("data", () => {});
  const port = await new Promise((res, rej) => {
    let b = ""; const t = setTimeout(() => rej(new Error("server start timeout")), 10000);
    proc.stdout.on("data", (c) => { b += c.toString(); const m = b.match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(parseInt(m[1], 10)); } });
  });
  const base = `http://127.0.0.1:${port}`;

  try {
    const st = await json(base, "/admin/status");
    assert.ok(st.ok);
    assert.equal(st.profiles.activeProfile, "default");

    // Add Web Key
    const ak = await json(base, "/admin/keys", { method: "POST", body: JSON.stringify({ provider: "deepseek", value: "sk-fake-test-key-12345678", label: "test-key" }) });
    assert.ok(ak.ok, "add key");

    // Add provider
    const ap = await json(base, "/admin/providers", { method: "POST", body: JSON.stringify({ name: "testprov", baseUrl: "https://api.testprov.com/v1", apiFormat: "openai", models: ["test-model"] }) });
    assert.ok(ap.ok, "add provider");

    // Add route
    const ar = await json(base, "/admin/routes", { method: "POST", body: JSON.stringify({ name: "testroute", strategy: "fallback", candidates: [{ provider: "testprov", model: "test-model" }] }) });
    assert.ok(ar.ok, "add route");

    // Create profile
    const cp = await json(base, "/admin/profile/update", { method: "POST", body: JSON.stringify({ profile: { name: "testprofile", defaultModel: "testroute" } }) });
    assert.ok(cp.ok, "create profile");

    // Switch profile
    const sp = await json(base, "/admin/profile", { method: "POST", body: JSON.stringify({ profile: "testprofile" }) });
    assert.equal(sp.activeProfile, "testprofile");

    // Verify in status
    const st2 = await json(base, "/admin/status");
    assert.equal(st2.profiles.activeProfile, "testprofile");

    // Verify in runtime state
    if (existsSync(statePath)) {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      assert.equal(typeof state.activeProfile, "string");
      assert.equal(state.activeProfile, "testprofile");
    }

    // Verify routes endpoint
    const routes = await json(base, "/admin/routes");
    assert.ok(routes.routes.some((r) => r.name === "testroute"), "testroute should exist");

    // Verify providers endpoint
    const provs = await json(base, "/admin/providers");
    assert.ok(provs.providers.some((p) => p.name === "testprov"), "testprov should exist");

    // Verify render-tab endpoints
    for (const tab of ["overview", "providers", "routes", "tools", "usage", "settings"]) {
      const rt = await json(base, "/admin/render-tab?tab=" + tab);
      assert.ok(rt.ok, "render-tab " + tab + " should be ok");
    }
  } finally {
    await killChildProcess(proc);
  }
});

test("user flow: persistence across restart", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "orel-persist-"));
  const keystoreDir = resolve(tmpRoot, "data");
  const configPath = resolve(tmpRoot, "config.json");
  const statePath = resolve(tmpRoot, "state.json");
  await mkdir(keystoreDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    defaultProvider: "local",
    providers: [{ name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] }],
    routes: [],
    profiles: [{ name: "default", defaultModel: "local:local-model" }],
    activeProfile: "default"
  }));

  const sharedEnv = () => ({ ...process.env, PORT: "0", OPENRELAY_ALLOW_NO_AUTH: "true", OPENRELAY_CONFIG: configPath, OPENRELAY_KEYSTORE_DIR: keystoreDir, OPENRELAY_STATE: statePath });

  // First run
  const p1 = spawn(process.execPath, ["src/server.js"], { cwd: process.cwd(), env: sharedEnv(), stdio: ["ignore", "pipe", "pipe"] });
  p1.stderr.on("data", () => {});
  const port1 = await new Promise((res, rej) => {
    let b = ""; const t = setTimeout(() => rej(new Error("start timeout")), 10000);
    p1.stdout.on("data", (c) => { b += c.toString(); const m = b.match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(parseInt(m[1], 10)); } });
  });
  const b1 = `http://127.0.0.1:${port1}`;
  try {
    await json(b1, "/admin/routes", { method: "POST", body: JSON.stringify({ name: "persist-route", strategy: "fallback", candidates: [{ provider: "local", model: "local-model" }] }) });
    await json(b1, "/admin/profile/update", { method: "POST", body: JSON.stringify({ profile: { name: "persist-profile", defaultModel: "persist-route" } }) });
    await json(b1, "/admin/profile", { method: "POST", body: JSON.stringify({ profile: "persist-profile" }) });
    const st1 = await json(b1, "/admin/status");
    assert.equal(st1.profiles.activeProfile, "persist-profile");
    // Wait for runtime-state debounce (200ms) to flush to disk
    await new Promise((r) => setTimeout(r, 1000));
  } finally {
    await killChildProcess(p1);
  }

  await new Promise((r) => setTimeout(r, 1500));

  // Second run — reuse same configPath + statePath
  const p2 = spawn(process.execPath, ["src/server.js"], { cwd: process.cwd(), env: sharedEnv(), stdio: ["ignore", "pipe", "pipe"] });
  p2.stderr.on("data", () => {});
  const port2 = await new Promise((res, rej) => {
    let b = ""; const t = setTimeout(() => rej(new Error("start timeout")), 10000);
    p2.stdout.on("data", (c) => { b += c.toString(); const m = b.match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(t); res(parseInt(m[1], 10)); } });
  });
  const b2 = `http://127.0.0.1:${port2}`;
  try {
    const st2 = await json(b2, "/admin/status");
    assert.equal(st2.profiles.activeProfile, "persist-profile", "activeProfile should persist after restart");

    if (existsSync(statePath)) {
      const state = JSON.parse(await readFile(statePath, "utf8"));
      assert.equal(typeof state.activeProfile, "string");
      assert.equal(state.activeProfile, "persist-profile");
    }
  } finally {
    await killChildProcess(p2);
  }
});
