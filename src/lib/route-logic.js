const V1_PROXY_PATHS = new Set([
  "/v1/chat/completions",
  "/v1/responses",
  "/v1/messages"
]);

import { findCombo, resolveComboRoute } from "../combo.js";

/**
 * @typedef {Object} RouteCandidate
 * @property {object} provider - Provider configuration object
 * @property {string} model - Model name
 * @property {number} weight - Candidate weight for weighted strategies
 * @property {boolean} [enabled] - Whether the candidate is enabled
 * @property {number} [priority] - Candidate priority
 */

/**
 * @typedef {Object} ResolvedRoute
 * @property {string} name - Route name
 * @property {string} strategy - Routing strategy (fallback, round_robin, weighted, weighted_round_robin)
 * @property {object} limits - Route limits configuration
 * @property {RouteCandidate[]} candidates - Array of route candidates
 * @property {object} [combo] - Combo configuration if this is a combo route
 */

/**
 * @typedef {Object} RouteRuntimeState
 * @property {number} roundRobinIndex - Current round-robin index
 * @property {number} weightedCursor - Current weighted strategy cursor
 */

/**
 * @typedef {Object} ProviderHealthStatus
 * @property {boolean} healthy - Whether the provider is healthy
 * @property {string} [error] - Error message if unhealthy
 */

/**
 * Resolves a model name to a route configuration.
 * Checks model aliases, combos, profiles, explicit provider:model,
 * named routes, direct model matches, and default provider fallback.
 * @param {string} model - Requested model name
 * @param {object} config - Full configuration object
 * @param {string} activeProfile - Currently active profile name
 * @param {object} [providerHealth] - Provider health tracker instance
 * @param {Map<string, RouteRuntimeState>} [routeRuntime] - Route runtime state map
 * @returns {ResolvedRoute|null} Resolved route object or null if no match found
 */
export function selectRoute(model, config, activeProfile, providerHealth, routeRuntime) {
  const rawModel = normalizeRequestedModel(model, config, activeProfile);

  // 0.1.3: Check modelAliases first — allows admin-defined aliases to
  // override route matching (e.g. "gpt-4" → "openai:gpt-4o-mini")
  const aliased = resolveModelAlias(rawModel, config);
  if (aliased !== rawModel) {
    return selectRoute(aliased, config, activeProfile, providerHealth, routeRuntime);
  }

  // Combo check (0.4.0): virtual model name combining multiple providers
  const combo = findCombo(rawModel, config);
  if (combo) {
    return resolveComboRoute(combo, config, providerHealth, routeRuntime);
  }

  const profile = config.profiles.find((item) => item.name === rawModel);
  if (profile) {
    return selectRoute(profile.defaultModel, config, activeProfile, providerHealth, routeRuntime);
  }
  const explicit = rawModel.match(/^([A-Za-z0-9_-]+):(.+)$/);
  if (explicit) {
    const provider = config.providers.find((item) => item.name === explicit[1]);
    return provider
      ? {
          name: rawModel,
          strategy: "fallback",
          limits: {},
          candidates: [{ provider, model: explicit[2], weight: 1 }]
        }
      : null;
  }
  const namedRoute = config.routes.find((route) => route.name === rawModel);
  if (namedRoute) {
    return {
      name: namedRoute.name,
      strategy: namedRoute.strategy,
      limits: namedRoute.limits || {},
      candidates: namedRoute.candidates.map((candidate) => ({
        provider: config.providers.find((provider) => provider.name === candidate.provider),
        model: candidate.model,
        weight: candidate.weight || 1
      }))
    };
  }
  const matched = config.providers.find((provider) => provider.models.includes(rawModel));
  if (matched) {
    return {
      name: rawModel,
      strategy: "fallback",
      limits: {},
      candidates: [{ provider: matched, model: rawModel, weight: 1 }]
    };
  }
  const fallback = config.providers.find((provider) => provider.name === config.defaultProvider);
  return fallback
    ? {
        name: rawModel,
        strategy: "fallback",
        limits: {},
        candidates: [{ provider: fallback, model: rawModel, weight: 1 }]
      }
    : null;
}

/**
 * @param {string} model
 * @param {object} config
 * @returns {string}
 */
export function normalizeRequestedModel(model, config, activeProfile) {
  const requested = String(model || "").trim();
  if (requested && requested !== "auto" && requested !== "default") return requested;
  const profile = resolveActiveProfile(activeProfile, config);
  return profile?.defaultModel || requested;
}

