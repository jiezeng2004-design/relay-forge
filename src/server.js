import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getProviderKeys, isLoopbackHost, loadConfig, loadDotEnv, normalizeConfig, validateProviderBaseUrl, detectRuntimeRootDir } from "./config.js";
import { KeyPool } from "./key-pool.js";
import { UsageTracker } from "./usage.js";
import { normalizeUsage, estimateMessagesTokens, pickFamily } from "./token-estimate.js";
import { validateConfig } from "./config-schema.js";
import { renderDashboard } from "./dashboard.js";
import { renderProviderTableRow as renderDashboardProviderRow } from "./dashboard/rows.js";
import { renderOverviewTab, renderProvidersTab, renderRoutesTab, renderToolCards, renderUsageTab, renderSettingsTab, renderIdeTab, renderRateLimitingTab } from "./dashboard/tabs/index.js";
import { SecretStore } from "./secret-store.js";
import { buildErrorEntry, isValidCategory } from "./error-category.js";
import { copyResponseHeaders, escapeHtml, forbiddenCors, isAdminPath, isAllowedAdminOrigin, isAuthorized, isAuthorizedV1, parseMaybeJson, readJsonBody, sendHtml, sendJson, sendNoContent, setAuthContext, unauthorized, withCorsHeaders } from "./http-helpers.js";
import { anthropicToOpenAi, openAiToAnthropic, openAiResponseToAnthropic, anthropicResponseToOpenAi, openAiResponseToResponses, anthropicResponseToResponses, responsesToChatPayload } from "./format-convert.js";
import { guardBalanceEndpoint, interpretBalanceResponse } from "./balance.js";
import { resolveRoutePreview } from "./route-preview.js";
import { ProviderHealthTracker } from "./provider-health.js";
import { createAnthropicToOpenAiSseBridge, createOpenAiToAnthropicSseBridge } from "./stream-bridge.js";
import { I18N_SUPPORTED_LOCALES, I18N_DEFAULT_LOCALE } from "./i18n.js";
import { describeAuth, maskToken, resolveRelayAuth } from "./auth.js";
import { createRuntimeStatePersister } from "./runtime-state.js";
import { startConfigWatcher } from "./config-watcher.js";
import { renderTokenPrompt } from "./dashboard/token-prompt.js";
import { renderErrorRow, classifyErrorCounts, topUsageLabel, formatTimestamp, buildProfileDefaultOptions, renderRouteRow } from "./dashboard/fragments.js";
import { selectRoute, orderCandidates, resolveActiveProfile as resolveLibActiveProfile, getResolvedRouteDailyLimit } from "./lib/route-logic.js";
import { sanitizedConfig as sanitizedConfigOps, editableConfig as editableConfigOps, serializeEditableConfig, applyEditableConfig as applyEditableConfigOps, sanitizeProviderInput, sanitizeRouteInput, sanitizeProfileInput, isKnownModelRef, providerNameFromUrl, routeNameFromUrl, keyIdFromUrl, providerNameFromKeyUrl, getWritableConfigPath, collectProviderReferences, collectRouteReferences, buildWebKeysByProvider, findForbiddenSecretFields, validateEditableConfig } from "./lib/config-ops.js";
import { createAdminHandlers } from "./handlers/admin.js";
import { createProxyHandlers } from "./handlers/proxy.js";
import { createRouter } from "./router.js";
import { PROVIDER_TEMPLATES, ROUTE_TEMPLATES, LOCAL_PROVIDER_NAMES, SUPPORTED_TABS, V1_PROXY_PATHS, isLocalProvider as registryIsLocalProvider } from "./provider-registry.js";
import { ProviderRegistry, createProviderRegistry } from "./provider-registry-lib.js";
import { RequestLog, computeStats } from "./request-log.js";
import { buildRequestMeta } from "./privacy.js";

const DEFAULT_PORT = 18765;
const cliOptions = parseCliOptions(process.argv.slice(2));
const rootDir = detectRuntimeRootDir(cliOptions.rootDir);
const packageVersion = readPackageVersion();
const checkMode = process.argv.includes("--check");
loadDotEnv(rootDir);

const relayAuth = resolveRelayAuth({ env: process.env, rootDir, readonly: checkMode });
setAuthContext(relayAuth);
if (checkMode) {
} else if (relayAuth.allowNoAuth) {
  console.warn("[RelayForge] WARNING: allowNoAuth is enabled. Local relay API is running without authentication. Do not run in this mode on a machine where untrusted browser tabs or extensions can reach 127.0.0.1:" + (process.env.PORT || DEFAULT_PORT) + ".");
 } else if (relayAuth.token) {
   console.log(`[RelayForge] local relay token: ${relayAuth.masked} (${relayAuth.note})`);
}

