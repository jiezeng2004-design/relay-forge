import { buildLocalConnectorAvailability } from "./local-connector-availability.js";

const PROVIDER_PREVIEW_DEFS = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    kind: "desktop-session",
    providerName: "claude-desktop",
    directRoute: "/claude-desktop/v1/messages",
    apiFormats: ["anthropic"],
    upstreamQuotaSource: "Claude Desktop local account",
    modelHints: ["claude/default"],
    platforms: ["windows", "darwin"],
    probeType: "platform_only"
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "cli-tool",
    providerName: "claude-code",
    directRoute: "/claude-code/v1/messages",
    apiFormats: ["anthropic"],
    upstreamQuotaSource: "Claude Code local config or environment",
    modelHints: ["claude/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "path_command_hint",
    commandHints: ["claude", "claude.cmd"]
  },
  {
    id: "kiro",
    name: "Kiro (AWS)",
    kind: "cli-tool",
    providerName: "kiro",
    directRoute: "/kiro/v1/messages",
    apiFormats: ["anthropic"],
    upstreamQuotaSource: "AWS SSO session or Kiro config",
    modelHints: ["claude/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "manual_review"
  },
  {
    id: "windsurf",
    name: "Windsurf (Codeium)",
    kind: "ide",
    providerName: "windsurf",
    directRoute: "/windsurf/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "Windsurf IDE config and Codeium auth",
    modelHints: ["local/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "manual_review"
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "ide",
    providerName: "antigravity",
    directRoute: "/antigravity/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "Antigravity IDE config",
    modelHints: ["local/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "manual_review"
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "cli-tool",
    providerName: "opencode",
    directRoute: "/opencode/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "OpenCode local config",
    modelHints: ["opencode/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "path_command_hint",
    commandHints: ["opencode", "opencode.cmd"]
  },
  {
    id: "vscode-copilot",
    name: "VS Code Copilot",
    kind: "ide",
    providerName: "vscode-copilot",
    directRoute: "/vscode-copilot/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "VS Code / GitHub Copilot storage",
    modelHints: ["copilot/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "manual_review"
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    kind: "cli-tool",
    providerName: "openai-codex",
    directRoute: "/openai-codex/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "Codex CLI local config",
    modelHints: ["codex/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "path_command_hint",
    commandHints: ["codex", "codex.cmd"]
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    kind: "cli-tool",
    providerName: "gemini-cli",
    directRoute: "/gemini-cli/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "Gemini CLI OAuth config",
    modelHints: ["gemini/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "path_command_hint",
    commandHints: ["gemini", "gemini.cmd"]
  },
  {
    id: "rovo-dev",
    name: "Rovo Dev",
    kind: "ide",
    providerName: "rovo-dev",
    directRoute: "/rovo-dev/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "Rovo Dev IDE config",
    modelHints: ["local/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "manual_review"
  },
  {
    id: "qclaw",
    name: "QClaw",
    kind: "cli-tool",
    providerName: "qclaw",
    directRoute: "/qclaw/v1/chat/completions",
    apiFormats: ["openai"],
    upstreamQuotaSource: "QClaw config",
    modelHints: ["local/default"],
    platforms: ["windows", "linux", "darwin"],
    probeType: "path_command_hint",
    commandHints: ["qclaw", "qclaw.cmd"]
  }
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

function resolveReadiness(availability) {
  if (availability === "unsupported_platform") {
    return { readiness: "blocked_unsupported_platform", blockers: ["platform_unsupported"] };
  }
  if (availability === "not_found") {
    return { readiness: "blocked_missing_tool", blockers: ["command_missing"] };
  }
  if (availability === "unknown") {
    return { readiness: "needs_manual_review", blockers: ["manual_review_required"] };
  }
  return { readiness: "credential_consent_required", blockers: ["credential_consent_required"] };
}

export function buildLocalConnectorProviderPreview(options = {}) {
  const platform = resolvePlatform(options.platform || "auto");
  const availabilityOptions = {
    platform,
    version: options.version || "0.3.17"
  };
  if (options.generatedAt) availabilityOptions.generatedAt = options.generatedAt;
  if (typeof options.commandExists === "function") availabilityOptions.commandExists = options.commandExists;
  const availabilityReport = buildLocalConnectorAvailability(availabilityOptions);
  const availabilityById = new Map((availabilityReport.connectors || []).map((connector) => [connector.id, connector.availability]));

  const providers = PROVIDER_PREVIEW_DEFS.map((def) => {
    const availability = availabilityById.get(def.id) || "unknown";
    const resolved = resolveReadiness(availability);

    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      providerName: def.providerName,
      directRoute: def.directRoute,
      apiFormats: def.apiFormats,
      upstreamQuotaSource: def.upstreamQuotaSource,
      modelHints: def.modelHints,
      availability,
      readiness: resolved.readiness,
      blockers: resolved.blockers,
      registered: false,
      credentialStatus: "not_checked",
      safety: {
        dryRunOnly: true,
        readsTokens: false,
        readsCookies: false,
        readsSessionStorage: false,
        readsBrowserProfiles: false,
        readsIdeCredentials: false,
        modifiesConfig: false,
        writesSystemEnv: false,
        startsNetworkListener: false,
        startsProcess: false,
        disclosesPaths: false,
        registersRoutes: false
      },
      requiredConsent: [
        "choose connector explicitly",
        "review provider preview",
        "approve one-time local credential read in a future version"
      ]
    };
  });

  let previewReady = 0;
  let blocked = 0;
  let needsManualReview = 0;

  for (const p of providers) {
    if (p.readiness === "credential_consent_required") previewReady += 1;
    else if (p.readiness.startsWith("blocked")) blocked += 1;
    else if (p.readiness === "needs_manual_review") needsManualReview += 1;
  }
  // All 11 connectors require credential consent eventually (cross-cutting count)
  const credentialConsentRequired = providers.length;

  return {
    ok: true,
    version: options.version || "0.3.17",
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    platform,
    summary: {
      total: providers.length,
      previewReady,
      blocked,
      needsManualReview,
      credentialConsentRequired,
      credentialReads: 0,
      configWrites: 0,
      pathsDisclosed: 0,
      processesStarted: 0,
      routesRegistered: 0
    },
    providers
  };
}
