import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeLocalConnectorConsents } from "./local-connector-consent-approval.js";

// 0.5.1: when running as a `bun build --compile` binary, the
// bundled code does not have a meaningful import.meta.url. The
// project root for the binary is the directory that contains the
// exe itself, so .env / config.json / data/ live next to the
// binary. detectRuntimeRootDir() returns that directory when
// called from the binary, and falls back to the explicit rootDir
// otherwise.
export function detectRuntimeRootDir(explicitRootDir) {
  if (explicitRootDir) return explicitRootDir;
  if (process.env.OPENRELAY_ROOT) return process.env.OPENRELAY_ROOT;
  // If we're running as a single-file binary, process.execPath
  // points at the bundled exe. Use its parent dir as the root.
  // The exe name is openrelay-<os>-<arch> (or openrelay-windows-x64.exe).
  if (process.execPath && /openrelay[-_](?:local|safe|windows|darwin|linux)[-_]/i.test(process.execPath)) {
    return dirname(process.execPath);
  }
  // Source-tree form: import.meta.url is a file:// URL; use
  // fileURLToPath to avoid the Windows "/D:/foo" drive-doubling
  // pitfall of URL.pathname + resolve.
  try {
    if (typeof import.meta !== "undefined" && import.meta.url) {
      const here = fileURLToPath(import.meta.url);
      return resolve(dirname(here), "..");
    }
  } catch {
    // ignore
  }
  return process.cwd();
}

export function loadDotEnv(rootDir) {
  const envPath = resolve(rootDir, ".env");
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf8");
  // 0.6.2: two-pass parse so duplicate keys follow POSIX-style
  // "last write wins" semantics. The 0.5.x single-pass logic
  // set process.env on the FIRST occurrence of a key and
  // skipped subsequent ones, which silently lost a real
  // override when the project shipped a template that
  // pre-declared the same key as an empty placeholder
  // (e.g. `RELAY_TOKEN=` near the top of `.env.example`).
  // Pass 1 collects every `KEY=VALUE` assignment in source
  // order. Pass 2 applies them in order, so the final
  // occurrence wins. process.env values that are already
  // defined (e.g. inherited from the parent shell) still
  // take precedence over `.env` — the script's job is only
  // to fill in defaults the operator did not set.
  const assignments = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    assignments.push({ key, value: stripEnvQuotes(rawValue.trim()) });
  }
  // Track which keys we successfully assigned to process.env.
  // A subsequent occurrence of the same key in .env is always
  // applied (last write wins). A key that the parent shell
  // already set is never overwritten — that is the standard
  // "shell wins, .env fills in defaults" contract. We must
  // NOT skip the file-side overwrite for an already-blocked
  // key: if the parent shell pre-set the value, we leave
  // process.env alone for EVERY occurrence, not just the
  // first. Otherwise an empty placeholder (`FOO=`) in the
  // middle of the file would silently win over the shell
  // value on its second occurrence.
  const envSetByDotEnv = new Set();
  for (const { key, value } of assignments) {
    if (!envSetByDotEnv.has(key) && process.env[key] !== undefined) {
      // Parent shell precedence: skip this key entirely.
      // Do NOT mark envSetByDotEnv, so a later occurrence is
      // also skipped (consistent parent-wins behavior).
      continue;
    }
    process.env[key] = value;
    envSetByDotEnv.add(key);
  }
}

export function loadConfig(rootDir) {
  const customEnv = process.env.RELAYFORGE_CONFIG || process.env.OPENRELAY_CONFIG;
  const customPath = customEnv ? resolve(rootDir, customEnv) : resolve(rootDir, "config.json");
  const fallbackPath = resolve(rootDir, "config.example.json");
  const configPath = existsSync(customPath) ? customPath : fallbackPath;
  const config = normalizeConfig(JSON.parse(readFileSync(configPath, "utf8")));

  return { config, configPath };
}