let { config, configPath } = loadConfig(rootDir);
const keystoreDir = (process.env.RELAYFORGE_KEYSTORE_DIR || process.env.OPENRELAY_KEYSTORE_DIR) ? resolve(rootDir, process.env.RELAYFORGE_KEYSTORE_DIR || process.env.OPENRELAY_KEYSTORE_DIR) : resolve(rootDir, "data");
const secretStore = new SecretStore({ dataDir: keystoreDir, env: process.env, readOnly: checkMode });
let keyPool = new KeyPool(config.providers, getProviderKeys, config.retry.cooldownMs, { secretStore });
const statePath = (process.env.RELAYFORGE_STATE || process.env.OPENRELAY_STATE) ? resolve(rootDir, process.env.RELAYFORGE_STATE || process.env.OPENRELAY_STATE) : resolve(rootDir, "data", "runtime-state.json");
const runtimeStatePersister = createRuntimeStatePersister(statePath);
const persistedState = loadRuntimeState();
const stats = { startedAt: new Date().toISOString(), requests: persistedState.stats?.requests || 0, proxied: persistedState.stats?.proxied || 0, failures: persistedState.stats?.failures || 0, localLimitHits: persistedState.stats?.localLimitHits || 0, upstreamAttempts: persistedState.stats?.upstreamAttempts || 0, byProvider: persistedState.stats?.byProvider || {} };
const routeRuntime = new Map();
const usage = new UsageTracker(persistedState.usage, { retentionDays: config.history.retentionDays });
const healthCache = persistedState.healthCache || {};
const modelDiscoveryCache = persistedState.modelDiscoveryCache || {};
const balanceCache = persistedState.balanceCache || {};
const recentErrors = Array.isArray(persistedState.recentErrors) ? persistedState.recentErrors.slice(0, 50) : [];
const providerHealth = new ProviderHealthTracker(persistedState.providerHealth || {});
let activeProfile = resolveActiveProfile(extractActiveProfileName(persistedState.activeProfile) || config.activeProfile)?.name || (typeof config.activeProfile === "string" ? config.activeProfile : null) || null;
let healthCheckTimer = null;
let healthCheckRunning = false;

const configReload = { lastReloadAt: null, ok: true, message: "not yet triggered", count: 0 };
let configWatcherHandle = null;

const requestLog = new RequestLog(20);
let providerRegistry = createProviderRegistry(config.providers);

const port = Number(process.env.RELAYFORGE_PORT || process.env.PORT || process.env.OPENRELAY_PORT || DEFAULT_PORT);

if (checkMode) {
  console.log(JSON.stringify(buildStatus(), null, 2));
  process.exit(0);
}

/** @param {string[]} argv @returns {{ rootDir: string|null }} */
function parseCliOptions(argv) {
  const out = { rootDir: null };
  if (!Array.isArray(argv)) return out;
  for (const arg of argv) {
    if (typeof arg !== "string") continue;
    if (arg === "--check") continue;
    if (arg.startsWith("--root=")) {
      const value = arg.slice("--root=".length).trim();
      if (value) out.rootDir = resolve(value);
    } else if (arg === "--root") {
      continue;
    }
  }
  return out;
}

/** @returns {string} */
function readPackageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}

/** @returns {object} */
function loadRuntimeState() {
  if (!existsSync(statePath)) return {};
  try {
    const loaded = JSON.parse(readFileSync(statePath, "utf8"));
    if (!loaded || typeof loaded !== "object") return {};
    return loaded;
  } catch {
    return {};
  }
}

/** @returns {object} */
function buildRuntimeStateSnapshot() {
  return { version: 2, savedAt: new Date().toISOString(), activeProfile, stats: { requests: stats.requests, proxied: stats.proxied, failures: stats.failures, localLimitHits: stats.localLimitHits, upstreamAttempts: stats.upstreamAttempts, byProvider: stats.byProvider }, usage: usage.current(), healthCache, modelDiscoveryCache, balanceCache, recentErrors, providerHealth: providerHealth.state };
}

/** @returns {void} */
function persistRuntimeState() {
  runtimeStatePersister.persist(buildRuntimeStateSnapshot());
}

/** @returns {Promise<void>} */
async function flushRuntimeState() {
  await runtimeStatePersister.flush();
}

/** @param {string} scope @param {Error} error @param {string} category @param {object} [meta] @returns {void} */
function recordError(scope, error, category, meta) {
  if (!error) return;
  const entry = buildErrorEntry({ scope, category: isValidCategory(category) ? category : null, error, ...(meta && typeof meta === "object" ? meta : {}) });
  recentErrors.unshift(entry);
  recentErrors.length = Math.min(recentErrors.length, 50);
}

/** @returns {void} */
function scheduleHealthChecks() {
  if (healthCheckTimer) { clearInterval(healthCheckTimer); healthCheckTimer = null; }
  if (!config.healthChecks.enabled) return;
  const intervalMinutes = Math.max(5, Number(config.healthChecks.intervalMinutes || 60));
  healthCheckTimer = setInterval(() => { runScheduledHealthChecks().catch((error) => { console.error(`scheduled health check failed: ${error.message}`); }); }, intervalMinutes * 60 * 1000);
}

/** @returns {Promise<void>} */
async function runScheduledHealthChecks() {
  if (healthCheckRunning) return;
  healthCheckRunning = true;
  try {
    const names = config.healthChecks.providers.length > 0 ? config.healthChecks.providers : config.providers.map((p) => p.name);
    for (const name of names) {
      const provider = config.providers.find((p) => p.name === name);
      if (!provider) continue;
      await testProvider(provider);
    }
  } finally { healthCheckRunning = false; }
}

