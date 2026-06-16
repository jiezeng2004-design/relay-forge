// Row renderers + provider / error classification shared by the
// dashboard tabs. Pure HTML string builders. Importing this file has
// no DOM / I/O side effects.

import { escapeHtml } from "../http-helpers.js";
import { formatTimestamp, renderLimit } from "./shared.js";
import { ERROR_CATEGORIES, inferErrorCategory, isValidCategory, sanitizeErrorMessage } from "../error-category.js";

// Categorize a provider for the status filter + badge. Returns one
// of: local-ready / needs-key / healthy / failed / cooling-down /
// rate-limited / untested. Used by the providers tab and the row renderer.
export function computeProviderStatus(provider, webKeysByProvider, healthCache, keysByProvider, providerHealth = {}) {
  const webCount = (webKeysByProvider[provider.name] || []).filter((k) => k.enabled).length;
  const hasKey = provider.local || webCount > 0 || provider.keyCount > 0;
  const health = healthCache[provider.name];
  const providerKeys = keysByProvider[provider.name] || [];
  const anyCoolingDown = providerKeys.some((k) => k.coolingDown);
  const liveHealth = providerHealth[provider.name] || {};
  const rateLimited = liveHealth.rateLimited === true;

  if (rateLimited) return "rate-limited";
  if (provider.local) {
    if (health) return health.ok ? "local-ready" : "failed";
    return "local-ready";
  }
  if (!hasKey) return "needs-key";
  if (anyCoolingDown) return "cooling-down";
  if (health) return health.ok ? "healthy" : "failed";
  return "untested";
}

// Pill rendering for the provider status values above. Unknown
// statuses still get a muted pill so the row never looks empty.
export function renderProviderStatusBadge(status) {
  const map = {
    "local-ready": { cls: "local", text: "本地就绪" },
    "needs-key": { cls: "bad", text: "缺 Key" },
    "healthy": { cls: "ok", text: "健康" },
    "failed": { cls: "bad", text: "失败" },
    "cooling-down": { cls: "warn", text: "冷却中" },
    "rate-limited": { cls: "warn", text: "Retry-After" },
    "untested": { cls: "muted-pill", text: "未测" }
  };
  const s = map[status] || { cls: "muted-pill", text: status };
  return `<span class="pill ${s.cls}">${escapeHtml(s.text)}</span>`;
}

