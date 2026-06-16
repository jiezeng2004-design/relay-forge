import { LOCAL_PROVIDER_NAMES } from "./provider-registry.js";

export const PROVIDER_TEMPLATE_IMPORT_CONFIRMATION = "ADD_MISSING_PROVIDER_TEMPLATES";

const DEFAULT_VERSION = "0.3.32";

export function buildProviderTemplateImportPlan(options = {}) {
  const version = options.version || DEFAULT_VERSION;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const templates = Array.isArray(options.templates) ? options.templates : [];
  const configuredProviders = Array.isArray(options.configuredProviders) ? options.configuredProviders : [];
  const configured = new Set(configuredProviders);
  const seenTemplates = new Set();
  const importable = [];
  const skipped = [];

  for (const template of templates) {
    const entry = buildTemplateEntry(template);
    if (!entry.name || !entry.baseUrl) {
      skipped.push({ ...entry, reason: "missing_name_or_base_url" });
      continue;
    }
    if (seenTemplates.has(entry.name)) {
      skipped.push({ ...entry, reason: "duplicate_template_name" });
      continue;
    }
    seenTemplates.add(entry.name);
    if (configured.has(entry.name)) {
      skipped.push({ ...entry, reason: "already_configured" });
      continue;
    }
    if (entry.templateOnly) {
      skipped.push({ ...entry, reason: "requires_user_specific_base_url" });
      continue;
    }
    importable.push({
      ...entry,
      reason: "missing_config_ready_template",
      provider: cloneProviderTemplate(template)
    });
  }

  const skippedByReason = {};
  for (const item of skipped) skippedByReason[item.reason] = (skippedByReason[item.reason] || 0) + 1;

  return {
    ok: true,
    version,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt,
    applyEndpoint: "/admin/provider-template-import",
    requiredConfirmation: PROVIDER_TEMPLATE_IMPORT_CONFIRMATION,
    summary: {
      totalTemplates: templates.length,
      configuredTemplates: configured.size,
      importableTemplates: importable.length,
      skippedTemplates: skipped.length,
      skippedAlreadyConfigured: skippedByReason.already_configured || 0,
      skippedTemplateOnly: skippedByReason.requires_user_specific_base_url || 0,
      skippedInvalid: (skippedByReason.missing_name_or_base_url || 0) + (skippedByReason.duplicate_template_name || 0),
      resultingProviderCount: configured.size + importable.length,
      configWrites: 0,
      keysStored: 0,
      networkRequests: 0,
      routesRegistered: 0
    },
    safety: {
      readsCredentials: false,
      readsTokens: false,
      readsLocalPaths: false,
      writesConfig: false,
      storesKeys: false,
      startsProcesses: false,
      makesNetworkRequests: false,
      registersRoutes: false,
      importsPlaceholderUrls: false,
      requiresExplicitConfirmation: true
    },
    importable,
    skipped
  };
}

export function buildProviderTemplateImportCandidate(config, plan) {
  const baseProviders = Array.isArray(config?.providers) ? config.providers : [];
  const additions = Array.isArray(plan?.importable) ? plan.importable.map((item) => item.provider) : [];
  return {
    ...config,
    providers: baseProviders.concat(additions)
  };
}

function buildTemplateEntry(template) {
  const name = String(template?.name || "").trim();
  const baseUrl = String(template?.baseUrl || "").trim();
  const templateOnly = /<[^>]+>/.test(baseUrl);
  return {
    name,
    displayName: String(template?.displayName || name),
    baseUrl,
    apiFormat: template?.apiFormat || "openai",
    keyEnv: template?.keyEnv || null,
    modelCount: Array.isArray(template?.models) ? template.models.length : 0,
    local: isLocalTemplate(template),
    templateOnly,
    baseUrlKind: describeBaseUrlKind(baseUrl)
  };
}

function cloneProviderTemplate(template) {
  const provider = {
    name: String(template.name),
    displayName: String(template.displayName || template.name),
    baseUrl: String(template.baseUrl),
    apiFormat: template.apiFormat || "openai",
    keyEnv: template.keyEnv || null,
    models: Array.isArray(template.models) ? template.models.map((model) => String(model)) : []
  };
  if (template.allowInsecureHttp === true) provider.allowInsecureHttp = true;
  if (template.extraHeaders && typeof template.extraHeaders === "object" && !Array.isArray(template.extraHeaders)) {
    provider.extraHeaders = { ...template.extraHeaders };
  }
  if (template.balanceEndpoint && typeof template.balanceEndpoint === "object" && !Array.isArray(template.balanceEndpoint)) {
    provider.balanceEndpoint = JSON.parse(JSON.stringify(template.balanceEndpoint));
  }
  return provider;
}

function isLocalTemplate(template) {
  const name = String(template?.name || "").toLowerCase();
  const baseUrl = String(template?.baseUrl || "").toLowerCase();
  return LOCAL_PROVIDER_NAMES.has(name) ||
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("[::1]");
}

function describeBaseUrlKind(baseUrl) {
  if (!baseUrl) return "missing";
  if (/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::|\/|$)/i.test(baseUrl)) return "loopback_http";
  if (/^https:\/\/.*<[^>]+>/.test(baseUrl)) return "https_user_template";
  if (baseUrl.startsWith("https://")) return "https";
  if (baseUrl.startsWith("http://")) return "remote_http";
  return "other";
}