/** @param {string} tab @param {object} status @param {number} port @param {string} locale @returns {string|null} */
function renderSingleTab(tab, status, port, locale) {
  const webKeys = status.webKeys || [];
  const routes = status.routes || [];
  const providerTemplates = status.providerTemplates || [];
  const profileList = (status.profiles && status.profiles.profiles) || [];
  const activeProfileName = (status.profiles && status.profiles.activeProfile) || null;
  const defaultModel = (status.profiles && status.profiles.defaultModel) || null;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  const apiKeyHint = status.relayAuth?.apiKeyHint || "local";
  const relayTokenRequired = !!status.relayAuth?.tokenRequired;
  const providerCount = status.providers.length;
  const totalWebKeys = webKeys.length;
  const todayRequests = (status.usage && status.usage.daily && status.usage.daily.total) || 0;
  const totalLocalLimitHits = status.stats?.localLimitHits || 0;
  const recentErrorCount = (status.recentErrors || []).length;
  const localProviderCount = status.providers.filter((p) => p.local).length;
  const cloudProviderCount = providerCount - localProviderCount;
  const errors = Array.isArray(status.recentErrors) ? status.recentErrors.slice() : [];
  const errorCounts = classifyErrorCounts(errors);
  const errorRows = errors.slice(0, 50).map((entry) => renderErrorRow(entry)).join("");
  const errorPreviewRows = errors.slice(0, 5).length === 0 ? '<tr><td colspan="3" class="muted">暂无错误</td></tr>' : errors.slice(0, 5).map(renderErrorRow).join("");
  const usageRows = (status.usage && status.usage.daily) ? Object.entries(status.usage.daily.routes || {}).map(([name, count]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>${count}</td><td><span class="pill">路由</span></td></tr>`).join("") : "";
  const historyMax = Math.max(1, ...(status.usage?.history || []).map((item) => item.total || 0));
  const historyRows = (status.usage?.history || []).slice(-(status.usage?.historyDays || 14)).map((item) => { const w = Math.max(3, Math.round(((item.total || 0) / historyMax) * 100)); return `<tr><td>${escapeHtml(item.day)}</td><td>${item.total || 0}</td><td><div class="bar"><span style="width:${w}%"></span></div></td><td>${escapeHtml(topUsageLabel(item.routes))}</td><td>${escapeHtml(topUsageLabel(item.providers))}</td></tr>`; }).join("");
  const healthRows = Object.entries(status.healthCache || {}).map(([prov, h]) => `<tr><td>${escapeHtml(prov)}</td><td class="${h.ok?"ok":"bad"}">${h.ok?"正常":"失败"}</td><td>${escapeHtml(h.model||"")}</td><td>${escapeHtml(String(h.status||h.error||""))}</td><td>${h.elapsedMs??""}</td><td>${escapeHtml(h.checkedAt||"")}</td></tr>`).join("");
  const discoveryRows = Object.entries(status.modelDiscoveryCache || {}).map(([prov, d]) => `<tr><td>${escapeHtml(prov)}</td><td class="${d.ok?"ok":"bad"}">${d.ok?"成功":"失败"}</td><td>${d.count||0}</td><td>${escapeHtml((d.models||[]).slice(0,8).join(", "))}${(d.models||[]).length>8?" ...":""}</td><td>${escapeHtml(d.discoveredAt||"")}</td></tr>`).join("");
  const balanceRows = Object.entries(status.balanceCache || {}).map(([prov, b]) => `<tr><td>${escapeHtml(prov)}</td><td class="${b.ok?"ok":"bad"}">${b.ok?"正常":"失败"}</td><td>${escapeHtml(b.summary||b.error||"")}</td><td>${escapeHtml(b.checkedAt||"")}</td></tr>`).join("");
  const routeRows = routes.map((rt) => renderRouteRow(rt, status.usage, status.usage.limits)).join("");
  const providerRows = status.providers.map((p) => renderDashboardProviderRow(p, buildWebKeysByProvider(webKeys), status.healthCache || {}, status.keys || {}, status.providerHealth || {})).join("");
  const webKeysByProvider = buildWebKeysByProvider(webKeys);
  const providerOptions = status.providers.map((p) => { const wc = (webKeysByProvider[p.name]||[]).filter(k=>k.enabled).length; const kt = p.local ? "本地模型无需 Key" : wc > 0 ? `${wc} 个 Web Key` : p.keyCount > 0 ? `${p.keyCount} 个 env Key` : "未添加 Key"; return `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${escapeHtml(p.apiFormat)} · ${escapeHtml(kt)})</option>`; }).join("");
  const providerTemplateOptions = providerTemplates.map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.displayName||t.name)}</option>`).join("");
  const routeTemplateOptions = (status.routeTemplates||[]).map((t) => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)} · ${escapeHtml(t.strategy||"fallback")}</option>`).join("");
  const profileDefaultOptions = buildProfileDefaultOptions(status).map((item) => `<option value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</option>`).join("");
  const keyPoolRows = Object.entries(status.keys||{}).flatMap(([prov, ks]) => ks.map((k) => `<tr><td>${escapeHtml(prov)}</td><td><code>${escapeHtml(k.label)}</code><div class="muted mono">${escapeHtml(k.hash||"")}</div>${k.source?`<div class="muted">来源：${escapeHtml(k.source)}</div>`:""}</td><td>${k.uses}</td><td>${k.failures}</td><td>${k.coolingDown?`<span class="pill warn">冷却中</span> <span class="muted">至 ${escapeHtml(formatTimestamp(k.cooldownUntil))}</span>`:'<span class="pill ok">就绪</span>'}</td></tr>`)).join("");
  const profileRows = profileList.map((prof) => `<tr><td><strong>${escapeHtml(prof.name)}</strong><div class="muted">${escapeHtml(prof.description)}</div></td><td><code>${escapeHtml(prof.defaultModel)}</code></td><td>${prof.active?'<span class="pill ok">当前激活</span>':'<span class="pill muted-pill">未激活</span>'}</td><td><div class="row-actions"><button type="button" data-set-profile="${escapeHtml(prof.name)}" ${prof.active?"disabled":""}>激活</button><button type="button" data-edit-profile="${escapeHtml(prof.name)}">编辑</button><button type="button" data-clone-profile="${escapeHtml(prof.name)}">克隆</button><button type="button" data-delete-profile="${escapeHtml(prof.name)}" ${prof.active?"disabled":""}>删除</button></div></td></tr>`).join("");
  const overviewEnvBlock = `$env:OPENAI_BASE_URL = "${baseUrl}"\n$env:OPENAI_API_KEY  = "${apiKeyHint}"\n$env:ANTHROPIC_BASE_URL = "${baseUrl}"\n$env:ANTHROPIC_API_KEY  = "${apiKeyHint}"`;
  const relayAuthStateSingle = { allowNoAuth: !!status.relayAuth?.allowNoAuth, tokenRequired: relayTokenRequired, tokenSource: status.relayAuth?.tokenSource || "unset", apiKey: status.relayAuth?.apiKey || "", apiKeyHint, apiKeyMasked: status.relayAuth?.apiKeyMasked || apiKeyHint };
  const relayTokenBanner = relayAuthStateSingle.allowNoAuth ? '<span class="pill bad" data-no-auth-banner>无鉴权模式</span> <span class="muted">当前处于无鉴权模式，请勿在不可信网络环境或浏览器环境中长期运行。</span>' : relayTokenRequired ? '<span class="pill warn">RELAY_TOKEN 已启用</span> <span class="muted">/admin/* 需要 Bearer Token，本页 Token 存到 sessionStorage。</span>' : '<span class="pill ok">RELAY_TOKEN 未设置</span> <span class="muted">本地仍可使用；建议在 <code>.env</code> 设置 <code>RELAY_TOKEN</code> 以保护管理接口。</span>';
  const ctx = { baseUrl, apiKeyHint, overviewEnvBlock, relayTokenRequired, relayTokenBanner, relayAuth: relayAuthStateSingle, providerCount, localProviderCount, cloudProviderCount, totalWebKeys, todayRequests, totalLocalLimitHits, recentErrorCount, errors, activeProfileName, defaultModel, errorRows, errorPreviewRows, port, status };
  switch (tab) {
    case "overview": return renderOverviewTab({ ...ctx, recentErrors: ctx.errors, recentPreview: ctx.errors.slice(0, 5), errorPreviewRows });
    case "providers": return renderProvidersTab({ providerRows, webKeyRows: webKeys.map((k) => `<tr data-key-row="${escapeHtml(k.id)}"><td><code>${escapeHtml(k.id)}</code></td><td>${escapeHtml(k.provider)}</td><td><code>${escapeHtml(k.masked)}</code><div class="muted mono">hash: ${escapeHtml(k.hash||"")}</div></td><td>${escapeHtml(k.label||"—")}</td><td>${k.enabled?'<span class="pill ok">启用</span>':'<span class="pill warn">停用</span>'}</td><td><div class="muted">${escapeHtml(formatTimestamp(k.lastUsedAt)||"—")}</div>${k.lastTestAt?`<div class="muted">最近测试：${escapeHtml(formatTimestamp(k.lastTestAt))}${k.lastTestResult?.ok===true?' <span class="ok">通过</span>':k.lastTestResult?.ok===false?' <span class="bad">失败</span>':""}</div>`:""}</td><td><div class="row-actions"><button type="button" data-test-key="${escapeHtml(k.id)}">测试</button><button type="button" data-toggle-key="${escapeHtml(k.id)}" data-target-enabled="${k.enabled?"false":"true"}">${k.enabled?"停用":"启用"}</button><button type="button" data-delete-key="${escapeHtml(k.id)}" data-label="${escapeHtml(k.label||k.masked)}">删除</button></div></td></tr>`).join(""), providerOptions, providerTemplateOptions, status });
    case "routes": return renderRoutesTab({ routeRows, profileRows, keyPoolRows, routeTemplateOptions, profileDefaultOptions, status });
    case "tools": return renderToolCards({ ...status, relayAuth: relayAuthStateSingle }, port);
    case "usage": return renderUsageTab({ usageRows, historyRows, errorRows, errorCounts, errors, port, status });
    case "settings": return renderSettingsTab({ healthRows, discoveryRows, balanceRows, port, status });
    case "ide": return renderIdeTab(status, port);
    case "rate-limiting": return renderRateLimitingTab({ status, port });
    default: return null;
  }
}

/** @param {string} provider @returns {string} */
function providerHealthHint(provider) {
  if (!isLocalProvider(provider)) return "云端或远程 provider：连通测试可能消耗上游额度，请只在需要时手动触发。";
  return "本地 provider：如果连通测试失败，通常是 Ollama、LM Studio、vLLM 或 llama.cpp 服务未启动，或端口/baseURL 不一致。";
}

/** @param {string} providerName @param {string} field @returns {void} */
function incrementProvider(providerName, field) {
  if (!stats.byProvider[providerName]) stats.byProvider[providerName] = {};
  stats.byProvider[providerName][field] = (stats.byProvider[providerName][field] || 0) + 1;
  usage.incrementProviderStat(providerName, field);
}

/** @param {string} routeName @param {string} field @returns {void} */
function incrementRoute(routeName, field) { usage.incrementRuntime("byRoute", routeName, field); }

/** @param {string} modelName @param {string} field @returns {void} */
function incrementModel(modelName, field) { usage.incrementRuntime("byModel", modelName, field); }

/** @param {{ baseUrl: string, apiKey?: string|null }} opts @returns {Promise<object>} */
async function discoverModelsByUrl({ baseUrl, apiKey }) {
  const cleaned = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!cleaned) return { ok: false, error: "missing_base_url" };
  let parsed;
  try { parsed = new URL(cleaned); } catch { return { ok: false, error: "invalid_base_url" }; }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && isLoopbackHost(parsed.hostname))) return { ok: false, error: "base_url_must_be_https_or_loopback" };
  const url = cleaned + "/models";
  const headers = { accept: "application/json" };
  if (apiKey !== null && apiKey !== undefined && String(apiKey).trim() !== "") headers.authorization = "Bearer " + String(apiKey).trim();
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
    const responseText = await response.text();
    const elapsedMs = Date.now() - startedAt;
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) return { ok: false, error: "redirect_refused", status: response.status, elapsedMs };
    const parsedBody = parseMaybeJson(responseText);
    if (!response.ok) return { ok: false, error: "upstream_error", status: response.status, elapsedMs, body: typeof parsedBody === "string" ? undefined : parsedBody };
    const models = extractModelIds(parsedBody);
    return { ok: true, baseUrl: cleaned, count: models.length, models, elapsedMs };
  } catch (error) {
    return { ok: false, error: "request_failed", message: error.message, elapsedMs: Date.now() - startedAt, models: [], count: 0 };
  }
}

/** @returns {object} */
function buildStatus() {
  usage.resetIfNeeded();
  return { ok: true, version: packageVersion, modelAliases: config.modelAliases || {}, startedAt: stats.startedAt, configPath, statePath, providers: config.providers.map((p) => ({ name: p.name, displayName: p.displayName || "", baseUrl: p.baseUrl, apiFormat: p.apiFormat, keyEnv: p.keyEnv, allowInsecureHttp: p.allowInsecureHttp === true, insecureHttpRisk: p.allowInsecureHttp === true && String(p.baseUrl).startsWith("http://") && !isLocalProvider(p), local: isLocalProvider(p), healthHint: providerHealthHint(p), keyCount: getProviderKeys(p).length, models: p.models, extraHeaders: p.extraHeaders || null, balanceEndpoint: p.balanceEndpoint || null })), routes: config.routes.map((rt) => ({ name: rt.name, description: rt.description || "", strategy: rt.strategy, limits: rt.limits || {}, candidates: rt.candidates })), combos: config.combos || [], routeReferences: Object.fromEntries(config.routes.map((rt) => [rt.name, collectRouteReferences(rt.name, config)])), routeTemplates: ROUTE_TEMPLATES.map((t) => JSON.parse(JSON.stringify(t))), profiles: profileSummary(), stats, usage: usageSummary(), healthCache, modelDiscoveryCache, balanceCache, recentErrors, providerHealth: providerHealth.summary(), healthChecks: { enabled: config.healthChecks.enabled, intervalMinutes: config.healthChecks.intervalMinutes, providers: config.healthChecks.providers }, keys: keyPool.summary(), webKeys: secretStore.list(), secretStore: { masterKeyOnDisk: secretStore.hasMasterKeyOnDisk(), masterKeyInEnv: secretStore.hasMasterKeyInEnv() }, providerTemplates: PROVIDER_TEMPLATES.map((t) => ({ ...t })), providerCapabilities: providerRegistry.toJSON(), recentRequests: requestLog.recent(20), requestStats: requestLog.size > 0 ? computeStats(requestLog.recent(100)) : { total: 0, success: 0, failed: 0, avgLatencyMs: 0, byModel: {}, byProvider: {}, byError: {} }, relayAuth: describeAuth(relayAuth), configReload: { lastReloadAt: configReload.lastReloadAt, ok: configReload.ok, message: configReload.message, count: configReload.count } };
}

/** @returns {object} */
function buildHealth() { return { ok: true, startedAt: stats.startedAt, version: packageVersion }; }

/** @param {string} url @returns {boolean} */
function isProxyPath(url) {
  if (!url) return false;
  return V1_PROXY_PATHS.has(String(url).split("?", 1)[0]);
}

/** @param {object} provider @returns {boolean} */
function isLocalProvider(provider) {
  return registryIsLocalProvider(provider);
}

/** @param {string} name @returns {object|null} */
function resolveActiveProfile(name) {
  if (!config.profiles.length) return null;
  return config.profiles.find((p) => p.name === name) || config.profiles[0];
}

/** @returns {object} */
function profileSummary() {
  const active = resolveActiveProfile(activeProfile);
  return { activeProfile: active?.name || null, defaultModel: active?.defaultModel || null, profiles: config.profiles.map((p) => ({ ...p, active: p.name === active?.name })) };
}

/** @param {*} value @returns {string|null} */
function extractActiveProfileName(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && typeof value.name === "string") return value.name.trim() || null;
  return null;
}

/** @returns {object} */
function usageSummary() {
  usage.resetIfNeeded();
  return { day: usage.day(), daily: usage.current().daily, history: usage.summary(config.history.retentionDays).history, historyDays: config.history.retentionDays, runtime: usage.current().runtime, metrics: usage.metrics(), limits: { dailyRequests: config.limits.dailyRequests, routes: config.limits.routes, providers: config.limits.providers, models: config.limits.models } };
}

/** @param {string} routeName @returns {number} */
function getRouteDailyLimit(routeName) {
  const route = config.routes.find((r) => r.name === routeName);
  return route?.limits?.dailyRequests || config.limits.routes[routeName]?.dailyRequests || config.limits.dailyRequests;
}

/** @param {string} providerName @returns {number} */
function getProviderDailyLimit(providerName) {
  return config.limits.providers[providerName]?.dailyRequests || config.limits.dailyRequests;
}

/** @param {string} providerName @param {string} model @returns {number} */
function getModelDailyLimit(providerName, model) {
  return config.limits.models?.[`${providerName}:${model}`]?.dailyRequests || config.limits.models?.[model]?.dailyRequests || config.limits.dailyRequests;
}

/** @param {string} kind @param {string} name @param {number} limit @returns {boolean} */
function isLimitExceeded(kind, name, limit) {
  usage.resetIfNeeded();
  if (!limit) return false;
  return (usage.current().daily[kind][name] || 0) >= limit;
}

/** @param {*} payload @returns {boolean} */
function isStreamRequested(payload) {
  if (!payload || typeof payload !== "object") return false;
  const value = payload.stream;
  return value === true || value === 1 || value === "true";
}

/** @param {*} value @returns {string[]} */
function extractModelIds(value) {
  const data = Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : [];
  return data.map((item) => (typeof item === "string" ? item : item?.id || item?.name || "")).map((s) => String(s).trim()).filter(Boolean).slice(0, 500);
}

/** @param {import("node:http").IncomingMessage} req @returns {string} */
function getLocale(req) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const queryLang = url.searchParams.get("lang");
    if (queryLang && I18N_SUPPORTED_LOCALES.includes(queryLang)) return queryLang;
    const cookieHeader = req.headers.cookie || "";
    for (const part of cookieHeader.split(/;\s*/)) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const value = part.slice(eq + 1).trim();
      if (part.slice(0, eq).trim() === "OPENRELAY_LOCALE" && I18N_SUPPORTED_LOCALES.includes(value)) return value;
    }
  } catch { /* ignore */ }
  return I18N_DEFAULT_LOCALE;
}



/** @param {object} provider @param {string|null} keyValue @param {string} providerName @param {string} [requestedModel] @returns {Promise<object>} */
async function testProviderWithKey(provider, keyValue, providerName, requestedModel) {
  const model = requestedModel || provider.models[0];
  if (!model) return { ok: false, provider: providerName, error: "no_model_configured" };
  const startedAt = Date.now();
  const headers = { "content-type": "application/json" };
  if (keyValue) {
    if (provider.apiFormat === "anthropic") { headers["x-api-key"] = keyValue; headers["anthropic-version"] = provider.anthropicVersion || "2023-06-01"; }
    else { headers.authorization = `Bearer ${keyValue}`; }
  }
  if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
  const payload = { model, messages: [{ role: "user", content: "ping" }], max_tokens: 8, temperature: 0 };
  const path = provider.apiFormat === "anthropic" ? "/messages" : "/chat/completions";
  const upstreamBody = provider.apiFormat === "anthropic" ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] } : payload;
  try {
    const response = await fetch(`${provider.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(upstreamBody), signal: AbortSignal.timeout(15000) });
    const responseText = await response.text();
    const elapsedMs = Date.now() - startedAt;
    const result = { ok: response.ok, provider: providerName, model, status: response.status, elapsedMs, body: response.ok ? "ok" : parseMaybeJson(responseText) };
    healthCache[providerName] = { ...result, checkedAt: new Date().toISOString() };
    persistRuntimeState();
    return result;
  } catch (error) {
    const result = { ok: false, provider: providerName, model, error: "request_failed", message: error.message, elapsedMs: Date.now() - startedAt };
    healthCache[providerName] = { ...result, checkedAt: new Date().toISOString() };
    persistRuntimeState();
    recordError(`test-provider:${providerName}`, error, "upstream_request_failed", { provider: providerName, elapsedMs: Date.now() - startedAt });
    return result;
  }
}

