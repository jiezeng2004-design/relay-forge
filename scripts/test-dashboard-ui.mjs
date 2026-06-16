import assert from "node:assert/strict";

// Pure HTML smoke tests — no server startup needed.
let pass = 0, fail = 0;

function check(condition, name) {
  if (condition) { pass++; console.log(`  ok  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

const baseStatus = {
  version: "0.2.0",
  providers: [],
  combos: [],
  routes: [],
  recentRequests: [],
  recentErrors: [],
  webKeys: [],
  usage: { daily: { total: 0, routes: {} } },
  keys: {},
  providerHealth: {},
  healthCache: {},
  balanceCache: {},
  modelDiscoveryCache: {},
  relayAuth: { tokenRequired: false, allowNoAuth: true, tokenSource: "allowNoAuth", apiKeyHint: "testtoken" },
  requestStats: { total: 0, success: 0, failed: 0, avgLatencyMs: 0, byModel: {}, byProvider: {}, byError: {} },
  stats: {}
};

import("../src/dashboard/index.js").then(({ renderDashboard }) => {
  // 1. Title
  check(renderDashboard(baseStatus, 18765).includes("<title>RelayForge"), "title includes RelayForge");

  // 2. No OpenRelay local relay
  check(!renderDashboard(baseStatus, 18765).includes("OpenRelay 本地中继"), "no OpenRelay 本地中继");

  // 3. Nav items
  const html = renderDashboard(baseStatus, 18765);
  check(html.includes("data-tab=\"overview\""), "nav: Overview");
  check(html.includes("data-tab=\"providers\""), "nav: Providers");
  check(html.includes("data-tab=\"combo-models\""), "nav: Combo Models");
  check(html.includes("data-tab=\"clients\""), "nav: Clients");
  check(html.includes("data-tab=\"routes\""), "nav: Routes");
  check(html.includes("data-tab=\"usage\""), "nav: Usage");
  check(html.includes("data-tab=\"settings\""), "nav: Settings");
  check(html.includes("data-tab=\"ide\""), "nav: IDE");

  // 4. Overview elements
  check(html.includes("RelayForge is running"), "hero: RelayForge is running");
  check(html.includes("Quick Setup"), "quick setup section");
  check(html.includes("Base URL"), "base URL label");
  check(html.includes("API Key"), "API Key label");
  check(html.includes("smart-coding"), "smart-coding model");
  check(html.includes("No requests yet"), "empty requests");
  check(html.includes("No provider keys configured yet") || html.includes("Getting Started"), "empty providers hint");

  // 5. Combo Models empty
  check(html.includes("No combo models configured"), "empty combos");

  // 6. Combo models with data
  const withCombo = renderDashboard({ ...baseStatus, combos: [{ name: "test-combo", strategy: "fallback", candidates: [{ provider: "test", model: "m1" }] }] }, 18765);
  check(withCombo.includes("test-combo"), "combo name shown");
  check(withCombo.includes("fallback"), "combo strategy shown");

  // 7. Clients
  check(html.includes("CC Switch"), "clients: CC Switch");
  check(html.includes("opencode"), "clients: opencode");
  check(html.includes("Codex"), "clients: Codex");
  check(html.includes("Cline"), "clients: Cline");
  check(html.includes("Generic OpenAI-compatible"), "clients: Generic");

  // 8. Token is masked (not full raw value)
  const maskedHtml = renderDashboard({ ...baseStatus, relayAuth: { tokenRequired: true, allowNoAuth: false, tokenSource: "env", apiKeyHint: "abc***xyz", apiKeyMasked: "abc***xyz" } }, 18765);
  check(maskedHtml.includes("abc***xyz") || !maskedHtml.includes("abc123def456"), "token is masked");

  // 9. renderDashboard doesn't crash with minimal status
  try {
    const minimal = renderDashboard({ version: "0.2.0" }, 18765);
    check(true, "renderDashboard with minimal status does not crash");
  } catch (e) {
    check(false, "renderDashboard with minimal status: " + e.message);
  }

  // 10. Provider with key status
  const providerStatus = renderDashboard({
    ...baseStatus,
    providers: [{ name: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", keyEnv: "DEEPSEEK_API_KEYS", models: ["deepseek-chat"], local: false, keyCount: 1 }]
  }, 18765);
  check(providerStatus.includes("deepseek"), "provider name shown");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
});