export function normalizeConfig(config) {
  if (!Array.isArray(config.providers) || config.providers.length === 0) {
    throw new Error("config.providers must contain at least one provider");
  }

  const providerNames = new Set();
  for (const provider of config.providers) {
    if (!provider.name || !provider.baseUrl) {
      throw new Error("each provider needs name and baseUrl");
    }
    if (providerNames.has(provider.name)) {
      throw new Error(`duplicate provider name: ${provider.name}`);
    }
    providerNames.add(provider.name);
    provider.baseUrl = provider.baseUrl.replace(/\/+$/, "");
    provider.allowInsecureHttp = provider.allowInsecureHttp === true;
    validateProviderBaseUrl(provider.baseUrl, provider.allowInsecureHttp, provider.name);
    provider.apiFormat = provider.apiFormat || "openai";
    if (!["openai", "anthropic"].includes(provider.apiFormat)) {
      throw new Error(`unsupported apiFormat for provider ${provider.name}: ${provider.apiFormat}`);
    }
    provider.models = Array.isArray(provider.models) ? provider.models : [];
  }

  if (!config.defaultProvider) {
    config.defaultProvider = config.providers[0].name;
  }
  if (!providerNames.has(config.defaultProvider)) {
    throw new Error(`defaultProvider not found: ${config.defaultProvider}`);
  }

  config.routes = Array.isArray(config.routes) ? config.routes : [];
  const routeNames = new Set();
  for (const route of config.routes) {
    if (!route.name || !Array.isArray(route.candidates) || route.candidates.length === 0) {
      throw new Error("each route needs name and at least one candidate");
    }
    if (routeNames.has(route.name)) {
      throw new Error(`duplicate route name: ${route.name}`);
    }
    routeNames.add(route.name);
    route.strategy = normalizeRouteStrategy(route.strategy, route.name);
    route.limits = normalizeLimitBlock(route.limits);
    for (const candidate of route.candidates) {
      if (!candidate.provider || !candidate.model) {
        throw new Error(`route ${route.name} has a candidate without provider/model`);
      }
      if (!providerNames.has(candidate.provider)) {
        throw new Error(`route ${route.name} references missing provider: ${candidate.provider}`);
      }
      candidate.weight = normalizeCandidateWeight(candidate.weight, route.name);
    }
  }

  config.combos = normalizeCombos(config.combos, providerNames);

  config.modelAliases = normalizeModelAliases(config.modelAliases, config.providers, config.routes);

  config.profiles = normalizeProfiles(config.profiles, config.routes, config.providers, config.modelAliases, config.combos);
  if (!config.activeProfile) {
    config.activeProfile = config.profiles[0]?.name || null;
  }
  if (config.activeProfile && !config.profiles.some((profile) => profile.name === config.activeProfile)) {
    throw new Error(`activeProfile not found: ${config.activeProfile}`);
  }

  // 0.5.7: the 10s minimum on streamIdleTimeoutMs is a product
  // safety net (a too-aggressive idle timer will mistreat a slow
  // upstream as dead). The test suite (test-codex-compat.mjs)
  // needs a tight value to make the codex-idle-stream
  // regression deterministic, so we honor an explicit opt-in
  // that drops the floor to 1ms for callers that know what
  // they are doing. The env var is namespaced and the value is
  // gated on a normalized string compare (trim + lowercase) so a
  // stray OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT=" true" or
  // "TRUE" still works, and "" or unset does NOT lower the
  // floor. We trim explicitly because Windows `set X=Y` pads
  // the value with trailing whitespace that breaks a raw ===
  // check.
  const rawAllowShort = (process.env.OPENRELAY_TEST_ALLOW_SHORT_IDLE_TIMEOUT || "").trim().toLowerCase();
  const allowShortIdleTimeout = rawAllowShort === "true";
  config.retry = {
    maxAttempts: Math.max(1, Number(config.retry?.maxAttempts || 3)),
    cooldownMs: Math.max(1000, Number(config.retry?.cooldownMs || 30000)),
    timeoutMs: Math.max(1000, Number(config.retry?.timeoutMs || 120000)),
    streamIdleTimeoutMs: allowShortIdleTimeout
      ? Math.max(1, Number(config.retry?.streamIdleTimeoutMs || 300000))
      : Math.max(10000, Number(config.retry?.streamIdleTimeoutMs || 300000))
  };
  config.limits = {
    maxBodyBytes: Math.max(1024, Number(config.limits?.maxBodyBytes || 10485760)),
    dailyRequests: normalizeNullablePositiveInteger(config.limits?.dailyRequests),
    providers: normalizeNamedLimits(config.limits?.providers),
    routes: normalizeNamedLimits(config.limits?.routes),
    models: normalizeNamedLimits(config.limits?.models)
  };
  config.history = {
    retentionDays: Math.max(1, Math.min(365, Number(config.history?.retentionDays || 14)))
  };
  config.healthChecks = {
    enabled: config.healthChecks?.enabled === true,
    intervalMinutes: Math.max(5, Number(config.healthChecks?.intervalMinutes || 60)),
    providers: normalizeStringList(config.healthChecks?.providers)
  };
  config.localConnectorConsents = normalizeLocalConnectorConsents(config.localConnectorConsents);

  config.privacy = {
    logPrompts: config.privacy?.logPrompts === true,
    logHeaders: config.privacy?.logHeaders === true
  };

  return config;
}