/** @param {object} provider @param {string} [requestedModel] @returns {Promise<object>} */
async function testProvider(provider, requestedModel) {
  const key = keyPool.next(provider.name);
  return testProviderWithKey(provider, key ? key.value : null, provider.name, requestedModel);
}

/** @param {object} provider @returns {Promise<object>} */
async function discoverProviderModels(provider) {
  if (provider.apiFormat !== "openai") { const r = { ok: false, provider: provider.name, error: "model_discovery_unsupported" }; modelDiscoveryCache[provider.name] = { ...r, discoveredAt: new Date().toISOString() }; persistRuntimeState(); return r; }
  const key = keyPool.next(provider.name);
  const headers = { accept: "application/json" };
  if (key) headers.authorization = `Bearer ${key.value}`;
  if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
  const startedAt = Date.now();
  try {
    const response = await fetch(`${provider.baseUrl}/models`, { method: "GET", headers, signal: AbortSignal.timeout(15000) });
    const responseText = await response.text();
    const parsed = parseMaybeJson(responseText);
    const models = response.ok ? extractModelIds(parsed) : [];
    const result = { ok: response.ok, provider: provider.name, status: response.status, elapsedMs: Date.now() - startedAt, models, count: models.length, body: response.ok ? undefined : parsed };
    modelDiscoveryCache[provider.name] = { ...result, discoveredAt: new Date().toISOString() };
    persistRuntimeState();
    return result;
  } catch (error) {
    const result = { ok: false, provider: provider.name, error: "request_failed", message: error.message, elapsedMs: Date.now() - startedAt, models: [], count: 0 };
    modelDiscoveryCache[provider.name] = { ...result, discoveredAt: new Date().toISOString() };
    persistRuntimeState();
    recordError(`discover:${provider.name}`, error, "upstream_request_failed", { provider: provider.name, elapsedMs: Date.now() - startedAt });
    return result;
  }
}

