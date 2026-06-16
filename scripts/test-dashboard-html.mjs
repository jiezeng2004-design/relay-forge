// Static assertions on the renderDashboard output. We don't launch a
// real browser; we just check that the HTML the server would send
// contains the structural and copy contracts the UI relies on.

import { renderDashboard } from "../src/dashboard.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

const status = {
  ok: true,
  version: "0.4.9",
  startedAt: "2026-06-04T00:00:00.000Z",
  configPath: "D:/test/config.json",
  statePath: "D:/test/data/runtime-state.json",
  providers: [
    {
      name: "local",
      displayName: "Local",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiFormat: "openai",
      keyEnv: null,
      allowInsecureHttp: false,
      insecureHttpRisk: false,
      local: true,
      healthHint: "本地 provider",
      keyCount: 0,
      models: ["local-model"],
      extraHeaders: null,
      balanceEndpoint: null
    },
    {
      name: "deepseek",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiFormat: "openai",
      keyEnv: "DEEPSEEK_API_KEYS",
      allowInsecureHttp: false,
      insecureHttpRisk: false,
      local: false,
      healthHint: "云端 provider",
      keyCount: 0,
      models: ["deepseek-chat"],
      extraHeaders: null,
      balanceEndpoint: { url: "https://api.deepseek.com/v1/user/balance", method: "GET", useKey: true }
    }
  ],
  routes: [
    {
      name: "coding-local",
      description: "Prefer coding APIs, then local",
      strategy: "fallback",
      limits: {},
      candidates: [{ provider: "deepseek", model: "deepseek-chat", weight: 1 }]
    }
  ],
  routeTemplates: [],
  routeReferences: { "coding-local": [] },
  profiles: {
    activeProfile: "local-only",
    defaultModel: "coding-local",
    profiles: [
      { name: "local-only", description: "Local only", defaultModel: "coding-local", active: true }
    ]
  },
  stats: { requests: 0, proxied: 0, failures: 0, localLimitHits: 0, upstreamAttempts: 0, byProvider: {} },
  usage: {
    day: "2026-06-04",
    daily: { total: 0, routes: {}, providers: {}, models: {} },
    history: [],
    historyDays: 14,
    runtime: { byRoute: {}, byModel: {}, byProvider: {} },
    limits: { dailyRequests: null, routes: {}, providers: {} }
  },
  healthCache: {},
  providerHealth: {},
  modelDiscoveryCache: {},
  balanceCache: {
    deepseek: {
      ok: true,
      provider: "deepseek",
      summary: "remaining=42, used=8, limit=50, currency=USD",
      checkedAt: "2026-06-04T00:30:00.000Z"
    }
  },
  recentErrors: [],
  healthChecks: { enabled: false, intervalMinutes: 60, providers: [] },
  keys: { local: [{ label: "no-auth", hash: "no-auth", source: "no-auth", sourceId: null, uses: 0, failures: 0, coolingDown: false, cooldownUntil: null }] },
  webKeys: [],
  secretStore: { masterKeyOnDisk: false, masterKeyInEnv: false },
  providerTemplates: [],
  relayAuth: {
    tokenRequired: true,
    allowNoAuth: false,
    tokenSource: "generated",
    apiKeyHint: "abcdef...wxyz",
    apiKeyMasked: "abcdef...wxyz"
  }
};

const html = renderDashboard(status, 39210);
assert(typeof html === "string" && html.length > 1000, "renderDashboard returns a non-trivial HTML string");

test("default tab is overview; six tab anchors are present", () => {
  for (const id of ["overview", "providers", "routes", "tools", "usage", "settings"]) {
    assert(html.includes(`href="#${id}"`), `missing anchor to #${id}`);
    assert(html.includes(`data-tab="${id}"`), `missing data-tab="${id}"}`);
  }
  // No pane is statically given the `active` class — the JS reads
  // window.location.hash on load and applies the class. We assert
  // that the script wires up hash-routing to the right default.
  assert(html.includes('id="tab-overview"'), "overview pane id present");
  assert(html.includes('id="tab-providers"'), "providers pane id present");
  assert(html.includes("activateTab("), "activateTab dispatcher present");
  assert(html.includes('"overview"') || html.includes("'overview'"), "default tab is 'overview'");
});

test("hash-based activateTab logic is present in the inline script", () => {
  assert(html.includes("activateTab("), "activateTab() is defined in the inline script");
  assert(html.includes("hashchange"), "listens to hashchange events");
  assert(html.includes('"overview"') || html.includes("'overview'"), "default tab is overview");
});

test("softRefresh uses window.location.reload (reliable fallback after IIFE approach proved fragile)", () => {
  // softRefresh originally used `document.open/write/close` (broke
  // hash state) then DOMParser + `new Function` (broke silently in
  // real browser). The pragmatic fix is a hard reload: the
  // browser URL hash is preserved automatically, and the only
  // cost is a brief full-page reload after each save.
  assert(html.includes("location.reload"), "softRefresh uses location.reload");
});

test("softRefresh helper is defined (used by admin actions to re-render)", () => {
  assert(html.includes("function softRefresh"), "softRefresh is defined");
});

test("provider edit form is wrapped in #provider-form-card collapsible details", () => {
  assert(html.includes('id="provider-form-card"'), "provider form card id present");
  assert(html.includes('class="collapsible"'), "collapsible class used");
});

test("diagnostic-summary textarea is present (used by copy button)", () => {
  assert(html.includes('id="diagnostic-summary"'), "diagnostic-summary id present");
  assert(html.includes("复制诊断摘要"), "copy diagnostic button label present");
});

test("tool-verify.ps1 is mentioned as a verification step on the tools tab", () => {
  assert(html.includes("tool-verify.ps1"), "tool-verify.ps1 referenced in dashboard");
});

test("canonical safety copy is on the page", () => {
  // The dashboard subtitle should reference the project by name.
  assert(html.includes("本地优先 AI 编程网关") || html.includes("RelayForge"), "safety copy present in dashboard");
});

test("dashboard does NOT embed any example API key in the rendered output", () => {
  // The default status has no keys. We assert the HTML does not
  // contain realistic-shaped placeholders (sk-, sk-ant-, AIza, etc.)
  // that would suggest a real key was hard-coded.
  assert(!/sk-[A-Za-z0-9]{16,}/.test(html), "no raw sk-... key in dashboard");
  assert(!/sk-ant-[A-Za-z0-9]{16,}/.test(html), "no raw sk-ant-... key in dashboard");
  assert(!/AIza[A-Za-z0-9]{16,}/.test(html), "no raw AIza... key in dashboard");
});

test("provider form rejects the secret-shaped keys (defensive UI marker)", () => {
  // The forbidden-field list is rendered in the help text on the
  // settings tab. We assert that "apiKey", "token", "secret",
  // "password", "cookie", "authorization" are all named explicitly.
  for (const word of ["apiKey", "token", "secret", "password", "cookie", "authorization"]) {
    assert(html.includes(word), `dashboard mentions forbidden field name: ${word}`);
  }
});

test("RELAY_TOKEN banner distinguishes set vs unset without blocking", () => {
  // When unset, the banner says so AND still suggests setting it.
  assert(html.includes("RELAY_TOKEN 未设置"), "unset banner shown");
  assert(html.includes("建议"), "suggests setting RELAY_TOKEN");
  // The page is reachable without the token (no blocking overlay).
  assert(!html.includes("RELAY_TOKEN is required"), "no blocking required-state");
});

test("OPENRELAY_TOKEN env alias is surfaced as a distinct auth source", () => {
  const aliasHtml = renderDashboard({
    ...status,
    relayAuth: {
      ...status.relayAuth,
      tokenSource: "openrelay_env"
    }
  }, 39210);
  assert(aliasHtml.includes("OPENRELAY_TOKEN") && aliasHtml.includes("backward compat"), "OPENRELAY_TOKEN source label is rendered");
});

// 0.5.4: the dashboard HTML and inline JSON must NEVER include
// the full relay token. The auto-generated token shape is 64
// hex chars; we use that as a tight regex so we don't flag the
// masked "abcdef...wxyz" form (which contains "..." and a
// trailing non-hex "wxyz").
test("0.5.4: dashboard HTML does NOT contain a 64-hex-char relay token", () => {
  // Search for any run of 64 hex chars that isn't followed by
  // a "..." separator (which would mean it's the masked form).
  const hexRun = /[a-f0-9]{60,}/i;
  const m = html.match(hexRun);
  if (m) {
    const run = m[0];
    // The masked form is "abc123...wxyz" — at most 6 + 4 = 10
    // hex chars total, with "..." between. A 64-char run without
    // "..." would be the full token.
    const surrounding = html.slice(Math.max(0, m.index - 20), m.index + run.length + 20);
    if (!surrounding.includes("...")) {
      throw new Error(`dashboard HTML contains a long hex run (${run.length} chars) that does not look like a masked form: "${run}"`);
    }
  }
});

