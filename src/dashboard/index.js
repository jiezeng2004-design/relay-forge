// Dashboard HTML + embedded admin client.
// Pure: takes a status snapshot object and returns a string.
// The status object is built by the caller so this stays free of side
// effects and easy to render in unit tests.
//
// 0.5.1 split: this file is now the entry point. The 6 tab renderers
// live under ./tabs/, the row + error helpers under ./rows.js, and
// small shared utilities (scriptJson, formatTimestamp, renderLimit,
// etc.) under ./shared.js. The HTML shell, the inline <script>, and
// the CSS all stay here so the inline script can keep its single
// top-level scope (no IIFE wrapping, per project convention).
//
// 0.5 layout:
//   - Sidebar nav with 6 tabs: 总览 / Provider / 模型组 / 工具接入 / 用量与错误 / 设置
//   - Default tab is 总览; URL hash (#overview, #providers, ...) preserves state
//   - No new server behavior. All buttons still hit the same /admin/* endpoints.
//   - Still does NOT read token / cookie / session / browser credentials.
//   - Error categories are now server-authoritative (see
//     src/error-category.js); this file only uses the heuristic as a
//     fallback for old persisted entries without `category`.

import { escapeHtml } from "../http-helpers.js";
import { scriptJson, formatTimestamp, topUsageLabel, renderLimit, buildProfileDefaultOptions } from "./shared.js";
import { renderProviderTableRow, renderRouteRow, renderErrorRow, classifyErrorCounts, buildDiagnosticSummary, buildCodexDiagnosticPackage } from "./rows.js";
import { renderOverviewTab } from "./tabs/overview.js";
import { renderProvidersTab } from "./tabs/providers.js";
import { renderRoutesTab } from "./tabs/routes.js";
import { renderToolCards } from "./tabs/tools.js";
import { renderUsageTab } from "./tabs/usage.js";
import { renderSettingsTab } from "./tabs/settings.js";
import { renderIdeTab } from "./tabs/ide.js";
import { renderComboModelsTab } from "./tabs/combo-models.js";
import { renderClientsTab } from "./tabs/clients.js";
import { getBundlesForClient, I18N_DEFAULT_LOCALE, I18N_SUPPORTED_LOCALES, makeT } from "../i18n.js";
import { DASHBOARD_CSS } from "./css.js";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DASHBOARD_SCRIPT_PATH = resolve(__dirname, "static", "dashboard-client.js");