/**
 * Resolves a model name through the modelAliases map.
 * If the model name is a key in config.modelAliases, returns the alias target.
 * Otherwise returns the original model name unchanged.
 * Supports recursive aliasing (alias → alias → target) with depth limit.
 * @param {string} model
 * @param {object} config
 * @returns {string}
 */
export function resolveModelAlias(model, config) {
  const aliases = config.modelAliases;
  if (!aliases || typeof aliases !== "object") return model;
  let current = model;
  const seen = new Set();
  seen.add(current);
  for (let i = 0; i < 5; i++) {
    const next = aliases[current];
    if (!next || typeof next !== "string") return current;
    if (seen.has(next)) return current; // circular
    seen.add(next);
    current = next;
  }
  return current;
}

/**
 * @param {object} route
 * @param {import("../provider-health.js").ProviderHealthTracker} providerHealth
 * @param {Map} routeRuntime
 * @returns {Array}
 */
export function orderCandidates(route, providerHealth, routeRuntime) {
  const candidates = route.candidates.filter((candidate) => candidate.provider);
  if (candidates.length <= 1) return candidates;
  if (route.combo) {
    return candidates;
  }
  const { healthy, unhealthy } = splitHealthyCandidates(candidates, providerHealth);
  if (healthy.length === 0) return unhealthy;
  if (unhealthy.length === 0) return applyRouteStrategy(healthy, route, routeRuntime);
  const orderedHealthy = applyRouteStrategy(healthy, route, routeRuntime);
  return [...orderedHealthy, ...unhealthy];
}

/**
 * @param {Array} candidates
 * @param {import("../provider-health.js").ProviderHealthTracker} providerHealth
 * @returns {{ healthy: Array, unhealthy: Array }}
 */
export function splitHealthyCandidates(candidates, providerHealth) {
  // Guard: when providerHealth is not available, treat all candidates as healthy
  if (!providerHealth || typeof providerHealth.isUnhealthy !== "function") {
    return { healthy: candidates, unhealthy: [] };
  }
  const healthy = [];
  const unhealthy = [];
  for (const candidate of candidates) {
    if (providerHealth.isUnhealthy(candidate.provider.name)) {
      unhealthy.push(candidate);
    } else {
      healthy.push(candidate);
    }
  }
  return { healthy, unhealthy };
}

/**
 * @param {Array} candidates
 * @param {object} route
 * @param {Map} routeRuntime
 * @returns {Array}
 */
export function applyRouteStrategy(candidates, route, routeRuntime) {
  if (route.strategy === "fallback") return candidates;
  if (candidates.length <= 1) return candidates;
  const state = getRouteState(route.name, routeRuntime);
  if (route.strategy === "round_robin") {
    const index = state.roundRobinIndex % candidates.length;
    state.roundRobinIndex += 1;
    return rotateCandidates(candidates, index);
  }
  if (route.strategy === "weighted" || route.strategy === "weighted_round_robin") {
    const totalWeight = candidates.reduce((sum, candidate) => sum + Math.max(1, candidate.weight || 1), 0);
    const cursor = (state.weightedCursor % totalWeight) + 1;
    state.weightedCursor += 1;
    let running = 0;
    const selectedIndex = candidates.findIndex((candidate) => {
      running += Math.max(1, candidate.weight || 1);
      return cursor <= running;
    });
    return rotateCandidates(candidates, Math.max(0, selectedIndex));
  }
  return candidates;
}

/**
 * @param {Array} candidates
 * @param {number} startIndex
 * @returns {Array}
 */
export function rotateCandidates(candidates, startIndex) {
  return [...candidates.slice(startIndex), ...candidates.slice(0, startIndex)];
}

/**
 * @param {string} routeName
 * @param {Map} routeRuntime
 * @returns {{ roundRobinIndex: number, weightedCursor: number }}
 */
export function getRouteState(routeName, routeRuntime) {
  if (!routeRuntime.has(routeName)) {
    routeRuntime.set(routeName, { roundRobinIndex: 0, weightedCursor: 0 });
  }
  return routeRuntime.get(routeName);
}

/**
 * @returns {Set<string>}
 */
export function buildProxyV1ProxyPaths() {
  return new Set(V1_PROXY_PATHS);
}

/**
 * @param {string} url
 * @returns {boolean}
 */
export function isProxyPath(url) {
  if (!url) return false;
  const path = String(url).split("?", 1)[0];
  return V1_PROXY_PATHS.has(path);
}

/**
 * @param {object} provider
 * @param {Set<string>} localProviderNames
 * @returns {boolean}
 */
export function isLocalProvider(provider, localProviderNames) {
  const name = String(provider?.name || "").toLowerCase();
  const baseUrl = String(provider?.baseUrl || "").toLowerCase();
  return localProviderNames.has(name) ||
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("[::1]");
}