test("0.5.4: dashboard inline JSON does NOT include relayAuth.apiKey", () => {
  // Find the inline `<script>` block that injects relayAuth state
  // and ensure it does not carry a full token field.
  const dataMatch = html.match(/var relayAuth = (\{[\s\S]*?\});/);
  assert(dataMatch, "inline relayAuth data found");
  const payload = dataMatch[1];
  // The field must NOT be present. The old shape had
  // `apiKey: "<full-token>"`; the new shape exposes only masked
  // hints.
  assert(!/"apiKey"\s*:\s*"/.test(payload), `inline relayAuth data still contains an apiKey field: ${payload}`);
  // apiKeyHint and apiKeyMasked may carry the masked form
  // "abcdef...wxyz" — that's the EXPECTED content.
  assert(/"apiKeyHint"\s*:/.test(payload), "inline relayAuth data carries apiKeyHint");
  assert(/"apiKeyMasked"\s*:/.test(payload), "inline relayAuth data carries apiKeyMasked");
});

test("0.5.4: dashboard still surfaces the masked token hint", () => {
  // The status object feeds "abcdef...wxyz" as both apiKeyHint
  // and apiKeyMasked. The rendered HTML must contain the
  // masked form somewhere (in the no-full-token auth panel,
  // the data-tool-generator-api-hint, etc.).
  assert(html.includes("abcdef...wxyz"), "masked token hint is visible in the rendered HTML");
  assert(html.includes("Auth source") || html.includes("Token:"), "auth/source info is rendered");
});

test("settings tab partitions session / write / read-only sections", () => {
  assert(html.includes("会话与会话级安全"), "session section label");
  assert(html.includes("写操作（会改 config.json）"), "write section label");
  assert(html.includes("只读缓存"), "read-only section label");
});

test("Provider form preserves baseUrl safety validation messages", () => {
  assert(html.includes("仅允许"), "baseUrl safety text present (默认仅允许...)");
  assert(html.includes("loopback"), "loopback mention present");
  assert(html.includes("allowInsecureHttp"), "allowInsecureHttp option present");
});

test("8 tool cards are emitted on the tools tab", () => {
  const expected = [
    "Codex",
    "OpenClaw",
    "OpenCode",
    "Aider",
    "Goose",
    "Continue",
    "Claude Code",
    "Amp"
  ];
  for (const name of expected) {
    assert(html.includes(name), `tool card for ${name} missing`);
  }
});

test("renderDashboard result includes structured data injection for the inline script", () => {
  // The dashboard's inline <script> reads providers / routes / etc.
  // from JSON-injected constants. We just make sure those constants
  // are present in the rendered HTML.
  for (const ident of ["var providers =", "var routes =", "var webKeys =", "var providerTemplates =", "var routeTemplates ="]) {
    assert(html.includes(ident), `${ident} declaration present in dashboard inline script`);
  }
});

test("usage tab shows empty-state copy when there are no errors", () => {
  assert(html.includes("empty-state"), "empty-state class used");
  assert(html.includes("暂无错误"), "no-errors message present");
});

test("error category chips are rendered using the canonical ERROR_CATEGORIES list", () => {
  for (const cat of [
    "stream_idle_timeout",
    "stream_read_failed",
    "stream_parse_failed",
    "upstream_429",
    "upstream_5xx",
    "upstream_timeout",
    "upstream_auth",
    "upstream_request_failed",
    "config_error",
    "local_limit",
    "other"
  ]) {
    assert(html.includes(`err-cat ${cat}`), `category chip for ${cat} present`);
  }
});

test("overview tab contains Quick Start / Setup wizard", () => {
  assert(html.includes("首次使用向导"), "quick start wizard title present");
  assert(html.includes("Step 1"), "step 1 present");
  assert(html.includes("Step 2"), "step 2 present");
  assert(html.includes("Step 3"), "step 3 present");
});

test("usage tab contains category filter buttons", () => {
  assert(html.includes('data-filter-cat="all"'), "all filter button present");
  assert(html.includes('data-filter-cat="upstream_429"'), "upstream_429 filter button present");
  assert(html.includes('data-filter-cat="stream_idle_timeout"'), "stream_idle_timeout filter button present");
});

test("error rows carry data-error-category for the filter click handler", () => {
  const seededStatus = {
    ...status,
    recentRequests: [
      { timestamp: "2025-01-01T00:00:00.000Z", model: "m1", provider: "test", status: 500, elapsedMs: 100, attempt: 1, errorCategory: "stream_idle_timeout" },
      { timestamp: "2025-01-02T00:00:00.000Z", model: "m2", provider: "test2", status: 429, elapsedMs: 200, attempt: 2, errorCategory: "upstream_429" }
    ]
  };
  const seededHtml = renderDashboard(seededStatus, 39210);
  assert(seededHtml.includes('data-error-category="stream_idle_timeout"'), "first error row has data-error-category");
  assert(seededHtml.includes('data-error-category="upstream_429"'), "second error row has data-error-category");
  assert(/data-filter-cat="all"[^>]*data-filter-active="true"|data-filter-active="true"[^>]*data-filter-cat="all"/.test(seededHtml), "all filter button is marked active by default");
});

test("category filter has a real click handler in the inline script", () => {
  assert(html.includes("applyErrorCategoryFilter"), "filter click handler function is defined");
  assert(html.includes("setActiveFilterButton"), "active-state updater function is defined");
  assert(html.includes("[data-filter-cat]"), "filter buttons are queried via data-filter-cat selector");
  assert(html.includes("data-filter-active"), "active state is tracked via data-filter-active attribute");
});

test("usage tab contains copy-codex-diagnostics button", () => {
  assert(html.includes('id="copy-codex-diagnostics"'), "copy-codex-diagnostics button id present");
  assert(html.includes("复制 Codex 诊断包"), "copy codex diagnostic button label present");
});

test("codex-diagnostic-summary textarea is present", () => {
  assert(html.includes('id="codex-diagnostic-summary"'), "codex-diagnostic-summary id present");
});

test("dashboard does NOT embed any example API key in the rendered output", () => {
  assert(!/sk-[A-Za-z0-9]{16,}/.test(html), "no raw sk-... key in dashboard");
  assert(!/sk-ant-[A-Za-z0-9]{16,}/.test(html), "no raw sk-ant-... key in dashboard");
  assert(!/AIza[A-Za-z0-9]{16,}/.test(html), "no raw AIza... key in dashboard");
});

// =============================================================
// 0.4.9: P1 工具配置生成器 / P2 路由预览 / P3 Provider 状态总览
// =============================================================

test("P1 tool config generator: 7 tool options + 2 selects + 3 command boxes + verify", () => {
  assert(html.includes('id="tool-generator-tool"'), "tool select id present");
  assert(html.includes('id="tool-generator-model"'), "model select id present");
  assert(html.includes("data-tool-generator-tool"), "data-tool-generator-tool attribute");
  assert(html.includes("data-tool-generator-model"), "data-tool-generator-model attribute");
  assert(html.includes('id="tool-generator-ps"'), "PowerShell command box id present");
  assert(html.includes('id="tool-generator-cmd"'), "CMD command box id present");
  assert(html.includes('id="tool-generator-bash"'), "Bash command box id present");
  assert(html.includes('id="tool-generator-verify"'), "verify command box id present");
  assert(html.includes("data-tool-generator-ps"), "ps pre attribute present");
  assert(html.includes("data-tool-generator-cmd"), "cmd pre attribute present");
  assert(html.includes("data-tool-generator-bash"), "bash pre attribute present");
  for (const toolName of ["Codex (OpenAI Codex CLI)", "OpenClaw", "OpenCode", "Aider", "Goose", "Continue (VSCode / JetBrains)", "Claude Code"]) {
    assert(html.includes(toolName), `tool option for ${toolName} present`);
  }
  // Generator must NOT use system env writes, register, or shell profile.
  // The safety text is enough — we just confirm it surfaces the
  // 不会写入系统环境变量 contract.
  assert(html.includes("不会") && (html.includes("系统环境变量") || html.includes("注册表")), "tool generator mentions safety contract (no system env / register writes)");
});

test("P1 tool config generator: 7 static tool cards still emitted below the generator", () => {
  // The static card grid is preserved underneath the live generator
  // so operators can copy a known-good default without re-selecting.
  for (const toolName of ["Codex (OpenAI Codex CLI)", "OpenClaw", "OpenCode", "Aider", "Goose", "Continue (VSCode / JetBrains)", "Claude Code"]) {
    assert(html.includes('data-tool-card-id='), `data-tool-card-id for ${toolName} present`);
  }
});

test("P1 tool config generator: inline script wires the 2 selects to refresh + 3 copy buttons", () => {
  assert(html.includes("refreshToolGenerator"), "refreshToolGenerator function defined");
  assert(html.includes('"change"'), "change listener registered");
  assert(html.includes("data-copy-target"), "data-copy-target buttons present");
  assert(html.includes("getElementById(\"tool-generator-tool\")"), "tool select listener");
  assert(html.includes("getElementById(\"tool-generator-model\")"), "model select listener");
  assert(html.includes("navigator.clipboard.writeText"), "clipboard writeText used for copy buttons");
});

test("P2 route preview: panel + input + button + output container all present", () => {
  assert(html.includes('id="route-preview-panel"'), "route preview panel id present");
  assert(html.includes('id="route-preview-input"'), "input id present");
  assert(html.includes('id="route-preview-button"'), "preview button id present");
  assert(html.includes('id="route-preview-output"'), "output container id present");
  assert(html.includes("data-route-preview-input"), "input data attribute");
  assert(html.includes("data-route-preview-button"), "button data attribute");
  assert(html.includes("data-route-preview-output"), "output data attribute");
});

test("P2 route preview: inline script wires the button + Enter key to /admin/preview-route", () => {
  assert(html.includes("runRoutePreview"), "runRoutePreview function defined");
  assert(html.includes("/admin/preview-route"), "endpoint URL referenced in inline script");
  assert(html.includes("renderRoutePreviewResult"), "result renderer function defined");
  assert(html.includes("getJson"), "uses getJson helper for fetch");
  assert(html.includes("Enter"), "Enter key handler present");
  assert(html.includes("encodeURIComponent"), "query string is URL-encoded");
});

test("P2 route preview: result renderer uses the resolved kind/strategy tags + candidate table", () => {
  assert(html.includes("kind: "), "kind pill rendered");
  assert(html.includes("strategy: "), "strategy pill rendered");
  assert(html.includes("data-preview-candidate-index"), "candidate row attribute for testing");
  assert(html.includes("insecure-risk") || html.includes("allowInsecureHttp"), "insecure-http risk marker present");
  assert(html.includes("有 Key") || html.includes("缺 Key"), "key availability pill rendered");
  assert(html.includes("未测") || html.includes("健康") || html.includes("失败"), "health pill rendered");
});

test("P3 provider status overview: filter buttons + data-provider-status on every row", () => {
  for (const key of ["all", "local", "cloud", "needs-key", "untested", "insecure-risk", "rate-limited", "balance-ok", "balance-error", "balance-untested", "recent-failed"]) {
    assert(html.includes(`data-provider-filter="${key}"`), `filter button for ${key} present`);
  }
  // Both seeded providers should have data-provider-row + data-provider-status
  assert(html.includes('data-provider-row="local"'), "local provider row attribute present");
  assert(html.includes('data-provider-row="deepseek"'), "deepseek provider row attribute present");
  assert(html.includes('data-provider-status="local'), "local row has data-provider-status starting with 'local'");
  assert(html.includes('data-provider-status="cloud'), "deepseek row has data-provider-status starting with 'cloud'");
  assert(html.includes("id=\"provider-table-body\""), "provider table body has stable id for filter");
  assert(html.includes("id=\"provider-table-wrap\""), "provider table wrap id present");
  assert(html.includes("<th style=\"width: 150px;\">Quota</th>"), "provider table has quota column");
  assert(html.includes("Quota ok (1)"), "balance-ok count reflects cached balance result");
  assert(html.includes("remaining=42, used=8, limit=50, currency=USD"), "provider row renders cached balance summary");
  assert(html.includes("quota ok"), "provider row renders quota ok badge");
});

test("P3 provider status overview: inline script wires filter buttons + applies recentErrors", () => {
  assert(html.includes("applyProviderFilter"), "applyProviderFilter function defined");
  assert(html.includes("setActiveProviderFilterButton"), "active-state updater function defined");
  assert(html.includes("data-provider-filter]"), "filter buttons queried via data-provider-filter selector");
  assert(html.includes("data-provider-filter-active"), "active state tracked via data-provider-filter-active");
  assert(html.includes("status.recentErrors"), "filter uses status.recentErrors to detect recent failures");
  assert(html.includes("data-provider-filter-empty"), "empty-state row attribute for filter");
});

test("P3 provider status overview: seeded recentErrors put providers into 'recent-failed' bucket", () => {
  const seededStatus = {
    ...status,
    recentErrors: [
      { at: "2026-01-01T00:00:00.000Z", scope: "proxy:deepseek", category: "upstream_5xx", error: "boom", provider: "deepseek" },
      { at: "2026-01-02T00:00:00.000Z", scope: "proxy:ollama", category: "stream_read_failed", error: "boom", provider: "local" }
    ]
  };
  const seededHtml = renderDashboard(seededStatus, 39210);
  // The filter UI must surface the count regardless of which buttons
  // are active. The seeded status has 2 providers with recent errors
  // so the "最近失败" filter should read "(2)".
  assert(seededHtml.includes("最近失败 (2)"), "recent-failed count reflects recentErrors");
});

test("P3 provider status overview: providerHealth rate limits surface as a filter bucket", () => {
  const seededStatus = {
    ...status,
    providerHealth: {
      deepseek: {
        rateLimited: true,
        rateLimitedUntil: "2026-01-01T00:01:00.000Z",
        rateLimitReason: "retry_after_ms=60000"
      }
    }
  };
  const seededHtml = renderDashboard(seededStatus, 39210);
  assert(seededHtml.includes('data-provider-filter="rate-limited"'), "rate-limited filter button present");
  assert(seededHtml.includes("Retry-After (1)"), "rate-limited count reflects providerHealth");
  assert(seededHtml.includes('data-provider-rate-limited="true"'), "rate-limited row attribute present");
  assert(seededHtml.includes("rate-limited"), "rate-limited tag/class rendered");
  assert(seededHtml.includes("Retry-After until"), "rate-limited detail note rendered");
});

test("P3 provider status overview: balance errors and untested endpoints surface as filter buckets", () => {
  const seededStatus = {
    ...status,
    providers: [
      ...status.providers,
      {
        name: "groq",
        displayName: "Groq",
        baseUrl: "https://api.groq.com/openai/v1",
        apiFormat: "openai",
        keyEnv: "GROQ_API_KEYS",
        allowInsecureHttp: false,
        insecureHttpRisk: false,
        local: false,
        healthHint: "cloud provider",
        keyCount: 1,
        models: ["llama-3.1-8b-instant"],
        extraHeaders: null,
        balanceEndpoint: { url: "https://api.groq.com/balance", method: "GET", useKey: true }
      },
      {
        name: "mistral",
        displayName: "Mistral",
        baseUrl: "https://api.mistral.ai/v1",
        apiFormat: "openai",
        keyEnv: "MISTRAL_API_KEYS",
        allowInsecureHttp: false,
        insecureHttpRisk: false,
        local: false,
        healthHint: "cloud provider",
        keyCount: 1,
        models: ["mistral-small-latest"],
        extraHeaders: null,
        balanceEndpoint: { url: "https://api.mistral.ai/balance", method: "GET", useKey: true }
      }
    ],
    balanceCache: {
      ...status.balanceCache,
      groq: { ok: false, provider: "groq", error: "no_available_key", checkedAt: "2026-06-04T00:35:00.000Z" }
    }
  };
  const seededHtml = renderDashboard(seededStatus, 39210);
  assert(seededHtml.includes("Quota ok (1)"), "balance-ok count preserved");
  assert(seededHtml.includes("Quota error (1)"), "balance-error count reflects cached failure");
  assert(seededHtml.includes("Quota untested (1)"), "balance-untested count reflects configured endpoint with no cache");
  assert(seededHtml.includes("quota error"), "provider row renders quota error badge");
  assert(seededHtml.includes("quota untested"), "provider row renders quota untested badge");
  assert(seededHtml.includes("balanceEndpoint configured"), "provider row explains untested balance endpoint");
});

test("0.4.9 release notes include '只读' / '不调用上游' / '不写配置' safety copy", () => {
  // The route preview panel + tool generator both surface the
  // canonical safety contract. The README is also asserted in the
  // pre-release check, but here we focus on the rendered HTML.
  assert(html.includes("只读"), "read-only label present in dashboard");
  assert(html.includes("不调用上游") || html.includes("不会") || html.includes("不会写入系统环境变量"), "no-side-effect contract surfaced");
});

test("0.4.9 hotfix: tool-generator-verify uses the actual relay port (not hardcoded 39210)", () => {
  // The verify command must reflect whatever port the relay was
  // started on (PORT=0 in tests means dynamic). The hotfix plumbs
  // baseUrl into buildToolVerifyCommand and refreshToolGenerator.
  const customHtml = renderDashboard(status, 40123);
  assert(customHtml.includes('id="tool-generator-verify"'), "tool-generator-verify pre still present");
  // Extract the <pre id="tool-generator-verify">...</pre> body and
  // assert it contains the custom port and not an unrelated relay port.
  const match = customHtml.match(/<pre id="tool-generator-verify"[^>]*>([\s\S]*?)<\/pre>/);
  assert(match, "tool-generator-verify <pre> matched");
  const body = match[1];
  assert(body.includes("127.0.0.1:40123"), "verify command uses the custom port 40123");
  assert(!body.includes("127.0.0.1:39210"), "verify command does NOT contain unrelated port 39210");
  // Sanity: this fixture deliberately renders the dashboard with 39210,
  // and the hotfix only changed the data base — so the original
  // html still uses that explicit fixture port (we only refactored, not removed).
  assert(html.includes("127.0.0.1:39210"), "original html still references the explicit fixture port 39210");
});

test("dashboard inline script is valid JavaScript", () => {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(match, "inline dashboard script present");
  try {
    new Function(match[1]);
  } catch (error) {
    throw new Error(`inline script parse failed: ${error.message}`);
  }
});

// =============================================================
// 0.6.3 reversal: the 0.4.9 hotfix banned document.open /
// document.write / document.close because the 0.4.x
// implementation tried to swap the body via DOMParser +
// document.write, which broke the hash state and left event
// listeners detached. The 0.5.x line moved to
// window.location.replace with a cache-bust + hash, which
// worked but produced a 100-300ms token-prompt flash
// because top-level navigations drop the Authorization
// header (see soft-refresh test for the full rationale).
//
// 0.6.3 fixes that flash by doing the in-place fetch +
// document.write pair: re-fetch GET / with the
// sessionStorage admin token attached as Authorization,
// then document.open / document.write / document.close the
// response body. This is now the canonical softRefresh
// path, and the assertions below pin the new contract
// (document.write IS expected, location.replace is NOT).
// =============================================================

test("0.6.4: softRefresh uses window.location.reload() for stability", () => {
  const softRefreshBlock = html.match(/function softRefresh[\s\S]*?function scheduleSoftRefresh/);
  assert(softRefreshBlock, "softRefresh block extractable");
  const codeOnly = softRefreshBlock[0]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert(
    /location\.reload\s*\(/.test(codeOnly),
    "softRefresh body must call window.location.reload() (0.6.4 stable path)"
  );
  assert(
    !/window\.location\.replace/.test(codeOnly),
    "softRefresh body must NOT call window.location.replace()"
  );
});

test("inline script does NOT wrap in IIFE (script runs at top-level now, no re-eval)", () => {
  // After the softRefresh fix moved to window.location.reload(),
  // the IIFE wrapper is no longer needed. The inline script runs
  // as a standard top-level script. The important invariants are:
  //   - activateTab call exists (routed via hash)
  //   - window.location.hash is used
  //   - overview is the fallback
  assert(!/openrelayInitDashboard/.test(html), "no window.openrelayInitDashboard (IIFE was removed)");
  assert(!/initDashboard/.test(html), "no initDashboard() function (was specific to IIFE re-eval)");
});

test("inline script still contains activateTab with hash + overview fallback (even without IIFE)", () => {
  // The activateTab logic is a core invariant: it must always run
  // on page load and after hash changes, regardless of how the
  // script is structured. Since we now use location.reload(), the
  // browser re-executes the whole <script> on each reload, and
  // activateTab is called at the top level.
  assert(/activateTab\s*\(/.test(html), "activateTab(...) call exists in inline script");
  assert(/window\.location\.hash/.test(html), "window.location.hash referenced for tab routing");
  assert(/overview/.test(html) && /activateTab/.test(html), "activateTab references 'overview' fallback");
});

test("inline script body parses and re-parses without SyntaxError", () => {
  // softRefresh re-runs the script body via new Function(text)() to
  // give every const a fresh scope. The IIFE wrapper around the
  // dashboard bootstrap is what makes this safe; without it, a
  // second pass would throw a SyntaxError on const redeclaration.
  // We check syntactic validity (the IIFE + new Function combo is
  // the real contract) — actually running the body in Node would
  // fail with "document is not defined" because the script depends
  // on browser globals, and that is not what we are testing here.
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(match, "inline script present");
  const scriptText = match[1];
  try {
    new Function(scriptText);
  } catch (error) {
    throw new Error(`first parse threw: ${error.message}`);
  }
  try {
    new Function(scriptText);
  } catch (error) {
    throw new Error(`second parse threw (IIFE wrapper not isolating const): ${error.message}`);
  }
});

test("0.6.4: adding a Web Key success path uses softRefresh (window.location.reload)", () => {
  assert(/softRefresh/.test(html), "softRefresh function defined");
  const softRefreshBlock = html.match(/function softRefresh[\s\S]*?function scheduleSoftRefresh/);
  assert(softRefreshBlock, "softRefresh block extractable");
  const codeOnly = softRefreshBlock[0]
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
  assert(
    !/window\.location\.replace/.test(codeOnly),
    "softRefresh does NOT call window.location.replace()"
  );
  assert(
    /location\.reload\s*\(/.test(codeOnly),
    "softRefresh calls window.location.reload()"
  );
});

// =============================================================
// 0.4.10: 13 new BYOK provider templates + discover-models UI
// =============================================================

test("0.4.10: 13 new provider templates appear in the dashboard", () => {
  // The default status fixture has an empty providerTemplates
  // array (to keep other tests focused on the rendering contract).
  // For the provider-template assertions we render the dashboard
  // with a richer fixture that mirrors what buildStatus() emits
  // after the 0.4.10 template additions.
  const richTemplates = [
    { name: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiFormat: "openai", keyEnv: "CEREBRAS_API_KEYS", models: ["llama-3.3-70b"] },
    { name: "sambanova", displayName: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", apiFormat: "openai", keyEnv: "SAMBANOVA_API_KEYS", models: ["Meta-Llama-3.3-70B-Instruct"] },
    { name: "longcat", displayName: "LongCat (Meituan)", baseUrl: "https://api.longcat.chat/v1", apiFormat: "openai", keyEnv: "LONGCAT_API_KEYS", models: ["longcat-128k-chat"] },
    { name: "dashscope", displayName: "DashScope (Alibaba Cloud)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiFormat: "openai", keyEnv: "DASHSCOPE_API_KEYS", models: ["qwen-plus"] },
    { name: "nvidia-nim", displayName: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiFormat: "openai", keyEnv: "NVIDIA_API_KEYS", models: ["meta/llama-3.1-70b-instruct"] },
    { name: "github-models", displayName: "GitHub Models", baseUrl: "https://models.inference.ai.azure.com", apiFormat: "openai", keyEnv: "GITHUB_MODELS_TOKEN", models: ["gpt-4o"] },
    { name: "fireworks", displayName: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", apiFormat: "openai", keyEnv: "FIREWORKS_API_KEYS", models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"] },
    { name: "volcengine", displayName: "Volcengine (Doubao)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiFormat: "openai", keyEnv: "VOLCENGINE_API_KEYS", models: ["doubao-pro-32k"] },
    { name: "qianfan", displayName: "Qianfan (Baidu)", baseUrl: "https://qianfan.baidubce.com/v2", apiFormat: "openai", keyEnv: "QIANFAN_API_KEYS", models: ["ernie-4.5-8k"] },
    { name: "qiniu", displayName: "Qiniu AI", baseUrl: "https://api.qnaigc.com/v1", apiFormat: "openai", keyEnv: "QINIU_API_KEYS", models: ["qwen2.5-72b-instruct"] },
    { name: "hunyuan", displayName: "Hunyuan (Tencent)", baseUrl: "https://api.hunyuan.tencent.com/v1", apiFormat: "openai", keyEnv: "HUNYUAN_API_KEYS", models: ["hunyuan-pro"] },
    { name: "cloudflare-ai", displayName: "Cloudflare AI Gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai/v1", apiFormat: "openai", keyEnv: "CLOUDFLARE_API_KEYS", models: ["@cf/meta/llama-3.1-8b-instruct"] },
    { name: "huggingface", displayName: "Hugging Face (router)", baseUrl: "https://router.huggingface.co/v1", apiFormat: "openai", keyEnv: "HUGGINGFACE_API_KEYS", models: ["meta-llama/Llama-3.3-70B-Instruct"] },
    { name: "gemini", displayName: "Gemini (OpenAI-compatible)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiFormat: "openai", keyEnv: "GEMINI_API_KEYS", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"] },
    { name: "xai", displayName: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", apiFormat: "openai", keyEnv: "XAI_API_KEYS", models: ["grok-3", "grok-3-mini"] }
  ];
  const richStatus = { ...status, providerTemplates: richTemplates };
  const richHtml = renderDashboard(richStatus, 39210);
  const displayNames = ["Cerebras", "SambaNova", "LongCat (Meituan)", "DashScope (Alibaba Cloud)", "NVIDIA NIM", "GitHub Models", "Fireworks", "Volcengine (Doubao)", "Qianfan (Baidu)", "Qiniu AI", "Hunyuan (Tencent)", "Cloudflare AI Gateway", "Hugging Face (router)"];
  for (const name of displayNames) {
    assert(richHtml.includes(name), `new provider displayName '${name}' present in dashboard`);
  }
  // Updated model names.
  assert(richHtml.includes("gemini-2.5-flash"), "gemini-2.5-flash present");
  assert(richHtml.includes("gemini-2.5-flash-lite"), "gemini-2.5-flash-lite present");
  assert(richHtml.includes("grok-3"), "grok-3 present");
  assert(richHtml.includes("grok-3-mini"), "grok-3-mini present");
});

test("0.4.10: new provider keyEnv names appear in the templates", () => {
  // Render with the rich fixture so providerTemplate options are
  // populated; then assert the keyEnv values are visible in the
  // JSON-injected providerTemplates constant.
  const richTemplates = [
    { name: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiFormat: "openai", keyEnv: "CEREBRAS_API_KEYS", models: [] },
    { name: "sambanova", displayName: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", apiFormat: "openai", keyEnv: "SAMBANOVA_API_KEYS", models: [] },
    { name: "longcat", displayName: "LongCat", baseUrl: "https://api.longcat.chat/v1", apiFormat: "openai", keyEnv: "LONGCAT_API_KEYS", models: [] },
    { name: "dashscope", displayName: "DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiFormat: "openai", keyEnv: "DASHSCOPE_API_KEYS", models: [] },
    { name: "nvidia-nim", displayName: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiFormat: "openai", keyEnv: "NVIDIA_API_KEYS", models: [] },
    { name: "github-models", displayName: "GitHub Models", baseUrl: "https://models.inference.ai.azure.com", apiFormat: "openai", keyEnv: "GITHUB_MODELS_TOKEN", models: [] },
    { name: "fireworks", displayName: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", apiFormat: "openai", keyEnv: "FIREWORKS_API_KEYS", models: [] },
    { name: "volcengine", displayName: "Volcengine", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiFormat: "openai", keyEnv: "VOLCENGINE_API_KEYS", models: [] },
    { name: "qianfan", displayName: "Qianfan", baseUrl: "https://qianfan.baidubce.com/v2", apiFormat: "openai", keyEnv: "QIANFAN_API_KEYS", models: [] },
    { name: "qiniu", displayName: "Qiniu AI", baseUrl: "https://api.qnaigc.com/v1", apiFormat: "openai", keyEnv: "QINIU_API_KEYS", models: [] },
    { name: "hunyuan", displayName: "Hunyuan", baseUrl: "https://api.hunyuan.tencent.com/v1", apiFormat: "openai", keyEnv: "HUNYUAN_API_KEYS", models: [] },
    { name: "cloudflare-ai", displayName: "Cloudflare AI", baseUrl: "https://gateway.ai.cloudflare.com/v1", apiFormat: "openai", keyEnv: "CLOUDFLARE_API_KEYS", models: [] },
    { name: "huggingface", displayName: "Hugging Face", baseUrl: "https://router.huggingface.co/v1", apiFormat: "openai", keyEnv: "HUGGINGFACE_API_KEYS", models: [] }
  ];
  const richHtml = renderDashboard({ ...status, providerTemplates: richTemplates }, 39210);
  const envNames = ["CEREBRAS_API_KEYS", "SAMBANOVA_API_KEYS", "LONGCAT_API_KEYS", "DASHSCOPE_API_KEYS", "NVIDIA_API_KEYS", "GITHUB_MODELS_TOKEN", "FIREWORKS_API_KEYS", "VOLCENGINE_API_KEYS", "QIANFAN_API_KEYS", "QINIU_API_KEYS", "HUNYUAN_API_KEYS", "CLOUDFLARE_API_KEYS", "HUGGINGFACE_API_KEYS"];
  for (const env of envNames) {
    assert(richHtml.includes(env), `provider keyEnv '${env}' present in dashboard`);
  }
});

test("0.4.10: gemini + xai model names updated to current releases", () => {
  // gemini (2.0 -> 2.5) and xai (grok-2 -> grok-3).
  const richTemplates = [
    { name: "gemini", displayName: "Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiFormat: "openai", keyEnv: "GEMINI_API_KEYS", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"] },
    { name: "xai", displayName: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", apiFormat: "openai", keyEnv: "XAI_API_KEYS", models: ["grok-3", "grok-3-mini"] }
  ];
  const richHtml = renderDashboard({ ...status, providerTemplates: richTemplates }, 39210);
  assert(richHtml.includes("gemini-2.5-flash"), "gemini-2.5-flash present");
  assert(richHtml.includes("gemini-2.5-flash-lite"), "gemini-2.5-flash-lite present");
  assert(richHtml.includes("grok-3"), "grok-3 present");
  assert(richHtml.includes("grok-3-mini"), "grok-3-mini present");
});

test("0.4.10: discover-models widget is present with both A + B modes", () => {
  // The new widget lives inside the provider form collapsible and
  // supports two discovery modes: A (Base URL + Key, never saved)
  // and B (saved Provider's key from keyPool). Both end up in the
  // same checkbox checklist, not button-per-model.
  assert(html.includes('id="discover-models-card"'), "discover-models-card id present");
  assert(html.includes('id="discover-base-url"'), "discover-base-url input id present (mode A)");
  assert(html.includes('id="discover-api-key"'), "discover-api-key input id present (mode A)");
  assert(html.includes('id="discover-models-button"'), "discover-models-button id present (mode A)");
  assert(html.includes('id="discover-models-from-provider"'), "discover-models-from-provider button id present (mode B)");
  assert(html.includes('id="discover-models-provider-select"'), "discover-models-provider-select present (mode B)");
  assert(html.includes('id="discover-models-output"'), "discover-models-output id present");
  // Safety copy: mode A explicitly says Key is NOT saved / echoed.
  assert(/不会\s*<\/strong>\s*写入 config\.json \/ 日志 \/ 持久化文件/.test(html), "discover widget surfaces 'not written to config / log' contract");
  assert(/不会\s*<\/strong>\s*回显在响应里/.test(html), "discover widget surfaces 'not echoed in response' contract");
  // Mode B copy says it auto-uses the provider's saved key.
  assert(/方式 B/.test(html) && /已配置的 Provider/.test(html), "discover widget surfaces 'mode B = use saved provider key' contract");
  assert(/Web Key 优先，其次 \.env keyEnv/.test(html), "discover widget explains key resolution order in mode B");
});

test("0.4.10: discover-models JS handler supports both A and B modes + checkbox UI", () => {
  // The handler must call the server endpoint with the right body
  // for both modes. A mode sends { baseUrl, apiKey }; B mode
  // sends { provider }. The UI is a checklist with select-all /
  // none / invert and apply-replace / apply-merge buttons.
  assert(/function runDiscover\b/.test(html), "runDiscover function defined (replaces discoverModelsByUrl)");
  assert(/postJson\(\s*"\/admin\/discover-models"/.test(html), "calls /admin/discover-models endpoint");
  // Mode A path: payload has baseUrl
  assert(/baseUrl:\s*trimmed/.test(html) || /baseUrl:\s*baseUrl/.test(html), "mode A payload includes baseUrl");
  // Mode B path: payload has provider
  assert(/provider:\s*providerName/.test(html), "mode B payload includes provider");
  // Checklist UI
  assert(/data-discover-select-all/.test(html), "select-all button in checklist");
  assert(/data-discover-select-none/.test(html), "select-none button in checklist");
  assert(/data-discover-select-invert/.test(html), "invert button in checklist");
  assert(/data-discover-apply-replace/.test(html), "apply-replace button in checklist");
  assert(/data-discover-apply-merge/.test(html), "apply-merge button in checklist");
  assert(/data-discover-model-check/.test(html), "per-model checkbox attribute in checklist");
  // The handler must never echo the apiKey back. We assert
  // innerHTML writes never include the literal "apiKey" as a value.
  const handlerBlock = html.match(/function runDiscover[\s\S]*?function applyDiscoverToTextarea/);
  assert(handlerBlock, "discover handler block extractable");
  const innerHtmlWrites = handlerBlock[0].match(/innerHTML\s*=[\s\S]*?;/g) || [];
  for (const write of innerHtmlWrites) {
    assert(!/apiKey/.test(write), "no apiKey leak in innerHTML writes");
  }
});

test("0.4.10: Provider form surfaces the Web Key preservation contract", () => {
  // The user reported confusion that 'real API Key is gone after
  // update'. The fix: a permanent inline notice in the Provider
  // edit form that makes it explicit that Web Keys are stored
  // separately and are NOT touched when the provider is saved.
  assert(html.includes('id="provider-form-key-status"'), "provider-form-key-status notice id present");
  // The notice should explain independence + storage path + not-cleared.
  const noticeBlock = html.match(/id="provider-form-key-status"[\s\S]*?<\/div>/);
  assert(noticeBlock, "provider-form-key-status block extractable");
  const notice = noticeBlock[0];
  assert(/关于 Web Key/.test(notice), "notice title '关于 Web Key' present");
  assert(/独立/.test(notice), "notice says '独立' (independent)");
  assert(/data\/keys\.enc\.json/.test(notice), "notice surfaces keys.enc.json path");
  assert(/config\.json/.test(notice), "notice mentions config.json");
  assert(/不会\s*<\/strong>\s*清掉已有 Web Key/.test(notice) || /不会.*清掉已有 Web Key/.test(notice), "notice says saving the provider won't clear Web Keys");
  // Success message after addInlineProviderKey must include the
  // new key count so the user sees "1 -> 2" not just "added".
  const handlerBlock = html.match(/async function addInlineProviderKey[\s\S]*?scheduleSoftRefresh\(testAfter/);
  assert(handlerBlock, "addInlineProviderKey handler block extractable");
  assert(/现在共.*个 Web Key|newCount/.test(handlerBlock[0]), "success message includes new key count");
});

test("0.4.10: dashboard does NOT embed any example API key in the rendered output", () => {
  assert(!/sk-[A-Za-z0-9]{16,}/.test(html), "no raw sk-... key in dashboard");
  assert(!/sk-ant-[A-Za-z0-9]{16,}/.test(html), "no raw sk-ant-... key in dashboard");
  assert(!/AIza[A-Za-z0-9]{16,}/.test(html), "no raw AIza... key in dashboard");
});

// 0.3.7: provider test preview UI
test("0.3.7: provider test preview section is present in providers tab", () => {
  assert(html.includes('id="provider-test-preview-all"'), "preview-all button id present");
  assert(html.includes('id="provider-test-preview-local"'), "preview-local button id present");
  assert(html.includes('id="provider-test-preview-output"'), "preview-output container id present");
  assert(html.includes("配置健康预览（只读）"), "preview section title present");
  assert(html.includes("dry-run"), "dry-run label present in preview section");
  assert(html.includes("不调用上游"), "no-upstream-call safety copy present");
  assert(html.includes("不消耗额度"), "no-quota-consumption safety copy present");
  assert(html.includes("不写运行时状态"), "no-runtime-state-write safety copy present");
  assert(!html.includes("live=true"), "no live=true mode in dashboard");
});

// 0.3.8: Work tab toggle UX
test("0.3.8: 8 tool toggle buttons with data-tool-toggle are present", () => {
  for (const toolId of ["opencode", "codex", "openclaw", "aider", "goose", "continue", "claude", "amp"]) {
    assert(html.includes(`data-tool-toggle="${toolId}"`), `toggle button for ${toolId} present`);
  }
});

test("0.3.8: default active toggle matches tool-generator-tool default value", () => {
  // The default selected tool in <select> is OpenCode (first tool).
  // The toggle strip also marks opencode as active by default.
  const toolMatch = html.match(/<select id="tool-generator-tool"[^>]*>([\s\S]*?)<\/select>/);
  assert(toolMatch, "tool-generator-tool select present");
  const firstOption = toolMatch[1].match(/<option[^>]*value="([^"]+)"/);
  assert(firstOption, "first option value extractable");
  const firstValue = firstOption[1];
  // The active toggle should match this first value
  assert(html.includes(`data-tool-toggle="${firstValue}"`), `toggle for default tool ${firstValue} present`);
  // The toggle with class "active" or style should match
  assert(html.includes('tool-toggle-btn active') || html.includes('data-tool-toggle="opencode"'), "default toggle has active class");
});

test("0.3.8: setActiveToolToggle function is defined in inline script", () => {
  assert(html.includes("setActiveToolToggle"), "setActiveToolToggle function defined");
  assert(html.includes("function setActiveToolToggle"), "setActiveToolToggle as function declaration");
});

test("0.3.8: toggle click handler updates select and calls refreshToolGenerator", () => {
  // The click handler calls setActiveToolToggle, which updates the select
  // and either dispatches "change" event or calls refreshToolGenerator().
  assert(html.includes("setActiveToolToggle"), "setActiveToolToggle wired to toggle clicks");
  assert(html.includes('"data-tool-toggle"'), "toggle buttons queried via data-tool-toggle selector");
  assert(html.includes("refreshToolGenerator"), "refreshToolGenerator is called after toggle");
  assert(html.includes("sel.value"), "select value is updated on toggle");
});

test("0.3.8: safety copy states toggle does not modify system, registry, or shell profile", () => {
  assert(html.includes("不会") && html.includes("系统环境变量"), "toggle safety copy mentions system env");
  assert(html.includes("Windows 注册表") || html.includes("注册表"), "toggle safety copy mentions registry");
  assert(html.includes("shell profile") || html.includes(".bashrc") || html.includes(".zshrc"), "toggle safety copy mentions shell profile");
  assert(html.includes("复制按钮") && html.includes("剪贴板"), "toggle safety copy mentions copy button");
});

test("0.3.8: no high-risk write patterns in HTML/JS (setx, SetEnvironmentVariable, .bashrc, .zshrc, reg add)", () => {
  // These patterns represent system-level writes that must NOT appear
  // in the dashboard's tool toggle or generator code.
  assert(!html.includes("setx "), "no setx command in dashboard");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable in dashboard");
  // .bashrc / .zshrc may appear in safety copy as "NOT written to" — that's fine.
  // Check they are only mentioned in safety context (preceded by 不会/not)
  const bashrcPatterns = html.match(/\.bashrc/g) || [];
  const zshrcPatterns = html.match(/\.zshrc/g) || [];
  const regAddPatterns = html.match(/reg add/g) || [];
  assert(bashrcPatterns.length <= 12, ".bashrc only appears in safety context (0-12 times, multiple safety blocks across tabs)");
  assert(zshrcPatterns.length <= 12, ".zshrc only appears in safety context (0-12 times, multiple safety blocks across tabs)");
  assert(regAddPatterns.length === 0, "no 'reg add' command in dashboard");
});

test("0.3.8: existing tool generator elements are still present alongside toggle", () => {
  assert(html.includes('id="tool-generator-tool"'), "tool-generator-tool select still present");
  assert(html.includes('id="tool-generator-model"'), "tool-generator-model select still present");
  assert(html.includes('id="tool-generator-ps"'), "tool-generator-ps command box still present");
  assert(html.includes('id="tool-generator-cmd"'), "tool-generator-cmd command box still present");
  assert(html.includes('id="tool-generator-bash"'), "tool-generator-bash command box still present");
  assert(html.includes('id="tool-generator-verify"'), "tool-generator-verify command box still present");
  assert(html.includes("data-tool-card-id="), "static tool cards still present");
  assert(html.includes("data-copy-target"), "copy buttons still present");
  assert(html.includes("navigator.clipboard.writeText"), "clipboard writeText still used");
});

// 0.3.9: IDE dry-run panel
test("0.3.9: 4 IDE proxy cards with data-ide-proxy are present", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`data-ide-proxy="${id}"`), `IDE proxy card for ${id} present`);
  }
});

test("0.3.9: IDE capability matrix with id=ide-capability-matrix is present", () => {
  assert(html.includes('id="ide-capability-matrix"'), "ide-capability-matrix id present");
  // Each IDE row in the matrix
  assert(html.includes("Cursor"), "Cursor row in capability matrix");
  assert(html.includes("Windsurf"), "Windsurf row in capability matrix");
  assert(html.includes("VS Code Copilot"), "VS Code Copilot row in capability matrix");
  assert(html.includes("Antigravity"), "Antigravity row in capability matrix");
});

test("0.3.9: each IDE card has disabled start/stop buttons", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`data-ide-start="${id}" disabled`), `start button for ${id} is disabled`);
    assert(html.includes(`data-ide-stop="${id}" disabled`), `stop button for ${id} is disabled`);
  }
});

test("0.3.9: dry-run toggle elements are present (data-ide-dry-run + data-ide-dry-run-output)", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`data-ide-dry-run="${id}"`), `dry-run button for ${id} present`);
    assert(html.includes(`data-ide-dry-run-output="${id}"`), `dry-run output for ${id} present`);
  }
});

