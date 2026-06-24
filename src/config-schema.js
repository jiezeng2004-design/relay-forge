// Hand-rolled config.json schema validator. Returns an array of
// { path, message, expected, got } errors instead of throwing on
// the first one, so the dashboard form can highlight every bad
// field at once. Pure: no I/O, no side effects.
//
// We deliberately don't pull in ajv / zod — both add 50-200 KB
// and the project is zero-deps. The validation here is hand-coded
// for the few shapes OpenRelay Local Safe actually accepts, which
// is small and easy to audit.

const STRATEGIES = new Set(["fallback", "round_robin", "weighted", "weighted_round_robin"]);
const API_FORMATS = new Set(["openai", "anthropic"]);
const ALLOWED_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL_NAME_MAX_LENGTH = 256;
const FORBIDDEN_FIELDS = new Set([
  "apikey", "api_key", "apiKey", "token", "secret", "password", "cookie", "authorization",
  "session", "bearer", "auth", "credential", "private_key"
]);
const MAX_PROVIDERS = 100;
const MAX_ROUTES = 100;
const MAX_PROFILES = 50;
const MAX_COMBOS = 50;
const MAX_CANDIDATES_PER_ROUTE = 20;
const MAX_MODELS_PER_PROVIDER = 200;

// Validates a config object (parsed JSON) against the OpenRelay
// schema. Returns:
//   { ok: true, warnings: string[] } when valid (warnings are
//     non-fatal suggestions, e.g. "apiFormat=anthropic but no
//     Anthropic-format routes use this provider")
//   { ok: false, errors: ValidationError[] } when not.
export function validateConfig(config) {
  const errors = [];
  const warnings = [];
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    return { ok: false, errors: [{ path: "(root)", message: "config must be a JSON object", expected: "object", got: Array.isArray(config) ? "array" : typeof config }] };
  }

  // ----- top-level: providers[] -----
  if (!Array.isArray(config.providers)) {
    errors.push({ path: "providers", message: "must be an array of provider objects", expected: "array", got: typeof config.providers });
  } else if (config.providers.length === 0) {
    errors.push({ path: "providers", message: "must contain at least one provider", expected: "array.length >= 1", got: "0" });
  } else if (config.providers.length > MAX_PROVIDERS) {
    errors.push({ path: "providers", message: `too many providers (max ${MAX_PROVIDERS})`, expected: `array.length <= ${MAX_PROVIDERS}`, got: String(config.providers.length) });
  } else {
    const providerNames = new Set();
    config.providers.forEach((provider, index) => {
      const base = `providers[${index}]`;
      if (!provider || typeof provider !== "object" || Array.isArray(provider)) {
        errors.push({ path: base, message: "must be an object", expected: "object", got: typeof provider });
        return;
      }
      if (typeof provider.name !== "string" || !provider.name.trim()) {
        errors.push({ path: `${base}.name`, message: "must be a non-empty string", expected: "string", got: typeof provider.name });
      } else if (!NAME_PATTERN.test(provider.name)) {
        errors.push({ path: `${base}.name`, message: "must contain only letters, numbers, underscore, or dash (1-64 chars)", expected: "matching ^[A-Za-z0-9_-]{1,64}$", got: provider.name });
      } else if (providerNames.has(provider.name)) {
        errors.push({ path: `${base}.name`, message: `duplicate provider name "${provider.name}"`, expected: "unique", got: provider.name });
      } else {
        providerNames.add(provider.name);
      }
      if (typeof provider.baseUrl !== "string" || !/^https?:\/\//.test(provider.baseUrl)) {
        errors.push({ path: `${base}.baseUrl`, message: "must be an http(s) URL", expected: "string matching ^https?://", got: String(provider.baseUrl) });
      }
      if (provider.apiFormat !== undefined && !API_FORMATS.has(provider.apiFormat)) {
        errors.push({ path: `${base}.apiFormat`, message: `must be one of: ${Array.from(API_FORMATS).join(", ")}`, expected: "openai|anthropic", got: String(provider.apiFormat) });
      }
      if (provider.keyEnv !== undefined && provider.keyEnv !== null) {
        if (typeof provider.keyEnv !== "string" || !provider.keyEnv.trim()) {
          errors.push({ path: `${base}.keyEnv`, message: "must be a string, null, or omitted", expected: "string|null", got: typeof provider.keyEnv });
        } else if (looksLikeRealApiKey(provider.keyEnv)) {
          errors.push({ path: `${base}.keyEnv`, message: "looks like a real API key. Use a .env variable name, not the key itself", expected: "env var name (e.g. DEEPSEEK_API_KEYS)", got: provider.keyEnv.slice(0, 12) + "..." });
        } else if (!ALLOWED_KEY.test(provider.keyEnv)) {
          errors.push({ path: `${base}.keyEnv`, message: "must match /^[A-Za-z_][A-Za-z0-9_]*$/ (env var name)", expected: "env var name", got: provider.keyEnv });
        }
      }
      if (provider.allowInsecureHttp !== undefined && typeof provider.allowInsecureHttp !== "boolean") {
        errors.push({ path: `${base}.allowInsecureHttp`, message: "must be a boolean", expected: "boolean", got: typeof provider.allowInsecureHttp });
      }
      if (provider.models !== undefined && !Array.isArray(provider.models)) {
        errors.push({ path: `${base}.models`, message: "must be an array of model name strings", expected: "array<string>", got: typeof provider.models });
      } else if (Array.isArray(provider.models)) {
        if (provider.models.length > MAX_MODELS_PER_PROVIDER) {
          errors.push({ path: `${base}.models`, message: `too many models (max ${MAX_MODELS_PER_PROVIDER})`, expected: `array.length <= ${MAX_MODELS_PER_PROVIDER}`, got: String(provider.models.length) });
        }
        provider.models.forEach((model, mi) => {
          if (typeof model !== "string" || !model.trim()) {
            errors.push({ path: `${base}.models[${mi}]`, message: "must be a non-empty string", expected: "string", got: typeof model });
          } else if (model.length > MODEL_NAME_MAX_LENGTH) {
            errors.push({ path: `${base}.models[${mi}]`, message: `model name too long (max ${MODEL_NAME_MAX_LENGTH} chars)`, expected: `length <= ${MODEL_NAME_MAX_LENGTH}`, got: String(model.length) });
          }
        });
      }
      if (provider.extraHeaders !== undefined && (typeof provider.extraHeaders !== "object" || provider.extraHeaders === null || Array.isArray(provider.extraHeaders))) {
        errors.push({ path: `${base}.extraHeaders`, message: "must be a JSON object", expected: "object", got: typeof provider.extraHeaders });
      }
      if (provider.balanceEndpoint !== undefined && provider.balanceEndpoint !== null) {
        if (typeof provider.balanceEndpoint !== "object" || Array.isArray(provider.balanceEndpoint)) {
          errors.push({ path: `${base}.balanceEndpoint`, message: "must be a JSON object or null", expected: "object|null", got: typeof provider.balanceEndpoint });
        } else {
          const be = provider.balanceEndpoint;
          if (typeof be.url !== "string" || !/^https?:\/\//.test(be.url)) {
            errors.push({ path: `${base}.balanceEndpoint.url`, message: "must be an http(s) URL", expected: "string matching ^https?://", got: String(be.url) });
          }
          if (be.method !== undefined && typeof be.method !== "string") {
            errors.push({ path: `${base}.balanceEndpoint.method`, message: "must be a string (GET / POST)", expected: "string", got: typeof be.method });
          }
          if (be.headers !== undefined && (typeof be.headers !== "object" || be.headers === null)) {
            errors.push({ path: `${base}.balanceEndpoint.headers`, message: "must be a JSON object", expected: "object", got: typeof be.headers });
          }
          if (be.fieldMap !== undefined && (typeof be.fieldMap !== "object" || be.fieldMap === null)) {
            errors.push({ path: `${base}.balanceEndpoint.fieldMap`, message: "must be a JSON object", expected: "object", got: typeof be.fieldMap });
          }
        }
      }
      for (const [field, value] of Object.entries(provider)) {
        if (FORBIDDEN_FIELDS.has(field.toLowerCase())) {
          errors.push({ path: `${base}.${field}`, message: "looks like a secret field; use .env or Web Key instead", expected: "no secret in config.json", got: field });
        }
      }
    });
  }

  // ----- combos[] -----
  if (config.combos !== undefined) {
    if (!Array.isArray(config.combos)) {
      errors.push({ path: "combos", message: "must be an array of combo objects", expected: "array", got: typeof config.combos });
    } else if (config.combos.length > MAX_COMBOS) {
      errors.push({ path: "combos", message: `too many combos (max ${MAX_COMBOS})`, expected: `array.length <= ${MAX_COMBOS}`, got: String(config.combos.length) });
    } else {
      const comboNames = new Set();
      const providerNames = new Set((config.providers || []).map((p) => p && p.name).filter(Boolean));
      config.combos.forEach((combo, ci) => {
        const base = `combos[${ci}]`;
        if (!combo || typeof combo !== "object" || Array.isArray(combo)) {
          errors.push({ path: base, message: "must be an object", expected: "object", got: typeof combo });
          return;
        }
        if (typeof combo.name !== "string" || !combo.name.trim()) {
          errors.push({ path: `${base}.name`, message: "must be a non-empty string", expected: "string", got: typeof combo.name });
        } else if (comboNames.has(combo.name)) {
          errors.push({ path: `${base}.name`, message: `duplicate combo name "${combo.name}"`, expected: "unique", got: combo.name });
        } else {
          comboNames.add(combo.name);
        }
        if (combo.strategy !== undefined && !["fallback", "round_robin", "weighted_round_robin"].includes(combo.strategy)) {
          errors.push({ path: `${base}.strategy`, message: "must be fallback, round_robin, or weighted_round_robin", expected: "fallback|round_robin|weighted_round_robin", got: String(combo.strategy) });
        }
        if (!Array.isArray(combo.candidates) || combo.candidates.length === 0) {
          errors.push({ path: `${base}.candidates`, message: "must be a non-empty array", expected: "array.length >= 1", got: Array.isArray(combo.candidates) ? `length ${combo.candidates.length}` : typeof combo.candidates });
        } else {
          combo.candidates.forEach((candidate, ci2) => {
            const cb = `${base}.candidates[${ci2}]`;
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
              errors.push({ path: cb, message: "must be an object", expected: "object", got: typeof candidate });
              return;
            }
            if (typeof candidate.provider !== "string" || !candidate.provider.trim()) {
              errors.push({ path: `${cb}.provider`, message: "must be a non-empty string", expected: "string", got: typeof candidate.provider });
            } else if (providerNames.size > 0 && !providerNames.has(candidate.provider)) {
              errors.push({ path: `${cb}.provider`, message: `references missing provider "${candidate.provider}"`, expected: Array.from(providerNames).join("|"), got: candidate.provider });
            }
            if (typeof candidate.model !== "string" || !candidate.model.trim()) {
              errors.push({ path: `${cb}.model`, message: "must be a non-empty string", expected: "string", got: typeof candidate.model });
            }
            if (candidate.weight !== undefined) {
              if (typeof candidate.weight !== "number" || !Number.isInteger(candidate.weight) || candidate.weight < 1) {
                errors.push({ path: `${cb}.weight`, message: "must be a positive integer", expected: "number >= 1", got: String(candidate.weight) });
              }
            }
            if (candidate.priority !== undefined && (typeof candidate.priority !== "number" || !Number.isInteger(candidate.priority))) {
              errors.push({ path: `${cb}.priority`, message: "must be an integer", expected: "number", got: String(candidate.priority) });
            }
            if (candidate.enabled !== undefined && typeof candidate.enabled !== "boolean") {
              errors.push({ path: `${cb}.enabled`, message: "must be a boolean", expected: "boolean", got: typeof candidate.enabled });
            }
          });
        }
      });
    }
  }

  // ----- top-level: routes[] -----
  if (config.routes !== undefined) {
    if (!Array.isArray(config.routes)) {
      errors.push({ path: "routes", message: "must be an array of route objects", expected: "array", got: typeof config.routes });
    } else if (config.routes.length > MAX_ROUTES) {
      errors.push({ path: "routes", message: `too many routes (max ${MAX_ROUTES})`, expected: `array.length <= ${MAX_ROUTES}`, got: String(config.routes.length) });
    } else {
      const routeNames = new Set();
      config.routes.forEach((route, ri) => {
        const base = `routes[${ri}]`;
        if (!route || typeof route !== "object" || Array.isArray(route)) {
          errors.push({ path: base, message: "must be an object", expected: "object", got: typeof route });
          return;
        }
        if (typeof route.name !== "string" || !route.name.trim()) {
          errors.push({ path: `${base}.name`, message: "must be a non-empty string", expected: "string", got: typeof route.name });
        } else if (!NAME_PATTERN.test(route.name)) {
          errors.push({ path: `${base}.name`, message: "must contain only letters, numbers, underscore, or dash (1-64 chars)", expected: "matching ^[A-Za-z0-9_-]{1,64}$", got: route.name });
        } else if (routeNames.has(route.name)) {
          errors.push({ path: `${base}.name`, message: `duplicate route name "${route.name}"`, expected: "unique", got: route.name });
        } else {
          routeNames.add(route.name);
        }
        if (route.strategy !== undefined && !STRATEGIES.has(route.strategy)) {
          errors.push({ path: `${base}.strategy`, message: `must be one of: ${Array.from(STRATEGIES).join(", ")}`, expected: "fallback|round_robin|weighted", got: String(route.strategy) });
        }
        if (!Array.isArray(route.candidates)) {
          errors.push({ path: `${base}.candidates`, message: "must be a non-empty array", expected: "array.length >= 1", got: typeof route.candidates });
        } else if (route.candidates.length === 0) {
          errors.push({ path: `${base}.candidates`, message: "must have at least one candidate", expected: "array.length >= 1", got: "0" });
        } else if (route.candidates.length > MAX_CANDIDATES_PER_ROUTE) {
          errors.push({ path: `${base}.candidates`, message: `too many candidates (max ${MAX_CANDIDATES_PER_ROUTE})`, expected: `array.length <= ${MAX_CANDIDATES_PER_ROUTE}`, got: String(route.candidates.length) });
        } else {
          const providerNames = new Set((config.providers || []).map((p) => p && p.name).filter(Boolean));
          route.candidates.forEach((candidate, ci) => {
            const cbase = `${base}.candidates[${ci}]`;
            if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
              errors.push({ path: cbase, message: "must be an object", expected: "object", got: typeof candidate });
              return;
            }
            if (typeof candidate.provider !== "string" || !candidate.provider.trim()) {
              errors.push({ path: `${cbase}.provider`, message: "must be a non-empty string", expected: "string", got: typeof candidate.provider });
            } else if (providerNames.size > 0 && !providerNames.has(candidate.provider)) {
              errors.push({ path: `${cbase}.provider`, message: `references missing provider "${candidate.provider}"`, expected: Array.from(providerNames).join("|"), got: candidate.provider });
            }
            if (typeof candidate.model !== "string" || !candidate.model.trim()) {
              errors.push({ path: `${cbase}.model`, message: "must be a non-empty string", expected: "string", got: typeof candidate.model });
            }
            if (candidate.weight !== undefined) {
              if (typeof candidate.weight !== "number" || !Number.isInteger(candidate.weight) || candidate.weight < 1) {
                errors.push({ path: `${cbase}.weight`, message: "must be a positive integer", expected: "number >= 1", got: String(candidate.weight) });
              }
            }
          });
        }
        if (route.limits !== undefined && (typeof route.limits !== "object" || route.limits === null || Array.isArray(route.limits))) {
          errors.push({ path: `${base}.limits`, message: "must be a JSON object", expected: "object", got: typeof route.limits });
        } else if (route.limits && route.limits.dailyRequests !== undefined && route.limits.dailyRequests !== null) {
          if (typeof route.limits.dailyRequests !== "number" || !Number.isInteger(route.limits.dailyRequests) || route.limits.dailyRequests < 1) {
            errors.push({ path: `${base}.limits.dailyRequests`, message: "must be a positive integer, null, or omitted", expected: "number | null", got: String(route.limits.dailyRequests) });
          }
        }
      });
    }
  }

  // ----- top-level: modelAliases (0.1.3) -----
  // Must validate BEFORE profiles[] since profiles may reference modelAlias keys.
  if (config.modelAliases !== undefined) {
    if (typeof config.modelAliases !== "object" || config.modelAliases === null || Array.isArray(config.modelAliases)) {
      errors.push({ path: "modelAliases", message: "must be a JSON object (map of alias → target)", expected: "object", got: typeof config.modelAliases });
    } else {
      const providerNames = new Set((config.providers || []).map((p) => p && p.name).filter(Boolean));
      const routeNames = new Set((config.routes || []).map((r) => r && r.name).filter(Boolean));
      for (const [alias, target] of Object.entries(config.modelAliases)) {
        if (typeof target !== "string" || !target.trim()) {
          errors.push({ path: `modelAliases.${alias}`, message: "must be a non-empty string (provider:model or route name)", expected: "string", got: typeof target });
          continue;
        }
        const targetTrimmed = target.trim();
        const isRoute = routeNames.has(targetTrimmed);
        const isProviderExplicit = /^[A-Za-z0-9_-]+:.+$/.test(targetTrimmed);
        const isProviderModel = isProviderExplicit && providerNames.has(targetTrimmed.split(":")[0]);
        if (!isRoute && !isProviderModel) {
          warnings.push({ path: `modelAliases.${alias}`, message: `target "${targetTrimmed}" doesn't match any known route or provider:model; may be a forward reference` });
        }
      }
    }
  }

  // ----- top-level: profiles[] -----
  if (config.profiles !== undefined) {
    if (!Array.isArray(config.profiles)) {
      errors.push({ path: "profiles", message: "must be an array of profile objects", expected: "array", got: typeof config.profiles });
    } else if (config.profiles.length > MAX_PROFILES) {
      errors.push({ path: "profiles", message: `too many profiles (max ${MAX_PROFILES})`, expected: `array.length <= ${MAX_PROFILES}`, got: String(config.profiles.length) });
    } else {
      const profileNames = new Set();
      const providerModelSet = new Set();
      for (const p of (config.providers || [])) {
        if (p && Array.isArray(p.models)) for (const m of p.models) providerModelSet.add(m);
      }
      const routeNames = new Set((config.routes || []).map((r) => r && r.name).filter(Boolean));
      config.profiles.forEach((profile, pi) => {
        const base = `profiles[${pi}]`;
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
          errors.push({ path: base, message: "must be an object", expected: "object", got: typeof profile });
          return;
        }
        if (typeof profile.name !== "string" || !profile.name.trim()) {
          errors.push({ path: `${base}.name`, message: "must be a non-empty string", expected: "string", got: typeof profile.name });
        } else if (!NAME_PATTERN.test(profile.name)) {
          errors.push({ path: `${base}.name`, message: "must contain only letters, numbers, underscore, or dash (1-64 chars)", expected: "matching ^[A-Za-z0-9_-]{1,64}$", got: profile.name });
        } else if (profileNames.has(profile.name)) {
          errors.push({ path: `${base}.name`, message: `duplicate profile name "${profile.name}"`, expected: "unique", got: profile.name });
        } else {
          profileNames.add(profile.name);
        }
        if (typeof profile.defaultModel !== "string" || !profile.defaultModel.trim()) {
          errors.push({ path: `${base}.defaultModel`, message: "must be a non-empty string", expected: "string", got: typeof profile.defaultModel });
        } else {
          // Cross-reference: defaultModel must point to an existing
          // route, provider:model, known provider model, or modelAlias.
          const aliasKeys = config.modelAliases && typeof config.modelAliases === "object"
            ? new Set(Object.keys(config.modelAliases))
            : new Set();
          if (routeNames.size + providerModelSet.size + aliasKeys.size > 0) {
            const ok = routeNames.has(profile.defaultModel) ||
              providerModelSet.has(profile.defaultModel) ||
              aliasKeys.has(profile.defaultModel) ||
              /^[A-Za-z0-9_-]+:.+/.test(profile.defaultModel);
            if (!ok) {
              warnings.push(`${base}.defaultModel = "${profile.defaultModel}" doesn't match any known route, provider:model, provider model, or modelAlias`);
            }
          }
        }
        if (profile.description !== undefined && typeof profile.description !== "string") {
          errors.push({ path: `${base}.description`, message: "must be a string", expected: "string", got: typeof profile.description });
        }
      });
    }
  }

  // ----- top-level: defaultProvider / activeProfile -----
  if (config.defaultProvider !== undefined) {
    if (typeof config.defaultProvider !== "string" || !config.defaultProvider.trim()) {
      errors.push({ path: "defaultProvider", message: "must be a non-empty string", expected: "string", got: typeof config.defaultProvider });
    } else if (Array.isArray(config.providers) && config.providers.length > 0) {
      const names = new Set(config.providers.map((p) => p && p.name).filter(Boolean));
      if (names.size > 0 && !names.has(config.defaultProvider)) {
        errors.push({ path: "defaultProvider", message: `references missing provider "${config.defaultProvider}"`, expected: Array.from(names).join("|"), got: config.defaultProvider });
      }
    }
  }
  if (config.activeProfile !== undefined && config.activeProfile !== null) {
    if (typeof config.activeProfile !== "string" || !config.activeProfile.trim()) {
      errors.push({ path: "activeProfile", message: "must be a non-empty string or null", expected: "string|null", got: typeof config.activeProfile });
    } else if (Array.isArray(config.profiles) && config.profiles.length > 0) {
      const names = new Set(config.profiles.map((p) => p && p.name).filter(Boolean));
      if (names.size > 0 && !names.has(config.activeProfile)) {
        errors.push({ path: "activeProfile", message: `references missing profile "${config.activeProfile}"`, expected: Array.from(names).join("|"), got: config.activeProfile });
      }
    }
  }

  // ----- top-level: retry / limits / history / healthChecks -----
  validateBlock(config, "retry", ["maxAttempts", "cooldownMs", "timeoutMs", "streamIdleTimeoutMs"], errors, (n) => Number.isInteger(n) && n >= 1);
  // limits.maxBodyBytes must be a positive integer; limits.dailyRequests
  // is nullable (null = no local limit), matching normalizeConfig in
  // config.js.
  validateBlock(config, "limits", ["maxBodyBytes"], errors, (n) => Number.isInteger(n) && n >= 1);
  if (config.limits && typeof config.limits === "object" && config.limits.dailyRequests !== undefined && config.limits.dailyRequests !== null) {
    if (typeof config.limits.dailyRequests !== "number" || !Number.isInteger(config.limits.dailyRequests) || config.limits.dailyRequests < 1) {
      errors.push({ path: "limits.dailyRequests", message: "must be a positive integer, null, or omitted", expected: "number >= 1 | null", got: String(config.limits.dailyRequests) });
    }
  }
  validateLimitsProvidersRoutes(config, errors);
  if (config.history !== undefined) {
    if (typeof config.history !== "object" || config.history === null || Array.isArray(config.history)) {
      errors.push({ path: "history", message: "must be a JSON object", expected: "object", got: typeof config.history });
    } else if (config.history.retentionDays !== undefined) {
      if (typeof config.history.retentionDays !== "number" || !Number.isInteger(config.history.retentionDays) || config.history.retentionDays < 1 || config.history.retentionDays > 365) {
        errors.push({ path: "history.retentionDays", message: "must be an integer in [1, 365]", expected: "1..365", got: String(config.history.retentionDays) });
      }
    }
  }
  if (config.healthChecks !== undefined) {
    if (typeof config.healthChecks !== "object" || config.healthChecks === null || Array.isArray(config.healthChecks)) {
      errors.push({ path: "healthChecks", message: "must be a JSON object", expected: "object", got: typeof config.healthChecks });
    } else {
      if (config.healthChecks.enabled !== undefined && typeof config.healthChecks.enabled !== "boolean") {
        errors.push({ path: "healthChecks.enabled", message: "must be a boolean", expected: "boolean", got: typeof config.healthChecks.enabled });
      }
      if (config.healthChecks.intervalMinutes !== undefined && (typeof config.healthChecks.intervalMinutes !== "number" || !Number.isInteger(config.healthChecks.intervalMinutes) || config.healthChecks.intervalMinutes < 5)) {
        errors.push({ path: "healthChecks.intervalMinutes", message: "must be an integer >= 5 (minutes)", expected: "number >= 5", got: String(config.healthChecks.intervalMinutes) });
      }
      if (config.healthChecks.providers !== undefined) {
        if (!Array.isArray(config.healthChecks.providers)) {
          errors.push({ path: "healthChecks.providers", message: "must be an array of provider names", expected: "array<string>", got: typeof config.healthChecks.providers });
        } else {
          const providerNames = new Set((config.providers || []).map((p) => p && p.name).filter(Boolean));
          config.healthChecks.providers.forEach((name, ni) => {
            if (typeof name !== "string" || !name.trim()) {
              errors.push({ path: `healthChecks.providers[${ni}]`, message: "must be a non-empty string", expected: "string", got: typeof name });
            } else if (providerNames.size > 0 && !providerNames.has(name)) {
              errors.push({ path: `healthChecks.providers[${ni}]`, message: `references missing provider "${name}"`, expected: Array.from(providerNames).join("|"), got: name });
            }
          });
        }
      }
    }
  }

  // ----- top-level: rateLimiter -----
  if (config.rateLimiter !== undefined) {
    if (typeof config.rateLimiter !== "object" || config.rateLimiter === null || Array.isArray(config.rateLimiter)) {
      errors.push({ path: "rateLimiter", message: "must be a JSON object", expected: "object", got: typeof config.rateLimiter });
    } else {
      if (config.rateLimiter.enabled !== undefined && typeof config.rateLimiter.enabled !== "boolean") {
        errors.push({ path: "rateLimiter.enabled", message: "must be a boolean", expected: "boolean", got: typeof config.rateLimiter.enabled });
      }
      if (config.rateLimiter.windowMs !== undefined) {
        if (typeof config.rateLimiter.windowMs !== "number" || !Number.isInteger(config.rateLimiter.windowMs) || config.rateLimiter.windowMs < 1000 || config.rateLimiter.windowMs > 3600000) {
          errors.push({ path: "rateLimiter.windowMs", message: "must be an integer in [1000, 3600000] (1s to 1h)", expected: "1000..3600000", got: String(config.rateLimiter.windowMs) });
        }
      }
      if (config.rateLimiter.maxRequests !== undefined) {
        if (typeof config.rateLimiter.maxRequests !== "number" || !Number.isInteger(config.rateLimiter.maxRequests) || config.rateLimiter.maxRequests < 1 || config.rateLimiter.maxRequests > 100000) {
          errors.push({ path: "rateLimiter.maxRequests", message: "must be an integer in [1, 100000]", expected: "1..100000", got: String(config.rateLimiter.maxRequests) });
        }
      }
      if (config.rateLimiter.adminMaxRequests !== undefined) {
        if (typeof config.rateLimiter.adminMaxRequests !== "number" || !Number.isInteger(config.rateLimiter.adminMaxRequests) || config.rateLimiter.adminMaxRequests < 1 || config.rateLimiter.adminMaxRequests > 100000) {
          errors.push({ path: "rateLimiter.adminMaxRequests", message: "must be an integer in [1, 100000]", expected: "1..100000", got: String(config.rateLimiter.adminMaxRequests) });
        }
      }
    }
  }

  // ----- top-level: auth -----
  if (config.auth !== undefined) {
    if (typeof config.auth !== "object" || config.auth === null || Array.isArray(config.auth)) {
      errors.push({ path: "auth", message: "must be a JSON object", expected: "object", got: typeof config.auth });
    } else {
      if (config.auth.publicModels !== undefined && typeof config.auth.publicModels !== "boolean") {
        errors.push({ path: "auth.publicModels", message: "must be a boolean", expected: "boolean", got: typeof config.auth.publicModels });
      }
    }
  }

  // ----- top-level: privacy -----
  if (config.privacy !== undefined) {
    if (typeof config.privacy !== "object" || config.privacy === null || Array.isArray(config.privacy)) {
      errors.push({ path: "privacy", message: "must be a JSON object", expected: "object", got: typeof config.privacy });
    } else {
      if (config.privacy.logPrompts !== undefined && typeof config.privacy.logPrompts !== "boolean") {
        errors.push({ path: "privacy.logPrompts", message: "must be a boolean", expected: "boolean", got: typeof config.privacy.logPrompts });
      }
      if (config.privacy.logHeaders !== undefined && typeof config.privacy.logHeaders !== "boolean") {
        errors.push({ path: "privacy.logHeaders", message: "must be a boolean", expected: "boolean", got: typeof config.privacy.logHeaders });
      }
    }
  }

  // ----- top-level: localConnectorConsents (0.3.21) -----
  if (config.localConnectorConsents !== undefined) {
    if (typeof config.localConnectorConsents !== "object" || config.localConnectorConsents === null || Array.isArray(config.localConnectorConsents)) {
      errors.push({ path: "localConnectorConsents", message: "must be a JSON object keyed by connector id", expected: "object", got: typeof config.localConnectorConsents });
    } else {
      for (const [id, entry] of Object.entries(config.localConnectorConsents)) {
        const base = `localConnectorConsents.${id}`;
        if (!/^[a-z0-9_-]{2,64}$/.test(id)) {
          errors.push({ path: base, message: "connector id must be 2-64 chars: lowercase letters, numbers, underscore or dash", expected: "^[a-z0-9_-]{2,64}$", got: id });
          continue;
        }
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          errors.push({ path: base, message: "must be a consent metadata object", expected: "object", got: typeof entry });
          continue;
        }
        if (entry.approved !== true) {
          errors.push({ path: `${base}.approved`, message: "must be true for stored consent records", expected: "true", got: String(entry.approved) });
        }
        for (const field of ["approvedAt", "consentVersion", "connectorId", "connectorName", "credentialScope", "riskLevel"]) {
          if (entry[field] !== undefined && entry[field] !== null && typeof entry[field] !== "string") {
            errors.push({ path: `${base}.${field}`, message: "must be a string when present", expected: "string", got: typeof entry[field] });
          }
        }
        for (const field of ["requiredConsent", "futureActions", "reviewTags"]) {
          if (entry[field] !== undefined) {
            if (!Array.isArray(entry[field])) {
              errors.push({ path: `${base}.${field}`, message: "must be an array of strings", expected: "array<string>", got: typeof entry[field] });
            } else {
              entry[field].forEach((item, index) => {
                if (typeof item !== "string" || !item.trim()) {
                  errors.push({ path: `${base}.${field}[${index}]`, message: "must be a non-empty string", expected: "string", got: typeof item });
                }
              });
            }
          }
        }
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, warnings };
}