// One <tr> in the provider list. Emits data-provider-row /
// data-provider-name / data-provider-status attributes so the
// client-side filter buttons can hide / show rows by category
// without a backend call.
export function renderProviderTableRow(provider, webKeysByProvider, healthCache, keysByProvider, providerHealth = {}, balanceCache = {}) {
  const webCount = (webKeysByProvider[provider.name] || []).filter((k) => k.enabled).length;
  const keyStatus = provider.local
    ? '<span class="pill local">本地</span> 无需 Key'
    : webCount > 0
      ? `<span class="pill ok">Web</span> ${webCount} 个`
      : provider.keyCount > 0
        ? `<span class="pill ok">env</span> ${provider.keyCount} 个`
        : '<span class="pill bad">无</span> 未添加';
  const typePill = provider.apiFormat === "anthropic"
    ? '<span class="pill">anthropic</span>'
    : '<span class="pill">openai</span>';
  const localPill = provider.local
    ? '<span class="pill local">本地</span>'
    : '<span class="pill cloud">云端</span>';
  const health = healthCache[provider.name];
  let healthCell = '<span class="muted">未测</span>';
  if (health) healthCell = health.ok
    ? '<span class="pill ok">正常</span>'
    : '<span class="pill bad">失败</span>';
  let latencyCell = '<span class="muted">—</span>';
  if (health && typeof health.elapsedMs === "number") latencyCell = `${health.elapsedMs} ms`;
  const liveHealth = providerHealth[provider.name] || {};
  const rateLimited = liveHealth.rateLimited === true;
  const rateLimitNote = rateLimited
    ? `<div class="muted">Retry-After until ${escapeHtml(formatTimestamp(liveHealth.rateLimitedUntil) || "unknown")}</div>`
    : "";
  const balance = balanceCache[provider.name];
  const hasBalanceEndpoint = provider.balanceEndpoint && typeof provider.balanceEndpoint === "object";
  let balanceTag = null;
  let balanceCell = '<span class="muted">not configured</span>';
  if (balance) {
    balanceTag = balance.ok ? "balance-ok" : "balance-error";
    balanceCell = balance.ok
      ? `<span class="pill ok">quota ok</span><div class="muted">${escapeHtml(balance.summary || "checked")}</div>`
      : `<span class="pill bad">quota error</span><div class="muted">${escapeHtml(balance.summary || balance.error || "failed")}</div>`;
    if (balance.checkedAt) balanceCell += `<div class="muted">${escapeHtml(formatTimestamp(balance.checkedAt) || balance.checkedAt)}</div>`;
  } else if (hasBalanceEndpoint) {
    balanceTag = "balance-untested";
    balanceCell = '<span class="pill muted-pill">quota untested</span><div class="muted">balanceEndpoint configured</div>';
  }
  const status = computeProviderStatus(provider, webKeysByProvider, healthCache, keysByProvider, providerHealth);
  const filterTags = [
    provider.local ? "local" : "cloud",
    !provider.local && webCount === 0 && provider.keyCount === 0 ? "needs-key" : null,
    health ? null : "untested",
    provider.insecureHttpRisk === true ? "insecure-risk" : null,
    rateLimited ? "rate-limited" : null,
    balanceTag
  ].filter(Boolean).join(" ");
  return `<tr data-provider-row="${escapeHtml(provider.name)}" data-provider-name="${escapeHtml(provider.name)}" data-provider-status="${escapeHtml(filterTags)}" data-provider-class="${escapeHtml(status)}" data-provider-rate-limited="${rateLimited ? "true" : "false"}">
    <td>
      <strong>${escapeHtml(provider.name)}</strong>
      ${renderProviderStatusBadge(status)}
      <div class="muted mono">${escapeHtml(provider.baseUrl)}</div>
      <div class="muted">${escapeHtml(provider.healthHint || "")}</div>
    </td>
    <td>${typePill}</td>
    <td>${localPill}</td>
    <td>${keyStatus}</td>
    <td>${healthCell}${rateLimitNote}</td>
    <td>${latencyCell}</td>
    <td>${balanceCell}</td>
    <td>
      <div class="row-actions">
        <button class="small" data-test-provider="${escapeHtml(provider.name)}">连通</button>
        <button class="small" data-discover-provider="${escapeHtml(provider.name)}">发现</button>
        <button class="small" data-check-balance="${escapeHtml(provider.name)}">余额</button>
        <button class="small" data-add-key-provider="${escapeHtml(provider.name)}">加 Key</button>
        <button class="small" data-edit-provider="${escapeHtml(provider.name)}">编辑</button>
        <button class="small danger" data-delete-provider="${escapeHtml(provider.name)}">删除</button>
      </div>
    </td>
  </tr>`;
}

// One <tr> in the route list. Shows strategy, soft daily limit,
// candidates, success/failure/limited counters, and edit / delete
// buttons.
export function renderRouteRow(route, usage, limits) {
  const limit = route.limits?.dailyRequests || (limits.routes || {})[route.name]?.dailyRequests || limits.dailyRequests;
  const candidates = route.candidates
    .map((item) => `<span class="pill">${escapeHtml(item.provider)}:${escapeHtml(item.model)} x${item.weight || 1}</span>`)
    .join("");
  const routeStats = (usage && usage.runtime && usage.runtime.byRoute && usage.runtime.byRoute[route.name]) || {};
  return `<tr>
    <td><strong>${escapeHtml(route.name)}</strong><div class="muted">${escapeHtml(route.description)}</div></td>
    <td><span class="pill">${escapeHtml(route.strategy)}</span></td>
    <td>${renderLimit(route.name, limit, "routes", usage.daily.routes[route.name] || 0)}</td>
    <td><div class="stack">${candidates}</div></td>
    <td>成功 ${routeStats.ok || 0} / 失败 ${routeStats.failed || 0} / 限额 ${routeStats.limited || 0}</td>
    <td>
      <div class="row-actions">
        <button class="small" data-edit-route="${escapeHtml(route.name)}">编辑</button>
        <button class="small danger" data-delete-route="${escapeHtml(route.name)}">删除</button>
      </div>
    </td>
  </tr>`;
}