/** @param {object} provider @returns {Promise<object>} */
async function checkProviderBalance(provider) {
  const endpoint = provider.balanceEndpoint;
  if (!endpoint || typeof endpoint !== "object" || typeof endpoint.url !== "string") { const r = { ok: false, provider: provider.name, error: "balance_endpoint_not_configured" }; balanceCache[provider.name] = { ...r, checkedAt: new Date().toISOString() }; persistRuntimeState(); return r; }
  const guard = guardBalanceEndpoint(endpoint, provider);
  if (!guard.ok) { const r = { ok: false, provider: provider.name, error: guard.error, message: guard.message }; balanceCache[provider.name] = { ...r, checkedAt: new Date().toISOString() }; persistRuntimeState(); return r; }
  const startedAt = Date.now();
  const headers = { accept: "application/json" };
  if (guard.allowedHeaders && typeof guard.allowedHeaders === "object") Object.assign(headers, guard.allowedHeaders);
  if (guard.requiresKey) {
    const key = keyPool.next(provider.name);
    if (!key || !key.value) { const r = { ok: false, provider: provider.name, error: "no_available_key" }; balanceCache[provider.name] = { ...r, checkedAt: new Date().toISOString() }; persistRuntimeState(); return r; }
    if (provider.apiFormat === "anthropic") { headers["x-api-key"] = key.value; headers["anthropic-version"] = provider.anthropicVersion || "2023-06-01"; }
    else headers.authorization = `Bearer ${key.value}`;
  }
  try {
    const response = await fetch(guard.url, { method: guard.method, headers, signal: AbortSignal.timeout(10000), redirect: "manual" });
    const responseText = response.type === "opaqueredirect" ? "" : await response.text().then((t) => t.slice(0, 65536));
    const elapsedMs = Date.now() - startedAt;
    const result = interpretBalanceResponse({ response, responseText, fieldMap: endpoint.fieldMap, providerName: provider.name, endpointUrl: guard.url, elapsedMs });
    balanceCache[provider.name] = { ...result, checkedAt: new Date().toISOString() };
    persistRuntimeState();
    return result;
  } catch (error) {
    const result = { ok: false, provider: provider.name, endpoint: guard.url, error: "request_failed", message: error.message, elapsedMs: Date.now() - startedAt };
    balanceCache[provider.name] = { ...result, checkedAt: new Date().toISOString() };
    persistRuntimeState();
    recordError(`balance:${provider.name}`, error, "upstream_request_failed", { provider: provider.name, elapsedMs: Date.now() - startedAt });
    return result;
  }
}