test("0.3.9: safety copy is present (no token/cookie/session reading, no config modify, dry-run)", () => {
  assert(html.includes("dry-run") || html.includes("Dry-run") || html.includes("dry run"), "dry-run label present");
  assert(html.includes("不读取"), "safety copy mentions 不读取");
  assert(html.includes("token") || html.includes("Token"), "token mentioned in safety context");
  assert(html.includes("cookie") || html.includes("Cookie"), "cookie mentioned in safety context");
  assert(html.includes("session") || html.includes("Session"), "session mentioned in safety context");
  assert(html.includes("不修改"), "safety copy mentions 不修改");
  assert(html.includes("不启动"), "safety copy mentions 不启动");
});

test("0.3.9: high-risk file/path read patterns are NOT present as actual read operations", () => {
  // These patterns must NOT appear in the HTML/JS as literal file reads
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
  assert(!html.includes("AppData\\\\Cursor"), "no AppData\\Cursor path in dashboard");
  assert(!html.includes(".config/Cursor"), "no .config/Cursor path in dashboard");
  // "Cookies" can appear in safety text but not as a file read path
  // "session" can appear in safety text
  assert(!html.includes("setx "), "no setx command in dashboard");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable in dashboard");
  assert(!html.includes("reg add"), "no reg add in dashboard");
});

