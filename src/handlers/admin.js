import { validateConfig } from "../config-schema.js";
import { resolveRoutePreview } from "../route-preview.js";
import { buildIdeProxyPreview } from "../ide-proxy-preview.js";
import { buildIdeProxyRuntimeStatus } from "../ide-proxy-runtime.js";
import { buildIdeProxyPortCheck } from "../ide-proxy-port-check.js";
import { buildIdeProxyStartPlan } from "../ide-proxy-start-plan.js";
import { maskToken } from "../auth.js";
import { I18N_SUPPORTED_LOCALES } from "../i18n.js";
import { withCorsHeaders } from "../http-helpers.js";
import { isLocalProvider as registryIsLocalProvider } from "../provider-registry.js";
import { buildProviderTestReport } from "../provider-test.js";
import { buildLocalConnectorPlan } from "../local-connector-plan.js";
import { buildLocalConnectorAvailability } from "../local-connector-availability.js";
import { buildLocalConnectorProviderPreview } from "../local-connector-provider-preview.js";
import { buildLocalConnectorConsentManifest } from "../local-connector-consent-manifest.js";
import {
  LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION,
  LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION,
  buildLocalConnectorConsentCandidate,
  buildLocalConnectorConsentLedger
} from "../local-connector-consent-approval.js";
import { buildProviderTemplateParity } from "../provider-template-parity.js";
import {
  PROVIDER_TEMPLATE_IMPORT_CONFIRMATION,
  buildProviderTemplateImportCandidate,
  buildProviderTemplateImportPlan
} from "../provider-template-import-plan.js";

const SUPPORTED_TABS = new Set(["overview", "providers", "routes", "tools", "usage", "settings"]);

