/**
 * 创建路由处理器。使用静态路由表 Map 实现 O(1) 精确匹配，
 * 仅对带路径参数的动态路由使用顺序匹配。
 * @param {object} handlers
 * @param {object} ctx
 * @param {object} [rateLimiter]
 * @returns {function}
 */
export function createRouter(handlers, ctx, rateLimiter) {
  // ---- 静态路由表：在初始化时构建一次，请求时 O(1) 查找 ----
  // key 格式: "${method} ${path}"（path 已去除 query string）
  const staticRoutes = new Map();
  const r = (method, path, handler) => staticRoutes.set(`${method} ${path}`, handler);

  // V1 代理路由鉴权包装
  const requireV1Auth = (handler) => (req, res) => {
    if (!ctx.isAuthorizedV1(req)) {
      return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required; see /admin/status for the current auth state" }, 401);
    }
    return handler(req, res);
  };

  // ---- GET 精确路由 ----
  r("GET", "/", (req, res) => {
    if (!ctx.isAuthorized(req)) return ctx.sendHtml(res, ctx.renderTokenPrompt(ctx.port));
    return ctx.sendHtml(res, ctx.renderDashboard(ctx.buildStatus(), ctx.port, { locale: ctx.getLocale(req) }));
  });
  r("GET", "/health", (req, res) => ctx.sendJson(res, ctx.buildHealth()));
  r("GET", "/admin/status", (req, res) => ctx.sendJson(res, ctx.buildStatus()));
  r("GET", "/admin/usage", (req, res) => ctx.sendJson(res, ctx.usageSummary()));
  r("GET", "/admin/health-cache", (req, res) => ctx.sendJson(res, ctx.healthCache));
  r("GET", "/admin/model-discovery", (req, res) => ctx.sendJson(res, ctx.modelDiscoveryCache));
  r("GET", "/admin/balance-cache", (req, res) => ctx.sendJson(res, ctx.balanceCache));
  r("GET", "/admin/error-log", (req, res) => ctx.sendJson(res, ctx.recentErrors));
  r("GET", "/admin/ide-proxy-preview", handlers.handleIdeProxyPreview);
  r("GET", "/admin/ide-proxy-status", handlers.handleIdeProxyStatus);
  r("GET", "/admin/ide-proxy-port-check", handlers.handleIdeProxyPortCheck);
  r("GET", "/admin/ide-proxy-start-plan", handlers.handleIdeProxyStartPlan);
  r("GET", "/admin/local-connector-plan", handlers.handleLocalConnectorPlan);
  r("GET", "/admin/local-connector-availability", handlers.handleLocalConnectorAvailability);
  r("GET", "/admin/local-connector-provider-preview", handlers.handleLocalConnectorProviderPreview);
  r("GET", "/admin/local-connector-consent-manifest", handlers.handleLocalConnectorConsentManifest);
  r("GET", "/admin/local-connector-consent-ledger", handlers.handleLocalConnectorConsentLedger);
  r("GET", "/admin/provider-test-preview", handlers.handleProviderTestPreview);
  r("GET", "/admin/test-all", handlers.handleTestAll);
  r("GET", "/admin/preview-route", handlers.handlePreviewRoute);
  r("GET", "/admin/render-tab", handlers.handleRenderTab);
  r("GET", "/admin/config", (req, res) => ctx.sendJson(res, ctx.sanitizedConfig()));
  r("GET", "/admin/config/raw", handlers.handleGetRawConfig);
  r("GET", "/admin/config/export", handlers.handleExportConfig);
  r("GET", "/admin/profile", handlers.handleGetProfile);
  r("GET", "/admin/providers", handlers.handleListProviders);
  r("GET", "/admin/provider-templates", handlers.handleProviderTemplates);
  r("GET", "/admin/provider-template-parity", handlers.handleProviderTemplateParity);
  r("GET", "/admin/provider-template-import-plan", handlers.handleProviderTemplateImportPlan);
  r("GET", "/admin/routes", handlers.handleListRoutes);
  r("GET", "/admin/route-templates", handlers.handleRouteTemplates);
  r("GET", "/admin/keys", handlers.handleListKeys);
  r("GET", "/admin/auth/token", handlers.handleGetAuthToken);
  r("GET", "/admin/keystore-status", (req, res) => {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      ok: true,
      masterKeyOnDisk: ctx.secretStore.hasMasterKeyOnDisk(),
      masterKeyInEnv: ctx.secretStore.hasMasterKeyInEnv(),
      keyCount: ctx.secretStore.list().length
    });
  });
  r("GET", "/v1/models", (req, res) => {
    const publicModels = ctx.config?.auth?.publicModels === true;
    if (!publicModels && !ctx.isAuthorizedV1(req)) {
      return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required for /v1/models; set auth.publicModels=true to allow public access" }, 401);
    }
    return handlers.handleModels(req, res);
  });

  // ---- POST 精确路由 ----
  r("POST", "/admin/local-connector-consent", handlers.handleLocalConnectorConsent);
  r("POST", "/admin/locale", handlers.handleSetLocale);
  r("POST", "/admin/config", handlers.handleSaveConfig);
  r("POST", "/admin/config/import", handlers.handleImportConfig);
  r("POST", "/admin/profile", handlers.handleSetProfile);
  r("POST", "/admin/profile/update", handlers.handleUpdateProfile);
  r("POST", "/admin/profile/clone", handlers.handleCloneProfile);
  r("POST", "/admin/profile/delete", handlers.handleDeleteProfile);
  r("POST", "/admin/provider-template-import", handlers.handleProviderTemplateImport);
  r("POST", "/admin/providers", handlers.handleCreateProvider);
  r("POST", "/admin/routes", handlers.handleCreateRoute);
  r("POST", "/admin/test-provider", handlers.handleTestProvider);
  r("POST", "/admin/discover-models", handlers.handleDiscoverModels);
  r("POST", "/admin/balance", handlers.handleCheckBalance);
  r("POST", "/admin/keys", handlers.handleAddKey);
  r("POST", "/admin/keys/test-raw", handlers.handleTestRawKey);
  r("POST", "/v1/chat/completions", requireV1Auth(handlers.handleChatCompletions));
  r("POST", "/v1/responses", requireV1Auth(handlers.handleOpenAIResponses));
  r("POST", "/v1/messages", requireV1Auth(handlers.handleAnthropicMessages));

  // ---- 动态路由：带路径参数，需 prefix/suffix 匹配 ----
  // 按方法分组，匹配时先检查 method 再检查 prefix/suffix
  const dynamicRoutes = [
    { method: "POST", prefix: "/admin/providers/", suffix: "/keys", handler: handlers.handleAddProviderKey },
    { method: "PATCH", prefix: "/admin/providers/", handler: handlers.handleUpdateProvider },
    { method: "DELETE", prefix: "/admin/providers/", handler: handlers.handleDeleteProvider },
    { method: "PATCH", prefix: "/admin/routes/", handler: handlers.handleUpdateRoute },
    { method: "DELETE", prefix: "/admin/routes/", handler: handlers.handleDeleteRoute },
    { method: "POST", prefix: "/admin/keys/", suffix: "/test", handler: handlers.handleTestKey },
    { method: "PATCH", prefix: "/admin/keys/", handler: handlers.handleUpdateKey },
    { method: "DELETE", prefix: "/admin/keys/", handler: handlers.handleDeleteKey },
  ];

  // Provider direct path 正则: /{provider}/v1/{path}
  const providerDirectRe = /^\/([A-Za-z0-9_-]+)\/v1\/(chat\/completions|messages|responses|models)$/;

  return async function handleRequest(req, res) {
    try {
      res.__openrelayReq = req;

      // 速率限制检查
      if (rateLimiter) {
        const isAdmin = ctx.isAdminPath(req);
        const rateResult = rateLimiter.check(req, isAdmin);
        if (!rateResult.ok) {
          res.writeHead(429, {
            "content-type": "application/json; charset=utf-8",
            "retry-after": Math.ceil((rateResult.resetAt - Date.now()) / 1000),
            "x-ratelimit-remaining": 0,
            "x-ratelimit-reset": rateResult.resetAt
          });
          res.end(JSON.stringify({
            ok: false,
            error: "rate_limit_exceeded",
            message: "Too many requests. Please try again later.",
            details: { retryAfterMs: rateResult.resetAt - Date.now() }
          }));
          return;
        }
        if (rateResult.remaining !== undefined) {
          res.setHeader("x-ratelimit-remaining", rateResult.remaining);
          res.setHeader("x-ratelimit-reset", rateResult.resetAt);
        }
      }

      // 前置检查：CORS、OPTIONS、admin 鉴权
      if (ctx.isAdminPath(req) && !ctx.isAllowedAdminOrigin(req, ctx.port)) return ctx.forbiddenCors(res);
      if (req.method === "OPTIONS") return ctx.sendNoContent(res);
      if (ctx.isAdminPath(req) && !ctx.isAuthorized(req)) return ctx.unauthorized(res);

      // 去除 query string，用于路由匹配
      const path = req.url.split("?", 1)[0];

      // O(1) 精确匹配
      const staticHandler = staticRoutes.get(`${req.method} ${path}`);
      if (staticHandler) return staticHandler(req, res);

      // 动态路由匹配（路径参数）
      for (const route of dynamicRoutes) {
        if (req.method !== route.method) continue;
        if (!path.startsWith(route.prefix)) continue;
        if (route.suffix && !path.endsWith(route.suffix)) continue;
        return route.handler(req, res);
      }

      // Provider direct path: /{provider}/v1/{path}
      const providerDirectMatch = path.match(providerDirectRe);
      if (providerDirectMatch) {
        if (!ctx.isAuthorizedV1(req)) {
          return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required; see /admin/status for the current auth state" }, 401);
        }
        return handlers.handleProviderDirect(req, res, providerDirectMatch[1], providerDirectMatch[2]);
      }

      // 代理路径鉴权门控（覆盖未匹配方法的 proxy path，如 GET /v1/chat/completions）
      if (ctx.isProxyPath(req.url) && !ctx.isAuthorizedV1(req)) {
        return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required; see /admin/status for the current auth state" }, 401);
      }

      return ctx.sendJson(res, { error: "not_found" }, 404);
    } catch (error) {
      ctx.stats.failures += 1;
      ctx.recordError("server", error, "upstream_request_failed");
      if (process.env.OPENRELAY_DEBUG) console.error("[server] error on", req.method, req.url, ":", error.message, "\n", error.stack);
      return ctx.sendJson(res, { error: "internal_error", message: error.message }, 500);
    }
  };
}