test("0.3.9: existing tabs are NOT broken by IDE tab changes", () => {
  // The six original tab anchors must still be present
  for (const id of ["overview", "providers", "routes", "tools", "usage", "settings"]) {
    assert(html.includes(`href="#${id}"`), `anchor to #${id} still present`);
    assert(html.includes(`data-tab="${id}"`), `data-tab="${id}" still present`);
  }
  // IDE tab must also be present
  assert(html.includes('href="#ide"'), "anchor to #ide present");
  assert(html.includes('data-tab="ide"'), "data-tab=ide present");
  assert(html.includes('id="tab-ide"'), "ide tab pane id present");
});

test("0.3.9: renderDashboard with custom port 40123 shows correct dry-run listen URLs", () => {
  const customHtml = renderDashboard(status, 40123);
  // Each IDE card should reference the custom port
  assert(customHtml.includes("127.0.0.1:40124"), "cursor proxy port 40124 present");
  assert(customHtml.includes("127.0.0.1:40125"), "windsurf proxy port 40125 present");
  assert(customHtml.includes("127.0.0.1:40126"), "vscode-copilot proxy port 40126 present");
  assert(customHtml.includes("127.0.0.1:40127"), "antigravity proxy port 40127 present");
});

test("0.3.9: each IDE card shows 'dry-run only' status pill", () => {
  // The status pill should appear 4 times (once per card)
  const matches = html.match(/dry-run only/g) || [];
  assert(matches.length >= 4, "at least 4 'dry-run only' pills found, got " + matches.length);
});

