// Pure route / model resolution helper shared by server.js and the
// dashboard route-preview panel. Kept side-effect free so it can be
// unit-tested without spinning up a real relay.
//
// Resolution order (mirrors selectRoute() in server.js):
//   1. Empty / "auto" / "default"  -> active profile's defaultModel
//   2. Matches a profile name       -> profile.defaultModel (recurse)
//   3. Matches "provider:model"     -> single-candidate synthetic route
//   4. Matches a route name         -> that route's candidates
//   5. Matches a provider's model   -> single-candidate synthetic route
//   6. Otherwise                    -> defaultProvider with raw model
//
// The returned object is consumed by the dashboard "Route preview"
// panel and by the /admin/preview-route admin endpoint. It is
// read-only: never mutates the config object.

const LOCAL_PROVIDER_NAMES = new Set([
  "ollama",
  "lm-studio",
  "vllm",
  "llama-cpp",
  "llama.cpp",
  "llamafile"
]);

function isLocalProvider(provider) {
  if (!provider) return false;
  const name = String(provider.name || "").toLowerCase();
  const baseUrl = String(provider.baseUrl || "").toLowerCase();
  return LOCAL_PROVIDER_NAMES.has(name) || baseUrl.includes("127.0.0.1") || baseUrl.includes("localhost") || baseUrl.includes("[::1]");
}

function resolveActiveProfile(config, activeProfileName) {
  const profiles = Array.isArray(config.profiles) ? config.profiles : [];
  if (!profiles.length) return null;
  return profiles.find((profile) => profile.name === activeProfileName) || profiles[0];
}

function normalizeRequestedModel(model, config, activeProfileName) {
  const requested = String(model || "").trim();
  if (requested && requested !== "auto" && requested !== "default") return requested;
  const profile = resolveActiveProfile(config, activeProfileName);
  return profile?.defaultModel || requested;
}

function withHints(provider, webKeyCounts, healthByProvider) {
  if (!provider) return null;
  return {
    ...provider,
    webKeyCount: webKeyCounts[provider.name] || 0,
    health: healthByProvider[provider.name] || null
  };
}

function decorateCandidate(candidate, provider) {
  if (!provider) {
    return {
      provider: candidate.provider,
      model: candidate.model,
      weight: candidate.weight || 1,
      available: false,
      local: false,
      apiFormat: null,
      baseUrl: null,
      allowInsecureHttp: false,
      insecureHttpRisk: false,
      keyCount: 0,
      webKeyCount: 0,
      keyAvailable: false,
      hasHealth: false,
      healthOk: null,
      healthError: null
    };
  }
  return {
    provider: provider.name,
    model: candidate.model,
    weight: candidate.weight || 1,
    available: true,
    local: isLocalProvider(provider),
    apiFormat: provider.apiFormat || "openai",
    baseUrl: provider.baseUrl,
    allowInsecureHttp: provider.allowInsecureHttp === true,
    insecureHttpRisk: provider.allowInsecureHttp === true && String(provider.baseUrl).startsWith("http://") && !isLocalProvider(provider),
    keyCount: typeof provider.keyCount === "number" ? provider.keyCount : 0,
    webKeyCount: typeof provider.webKeyCount === "number" ? provider.webKeyCount : 0,
    keyAvailable: isLocalProvider(provider) || (provider.keyCount || 0) > 0 || (provider.webKeyCount || 0) > 0,
    hasHealth: Boolean(provider.health),
    healthOk: provider.health ? provider.health.ok === true : null,
    healthError: provider.health ? (provider.health.error || null) : null
  };
}

function summarize(candidates) {
  return {
    total: candidates.length,
    localCount: candidates.filter((candidate) => candidate.local).length,
    cloudCount: candidates.filter((candidate) => !candidate.local).length,
    needsKeyCount: candidates.filter((candidate) => !candidate.local && !candidate.keyAvailable).length,
    insecureRiskCount: candidates.filter((candidate) => candidate.insecureHttpRisk).length,
    failedHealthCount: candidates.filter((candidate) => candidate.hasHealth && !candidate.healthOk).length
  };
}