function reloadConfigFromDisk(rawConfig) {
  const previousConfig = config;
  const previousKeyPool = keyPool;
  const previousActiveProfile = activeProfile;
  const previousProviderRegistry = providerRegistry;
  try {
    const normalized = normalizeConfig(JSON.parse(JSON.stringify(rawConfig)));
    const validation = validateConfig(normalized);
    if (!validation.ok) {
      const detail = validation.errors.map((e) => `${e.path || "(root)"}: ${e.message}`).join("; ");
      throw new Error(`config validation failed: ${detail}`);
    }
    config = normalized;
    keyPool = new KeyPool(config.providers, getProviderKeys, config.retry.cooldownMs, { secretStore });
    providerRegistry = createProviderRegistry(config.providers);
    activeProfile = resolveActiveProfile(extractActiveProfileName(activeProfile) || config.activeProfile)?.name || config.activeProfile || null;
    usage.setRetentionDays(config.history.retentionDays);
    routeRuntime.clear();
    scheduleHealthChecks();
    syncAppState();
    persistRuntimeState();
    configReload.lastReloadAt = new Date().toISOString();
    configReload.ok = true;
    configReload.message = `reloaded ${config.providers.length} providers, ${config.routes.length} routes`;
    configReload.count += 1;
    console.log(`[RelayForge] config reloaded from disk (${configReload.message})`);
  } catch (error) {
    config = previousConfig;
    keyPool = previousKeyPool;
    activeProfile = previousActiveProfile;
    providerRegistry = previousProviderRegistry;
    routeRuntime.clear();
    scheduleHealthChecks();
    syncAppState();
    configReload.lastReloadAt = new Date().toISOString();
    configReload.ok = false;
    configReload.message = error.message;
    recordError("config:hot-reload", error, "config_error", { providers: previousConfig.providers.length });
    console.warn(`[RelayForge] config hot-reload failed, kept previous config: ${error.message}`);
  }
}