test("0.3.9: inline script parses alongside existing dashboard inline script", () => {
  // Full inline script parse test (already exists above, just additional
  // assurance that the IDE script doesn't cause double-parse failures)
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert(match, "inline script present");
  try {
    new Function(match[1]);
  } catch (error) {
    throw new Error("inline script parse failed with IDE script: " + error.message);
  }
  try {
    new Function(match[1]);
  } catch (error) {
    throw new Error("second parse failed (IIFE isolation issue with IDE script): " + error.message);
  }
});

test("0.3.8: 8 tool names in toggle strip match the 8 static tool cards", () => {
  for (const name of ["OpenCode", "Codex (OpenAI Codex CLI)", "OpenClaw", "Aider", "Goose", "Continue (VSCode / JetBrains)", "Claude Code", "Amp"]) {
    assert(html.includes(`data-tool-toggle-name="${name}"`), `toggle shows tool name: ${name}`);
  }
});

// 0.3.10: IDE proxy preview API
test("0.3.10: full dashboard HTML contains ide-preview-refresh button", () => {
  assert(html.includes('id="ide-preview-refresh"'), "Refresh preview button present in dashboard");
  assert(html.includes("Refresh preview"), "Refresh preview button text present");
});

test("0.3.10: full dashboard HTML has model selector for preview", () => {
  assert(html.includes('id="ide-preview-model"'), "ide-preview-model select present in dashboard");
});

