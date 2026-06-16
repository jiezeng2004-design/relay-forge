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
    providerRows, webKeyRows, providerOptions, providerTemplateOptions, status
  });
  const routesTab = renderRoutesTab({
    routeRows, profileRows, keyPoolRows, routeTemplateOptions, profileDefaultOptions, status
  });
  const toolsTab = renderToolCards({ ...status, relayAuth: relayAuthState }, port);
  const usageTab = renderUsageTab({
    usageRows, historyRows, errorRows, errorCounts, errors, port, status
  });
  const settingsTab = renderSettingsTab({
    healthRows, discoveryRows, balanceRows, port, status
  });

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(t("app.title"))}</title>
  <style>${DASHBOARD_CSS}
    :root { color-scheme: light; --bg: #f6f7f9; --surface: #fff; --text: #172033; --muted: #657184; --line: #d9e0ea; --soft: #edf2f7; --accent: #2563eb; --accent-soft: #dbeafe; --good: #16794c; --good-soft: #d1fae5; --warn: #a45d00; --warn-soft: #fde68a; --bad: #b42318; --bad-soft: #fecaca; }
    .rf-sidebar ~ .content { margin-left: 220px; }
    .tab-pane { display: none; }
    .tab-pane.active { display: block; }
    h2 { margin: 0 0 14px; font-size: 18px; }
    h3 { margin: 18px 0 8px; font-size: 14px; font-weight: 700; color: var(--muted); text-transform: uppercase; letter-spacing: 0.4px; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .grid { display: grid; gap: 12px; }
    .grid-4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .grid-3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .grid-2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .card, .metric, .panel { background: var(--surface); border: 1px solid var(--line); border-radius: 8px; }
    .card { padding: 16px; }
    .card.compact { padding: 12px 14px; }
    .metric { padding: 14px; }
    .metric .label { color: var(--muted); font-size: 12px; }
    .metric .value { display: block; margin-top: 6px; font-size: 24px; font-weight: 700; line-height: 1.1; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 10px 10px; border-bottom: 1px solid #e8edf4; text-align: left; vertical-align: top; }
    th { background: var(--soft); font-size: 11px; color: #334155; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
    code { background: var(--soft); border-radius: 4px; padding: 2px 5px; word-break: break-all; font-size: 12px; }
    .pill.ok { background: var(--good-soft); color: var(--good); }
    .pill.warn { background: var(--warn-soft); color: var(--warn); }
    .pill.bad { background: var(--bad-soft); color: var(--bad); }
    .pill.muted-pill { background: #e5e7eb; color: #475569; }
    .pill.local { background: #e0e7ff; color: #3730a3; }
    .pill.cloud { background: #fef3c7; color: #92400e; }
    .muted { color: var(--muted); }
    .ok { color: var(--good); }
    .warn { color: var(--warn); }
    .bad { color: var(--bad); }
    .stack { display: flex; flex-wrap: wrap; gap: 6px; }
    button { min-height: 28px; padding: 4px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--text); cursor: pointer; font: inherit; font-size: 12px; }
    button:hover { border-color: #9eb2ce; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.small { padding: 2px 7px; min-height: 24px; font-size: 11px; }
    .primary { background: var(--accent); color: #fff; border-color: var(--accent); }
    .primary:hover { background: #1d4ed8; border-color: #1d4ed8; }
    .danger { color: var(--bad); border-color: #f3b9b3; }
    .danger:hover { background: #fff5f5; border-color: var(--bad); }
    textarea { width: 100%; min-height: 240px; resize: vertical; padding: 10px; border: 1px solid var(--line); border-radius: 6px; font: 12px/1.45 Consolas, "Courier New", monospace; color: var(--text); background: #fbfcfe; }
    textarea.compact-area { min-height: 70px; }
    input[type="text"], input[type="password"], select { width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; background: #fbfcfe; color: var(--text); }
    input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15); }
    .field { display: grid; gap: 4px; margin-top: 8px; }
    .field label { font-size: 11px; color: var(--muted); }
    .field .help { font-size: 11px; color: var(--muted); }
    .advanced-block { border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; padding: 10px 12px; margin-top: 8px; }
    .advanced-block summary { cursor: pointer; color: var(--muted); font-size: 12px; }
    .inline-key-panel { margin-top: 12px; padding: 12px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; }
    .inline-key-panel h3 { margin: 0 0 6px; font-size: 13px; color: var(--text); text-transform: none; letter-spacing: 0; }
    .field-row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 10px; align-items: end; }
    .form-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .form-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .route-candidate-row { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(160px, 2fr) 80px auto; gap: 8px; align-items: center; }
    .route-candidate-row button { white-space: nowrap; }
    .tool-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .tool-card { border: 1px solid var(--line); border-radius: 8px; padding: 14px; background: var(--surface); }
    .tool-card h3 { margin: 0 0 6px; font-size: 14px; text-transform: none; letter-spacing: 0; color: var(--text); }
    .tool-card .muted { font-size: 12px; }
    .command-box { margin-top: 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--soft); padding: 8px; }
    .command-box pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; }
    .command-box .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
    .command-box .head strong { font-size: 11px; color: #334155; text-transform: uppercase; letter-spacing: 0.4px; }
    .notice { margin-top: 8px; padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; color: var(--muted); font-size: 12px; word-break: break-word; }
    .notice.ok { background: #f0fdf4; border-color: #bbf7d0; color: #14532d; }
    .notice.bad { background: #fef2f2; border-color: #fecaca; color: #7f1d1d; }
    .notice.warn { background: #fffbeb; border-color: #fde68a; color: #78350f; }
    .row-actions { display: flex; flex-wrap: wrap; gap: 4px; }
    .bar { width: 100%; min-width: 80px; height: 8px; border-radius: 999px; background: #e8edf4; overflow: hidden; }
    .bar span { display: block; height: 100%; border-radius: inherit; background: var(--accent); }
    details.collapsible { border: 1px solid var(--line); border-radius: 6px; background: #fbfcfe; padding: 8px 12px; margin-top: 10px; }
    details.collapsible summary { cursor: pointer; font-size: 13px; font-weight: 600; }
    details.collapsible[open] { padding-bottom: 14px; }
    .endpoint-block { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .endpoint-block code { font-size: 13px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
    .toolbar .spacer { flex: 1; }
    .quick-actions { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .quick-actions button { justify-content: center; min-height: 36px; }
    .empty-state { display: grid; gap: 6px; padding: 22px 16px; text-align: center; background: var(--soft); border: 1px dashed var(--line); border-radius: 8px; color: var(--muted); }
    .empty-state strong { font-size: 14px; color: var(--text); }
    .empty-state span { font-size: 12px; }
    .section-label { margin: 18px 0 8px; font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.6px; font-weight: 700; }
    .section-label:first-child { margin-top: 0; }
    .err-cat { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: 999px; font-size: 10px; font-weight: 600; background: var(--soft); color: #334155; }
    .err-cat.stream_idle_timeout,
    .err-cat.stream_read_failed,
    .err-cat.stream_parse_failed,
    .err-cat.upstream_5xx { background: var(--bad-soft); color: var(--bad); }
    .err-cat.upstream_429,
    .err-cat.upstream_timeout { background: var(--warn-soft); color: var(--warn); }
    .err-cat.upstream_auth { background: #fde2e2; color: #991b1b; }
    .err-cat.upstream_request_failed { background: var(--bad-soft); color: var(--bad); }
    .err-cat.config_error { background: #fde68a; color: #92400e; }
    .err-cat.local_limit { background: #fef3c7; color: #92400e; }
    .err-cat.other { background: #e5e7eb; color: #475569; }
    .modal-backdrop { position: fixed; inset: 0; background: rgba(20, 27, 45, 0.45); display: none; align-items: center; justify-content: center; z-index: 30; padding: 24px; }
    .modal-backdrop.open { display: flex; }
    .modal { background: var(--surface); border-radius: 10px; max-width: 560px; width: 100%; padding: 18px 20px; box-shadow: 0 12px 32px rgba(0,0,0,0.18); }
    .modal h3 { margin: 0 0 10px; font-size: 16px; }
    .modal .row { margin-top: 10px; }
    .modal label { display: block; font-size: 12px; color: var(--muted); margin-bottom: 4px; }
    .modal .row-actions { justify-content: flex-end; margin-top: 16px; }
    .scroll-x { overflow-x: auto; }
    @media (max-width: 880px) {
      .layout { grid-template-columns: 1fr; }
      .sidebar { position: static; max-height: none; border-right: 0; border-bottom: 1px solid var(--line); padding: 10px 0; }
      .sidebar nav { flex-direction: row; flex-wrap: wrap; }
      .sidebar a { flex: 0 0 auto; }
      .grid-4, .grid-3, .grid-2, .quick-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .field-row, .form-grid, .form-grid-2, .tool-grid { grid-template-columns: 1fr; }
      .route-candidate-row { grid-template-columns: 1fr; }
      .content { padding: 14px; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <h1>RelayForge <span class="sub">${escapeHtml(t("app.subtitle", { version: status.version || "?" }))}</span></h1>
    <div class="topbar-right">
      ${localeSwitcher}
      ${relayTokenBanner}
      <a href="/v1/models">/v1/models</a>
      <a href="/health">/health</a>
    </div>
  </div>
  <div class="rf-layout">
    <aside class="rf-sidebar">
      <div class="rf-sidebar-header">
        <h2>RelayForge</h2>
        <div class="sub">Local AI Coding Gateway</div>
        <div class="ver">v${escapeHtml(status.version || "0.2.0")}</div>
      </div>
      <ul class="rf-nav" id="tab-nav">
        <li><a href="#overview" data-tab="overview" class="active"><span class="nav-icon">◉</span>Overview</a></li>
        <li><a href="#providers" data-tab="providers"><span class="nav-icon">◈</span>Providers <span class="count">${providerCount}</span></a></li>
        <li><a href="#combo-models" data-tab="combo-models"><span class="nav-icon">🔀</span>Combo Models</a></li>
        <li><a href="#clients" data-tab="clients"><span class="nav-icon">🔗</span>Clients</a></li>
        <li><a href="#routes" data-tab="routes"><span class="nav-icon">⊞</span>Routes <span class="count">${routes.length}</span></a></li>
        <li><a href="#usage" data-tab="usage"><span class="nav-icon">📊</span>Usage <span class="count">${recentErrorCount}</span></a></li>
        <li><a href="#tools" data-tab="tools"><span class="nav-icon">🛠</span>Tools</a></li>
        <li><a href="#settings" data-tab="settings"><span class="nav-icon">⚙</span>Settings</a></li>
        <li><a href="#ide" data-tab="ide"><span class="nav-icon">💻</span>IDE</a></li>
      </ul>
    </aside>
    <main class="rf-main">
      <section id="tab-overview" class="tab-pane active" data-pane="overview">${overviewTab}</section>
      <section id="tab-providers" class="tab-pane" data-pane="providers">${providersTab}</section>
      <section id="tab-combo-models" class="tab-pane" data-pane="combo-models">${renderComboModelsTab(status)}</section>
      <section id="tab-clients" class="tab-pane" data-pane="clients">${renderClientsTab({ baseUrl, apiKeyHint, relayAuth: relayAuthState })}</section>
      <section id="tab-routes" class="tab-pane" data-pane="routes">${routesTab}</section>
      <section id="tab-usage" class="tab-pane" data-pane="usage">${usageTab}</section>
      <section id="tab-tools" class="tab-pane" data-pane="tools">${toolsTab}</section>
      <section id="tab-settings" class="tab-pane" data-pane="settings">${settingsTab}</section>
      <section id="tab-ide" class="tab-pane" data-pane="ide">${renderIdeTab(status, port)}</section>
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