export function getProviderKeys(provider) {
  if (!provider.keyEnv) return [null];
  return String(process.env[provider.keyEnv] || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function validateProviderBaseUrl(baseUrl, allowInsecureHttp = false, providerName = "provider") {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error(`provider ${providerName} baseUrl must be a valid http/https URL`);
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") {
    throw new Error(`provider ${providerName} baseUrl must use https, or http only for loopback/local model servers`);
  }
  if (isLoopbackHost(parsed.hostname)) return true;
  if (allowInsecureHttp === true) return true;
  throw new Error(`provider ${providerName} uses remote http://; use https:// or set allowInsecureHttp:true only for a trusted private upstream`);
}

export function isLoopbackHost(hostname) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
}

function stripEnvQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeRouteStrategy(value, routeName = "unknown") {
  if (value === undefined || value === null || value === "") return "fallback";
  const strategy = String(value).trim();
  if (["fallback", "round_robin", "weighted"].includes(strategy)) return strategy;
  throw new Error(`route ${routeName} has invalid strategy: ${strategy}`);
}

function normalizeCandidateWeight(value, routeName = "unknown") {
  if (value === undefined || value === null || value === "") return 1;
  const numberValue = Math.floor(Number(value));
  if (!Number.isFinite(numberValue) || numberValue < 1) {
    throw new Error(`route ${routeName} has invalid candidate weight: ${value}`);
  }
  return numberValue;
}

function normalizeNamedLimits(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [name, limit] of Object.entries(value)) {
    result[name] = normalizeLimitBlock(limit);
  }
  return result;
}

function normalizeLimitBlock(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return {
    dailyRequests: normalizeNullablePositiveInteger(value.dailyRequests)
  };
}