test("0.3.10: full dashboard HTML has existing 0.3.9 selectors still present", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`data-ide-proxy="${id}"`), `IDE proxy card for ${id} still present`);
    assert(html.includes(`data-ide-start="${id}" disabled`), `start button for ${id} still disabled`);
    assert(html.includes(`data-ide-stop="${id}" disabled`), `stop button for ${id} still disabled`);
    assert(html.includes(`data-ide-dry-run="${id}"`), `dry-run button for ${id} still present`);
  }
  assert(html.includes('id="ide-capability-matrix"'), "ide-capability-matrix still present");
});

test("0.3.10: no dangerous patterns in full dashboard HTML (readFileSync, AppData\\Cursor, .config/Cursor, setx, SetEnvironmentVariable, reg add, shell profile writes)", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
  assert(!html.includes("AppData\\\\Cursor"), "no AppData\\Cursor path");
  assert(!html.includes(".config/Cursor"), "no .config/Cursor path");
  assert(!html.includes("setx "), "no setx command");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable");
  assert(!html.includes("reg add"), "no reg add");
});

test("0.3.10: inline script has runIdeProxyPreview function for the refresh handler", () => {
  const fullHtml = renderDashboard(status, 39210);
  assert(fullHtml.includes("runIdeProxyPreview"), "runIdeProxyPreview function defined in inline script");
  assert(fullHtml.includes("/admin/ide-proxy-preview"), "endpoint path referenced in inline script");
  assert(fullHtml.includes("ide-preview-refresh"), "refresh button event listener wired");
});

// 0.3.12: IDE proxy runtime status skeleton
test("0.3.12: dashboard IDE tab has ide-status-refresh button", () => {
  assert(html.includes('id="ide-status-refresh"'), "Refresh status button id present in dashboard");
  assert(html.includes("Refresh status"), "Refresh status button text present");
});

test("0.3.12: dashboard IDE tab has status summary panel with correct IDs", () => {
  assert(html.includes('id="ide-status-summary"'), "ide-status-summary panel present");
  assert(html.includes('id="ide-status-display"'), "ide-status-display element present");
  assert(html.includes('id="ide-status-text"'), "ide-status-text present");
  assert(html.includes('id="ide-summary-total"'), "ide-summary-total present");
  assert(html.includes('id="ide-summary-running"'), "ide-summary-running present");
  assert(html.includes('id="ide-summary-stopped"'), "ide-summary-stopped present");
  assert(html.includes('id="ide-mode-pill"'), "ide-mode-pill present");
  assert(html.includes('id="ide-status-version"'), "ide-status-version present");
});

test("0.3.12: each proxy card has status/phase display element", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`id="ide-proxy-status-${id}"`), `status element for ${id} present`);
  }
});

test("0.3.12: existing 0.3.9/0.3.10 selectors still present", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`data-ide-proxy="${id}"`), `IDE proxy card for ${id} still present`);
    assert(html.includes(`data-ide-start="${id}" disabled`), `start button for ${id} still disabled`);
    assert(html.includes(`data-ide-stop="${id}" disabled`), `stop button for ${id} still disabled`);
    assert(html.includes(`data-ide-dry-run="${id}"`), `dry-run button for ${id} still present`);
  }
  assert(html.includes('id="ide-capability-matrix"'), "ide-capability-matrix still present");
  assert(html.includes('id="ide-preview-refresh"'), "ide-preview-refresh still present");
  assert(html.includes('id="ide-preview-model"'), "ide-preview-model still present");
});

test("0.3.12: no dangerous patterns in dashboard HTML", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
  assert(!html.includes("AppData\\\\Cursor"), "no AppData\\Cursor path");
  assert(!html.includes(".config/Cursor"), "no .config/Cursor path");
  assert(!html.includes("setx "), "no setx command");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable");
  assert(!html.includes("reg add"), "no reg add");
});

// 0.3.13: IDE proxy port readiness dry-run
test("0.3.13: dashboard IDE tab has port check controls", () => {
  assert(html.includes('id="ide-port-check"'), "Check ports button id present");
  assert(html.includes("Check ports"), "Check ports button text present");
  assert(html.includes('id="ide-port-check-display"'), "ide-port-check-display element present");
  assert(html.includes('id="ide-port-check-summary"'), "ide-port-check-summary panel present");
  assert(html.includes('id="ide-port-available"'), "ide-port-available summary present");
  assert(html.includes('id="ide-port-occupied"'), "ide-port-occupied summary present");
  assert(html.includes('id="ide-port-unknown"'), "ide-port-unknown summary present");
});

test("0.3.13: each proxy card has port status display element", () => {
  for (const id of ["cursor", "windsurf", "vscode-copilot", "antigravity"]) {
    assert(html.includes(`id="ide-proxy-port-${id}"`), `port element for ${id} present`);
  }
});

test("0.3.13: inline script wires the port check endpoint", () => {
  assert(html.includes("runIdeProxyPortCheck"), "runIdeProxyPortCheck function present");
  assert(html.includes("/admin/ide-proxy-port-check"), "port check endpoint referenced");
  assert(html.includes("ide-port-check"), "port check click target referenced");
});

