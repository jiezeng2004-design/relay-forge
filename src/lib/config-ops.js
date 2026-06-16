import { existsSync, mkdirSync, copyFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validateProviderBaseUrl } from "../config.js";
import { guardBalanceEndpoint } from "../balance.js";

/** @param {string} name @param {object} config @returns {object|null} */
function resolveActiveProfile(name, config) {
  if (!config.profiles.length) return null;
  return config.profiles.find((profile) => profile.name === name) || config.profiles[0];
}

/** @param {object} config @param {string} activeProfile @param {Function} getProviderKeys @returns {object} */
export function sanitizedConfig(config, activeProfile, getProviderKeys) {
  return {
    defaultProvider: config.defaultProvider,
    modelAliases: config.modelAliases || {},
    providers: config.providers.map((provider) => ({
      name: provider.name,
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      keyEnv: provider.keyEnv,
      keyCount: getProviderKeys(provider).length,
      models: provider.models,
      balanceEndpoint: provider.balanceEndpoint || null
    })),
    activeProfile,
    profiles: config.profiles,
    routes: config.routes,
    combos: config.combos || [],
    retry: config.retry,
    limits: config.limits,
    history: config.history,
    healthChecks: config.healthChecks,
    privacy: config.privacy || { logPrompts: false, logHeaders: false },
    localConnectorConsents: config.localConnectorConsents || {}
  };
}

/** @param {object} config @param {string} activeProfile @returns {object} */
export function editableConfig(config, activeProfile) {
  return {
    ...serializeEditableConfig(config),
    activeProfile: activeProfile || config.activeProfile
  };
}

/** @param {object} source @returns {object} */
export function serializeEditableConfig(source) {
  return {
    defaultProvider: source.defaultProvider,
    activeProfile: source.activeProfile,
    modelAliases: source.modelAliases || {},
    profiles: source.profiles,
    providers: source.providers.map((provider) => {
      const result = {
        name: provider.name,
        displayName: provider.displayName || "",
        baseUrl: provider.baseUrl,
        keyEnv: provider.keyEnv || null,
        apiFormat: provider.apiFormat || "openai",
        models: provider.models || [],
        allowInsecureHttp: provider.allowInsecureHttp === true
      };
      if (provider.anthropicVersion) result.anthropicVersion = provider.anthropicVersion;
      if (provider.extraHeaders) result.extraHeaders = provider.extraHeaders;
      if (provider.balanceEndpoint) result.balanceEndpoint = provider.balanceEndpoint;
      return result;
    }),
    routes: source.routes.map((route) => ({
      name: route.name,
      description: route.description || "",
      strategy: route.strategy || "fallback",
      limits: route.limits || {},
      candidates: route.candidates.map((candidate) => ({
        provider: candidate.provider,
        model: candidate.model,
        weight: candidate.weight || 1
      }))
    })),
    combos: Array.isArray(source.combos) ? source.combos.map((c) => ({
      name: c.name,
      description: c.description || "",
      strategy: c.strategy || "fallback",
      limits: c.limits || {},
      candidates: c.candidates.map((ca) => ({
        provider: ca.provider,
        model: ca.model,
        weight: ca.weight || 1,
        priority: ca.priority || 0,
        enabled: ca.enabled !== false
      }))
    })) : [],
    retry: source.retry,
    limits: source.limits,
    history: source.history,
    healthChecks: source.healthChecks,
    privacy: source.privacy || { logPrompts: false, logHeaders: false },
    localConnectorConsents: source.localConnectorConsents || {}
  };
}

