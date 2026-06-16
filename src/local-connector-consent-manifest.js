import { buildLocalConnectorProviderPreview } from "./local-connector-provider-preview.js";

const CONSENT_PROFILES = {
  "claude-desktop": {
    credentialScope: "desktop_session",
    riskLevel: "high",
    futureActions: ["read_local_session", "register_provider_route"],
    reviewTags: ["desktop_session", "native_account_quota", "anthropic_format"]
  },
  "claude-code": {
    credentialScope: "cli_auth",
    riskLevel: "high",
    futureActions: ["read_cli_auth", "register_provider_route"],
    reviewTags: ["cli_auth", "anthropic_format"]
  },
  kiro: {
    credentialScope: "app_session",
    riskLevel: "high",
    futureActions: ["read_app_session", "register_provider_route"],
    reviewTags: ["app_session", "anthropic_format", "manual_review"]
  },
  windsurf: {
    credentialScope: "ide_session",
    riskLevel: "high",
    futureActions: ["read_ide_session", "register_provider_route"],
    reviewTags: ["ide_session", "openai_format", "manual_review"]
  },
  antigravity: {
    credentialScope: "ide_session",
    riskLevel: "high",
    futureActions: ["read_ide_session", "register_provider_route"],
    reviewTags: ["ide_session", "gemini_route", "manual_review"]
  },
  opencode: {
    credentialScope: "cli_config",
    riskLevel: "medium",
    futureActions: ["read_cli_config", "register_provider_route"],
    reviewTags: ["cli_config", "openai_format"]
  },
  "vscode-copilot": {
    credentialScope: "ide_session",
    riskLevel: "high",
    futureActions: ["read_ide_session", "register_provider_route"],
    reviewTags: ["ide_session", "copilot_quota", "manual_review"]
  },
  "openai-codex": {
    credentialScope: "cli_auth",
    riskLevel: "high",
    futureActions: ["read_cli_auth", "register_provider_route"],
    reviewTags: ["cli_auth", "openai_format"]
  },
  "gemini-cli": {
    credentialScope: "cli_oauth",
    riskLevel: "high",
    futureActions: ["read_cli_oauth", "register_provider_route"],
    reviewTags: ["cli_oauth", "gemini_route"]
  },
  "rovo-dev": {
    credentialScope: "app_or_env_session",
    riskLevel: "high",
    futureActions: ["read_app_session", "register_provider_route"],
    reviewTags: ["app_session", "atlassian_quota", "manual_review"]
  },
  qclaw: {
    credentialScope: "local_gateway",
    riskLevel: "medium",
    futureActions: ["connect_local_gateway", "register_provider_route"],
    reviewTags: ["local_gateway", "agent_gateway"]
  }
};

const REQUIRED_CONSENT = [
  "select_connector",
  "review_credential_scope",
  "approve_one_time_credential_read",
  "approve_provider_registration",
  "accept_upstream_terms_responsibility"
];

const FORBIDDEN_NOW = [
  "read_tokens",
  "read_cookies",
  "read_sessions",
  "read_keychain",
  "read_browser_profiles",
  "read_ide_credentials",
  "return_local_paths",
  "execute_connector_command",
  "start_gateway",
  "register_provider_route",
  "write_config"
];

function resolvePlatform(platform) {
  if (platform === "auto" || !platform) {
    try {
      return process.platform === "win32" ? "windows" : process.platform;
    } catch {
      return "windows";
    }
  }
  return platform;
}

function buildManifestEntry(provider) {
  const profile = CONSENT_PROFILES[provider.id] || {
    credentialScope: "manual_review",
    riskLevel: "high",
    futureActions: ["manual_review", "register_provider_route"],
    reviewTags: ["manual_review"]
  };
  const blockers = Array.from(new Set([
    ...(provider.blockers || []),
    "explicit_user_consent_required",
    "security_review_required"
  ]));

  return {
    id: provider.id,
    name: provider.name,
    kind: provider.kind,
    providerName: provider.providerName,
    directRoute: provider.directRoute,
    apiFormats: provider.apiFormats,
    availability: provider.availability,
    readiness: provider.readiness,
    credentialScope: profile.credentialScope,
    riskLevel: profile.riskLevel,
    consentStatus: "not_requested",
    approvalState: "not_approved",
    canProceed: false,
    blockers,
    requiredConsent: REQUIRED_CONSENT,
    futureActions: profile.futureActions,
    reviewTags: profile.reviewTags,
    forbiddenNow: FORBIDDEN_NOW,
    safety: {
      dryRunOnly: true,
      readsTokens: false,
      readsCookies: false,
      readsSessionStorage: false,
      readsBrowserProfiles: false,
      readsIdeCredentials: false,
      readsKeychain: false,
      returnsLocalPaths: false,
      modifiesConfig: false,
      writesSystemEnv: false,
      startsNetworkListener: false,
      startsProcess: false,
      registersRoutes: false,
      storesConsent: false
    }
  };
}

export function buildLocalConnectorConsentManifest(options = {}) {
  const platform = resolvePlatform(options.platform || "auto");
  const previewOptions = {
    platform,
    version: options.version || "0.3.18"
  };
  if (options.generatedAt) previewOptions.generatedAt = options.generatedAt;
  if (typeof options.commandExists === "function") previewOptions.commandExists = options.commandExists;
  const preview = buildLocalConnectorProviderPreview(previewOptions);
  const manifests = (preview.providers || []).map(buildManifestEntry);

  return {
    ok: true,
    version: options.version || "0.3.18",
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    platform,
    summary: {
      total: manifests.length,
      consentRequired: manifests.length,
      approved: 0,
      canProceed: 0,
      blocked: manifests.length,
      credentialReads: 0,
      configWrites: 0,
      pathsDisclosed: 0,
      processesStarted: 0,
      routesRegistered: 0,
      consentStored: 0
    },
    safety: {
      dryRunOnly: true,
      readsTokens: false,
      readsCookies: false,
      readsSessionStorage: false,
      readsBrowserProfiles: false,
      readsIdeCredentials: false,
      readsKeychain: false,
      returnsLocalPaths: false,
      modifiesConfig: false,
      writesSystemEnv: false,
      startsNetworkListener: false,
      startsProcess: false,
      registersRoutes: false,
      storesConsent: false
    },
    manifests
  };
}