// `options.locale` selects the dashboard UI language. Default is
// "zh" to preserve the existing dashboard output. The server
// supplies the locale by reading the OPENRELAY_LOCALE cookie (or
// the URL query `?lang=en`) before calling this function.
export function renderDashboard(status, port, options = {}) {
  const locale = I18N_SUPPORTED_LOCALES.includes(options.locale) ? options.locale : I18N_DEFAULT_LOCALE;
  const t = makeT(locale);
  const i18nBundle = getBundlesForClient(locale);
  const providers = status.providers || [];
  const combos = status.combos || [];
  const webKeys = status.webKeys || [];
  const providerTemplates = status.providerTemplates || [];
  const routes = status.routes || [];
  const routeTemplates = status.routeTemplates || [];
  const profileList = (status.profiles && status.profiles.profiles) || [];
  const activeProfileName = (status.profiles && status.profiles.activeProfile) || null;
  const defaultModel = (status.profiles && status.profiles.defaultModel) || null;
  const recentErrors = status.recentErrors || [];
  const recentRequests = status.recentRequests || [];
  const healthCache = status.healthCache || {};
  const keys = status.keys || {};
  const providerHealth = status.providerHealth || {};

  // JSON-injected for the inline <script> below
  const providersScript = scriptJson(status.providers || []);
  const providerTemplatesScript = scriptJson(providerTemplates);
  const routesScript = scriptJson(routes);
  const routeTemplatesScript = scriptJson(routeTemplates);
  const webKeysScript = scriptJson(webKeys);
  const clientScript = readFileSync(DASHBOARD_SCRIPT_PATH, "utf8");

  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const apiKeyHint = status.relayAuth?.apiKeyHint || "local";
  const relayTokenRequired = !!status.relayAuth?.tokenRequired;
  // 0.5.4: relayAuth no longer carries the full token. The
  // inline script below only sees masked hints. The full token
  // is reachable only via /admin/auth/token (admin-authed
  // XHR), which the "Copy full token" button on the overview
  // tab issues with the sessionStorage-cached admin token. The
  // tools tab's env-var export still needs a placeholder; when
  // auth is required, the operator must read
  // data/security/relay-token once and the inline script fetches
  // the live value lazily.
  const relayAuthState = {
    tokenRequired: relayTokenRequired,
    allowNoAuth: !!status.relayAuth?.allowNoAuth,
    tokenSource: status.relayAuth?.tokenSource || "unset",
    apiKeyHint,
    apiKeyMasked: status.relayAuth?.apiKeyMasked || apiKeyHint
  };

  // ---- webKeys by provider (used by both overview and providers) ----
  const webKeysByProvider = webKeys.reduce((acc, key) => {
    if (!acc[key.provider]) acc[key.provider] = [];
    acc[key.provider].push(key);
    return acc;
  }, {});

  // ---- provider rows (table-friendly) ----
  const providerRows = providers.map((provider) => renderProviderTableRow(provider, webKeysByProvider, healthCache, keys, providerHealth, status.balanceCache || {})).join("");

  // ---- route rows ----
  const routeRows = routes.map((route) => renderRouteRow(route, status.usage, status.usage.limits)).join("");

  // ---- profile rows ----
  const profileRows = profileList
    .map((profile) => `<tr>
        <td><strong>${escapeHtml(profile.name)}</strong><div class="muted">${escapeHtml(profile.description)}</div></td>
        <td><code>${escapeHtml(profile.defaultModel)}</code></td>
        <td>${profile.active ? '<span class="pill ok">当前激活</span>' : '<span class="pill muted-pill">未激活</span>'}</td>
        <td>
          <div class="row-actions">
            <button type="button" data-set-profile="${escapeHtml(profile.name)}" ${profile.active ? "disabled" : ""}>激活</button>
            <button type="button" data-edit-profile="${escapeHtml(profile.name)}">编辑</button>
            <button type="button" data-clone-profile="${escapeHtml(profile.name)}">克隆</button>
            <button type="button" data-delete-profile="${escapeHtml(profile.name)}" ${profile.active ? "disabled" : ""}>删除</button>
          </div>
        </td>
      </tr>`)
    .join("");

  // ---- key pool rows ----
  const keyPoolRows = Object.entries(status.keys || {})
    .flatMap(([provider, keys]) =>
      keys.map((key) => `<tr>
          <td>${escapeHtml(provider)}</td>
          <td><code>${escapeHtml(key.label)}</code><div class="muted mono">${escapeHtml(key.hash || "")}</div>${key.source ? `<div class="muted">来源：${escapeHtml(key.source)}</div>` : ""}</td>
          <td>${key.uses}</td>
          <td>${key.failures}</td>
          <td>${key.coolingDown ? `<span class="pill warn">冷却中</span> <span class="muted">至 ${escapeHtml(formatTimestamp(key.cooldownUntil))}</span>` : '<span class="pill ok">就绪</span>'}</td>
        </tr>`)
    )
    .join("");

  // ---- web key rows ----
  const webKeyRows = webKeys
    .map((key) => `<tr data-key-row="${escapeHtml(key.id)}">
        <td><code>${escapeHtml(key.id)}</code></td>
        <td>${escapeHtml(key.provider)}</td>
        <td><code>${escapeHtml(key.masked)}</code><div class="muted mono">hash: ${escapeHtml(key.hash || "")}</div></td>
        <td>${escapeHtml(key.label || "—")}</td>
        <td>${key.enabled ? '<span class="pill ok">启用</span>' : '<span class="pill warn">停用</span>'}</td>
        <td><div class="muted">${escapeHtml(formatTimestamp(key.lastUsedAt) || "—")}</div>${key.lastTestAt ? `<div class="muted">最近测试：${escapeHtml(formatTimestamp(key.lastTestAt))}${key.lastTestResult?.ok === true ? ' <span class="ok">通过</span>' : key.lastTestResult?.ok === false ? ' <span class="bad">失败</span>' : ""}</div>` : ""}</td>
        <td>
          <div class="row-actions">
            <button type="button" data-test-key="${escapeHtml(key.id)}">测试</button>
            <button type="button" data-toggle-key="${escapeHtml(key.id)}" data-target-enabled="${key.enabled ? "false" : "true"}">${key.enabled ? "停用" : "启用"}</button>
            <button type="button" data-delete-key="${escapeHtml(key.id)}" data-label="${escapeHtml(key.label || key.masked)}">删除</button>
          </div>
        </td>
      </tr>`)
    .join("");

  // ---- usage / history ----
  const today = status.usage && status.usage.daily;
  const usageRows = today
    ? Object.entries(today.routes || {}).map(([name, count]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>${count}</td><td><span class="pill">路由</span></td></tr>`).join("")
    : "";
  const historyMax = Math.max(1, ...(status.usage?.history || []).map((item) => item.total || 0));
  const historyRows = (status.usage?.history || [])
    .slice(-(status.usage?.historyDays || 14))
    .map((item) => {
      const width = Math.max(3, Math.round(((item.total || 0) / historyMax) * 100));
      return `<tr>
        <td>${escapeHtml(item.day)}</td>
        <td>${item.total || 0}</td>
        <td><div class="bar"><span style="width:${width}%"></span></div></td>
        <td>${escapeHtml(topUsageLabel(item.routes))}</td>
        <td>${escapeHtml(topUsageLabel(item.providers))}</td>
      </tr>`;
    })
    .join("");

  // ---- error log: time-sorted (most recent first) and classified ----
  const errors = Array.isArray(status.recentErrors) ? status.recentErrors.slice() : [];
  // recordError unshift-s, so already most-recent-first. Keep that.
  const errorCounts = classifyErrorCounts(errors);
  const errorRows = errors.slice(0, 50).map((entry) => renderErrorRow(entry)).join("");

  // ---- caches ----
  const healthRows = Object.entries(status.healthCache || {})
    .map(([provider, health]) => `<tr>
        <td>${escapeHtml(provider)}</td>
        <td class="${health.ok ? "ok" : "bad"}">${health.ok ? "正常" : "失败"}</td>
        <td>${escapeHtml(health.model || "")}</td>
        <td>${escapeHtml(String(health.status || health.error || ""))}</td>
        <td>${health.elapsedMs ?? ""}</td>
        <td>${escapeHtml(health.checkedAt || "")}</td>
      </tr>`)
    .join("");
  const discoveryRows = Object.entries(status.modelDiscoveryCache || {})
    .map(([provider, discovery]) => `<tr>
        <td>${escapeHtml(provider)}</td>
        <td class="${discovery.ok ? "ok" : "bad"}">${discovery.ok ? "成功" : "失败"}</td>
        <td>${discovery.count || 0}</td>
        <td>${escapeHtml((discovery.models || []).slice(0, 8).join(", "))}${(discovery.models || []).length > 8 ? " ..." : ""}</td>
        <td>${escapeHtml(discovery.discoveredAt || "")}</td>
      </tr>`)
    .join("");
  const balanceRows = Object.entries(status.balanceCache || {})
    .map(([provider, balance]) => `<tr>
        <td>${escapeHtml(provider)}</td>
        <td class="${balance.ok ? "ok" : "bad"}">${balance.ok ? "正常" : "失败"}</td>
        <td>${escapeHtml(balance.summary || balance.error || "")}</td>
        <td>${escapeHtml(balance.checkedAt || "")}</td>
      </tr>`)
    .join("");

  // ---- selects ----
  const providerTemplateOptions = providerTemplates
    .map((template) => `<option value="${escapeHtml(template.name)}">${escapeHtml(template.displayName || template.name)}</option>`)
    .join("");
  const providerOptions = providers
    .map((p) => {
      const webCount = (webKeysByProvider[p.name] || []).filter((key) => key.enabled).length;
      const keyText = p.local
        ? "本地模型无需 Key"
        : webCount > 0
          ? `${webCount} 个 Web Key`
          : p.keyCount > 0
            ? `${p.keyCount} 个 env Key`
            : "未添加 Key";
      return `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${escapeHtml(p.apiFormat)} · ${escapeHtml(keyText)})</option>`;
    })
    .join("");
  const routeTemplateOptions = (status.routeTemplates || [])
    .map((template) => `<option value="${escapeHtml(template.name)}">${escapeHtml(template.name)} · ${escapeHtml(template.strategy || "fallback")}</option>`)
    .join("");
  const profileDefaultOptions = buildProfileDefaultOptions(status)
    .map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`)
    .join("");

  const masterKeyNote = status.secretStore?.masterKeyInEnv
    ? "主密钥来源：<code>OPENRELAY_KEYSTORE_SECRET</code> 环境变量"
    : status.secretStore?.masterKeyOnDisk
      ? "主密钥来源：<code>data/master.key</code> 本地文件（仅本机本目录级保护，非系统级密钥管理）"
      : "主密钥尚未生成，首次添加 Key 时自动创建";

  const relayTokenBanner = relayAuthState.allowNoAuth
    ? `<span class="pill bad" data-no-auth-banner>${escapeHtml(t("app.noAuth"))}</span> <span class="muted">${t("app.noAuthHint")}</span>`
    : relayTokenRequired
      ? `<span class="pill warn">${escapeHtml(t("app.tokenRequired"))}</span> <span class="muted">${t("app.tokenRequiredHint")}</span>`
      : `<span class="pill ok">${escapeHtml(t("app.tokenOptional"))}</span> <span class="muted">${t("app.tokenOptionalHint")}</span>`;

  // Locale switcher — server-rendered dropdown of supported locales.
  // Submitting the form posts to /admin/locale which sets a cookie
  // and re-renders the dashboard in the chosen language.
  const localeOptions = I18N_SUPPORTED_LOCALES
    .map((code) => `<option value="${code}" ${code === locale ? "selected" : ""}>${escapeHtml(t("common.locale." + code))}</option>`)
    .join("");
  const localeSwitcher = `<form method="POST" action="/admin/locale" style="display:inline-flex;align-items:center;gap:4px;margin-right:4px;">
    <label for="locale-select" style="font-size:11px;color:var(--muted);">${escapeHtml(t("common.locale"))}</label>
    <select id="locale-select" name="locale" onchange="this.form.submit()" style="width:auto;min-width:120px;padding:3px 6px;font-size:12px;">
      ${localeOptions}
    </select>
  </form>`;

  // ---- overview summary numbers ----
  const providerCount = providers.length;
  const localProviderCount = providers.filter((p) => p.local).length;
  const cloudProviderCount = providerCount - localProviderCount;
  const totalWebKeys = webKeys.length;
  const todayRequests = (status.usage && status.usage.daily && status.usage.daily.total) || 0;
  const todayFailed = (status.usage && status.usage.daily && status.usage.daily.routes && Object.values(status.usage.daily.routes).reduce((a, b) => a + b, 0)) || 0;
  const totalLocalLimitHits = status.stats?.localLimitHits || 0;
  const recentErrorCount = errors.length;
  const overviewEnvBlock = `$env:OPENAI_BASE_URL = "${baseUrl}"\n$env:OPENAI_API_KEY  = "${apiKeyHint}"\n$env:ANTHROPIC_BASE_URL = "${baseUrl}"\n$env:ANTHROPIC_API_KEY  = "${apiKeyHint}"`;

  // ---- tabs ----
  const overviewTab = renderOverviewTab({
    baseUrl, apiKeyHint, overviewEnvBlock, relayTokenRequired, relayTokenBanner,
    relayAuth: relayAuthState,
    providerCount, localProviderCount, cloudProviderCount, totalWebKeys,
    todayRequests, totalLocalLimitHits, recentErrorCount, errors,
    activeProfileName, defaultModel, errorRows, port, status
  });
  const providersTab = renderProvidersTab({
    providerRows, webKeyRows, providerOptions, providerTemplateOptions, status, locale
  });
  const routesTab = renderRoutesTab({
    routeRows, profileRows, keyPoolRows, routeTemplateOptions, profileDefaultOptions, status
  });
  const toolsTab = renderToolCards({ ...status, relayAuth: relayAuthState }, port);
  const usageTab = renderUsageTab({
    usageRows, historyRows, errorRows, errorCounts, errors, port, status
  });
  const diagnosticsTab = renderDiagnosticsTab({
    healthRows, discoveryRows, balanceRows, keyPoolRows, errors, recentRequests, port, status
  });
  const settingsTab = renderSettingsTab({
    healthRows, discoveryRows, balanceRows, port, status, relayAuth: relayAuthState
  });

  return `<!doctype html>
<html lang="zh-CN" data-appearance="system">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t("app.title"))}</title>
  <style>${DASHBOARD_CSS}</style>
</head>
<body>
  <div class="rf-layout">
    <aside class="rf-sidebar">
      <div class="rf-sidebar-header">
        <h2>RelayForge</h2>
        <div class="sub">Local AI Coding Gateway</div>
        <div class="ver">v${escapeHtml(status.version || "0.3.0")} · Local-first · Zero dependencies</div>
      </div>
      <ul class="rf-nav" id="tab-nav">
        <li><a href="#overview" data-tab="overview" class="active"><span class="nav-icon">01</span>Overview</a></li>
        <li><a href="#providers" data-tab="providers"><span class="nav-icon">02</span>Providers <span class="count">${providerCount}</span></a></li>
        <li><a href="#combo-models" data-tab="combo-models"><span class="nav-icon">03</span>Combo Models</a></li>
        <li><a href="#clients" data-tab="clients"><span class="nav-icon">04</span>Clients</a></li>
        <li><a href="#usage" data-tab="usage"><span class="nav-icon">05</span>Usage <span class="count">${recentErrorCount}</span></a></li>
        <li><a href="#diagnostics" data-tab="diagnostics"><span class="nav-icon">06</span>Diagnostics</a></li>
        <li><a href="#settings" data-tab="settings"><span class="nav-icon">07</span>Settings</a></li>
      </ul>
      <div class="rf-sidebar-footer">
        <strong>Safety posture</strong>
        API-key routing only<br>
        No OAuth token routing
        <div style="margin-top:10px;">${localeSwitcher}</div>
      </div>
    </aside>
    <main class="rf-main">
      <section id="tab-overview" class="tab-pane active" data-pane="overview">${overviewTab}</section>
      <section id="tab-providers" class="tab-pane" data-pane="providers">${providersTab}</section>
      <section id="tab-combo-models" class="tab-pane" data-pane="combo-models">${renderComboModelsTab(status)}</section>
      <section id="tab-clients" class="tab-pane" data-pane="clients">${renderClientsTab({ baseUrl, apiKeyHint, relayAuth: relayAuthState })}</section>
      <section id="tab-usage" class="tab-pane" data-pane="usage">${usageTab}</section>
      <section id="tab-diagnostics" class="tab-pane" data-pane="diagnostics">${diagnosticsTab}</section>
      <section id="tab-settings" class="tab-pane" data-pane="settings">${settingsTab}</section>
    </main>
  </div>
  <div id="profile-modal" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-modal-title">
    <div class="modal">
      <h3 id="profile-modal-title">${escapeHtml(t("modal.profile.title"))}</h3>
      <p class="muted" id="profile-modal-subtitle">${escapeHtml(t("modal.profile.subtitle"))}</p>
      <div class="row">
        <label for="profile-modal-name">名称</label>
        <input type="text" id="profile-modal-name" autocomplete="off">
      </div>
      <div class="row">
        <label for="profile-modal-description">描述</label>
        <input type="text" id="profile-modal-description" autocomplete="off">
      </div>
      <div class="row">
        <label for="profile-modal-default">默认模型</label>
        <input type="text" id="profile-modal-default" list="profile-default-options" autocomplete="off">
        <datalist id="profile-default-options">${profileDefaultOptions}</datalist>
      </div>
      <div class="row row-actions">
        <button id="profile-modal-cancel" type="button">取消</button>
        <button id="profile-modal-save" type="button" class="primary">保存</button>
      </div>
    </div>
  </div>
  <script>
    var editor = document.getElementById("config-editor");
    var message = document.getElementById("admin-message");
    var providers = ${providersScript};
    var providerTemplates = ${providerTemplatesScript};
    var routes = ${routesScript};
    var routeTemplates = ${routeTemplatesScript};
    var webKeys = ${webKeysScript};
    var relayAuth = ${scriptJson(relayAuthState)};
    var status = ${scriptJson({ providerHealth: status.providerHealth || {} })};
    var i18nBundle = ${scriptJson(i18nBundle)};
  </script>
  <script>${clientScript}</script>
</body>
</html>`;
}