/** @param {object} candidate @param {string} action @param {{ rootDir: string, loadConfig: Function, normalizeConfig: Function, KeyPool: Function, getProviderKeys: Function, secretStore: object, configPath: string, config: object, activeProfile: string, keyPool: object, routeRuntime: Map, recordError: Function, scheduleHealthChecks: Function, usage: object }} deps @returns {object} */
export function applyEditableConfig(candidate, action, deps) {
  const {
    rootDir, loadConfig, normalizeConfig, KeyPool,
    getProviderKeys, secretStore, routeRuntime,
    recordError, scheduleHealthChecks, usage
  } = deps;

  const normalized = validateEditableConfig(candidate, normalizeConfig);
  const writePath = getWritableConfigPath(rootDir);
  const backupPath = backupConfigIfNeeded(writePath);
  const previousConfig = deps.config;
  const previousConfigPath = deps.configPath;
  const previousKeyPool = deps.keyPool;
  const previousActiveProfile = deps.activeProfile;
  try {
    writeConfigAtomically(writePath, normalized);
    const loaded = loadConfig(rootDir);
    deps.config = loaded.config;
    deps.configPath = loaded.configPath;
    deps.keyPool = new KeyPool(deps.config.providers, getProviderKeys, deps.config.retry.cooldownMs, { secretStore });
    deps.usage.setRetentionDays(deps.config.history.retentionDays);
    deps.activeProfile = resolveActiveProfile(previousActiveProfile || deps.config.activeProfile, deps.config)?.name || deps.config.activeProfile;
    deps.routeRuntime.clear();
    scheduleHealthChecks();
  } catch (error) {
    deps.config = previousConfig;
    deps.configPath = previousConfigPath;
    deps.keyPool = previousKeyPool;
    deps.activeProfile = previousActiveProfile;
    deps.routeRuntime.clear();
    scheduleHealthChecks();
    recordError("config:rollback", error, "config_error");
    throw new Error(`failed to apply new config; rolled back: ${error.message}`);
  }
  return {
    ok: true,
    action,
    configPath: deps.configPath,
    backupPath,
    providers: deps.config.providers.length,
    routes: deps.config.routes.length
  };
}

/** @param {object} candidate @param {Function} normalizeConfig @returns {object} */
export function validateEditableConfig(candidate, normalizeConfig) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("config must be a JSON object");
  }
  const forbidden = findForbiddenSecretFields(candidate);
  if (forbidden.length > 0) {
    throw new Error(`do not write secrets into config.json; use .env instead: ${forbidden.join(", ")}`);
  }
  const cloned = JSON.parse(JSON.stringify(candidate));
  const normalized = normalizeConfig(cloned);
  return serializeEditableConfig(normalized);
}

/** @param {*} value @param {string[]} [path] @returns {string[]} */
export function findForbiddenSecretFields(value, path = []) {
  if (!value || typeof value !== "object") return [];
  const result = [];
  for (const [key, child] of Object.entries(value)) {
    const lowered = key.toLowerCase();
    const childPath = [...path, key];
    if (["apikey", "api_key", "token", "secret", "password", "cookie", "authorization"].includes(lowered)) {
      result.push(childPath.join("."));
    }
    result.push(...findForbiddenSecretFields(child, childPath));
  }
  return result;
}

/** @param {string} rootDir @returns {string} */
export function getWritableConfigPath(rootDir) {
  return process.env.OPENRELAY_CONFIG ? resolve(rootDir, process.env.OPENRELAY_CONFIG) : resolve(rootDir, "config.json");
}

/** @param {string} writePath @returns {string|null} */
export function backupConfigIfNeeded(writePath) {
  if (!existsSync(writePath)) return null;
  const backupDir = resolve(dirname(writePath), "backups", "config");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = resolve(backupDir, `config-${timestampForFile()}.bak.json`);
  copyFileSync(writePath, backupPath);
  return backupPath;
}