function normalizeNullablePositiveInteger(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Math.floor(Number(value));
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : null;
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

/**
 * Normalizes the modelAliases config section.
 * modelAliases is an optional map of alias → target:
 *   - target can be "provider:model" for direct provider routing
 *   - target can be a route name for route-based routing
 *   - target can be a profile name (resolves to profile's defaultModel)
 * @param {object|null|undefined} aliases
 * @param {Array} providers
 * @param {Array} routes
 * @returns {Record<string, string>}
 */
function normalizeModelAliases(aliases, providers, routes) {
  if (!aliases || typeof aliases !== "object" || Array.isArray(aliases)) {
    return {};
  }
  const providerNames = new Set(providers.map((p) => p.name));
  const routeNames = new Set(routes.map((r) => r.name));
  const result = {};
  for (const [alias, target] of Object.entries(aliases)) {
    const aliasTrimmed = String(alias).trim();
    const targetTrimmed = String(target).trim();
    if (!aliasTrimmed || !targetTrimmed) continue;

    // Validate target: must be a known route, known profile, or provider:model
    const isRoute = routeNames.has(targetTrimmed);
    const isProviderExplicit = /^[A-Za-z0-9_-]+:.+$/.test(targetTrimmed);
    const isProviderModel = isProviderExplicit && providerNames.has(targetTrimmed.split(":")[0]);

    if (!isRoute && !isProviderModel) {
      // If it doesn't match anything familiar, still allow it
      // (soft validation — the schema validator catches this strictly)
      result[aliasTrimmed] = targetTrimmed;
      continue;
    }
    result[aliasTrimmed] = targetTrimmed;
  }
  return result;
}

function normalizeCombos(value, providerNames) {
  if (!Array.isArray(value)) return [];
  const names = new Set();
  const result = [];
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (!c || typeof c !== "object") continue;
    const name = String(c.name || "").trim();
    if (!name) continue;
    if (names.has(name)) continue;
    names.add(name);
    const strategy = ["fallback", "round_robin", "weighted_round_robin"].includes(c.strategy) ? c.strategy : "fallback";
    const candidates = Array.isArray(c.candidates) ? c.candidates.filter((ca) => {
      if (!ca || typeof ca !== "object") return false;
      if (!ca.provider || !ca.model) return false;
      if (!providerNames.has(ca.provider)) return false;
      return ca.enabled !== false;
    }) : [];
    if (candidates.length === 0) continue;
    result.push({
      name,
      description: c.description ? String(c.description) : "",
      strategy,
      limits: normalizeLimitBlock(c.limits),
      candidates: candidates.map((ca) => ({
        provider: ca.provider,
        model: ca.model,
        weight: normalizeCandidateWeight(ca.weight, name),
        priority: typeof ca.priority === "number" ? ca.priority : 0,
        enabled: ca.enabled !== false
      }))
    });
  }
  return result;
}

function normalizeProfiles(value, routes, providers, modelAliases, combos) {
  const routeNames = new Set(routes.map((route) => route.name));
  const comboNames = new Set(combos ? combos.map((c) => c.name) : []);
  const providerNames = new Set(providers.map((provider) => provider.name));
  const providerModels = new Set(providers.flatMap((provider) => provider.models));
  const profiles = Array.isArray(value) ? value : [];
  const seen = new Set();
  const result = [];

  for (const profile of profiles) {
    if (!profile?.name || !profile.defaultModel) {
      throw new Error("each profile needs name and defaultModel");
    }
    const name = String(profile.name).trim();
    if (seen.has(name)) {
      throw new Error(`duplicate profile name: ${name}`);
    }
    seen.add(name);
    const defaultModel = String(profile.defaultModel).trim();
    if (!isKnownModelReference(defaultModel, routeNames, providerNames, providerModels, modelAliases, comboNames)) {
      throw new Error(`profile ${name} references unknown defaultModel: ${defaultModel}`);
    }
    result.push({
      name,
      description: profile.description ? String(profile.description) : "",
      defaultModel
    });
  }

  return result;
}

function isKnownModelReference(model, routeNames, providerNames, providerModels, modelAliases, comboNames) {
  if (routeNames.has(model) || providerModels.has(model) || (comboNames && comboNames.has(model))) return true;
  if (modelAliases && typeof modelAliases === "object" && modelAliases[model]) return true;
  const explicit = model.match(/^([A-Za-z0-9_-]+):(.+)$/);
  return explicit ? providerNames.has(explicit[1]) : false;
}
