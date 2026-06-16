// Static assertions on the v0.3.0 Dashboard HTML.
// No browser is launched; this validates the server-rendered contract.

import assert from "node:assert/strict";
import { renderDashboard } from "../src/dashboard.js";

let pass = 0;
let fail = 0;

function check(condition, name) {
  if (condition) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${name}`);
  }
}

const status = {
  ok: true,
  version: "0.3.0",
  providers: [
    { name: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", keyEnv: null, local: true, keyCount: 1, models: ["qwen2.5:7b"] },
    { name: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", keyEnv: "DEEPSEEK_API_KEYS", local: false, keyCount: 0, models: ["deepseek-chat"], balanceEndpoint: { url: "https://api.deepseek.com/balance", method: "GET", useKey: true } }
  ],
  combos: [
    { name: "smart-coding", strategy: "fallback", candidates: [
      { provider: "deepseek", model: "deepseek-chat", priority: 2, weight: 3, enabled: true },
      { provider: "ollama", model: "qwen2.5:7b", priority: 1, weight: 1, enabled: true }
    ] }
  ],
  routes: [],
  routeTemplates: [],
  profiles: { activeProfile: "coding", defaultModel: "smart-coding", profiles: [] },
  stats: {},
  usage: { daily: { total: 3, routes: {}, providers: {}, models: {} }, history: [], limits: {} },
  requestStats: { success: 2, failed: 1, avgLatencyMs: 320, byProvider: { ollama: 2 }, byModel: { "smart-coding": 3 }, byError: { missing_key: 1 } },
  recentRequests: [
    { timestamp: "2026-06-16T00:00:00.000Z", model: "smart-coding", provider: "ollama", status: 200, elapsedMs: 220, attempt: 1 },
    { timestamp: "2026-06-16T00:01:00.000Z", model: "smart-coding", provider: "deepseek", status: 401, elapsedMs: 120, attempt: 1, errorCategory: "missing_key" }
  ],
  recentErrors: [{ timestamp: "2026-06-16T00:01:00.000Z", provider: "deepseek", status: 401, category: "missing_key", message: "redacted missing key" }],
  healthCache: { ollama: { ok: true, model: "qwen2.5:7b", status: 200, elapsedMs: 35, checkedAt: "2026-06-16T00:00:00.000Z" } },
  providerHealth: {},
  modelDiscoveryCache: {},
  balanceCache: {},
  keys: {},
  webKeys: [],
  secretStore: { masterKeyOnDisk: false, masterKeyInEnv: false },
  providerTemplates: [],
  relayAuth: { tokenRequired: true, allowNoAuth: false, tokenSource: "env", apiKeyHint: "abc***xyz", apiKeyMasked: "abc***xyz" },
  privacy: { logPrompts: false, logHeaders: false }
};

const html = renderDashboard(status, 18765);
check(typeof html === "string" && html.length > 1000, "renderDashboard returns non-trivial HTML");

for (const tab of ["overview", "providers", "combo-models", "clients", "usage", "diagnostics", "settings"]) {
  check(html.includes(`href="#${tab}"`) && html.includes(`data-tab="${tab}"`), `main nav includes ${tab}`);
  check(html.includes(`data-pane="${tab}"`), `pane exists for ${tab}`);
}

check(html.includes("RelayForge is running"), "Overview hero is rendered");
check(html.includes("Quick Connect"), "Quick Connect is rendered");
check(html.includes("Setup Progress"), "Setup Progress is rendered");
check(html.includes("Recommended next action"), "Recommended next action is rendered");
check(html.includes("No provider keys configured yet") || html.includes("Missing key"), "missing provider key state is rendered");

check(html.includes("Client uses") && html.includes("RelayForge routes to"), "Combo Models explanation is rendered");
check(html.includes("rf-route-path") && html.includes("Copy"), "Combo Models routing path and copy button are rendered");

for (const client of ["CC Switch", "opencode", "Codex / OpenAI-compatible", "Cline", "Generic OpenAI-compatible"]) {
  check(html.includes(client), `Clients page includes ${client}`);
}
check(html.includes("Copy full config"), "Clients page has copy full config buttons");
check(!html.includes("OAuth subscription token config"), "Dashboard does not provide an OAuth subscription token config");

check(html.includes("Requests Today") || html.includes("Requests today"), "Usage metrics are rendered");
check(html.includes("data-filter-cat=\"missing_key\""), "error category filters are rendered");
check(html.includes("data-error-category=\"missing_key\""), "error rows carry data-error-category");

check(html.includes("diagnostic-summary"), "diagnostic-summary textarea exists");
check(html.includes("codex-diagnostic-summary"), "codex-diagnostic-summary textarea exists");
check(html.includes("copy-codex-diagnostics"), "copy Codex diagnostics button exists");

for (const mode of ["system", "light", "dark"]) {
  check(html.includes(`data-appearance-choice="${mode}"`), `appearance control includes ${mode}`);
}
check(html.includes("relayforge.appearance"), "appearance localStorage key is referenced");
check(html.includes("data-appearance=\"system\""), "default appearance data attribute is system");

check(html.includes("/admin/local-connector-plan"), "local connector dry-run endpoint is still referenced");
check(html.includes("/admin/provider-test-preview") || html.includes("provider-test-preview-all"), "provider test preview controls are still present");
check(html.includes("/admin/provider-template-parity"), "provider template parity control is still present");
check(html.includes("/admin/local-connector-consent"), "local connector consent controls are still present");

check(html.includes("data-copy="), "generic data-copy buttons are present");
check(html.includes("function applyAppearance"), "appearance JS helper is embedded");
check(html.includes("function softRefresh"), "softRefresh helper is embedded");
check(html.includes("location.reload"), "softRefresh uses reload");
check(html.includes("function escapeHtml"), "client-side escapeHtml is embedded");

check(!/sk-[A-Za-z0-9]{16,}/.test(html), "no raw sk-* API key in dashboard HTML");
check(!/sk-ant-[A-Za-z0-9]{16,}/.test(html), "no raw sk-ant-* API key in dashboard HTML");
check(!/Bearer\s+[A-Za-z0-9._-]{20,}/.test(html), "no raw bearer token in dashboard HTML");
check(!html.includes("PROMPT_SECRET_EXAMPLE") && !html.includes("raw prompt:"), "dashboard does not render raw prompt content");

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
check(scripts.length >= 2, "inline scripts are present");
for (const [index, script] of scripts.entries()) {
  try {
    new Function(script);
    check(true, `inline script ${index + 1} parses`);
  } catch (error) {
    check(false, `inline script ${index + 1} parses: ${error.message}`);
  }
}

try {
  renderDashboard({ version: "0.3.0" }, 18765);
  check(true, "renderDashboard tolerates minimal status");
} catch (error) {
  check(false, "renderDashboard tolerates minimal status: " + error.message);
}

assert.equal(fail, 0, `${fail} dashboard HTML checks failed`);
console.log(`\n${pass} passed, ${fail} failed`);