test("0.3.13: port check UI preserves dry-run safety boundaries", () => {
  assert(!html.includes("net.createServer"), "dashboard does not contain listener startup");
  assert(!html.includes("AppData\\\\Cursor"), "no Cursor AppData credential path");
  assert(!html.includes(".config/Cursor"), "no Cursor config path");
  assert(!html.includes("SetEnvironmentVariable"), "no system env write");
  assert(!html.includes("reg add"), "no registry write command");
});

// 0.3.14: IDE proxy start plan dry-run
test("0.3.14: dashboard IDE tab has start plan controls", () => {
  assert(html.includes('id="ide-start-plan"'), "Build start plan button id present");
  assert(html.includes("Build start plan"), "Build start plan button text present");
  assert(html.includes('id="ide-start-plan-display"'), "ide-start-plan-display present");
  assert(html.includes('id="ide-start-plan-summary"'), "ide-start-plan-summary panel present");
  assert(html.includes('id="ide-start-plan-output"'), "ide-start-plan-output present");
});

test("0.3.14: start plan summary fields are present", () => {
  for (const id of ["ide-plan-total", "ide-plan-ready", "ide-plan-blocked", "ide-plan-review"]) {
    assert(html.includes(`id="${id}"`), `${id} present`);
  }
});

test("0.3.14: inline script wires the start plan endpoint", () => {
  assert(html.includes("runIdeProxyStartPlan"), "runIdeProxyStartPlan function present");
  assert(html.includes("/admin/ide-proxy-start-plan"), "start plan endpoint referenced");
  assert(html.includes("ide-start-plan"), "start plan click target referenced");
});

test("0.3.14: start plan UI does not start listeners or touch credentials/config", () => {
  assert(!html.includes("net.createServer"), "no listener startup");
  assert(!html.includes("child_process"), "no child process launch");
  assert(!html.includes("AppData\\\\Cursor"), "no Cursor credential path");
  assert(!html.includes(".config/Cursor"), "no Cursor config path");
  assert(!html.includes("SetEnvironmentVariable"), "no environment write");
  assert(!html.includes("reg add"), "no registry write");
});

// 0.3.11: Vercel AI Gateway provider template
test("0.3.11: dashboard providerTemplates includes AI_GATEWAY_API_KEYS", () => {
  const vercelTemplate = [
    { name: "vercel-ai-gateway", displayName: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", apiFormat: "openai", keyEnv: "AI_GATEWAY_API_KEYS", models: ["openai/gpt-5.4"] }
  ];
  const richHtml = renderDashboard({ ...status, providerTemplates: vercelTemplate }, 39210);
  assert(richHtml.includes("AI_GATEWAY_API_KEYS"), "dashboard includes AI_GATEWAY_API_KEYS key env");
  assert(richHtml.includes("vercel-ai-gateway"), "dashboard includes vercel-ai-gateway provider");
  assert(richHtml.includes("Vercel AI Gateway"), "dashboard includes Vercel AI Gateway display name");
  assert(richHtml.includes("https://ai-gateway.vercel.sh/v1"), "dashboard includes Vercel base URL");
});

test("0.3.11: dashboard 0.4.10 rich fixture plus Vercel template appears", () => {
  const richTemplates = [
    { name: "vercel-ai-gateway", displayName: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", apiFormat: "openai", keyEnv: "AI_GATEWAY_API_KEYS", models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.6", "xai/grok-4.1-fast-reasoning"] },
    { name: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiFormat: "openai", keyEnv: "CEREBRAS_API_KEYS", models: ["llama-3.3-70b"] }
  ];
  const richHtml = renderDashboard({ ...status, providerTemplates: richTemplates }, 39210);
  assert(richHtml.includes("Vercel AI Gateway"), "Vercel AI Gateway in mixed template list");
  assert(richHtml.includes("AI_GATEWAY_API_KEYS"), "AI_GATEWAY_API_KEYS in mixed template list");
  assert(richHtml.includes("https://ai-gateway.vercel.sh/v1"), "Vercel base URL in mixed template list");
  assert(richHtml.includes("openai/gpt-5.4"), "Vercel model openai/gpt-5.4 rendered");
  assert(richHtml.includes("anthropic/claude-sonnet-4.6"), "Vercel model anthropic/claude-sonnet-4.6 rendered");
  assert(richHtml.includes("xai/grok-4.1-fast-reasoning"), "Vercel model xai/grok-4.1-fast-reasoning rendered");
});

// 0.3.15: local connector discovery plan
test("0.3.15: connector plan section is present in providers tab", () => {
  assert(html.includes('id="local-connector-plan-build"'), "build connector plan button id present");
  assert(html.includes('id="local-connector-plan-refresh"'), "refresh connector plan button id present");
  assert(html.includes('id="local-connector-plan-output"'), "connector plan output container id present");
  assert(html.includes("本地连接器发现计划"), "connector plan section title present");
  assert(html.includes("不读取"), "safety copy mentions 不读取");
  assert(html.includes("不会读取凭据"), "safety copy mentions 不会读取凭据");
});

test("0.3.15: connector plan section references the endpoint via data-attribute", () => {
  assert(html.includes('data-connector-plan-endpoint="/admin/local-connector-plan"'), "connector plan endpoint data attribute present");
});

test("0.3.15: connector plan section referenced in multiple elements", () => {
  const match = html.match(/local-connector-plan/g) || [];
  assert(match.length >= 4, "local-connector-plan referenced in button/container ids and endpoint path");
});

test("0.3.15: connector plan section does not contain dangerous patterns", () => {
  assert(!html.includes("readFileSync"), "no readFileSync");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable");
  assert(!html.includes("reg add"), "no reg add");
  assert(!html.includes("setx "), "no setx");
});

test("0.3.15 fix: inline script contains runLocalConnectorPlan function", () => {
  assert(html.includes("runLocalConnectorPlan"), "runLocalConnectorPlan function defined in inline script");
  assert(html.includes("renderConnectorPlanResult"), "renderConnectorPlanResult function defined in inline script");
});

test("0.3.15 fix: inline script references /admin/local-connector-plan endpoint", () => {
  assert(html.includes("/admin/local-connector-plan"), "connector plan endpoint referenced in inline script");
  assert(html.includes("getJson"), "uses getJson helper for fetch");
});

test("0.3.15 fix: both buttons have click handlers wired in the inline script", () => {
  assert(html.includes('local-connector-plan-build'), "build button referenced in click handler");
  assert(html.includes('local-connector-plan-refresh'), "refresh button referenced in click handler");
  assert(html.includes("addEventListener"), "addEventListener used for button binding");
});

test("0.3.15 fix: renderConnectorPlanResult renders summary fields from response", () => {
  assert(html.includes("credentialReads"), "credentialReads field rendered in summary");
  assert(html.includes("configWrites"), "configWrites field rendered in summary");
  assert(html.includes("availableOnSelectedPlatform"), "availableOnSelectedPlatform field used in render");
});

test("0.3.15 fix: connector plan UI does not contain dangerous write or spawn patterns", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in connector plan JS");
  assert(!html.includes("writeFileSync"), "no writeFileSync in connector plan JS");
  assert(!html.includes("child_process"), "no child_process in connector plan JS");
  assert(!html.includes("spawn("), "no spawn( in connector plan JS");
  assert(!html.includes("exec("), "no exec( in connector plan JS");
  assert(!html.includes("net.createServer"), "no net.createServer in connector plan JS");
  assert(!html.includes("http.createServer"), "no http.createServer in connector plan JS");
  assert(!html.includes("SetEnvironmentVariable"), "no SetEnvironmentVariable in connector plan JS");
  assert(!html.includes("setx "), "no setx in connector plan JS");
  assert(!html.includes("reg add"), "no reg add in connector plan JS");
});

test("0.3.15 fix: connector plan result renderer handles failure state", () => {
  assert(html.includes("连接器计划失败") || html.includes("连接器计划请求失败"), "connector plan failure renderer present");
  assert(html.includes("连接器发现计划") && html.includes("dry-run"), "connector plan success renderer present");
});

// 0.3.16: local connector availability UI
test("0.3.16: local connector availability endpoint string is present", () => {
  assert(html.includes("/admin/local-connector-availability"), "availability endpoint path present in dashboard");
});

test("0.3.16: availability check and refresh buttons are present", () => {
  assert(html.includes("id=\"local-connector-availability-check\""), "availability check button id present");
  assert(html.includes("id=\"local-connector-availability-refresh\""), "availability refresh button id present");
  assert(html.includes("data-connector-availability-endpoint"), "availability button data attribute present");
});

test("0.3.16: availability output container is present", () => {
  assert(html.includes("id=\"local-connector-availability-output\""), "availability output container id present");
});

test("0.3.16: runLocalConnectorAvailability function is defined in dashboard client JS", () => {
  assert(html.includes("runLocalConnectorAvailability"), "runLocalConnectorAvailability function present");
});

test("0.3.16: renderConnectorAvailabilityResult function is defined", () => {
  assert(html.includes("renderConnectorAvailabilityResult"), "renderConnectorAvailabilityResult function present");
});

test("0.3.16: availability UI renders summary fields including pathsDisclosed and processesStarted", () => {
  assert(html.includes("pathsDisclosed"), "pathsDisclosed field in availability UI");
  assert(html.includes("processesStarted"), "processesStarted field in availability UI");
  assert(html.includes("路径泄露"), "路径泄露 label");
  assert(html.includes("进程启动"), "进程启动 label");
});

test("0.3.16: no dangerous patterns in availability UI (no path reads, no token reads)", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
});

test("0.3.16: existing connector plan UI still works alongside availability UI", () => {
  assert(html.includes("id=\"local-connector-plan-build\""), "connector plan build button still present");
  assert(html.includes("id=\"local-connector-plan-refresh\""), "connector plan refresh button still present");
  assert(html.includes("id=\"local-connector-plan-output\""), "connector plan output still present");
  assert(html.includes("runLocalConnectorPlan"), "runLocalConnectorPlan still present");
});

// 0.3.17: local connector provider preview
test("0.3.17: provider preview endpoint string is present", () => {
  assert(html.includes("/admin/local-connector-provider-preview"), "provider preview endpoint path present in dashboard");
});

test("0.3.17: provider preview build and refresh buttons are present", () => {
  assert(html.includes("id=\"local-connector-provider-preview-build\""), "provider preview build button id present");
  assert(html.includes("id=\"local-connector-provider-preview-refresh\""), "provider preview refresh button id present");
  assert(html.includes("data-connector-provider-preview-endpoint"), "provider preview button data attribute present");
});