/**
 * @param {string} kind
 * @param {string} name
 * @param {number|null} limit
 * @param {import("../usage.js").UsageTracker} usage
 * @returns {boolean}
 */
export function isLimitExceeded(kind, name, limit, usage) {
  usage.resetIfNeeded();
  if (!limit) return false;
  return (usage.current().daily[kind][name] || 0) >= limit;
}

/**
 * @param {string} routeName
 * @param {object} config
 * @returns {number|null}
 */
export function getRouteDailyLimit(routeName, config) {
  const route = config.routes.find((item) => item.name === routeName);
  return route?.limits?.dailyRequests || config.limits.routes[routeName]?.dailyRequests || config.limits.dailyRequests;
}

/**
 * Resolves daily limit for any route-like object (route or combo).
 * Checks the route object's own limits first, then global limits.
 * @param {object} route
 * @returns {number|null}
 */
export function getResolvedRouteDailyLimit(route) {
  if (route?.limits?.dailyRequests) return route.limits.dailyRequests;
  return null;
}

/**
 * @param {string} providerName
 * @param {object} config
 * @returns {number|null}
 */
export function getProviderDailyLimit(providerName, config) {
  return config.limits.providers[providerName]?.dailyRequests || config.limits.dailyRequests;
}

/**
 * @param {string} providerName
 * @param {string} model
 * @param {object} config
 * @returns {number|null}
 */
export function getModelDailyLimit(providerName, model, config) {
  return config.limits.models?.[`${providerName}:${model}`]?.dailyRequests
    || config.limits.models?.[model]?.dailyRequests
    || config.limits.dailyRequests;
}

/**
 * @param {object} config
 * @param {string} activeProfile
 * @param {object} stats
 * @param {import("../usage.js").UsageTracker} usage
 * @param {object} healthCache
 * @param {object} modelDiscoveryCache
 * @param {object} balanceCache
 * @param {Array} recentErrors
 * @param {import("../provider-health.js").ProviderHealthTracker} providerHealth
 * @param {import("../key-pool.js").KeyPool} keyPool
 * @param {import("../secret-store.js").SecretStore} secretStore
 * @param {string} packageVersion
 * @param {string} configPath
 * @param {string} statePath
 * @param {object} relayAuth
 * @param {Function} getProviderKeys
 * @param {Function} describeAuth
 * @param {Array} PROVIDER_TEMPLATES
 * @param {Array} ROUTE_TEMPLATES
 * @param {Set<string>} localProviderNames
 * @returns {object}
 */
export function buildStatus(
  config,
  activeProfile,
  stats,
  usage,
  healthCache,
  modelDiscoveryCache,
  balanceCache,
  recentErrors,
  providerHealth,
  keyPool,
  secretStore,
  packageVersion,
  configPath,
  statePath,
  relayAuth,
  getProviderKeys,
  describeAuth,
  PROVIDER_TEMPLATES,
  ROUTE_TEMPLATES,
  localProviderNames
) {
  usage.resetIfNeeded();
  return {
    ok: true,
    version: packageVersion,
    startedAt: stats.startedAt,
    configPath,
    statePath,
    providers: config.providers.map((provider) => ({
      name: provider.name,
      displayName: provider.displayName || "",
      baseUrl: provider.baseUrl,
      apiFormat: provider.apiFormat,
      keyEnv: provider.keyEnv,
      allowInsecureHttp: provider.allowInsecureHttp === true,
      insecureHttpRisk: provider.allowInsecureHttp === true && String(provider.baseUrl).startsWith("http://") && !isLocalProvider(provider, localProviderNames),
      local: isLocalProvider(provider, localProviderNames),
      healthHint: providerHealthHint(provider, localProviderNames),
      keyCount: getProviderKeys(provider).length,
      models: provider.models,
      extraHeaders: provider.extraHeaders || null,
      balanceEndpoint: provider.balanceEndpoint || null
    })),
    routes: config.routes.map((route) => ({
      name: route.name,
      description: route.description || "",
      strategy: route.strategy,
      limits: route.limits || {},
      candidates: route.candidates
    })),
    routeReferences: Object.fromEntries(config.routes.map((route) => [route.name, collectRouteReferences(route.name, config)])),
    routeTemplates: ROUTE_TEMPLATES.map((item) => JSON.parse(JSON.stringify(item))),
    profiles: profileSummary(config, activeProfile),
    stats,
    usage: usageSummary(usage, config),
    healthCache,
    modelDiscoveryCache,
    balanceCache,
    recentErrors,
    providerHealth: providerHealth.summary(),
    healthChecks: {
      enabled: config.healthChecks.enabled,
      intervalMinutes: config.healthChecks.intervalMinutes,
      providers: config.healthChecks.providers
    },
    keys: keyPool.summary(),
    webKeys: secretStore.list(),
    secretStore: {
      masterKeyOnDisk: secretStore.hasMasterKeyOnDisk(),
      masterKeyInEnv: secretStore.hasMasterKeyInEnv()
    },
    providerTemplates: PROVIDER_TEMPLATES.map((item) => ({ ...item })),
    relayAuth: describeAuth(relayAuth)
  };
}