export function createAdminHandlers(ctx) {
  function isLocalProvider(provider) {
    return registryIsLocalProvider(provider);
  }

  function resolveActiveProfile(name) {
    if (!ctx.config.profiles.length) return null;
    return ctx.config.profiles.find((profile) => profile.name === name) || ctx.config.profiles[0];
  }

  function profileSummary() {
    const active = resolveActiveProfile(ctx.activeProfile);
    return {
      activeProfile: active?.name || null,
      defaultModel: active?.defaultModel || null,
      profiles: ctx.config.profiles.map((profile) => ({
        ...profile,
        active: profile.name === active?.name
      }))
    };
  }

  function persistProfileChanges(updatedProfiles, action) {
    const candidate = {
      ...ctx.serializeEditableConfig(ctx.config),
      profiles: updatedProfiles
    };
    try {
      const result = ctx.applyEditableConfig(candidate, action);
      return {
        status: 200,
        body: { ...result, profiles: updatedProfiles.length, activeProfile: ctx.activeProfile }
      };
    } catch (error) {
      ctx.recordError("profile:save", error, "config_error");
      return { status: 400, body: { ok: false, error: "save_failed", message: error.message } };
    }
  }

  function updateProfileEntry(body) {
    if (!body || typeof body !== "object") {
      return { status: 400, body: { ok: false, error: "invalid_body" } };
    }
    const profile = body.profile;
    if (!profile || typeof profile !== "object") {
      return { status: 400, body: { ok: false, error: "missing_profile" } };
    }
    const next = ctx.sanitizeProfileInput(profile);
    if (!next.name || !next.defaultModel) {
      return { status: 400, body: { ok: false, error: "name_and_default_required" } };
    }
    if (!ctx.isKnownModelRef(next.defaultModel)) {
      return { status: 400, body: { ok: false, error: "unknown_default_model", defaultModel: next.defaultModel } };
    }
    const originalName = body.originalName ? String(body.originalName).trim() : null;
    const existingIndex = originalName
      ? ctx.config.profiles.findIndex((item) => item.name === originalName)
      : ctx.config.profiles.findIndex((item) => item.name === next.name);
    if (existingIndex < 0 && originalName) {
      return { status: 404, body: { ok: false, error: "profile_not_found", profile: originalName } };
    }
    if (!originalName && existingIndex >= 0) {
      return { status: 409, body: { ok: false, error: "profile_exists", profile: next.name } };
    }
    if (originalName && next.name !== originalName) {
      if (ctx.config.profiles.some((item) => item.name === next.name)) {
        return { status: 409, body: { ok: false, error: "profile_exists", profile: next.name } };
      }
    }
    const updatedList = ctx.config.profiles.slice();
    if (existingIndex >= 0) updatedList[existingIndex] = next;
    else updatedList.push(next);
    return persistProfileChanges(updatedList, originalName ? "update" : "create");
  }

  function cloneProfileEntry(body) {
    const originalName = String(body.originalName || body.name || "").trim();
    const newName = String(body.newName || "").trim();
    if (!originalName || !newName) {
      return { status: 400, body: { ok: false, error: "originalName_and_newName_required" } };
    }
    if (originalName === newName) {
      return { status: 400, body: { ok: false, error: "new_name_must_differ" } };
    }
    const source = ctx.config.profiles.find((item) => item.name === originalName);
    if (!source) return { status: 404, body: { ok: false, error: "profile_not_found", profile: originalName } };
    if (ctx.config.profiles.some((item) => item.name === newName)) {
      return { status: 409, body: { ok: false, error: "profile_exists", profile: newName } };
    }
    const updatedList = ctx.config.profiles.concat([
      {
        name: newName,
        description: source.description ? `Clone of ${source.name}: ${source.description}` : `Clone of ${source.name}`,
        defaultModel: source.defaultModel
      }
    ]);
    return persistProfileChanges(updatedList, "clone");
  }

  function deleteProfileEntry(body) {
    const name = String(body.profile || body.name || "").trim();
    if (!name) return { status: 400, body: { ok: false, error: "profile_required" } };
    if (!ctx.config.profiles.some((item) => item.name === name)) {
      return { status: 404, body: { ok: false, error: "profile_not_found", profile: name } };
    }
    if (name === ctx.activeProfile) {
      return { status: 400, body: { ok: false, error: "cannot_delete_active_profile", profile: name } };
    }
    const updatedList = ctx.config.profiles.filter((item) => item.name !== name);
    if (updatedList.length === 0) {
      return { status: 400, body: { ok: false, error: "cannot_delete_last_profile" } };
    }
    return persistProfileChanges(updatedList, "delete");
  }

  function addKeyForProvider(res, provider, body) {
    const value = String(body.value || body.key || "").trim();
    const label = String(body.label || "").trim();
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_required" }, 400);
    if (!value) return ctx.sendJson(res, { ok: false, error: "value_required" }, 400);
    if (!ctx.config.providers.find((item) => item.name === provider)) {
      return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider }, 404);
    }
    if (value.length < 8 || /\s/.test(value)) {
      return ctx.sendJson(res, { ok: false, error: "value_malformed" }, 400);
    }
    let record;
    try {
      record = ctx.secretStore.add({ provider, value, label });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "store_error", message: error.message }, 500);
    }
    ctx.keyPool.reload(ctx.config.providers);
    return ctx.sendJson(res, { ok: true, key: record });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleGetRawConfig(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      configPath: ctx.configPath,
      targetConfigPath: ctx.getWritableConfigPath(),
      config: ctx.editableConfig()
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleSaveConfig(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const candidate = body.config || body;
    const schema = validateConfig(candidate);
    if (!schema.ok) {
      return ctx.sendJson(res, {
        ok: false,
        error: "config_validation_failed",
        message: "config has " + schema.errors.length + " schema error(s); see `errors[]`",
        errors: schema.errors,
        warnings: schema.warnings || []
      }, 400);
    }
    if (schema.warnings && schema.warnings.length > 0) {
      console.warn("config save produced " + schema.warnings.length + " warning(s): " + schema.warnings.join("; "));
    }
    const result = ctx.applyEditableConfig(candidate, "save");
    return ctx.sendJson(res, { ...result, warnings: schema.warnings || [] });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleImportConfig(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const candidate = body.config || body;
    const schema = validateConfig(candidate);
    if (!schema.ok) {
      return ctx.sendJson(res, {
        ok: false,
        error: "config_validation_failed",
        message: "imported config has " + schema.errors.length + " schema error(s); see `errors[]`",
        errors: schema.errors,
        warnings: schema.warnings || []
      }, 400);
    }
    const result = ctx.applyEditableConfig(candidate, "import");
    return ctx.sendJson(res, { ...result, warnings: schema.warnings || [] });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleExportConfig(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      exportedAt: new Date().toISOString(),
      format: "openrelay-local-safe.config.v1",
      configPath: ctx.configPath,
      config: ctx.editableConfig()
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleGetProfile(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, profileSummary());
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handlePreviewRoute(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const requested = url.searchParams.get("model") || "";
    const webKeyCounts = {};
    for (const key of ctx.secretStore.list()) {
      webKeyCounts[key.provider] = (webKeyCounts[key.provider] || 0) + (key.enabled ? 1 : 0);
    }
    const healthByProvider = {};
    for (const [providerName, health] of Object.entries(ctx.healthCache)) {
      healthByProvider[providerName] = health;
    }
    const view = resolveRoutePreview(ctx.config, ctx.activeProfile, requested, { webKeyCounts, healthByProvider });
    return ctx.sendJson(res, { ok: true, preview: view });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleRenderTab(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const tab = (url.searchParams.get("tab") || "").trim();
    if (!SUPPORTED_TABS.has(tab)) {
      return ctx.sendJson(res, { ok: false, error: "unsupported_tab", tab, supported: Array.from(SUPPORTED_TABS) }, 400);
    }
    const status = ctx.buildStatus();
    const port = Number(process.env.PORT || 18765);
    const locale = ctx.getLocale(req);
    const html = ctx.renderSingleTab(tab, status, port, locale);
    if (!html) {
      return ctx.sendJson(res, { ok: false, error: "render_failed", tab }, 500);
    }
    return ctx.sendJson(res, { ok: true, tab, html, status });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleSetProfile(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const requested = String(body.profile || body.name || "").trim();
    const nextProfile = resolveActiveProfile(requested);
    if (!nextProfile) {
      return ctx.sendJson(res, { ok: false, error: "profile_not_found", profile: requested }, 404);
    }
    if (nextProfile.name !== ctx.activeProfile) {
      ctx.activeProfile = nextProfile.name;
      ctx.persistRuntimeState();
    }
    return ctx.sendJson(res, { ok: true, activeProfile: ctx.activeProfile, defaultModel: nextProfile.defaultModel });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleUpdateProfile(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const result = updateProfileEntry(body);
    return ctx.sendJson(res, result.body, result.status);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleCloneProfile(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const result = cloneProfileEntry(body);
    return ctx.sendJson(res, result.body, result.status);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleDeleteProfile(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const result = deleteProfileEntry(body);
    return ctx.sendJson(res, result.body, result.status);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleTestProvider(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const providerName = String(body.provider || "");
    const provider = ctx.config.providers.find((item) => item.name === providerName);
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    const key = ctx.keyPool.next(provider.name);
    const result = key
      ? await ctx.testProviderWithKey(provider, key.value, provider.name, body.model)
      : await ctx.testProviderWithKey(provider, null, provider.name, body.model);
    return ctx.sendJson(res, result, result.ok ? 200 : 502);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleDiscoverModels(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const customBaseUrl = String(body.baseUrl || "").trim();
    if (customBaseUrl) {
      const customApiKey = body.apiKey === undefined || body.apiKey === null
        ? null
        : String(body.apiKey);
      const result = await ctx.discoverModelsByUrl({ baseUrl: customBaseUrl, apiKey: customApiKey });
      return ctx.sendJson(res, result, result.ok ? 200 : (result.status || 400));
    }
    const providerName = String(body.provider || "").trim();
    if (!providerName) {
      return ctx.sendJson(res, { ok: false, error: "missing_args", message: "Provide either { baseUrl, apiKey? } or { provider }." }, 400);
    }
    const provider = ctx.config.providers.find((item) => item.name === providerName);
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    const result = await ctx.discoverProviderModels(provider);
    return ctx.sendJson(res, result, result.ok ? 200 : 502);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleCheckBalance(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const providerName = String(body.provider || "");
    const provider = ctx.config.providers.find((item) => item.name === providerName);
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    const result = await ctx.checkProviderBalance(provider);
    return ctx.sendJson(res, result, result.ok ? 200 : 502);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleListProviders(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      ok: true,
      providers: ctx.serializeEditableConfig(ctx.config).providers.map((provider) => ({
        ...provider,
        insecureHttpRisk: provider.allowInsecureHttp === true && String(provider.baseUrl).startsWith("http://") && !isLocalProvider(provider)
      })),
      defaultProvider: ctx.config.defaultProvider,
      references: Object.fromEntries(ctx.config.providers.map((provider) => [provider.name, ctx.collectProviderReferences(provider.name)]))
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleProviderTemplates(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, { ok: true, templates: ctx.PROVIDER_TEMPLATES.map((item) => ({ ...item })) });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleProviderTemplateParity(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    for (const param of ["live", "discover", "connect", "start", "apply", "write", "save"]) {
      if (url.searchParams.get(param) === "true") {
        return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", param }, 400);
      }
    }
    const result = buildProviderTemplateParity({
      version: ctx.packageVersion,
      templates: ctx.PROVIDER_TEMPLATES,
      configuredProviders: ctx.config.providers.map((provider) => provider.name)
    });
    return ctx.sendJson(res, result);
  }

  function providerTemplateImportPlan() {
    return buildProviderTemplateImportPlan({
      version: ctx.packageVersion,
      templates: ctx.PROVIDER_TEMPLATES,
      configuredProviders: ctx.config.providers.map((provider) => provider.name)
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleProviderTemplateImportPlan(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    for (const param of ["live", "discover", "connect", "start", "network", "keys"]) {
      if (url.searchParams.get(param) === "true") {
        return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", param }, 400);
      }
    }
    return ctx.sendJson(res, providerTemplateImportPlan());
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleProviderTemplateImport(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const plan = providerTemplateImportPlan();
    if (!body || body.apply !== true || body.confirm !== PROVIDER_TEMPLATE_IMPORT_CONFIRMATION) {
      return ctx.sendJson(res, {
        ok: false,
        error: "confirmation_required",
        requiredConfirmation: PROVIDER_TEMPLATE_IMPORT_CONFIRMATION,
        plan
      }, 400);
    }
    if (plan.importable.length === 0) {
      return ctx.sendJson(res, { ok: true, applied: false, imported: 0, message: "no_missing_config_ready_templates", plan });
    }
    const candidate = buildProviderTemplateImportCandidate(ctx.editableConfig(), plan);
    try {
      const result = ctx.applyEditableConfig(candidate, "provider-template:import");
      return ctx.sendJson(res, {
        ...result,
        applied: true,
        imported: plan.importable.length,
        importedProviders: plan.importable.map((item) => item.name),
        safety: {
          readsCredentials: false,
          storesKeys: false,
          makesNetworkRequests: false,
          registersRoutes: false,
          writesConfig: true
        }
      });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "provider_template_import_failed", message: error.message, plan }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleCreateProvider(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    let provider;
    try {
      provider = ctx.sanitizeProviderInput(body, null, { create: true });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "invalid_provider", message: error.message }, 400);
    }
    if (ctx.config.providers.some((item) => item.name === provider.name)) {
      return ctx.sendJson(res, { ok: false, error: "provider_exists", provider: provider.name }, 409);
    }
    const candidate = {
      ...ctx.editableConfig(),
      providers: [...ctx.serializeEditableConfig(ctx.config).providers, provider]
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "provider:create");
      return ctx.sendJson(res, { ...result, provider }, 201);
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "provider_save_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleUpdateProvider(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const providerName = ctx.providerNameFromUrl(req.url);
    if (!providerName) return ctx.sendJson(res, { ok: false, error: "provider_required" }, 400);
    const existing = ctx.config.providers.find((item) => item.name === providerName);
    if (!existing) return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    let provider;
    try {
      provider = ctx.sanitizeProviderInput(body, existing, { create: false });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "invalid_provider", message: error.message }, 400);
    }
    if (provider.name !== providerName) {
      return ctx.sendJson(res, { ok: false, error: "provider_rename_not_supported", message: "Provider name cannot be changed; create a new provider instead." }, 400);
    }
    const candidate = {
      ...ctx.editableConfig(),
      providers: ctx.serializeEditableConfig(ctx.config).providers.map((item) => (item.name === providerName ? provider : item))
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "provider:update");
      return ctx.sendJson(res, { ...result, provider });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "provider_save_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleDeleteProvider(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const providerName = ctx.providerNameFromUrl(req.url);
    if (!providerName) return ctx.sendJson(res, { ok: false, error: "provider_required" }, 400);
    if (!ctx.config.providers.some((item) => item.name === providerName)) {
      return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    }
    const references = ctx.collectProviderReferences(providerName);
    if (references.length > 0) {
      return ctx.sendJson(res, { ok: false, error: "provider_in_use", provider: providerName, references }, 409);
    }
    const editable = ctx.editableConfig();
    const nextLimits = { ...editable.limits, providers: { ...(editable.limits?.providers || {}) } };
    delete nextLimits.providers[providerName];
    const nextHealthChecks = {
      ...(editable.healthChecks || {}),
      providers: (editable.healthChecks?.providers || []).filter((name) => name !== providerName)
    };
    const candidate = {
      ...editable,
      providers: editable.providers.filter((item) => item.name !== providerName),
      limits: nextLimits,
      healthChecks: nextHealthChecks
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "provider:delete");
      return ctx.sendJson(res, { ...result, removed: providerName });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "provider_delete_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleListRoutes(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      ok: true,
      routes: ctx.serializeEditableConfig(ctx.config).routes,
      references: Object.fromEntries(ctx.config.routes.map((route) => [route.name, ctx.collectRouteReferences(route.name)])),
      templates: ctx.ROUTE_TEMPLATES.map((item) => JSON.parse(JSON.stringify(item)))
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleRouteTemplates(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, { ok: true, templates: ctx.ROUTE_TEMPLATES.map((item) => JSON.parse(JSON.stringify(item))) });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleCreateRoute(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    let route;
    try {
      route = ctx.sanitizeRouteInput(body, null, { create: true });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "invalid_route", message: error.message }, 400);
    }
    if (ctx.config.routes.some((item) => item.name === route.name)) {
      return ctx.sendJson(res, { ok: false, error: "route_exists", route: route.name }, 409);
    }
    const candidate = {
      ...ctx.editableConfig(),
      routes: [...ctx.serializeEditableConfig(ctx.config).routes, route]
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "route:create");
      return ctx.sendJson(res, { ...result, route }, 201);
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "route_save_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleUpdateRoute(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const routeName = ctx.routeNameFromUrl(req.url);
    if (!routeName) return ctx.sendJson(res, { ok: false, error: "route_required" }, 400);
    const existing = ctx.config.routes.find((item) => item.name === routeName);
    if (!existing) return ctx.sendJson(res, { ok: false, error: "route_not_found", route: routeName }, 404);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    let route;
    try {
      route = ctx.sanitizeRouteInput(body, existing, { create: false });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "invalid_route", message: error.message }, 400);
    }
    if (route.name !== routeName) {
      return ctx.sendJson(res, { ok: false, error: "route_rename_not_supported", message: "Route name cannot be changed; create a new route instead." }, 400);
    }
    const candidate = {
      ...ctx.editableConfig(),
      routes: ctx.serializeEditableConfig(ctx.config).routes.map((item) => (item.name === routeName ? route : item))
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "route:update");
      return ctx.sendJson(res, { ...result, route });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "route_save_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleDeleteRoute(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const routeName = ctx.routeNameFromUrl(req.url);
    if (!routeName) return ctx.sendJson(res, { ok: false, error: "route_required" }, 400);
    if (!ctx.config.routes.some((item) => item.name === routeName)) {
      return ctx.sendJson(res, { ok: false, error: "route_not_found", route: routeName }, 404);
    }
    const references = ctx.collectRouteReferences(routeName);
    if (references.length > 0) {
      return ctx.sendJson(res, { ok: false, error: "route_in_use", route: routeName, references }, 409);
    }
    const editable = ctx.editableConfig();
    const nextLimits = { ...editable.limits, routes: { ...((editable.limits && editable.limits.routes) || {}) } };
    delete nextLimits.routes[routeName];
    const candidate = {
      ...editable,
      routes: editable.routes.filter((item) => item.name !== routeName),
      limits: nextLimits
    };
    try {
      const result = ctx.applyEditableConfig(candidate, "route:delete");
      return ctx.sendJson(res, { ...result, removed: routeName });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "route_delete_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleListKeys(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const provider = url.searchParams.get("provider") || undefined;
    return ctx.sendJson(res, { ok: true, keys: ctx.secretStore.list({ provider }) });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleAddKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const provider = String(body.provider || "").trim();
    return addKeyForProvider(res, provider, body);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleAddProviderKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const provider = ctx.providerNameFromKeyUrl(req.url);
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_required" }, 400);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    return addKeyForProvider(res, provider, body);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleUpdateKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const id = ctx.keyIdFromUrl(req.url);
    if (!id) return ctx.sendJson(res, { ok: false, error: "id_required" }, 400);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const patch = {};
    if (body.label !== undefined) patch.label = String(body.label);
    if (body.enabled !== undefined) patch.enabled = !!body.enabled;
    if (body.value !== undefined) {
      const value = String(body.value);
      if (!value || value.length < 8 || /\s/.test(value)) {
        return ctx.sendJson(res, { ok: false, error: "value_malformed" }, 400);
      }
      patch.value = value;
    }
    if (Object.keys(patch).length === 0) {
      return ctx.sendJson(res, { ok: false, error: "no_supported_fields" }, 400);
    }
    let record;
    try {
      record = ctx.secretStore.update(id, patch);
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "store_error", message: error.message }, 500);
    }
    if (!record) return ctx.sendJson(res, { ok: false, error: "key_not_found" }, 404);
    ctx.keyPool.reload(ctx.config.providers);
    return ctx.sendJson(res, { ok: true, key: record });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleDeleteKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const id = ctx.keyIdFromUrl(req.url);
    if (!id) return ctx.sendJson(res, { ok: false, error: "id_required" }, 400);
    const existed = ctx.secretStore.remove(id);
    if (!existed) return ctx.sendJson(res, { ok: false, error: "key_not_found" }, 404);
    ctx.keyPool.reload(ctx.config.providers);
    return ctx.sendJson(res, { ok: true, removed: id });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleTestKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const id = ctx.keyIdFromUrl(req.url);
    if (!id) return ctx.sendJson(res, { ok: false, error: "id_required" }, 400);
    const record = ctx.secretStore.get(id);
    if (!record) return ctx.sendJson(res, { ok: false, error: "key_not_found" }, 404);
    const provider = ctx.config.providers.find((item) => item.name === record.provider);
    if (!provider) {
      return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: record.provider }, 404);
    }
    const value = ctx.secretStore.getDecryptedValue(id);
    if (!value) {
      return ctx.sendJson(res, { ok: false, error: "key_unavailable" }, 400);
    }
    const result = await ctx.testProviderWithKey(provider, value, record.provider);
    ctx.secretStore.recordTestResult(id, {
      ok: !!result.ok,
      status: result.status || null,
      elapsedMs: result.elapsedMs || null,
      error: result.error || null,
      message: result.message || null
    });
    return ctx.sendJson(res, { ok: !!result.ok, keyId: id, result }, result.ok ? 200 : 502);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleTestRawKey(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const providerName = String(body.provider || "").trim();
    const value = String(body.value || body.key || "").trim();
    if (!providerName) return ctx.sendJson(res, { ok: false, error: "provider_required" }, 400);
    if (!value) return ctx.sendJson(res, { ok: false, error: "value_required" }, 400);
    if (value.length < 8 || /\s/.test(value)) {
      return ctx.sendJson(res, { ok: false, error: "value_malformed" }, 400);
    }
    const provider = ctx.config.providers.find((item) => item.name === providerName);
    if (!provider) return ctx.sendJson(res, { ok: false, error: "provider_not_found", provider: providerName }, 404);
    const result = await ctx.testProviderWithKey(provider, value, providerName, body.model);
    return ctx.sendJson(res, { ok: !!result.ok, ephemeral: true, result }, result.ok ? 200 : 502);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleTestAll(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);

    const port = ctx.port;
    const authHeader = req.headers.authorization || "";
    const headers = { "content-type": "application/json" };
    if (authHeader) headers.authorization = authHeader;

    const errors = [];

    // 1. Verify /health returns ok
    let healthResult;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`, { method: "GET", signal: AbortSignal.timeout(5000) });
      const body = await resp.json();
      healthResult = { ok: resp.ok && body.ok === true };
      if (!healthResult.ok) {
        errors.push(`Health check failed: HTTP ${resp.status}`);
      }
    } catch (error) {
      healthResult = { ok: false };
      errors.push(`Health check error: ${error.message}`);
    }

    // 2. Verify /v1/models returns a list with at least one model
    let modelsResult;
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/v1/models`, { method: "GET", headers, signal: AbortSignal.timeout(10000) });
      const body = await resp.json();
      const data = Array.isArray(body?.data) ? body.data : [];
      modelsResult = { ok: resp.ok && data.length > 0, count: data.length };
      if (!modelsResult.ok) {
        const reason = !resp.ok ? `HTTP ${resp.status}` : "no models returned";
        errors.push(`Models check failed: ${reason}`);
      }
    } catch (error) {
      modelsResult = { ok: false, count: 0 };
      errors.push(`Models check error: ${error.message}`);
    }

    // 3. Try a minimal chat completion — flows through relay's proxy logic
    let chatResult;
    const chatPayload = { model: "auto", messages: [{ role: "user", content: "ping" }], max_tokens: 5, temperature: 0 };
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(chatPayload),
        signal: AbortSignal.timeout(30000)
      });
      const body = await resp.json();

      if (resp.ok) {
        chatResult = { ok: true, model: body?.model || null, route: null, provider: null, error: null };
      } else {
        let errorType;
        if (resp.status === 401) errorType = "token_error";
        else if (resp.status === 503 && body?.error === "no_available_key") errorType = "provider_missing_key";
        else if (resp.status === 503) errorType = "provider_missing_key";
        else if (resp.status === 403) errorType = "upstream_auth";
        else if (resp.status === 429) errorType = "upstream_rate_limit";
        else errorType = "upstream_error";

        chatResult = {
          ok: false,
          model: body?.model || null,
          route: body?.route || null,
          provider: body?.provider || null,
          error: errorType
        };
        errors.push(`Chat completion failed: ${errorType} (HTTP ${resp.status})`);
      }
    } catch (error) {
      let errorType;
      if (error.code === "ECONNREFUSED") errorType = "local_model_not_started";
      else if (error.name === "AbortError") errorType = "network_timeout";
      else errorType = "network_error";

      chatResult = { ok: false, model: null, route: null, provider: null, error: errorType };
      errors.push(`Chat completion error: ${errorType} — ${error.message}`);
    }

    const allOk = healthResult?.ok && modelsResult?.ok && chatResult?.ok;
    const summary = errors.length === 0
      ? "All checks passed"
      : `${errors.length} check(s) failed: ${errors.join("; ")}`;

    return ctx.sendJson(res, {
      ok: allOk,
      health: healthResult,
      models: modelsResult,
      chat: chatResult,
      errors,
      summary
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleProviderTestPreview(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const providerFilter = url.searchParams.get("provider") || null;
    const localOnly = url.searchParams.get("localOnly") === "true";
    const live = url.searchParams.get("live") || url.searchParams.get("live") === "true";

    if (live) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Use POST /admin/test-provider for live connectivity tests. Pass live=true is not supported here." }, 400);
    }

    const serverGetProviderKeys = (provider) => {
      if (!provider.keyEnv) {
        const webKeys = (ctx.secretStore.list() || []).filter(k => k.provider === provider.name && k.enabled);
        return webKeys.length > 0 ? ["web-key-present"] : [null];
      }
      const envKeys = String(process.env[provider.keyEnv] || "")
        .split(",").map(k => k.trim()).filter(Boolean);
      if (envKeys.length > 0) return envKeys;
      const webKeys = (ctx.secretStore.list() || []).filter(k => k.provider === provider.name && k.enabled);
      return webKeys.length > 0 ? ["web-key-present"] : [null];
    };

    const report = buildProviderTestReport(ctx.config, {
      localOnly,
      provider: providerFilter,
      getProviderKeys: serverGetProviderKeys
    });

    report.mode = "dry-run";
    report.configPath = ctx.configPath;
    report.version = ctx.packageVersion;

    return ctx.sendJson(res, report);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleGetAuthToken(req, res) {
    if (ctx.relayAuth.allowNoAuth) {
      return ctx.sendJson(res, { ok: true, allowNoAuth: true, token: "", masked: "" });
    }
    if (!ctx.relayAuth.token) {
      return ctx.sendJson(res, { ok: true, token: "", masked: "" });
    }
    return ctx.sendJson(res, {
ok: true,
      token: ctx.relayAuth.token,
      masked: ctx.relayAuth.masked || maskToken(ctx.relayAuth.token),
      source: ctx.relayAuth.source
    });
  }

  /**
   * Returns the config hot-reload status so the Dashboard can show
   * when config.json was last reloaded and whether it succeeded.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handleConfigReloadStatus(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, {
      ok: true,
      configReload: ctx.configReload || { lastReloadAt: null, ok: true, message: "not configured", count: 0 }
    });
  }

  /**
   * GET /admin/limits — returns the current limits block without secrets.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handleGetLimits(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    return ctx.sendJson(res, { ok: true, limits: ctx.config.limits });
  }

  /**
   * PATCH /admin/limits — updates dailyRequests thresholds globally,
   * per-provider, per-route, and per-model. Writes through the same
   * applyEditableConfig path so the change is persisted to config.json
   * and hot-reloaded into the running server.
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handleUpdateLimits(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return ctx.sendJson(res, { ok: false, error: "invalid_body", message: "Expected a JSON object" }, 400);
    }

    // Validate the incoming limit fields
    function validateLimitValue(value, fieldName) {
      if (value === null || value === undefined || value === "") return null;
      if (typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0) return value;
      if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const n = parseInt(value, 10);
        if (n > 0) return n;
      }
      throw new Error(`${fieldName} must be a positive integer or null, got: ${JSON.stringify(value)}`);
    }

    let dailyRequests, providers, routes, models;
    try {
      dailyRequests = validateLimitValue(body.dailyRequests, "dailyRequests");
      providers = {};
      if (body.providers && typeof body.providers === "object" && !Array.isArray(body.providers)) {
        for (const [name, block] of Object.entries(body.providers)) {
          if (!block || typeof block !== "object") throw new Error(`providers.${name} must be an object`);
          const v = validateLimitValue(block.dailyRequests, `providers.${name}.dailyRequests`);
          if (v !== null) providers[name] = { dailyRequests: v };
        }
      }
      routes = {};
      if (body.routes && typeof body.routes === "object" && !Array.isArray(body.routes)) {
        for (const [name, block] of Object.entries(body.routes)) {
          if (!block || typeof block !== "object") throw new Error(`routes.${name} must be an object`);
          const v = validateLimitValue(block.dailyRequests, `routes.${name}.dailyRequests`);
          if (v !== null) routes[name] = { dailyRequests: v };
        }
      }
      models = {};
      if (body.models && typeof body.models === "object" && !Array.isArray(body.models)) {
        for (const [name, block] of Object.entries(body.models)) {
          if (!block || typeof block !== "object") throw new Error(`models.${name} must be an object`);
          const v = validateLimitValue(block.dailyRequests, `models.${name}.dailyRequests`);
          if (v !== null) models[name] = { dailyRequests: v };
        }
      }
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "invalid_limits", message: error.message }, 400);
    }

    // Build a full editable config with the new limits merged in
    const editable = ctx.editableConfig();
    const newLimits = { ...editable.limits };
    if (body.dailyRequests !== undefined) newLimits.dailyRequests = dailyRequests;
    if (Object.keys(providers).length > 0) newLimits.providers = { ...newLimits.providers, ...providers };
    if (Object.keys(routes).length > 0) newLimits.routes = { ...newLimits.routes, ...routes };
    if (Object.keys(models).length > 0) newLimits.models = { ...newLimits.models, ...models };
    const candidate = { ...editable, limits: newLimits };

    try {
      const result = ctx.applyEditableConfig(candidate, "update-limits");
      return ctx.sendJson(res, { ok: true, ...result });
    } catch (error) {
      return ctx.sendJson(res, { ok: false, error: "update_failed", message: error.message }, 500);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   * @returns {Promise<void>}
   */
  async function handleIdeProxyPreview(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const model = url.searchParams.get("model") || "auto";
    const live = url.searchParams.get("live") === "true";

    if (live) {
      return ctx.sendJson(res, {
        ok: false,
        error: "live_mode_rejected",
        message: "This endpoint is dry-run only. Live mode is not supported."
      }, 400);
    }

    const status = ctx.buildStatus();
    const port = ctx.port;
    const preview = buildIdeProxyPreview(status, port, { model });
    preview.version = ctx.packageVersion;
    return ctx.sendJson(res, preview);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleIdeProxyStatus(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const model = url.searchParams.get("model") || "auto";
    const live = url.searchParams.get("live") === "true";

    if (live) {
      return ctx.sendJson(res, {
        ok: false,
        error: "live_mode_rejected",
        message: "This endpoint is dry-run only. Live mode is not supported."
      }, 400);
    }

    const status = ctx.buildStatus();
    const port = ctx.port;
    const preview = buildIdeProxyPreview(status, port, { model });
    const runtimeStatus = buildIdeProxyRuntimeStatus(preview, { model, port });
    runtimeStatus.version = ctx.packageVersion;
    return ctx.sendJson(res, runtimeStatus);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleIdeProxyPortCheck(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const model = url.searchParams.get("model") || "auto";
    const live = url.searchParams.get("live") === "true";
    const timeoutMs = url.searchParams.get("timeoutMs");

    if (live) {
      return ctx.sendJson(res, {
        ok: false,
        error: "live_mode_rejected",
        message: "This endpoint is dry-run only. Live mode is not supported."
      }, 400);
    }

    const status = ctx.buildStatus();
    const port = ctx.port;
    const preview = buildIdeProxyPreview(status, port, { model });
    const portCheck = await buildIdeProxyPortCheck(preview, { model, port, timeoutMs });
    portCheck.version = ctx.packageVersion;
    return ctx.sendJson(res, portCheck);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleIdeProxyStartPlan(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const model = url.searchParams.get("model") || "auto";
    const live = url.searchParams.get("live") === "true" || url.searchParams.get("start") === "true";
    const timeoutMs = url.searchParams.get("timeoutMs");

    if (live) {
      return ctx.sendJson(res, {
        ok: false,
        error: "live_mode_rejected",
        message: "This endpoint only builds a dry-run start plan. It does not start IDE proxy listeners."
      }, 400);
    }

    const status = ctx.buildStatus();
    const port = ctx.port;
    const preview = buildIdeProxyPreview(status, port, { model });
    const portCheck = await buildIdeProxyPortCheck(preview, { model, port, timeoutMs });
    const startPlan = buildIdeProxyStartPlan(portCheck, { model, port });
    startPlan.version = ctx.packageVersion;
    startPlan.portCheck = {
      summary: portCheck.summary,
      timeoutMs: portCheck.timeoutMs,
      generatedAt: portCheck.generatedAt
    };
    return ctx.sendJson(res, startPlan);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorPlan(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const platform = url.searchParams.get("platform") || "auto";
    const live = url.searchParams.get("live") === "true";
    const discover = url.searchParams.get("discover") === "true";

    if (live) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Live mode is not supported." }, 400);
    }

    if (discover) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Use discover=true in a future version." }, 400);
    }

    const plan = buildLocalConnectorPlan({ platform, version: ctx.packageVersion });
    return ctx.sendJson(res, plan);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorAvailability(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const platform = url.searchParams.get("platform") || "auto";
    const live = url.searchParams.get("live") === "true";
    const discover = url.searchParams.get("discover") === "true";
    const includePaths = url.searchParams.get("includePaths") === "true";

    if (live || discover) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Live mode and discover mode are not supported." }, 400);
    }

    if (includePaths) {
      return ctx.sendJson(res, { ok: false, error: "path_disclosure_rejected", message: "Path disclosure is not supported. This endpoint never returns absolute filesystem paths." }, 400);
    }

    const result = buildLocalConnectorAvailability({ platform, version: ctx.packageVersion });
    return ctx.sendJson(res, result);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorProviderPreview(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const platform = url.searchParams.get("platform") || "auto";
    const live = url.searchParams.get("live") === "true";
    const discover = url.searchParams.get("discover") === "true";
    const connect = url.searchParams.get("connect") === "true";
    const start = url.searchParams.get("start") === "true";
    const includePaths = url.searchParams.get("includePaths") === "true";

    if (live || discover || connect || start) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Live mode, discover mode, connect mode, and start mode are not supported." }, 400);
    }

    if (includePaths) {
      return ctx.sendJson(res, { ok: false, error: "path_disclosure_rejected", message: "Path disclosure is not supported. This endpoint never returns absolute filesystem paths." }, 400);
    }

    const result = buildLocalConnectorProviderPreview({ platform, version: ctx.packageVersion });
    return ctx.sendJson(res, result);
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorConsentManifest(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const platform = url.searchParams.get("platform") || "auto";
    const live = url.searchParams.get("live") === "true";
    const discover = url.searchParams.get("discover") === "true";
    const connect = url.searchParams.get("connect") === "true";
    const start = url.searchParams.get("start") === "true";
    const apply = url.searchParams.get("apply") === "true";
    const approve = url.searchParams.get("approve") === "true";
    const includePaths = url.searchParams.get("includePaths") === "true";

    if (live || discover || connect || start || apply || approve) {
      return ctx.sendJson(res, { ok: false, error: "live_mode_rejected", message: "This endpoint is dry-run only. Consent approval, live discovery, connection, startup, and apply mode are not supported." }, 400);
    }

    if (includePaths) {
      return ctx.sendJson(res, { ok: false, error: "path_disclosure_rejected", message: "Path disclosure is not supported. This endpoint never returns absolute filesystem paths." }, 400);
    }

    const result = buildLocalConnectorConsentManifest({ platform, version: ctx.packageVersion });
    return ctx.sendJson(res, result);
  }

  function localConnectorConsentLedger(platform = "auto") {
    return buildLocalConnectorConsentLedger({
      platform,
      version: ctx.packageVersion,
      ledger: ctx.config.localConnectorConsents || {}
    });
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorConsentLedger(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const url = new URL(req.url, "http://127.0.0.1");
    const platform = url.searchParams.get("platform") || "auto";
    for (const param of ["live", "discover", "connect", "start", "read", "keys", "includePaths"]) {
      if (url.searchParams.get(param) === "true") {
        return ctx.sendJson(res, { ok: false, error: param === "includePaths" ? "path_disclosure_rejected" : "live_mode_rejected", param }, 400);
      }
    }
    return ctx.sendJson(res, localConnectorConsentLedger(platform));
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleLocalConnectorConsent(req, res) {
    if (!ctx.isAuthorized(req)) return ctx.unauthorized(res);
    const body = await ctx.readJsonBody(req, ctx.config.limits.maxBodyBytes);
    const platform = body?.platform || "auto";
    const action = body?.action === "revoke" || body?.revoke === true ? "revoke" : body?.action === "approve" || body?.approve === true ? "approve" : "";
    const required = action === "revoke"
      ? LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION
      : LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION;
    const ledger = localConnectorConsentLedger(platform);
    if (!action) {
      return ctx.sendJson(res, {
        ok: false,
        error: "action_required",
        message: "Use action=approve or action=revoke.",
        approveConfirmation: LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION,
        revokeConfirmation: LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION,
        ledger
      }, 400);
    }
    if (!body || body.apply !== true || body.confirm !== required) {
      return ctx.sendJson(res, {
        ok: false,
        error: "confirmation_required",
        action,
        requiredConfirmation: required,
        ledger
      }, 400);
    }

    const candidateResult = buildLocalConnectorConsentCandidate(ctx.editableConfig(), ctx.config.localConnectorConsents || {}, body, {
      platform,
      version: ctx.packageVersion
    });
    if (!candidateResult.ok) {
      return ctx.sendJson(res, candidateResult, candidateResult.status || 400);
    }
    try {
      const result = ctx.applyEditableConfig(candidateResult.candidate, `local-connector-consent:${action}`);
      return ctx.sendJson(res, {
        ...result,
        applied: true,
        action,
        connector: candidateResult.connector,
        ledger: localConnectorConsentLedger(platform),
        safety: {
          readsTokens: false,
          readsCookies: false,
          readsSessionStorage: false,
          readsBrowserProfiles: false,
          readsIdeCredentials: false,
          readsKeychain: false,
          returnsLocalPaths: false,
          writesConfig: true,
          startsProcess: false,
          startsNetworkListener: false,
          registersRoutes: false,
          storesConsent: action === "approve"
        }
      });
    } catch (error) {
      ctx.recordError("local-connector-consent:apply", error, "config_error");
      return ctx.sendJson(res, { ok: false, error: "save_failed", message: error.message }, 400);
    }
  }

  /**
   * @param {import("node:http").IncomingMessage} req
   * @param {import("node:http").ServerResponse} res
   */
  async function handleSetLocale(req, res) {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    const body = ctx.parseMaybeJson(raw) || {};
    let chosen = null;
    if (typeof body.locale === "string") chosen = body.locale;
    if (!chosen) {
      try {
        const params = new URLSearchParams(raw);
        chosen = params.get("locale");
      } catch {
        // ignore
      }
    }
    if (!I18N_SUPPORTED_LOCALES.includes(chosen)) {
      return ctx.sendJson(res, { ok: false, error: "unsupported_locale" }, 400);
    }
    res.writeHead(303, withCorsHeaders({
      location: "/",
      "set-cookie": `OPENRELAY_LOCALE=${chosen}; Path=/; SameSite=Lax; Max-Age=31536000`
    }, res.__openrelayReq));
    res.end();
  }

  return {
    handleGetRawConfig,
    handleSaveConfig,
    handleImportConfig,
    handleExportConfig,
    handleGetProfile,
    handlePreviewRoute,
    handleRenderTab,
    handleSetProfile,
    handleUpdateProfile,
    handleCloneProfile,
    handleDeleteProfile,
    handleTestProvider,
    handleDiscoverModels,
    handleCheckBalance,
    handleListProviders,
    handleProviderTemplates,
    handleProviderTemplateParity,
    handleProviderTemplateImportPlan,
    handleProviderTemplateImport,
    handleCreateProvider,
    handleUpdateProvider,
    handleDeleteProvider,
    handleListRoutes,
    handleRouteTemplates,
    handleCreateRoute,
    handleUpdateRoute,
    handleDeleteRoute,
    handleListKeys,
    handleAddKey,
    handleAddProviderKey,
    handleUpdateKey,
    handleDeleteKey,
    handleTestKey,
    handleTestRawKey,
    handleGetAuthToken,
    handleConfigReloadStatus,
    handleGetLimits,
    handleUpdateLimits,
    handleSetLocale,
    handleTestAll,
    handleProviderTestPreview,
    handleIdeProxyPreview,
    handleIdeProxyStatus,
    handleIdeProxyPortCheck,
    handleIdeProxyStartPlan,
    handleLocalConnectorPlan,
    handleLocalConnectorAvailability,
    handleLocalConnectorProviderPreview,
    handleLocalConnectorConsentManifest,
    handleLocalConnectorConsentLedger,
    handleLocalConnectorConsent,
    addKeyForProvider
  };
}