function validateBlock(config, blockName, intFields, errors, intPredicate) {
  if (config[blockName] === undefined) return;
  if (typeof config[blockName] !== "object" || config[blockName] === null || Array.isArray(config[blockName])) {
    errors.push({ path: blockName, message: "must be a JSON object", expected: "object", got: typeof config[blockName] });
    return;
  }
  const block = config[blockName];
  for (const field of intFields) {
    if (block[field] !== undefined && (typeof block[field] !== "number" || !intPredicate(block[field]))) {
      errors.push({ path: `${blockName}.${field}`, message: "must be a positive integer", expected: "number", got: String(block[field]) });
    }
  }
}

function validateLimitsProvidersRoutes(config, errors) {
  if (config.limits && typeof config.limits === "object") {
    for (const [bucket, value] of Object.entries(config.limits)) {
      if (bucket === "maxBodyBytes" || bucket === "dailyRequests" || bucket === "routes" || bucket === "providers" || bucket === "models") {
        if (bucket === "routes" || bucket === "providers" || bucket === "models") {
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            errors.push({ path: `limits.${bucket}`, message: "must be a JSON object", expected: "object", got: typeof value });
          } else {
            for (const [name, sub] of Object.entries(value)) {
              if (typeof sub !== "object" || sub === null || Array.isArray(sub)) {
                errors.push({ path: `limits.${bucket}.${name}`, message: "must be a JSON object", expected: "object", got: typeof sub });
                continue;
              }
              if (sub.dailyRequests !== undefined && sub.dailyRequests !== null && (typeof sub.dailyRequests !== "number" || !Number.isInteger(sub.dailyRequests) || sub.dailyRequests < 1)) {
                errors.push({ path: `limits.${bucket}.${name}.dailyRequests`, message: "must be a positive integer, null, or omitted", expected: "number | null", got: String(sub.dailyRequests) });
              }
            }
          }
        }
      } else {
        errors.push({ path: `limits.${bucket}`, message: "unknown key; allowed: maxBodyBytes, dailyRequests, routes, providers, models", expected: "maxBodyBytes|dailyRequests|routes|providers|models", got: bucket });
      }
    }
  }
}

// Cheap real-key heuristic — the same one the dashboard uses to
// warn the operator. Duplicated here to keep schema.js self-contained.
function looksLikeRealApiKey(value) {
  const text = String(value || "").trim();
  return /^(sk-|sk-ant-|sk-or-|AIza|gsk-|pplx-|xai-|co-|claude-|hf_|ghp_|github_pat_)[A-Za-z0-9._:/-]{8,}/.test(text);
}

export const SCHEMA_VERSION = "0.5.2";
export const VALIDATION_FORBIDDEN_FIELDS = Array.from(FORBIDDEN_FIELDS);
