/**
 * @param {object} handlers
 * @param {object} ctx
 * @returns {function}
 */
export function createRouter(handlers, ctx) {
  return async function handleRequest(req, res) {
    try {
      res.__openrelayReq = req;
      if (ctx.isAdminPath(req) && !ctx.isAllowedAdminOrigin(req, ctx.port)) return ctx.forbiddenCors(res);
      if (req.method === "OPTIONS") return ctx.sendNoContent(res);
      if (ctx.isAdminPath(req) && !ctx.isAuthorized(req)) return ctx.unauthorized(res);
      if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/?"))) {
        if (!ctx.isAuthorized(req)) return ctx.sendHtml(res, ctx.renderTokenPrompt(ctx.port));
        return ctx.sendHtml(res, ctx.renderDashboard(ctx.buildStatus(), ctx.port, { locale: ctx.getLocale(req) }));
      }
      if (req.method === "GET" && req.url === "/health") return ctx.sendJson(res, ctx.buildHealth());
      if (req.method === "GET" && req.url === "/admin/status") return ctx.sendJson(res, ctx.buildStatus());
      if (req.method === "GET" && req.url === "/admin/usage") return ctx.sendJson(res, ctx.usageSummary());
      if (req.method === "GET" && req.url === "/admin/health-cache") return ctx.sendJson(res, ctx.healthCache);
      if (req.method === "GET" && req.url === "/admin/model-discovery") return ctx.sendJson(res, ctx.modelDiscoveryCache);
      if (req.method === "GET" && req.url === "/admin/balance-cache") return ctx.sendJson(res, ctx.balanceCache);
      if (req.method === "GET" && req.url === "/admin/error-log") return ctx.sendJson(res, ctx.recentErrors);
      if (req.method === "GET" && req.url.startsWith("/admin/ide-proxy-preview")) return handlers.handleIdeProxyPreview(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/ide-proxy-status")) return handlers.handleIdeProxyStatus(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/ide-proxy-port-check")) return handlers.handleIdeProxyPortCheck(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/ide-proxy-start-plan")) return handlers.handleIdeProxyStartPlan(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/local-connector-plan")) return handlers.handleLocalConnectorPlan(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/local-connector-availability")) return handlers.handleLocalConnectorAvailability(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/local-connector-provider-preview")) return handlers.handleLocalConnectorProviderPreview(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/local-connector-consent-manifest")) return handlers.handleLocalConnectorConsentManifest(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/local-connector-consent-ledger")) return handlers.handleLocalConnectorConsentLedger(req, res);
      if (req.method === "POST" && req.url === "/admin/local-connector-consent") return handlers.handleLocalConnectorConsent(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/provider-test-preview")) return handlers.handleProviderTestPreview(req, res);
      if (req.method === "GET" && req.url === "/admin/test-all") return handlers.handleTestAll(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/preview-route")) return handlers.handlePreviewRoute(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/render-tab")) return handlers.handleRenderTab(req, res);
      if (req.method === "GET" && req.url === "/admin/config") return ctx.sendJson(res, ctx.sanitizedConfig());
      if (req.method === "GET" && req.url === "/admin/config/raw") return handlers.handleGetRawConfig(req, res);
      if (req.method === "GET" && req.url === "/admin/config/export") return handlers.handleExportConfig(req, res);
      if (req.method === "GET" && req.url === "/admin/profile") return handlers.handleGetProfile(req, res);
      if (req.method === "POST" && req.url === "/admin/locale") return handlers.handleSetLocale(req, res);
      if (req.method === "POST" && req.url === "/admin/config") return handlers.handleSaveConfig(req, res);
      if (req.method === "POST" && req.url === "/admin/config/import") return handlers.handleImportConfig(req, res);
      if (req.method === "POST" && req.url === "/admin/profile") return handlers.handleSetProfile(req, res);
      if (req.method === "POST" && req.url === "/admin/profile/update") return handlers.handleUpdateProfile(req, res);
      if (req.method === "POST" && req.url === "/admin/profile/clone") return handlers.handleCloneProfile(req, res);
      if (req.method === "POST" && req.url === "/admin/profile/delete") return handlers.handleDeleteProfile(req, res);
      if (req.method === "GET" && req.url === "/admin/providers") return handlers.handleListProviders(req, res);
      if (req.method === "GET" && req.url === "/admin/provider-templates") return handlers.handleProviderTemplates(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/provider-template-parity")) return handlers.handleProviderTemplateParity(req, res);
      if (req.method === "GET" && req.url.startsWith("/admin/provider-template-import-plan")) return handlers.handleProviderTemplateImportPlan(req, res);
      if (req.method === "POST" && req.url === "/admin/provider-template-import") return handlers.handleProviderTemplateImport(req, res);
      if (req.method === "POST" && req.url === "/admin/providers") return handlers.handleCreateProvider(req, res);
      if (req.method === "POST" && req.url.startsWith("/admin/providers/") && req.url.endsWith("/keys")) return handlers.handleAddProviderKey(req, res);
      if (req.method === "PATCH" && req.url.startsWith("/admin/providers/")) return handlers.handleUpdateProvider(req, res);
      if (req.method === "DELETE" && req.url.startsWith("/admin/providers/")) return handlers.handleDeleteProvider(req, res);
      if (req.method === "GET" && req.url === "/admin/routes") return handlers.handleListRoutes(req, res);
      if (req.method === "GET" && req.url === "/admin/route-templates") return handlers.handleRouteTemplates(req, res);
      if (req.method === "POST" && req.url === "/admin/routes") return handlers.handleCreateRoute(req, res);
      if (req.method === "PATCH" && req.url.startsWith("/admin/routes/")) return handlers.handleUpdateRoute(req, res);
      if (req.method === "DELETE" && req.url.startsWith("/admin/routes/")) return handlers.handleDeleteRoute(req, res);
      if (req.method === "POST" && req.url === "/admin/test-provider") return handlers.handleTestProvider(req, res);
      if (req.method === "POST" && req.url === "/admin/discover-models") return handlers.handleDiscoverModels(req, res);
      if (req.method === "POST" && req.url === "/admin/balance") return handlers.handleCheckBalance(req, res);
      if (req.method === "GET" && (req.url === "/admin/keys" || req.url.startsWith("/admin/keys?"))) return handlers.handleListKeys(req, res);
      if (req.method === "GET" && req.url === "/admin/auth/token") return handlers.handleGetAuthToken(req, res);
      if (req.method === "GET" && req.url === "/admin/keystore-status") {
        if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
        return ctx.sendJson(res, {
          ok: true,
          masterKeyOnDisk: ctx.secretStore.hasMasterKeyOnDisk(),
          masterKeyInEnv: ctx.secretStore.hasMasterKeyInEnv(),
          keyCount: ctx.secretStore.list().length
        });
      }
      if (req.method === "POST" && req.url === "/admin/keys") return handlers.handleAddKey(req, res);
      if (req.method === "POST" && req.url === "/admin/keys/test-raw") return handlers.handleTestRawKey(req, res);
      if (req.method === "POST" && req.url.startsWith("/admin/keys/") && req.url.endsWith("/test")) return handlers.handleTestKey(req, res);
      if (req.method === "PATCH" && req.url.startsWith("/admin/keys/")) return handlers.handleUpdateKey(req, res);
      if (req.method === "DELETE" && req.url.startsWith("/admin/keys/")) return handlers.handleDeleteKey(req, res);
      if (req.method === "GET" && req.url === "/v1/models") {
        const publicModels = ctx.config?.auth?.publicModels === true;
        if (!publicModels && !ctx.isAuthorizedV1(req)) {
          return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required for /v1/models; set auth.publicModels=true to allow public access" }, 401);
        }
        return handlers.handleModels(req, res);
      }
      // Provider direct path: /{provider}/v1/{path}
      // e.g. /deepseek/v1/chat/completions, /ollama/v1/models
      const providerDirectMatch = typeof req.url === "string" && req.url.match(/^\/([A-Za-z0-9_-]+)\/v1\/(chat\/completions|messages|responses|models)$/);
      if (providerDirectMatch) {
        if (!ctx.isAuthorizedV1(req)) {
          return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required; see /admin/status for the current auth state" }, 401);
        }
        return handlers.handleProviderDirect(req, res, providerDirectMatch[1], providerDirectMatch[2]);
      }
      if (ctx.isProxyPath(req.url) && !ctx.isAuthorizedV1(req)) {
        return ctx.sendJson(res, { error: "unauthorized", message: "Bearer token required; see /admin/status for the current auth state" }, 401);
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") return handlers.handleChatCompletions(req, res);
      if (req.method === "POST" && req.url === "/v1/responses") return handlers.handleOpenAIResponses(req, res);
      if (req.method === "POST" && req.url === "/v1/messages") return handlers.handleAnthropicMessages(req, res);
      return ctx.sendJson(res, { error: "not_found" }, 404);
    } catch (error) {
      ctx.stats.failures += 1;
      ctx.recordError("server", error, "upstream_request_failed");
      if (process.env.OPENRELAY_DEBUG) console.error("[server] error on", req.method, req.url, ":", error.message, "\n", error.stack);
      return ctx.sendJson(res, { error: "internal_error", message: error.message }, 500);
    }
  };
}