/**
 * @param {string} routeName
 * @param {object} config
 * @returns {Array}
 */
function collectRouteReferences(routeName, config) {
  const refs = [];
  for (const profile of config.profiles) {
    if (profile.defaultModel === routeName) {
      refs.push({ type: "profile", name: profile.name });
    }
  }
  return refs;
}

/**
 * @param {object} stats
 * @param {string} packageVersion
 * @returns {object}
 */
export function buildHealth(stats, packageVersion) {
  return {
    ok: true,
    startedAt: stats.startedAt,
    version: packageVersion
  };
}

/**
 * @param {object} config
 * @param {string} activeProfile
 * @returns {object}
 */
export function profileSummary(config, activeProfile) {
  const active = resolveActiveProfile(activeProfile, config);
  return {
    activeProfile: active?.name || null,
    defaultModel: active?.defaultModel || null,
    profiles: config.profiles.map((profile) => ({
      ...profile,
      active: profile.name === active?.name
    }))
  };
}

/**
 * @param {string} name
 * @param {object} config
 * @returns {object|null}
 */
export function resolveActiveProfile(name, config) {
  if (!config.profiles.length) return null;
  return config.profiles.find((profile) => profile.name === name) || config.profiles[0];
}

/**
 * @param {*} value
 * @returns {string|null}
 */
export function extractActiveProfileName(value) {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "object" && typeof value.name === "string") return value.name.trim() || null;
  return null;
}

/**
 * @param {import("../usage.js").UsageTracker} usage
 * @param {object} config
 * @returns {object}
 */
export function usageSummary(usage, config) {
  usage.resetIfNeeded();
  return {
    day: usage.day(),
    daily: usage.current().daily,
    history: usage.summary(config.history.retentionDays).history,
    historyDays: config.history.retentionDays,
    runtime: usage.current().runtime,
    metrics: usage.metrics(),
    limits: {
      dailyRequests: config.limits.dailyRequests,
      routes: config.limits.routes,
      providers: config.limits.providers,
      models: config.limits.models
    }
  };
}

/**
 * @param {object} provider
 * @param {Set<string>} localProviderNames
 * @returns {string}
 */
export function providerHealthHint(provider, localProviderNames) {
  if (!isLocalProvider(provider, localProviderNames)) {
    return "云端或远程 provider：连通测试可能消耗上游额度，请只在需要时手动触发。";
  }
  return "本地 provider：如果连通测试失败，通常是 Ollama、LM Studio、vLLM 或 llama.cpp 服务未启动，或端口/baseURL 不一致。";
}

/**
 * @param {*} value
 * @returns {Array<string>}
 */
export function extractModelIds(value) {
  const data = Array.isArray(value?.data) ? value.data : Array.isArray(value?.models) ? value.models : [];
  return data
    .map((item) => (typeof item === "string" ? item : item?.id || item?.name || ""))
    .map((item) => String(item).trim())
    .filter(Boolean)
    .slice(0, 500);
}

/**
 * @param {object} payload
 * @returns {boolean}
 */
export function isStreamRequested(payload) {
  if (!payload || typeof payload !== "object") return false;
  const value = payload.stream;
  return value === true || value === 1 || value === "true";
}

/**
 * @param {import("node:http").IncomingMessage} req
 * @param {Array<string>} supportedLocales
 * @param {string} defaultLocale
 * @returns {string}
 */
export function getLocale(req, supportedLocales, defaultLocale) {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    const queryLang = url.searchParams.get("lang");
    if (queryLang && supportedLocales.includes(queryLang)) return queryLang;
    const cookieHeader = req.headers.cookie || "";
    for (const part of cookieHeader.split(/;\s*/)) {
      const eq = part.indexOf("=");
      if (eq <= 0) continue;
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name === "OPENRELAY_LOCALE" && supportedLocales.includes(value)) return value;
    }
  } catch {
    // Fall through to default.
  }
  return defaultLocale;
}