function renderDiagnosticsTab(ctx) {
  const status = ctx.status || {};
  const errors = Array.isArray(ctx.errors) ? ctx.errors : [];
  const requests = Array.isArray(ctx.recentRequests) ? ctx.recentRequests : [];
  const diagnosticPreview = [
    "RelayForge diagnostic summary",
    "---",
    "Version: " + (status.version || "?"),
    "Providers: " + ((status.providers && status.providers.length) || 0),
    "Combo models: " + ((status.combos && status.combos.length) || 0),
    "Recent requests: " + requests.length,
    "Recent errors: " + errors.length,
    "Safe to share. No full prompts, keys, cookies, or tokens."
  ].join("\n");
  const codexPreview = [
    "RelayForge Codex diagnostics",
    "---",
    "Base URL: http://127.0.0.1:" + (ctx.port || 18765) + "/v1",
    "Recommended model: smart-coding",
    "Recent requests: " + requests.length,
    "Errors: " + errors.length,
    "Prompts: hidden by default"
  ].join("\n");
  const errorRows = errors.slice(0, 20).map((entry) => `<tr data-error-category="${escapeHtml(entry.category || entry.errorCategory || "unknown")}">
    <td>${escapeHtml(formatTimestamp(entry.time || entry.timestamp))}</td>
    <td><span class="err-cat ${escapeHtml(entry.category || entry.errorCategory || "other")}">${escapeHtml(entry.category || entry.errorCategory || "other")}</span></td>
    <td>${escapeHtml(entry.provider || "-")}</td>
    <td>${escapeHtml(String(entry.status || entry.statusCode || "-"))}</td>
    <td>${escapeHtml(String(entry.message || entry.error || "")).slice(0, 180)}</td>
  </tr>`).join("");
  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Diagnostics</h1>
    <p class="rf-page-desc">Troubleshoot RelayForge with redacted summaries, provider health cache, runtime key state, and error categories.</p>
  </div>
  <div class="rf-actions">
    <button type="button" class="primary" id="copy-diagnostics">Copy diagnostic-summary</button>
    <button type="button" id="copy-codex-diagnostics">Copy Codex diagnostics</button>
  </div>
</div>
<div class="grid grid-2">
  <div class="panel">
    <div class="panel-title"><h3>Diagnostic Summary</h3><span class="pill ok">redacted</span></div>
    <textarea id="diagnostic-summary" readonly>${escapeHtml(diagnosticPreview)}</textarea>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>Codex/OpenAI-compatible Diagnostics</h3><span class="pill ok">shareable</span></div>
    <textarea id="codex-diagnostic-summary" readonly>${escapeHtml(codexPreview)}</textarea>
  </div>
</div>
<details class="collapsible" open>
  <summary>Provider Health Cache</summary>
  <div class="scroll-x" style="margin-top:10px;">
    <table><thead><tr><th>Provider</th><th>Result</th><th>Model</th><th>Status</th><th>Latency</th><th>Checked At</th></tr></thead>
    <tbody>${ctx.healthRows || '<tr><td colspan="6" class="muted">No provider health checks yet</td></tr>'}</tbody></table>
  </div>
</details>
<details class="collapsible">
  <summary>Runtime Key Pool</summary>
  <div class="scroll-x" style="margin-top:10px;">
    <table><thead><tr><th>Provider</th><th>Key</th><th>Uses</th><th>Failures</th><th>Cooldown</th></tr></thead>
    <tbody>${ctx.keyPoolRows || '<tr><td colspan="5" class="muted">No runtime key pool records</td></tr>'}</tbody></table>
  </div>
</details>
<details class="collapsible" open>
  <summary>Error Diagnostics</summary>
  <div class="toolbar" style="margin-top:10px;">
    ${["all","missing_key","connection_failed","upstream_429","upstream_5xx","timeout","auth_failed","unknown"].map((cat) => `<button type="button" class="small" data-filter-cat="${escapeHtml(cat)}"${cat === "all" ? ' data-filter-active="true"' : ""}>${escapeHtml(cat)}</button>`).join("")}
  </div>
  <div class="scroll-x" id="error-table-wrap">
    <table><thead><tr><th>Time</th><th>Category</th><th>Provider</th><th>Status</th><th>Redacted message</th></tr></thead>
    <tbody>${errorRows || '<tr><td colspan="5" class="muted">No errors recorded</td></tr>'}</tbody></table>
  </div>
</details>
<details class="collapsible">
  <summary>Environment Summary</summary>
  <div class="grid grid-3" style="margin-top:10px;">
    <div class="metric"><span class="label">Auth</span><span class="value">${status.relayAuth?.tokenRequired ? "On" : "Off"}</span><span class="sub">Token source is redacted</span></div>
    <div class="metric"><span class="label">Runtime</span><span class="value">Node</span><span class="sub">Zero npm dependencies</span></div>
    <div class="metric"><span class="label">Privacy</span><span class="value">Safe</span><span class="sub">Prompts hidden by default</span></div>
  </div>
</details>
<details class="collapsible">
  <summary>Advanced Internal State</summary>
  <div class="grid grid-2" style="margin-top:10px;">
    <div class="panel"><div class="panel-title"><h3>Balance Cache</h3></div><div class="scroll-x"><table><thead><tr><th>Provider</th><th>Result</th><th>Summary</th><th>Checked At</th></tr></thead><tbody>${ctx.balanceRows || '<tr><td colspan="4" class="muted">No balance checks yet</td></tr>'}</tbody></table></div></div>
    <div class="panel"><div class="panel-title"><h3>Model Discovery Cache</h3></div><div class="scroll-x"><table><thead><tr><th>Provider</th><th>Result</th><th>Count</th><th>Models</th><th>Discovered At</th></tr></thead><tbody>${ctx.discoveryRows || '<tr><td colspan="5" class="muted">No model discovery cache</td></tr>'}</tbody></table></div></div>
  </div>
</details>`;
}