const appState = { config: null, configPath: null, keyPool: null, activeProfile: null };

function syncAppState() {
  appState.config = config;
  appState.configPath = configPath;
  appState.keyPool = keyPool;
  appState.activeProfile = activeProfile;
}
syncAppState();

const ctx = {
  get config() { return appState.config; },
  set config(v) { appState.config = v; config = v; },
  get configPath() { return appState.configPath; },
  set configPath(v) { appState.configPath = v; configPath = v; },
  get keyPool() { return appState.keyPool; },
  set keyPool(v) { appState.keyPool = v; keyPool = v; },
  get activeProfile() { return appState.activeProfile; },
  set activeProfile(v) { appState.activeProfile = extractActiveProfileName(v); activeProfile = appState.activeProfile; },
  stats, routeRuntime, usage, healthCache, modelDiscoveryCache, balanceCache, recentErrors,
  secretStore, providerHealth, runtimeStatePersister,
  requestLog, providerRegistry,
  port, packageVersion, statePath, relayAuth,
  PROVIDER_TEMPLATES, ROUTE_TEMPLATES, LOCAL_PROVIDER_NAMES,
  renderTokenPrompt, isAdminPath, isAllowedAdminOrigin, isAuthorized, isAuthorizedV1,
  sendJson, sendHtml, sendNoContent, unauthorized, forbiddenCors,
  withCorsHeaders, copyResponseHeaders, escapeHtml, readJsonBody, parseMaybeJson,
  buildStatus, buildHealth, renderDashboard, renderSingleTab, SUPPORTED_TABS,
  recordError, scheduleHealthChecks, persistRuntimeState, flushRuntimeState,
  incrementProvider, incrementRoute, incrementModel, getProviderKeys,
  isProxyPath, isLocalProvider, resolveActiveProfile, profileSummary, extractActiveProfileName,
  usageSummary, getRouteDailyLimit, getProviderDailyLimit, getModelDailyLimit, isLimitExceeded, isStreamRequested,
  extractModelIds, getLocale, providerHealthHint,
  sanitizedConfig: () => sanitizedConfigOps(config, activeProfile, getProviderKeys),
  editableConfig: () => editableConfigOps(config, activeProfile),
  serializeEditableConfig,
  applyEditableConfig(candidate, action) {
    const deps = { rootDir, loadConfig, normalizeConfig, KeyPool, getProviderKeys, secretStore, routeRuntime, recordError, scheduleHealthChecks, usage, config, configPath, keyPool, activeProfile };
    const result = applyEditableConfigOps(candidate, action, deps);
    config = deps.config; configPath = deps.configPath; keyPool = deps.keyPool; activeProfile = deps.activeProfile;
    syncAppState();
    return result;
  },
  validateEditableConfig: (candidate) => validateEditableConfig(candidate, normalizeConfig),
  sanitizeProviderInput, sanitizeRouteInput, sanitizeProfileInput,
  isKnownModelRef: (model) => isKnownModelRef(model, config),
  providerNameFromUrl, routeNameFromUrl, keyIdFromUrl, providerNameFromKeyUrl,
  getWritableConfigPath: () => getWritableConfigPath(rootDir),
  collectProviderReferences: (n) => collectProviderReferences(n, config, secretStore),
  collectRouteReferences: (n) => collectRouteReferences(n, config),
  buildWebKeysByProvider: (w) => buildWebKeysByProvider(w || secretStore.list()),
  findForbiddenSecretFields,
  testProviderWithKey, discoverProviderModels, discoverModelsByUrl, checkProviderBalance,
  selectRoute: (model) => selectRoute(model, config, activeProfile, providerHealth, routeRuntime),
  orderCandidates: (route) => orderCandidates(route, providerHealth, routeRuntime),
  getResolvedRouteDailyLimit: (route) => getResolvedRouteDailyLimit(route),
  normalizeUsage, anthropicToOpenAi, openAiToAnthropic,
  openAiResponseToAnthropic, anthropicResponseToOpenAi,
  openAiResponseToResponses, anthropicResponseToResponses, responsesToChatPayload,
  createAnthropicToOpenAiSseBridge, createOpenAiToAnthropicSseBridge,
  guardBalanceEndpoint, interpretBalanceResponse, resolveRoutePreview,
  describeAuth, maskToken, I18N_SUPPORTED_LOCALES, I18N_DEFAULT_LOCALE,
  configReload,
  reloadConfigFromDisk
};
syncAppState();

