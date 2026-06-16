import { renderDashboard } from "../src/dashboard.js";
const status = {
  ok: true, version: "0.4.9", startedAt: "", configPath: "", statePath: "",
  providers: [{ name: "d", displayName: "d", baseUrl: "https://x", apiFormat: "openai", keyEnv: "K", allowInsecureHttp: false, insecureHttpRisk: false, local: false, healthHint: "", keyCount: 0, models: [], extraHeaders: null, balanceEndpoint: null }],
  routes: [], routeTemplates: [], routeReferences: {},
  profiles: { activeProfile: "p", defaultModel: "r", profiles: [] },
  stats: {}, usage: {},
  healthCache: {}, modelDiscoveryCache: {}, balanceCache: {}, recentErrors: [],
  healthChecks: { enabled: false, intervalMinutes: 60, providers: [] },
  keys: {}, webKeys: [{ id: "k1", provider: "d", label: "", masked: "sk-...cdef", hash: "h", enabled: true, source: "web", sourceId: null, uses: 0, failures: 0, coolingDown: false, cooldownUntil: null, lastUsedAt: null, lastTestAt: null, lastTestResult: null, encryptedValue: { v: 1, iv: "", tag: "", ciphertext: "" } }],
  secretStore: {}, providerTemplates: [],
  relayAuth: { tokenRequired: false, apiKeyHint: "local" }
};
const html = renderDashboard(status, 39210);
const idx = html.indexOf("provider-form-key-status");
console.log("around:", JSON.stringify(html.slice(idx - 30, idx + 500)));
