import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = await mkdtemp(resolve(tmpdir(), "openrelay-local-safe-"));
const mockPort = 39351;
const relayPort = 39352;
const calls = [];
let relayProcess;
let authRelayProcess;
let mockServer;
let relayLog;
let authRelayLog;
const mockAuthLog = []; // [{ model, authorization }] for the last chat call to mock

try {
  mockServer = await startMockServer(mockPort, calls);
  const configPath = resolve(tmpDir, "config.json");
  const statePath = resolve(tmpDir, "state.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        defaultProvider: "mock",
        providers: [
          {
            name: "mock",
            baseUrl: `http://127.0.0.1:${mockPort}/v1`,
            keyEnv: null,
            models: ["model-a", "model-b", "slow-model", "idle-stream-model"],
            balanceEndpoint: {
              url: `http://127.0.0.1:${mockPort}/v1/balance`,
              method: "GET",
              useKey: false,
              fieldMap: { remaining: "remaining", limit: "limit", used: "used", currency: "currency" }
            }
          }
        ],
        routes: [
          {
            name: "rr",
            strategy: "round_robin",
            limits: { dailyRequests: 2 },
            candidates: [
              { provider: "mock", model: "model-a" },
              { provider: "mock", model: "model-b" }
            ]
          },
          {
            name: "weighted",
            strategy: "weighted",
            candidates: [
              { provider: "mock", model: "model-a", weight: 2 },
              { provider: "mock", model: "model-b", weight: 1 }
            ]
          },
          {
            name: "slow-route",
            strategy: "fallback",
            candidates: [{ provider: "mock", model: "slow-model" }]
          },
          {
            name: "idle-stream-route",
            strategy: "fallback",
            candidates: [{ provider: "mock", model: "idle-stream-model" }]
          }
        ],
        activeProfile: "rr-profile",
        profiles: [
          { name: "rr-profile", description: "round robin default", defaultModel: "rr" },
          { name: "weighted-profile", description: "weighted default", defaultModel: "weighted" }
        ],
        retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 1000, streamIdleTimeoutMs: 10000 },
        limits: { maxBodyBytes: 1048576 },
        history: { retentionDays: 7 },
        healthChecks: { enabled: false, intervalMinutes: 60, providers: ["mock"] }
      },
      null,
      2
    )
  );
  await writeFile(
    statePath,
    JSON.stringify(
      {
        version: 1,
        // Intentionally store activeProfile as an object to verify loader
        // compatibility with both shapes.
        activeProfile: { name: "rr-profile", description: "round robin default", defaultModel: "rr" },
        usage: {
          day: previousDay(),
          daily: { total: 2, routes: { old: 2 }, providers: { mock: 2 }, models: { "mock:model-a": 2 } }
        }
      },
      null,
      2
    )
  );

  authRelayLog = spawnRelay("authRelayProcess", ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: "39353",
      RELAY_TOKEN: "smoke-admin-token",
      OPENRELAY_CONFIG: configPath,
      OPENRELAY_STATE: resolve(tmpDir, "auth-state.json"),
      OPENRELAY_KEYSTORE_DIR: resolve(tmpDir, "auth-keys")
    },
  });
  authRelayProcess = authRelayLog.process;
  await waitForHealth(39353, authRelayLog);
  const authHealth = await fetchJson(`http://127.0.0.1:39353/health`);
  assert(authHealth.ok === true && authHealth.version, "health should include ok and version");
  assert(!("providers" in authHealth) && !("routes" in authHealth) && !("keys" in authHealth) && !("usage" in authHealth), "health should not expose admin status details");
  const adminNoToken = await fetch(`http://127.0.0.1:39353/admin/status`);
  assert(adminNoToken.status === 401, `admin without token should be 401, got ${adminNoToken.status}`);
  const authRoot = await fetch(`http://127.0.0.1:39353/`);
  const authRootText = await authRoot.text();
  assert(authRootText.includes("需要输入 RELAY_TOKEN"), "root should render a minimal token prompt when RELAY_TOKEN is set");
  const adminBadOrigin = await fetch(`http://127.0.0.1:39353/admin/status`, {
    method: "OPTIONS",
    headers: { origin: "http://evil.example" }
  });
  assert(adminBadOrigin.status === 403, `admin OPTIONS from arbitrary origin should be 403, got ${adminBadOrigin.status}`);
  const adminGoodOrigin = await fetch(`http://127.0.0.1:39353/admin/status`, {
    method: "OPTIONS",
    headers: { origin: "http://localhost:39353" }
  });
  assert(adminGoodOrigin.status === 204, `admin OPTIONS from localhost should be 204, got ${adminGoodOrigin.status}`);
  const adminWithToken = await fetchJson(`http://127.0.0.1:39353/admin/status`, {
    headers: { authorization: "Bearer smoke-admin-token" }
  });
  assert(adminWithToken.ok === true, "admin status with token should pass");
  const dashboardWithToken = await fetch(`http://127.0.0.1:39353/`, {
    headers: { authorization: "Bearer smoke-admin-token" }
  });
  const dashboardWithTokenText = await dashboardWithToken.text();
  assert(dashboardWithTokenText.includes("softRefresh"), "authorized dashboard should include soft refresh helper");
  // softRefresh's active path uses window.location.replace(url) (the
  // location.reload() that also appears in the script is a
  // try/catch defensive fallback only — it does not run on the
  // happy path).
  assert(dashboardWithTokenText.includes("window.location.replace("), "softRefresh active path should use location.replace");
  assert(dashboardWithTokenText.includes('class="topbar"'), "authorized dashboard should include the topbar chrome");
  authRelayProcess.kill();
  authRelayProcess = null;

  relayLog = spawnRelay("relayProcess", ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      PORT: String(relayPort),
      // 0.5.3: opt out of /v1/* + /admin/* auth so the smoke
      // test (which exercises the end-to-end relay behavior,
      // not the auth gate) can hit the admin endpoints without
      // wiring in a Bearer token on every request. The auth
      // gate itself is covered by scripts/test-auth-required.mjs.
      OPENRELAY_ALLOW_NO_AUTH: "true",
      OPENRELAY_CONFIG: configPath,
      OPENRELAY_STATE: statePath,
      OPENRELAY_KEYSTORE_DIR: tmpDir
    },
  });
  relayProcess = relayLog.process;

  await waitForHealth(relayPort, relayLog);

  // The mock provider has keyEnv: null. It must be reachable as a
  // no-auth local provider (Ollama-style) WITHOUT having to add a
  // web key first. We verify that on /v1/models + a chat call below.
  // (The web-key admin flow later adds a baseline + a transient
  // key, then deletes both, so this assertion still works.)
  const keystoreInitial = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keystore-status`);
  assert(keystoreInitial.keyCount === 0, "no web keys at the start");
  const callsBeforeNoAuth = calls.length;
  const noAuthChat = await chat(relayPort, "weighted");
  assert(noAuthChat.model === "model-a" || noAuthChat.model === "model-b", "no-auth chat should still reach the mock upstream");
  assert(calls.length === callsBeforeNoAuth + 1, "no-auth chat made an upstream call");
  // Confirm the upstream saw no Authorization header.
  const lastMockCall = mockAuthLog[mockAuthLog.length - 1];
  assert(lastMockCall && lastMockCall.authorization === undefined, `no-auth chat should send no Authorization header, got ${lastMockCall.authorization}`);

  const options = await fetch(`http://127.0.0.1:${relayPort}/v1/chat/completions`, { method: "OPTIONS" });
  assert(options.status === 204, `OPTIONS should return 204, got ${options.status}`);
  assert(options.headers.get("access-control-allow-origin") === "*", "OPTIONS should include CORS headers");
  const models = await fetchJson(`http://127.0.0.1:${relayPort}/v1/models`);
  assert(models.data.some((item) => item.id === "rr"), "route rr should appear in /v1/models");
  assert(models.data.some((item) => item.id === "rr-profile"), "profile rr-profile should appear in /v1/models");

  // The persisted activeProfile was an object; the loader should still
  // resolve it to the profile name.
  const profileBefore = await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`);
  assert(profileBefore.activeProfile === "rr-profile", `initial profile should be rr-profile, got ${profileBefore.activeProfile}`);
  const profileSwitch = await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "weighted-profile" })
  });
  assert(profileSwitch.ok === true && profileSwitch.defaultModel === "weighted", "profile switch should select weighted default model");
  // Switch back so downstream tests keep deterministic order.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "rr-profile" })
  });

  // Profile CRUD: edit + clone + delete + cannot delete active.
  const editResult = await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile/update`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ originalName: "rr-profile", profile: { name: "rr-profile", description: "edited", defaultModel: "rr" } })
  });
  assert(editResult.ok === true, `profile edit should succeed: ${JSON.stringify(editResult)}`);
  const cloneResult = await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile/clone`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ originalName: "rr-profile", newName: "rr-profile-clone" })
  });
  assert(cloneResult.ok === true, `profile clone should succeed: ${JSON.stringify(cloneResult)}`);
  const deleteActive = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/profile/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "rr-profile" })
  });
  assert(deleteActive.ok === false && deleteActive.error === "cannot_delete_active_profile", "should refuse to delete active profile");
  const deleteClone = await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile/delete`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "rr-profile-clone" })
  });
  assert(deleteClone.ok === true, "should delete the cloned profile");

  const editable = await fetchJson(`http://127.0.0.1:${relayPort}/admin/config/raw`);
  assert(editable.config.providers[0].keyCount === undefined, "editable config should not include runtime keyCount");
  assert(editable.config.healthChecks.enabled === false, "editable config should include health check settings");
  assert(editable.config.providers[0].balanceEndpoint === undefined || typeof editable.config.providers[0].balanceEndpoint === "object", "balanceEndpoint should round-trip through editor");
  const initialUsage = await fetchJson(`http://127.0.0.1:${relayPort}/admin/usage`);
  assert(initialUsage.history.some((item) => item.day === previousDay() && item.total === 2), "usage history should include archived previous-day totals");
  const saved = await fetchJson(`http://127.0.0.1:${relayPort}/admin/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: editable.config })
  });
  assert(saved.ok === true, "config save should succeed");
  assert(typeof saved.backupPath === "string", "config save should create a backup for existing config");
  const exported = await fetchJson(`http://127.0.0.1:${relayPort}/admin/config/export`);
  assert(exported.format === "openrelay-local-safe.config.v1", "config export should include format marker");
  assert(exported.config.providers[0].keyCount === undefined, "exported config should not include runtime keyCount");
  const imported = await fetchJson(`http://127.0.0.1:${relayPort}/admin/config/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ config: exported.config })
  });
  assert(imported.ok === true && imported.action === "import", "config import should succeed");
  assert(typeof imported.backupPath === "string", "config import should back up existing config");

  // Provider Web management: templates + create + update + guarded delete.
  const providerTemplates = await fetchJson(`http://127.0.0.1:${relayPort}/admin/provider-templates`);
  assert(providerTemplates.ok === true, "provider templates endpoint should report ok");
  assert(providerTemplates.templates.some((item) => item.name === "deepseek"), "templates should include DeepSeek");
  assert(providerTemplates.templates.some((item) => item.name === "ollama"), "templates should include Ollama");

  const invalidProvider = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "badheaders",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      keyEnv: null,
      models: ["model-a"],
      extraHeaders: { Authorization: "Bearer should-not-be-saved" }
    })
  });
  assert(invalidProvider.ok === false && invalidProvider.error === "invalid_provider", "provider manager should reject secret-like headers");

  const remoteHttpProvider = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "remotehttp",
      baseUrl: "http://api.example.test/v1",
      keyEnv: null,
      models: ["model-a"]
    })
  });
  assert(remoteHttpProvider.ok === false && remoteHttpProvider.error === "invalid_provider", "remote http provider should be refused by default");

  const providerWithKeyEnvSecret = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "badkeyenv",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      keyEnv: "sk-ant-smoke-should-not-be-in-keyenv",
      models: ["model-a"]
    })
  });
  assert(providerWithKeyEnvSecret.ok === false && providerWithKeyEnvSecret.error === "invalid_provider", "provider manager should reject key-shaped keyEnv values");

  const createdProvider = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "localtest",
      displayName: "Local Test",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiFormat: "openai",
      keyEnv: null,
      models: "model-a\nmodel-b",
      extraHeaders: { "x-custom-client": "smoke" },
      balanceEndpoint: { url: `http://127.0.0.1:${mockPort}/v1/balance`, method: "GET", useKey: false }
    })
  });
  assert(createdProvider.ok === true && createdProvider.provider.name === "localtest", "provider create should succeed");

  const insecureProvider = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "insecurehttp",
      displayName: "Insecure HTTP",
      baseUrl: "http://10.0.0.5:8000/v1",
      apiFormat: "openai",
      keyEnv: null,
      models: ["model-a"],
      allowInsecureHttp: true
    })
  });
  assert(insecureProvider.ok === true && insecureProvider.provider.allowInsecureHttp === true, "allowInsecureHttp:true should allow explicit private http");

  const providerList = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers`);
  assert(providerList.ok === true, "provider list should report ok");
  assert(providerList.providers.some((item) => item.name === "localtest"), "provider list should include the new provider");
  assert(providerList.providers.some((item) => item.name === "insecurehttp" && item.insecureHttpRisk === true), "provider list should expose insecure http risk marker");
  assert(providerList.references.mock.some((item) => item.type === "route"), "provider references should include route usage for mock");

  const updatedProvider = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers/localtest`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "localtest",
      displayName: "Local Test Updated",
      baseUrl: `http://127.0.0.1:${mockPort}/v1`,
      apiFormat: "openai",
      keyEnv: null,
      models: ["model-b"]
    })
  });
  assert(updatedProvider.ok === true && updatedProvider.provider.displayName === "Local Test Updated", "provider update should succeed");
  assert(updatedProvider.provider.models.length === 1 && updatedProvider.provider.models[0] === "model-b", "provider update should save model list");

  const providerScopedKey = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers/localtest/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "sk-localtest-inline-1234567890abcdef", label: "inline provider key" })
  });
  assert(providerScopedKey.ok === true && providerScopedKey.key.provider === "localtest", "provider scoped key add should succeed");
  assert(!("value" in providerScopedKey.key), "provider scoped key response should not include plaintext value");
  const providerScopedKeyList = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys?provider=localtest`);
  assert(providerScopedKeyList.keys.some((key) => key.id === providerScopedKey.key.id), "provider scoped key should appear in filtered key list");
  const deleteProviderWithScopedKey = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers/localtest`, { method: "DELETE" });
  assert(deleteProviderWithScopedKey.ok === false && deleteProviderWithScopedKey.error === "provider_in_use", "provider delete should refuse provider scoped web keys");
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(providerScopedKey.key.id)}`, { method: "DELETE" });

  // Route Web management: templates + create + update + guarded delete.
  const routeTemplates = await fetchJson(`http://127.0.0.1:${relayPort}/admin/route-templates`);
  assert(routeTemplates.ok === true, "route templates endpoint should report ok");
  assert(routeTemplates.templates.some((item) => item.name === "offline-local"), "route templates should include offline-local");

  const invalidRouteStrategy = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "bad-strategy",
      strategy: "random",
      candidates: [{ provider: "localtest", model: "model-b", weight: 1 }]
    })
  });
  assert(invalidRouteStrategy.ok === false && invalidRouteStrategy.error === "invalid_route", "route create should reject invalid strategy");

  const invalidRouteWeight = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "bad-weight",
      strategy: "weighted",
      candidates: [{ provider: "localtest", model: "model-b", weight: 0 }]
    })
  });
  assert(invalidRouteWeight.ok === false && invalidRouteWeight.error === "invalid_route", "route create should reject invalid weight");

  const createdRoute = await fetchJson(`http://127.0.0.1:${relayPort}/admin/routes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "smoke-route",
      description: "temporary route from smoke test",
      strategy: "fallback",
      candidates: [{ provider: "localtest", model: "model-b", weight: 1 }],
      limits: { dailyRequests: 5 }
    })
  });
  assert(createdRoute.ok === true && createdRoute.route.name === "smoke-route", "route create should succeed");
  assert(typeof createdRoute.backupPath === "string", "route create should back up existing config");

  const routeList = await fetchJson(`http://127.0.0.1:${relayPort}/admin/routes`);
  assert(routeList.ok === true, "route list should report ok");
  assert(routeList.routes.some((item) => item.name === "smoke-route"), "route list should include the new route");
  assert(routeList.references.rr.some((item) => item.type === "profile"), "route references should include profile usage for rr");

  const updatedRoute = await fetchJson(`http://127.0.0.1:${relayPort}/admin/routes/smoke-route`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "smoke-route",
      description: "temporary updated route from smoke test",
      strategy: "weighted",
      candidates: [{ provider: "localtest", model: "model-b", weight: 3 }],
      limits: { dailyRequests: 7 }
    })
  });
  assert(updatedRoute.ok === true && updatedRoute.route.strategy === "weighted", "route update should succeed");
  assert(updatedRoute.route.candidates[0].weight === 3, "route update should save candidate weight");
  assert(updatedRoute.route.limits.dailyRequests === 7, "route update should save local daily limit");

  const deleteUsedRoute = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/routes/rr`, { method: "DELETE" });
  assert(deleteUsedRoute.ok === false && deleteUsedRoute.error === "route_in_use", "route delete should refuse profile-referenced routes");

  const deletedRoute = await fetchJson(`http://127.0.0.1:${relayPort}/admin/routes/smoke-route`, { method: "DELETE" });
  assert(deletedRoute.ok === true && deletedRoute.removed === "smoke-route", "route delete should remove unreferenced routes");

  const deleteUsedProvider = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers/mock`, { method: "DELETE" });
  assert(deleteUsedProvider.ok === false && deleteUsedProvider.error === "provider_in_use", "provider delete should refuse referenced providers");

  const localtestKey = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "localtest", value: "sk-localtest-smoke-1234567890abcdef", label: "localtest key" })
  });
  assert(localtestKey.ok === true, "temporary provider key should be created");
  const deleteWithKey = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/providers/localtest`, { method: "DELETE" });
  assert(deleteWithKey.ok === false && deleteWithKey.error === "provider_in_use", "provider delete should refuse providers with web keys");
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(localtestKey.key.id)}`, { method: "DELETE" });

  const deletedProvider = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers/localtest`, { method: "DELETE" });
  assert(deletedProvider.ok === true && deletedProvider.removed === "localtest", "provider delete should remove unreferenced provider");
  const deletedInsecureProvider = await fetchJson(`http://127.0.0.1:${relayPort}/admin/providers/insecurehttp`, { method: "DELETE" });
  assert(deletedInsecureProvider.ok === true && deletedInsecureProvider.removed === "insecurehttp", "provider delete should remove explicit insecure provider");

  const providerTest = await fetchJson(`http://127.0.0.1:${relayPort}/admin/test-provider`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", model: "model-a" })
  });
  assert(providerTest.ok === true, "mock provider connectivity test should pass");
  const health = await fetchJson(`http://127.0.0.1:${relayPort}/admin/health-cache`);
  assert(health.mock?.ok === true, "health cache should store provider test result");
  const discovered = await fetchJson(`http://127.0.0.1:${relayPort}/admin/discover-models`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock" })
  });
  assert(discovered.ok === true, "mock model discovery should pass");
  assert(discovered.models.includes("model-a") && discovered.models.includes("model-b"), "model discovery should include mock models");
  const discoveryCache = await fetchJson(`http://127.0.0.1:${relayPort}/admin/model-discovery`);
  assert(discoveryCache.mock?.count === 2, "model discovery cache should store discovered model count");

  const balance = await fetchJson(`http://127.0.0.1:${relayPort}/admin/balance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock" })
  });
  assert(balance.ok === true, `balance check should pass: ${JSON.stringify(balance)}`);
  assert(balance.summary && balance.summary.includes("remaining="), "balance summary should expose remaining= field");
  const balanceCache = await fetchJson(`http://127.0.0.1:${relayPort}/admin/balance-cache`);
  assert(balanceCache.mock?.ok === true, "balance cache should store the result");

  // A balance endpoint that returns 302 must NOT be followed. We
  // register a second provider that points at /v1/balance-redirect
  // and verify the relay refuses it without calling the redirect
  // target.
  const redirectCalls = [];
  globalThis.__openrelayRedirectCalls = redirectCalls;
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/config/import`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      config: {
        ...editable.config,
        providers: editable.config.providers.concat([
          {
            name: "redirector",
            baseUrl: `http://127.0.0.1:${mockPort}/v1`,
            keyEnv: null,
            models: ["model-a"],
            balanceEndpoint: {
              url: `http://127.0.0.1:${mockPort}/v1/balance-redirect`,
              method: "GET",
              useKey: false
            }
          }
        ])
      }
    })
  });
  const redirectBalance = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/admin/balance`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "redirector" })
  });
  assert(redirectBalance.ok === false, `redirect should be refused, got ${JSON.stringify(redirectBalance)}`);
  assert(redirectBalance.error === "balance_endpoint_redirect_refused", `error should be redirect_refused, got ${redirectBalance.error}`);
  assert(redirectBalance.status === 302, `status should be 302, got ${redirectBalance.status}`);
  // And the redirect target was never reached: mock server would have
  // pushed to redirectCalls if Node fetch had chased the 302.
  assert(redirectCalls.length === 0, `redirect target should never be hit, got ${redirectCalls.length} hits`);

  // Switch back to weighted for the chat / cross-format tests so they
  // get a deterministic single candidate order.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "weighted-profile" })
  });

  const auto = await chat(relayPort, "auto");
  assert(auto.model === "model-a", `auto model should use active weighted profile, got ${auto.model}`);
  const first = await chat(relayPort, "rr");
  const second = await chat(relayPort, "rr");
  assert(first.model === "model-a", `first round-robin model should be model-a, got ${first.model}`);
  assert(second.model === "model-b", `second round-robin model should be model-b, got ${second.model}`);
  const anthropic = await anthropicMessage(relayPort, "weighted");
  assert(anthropic.type === "message", "Anthropic-compatible response should be a message");
  assert(anthropic.content?.[0]?.text === "ok", "Anthropic-compatible response should convert upstream text");
  const streamed = await streamChat(relayPort, "weighted");
  assert(streamed.includes("chat.completion.chunk"), "OpenAI-compatible stream should proxy SSE chunks");
  assert(streamed.includes("[DONE]"), "OpenAI-compatible stream should include done marker");

  // /v1/responses: non-streaming still works.
  const responsesResult = await openAIResponse(relayPort, "weighted");
  assert(responsesResult.object === "response", "Responses-compatible endpoint should return a response object");
  assert(responsesResult.output_text === "ok", "Responses-compatible endpoint should expose output_text");

  // /v1/responses: streaming now returns SSE responses events.
  const responsesStreamText = await openAIResponseStream(relayPort, "weighted");
  assert(responsesStreamText.includes("event: response.created"), "Responses stream should emit response.created event");
  assert(responsesStreamText.includes("event: response.output_text.delta"), "Responses stream should emit text delta");
  assert(responsesStreamText.includes("event: response.completed"), "Responses stream should emit response.completed");

  const slowResult = await fetchJsonAllowError(`http://127.0.0.1:${relayPort}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "slow-route", messages: [{ role: "user", content: "slow" }] })
  });
  assert(slowResult.error === "upstream_request_failed", `slow upstream should surface request failure, got ${JSON.stringify(slowResult)}`);

  const idleStreamText = await streamChat(relayPort, "idle-stream-route");
  assert(idleStreamText.includes("idle-stream"), "idle stream should return the first chunk before ending");

  // Cross-format stream (Anthropic client -> OpenAI provider) is
  // now bridged in 0.5.0 instead of rejected. The relay transcodes
  // upstream OpenAI chat.completion.chunk into Anthropic messages
  // SSE event-by-event.
  const beforeBridgeStream = calls.length;
  const bridgedStream = await fetch(`http://127.0.0.1:${relayPort}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "weighted", stream: true, max_tokens: 64, messages: [{ role: "user", content: "hi" }] })
  });
  assert(bridgedStream.status === 200, `cross-format stream should be bridged (200), got ${bridgedStream.status}`);
  assert(bridgedStream.headers.get("content-type")?.includes("text/event-stream"), "bridged stream should return SSE content-type");
  const bridgedText = await bridgedStream.text();
  assert(bridgedText.includes("event: message_start"), "bridged stream should include message_start");
  assert(bridgedText.includes("event: content_block_delta"), "bridged stream should include content_block_delta");
  assert(bridgedText.includes("event: message_stop"), "bridged stream should include message_stop");
  assert(calls.length > beforeBridgeStream, "cross-format bridge should have called upstream at least once");
  assert(!bridgedText.includes("data: [DONE]"), "Anthropic client should not see OpenAI's [DONE] sentinel");

  // Web Key flow: add a key through the admin API, confirm the
  // masked/hashed view does NOT include the plaintext, then send a
  // chat request that should now be answered by the web key (we
  // record the call count before/after to make sure the upstream was
  // hit). Then disable and delete the key, confirm subsequent
  // requests would now have no key.
  const keystoreStatus = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keystore-status`);
  assert(keystoreStatus.ok === true, "keystore status should report");
  assert(keystoreStatus.masterKeyInEnv === false, "default env should not have OPENRELAY_KEYSTORE_SECRET");
  assert(keystoreStatus.masterKeyOnDisk === true, "first start should write a master.key on disk");
  // Add a baseline web key just for the duration of this block so
  // the upstream has a real key to send. We delete it at the end
  // (and again as part of the no-key test below).
  const baselineAdd = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", value: "sk-mock-baseline-1234567890abcdef", label: "mock 基线 key" })
  });
  assert(baselineAdd.ok === true, "baseline web key should be created");
  const baselineKeyCount = 1;

  // Add a web key.
  const webKeyValue = "sk-webkey-smoke-1234567890abcdef";
  const webKey = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", value: webKeyValue, label: "smoke 主 key" })
  });
  assert(webKey.ok === true, "web key add should succeed");
  assert(webKey.key.id.startsWith("key_"), "key id has prefix");
  assert(webKey.key.masked === "sk-web...cdef", "masked key has expected format");
  assert(webKey.key.hash.length === 12, "hash length");
  assert(!("value" in webKey.key), "plaintext value not in public view");
  assert(!("encryptedValue" in webKey.key), "encryptedValue not in public view");

  // List should return the new key on top of the baseline.
  const list1 = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`);
  assert(list1.ok === true && list1.keys.length === baselineKeyCount + 1, `list has ${baselineKeyCount}+1 keys, got ${list1.keys.length}`);
  assert(list1.keys.find((k) => k.label === "smoke 主 key"), "new key persisted");

  // keystore on disk is encrypted; raw cat should not contain the
  // plaintext or recognizable base64 of it. We can't easily
  // hex-grep from a node test, but the file MUST be valid JSON.
  const { readFile: readFileAsync } = await import("node:fs/promises");
  const onDisk = JSON.parse(await readFileAsync(statePath.replace(/state\.json$/, "keys.enc.json"), "utf8"));
  assert(Array.isArray(onDisk.records), "records[] is an array");
  assert(onDisk.records.length === baselineKeyCount + 1, `${baselineKeyCount} baseline + 1 new = ${baselineKeyCount + 1} records`);
  const stored = onDisk.records.find((r) => r.label === "smoke 主 key");
  assert(stored && stored.encryptedValue && stored.encryptedValue.iv && stored.encryptedValue.tag, "encryptedValue has IV + tag");
  const blobStr = JSON.stringify(stored.encryptedValue);
  assert(!blobStr.includes("sk-webkey"), "encrypted blob does not contain plaintext key substring");

  // Hit a chat endpoint; the web key should be used. Use the
  // weighted route so the rr daily-limit doesn't block us.
  // First switch active profile to weighted-profile.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "weighted-profile" })
  });
  const callsBefore = calls.length;
  const webKeyChat = await chat(relayPort, "weighted");
  assert(["model-a", "model-b"].includes(webKeyChat.model), `weighted picks one of the candidates, got ${webKeyChat.model}`);
  assert(calls.length === callsBefore + 1, "upstream call was made using the web key");

  // Test the key through the admin endpoint — should report ok
  // because the mock server returns 200 for any key.
  const keyTest = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(webKey.key.id)}/test`, {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
  assert(keyTest.ok === true && keyTest.result.ok === true, "admin /keys/:id/test should pass");

  // Disable the key, then it should be skipped. The mock provider
  // has no env key, so after disabling all web keys the route
  // should have no available key.
  const toggled = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(webKey.key.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: false })
  });
  assert(toggled.ok === true && toggled.key.enabled === false, "key was disabled");
  const list2 = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`);
  const justDisabled = list2.keys.find((k) => k.id === webKey.key.id);
  assert(justDisabled && justDisabled.enabled === false, "list reflects disabled");

  // Re-enable, then delete.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(webKey.key.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled: true })
  });
  const removed = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys/${encodeURIComponent(webKey.key.id)}`, {
    method: "DELETE"
  });
  assert(removed.ok === true && removed.removed === webKey.key.id, "delete returns ok");
  const list3 = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`);
  assert(list3.keys.length === baselineKeyCount, "list has only the baseline key after delete");
  assert(!list3.keys.find((k) => k.id === webKey.key.id), "deleted key is gone");

  // Delete the transient (just-deleted) web key check above — but
  // NOTE: even with all web keys gone, the mock provider with
  // keyEnv: null still has a no-auth sentinel key in the Key Pool.
  // That is the intentional design (verified earlier in the
  // no-auth chat block) and matches how local Ollama works. The
  // previous version of this smoke assumed "no web key => no key",
  // which was wrong for Ollama-style providers.
  //
  // We do NOT assert no_available_key here. Instead, verify the
  // web-key bookkeeping ends in a clean state.
  const keystoreStatusAfter = await fetchJson(`http://127.0.0.1:${relayPort}/admin/keystore-status`);
  assert(keystoreStatusAfter.keyCount === baselineKeyCount, "only the baseline web key remains");

  // Re-add the baseline key for any later blocks (rr local-limit
  // test below still needs a key). The baseline is re-added so the
  // mock provider has a real (web) key to forward; the no-auth
  // sentinel still works as a fallback, but the smoke continues to
  // exercise the web-key path here.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "mock", value: "sk-mock-baseline-1234567890abcdef", label: "mock 基线 key" })
  });


  // Switch back to rr for the local-limit test.
  await fetchJson(`http://127.0.0.1:${relayPort}/admin/profile`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ profile: "rr-profile" })
  });
  const third = await fetch(`http://127.0.0.1:${relayPort}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "rr", messages: [{ role: "user", content: "limit" }] })
  });
  assert(third.status === 429, `third rr call should hit local limit, got ${third.status}`);
  await access(statePath);
  // Sanity: state file should now contain the new caches.
  const persisted = JSON.parse(await readFile(statePath, "utf8"));
  assert(persisted.version === 2, "state file should bump to version 2");
  assert(persisted.balanceCache?.mock?.ok === true, "state file should persist balance cache");
  assert(Array.isArray(persisted.recentErrors), "state file should persist recent errors array");
  const errorLog = await fetchJson(`http://127.0.0.1:${relayPort}/admin/error-log`);
  assert(Array.isArray(errorLog), "error log endpoint should return an array");

  console.log("smoke test passed");
} catch (error) {
  printProcessLog(authRelayLog);
  printProcessLog(relayLog);
  throw error;
} finally {
  if (relayProcess) relayProcess.kill();
  if (authRelayProcess) authRelayProcess.kill();
  if (mockServer) await new Promise((resolveClose) => mockServer.close(resolveClose));
  await rm(tmpDir, { recursive: true, force: true });
}