const proxyHandlers = createProxyHandlers(ctx);
const extendedCtx = Object.create(ctx);
Object.assign(extendedCtx, proxyHandlers);
const adminHandlers = createAdminHandlers(extendedCtx);
const allHandlers = {};
for (const key of [...Object.getOwnPropertyNames(adminHandlers), ...Object.getOwnPropertyNames(proxyHandlers)]) {
  allHandlers[key] = (adminHandlers[key] !== undefined) ? adminHandlers[key] : proxyHandlers[key];
}
const router = createRouter(allHandlers, extendedCtx);
const server = createServer(router);

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`RelayForge is running at http://127.0.0.1:${actualPort}`);
  if (actualPort === 18765) {
    console.log("Port 18765: RelayForge ready — OpenAI/Anthropic compatible endpoint at /v1.");
  }
  console.log(`Config: ${configPath}`);
  console.log("Config hot-reload: enabled (edit config.json to apply changes without restart)");
  scheduleHealthChecks();
  if (configPath && existsSync(configPath)) {
    configWatcherHandle = startConfigWatcher({
      configPath,
      lockDir: keystoreDir,
      onReload: (rawConfig) => reloadConfigFromDisk(rawConfig),
      onError: (error, context) => {
        configReload.lastReloadAt = new Date().toISOString();
        configReload.ok = false;
        configReload.message = `${context}: ${error.message}`;
        if (process.env.OPENRELAY_DEBUG) console.warn(`[RelayForge] config-watcher error (${context}): ${error.message}`);
      }
    });
  }
});

function shutdown(signal) {
  return async () => {
    console.log(`\n[RelayForge] ${signal} received, shutting down...`);
    if (configWatcherHandle) configWatcherHandle.stop();
    if (healthCheckTimer) clearInterval(healthCheckTimer);
    persistRuntimeState();
    const flushed = flushRuntimeState();
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("flush timeout")), 3000));
    try {
      await Promise.race([flushed, timeout]);
    } catch {
      console.warn("[RelayForge] runtime state flush timed out, forcing exit");
    }
    server.close(() => { process.exit(0); });
    setTimeout(() => { process.exit(1); }, 5000);
  };
}
process.on("SIGINT", shutdown("SIGINT"));
process.on("SIGTERM", shutdown("SIGTERM"));