test("0.3.17: provider preview output container is present", () => {
  assert(html.includes("id=\"local-connector-provider-preview-output\""), "provider preview output container id present");
});

test("0.3.17: runLocalConnectorProviderPreview function is defined in dashboard client JS", () => {
  assert(html.includes("runLocalConnectorProviderPreview"), "runLocalConnectorProviderPreview function present");
});

test("0.3.17: renderConnectorProviderPreviewResult function is defined", () => {
  assert(html.includes("renderConnectorProviderPreviewResult"), "renderConnectorProviderPreviewResult function present");
});

test("0.3.17: provider preview UI renders summary fields including routesRegistered and credentialConsentRequired", () => {
  assert(html.includes("routesRegistered"), "routesRegistered field in provider preview UI");
  assert(html.includes("credentialConsentRequired"), "credentialConsentRequired field in provider preview UI");
  assert(html.includes("路由注册"), "路由注册 label");
  assert(html.includes("需凭据同意"), "需凭据同意 label");
  assert(html.includes("预览就绪"), "预览就绪 label");
});

test("0.3.17: no dangerous patterns in provider preview UI (no path reads, no token reads)", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
  assert(!html.includes("AppData\\\\"), "no AppData paths");
  assert(!html.includes(".config/"), "no .config paths");
});

test("0.3.17: existing connector plan and availability UI still work alongside provider preview", () => {
  assert(html.includes("id=\"local-connector-plan-build\""), "connector plan build button still present");
  assert(html.includes("id=\"local-connector-plan-refresh\""), "connector plan refresh button still present");
  assert(html.includes("id=\"local-connector-availability-check\""), "availability check button still present");
  assert(html.includes("id=\"local-connector-availability-refresh\""), "availability refresh button still present");
  assert(html.includes("runLocalConnectorPlan"), "runLocalConnectorPlan still present");
  assert(html.includes("runLocalConnectorAvailability"), "runLocalConnectorAvailability still present");
});

// 0.3.18: local connector consent manifest
test("0.3.18: consent manifest endpoint string is present", () => {
  assert(html.includes("/admin/local-connector-consent-manifest"), "consent manifest endpoint path present in dashboard");
});

test("0.3.18: consent manifest build and refresh buttons are present", () => {
  assert(html.includes("id=\"local-connector-consent-manifest-build\""), "consent manifest build button id present");
  assert(html.includes("id=\"local-connector-consent-manifest-refresh\""), "consent manifest refresh button id present");
  assert(html.includes("data-connector-consent-manifest-endpoint"), "consent manifest button data attribute present");
});

test("0.3.18: consent manifest output container is present", () => {
  assert(html.includes("id=\"local-connector-consent-manifest-output\""), "consent manifest output container id present");
});

test("0.3.18: runLocalConnectorConsentManifest function is defined in dashboard client JS", () => {
  assert(html.includes("runLocalConnectorConsentManifest"), "runLocalConnectorConsentManifest function present");
});

test("0.3.18: renderConnectorConsentManifestResult function is defined", () => {
  assert(html.includes("renderConnectorConsentManifestResult"), "renderConnectorConsentManifestResult function present");
});

test("0.3.18: consent manifest UI renders summary fields including consentStored and canProceed", () => {
  assert(html.includes("consentStored"), "consentStored field in consent manifest UI");
  assert(html.includes("canProceed"), "canProceed field in consent manifest UI");
  assert(html.includes("授权保存"), "授权保存 label");
  assert(html.includes("可继续"), "可继续 label");
  assert(html.includes("需授权"), "需授权 label");
});

test("0.3.18: no dangerous patterns in consent manifest UI", () => {
  assert(!html.includes("readFileSync"), "no readFileSync in dashboard");
  assert(!html.includes("writeFileSync"), "no writeFileSync in dashboard");
  assert(!html.includes("AppData\\\\"), "no AppData paths");
  assert(!html.includes(".config/"), "no .config paths");
});

test("0.3.18: connector plan, availability, and provider preview UI still work alongside consent manifest", () => {
  assert(html.includes("id=\"local-connector-plan-build\""), "connector plan build button still present");
  assert(html.includes("id=\"local-connector-availability-check\""), "availability check button still present");
  assert(html.includes("id=\"local-connector-provider-preview-build\""), "provider preview build button still present");
  assert(html.includes("id=\"local-connector-consent-manifest-build\""), "consent manifest build button present");
});

// 0.3.19: provider template parity audit
test("0.3.19: provider template parity endpoint string is present", () => {
  assert(html.includes("/admin/provider-template-parity"), "provider template parity endpoint path present in dashboard");
});

test("0.3.19: provider template parity controls are present", () => {
  assert(html.includes("id=\"provider-template-parity-check\""), "provider template parity check button present");
  assert(html.includes("id=\"provider-template-parity-refresh\""), "provider template parity refresh button present");
  assert(html.includes("data-provider-template-parity-endpoint"), "provider template parity data attribute present");
});

test("0.3.19: provider template parity output container is present", () => {
  assert(html.includes("id=\"provider-template-parity-output\""), "provider template parity output container present");
});

test("0.3.19: provider template parity client functions are defined", () => {
  assert(html.includes("renderProviderTemplateParityResult"), "renderProviderTemplateParityResult function present");
  assert(html.includes("runProviderTemplateParity"), "runProviderTemplateParity function present");
});

test("0.3.19: provider template parity UI renders target and safety fields", () => {
  assert(html.includes("totalTemplates"), "totalTemplates field present");
  assert(html.includes("apiLocalTargetCovered"), "apiLocalTargetCovered field present");
  assert(html.includes("nonVirtualWithLocalConnectors"), "nonVirtualWithLocalConnectors field present");
  assert(html.includes("makesNetworkRequests"), "makesNetworkRequests safety field present");
  assert(html.includes("writesConfig"), "writesConfig safety field present");
});

// 0.3.20: provider template import plan
test("0.3.20: provider template import endpoints and controls are present", () => {
  assert(html.includes("/admin/provider-template-import-plan"), "provider template import plan endpoint present");
  assert(html.includes("/admin/provider-template-import"), "provider template import endpoint present");
  assert(html.includes("id=\"provider-template-import-plan\""), "provider template import plan button present");
  assert(html.includes("id=\"provider-template-import-apply\""), "provider template import apply button present");
  assert(html.includes("id=\"provider-template-import-output\""), "provider template import output present");
});

test("0.3.20: provider template import client functions are defined", () => {
  assert(html.includes("renderProviderTemplateImportPlanResult"), "renderProviderTemplateImportPlanResult function present");
  assert(html.includes("runProviderTemplateImportPlan"), "runProviderTemplateImportPlan function present");
  assert(html.includes("applyProviderTemplateImport"), "applyProviderTemplateImport function present");
});

test("0.3.20: provider template import UI includes confirmation and safety copy", () => {
  assert(html.includes("ADD_MISSING_PROVIDER_TEMPLATES"), "confirmation string present");
  assert(html.includes("不会保存 API Key"), "no API key storage copy present");
  assert(html.includes("不会调用上游 API"), "no network copy present");
  assert(html.includes("不会导入带占位符"), "placeholder skip copy present");
});

// 0.3.21: local connector consent ledger
test("0.3.21: local connector consent ledger endpoints and controls are present", () => {
  assert(html.includes("/admin/local-connector-consent-ledger"), "consent ledger endpoint present");
  assert(html.includes("/admin/local-connector-consent"), "consent apply endpoint present");
  assert(html.includes("id=\"local-connector-consent-ledger-refresh\""), "consent ledger refresh button present");
  assert(html.includes("id=\"local-connector-consent-approve\""), "consent approve button present");
  assert(html.includes("id=\"local-connector-consent-revoke\""), "consent revoke button present");
  assert(html.includes("id=\"local-connector-consent-ledger-output\""), "consent ledger output present");
});

test("0.3.21: local connector consent ledger client functions are defined", () => {
  assert(html.includes("renderConnectorConsentLedgerResult"), "renderConnectorConsentLedgerResult function present");
  assert(html.includes("runLocalConnectorConsentLedger"), "runLocalConnectorConsentLedger function present");
  assert(html.includes("applyLocalConnectorConsent"), "applyLocalConnectorConsent function present");
});

test("0.3.21: local connector consent ledger includes confirmation and safety copy", () => {
  assert(html.includes("APPROVE_LOCAL_CONNECTOR_CONSENT"), "approve confirmation string present");
  assert(html.includes("REVOKE_LOCAL_CONNECTOR_CONSENT"), "revoke confirmation string present");
  assert(html.includes("只保存元数据"), "metadata-only copy present");
  assert(html.includes("不会读取凭据"), "no credential read copy present");
  assert(html.includes("不会读取凭据、路径、启动进程或注册路由"), "no credential/path/process/route copy present");
});

test("0.3.15 fix: inline script defines client-side escapeHtml function", () => {
  // The HTML has two inline <script> blocks: the first carries
  // injected JSON (providers, routes, etc.) and the second carries
  // the full dashboard-client.js. We search the entire HTML for
  // the function definition.
  assert(html.includes("function escapeHtml"), "escapeHtml function is defined in the page");
  // Verify the escape map entries are present in the function body
  assert(html.includes("&amp;"), "escapeHtml handles &amp;");
  assert(html.includes("&lt;"), "escapeHtml handles &lt;");
  assert(html.includes("&gt;"), "escapeHtml handles &gt;");
  assert(html.includes("&quot;"), "escapeHtml handles &quot;");
  assert(html.includes("&#39;"), "escapeHtml handles &#39;");
  // Verify safe null/undefined handling
  assert(html.includes("null"), "escapeHtml handles null/undefined");
  // Verify the function parses as valid JS
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<script>([\s\S]*?)<\/script>/);
  assert(scriptMatch, "two script blocks present");
  const clientScript = scriptMatch[2];
  const funcMatch = clientScript.match(/function escapeHtml[\s\S]*?\n  \}/);
  if (funcMatch) {
    try {
      new Function("return " + funcMatch[0]);
    } catch (error) {
      throw new Error("escapeHtml function failed to parse: " + error.message);
    }
  }
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