function startMockServer(port, callLog) {
  const server = createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/balance") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ remaining: 17, used: 3, limit: 20, currency: "USD", reset_at: "2026-07-01T00:00:00Z" }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/balance-redirect") {
      // A 302 with a Location header. With `redirect: "manual"` the
      // relay must NOT chase this. We also count any subsequent
      // request to /v1/balance-redirect-target so the smoke can assert
      // the relay never reached it.
      res.writeHead(302, { location: "/v1/balance-redirect-target" });
      res.end();
      return;
    }
    if (req.method === "GET" && req.url === "/v1/balance-redirect-target") {
      if (globalThis.__openrelayRedirectCalls) globalThis.__openrelayRedirectCalls.push("hit");
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ should_never_see: true }));
      return;
    }
    if (req.method === "GET" && req.url === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ object: "list", data: [{ id: "model-a" }, { id: "model-b" }] }));
      return;
    }
    if (req.method !== "POST" || req.url !== "/v1/chat/completions") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    const body = await readJson(req);
    callLog.push(body.model);
    const authHeader = req.headers["authorization"];
    mockAuthLog.push({ model: body.model, authorization: authHeader });
    if (body.model === "slow-model") {
      await sleep(3000);
    }
    if (body.stream) {
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      if (body.model === "idle-stream-model") {
        res.write(
          `data: ${JSON.stringify({
            id: "chatcmpl-idle-stream",
            object: "chat.completion.chunk",
            model: body.model,
            choices: [{ index: 0, delta: { content: "idle-stream" }, finish_reason: null }]
          })}\n\n`
        );
        await sleep(15000);
        return;
      }
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-smoke",
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: { reasoning: "thinking ", content: "o" }, finish_reason: null }]
        })}\n\n`
      );
      res.write(
        `data: ${JSON.stringify({
          id: "chatcmpl-smoke",
          object: "chat.completion.chunk",
          model: body.model,
          choices: [{ index: 0, delta: { content: "k" }, finish_reason: "stop" }]
        })}\n\n`
      );
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "chatcmpl-smoke",
        object: "chat.completion",
        model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }]
      })
    );
  });

  return new Promise((resolveListen) => server.listen(port, "127.0.0.1", () => resolveListen(server)));
}

async function chat(port, model) {
  return fetchJson(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] })
  });
}

async function anthropicMessage(port, model) {
  return fetchJson(`http://127.0.0.1:${port}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: 64, messages: [{ role: "user", content: "hi" }] })
  });
}