export function resolveRoutePreview(config, activeProfileName, requestedModel, options = {}) {
  const webKeyCounts = options.webKeyCounts || {};
  const healthByProvider = options.healthByProvider || {};
  const requested = String(requestedModel || "");
  const normalized = normalizeRequestedModel(requestedModel, config, activeProfileName);
  const activeProfile = resolveActiveProfile(config, activeProfileName)?.name || null;

  // 1. Profile name -> resolve through the profile's defaultModel.
  // Profile names take precedence over route names, matching
  // selectRoute() in server.js.
  const profile = resolveActiveProfile(config, activeProfileName);
  if (profile && profile.name === normalized) {
    return resolveRoutePreview(config, activeProfileName, profile.defaultModel, options);
  }

  // 2. Explicit "provider:model" form. If the provider is missing,
  //    mirror selectRoute() in server.js and return no_resolution;
  //    callers (handleChatCompletions) reject these with 400
  //    provider_not_found rather than silently falling through.
  const explicit = String(normalized).match(/^([A-Za-z0-9_-]+):(.+)$/);
  if (explicit) {
    const provider = (config.providers || []).find((item) => item.name === explicit[1]);
    if (provider) {
      const candidates = [decorateCandidate({ provider: provider.name, model: explicit[2], weight: 1 }, withHints(provider, webKeyCounts, healthByProvider))];
      return {
        ok: true,
        requested,
        normalized,
        activeProfile,
        kind: "explicit",
        profileName: null,
        routeName: normalized,
        strategy: "fallback",
        strategyHint: "explicit provider:model",
        candidates,
        summary: summarize(candidates)
      };
    }
    return {
      ok: false,
      error: "no_resolution",
      requested,
      normalized,
      activeProfile,
      kind: "explicit",
      reason: `explicit form requested provider "${explicit[1]}" which is not configured`
    };
  }

  // 3. Combo name (0.4.0)
  const namedCombo = (config.combos || []).find((combo) => combo.name === normalized);
  if (namedCombo) {
    const candidates = (namedCombo.candidates || []).map((candidate) => {
      const provider = (config.providers || []).find((item) => item.name === candidate.provider);
      return decorateCandidate(candidate, withHints(provider, webKeyCounts, healthByProvider));
    });
    return {
      ok: true,
      requested,
      normalized,
      activeProfile,
      kind: "combo",
      profileName: null,
      routeName: namedCombo.name,
      strategy: namedCombo.strategy || "fallback",
      strategyHint: "named combo",
      candidates,
      summary: summarize(candidates)
    };
  }

  // 4. Route name
  const namedRoute = (config.routes || []).find((route) => route.name === normalized);
  if (namedRoute) {
    const candidates = (namedRoute.candidates || []).map((candidate) => {
      const provider = (config.providers || []).find((item) => item.name === candidate.provider);
      return decorateCandidate(candidate, withHints(provider, webKeyCounts, healthByProvider));
    });
    return {
      ok: true,
      requested,
      normalized,
      activeProfile,
      kind: "route",
      profileName: null,
      routeName: namedRoute.name,
      strategy: namedRoute.strategy || "fallback",
      strategyHint: "named route",
      candidates,
      summary: summarize(candidates)
    };
  }

  // 4. Provider's configured model list
  const matchedProvider = (config.providers || []).find((provider) => Array.isArray(provider.models) && provider.models.includes(normalized));
  if (matchedProvider) {
    const candidates = [decorateCandidate({ provider: matchedProvider.name, model: normalized, weight: 1 }, withHints(matchedProvider, webKeyCounts, healthByProvider))];
    return {
      ok: true,
      requested,
      normalized,
      activeProfile,
      kind: "provider_model",
      profileName: null,
      routeName: normalized,
      strategy: "fallback",
      strategyHint: "matches a configured provider model",
      candidates,
      summary: summarize(candidates)
    };
  }

  // 5. Default provider fallback (last resort)
  const fallback = (config.providers || []).find((provider) => provider.name === config.defaultProvider);
  if (fallback) {
    const candidates = [decorateCandidate({ provider: fallback.name, model: normalized, weight: 1 }, withHints(fallback, webKeyCounts, healthByProvider))];
    return {
      ok: true,
      requested,
      normalized,
      activeProfile,
      kind: "default_provider",
      profileName: null,
      routeName: normalized,
      strategy: "fallback",
      strategyHint: "falls back to defaultProvider",
      candidates,
      summary: summarize(candidates)
    };
  }

  return {
    ok: false,
    error: "no_resolution",
    requested,
    normalized,
    activeProfile,
    reason: "no provider matches the requested model and no defaultProvider is set"
  };
}