// One <tr> in the error log. Adds data-error-category so the
// client-side filter can hide / show by category without a backend
// call.
export function renderErrorRow(entry) {
  const cat = classifyError(entry);
  const catLabel = cat;
  return `<tr data-error-category="${escapeHtml(cat)}">
    <td class="mono">${escapeHtml(entry.at || "")}</td>
    <td><span class="err-cat ${escapeHtml(cat)}">${escapeHtml(catLabel)}</span></td>
    <td class="muted">${escapeHtml(entry.scope || "")}</td>
    <td>${escapeHtml(entry.error || "")}</td>
  </tr>`;
}

// Prefer the server-authoritative category. Fall back to the
// heuristic only for legacy runtime-state entries that predate the
// `category` field.
export function classifyError(entry) {
  if (entry && isValidCategory(entry.category)) return entry.category;
  return inferErrorCategory(entry && entry.scope, { message: entry && entry.error });
}

// Bucket the recent-errors list by ERROR_CATEGORIES. Missing
// categories get 0, so the chip strip never shows "undefined".
export function classifyErrorCounts(errors) {
  const counts = Object.fromEntries(ERROR_CATEGORIES.map((c) => [c, 0]));
  for (const entry of errors) counts[classifyError(entry)] += 1;
  return counts;
}

// Plain-text diagnostic summary for the "复制诊断摘要" button.
// Includes version, provider / route / profile counts, the error
// category breakdown, and the last 10 errors with their scope /
// meta. Never includes prompts, keys, tokens, or full upstream
// response bodies.
export function buildDiagnosticSummary(ctx) {
  const lines = [];
  lines.push("RelayForge diagnostic summary");
  lines.push("version: " + (ctx.status.version || "?"));
  lines.push("startedAt: " + (ctx.status.startedAt || "?"));
  lines.push("configPath: " + (ctx.status.configPath || "?"));
  lines.push("providers: " + (ctx.status.providers?.length || 0));
  lines.push("routes: " + (ctx.status.routes?.length || 0));
  lines.push("profiles: " + (ctx.status.profiles?.profiles?.length || 0));
  lines.push("webKeys: " + (ctx.status.webKeys?.length || 0));
  lines.push("todayRequests: " + ((ctx.status.usage?.daily?.total) || 0));
  lines.push("localLimitHits: " + (ctx.status.stats?.localLimitHits || 0));
  lines.push("recentErrors: " + (ctx.errors.length || 0));
  lines.push("errorByCategory: " + JSON.stringify(ctx.errorCounts));
  lines.push("lastErrors:");
  for (const entry of ctx.errors.slice(0, 10)) {
    const cat = entry.category || classifyError(entry);
    const meta = [];
    if (entry.status != null) meta.push("status=" + entry.status);
    if (entry.elapsedMs != null) meta.push("elapsedMs=" + entry.elapsedMs);
    if (entry.provider) meta.push("provider=" + entry.provider);
    if (entry.model) meta.push("model=" + entry.model);
    const metaStr = meta.length > 0 ? " {" + meta.join(", ") + "}" : "";
    lines.push("- " + (entry.at || "?") + " [" + cat + "] " + (entry.scope || "") + metaStr + ": " + (entry.error || ""));
  }
  return lines.join("\n");
}

// JSON variant of the diagnostic summary, for the "复制 Codex
// 诊断包" button. Same data, sanitized through sanitizeErrorMessage
// so no key / token / prompt-shaped content sneaks into the JSON.
export function buildCodexDiagnosticPackage(ctx) {
  const pkg = {
    version: ctx.status.version || "?",
    activeProfile: (ctx.status.profiles && ctx.status.profiles.activeProfile) || null,
    defaultModel: (ctx.status.profiles && ctx.status.profiles.defaultModel) || null,
    providerCount: ctx.status.providers?.length || 0,
    routeCount: ctx.status.routes?.length || 0,
    recentErrors: []
  };
  for (const entry of ctx.errors.slice(0, 10)) {
    const safe = {
      at: entry.at || null,
      category: entry.category || classifyError(entry),
      provider: entry.provider || null,
      model: entry.model || null,
      status: entry.status != null ? entry.status : null,
      elapsedMs: entry.elapsedMs != null ? entry.elapsedMs : null,
      message: sanitizeErrorMessage(entry.error || "")
    };
    pkg.recentErrors.push(safe);
  }
  return JSON.stringify(pkg, null, 2);
}