async function streamChat(port, model) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model, stream: true, messages: [{ role: "user", content: "hi" }] })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`stream failed: ${response.status} ${text}`);
  return text;
}

async function openAIResponse(port, model) {
  return fetchJson(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      instructions: "Be concise.",
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      max_output_tokens: 64
    })
  });
}

async function openAIResponseStream(port, model) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/responses`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      input: [{ role: "user", content: [{ type: "input_text", text: "hi" }] }],
      max_output_tokens: 64
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`responses stream failed: ${response.status} ${text}`);
  return text;
}

async function waitForHealth(port, processLog) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error(`relay did not become healthy in time on port ${port}\n${formatProcessLog(processLog)}`);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) throw new Error(`${url} failed: ${response.status} ${text}`);
  return JSON.parse(text);
}

async function fetchJsonAllowError(url, options) {
  const response = await fetch(url, options);
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

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function previousDay() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function spawnRelay(label, args, options) {
  const child = spawn(process.execPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
  const log = { label, process: child, stdout: "", stderr: "", exitCode: null, signal: null };
  child.stdout.on("data", (chunk) => { log.stdout += chunk.toString(); });
  child.stderr.on("data", (chunk) => { log.stderr += chunk.toString(); });
  child.on("exit", (code, signal) => {
    log.exitCode = code;
    log.signal = signal;
  });
  return log;
}

function printProcessLog(log) {
  if (!log) return;
  console.error(formatProcessLog(log));
}

function formatProcessLog(log) {
  if (!log) return "(no child process log)";
  const stdout = log.stdout.trim() || "(empty)";
  const stderr = log.stderr.trim() || "(empty)";
  return [
    `--- ${log.label} ---`,
    `exitCode=${log.exitCode === null ? "running" : log.exitCode} signal=${log.signal || ""}`,
    `stdout:\n${stdout}`,
    `stderr:\n${stderr}`
  ].join("\n");
}
