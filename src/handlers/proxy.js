import { parseOpenRelayKey } from "../auth.js";
import { buildRequestMeta } from "../privacy.js";

/**
 * @param {object} ctx
 * @returns {object}
 */
export function createProxyHandlers(ctx) {
  const {
    config, stats, usage, keyPool, secretStore, providerHealth,
    runtimeStatePersister, healthCache, recentErrors, routeRuntime,
    requestLog, activeProfile, packageVersion, statePath, relayAuth,
    recordError, persistRuntimeState,
    incrementProvider, incrementRoute, incrementModel,
    getProviderKeys,
    sendJson, sendNoContent,
    readJsonBody,
    withCorsHeaders, copyResponseHeaders,
    parseMaybeJson,
    selectRoute, orderCandidates,
    isStreamRequested, isLocalProvider,
    isLimitExceeded, getRouteDailyLimit, getProviderDailyLimit, getModelDailyLimit,
    getResolvedRouteDailyLimit,
    normalizeUsage,
    anthropicToOpenAi, openAiToAnthropic,
    openAiResponseToAnthropic, anthropicResponseToOpenAi,
    openAiResponseToResponses, anthropicResponseToResponses,
    responsesToChatPayload,
    createAnthropicToOpenAiSseBridge, createOpenAiToAnthropicSseBridge
  } = ctx;

  function recordRequestMeta(req, body, provider, model, startedAt, status, errorCategory, attempt) {
    if (!requestLog) return;
    const meta = buildRequestMeta(req, body, provider, model, startedAt, status, errorCategory);
    meta.attempt = typeof attempt === "number" ? attempt : 1;
    requestLog.record(meta);
  }

  function resolveSkOrRouting(req, body) {
    const raw = req.__openrelayRouting;
    if (!raw) return;
    const parsed = parseOpenRelayKey(raw);
    if (!parsed) return;
    body.model = parsed.target;
  }

  /**
   * Build a synthetic route for a direct provider path (/{provider}/v1/...).
   * Returns null if the provider name does not match any configured provider.
   * @param {string} providerName
   * @returns {object|null}
   */
  function buildDirectRoute(providerName) {
    const provider = config.providers.find((p) => p.name === providerName);
    if (!provider) return null;
    const model = provider.models[0] || "default";
    return {
      name: `direct:${providerName}`,
      strategy: "fallback",
      limits: {},
      candidates: [{ provider, model, weight: 1 }]
    };
  }

  /**
   * @param {object} route
   * @param {object} provider
   * @param {string} model
   * @returns {{ limited: boolean, error?: object }}
   */
  function checkCandidateLocalLimits(route, provider, model) {
    const providerLimit = getProviderDailyLimit(provider.name);
    if (isLimitExceeded("providers", provider.name, providerLimit)) {
      stats.localLimitHits += 1;
      incrementProvider(provider.name, "limited");
      recordError(`local-limit:provider:${provider.name}`, new Error(`local_provider_limit_exceeded dailyRequests=${providerLimit}`), "local_limit", { provider: provider.name, status: 429 });
      return {
        limited: true,
        error: {
          status: 429,
          body: { error: "local_provider_limit_exceeded", route: route.name, provider: provider.name, dailyRequests: providerLimit }
        }
      };
    }

    const modelName = `${provider.name}:${model}`;
    const modelLimit = getModelDailyLimit(provider.name, model);
    if (isLimitExceeded("models", modelName, modelLimit) || isLimitExceeded("models", model, modelLimit)) {
      stats.localLimitHits += 1;
      incrementModel(modelName, "limited");
      recordError(`local-limit:model:${modelName}`, new Error(`local_model_limit_exceeded dailyRequests=${modelLimit}`), "local_limit", { provider: provider.name, model, status: 429 });
      return {
        limited: true,
        error: {
          status: 429,
          body: { error: "local_model_limit_exceeded", route: route.name, provider: provider.name, model, modelName, dailyRequests: modelLimit }
        }
      };
    }

    return { limited: false };
  }

  /**
   * Provider direct path handler. Dispatches directly to the
   * provider specified in the URL path, bypassing selectRoute.
   * Auth is checked by the router before this is called.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {string} providerName
   * @param {string} pathSuffix  "chat/completions" | "messages" | "responses" | "models"
   */
  async function handleProviderDirect(req, res, providerName, pathSuffix) {
    const provider = config.providers.find((p) => p.name === providerName);
    if (!provider) {
      return sendJson(res, { error: "provider_not_found", message: `No configured provider named '${providerName}'` }, 404);
    }

    if (pathSuffix === "models") {
      const data = (provider.models || []).map((model) => ({
        id: `${provider.name}:${model}`,
        object: "model",
        owned_by: provider.name,
        type: "provider-direct",
        group: "providers",
        api_format: provider.apiFormat
      }));
      return sendJson(res, { object: "list", data });
    }

    const body = await readJsonBody(req, config.limits.maxBodyBytes);
    const route = buildDirectRoute(providerName);
    if (!route) return sendJson(res, { error: "provider_not_found" }, 404);
    // Respect the user's model if provided; enforce provider from URL.
    if (!body.model || typeof body.model !== "string" || !body.model.trim()) {
      body.model = route.candidates[0].model;
    }
    stats.requests += 1;
    usage.increment("routes", route.name);
    incrementRoute(route.name, "requests");

    if (pathSuffix === "responses") {
      const chatPayload = responsesToChatPayload(body);
      chatPayload.model = body.model;
      return proxyWithRetry({
        res, route, path: "/chat/completions", payload: chatPayload, responseFormat: "responses"
      });
    }

    if (pathSuffix === "messages") {
      if (isStreamRequested(body)) {
        return streamWithRetry({
          res, route, body, path: "/messages", clientFormat: "anthropic",
          openResponseHeaders: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
          onStream: (response, prov, model) => streamAnthropicMessagesFromUpstream(res, response, prov, model, body)
        });
      }
      return proxyWithRetry({ res, route, path: "/messages", payload: body, responseFormat: "anthropic" });
    }

    // Default: chat/completions
    if (isStreamRequested(body)) {
      return streamWithRetry({
        res, route, body, path: "/chat/completions", clientFormat: "openai",
        openResponseHeaders: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
        onStream: (response, prov, model) => streamOpenAiChatFromUpstream(res, response, prov, model, body)
      });
    }
    return proxyWithRetry({ res, route, path: "/chat/completions", payload: body, responseFormat: "openai" });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleModels(req, res) {
    // Profile-level model entries (routes and direct models)
    const profileModels = config.profiles.map((profile) => ({
      id: profile.name,
      object: "model",
      owned_by: "local-profile",
      type: "local-profile",
      group: "profiles",
      description: profile.description || ""
    }));
    const routeModels = config.routes.map((route) => ({
      id: route.name,
      object: "model",
      owned_by: "local-route",
      type: "local-route",
      group: "routes",
      strategy: route.strategy,
      candidates: route.candidates.map((c) => `${c.provider}:${c.model}`),
      description: route.description || ""
    }));
    // Combo models (0.4.0)
    const comboModels = (config.combos || []).map((combo) => ({
      id: combo.name,
      object: "model",
      owned_by: "local-combo",
      type: "combo",
      group: "combos",
      strategy: combo.strategy,
      candidates: (combo.candidates || []).map((c) => `${c.provider}:${c.model}`),
      description: combo.description || ""
    }));
    const providerModels = config.providers.flatMap((provider) =>
      provider.models.map((model) => ({
        id: `${provider.name}:${model}`,
        object: "model",
        owned_by: provider.name,
        type: "provider",
        group: "providers",
        api_format: provider.apiFormat,
        local: isLocalProvider(provider),
        upstream_model: model
      }))
    );
    // Model aliases (0.1.3+)
    const aliasModels = config.modelAliases && typeof config.modelAliases === "object"
      ? Object.entries(config.modelAliases).map(([alias, target]) => ({
          id: alias,
          object: "model",
          owned_by: "model-alias",
          type: "model-alias",
          group: "aliases",
          target: String(target)
        }))
      : [];
    const data = [
      ...profileModels,
      ...routeModels,
      ...comboModels,
      ...aliasModels,
      ...providerModels
    ];
    return sendJson(res, { object: "list", data });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleChatCompletions(req, res) {
    const body = await readJsonBody(req, config.limits.maxBodyBytes);
    resolveSkOrRouting(req, body);
    if (isStreamRequested(body)) {
      return handleChatCompletionsStream(req, res, body);
    }
    return handleUnifiedChatRequest(res, body, "openai");
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {object} body
   */
  async function handleChatCompletionsStream(req, res, body) {
    const route = selectRoute(body.model);
    if (!route) {
      recordRequestMeta(req, body, null, body?.model, Date.now(), 400, "provider_not_found");
      return sendJson(res, { error: "provider_not_found" }, 400);
    }

    const routeLimit = getResolvedRouteDailyLimit(route) || getRouteDailyLimit(route.name);
    if (isLimitExceeded("routes", route.name, routeLimit)) {
      stats.localLimitHits += 1;
      incrementRoute(route.name, "limited");
      recordError(`local-limit:route:${route.name}`, new Error(`local_route_limit_exceeded dailyRequests=${routeLimit}`), "local_limit", { status: 429 });
      persistRuntimeState();
      return sendJson(
        res,
        {
          error: "local_route_limit_exceeded",
          route: route.name,
          dailyRequests: routeLimit,
          message: "Local soft limit reached. Edit config.json if you intentionally want a higher local limit."
        },
        429
      );
    }
    usage.increment("routes", route.name);
    incrementRoute(route.name, "requests");

    return streamWithRetry({
      res,
      route,
      body,
      path: "/chat/completions",
      clientFormat: "openai",
      openResponseHeaders: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      },
      onStream: (response, provider, model) => streamOpenAiChatFromUpstream(res, response, provider, model, body)
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {object} body
   */
  async function handleAnthropicMessagesStream(req, res, body) {
    const route = selectRoute(body.model);
    if (!route) return sendJson(res, { error: "provider_not_found" }, 400);

    const routeLimit = getRouteDailyLimit(route.name);
    if (isLimitExceeded("routes", route.name, routeLimit)) {
      stats.localLimitHits += 1;
      incrementRoute(route.name, "limited");
      recordError(`local-limit:route:${route.name}`, new Error(`local_route_limit_exceeded dailyRequests=${routeLimit}`), "local_limit", { status: 429 });
      persistRuntimeState();
      return sendJson(
        res,
        {
          error: "local_route_limit_exceeded",
          route: route.name,
          dailyRequests: routeLimit,
          message: "Local soft limit reached. Edit config.json if you intentionally want a higher local limit."
        },
        429
      );
    }
    usage.increment("routes", route.name);
    incrementRoute(route.name, "requests");

    return streamWithRetry({
      res,
      route,
      body,
      path: "/chat/completions",
      clientFormat: "anthropic",
      openResponseHeaders: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      },
      onStream: (response, provider, model) => streamAnthropicMessagesFromUpstream(res, response, provider, model, body)
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleAnthropicMessages(req, res) {
    const body = await readJsonBody(req, config.limits.maxBodyBytes);
    resolveSkOrRouting(req, body);
    if (isStreamRequested(body)) {
      return handleAnthropicMessagesStream(req, res, body);
    }
    return handleUnifiedChatRequest(res, body, "anthropic");
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleOpenAIResponses(req, res) {
    const body = await readJsonBody(req, config.limits.maxBodyBytes);
    resolveSkOrRouting(req, body);
    if (isStreamRequested(body)) {
      return handleResponsesStream(req, res, body);
    }
    return handleUnifiedChatRequest(res, responsesToChatPayload(body), "responses");
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @param {object} body
   */
  async function handleResponsesStream(req, res, body) {
    const reqStartedAt = Date.now();
    const chatPayload = responsesToChatPayload({ ...body, stream: true });
    const route = selectRoute(chatPayload.model);
    if (!route) {
      recordRequestMeta(req, body, null, body?.model, reqStartedAt, 400, "provider_not_found");
      return sendJson(res, { error: "provider_not_found" }, 400);
    }

    const routeLimit = getRouteDailyLimit(route.name);
    if (isLimitExceeded("routes", route.name, routeLimit)) {
      stats.localLimitHits += 1;
      incrementRoute(route.name, "limited");
      persistRuntimeState();
      recordRequestMeta(req, body, route.name, body?.model, reqStartedAt, 429, "local_limit");
      return sendJson(
        res,
        {
          error: "local_route_limit_exceeded",
          route: route.name,
          dailyRequests: routeLimit,
          message: "Local soft limit reached. Edit config.json if you intentionally want a higher local limit."
        },
        429
      );
    }
    usage.increment("routes", route.name);
    incrementRoute(route.name, "requests");

    let lastError = null;
    let totalAttempt = 0;
    let lastAttemptStartedAt = reqStartedAt;
    for (const candidate of orderCandidates(route)) {
      const provider = candidate.provider;
      const localLimit = checkCandidateLocalLimits(route, provider, candidate.model);
      if (localLimit.limited) {
        lastError = localLimit.error;
        continue;
      }
      const attempts = Math.min(config.retry.maxAttempts, Math.max(1, getProviderKeys(provider).length || 1));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        totalAttempt += 1;
        stats.upstreamAttempts += 1;
        usage.increment("providers", provider.name);
        usage.increment("models", `${provider.name}:${candidate.model}`);
        incrementProvider(provider.name, "attempts");
        incrementModel(`${provider.name}:${candidate.model}`, "attempts");
        const key = keyPool.next(provider.name);
        if (!key) {
          lastError = { status: 503, body: { error: "no_available_key", route: route.name, provider: provider.name } };
          break;
        }
        const headers = buildUpstreamHeaders(provider, key);
        if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
        const upstream = buildUpstreamRequest(provider, "/chat/completions", chatPayload, candidate.model, "openai");
        let response;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);
        const attemptStartedAt = Date.now();
        lastAttemptStartedAt = attemptStartedAt;
        try {
          response = await fetch(upstream.url, {
            method: "POST",
            headers,
            body: JSON.stringify(upstream.body),
            signal: controller.signal
          });
        } catch (error) {
          const attemptLatencyMs = Date.now() - attemptStartedAt;
          const cat = error.name === "AbortError" || /timeout/i.test(error.message || "")
            ? "upstream_timeout"
            : "upstream_request_failed";
          recordError(`responses-proxy:${provider.name}`, error, cat, { provider: provider.name, model: candidate.model });
          keyPool.markFailure(provider.name, key, true);
          incrementProvider(provider.name, "failed");
          incrementRoute(route.name, "failed");
          incrementModel(`${provider.name}:${candidate.model}`, "failed");
          providerHealth.record(provider.name, { ok: false, latencyMs: attemptLatencyMs, error: cat });
          lastError = {
            status: 502,
            body: {
              error: "upstream_request_failed",
              route: route.name,
              provider: provider.name,
              attempt: totalAttempt,
              message: error.message
            }
          };
          continue;
        } finally {
          clearTimeout(timeout);
        }
        const attemptLatencyMs = Date.now() - attemptStartedAt;
        if (response.ok) {
          stats.proxied += 1;
          incrementProvider(provider.name, "ok");
          incrementRoute(route.name, "ok");
          incrementModel(`${provider.name}:${candidate.model}`, "ok");
          providerHealth.record(provider.name, { ok: true, latencyMs: attemptLatencyMs });
          usage.recordLatency("byRoute", route.name, attemptLatencyMs);
          usage.recordLatency("byProvider", provider.name, attemptLatencyMs);
          usage.recordLatency("byModel", `${provider.name}:${candidate.model}`, attemptLatencyMs);
          if (!body?.stream) {
            recordUsageFromResponse(response.clone(), provider, candidate.model, route.name)
              .catch(() => {});
          }
          persistRuntimeState();
          return await streamResponsesFromUpstream(res, response, provider, candidate.model, body);
        }
        const responseText = await response.text();
        const retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
        // 401/403: non-retryable on same provider (bad key) — break inner loop
        // to try the next candidate (fallback to another provider).
        keyPool.markFailure(provider.name, key, retryable);
        incrementProvider(provider.name, "failed");
        incrementRoute(route.name, "failed");
        incrementModel(`${provider.name}:${candidate.model}`, "failed");
        const responseCategory = response.status === 401 || response.status === 403
          ? "upstream_auth"
          : response.status === 429
            ? "upstream_429"
            : response.status >= 500 && response.status < 600
              ? "upstream_5xx"
              : "upstream_request_failed";
        recordError(`responses-proxy:${provider.name}`, new Error(`upstream_error status=${response.status}`), responseCategory, { provider: provider.name, model: candidate.model, status: response.status });
        const rateLimitMeta = recordUpstreamHttpFailure(response, provider, candidate.model, attemptLatencyMs);
        lastError = {
          status: response.status,
          body: {
            error: "upstream_error",
            provider: provider.name,
            attempt: totalAttempt,
            status: response.status,
            body: parseMaybeJson(responseText),
            ...(rateLimitMeta ? { retryAfterMs: rateLimitMeta.cooldownMs, retryAfterUntil: rateLimitMeta.until } : {})
          }
        };
        if (!retryable || response.status === 429) break;
      }
    }
    stats.failures += 1;
    persistRuntimeState();
    const rspProviderName = lastError?.body?.provider || route.candidates?.[0]?.provider?.name || "unknown";
    recordRequestMeta(req, body, rspProviderName, body?.model, lastAttemptStartedAt || reqStartedAt, lastError?.status || 502, "responses_stream_failed", totalAttempt);
    return sendJson(res, lastError?.body || { error: "proxy_failed" }, lastError?.status || 502);
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {object} body
   * @param {string} responseFormat
   */
  async function handleUnifiedChatRequest(res, body, responseFormat) {
    stats.requests += 1;
    const req = res.__openrelayReq || { method: "POST", url: "/v1/chat/completions" };
    const startedAt = Date.now();
    const route = selectRoute(body.model);
    if (!route) {
      recordRequestMeta(req, body, null, body?.model, startedAt, 400, "provider_not_found");
      return sendJson(res, { error: "provider_not_found" }, 400);
    }
    const routeLimit = getResolvedRouteDailyLimit(route) || getRouteDailyLimit(route.name);
    if (isLimitExceeded("routes", route.name, routeLimit)) {
      stats.localLimitHits += 1;
      incrementRoute(route.name, "limited");
      recordError(`local-limit:route:${route.name}`, new Error(`local_route_limit_exceeded dailyRequests=${routeLimit}`), "local_limit", { status: 429 });
      persistRuntimeState();
      return sendJson(
        res,
        {
          error: "local_route_limit_exceeded",
          route: route.name,
          dailyRequests: routeLimit,
          message: "Local soft limit reached. Edit config.json if you intentionally want a higher local limit."
        },
        429
      );
    }
    if (
      isStreamRequested(body) &&
      route.candidates.length > 0 &&
      route.candidates.every((candidate) => !candidate.provider || candidate.provider.apiFormat !== responseFormat)
    ) {
      return sendJson(
        res,
        {
          error: "stream_format_conversion_unsupported",
          route: route.name,
          message: "Streaming is only proxied when client and upstream provider use the same API format. Disable stream or route to a same-format provider."
        },
        400
      );
    }
    usage.increment("routes", route.name);
    incrementRoute(route.name, "requests");

    return proxyWithRetry({
      res,
      route,
      path: "/chat/completions",
      payload: body,
      responseFormat
    });
  }

  /**
   * @param {{ res: import("node:http").ServerResponse, route: object, path: string, payload: object, responseFormat: string }} params
   */
  async function proxyWithRetry({ res, route, path, payload, responseFormat }) {
    const requestStartedAt = Date.now();
    let lastError = null;
    let totalAttempt = 0;
    let lastAttemptStartedAt = requestStartedAt;

    for (const candidate of orderCandidates(route)) {
      const provider = candidate.provider;
      if (isStreamRequested(payload) && provider.apiFormat !== responseFormat) {
        lastError = {
          status: 400,
          body: {
            error: "stream_format_conversion_unsupported",
            route: route.name,
            provider: provider.name,
            message: "Streaming is only proxied when client and upstream provider use the same API format. Disable stream or route to a same-format provider."
          }
        };
        continue;
      }
      const localLimit = checkCandidateLocalLimits(route, provider, candidate.model);
      if (localLimit.limited) {
        lastError = localLimit.error;
        continue;
      }
      const attempts = Math.min(config.retry.maxAttempts, Math.max(1, getProviderKeys(provider).length || 1));

      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        totalAttempt += 1;
        stats.upstreamAttempts += 1;
        usage.increment("providers", provider.name);
        usage.increment("models", `${provider.name}:${candidate.model}`);
        incrementProvider(provider.name, "attempts");
        incrementModel(`${provider.name}:${candidate.model}`, "attempts");
        const key = keyPool.next(provider.name);
        if (!key) {
          lastError = {
            status: 503,
            body: { error: "no_available_key", route: route.name, provider: provider.name }
          };
          break;
        }

        const headers = buildUpstreamHeaders(provider, key);
        if (provider.extraHeaders && typeof provider.extraHeaders === "object") {
          Object.assign(headers, provider.extraHeaders);
        }

        const upstream = buildUpstreamRequest(provider, path, payload, candidate.model, responseFormat);
        const attemptStartedAt = Date.now();
        lastAttemptStartedAt = attemptStartedAt;
        try {
          const response = await fetch(upstream.url, {
            method: "POST",
            headers,
            body: JSON.stringify(upstream.body),
            signal: AbortSignal.timeout(config.retry.timeoutMs)
          });
          const attemptLatencyMs = Date.now() - attemptStartedAt;
          if (response.ok) {
            stats.proxied += 1;
            incrementProvider(provider.name, "ok");
            incrementRoute(route.name, "ok");
            incrementModel(`${provider.name}:${candidate.model}`, "ok");
            providerHealth.record(provider.name, { ok: true, latencyMs: attemptLatencyMs });
            usage.recordLatency("byRoute", route.name, attemptLatencyMs);
            usage.recordLatency("byProvider", provider.name, attemptLatencyMs);
            usage.recordLatency("byModel", `${provider.name}:${candidate.model}`, attemptLatencyMs);
            if (!payload?.stream) {
              recordUsageFromResponse(response.clone(), provider, candidate.model, route.name)
                .catch(() => {})
                .finally(() => { try { persistRuntimeState(); } catch {} });
            } else {
              persistRuntimeState();
            }
            recordRequestMeta(res.__openrelayReq, payload, provider.name, candidate.model, attemptStartedAt, response.status, null, totalAttempt);
            return sendUpstreamResponse(res, response, provider, responseFormat, upstream.body);
          }
          const responseText = await response.text();
          const retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
          // 401/403: non-retryable on same provider (bad key) — break inner loop
          // to try the next candidate (fallback to another provider). The request
          // is NOT discarded outright — the fallback chain still applies.
          keyPool.markFailure(provider.name, key, retryable);
          incrementProvider(provider.name, "failed");
          incrementRoute(route.name, "failed");
          incrementModel(`${provider.name}:${candidate.model}`, "failed");
          const responseCategory = response.status === 401 || response.status === 403
            ? "upstream_auth"
            : response.status === 429
              ? "upstream_429"
              : response.status >= 500 && response.status < 600
                ? "upstream_5xx"
                : "upstream_request_failed";
          recordError(`proxy:${provider.name}`, new Error(`upstream_error status=${response.status}`), responseCategory, { provider: provider.name, model: candidate.model, status: response.status });
          const rateLimitMeta = recordUpstreamHttpFailure(response, provider, candidate.model, attemptLatencyMs);
          lastError = {
            status: response.status,
            body: {
              error: "upstream_error",
              route: route.name,
              provider: provider.name,
              attempt: totalAttempt,
              status: response.status,
              body: parseMaybeJson(responseText),
              ...(rateLimitMeta ? { retryAfterMs: rateLimitMeta.cooldownMs, retryAfterUntil: rateLimitMeta.until } : {})
            }
          };
          if (!retryable || response.status === 429) break;
        } catch (error) {
          const attemptLatencyMs = Date.now() - attemptStartedAt;
          const cat = error.name === "AbortError" || /timeout/i.test(error.message || "")
            ? "upstream_timeout"
            : "upstream_request_failed";
          recordError(`proxy:${provider.name}`, error, cat, { provider: provider.name, model: candidate.model });
          keyPool.markFailure(provider.name, key, true);
          incrementProvider(provider.name, "failed");
          incrementRoute(route.name, "failed");
          incrementModel(`${provider.name}:${candidate.model}`, "failed");
          providerHealth.record(provider.name, { ok: false, latencyMs: attemptLatencyMs, error: cat });
          lastError = {
            status: 502,
            body: {
              error: "upstream_request_failed",
              route: route.name,
              provider: provider.name,
              attempt: totalAttempt,
              message: error.message
            }
          };
        }
      }
    }

    stats.failures += 1;
    persistRuntimeState();
    const providerName = lastError?.body?.provider || route.candidates?.[0]?.provider?.name || "unknown";
    recordRequestMeta(res.__openrelayReq, payload, providerName, payload?.model, lastAttemptStartedAt || requestStartedAt, lastError?.status || 502, "proxy_failed", totalAttempt);
    const attempts = buildAttemptsSummary(route, lastError);
    return sendJson(res, {
      error: "no_available_upstream",
      route: route.name,
      message: buildNoUpstreamMessage(route.name, attempts),
      attempts
    }, lastError?.status || 502);
  }

  /**
   * @param {{ res: import("node:http").ServerResponse, route: object, body: object, path: string, clientFormat: string, openResponseHeaders: object, onStream: Function }} params
   */
  async function streamWithRetry({ res, route, body, path, clientFormat, openResponseHeaders, onStream }) {
    const requestStartedAt = Date.now();
    let lastError = null;
    let totalAttempt = 0;
    let lastAttemptStartedAt = requestStartedAt;
    for (const candidate of orderCandidates(route)) {
      const provider = candidate.provider;
      const localLimit = checkCandidateLocalLimits(route, provider, candidate.model);
      if (localLimit.limited) {
        lastError = localLimit.error;
        continue;
      }
      const attempts = Math.min(config.retry.maxAttempts, Math.max(1, getProviderKeys(provider).length || 1));
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        totalAttempt += 1;
        stats.upstreamAttempts += 1;
        usage.increment("providers", provider.name);
        usage.increment("models", `${provider.name}:${candidate.model}`);
        incrementProvider(provider.name, "attempts");
        incrementModel(`${provider.name}:${candidate.model}`, "attempts");
        const key = keyPool.next(provider.name);
        if (!key) {
          lastError = { status: 503, body: { error: "no_available_key", route: route.name, provider: provider.name } };
          break;
        }
        const headers = buildUpstreamHeaders(provider, key);
        if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
        const upstream = buildUpstreamRequest(provider, path, body, candidate.model, clientFormat);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.retry.timeoutMs);
        const attemptStartedAt = Date.now();
        lastAttemptStartedAt = attemptStartedAt;
        let response;
        try {
          response = await fetch(upstream.url, {
            method: "POST",
            headers,
            body: JSON.stringify(upstream.body),
            signal: controller.signal
          });
        } catch (error) {
          const attemptLatencyMs = Date.now() - attemptStartedAt;
          const cat = error.name === "AbortError" || /timeout/i.test(error.message || "")
            ? "upstream_timeout"
            : "upstream_request_failed";
          recordError(`stream-proxy:${provider.name}`, error, cat, { provider: provider.name, model: candidate.model });
          keyPool.markFailure(provider.name, key, true);
          incrementProvider(provider.name, "failed");
          incrementRoute(route.name, "failed");
          incrementModel(`${provider.name}:${candidate.model}`, "failed");
          providerHealth.record(provider.name, { ok: false, latencyMs: attemptLatencyMs, error: cat });
          lastError = { status: 502, body: { error: cat, route: route.name, provider: provider.name, attempt: totalAttempt, message: error.message } };
          continue;
        } finally {
          clearTimeout(timeout);
        }
        const attemptLatencyMs = Date.now() - attemptStartedAt;
        if (response.ok) {
          stats.proxied += 1;
          incrementProvider(provider.name, "ok");
          incrementRoute(route.name, "ok");
          incrementModel(`${provider.name}:${candidate.model}`, "ok");
          providerHealth.record(provider.name, { ok: true, latencyMs: attemptLatencyMs });
          usage.recordLatency("byRoute", route.name, attemptLatencyMs);
          usage.recordLatency("byProvider", provider.name, attemptLatencyMs);
          usage.recordLatency("byModel", `${provider.name}:${candidate.model}`, attemptLatencyMs);
          persistRuntimeState();
          recordRequestMeta(res.__openrelayReq, body, provider.name, candidate.model, attemptStartedAt, response.status, null, totalAttempt);
          return onStream(response, provider, candidate.model);
        }
        const responseText = await response.text();
        const retryable = [408, 409, 425, 429, 500, 502, 503, 504].includes(response.status);
        // 401/403: non-retryable on same provider (bad key) — break inner loop
        // to try the next candidate (fallback to another provider).
        keyPool.markFailure(provider.name, key, retryable);
        incrementProvider(provider.name, "failed");
        incrementRoute(route.name, "failed");
        incrementModel(`${provider.name}:${candidate.model}`, "failed");
        const responseCategory = response.status === 401 || response.status === 403
          ? "upstream_auth"
          : response.status === 429
            ? "upstream_429"
            : response.status >= 500 && response.status < 600
              ? "upstream_5xx"
              : "upstream_request_failed";
        recordError(`stream-proxy:${provider.name}`, new Error(`upstream_error status=${response.status}`), responseCategory, { provider: provider.name, model: candidate.model, status: response.status });
        const rateLimitMeta = recordUpstreamHttpFailure(response, provider, candidate.model, attemptLatencyMs);
        lastError = {
          status: response.status,
          body: {
            error: "upstream_error",
            route: route.name,
            provider: provider.name,
            attempt: totalAttempt,
            status: response.status,
            body: parseMaybeJson(responseText),
            ...(rateLimitMeta ? { retryAfterMs: rateLimitMeta.cooldownMs, retryAfterUntil: rateLimitMeta.until } : {})
          }
        };
        if (!retryable || response.status === 429) break;
      }
    }
    stats.failures += 1;
    persistRuntimeState();
    const streamProviderName = lastError?.body?.provider || route.candidates?.[0]?.provider?.name || "unknown";
    recordRequestMeta(res.__openrelayReq, body, streamProviderName, body?.model, lastAttemptStartedAt || requestStartedAt, lastError?.status || 502, "stream_failed", totalAttempt);
    const streamAttempts = buildAttemptsSummary(route, lastError);
    return sendJson(res, {
      error: "no_available_upstream",
      route: route.name,
      message: buildNoUpstreamMessage(route.name, streamAttempts),
      attempts: streamAttempts
    }, lastError?.status || 502);
  }

  function buildAttemptsSummary(route, lastError) {
    if (!route || !Array.isArray(route.candidates)) return [];
    const out = [];
    for (const c of route.candidates) {
      const provider = typeof c.provider === "object" ? c.provider : config.providers.find((p) => p.name === c.provider);
      if (!provider) continue;
      let status = "unknown";
      const providerName = provider.name || c.provider;
      if (provider.keyEnv && !getProviderKeys(provider).some((k) => k !== null && k !== "")) {
        status = "missing_key";
      } else if (lastError?.body?.provider === providerName) {
        const s = lastError.body.status || 0;
        if (s === 429) status = "upstream_429";
        else if (s >= 500 && s < 600) status = "upstream_5xx";
        else if (s === 401 || s === 403) status = "auth_failed";
        else if (lastError.body.error === "upstream_request_failed" || lastError.body.error === "no_available_key") status = "connection_failed";
        else if (lastError.body.error && lastError.body.error.includes("timeout")) status = "timeout";
      } else if (!provider.keyEnv) {
        status = "connection_failed";
      }
      out.push({ provider: providerName, model: c.model, status });
    }
    return out;
  }

  function buildNoUpstreamMessage(routeName, attempts) {
    if (!attempts || attempts.length === 0) return `No usable upstream was available for ${routeName}.`;
    const missingKeys = attempts.filter((a) => a.status === "missing_key");
    const failedLocal = attempts.filter((a) => a.status === "connection_failed" && !a.provider.includes(".com") && !a.provider.includes("api."));
    const parts = [];
    if (missingKeys.length > 0) {
      const envVars = missingKeys.map((a) => {
        const prov = config.providers.find((p) => p.name === a.provider);
        return prov?.keyEnv || `${a.provider.toUpperCase()}_API_KEYS`;
      });
      parts.push(`Add ${envVars.join("/")}`);
    }
    if (failedLocal.length > 0) {
      const localNames = failedLocal.map((a) => a.provider).join(", ");
      parts.push(`Start ${localNames} or check the service is running on localhost`);
    }
    if (parts.length === 0) {
      return `No usable upstream was available for ${routeName}. Check provider configurations.`;
    }
    return `No usable upstream was available for ${routeName}. ${parts.join(", or ")}.`;
  }

  function recordUpstreamHttpFailure(response, provider, model, latencyMs) {
    const error = `upstream_error status=${response.status}`;
    if (response.status !== 429) {
      providerHealth.record(provider.name, { ok: false, latencyMs, error });
      return null;
    }
    const retryAfterMs = parseRetryAfterMs(response.headers?.get?.("retry-after"));
    const cooldownMs = retryAfterMs || Math.max(1000, Number(config.retry?.cooldownMs || 30000));
    const until = Date.now() + cooldownMs;
    if (typeof providerHealth.recordRateLimit === "function") {
      providerHealth.recordRateLimit(provider.name, until, `retry_after_ms=${cooldownMs}`);
    }
    providerHealth.record(provider.name, { ok: false, latencyMs, error: `${error} retry_after_ms=${cooldownMs}` });
    return { cooldownMs, until };
  }

  function parseRetryAfterMs(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d+(\.\d+)?$/.test(text)) {
      return clampRetryAfterMs(Math.ceil(Number(text) * 1000));
    }
    const dateMs = Date.parse(text);
    if (!Number.isFinite(dateMs)) return null;
    return clampRetryAfterMs(dateMs - Date.now());
  }

  function clampRetryAfterMs(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return Math.min(Math.max(1000, Math.ceil(ms)), 24 * 60 * 60 * 1000);
  }

  /**
   * @param {object} provider
   * @param {object} key
   * @returns {object}
   */
  function buildUpstreamHeaders(provider, key) {
    const headers = { "content-type": "application/json" };
    if (!key.value) return headers;
    if (provider.apiFormat === "anthropic") {
      headers["x-api-key"] = key.value;
      headers["anthropic-version"] = provider.anthropicVersion || "2023-06-01";
    } else {
      headers.authorization = `Bearer ${key.value}`;
    }
    return headers;
  }

  /**
   * @param {object} provider
   * @param {string} path
   * @param {object} payload
   * @param {string} model
   * @param {string} [clientFormat]
   * @returns {{ url: string, body: object }}
   */
  function buildUpstreamRequest(provider, path, payload, model, clientFormat) {
    if (clientFormat) {
      if (clientFormat === provider.apiFormat) {
        return { url: pathForFormat(provider, path), body: { ...payload, model } };
      }
      if (clientFormat === "anthropic" && provider.apiFormat === "openai") {
        return { url: `${provider.baseUrl}${path}`, body: anthropicToOpenAi(payload, model) };
      }
      if (clientFormat === "openai" && provider.apiFormat === "anthropic") {
        return { url: `${provider.baseUrl}/messages`, body: openAiToAnthropic(payload, model) };
      }
    }
    if (provider.apiFormat === "anthropic") {
      return {
        url: `${provider.baseUrl}/messages`,
        body: payload.messages ? openAiToAnthropic(payload, model) : { ...payload, model }
      };
    }

    return {
      url: `${provider.baseUrl}${path}`,
      body: payload.messages ? { ...payload, model } : anthropicToOpenAi(payload, model)
    };
  }

  /**
   * @param {object} provider
   * @param {string} path
   * @returns {string}
   */
  function pathForFormat(provider, path) {
    return provider.apiFormat === "anthropic" ? `${provider.baseUrl}/messages` : `${provider.baseUrl}${path}`;
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {Response} response
   * @param {object} provider
   * @param {string} responseFormat
   * @param {object} requestBody
   */
  async function sendUpstreamResponse(res, response, provider, responseFormat, requestBody) {
    if (responseFormat === "responses") {
      if (requestBody?.stream) {
        return sendJson(
          res,
          {
            error: "responses_stream_unsupported",
            message: "The /v1/responses compatibility endpoint currently supports non-streaming requests. Use /v1/chat/completions for stream:true."
          },
          400
        );
      }
      const responseText = await response.text();
      const parsed = parseMaybeJson(responseText);
      const converted = provider.apiFormat === "anthropic"
        ? anthropicResponseToResponses(parsed)
        : openAiResponseToResponses(parsed);
      return sendJson(res, converted, response.status);
    }

    const sameFormat = responseFormat === provider.apiFormat;
    if (sameFormat) {
      return sendSameFormatResponse(res, response);
    }

    if (requestBody?.stream) {
      return sendJson(
        res,
        {
          error: "stream_format_conversion_unsupported",
          message: "Streaming is only proxied when client and upstream provider use the same API format. Disable stream or route to a same-format provider."
        },
        400
      );
    }

    const responseText = await response.text();
    const parsed = parseMaybeJson(responseText);
    const converted = responseFormat === "anthropic"
      ? openAiResponseToAnthropic(parsed)
      : anthropicResponseToOpenAi(parsed);
    return sendJson(res, converted, response.status);
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {Response} response
   */
  async function sendSameFormatResponse(res, response) {
    res.writeHead(response.status, copyResponseHeaders(response.headers, res.__openrelayReq));
    if (!response.body) {
      res.end();
      return;
    }

    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout(reader, config.retry.streamIdleTimeoutMs);
        if (done) break;
        if (value) res.write(Buffer.from(value));
      }
    } catch (error) {
      const code = error.streamFailureCode || "stream_idle_timeout";
      recordError("stream:idle", error, code, { elapsedMs: config.retry.streamIdleTimeoutMs });
    } finally {
      res.end();
      reader.releaseLock();
    }
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {Response} response
   * @param {object} provider
   * @param {string} model
   * @param {object} originalBody
   */
  async function streamResponsesFromUpstream(res, response, provider, model, originalBody) {
    const { createResponsesSseBridge } = await import("../responses-stream.js");
    const bridge = createResponsesSseBridge({
      requestModel: model,
      instructions: originalBody?.instructions,
      inputSummary: summarizeInput(originalBody?.input),
      onUsage: (usage) => recordStreamUsage(usage, originalBody?.model || model, provider, model)
    });
    res.writeHead(200, withCorsHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no"
    }, res.__openrelayReq));
    res.write(`event: response.created\ndata: ${JSON.stringify({ id: bridge.responseId, object: "response", status: "in_progress", model, created_at: Math.floor(Date.now() / 1000), output: [] })}\n\n`);
    res.write(`event: response.in_progress\ndata: ${JSON.stringify({ id: bridge.responseId, object: "response", status: "in_progress", model, created_at: Math.floor(Date.now() / 1000), output: [] })}\n\n`);
    if (!response.body) {
      for (const event of bridge.finalize()) res.write(event);
      res.end();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let failed = false;
    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout(reader, config.retry.streamIdleTimeoutMs);
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        let transform;
        try {
          transform = provider.apiFormat === "anthropic" ? bridge.transformAnthropicRaw(text) : bridge.transformChunk(text);
        } catch (error) {
          error.streamFailureCode = "stream_parse_failed";
          throw error;
        }
        for (const event of transform) res.write(event);
      }
    } catch (error) {
      failed = true;
      const failureCode = error.streamFailureCode || "stream_read_failed";
      recordError(`responses-stream:${provider.name}`, error, failureCode, { provider: provider.name, model });
      res.write(`event: response.failed\ndata: ${JSON.stringify({ error: failureCode, message: error.message })}\n\n`);
    } finally {
      if (!failed) {
        for (const event of bridge.finalize()) res.write(event);
      }
      res.end();
      reader.releaseLock();
    }
  }

  /**
   * @param {*} input
   * @returns {string}
   */
  function summarizeInput(input) {
    if (typeof input === "string") return input;
    if (!Array.isArray(input)) return "";
    return input
      .map((item) => (typeof item === "string" ? item : item?.text || item?.content || ""))
      .filter(Boolean)
      .join(" ")
      .slice(0, 240);
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {Response} response
   * @param {object} provider
   * @param {string} model
   * @param {object} originalBody
   */
  async function streamAnthropicMessagesFromUpstream(res, response, provider, model, originalBody) {
    const requestModel = originalBody?.model || model;
    res.writeHead(200, withCorsHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no"
    }, res.__openrelayReq));
    const bridge = provider.apiFormat === "openai"
      ? createOpenAiToAnthropicSseBridge({
          requestModel,
          upstreamModel: provider.name,
          onUsage: (usage) => recordStreamUsage(usage, requestModel, provider, model)
        })
      : makePassthroughBridge();
    let failed = false;
    if (!response.body) {
      for (const event of bridge.finalize()) res.write(event);
      res.end();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout(reader, config.retry.streamIdleTimeoutMs);
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        let out;
        try {
          out = provider.apiFormat === "openai" ? bridge.transformChunk(text) : passthroughChunk(text);
        } catch (error) {
          error.streamFailureCode = error.streamFailureCode || "stream_parse_failed";
          throw error;
        }
        for (const chunk of out) res.write(chunk);
      }
    } catch (error) {
      failed = true;
      const code = error.streamFailureCode || "stream_read_failed";
      recordError(`anthropic-stream:${provider.name}`, error, code, { provider: provider.name, model });
      res.write(`event: error\ndata: ${JSON.stringify({ type: "error", error: { type: code, message: error.message } })}\n\n`);
    } finally {
      if (!failed) {
        for (const event of bridge.finalize()) res.write(event);
      }
      res.end();
      reader.releaseLock();
    }
  }

  /**
   * @param {import("node:http").ServerResponse} res
   * @param {Response} response
   * @param {object} provider
   * @param {string} model
   * @param {object} originalBody
   */
  async function streamOpenAiChatFromUpstream(res, response, provider, model, originalBody) {
    const requestModel = originalBody?.model || model;
    res.writeHead(200, withCorsHeaders({
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "x-accel-buffering": "no"
    }, res.__openrelayReq));
    const bridge = provider.apiFormat === "anthropic"
      ? createAnthropicToOpenAiSseBridge({
          requestModel,
          upstreamModel: provider.name,
          onUsage: (usage) => recordStreamUsage(usage, requestModel, provider, model)
        })
      : makePassthroughBridge({
          onUsage: (usage) => recordStreamUsage(usage, requestModel, provider, model)
        });
    let failed = false;
    if (!response.body) {
      for (const event of bridge.finalize()) res.write(event);
      res.end();
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await readWithIdleTimeout(reader, config.retry.streamIdleTimeoutMs);
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        let out;
        try {
          out = provider.apiFormat === "anthropic" ? bridge.transformAnthropicRaw(text) : bridge.transformChunk(text);
        } catch (error) {
          error.streamFailureCode = error.streamFailureCode || "stream_parse_failed";
          throw error;
        }
        for (const chunk of out) res.write(chunk);
      }
    } catch (error) {
      failed = true;
      const code = error.streamFailureCode || "stream_read_failed";
      recordError(`openai-chat-stream:${provider.name}`, error, code, { provider: provider.name, model });
      res.write(`data: ${JSON.stringify({ error: code, message: error.message })}\n\n`);
    } finally {
      if (!failed) {
        for (const event of bridge.finalize()) res.write(event);
      }
      res.end();
      reader.releaseLock();
    }
  }

  /**
   * @param {{ onUsage?: Function } | undefined} options
   * @returns {object}
   */
  function makePassthroughBridge({ onUsage } = {}) {
    let bufferedUsage = null;
    return {
      transformChunk: (text) => {
        if (text) {
          for (const line of text.split(/\r?\n/)) {
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed && typeof parsed === "object" && parsed.usage && typeof parsed.usage === "object") {
                  bufferedUsage = parsed.usage;
                }
              } catch {}
            }
          }
        }
        return passthroughChunk(text);
      },
      transformAnthropicRaw: (text) => {
        if (text) {
          for (const line of text.split(/\r?\n/)) {
            if (line.startsWith("data:")) {
              const payload = line.slice(5).trim();
              if (!payload || payload === "[DONE]") continue;
              try {
                const parsed = JSON.parse(payload);
                if (parsed && typeof parsed === "object" && parsed.usage && typeof parsed.usage === "object") {
                  bufferedUsage = parsed.usage;
                }
              } catch {}
            }
          }
        }
        return passthroughChunk(text);
      },
      finalize: () => {
        if (bufferedUsage && typeof onUsage === "function") {
          try { onUsage(bufferedUsage); } catch {}
        }
        return [];
      }
    };
  }

  /**
   * @param {string} text
   * @returns {Array<string>}
   */
  function passthroughChunk(text) {
    return text ? [text] : [];
  }

  /**
   * @param {Response} response
   * @param {object} provider
   * @param {string} model
   * @param {string} routeName
   */
  async function recordUsageFromResponse(response, provider, model, routeName) {
    try {
      const text = await response.text();
      if (!text) return;
      const parsed = parseMaybeJson(text);
      if (!parsed || typeof parsed !== "object") return;
      const sourceUsage = (provider.apiFormat === "anthropic" && parsed.usage)
        || parsed.usage
        || null;
      const normalizedUsage = normalizeUsage(sourceUsage);
      if (!normalizedUsage) return;
      usage.recordTokens("byRoute", routeName, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
      usage.recordTokens("byProvider", provider.name, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
      usage.recordTokens("byModel", `${provider.name}:${model}`, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
    } catch {}
  }

  /**
   * @param {object} rawUsage
   * @param {string} requestModel
   * @param {object} provider
   * @param {string} model
   */
  function recordStreamUsage(rawUsage, requestModel, provider, model) {
    const normalizedUsage = normalizeUsage(rawUsage);
    if (!normalizedUsage) return;
    const routeName = activeRouteNameForModel(requestModel) || "(direct)";
    usage.recordTokens("byRoute", routeName, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
    usage.recordTokens("byProvider", provider.name, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
    usage.recordTokens("byModel", `${provider.name}:${model}`, normalizedUsage.prompt_tokens, normalizedUsage.completion_tokens);
    try { persistRuntimeState(); } catch {}
  }

  /**
   * @param {string} model
   * @returns {string|null}
   */
  function activeRouteNameForModel(model) {
    try {
      const route = selectRoute(model);
      return route ? route.name : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {ReadableStreamDefaultReader} reader
   * @param {number} timeoutMs
   * @returns {Promise<object>}
   */
  async function readWithIdleTimeout(reader, timeoutMs) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new Error(`upstream stream idle timeout after ${timeoutMs}ms`);
        error.streamFailureCode = "stream_idle_timeout";
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        reader.read().catch((error) => {
          error.streamFailureCode = error.streamFailureCode || "stream_read_failed";
          throw error;
        }),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * @param {object} provider
   * @param {string} keyValue
   * @param {string} providerName
   * @param {string} [requestedModel]
   * @returns {Promise<object>}
   */
  async function testProviderWithKey(provider, keyValue, providerName, requestedModel) {
    const model = requestedModel || provider.models[0];
    if (!model) return { ok: false, provider: providerName, error: "no_model_configured" };
    const startedAt = Date.now();
    const fakeKey = { value: keyValue };
    const headers = buildUpstreamHeaders(provider, fakeKey);
    if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
    const payload = {
      model,
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 8,
      temperature: 0
    };
    const upstream = buildUpstreamRequest(provider, "/chat/completions", payload, model);
    try {
      const response = await fetch(upstream.url, {
        method: "POST",
        headers,
        body: JSON.stringify(upstream.body),
        signal: AbortSignal.timeout(15000)
      });
      const responseText = await response.text();
      const elapsedMs = Date.now() - startedAt;
      const result = {
        ok: response.ok,
        provider: providerName,
        model,
        status: response.status,
        elapsedMs,
        body: response.ok ? "ok" : parseMaybeJson(responseText)
      };
      healthCache[providerName] = { ...result, checkedAt: new Date().toISOString() };
      persistRuntimeState();
      return result;
    } catch (error) {
      const result = {
        ok: false,
        provider: providerName,
        model,
        error: "request_failed",
        message: error.message,
        elapsedMs: Date.now() - startedAt
      };
      healthCache[providerName] = { ...result, checkedAt: new Date().toISOString() };
      persistRuntimeState();
      recordError(`test-provider:${providerName}`, error, "upstream_request_failed", { provider: providerName, elapsedMs: Date.now() - startedAt });
      return result;
    }
  }

  return {
    handleModels,
    handleChatCompletions,
    handleChatCompletionsStream,
    handleAnthropicMessages,
    handleAnthropicMessagesStream,
    handleOpenAIResponses,
    handleResponsesStream,
    handleUnifiedChatRequest,
    proxyWithRetry,
    streamWithRetry,
    buildUpstreamHeaders,
    buildUpstreamRequest,
    pathForFormat,
    sendUpstreamResponse,
    sendSameFormatResponse,
    streamResponsesFromUpstream,
    summarizeInput,
    streamAnthropicMessagesFromUpstream,
    streamOpenAiChatFromUpstream,
    makePassthroughBridge,
    passthroughChunk,
    recordUsageFromResponse,
    recordStreamUsage,
    activeRouteNameForModel,
    readWithIdleTimeout,
    testProviderWithKey,
    handleProviderDirect,
    buildDirectRoute
  };
}