/** @param {string} writePath @param {object} value @returns {void} */
export function writeConfigAtomically(writePath, value) {
  mkdirSync(dirname(writePath), { recursive: true });
  const tempPath = `${writePath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, writePath);
}

/** @returns {string} */
export function timestampForFile() {
  return new Date().toISOString().replaceAll("-", "").replaceAll(":", "").replace(/\..+$/, "").replace("T", "-");
}

/** @param {object} input @param {object|null} existing @param {{ create: boolean }} options @returns {object} */
export function sanitizeProviderInput(input, existing, { create }) {
  const source = input && typeof input === "object" ? input : {};
  const name = create
    ? String(source.name || "").trim()
    : String(source.name || existing?.name || "").trim();
  if (!/^[a-z0-9_-]{2,64}$/.test(name)) {
    throw new Error("name must be 2-64 chars: lowercase letters, numbers, underscore or dash");
  }
  const baseUrl = source.baseUrl !== undefined
    ? String(source.baseUrl || "").trim()
    : String(existing?.baseUrl || "").trim();
  if (!baseUrl) throw new Error("baseUrl is required");
  const allowInsecureHttp = source.allowInsecureHttp !== undefined
    ? source.allowInsecureHttp === true
    : existing?.allowInsecureHttp === true;
  validateProviderBaseUrl(baseUrl, allowInsecureHttp, name);
  const apiFormat = String(source.apiFormat || existing?.apiFormat || "openai").trim();
  if (!["openai", "anthropic"].includes(apiFormat)) {
    throw new Error("apiFormat must be openai or anthropic");
  }
  const keyEnv = normalizeKeyEnv(source.keyEnv !== undefined ? source.keyEnv : existing?.keyEnv);
  const provider = {
    name,
    baseUrl,
    keyEnv,
    apiFormat,
    models: parseModelList(source.models !== undefined ? source.models : existing?.models),
    allowInsecureHttp
  };
  const displayName = source.displayName !== undefined ? String(source.displayName || "").trim() : existing?.displayName;
  if (displayName) provider.displayName = displayName.slice(0, 80);
  const anthropicVersion = source.anthropicVersion !== undefined ? String(source.anthropicVersion || "").trim() : existing?.anthropicVersion;
  if (anthropicVersion) provider.anthropicVersion = anthropicVersion;
  const extraHeaders = sanitizeSafeHeaders(source.extraHeaders !== undefined ? source.extraHeaders : existing?.extraHeaders, "extraHeaders");
  if (extraHeaders && Object.keys(extraHeaders).length > 0) provider.extraHeaders = extraHeaders;
  const balanceEndpoint = sanitizeBalanceEndpoint(source.balanceEndpoint !== undefined ? source.balanceEndpoint : existing?.balanceEndpoint, provider);
  if (balanceEndpoint) provider.balanceEndpoint = balanceEndpoint;
  return provider;
}

/** @param {object} input @param {object|null} existing @param {{ create: boolean }} options @returns {object} */
export function sanitizeRouteInput(input, existing, { create }) {
  const source = input && typeof input === "object" ? input : {};
  const name = create
    ? String(source.name || "").trim()
    : String(source.name || (existing && existing.name) || "").trim();
  if (!/^[a-z0-9_-]{2,64}$/.test(name)) {
    throw new Error("name must be 2-64 chars: lowercase letters, numbers, underscore or dash");
  }
  const description = source.description !== undefined
    ? String(source.description || "")
    : String((existing && existing.description) || "");
  const strategy = String(source.strategy || (existing && existing.strategy) || "fallback").trim();
  if (!["fallback", "round_robin", "weighted"].includes(strategy)) {
    throw new Error("strategy must be fallback, round_robin or weighted");
  }
  const candidates = parseCandidateList(source.candidates !== undefined ? source.candidates : (existing && existing.candidates));
  if (candidates.length === 0) {
    throw new Error("at least one candidate is required");
  }
  const limits = sanitizeRouteLimits(source.limits !== undefined ? source.limits : (existing && existing.limits));
  return { name, description: description.slice(0, 200), strategy, candidates, limits };
}

/** @param {object} profile @returns {object} */
export function sanitizeProfileInput(profile) {
  return {
    name: String(profile.name || "").trim(),
    description: profile.description ? String(profile.description) : "",
    defaultModel: String(profile.defaultModel || "").trim()
  };
}

/** @param {*} value @returns {object} */
export function sanitizeRouteLimits(value) {
  if (value == null || value === "") return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("limits must be an object");
  }
  const raw = value.dailyRequests;
  if (raw === null || raw === undefined || raw === "") return { dailyRequests: null };
  const numberValue = Math.floor(Number(raw));
  if (!Number.isFinite(numberValue) || numberValue < 1) {
    throw new Error("limits.dailyRequests must be a positive integer or null");
  }
  return { dailyRequests: numberValue };
}

/** @param {*} value @param {object} provider @returns {object|null} */
export function sanitizeBalanceEndpoint(value, provider) {
  if (value == null || value === "" || value === false) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("balanceEndpoint must be an object");
  if (!value.url) return null;
  const candidate = {
    url: String(value.url).trim(),
    method: String(value.method || "GET").toUpperCase(),
    useKey: value.useKey !== false,
    fieldMap: value.fieldMap && typeof value.fieldMap === "object" && !Array.isArray(value.fieldMap) ? value.fieldMap : undefined
  };
  const headers = sanitizeSafeHeaders(value.headers, "balanceEndpoint.headers");
  if (headers && Object.keys(headers).length > 0) candidate.headers = headers;
  const guard = guardBalanceEndpoint(candidate, provider);
  if (!guard.ok) throw new Error(guard.message || guard.error);
  return candidate;
}

/** @param {*} value @param {string} fieldName @returns {object|null} */
export function sanitizeSafeHeaders(value, fieldName) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error(`${fieldName} must be an object`);
  const result = {};
  const forbidden = ["authorization", "cookie", "token", "secret", "password", "apikey", "api_key"];
  const allowed = new Set(["accept", "accept-language", "user-agent"]);
  for (const [name, raw] of Object.entries(value)) {
    const lowered = String(name).toLowerCase().trim();
    if (!lowered) continue;
    if (forbidden.some((word) => lowered.includes(word))) {
      throw new Error(`${fieldName}.${name} is not allowed; put secrets in .env or Web Key manager`);
    }
    if (!allowed.has(lowered) && !lowered.startsWith("x-custom-")) {
      throw new Error(`${fieldName}.${name} is not allowed; use accept, accept-language, user-agent or x-custom-*`);
    }
    if (raw == null) continue;
    result[lowered] = String(raw).slice(0, 500);
  }
  return result;
}

/** @param {*} value @returns {string|null} */
export function normalizeKeyEnv(value) {
  if (value === null || value === undefined || value === "") return null;
  const keyEnv = String(value).trim();
  if (!keyEnv) return null;
  if (looksLikeRealApiKey(keyEnv)) {
    throw new Error("keyEnv 要填环境变量名，不是 API Key；检测到像真实 Key 的内容，请到 API Key 管理里添加");
  }
  if (!/^[A-Z_][A-Z0-9_]*$/.test(keyEnv)) {
    throw new Error("keyEnv 要填环境变量名，例如 DEEPSEEK_API_KEYS；不要在这里粘贴真实 API Key，真实 Key 请到 API Key 管理里添加");
  }
  return keyEnv;
}

/** @param {*} value @returns {boolean} */
export function looksLikeRealApiKey(value) {
  return /^(sk-|sk-ant-|sk-or-|AIza|gsk-|pplx-|xai-|co-|claude-|hf_|ghp_|github_pat_)[A-Za-z0-9._:/-]{8,}/.test(String(value || "").trim());
}

/** @param {*} value @returns {Array<{provider: string, model: string, weight: number}>} */
export function parseCandidateList(value) {
  if (!Array.isArray(value)) throw new Error("candidates must be an array");
  const result = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("candidate #" + (index + 1) + " must be an object");
    }
    const provider = String(raw.provider || "").trim();
    const model = String(raw.model || "").trim();
    if (!provider) throw new Error("candidate #" + (index + 1) + " missing provider");
    if (!model) throw new Error("candidate #" + (index + 1) + " missing model");
    let weight = 1;
    if (raw.weight !== undefined && raw.weight !== null && raw.weight !== "") {
      const numberValue = Math.floor(Number(raw.weight));
      if (!Number.isFinite(numberValue) || numberValue < 1) {
        throw new Error("candidate #" + (index + 1) + " weight must be a positive integer");
      }
      weight = numberValue;
    }
    result.push({ provider, model, weight });
  }
  return result;
}

/** @param {*} value @returns {string[]} */
export function parseModelList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** @param {string} providerName @param {object} config @param {object} secretStore @returns {Array<{type: string, name?: string, model?: string, count?: number, defaultModel?: string}>} */
export function collectProviderReferences(providerName, config, secretStore) {
  const refs = [];
  const provider = config.providers.find((item) => item.name === providerName);
  const providerModels = new Set(provider?.models || []);
  if (config.defaultProvider === providerName) refs.push({ type: "defaultProvider", name: providerName });
  for (const route of config.routes) {
    for (const candidate of route.candidates || []) {
      if (candidate.provider === providerName) {
        refs.push({ type: "route", name: route.name, model: candidate.model });
      }
    }
  }
  for (const profile of config.profiles) {
    const explicit = String(profile.defaultModel || "").startsWith(`${providerName}:`);
    const directModel = providerModels.has(profile.defaultModel);
    if (explicit || directModel) {
      refs.push({ type: "profile", name: profile.name, defaultModel: profile.defaultModel });
    }
  }
  const webKeys = secretStore.list({ provider: providerName });
  if (webKeys.length > 0) refs.push({ type: "webKeys", count: webKeys.length });
  return refs;
}

/** @param {string} routeName @param {object} config @returns {Array<{type: string, name: string}>} */
export function collectRouteReferences(routeName, config) {
  const refs = [];
  for (const profile of config.profiles) {
    if (profile.defaultModel === routeName) {
      refs.push({ type: "profile", name: profile.name });
    }
  }
  return refs;
}

/** @param {string} url @returns {string|null} */
export function providerNameFromUrl(url) {
  const after = url.slice("/admin/providers/".length);
  return after ? decodeURIComponent(after.split("?")[0]).trim() : null;
}

/** @param {string} url @returns {string|null} */
export function routeNameFromUrl(url) {
  const after = url.slice("/admin/routes/".length);
  return after ? decodeURIComponent(after.split("?")[0]).trim() : null;
}

/** @param {string} url @returns {string|null} */
export function keyIdFromUrl(url) {
  const after = url.slice("/admin/keys/".length);
  const slash = after.indexOf("/");
  if (slash < 0) return after ? decodeURIComponent(after) : null;
  return decodeURIComponent(after.slice(0, slash));
}

/** @param {string} url @returns {string|null} */
export function providerNameFromKeyUrl(url) {
  const after = url.slice("/admin/providers/".length);
  const suffix = "/keys";
  if (!after.endsWith(suffix)) return null;
  return decodeURIComponent(after.slice(0, -suffix.length)).trim();
}

/** @param {Array} webKeys @returns {object} */
export function buildWebKeysByProvider(webKeys) {
  return webKeys.reduce((acc, key) => {
    if (!acc[key.provider]) acc[key.provider] = [];
    acc[key.provider].push(key);
    return acc;
  }, {});
}

/** @param {string} model @param {object} config @returns {boolean} */
export function isKnownModelRef(model, config) {
  if (!model) return false;
  if (config.profiles.some((item) => item.name === model)) return true;
  if (config.routes.some((item) => item.name === model)) return true;
  if (config.combos && config.combos.some((item) => item.name === model)) return true;
  if (config.providers.some((provider) => provider.models.includes(model))) return true;
  const explicit = model.match(/^([A-Za-z0-9_-]+):(.+)$/);
  return explicit ? config.providers.some((provider) => provider.name === explicit[1]) : false;
}
