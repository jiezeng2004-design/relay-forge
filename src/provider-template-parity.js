import { LOCAL_PROVIDER_NAMES } from "./provider-registry.js";

const DEFAULT_VERSION = "0.3.32";
const UPSTREAM_API_LOCAL_PROVIDER_TARGET = 34;
const UPSTREAM_LOCAL_CONNECTOR_TARGET = 11;
const UPSTREAM_NON_VIRTUAL_PROVIDER_TARGET = 45;

const PUBLIC_INFO_GAPS = [
  { name: "kilo", reason: "public_base_url_unconfirmed", placeholderTemplate: true },
  { name: "llm7", reason: "public_base_url_unconfirmed", placeholderTemplate: true },
  { name: "blazeapi", reason: "public_base_url_unconfirmed", placeholderTemplate: true },
  { name: "bazaarlink", reason: "public_base_url_unconfirmed", placeholderTemplate: true }
];

export function buildProviderTemplateParity(options = {}) {
  const version = options.version || DEFAULT_VERSION;
  const generatedAt = options.generatedAt || new Date().toISOString();
  const templates = Array.isArray(options.templates) ? options.templates : [];
  const configuredProviderNames = new Set(Array.isArray(options.configuredProviders) ? options.configuredProviders : []);

  const providers = templates.map((template) => buildProviderEntry(template, configuredProviderNames));
  const localTemplates = providers.filter((provider) => provider.local);
  const apiTemplates = providers.filter((provider) => !provider.local);
  const configReadyTemplates = providers.filter((provider) => provider.configReady);
  const templateOnly = providers.filter((provider) => !provider.configReady);
  const configuredTemplates = providers.filter((provider) => provider.configured);
  const allNames = new Set(providers.map((provider) => provider.name));
  const duplicateNames = providers
    .map((provider) => provider.name)
    .filter((name, index, names) => names.indexOf(name) !== index)
    .filter((name, index, names) => names.indexOf(name) === index);

  return {
    ok: true,
    version,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt,
    upstreamTargets: {
      apiLocalProviders: UPSTREAM_API_LOCAL_PROVIDER_TARGET,
      localConnectors: UPSTREAM_LOCAL_CONNECTOR_TARGET,
      nonVirtualProviders: UPSTREAM_NON_VIRTUAL_PROVIDER_TARGET
    },
    summary: {
      totalTemplates: providers.length,
      apiTemplates: apiTemplates.length,
      localTemplates: localTemplates.length,
      configReadyTemplates: configReadyTemplates.length,
      templateOnly: templateOnly.length,
      configuredTemplates: configuredTemplates.length,
      publicInfoGaps: PUBLIC_INFO_GAPS.length,
      duplicateNames: duplicateNames.length,
      apiLocalTargetCovered: providers.length >= UPSTREAM_API_LOCAL_PROVIDER_TARGET,
      localTargetCovered: localTemplates.length >= 5,
      nonVirtualWithLocalConnectors: providers.length + UPSTREAM_LOCAL_CONNECTOR_TARGET
    },
    safety: {
      readsCredentials: false,
      readsTokens: false,
      readsLocalPaths: false,
      writesConfig: false,
      storesKeys: false,
      startsProcesses: false,
      makesNetworkRequests: false,
      registersRoutes: false
    },
    publicInfoGaps: PUBLIC_INFO_GAPS.map((item) => ({ ...item })),
    duplicateNames,
    missingTemplateNames: PUBLIC_INFO_GAPS
      .filter((gap) => !allNames.has(gap.name))
      .map((gap) => gap.name),
    providers
  };
}

function buildProviderEntry(template, configuredProviderNames) {
  const name = String(template?.name || "").trim();
  const baseUrl = String(template?.baseUrl || "").trim();
  const placeholderRequired = /<[^>]+>/.test(baseUrl);
  const local = isLocalTemplate(template);
  return {
    name,
    displayName: String(template?.displayName || name),
    apiFormat: template?.apiFormat || "openai",
    keyEnv: template?.keyEnv || null,
    local,
    configured: configuredProviderNames.has(name),
    modelCount: Array.isArray(template?.models) ? template.models.length : 0,
    configReady: Boolean(name && baseUrl && !placeholderRequired),
    templateOnly: placeholderRequired,
    parityRole: local ? "local_endpoint" : "direct_api",
    baseUrlKind: describeBaseUrlKind(baseUrl),
    notes: placeholderRequired
      ? ["requires_user_specific_base_url"]
      : local
        ? ["local_endpoint_no_api_key_required"]
        : ["byok_api_provider"]
  };
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
