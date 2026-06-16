const CONNECTOR_DEFS = [
  {
    id: "claude-desktop",
    name: "Claude Desktop",
    kind: "desktop-session",
    credentialSource: "Local Claude Desktop session",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "darwin"]
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: "cli-tool",
    credentialSource: "Claude Code local config or environment",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "kiro",
    name: "Kiro (AWS)",
    kind: "cli-tool",
    credentialSource: "AWS SSO session or Kiro config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "windsurf",
    name: "Windsurf (Codeium)",
    kind: "ide",
    credentialSource: "Windsurf IDE config and Codeium auth",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: "ide",
    credentialSource: "Antigravity IDE config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "opencode",
    name: "OpenCode",
    kind: "cli-tool",
    credentialSource: "OpenCode local config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "vscode-copilot",
    name: "VS Code Copilot",
    kind: "ide",
    credentialSource: "VS Code / GitHub Copilot storage",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    kind: "cli-tool",
    credentialSource: "Codex CLI local config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    kind: "cli-tool",
    credentialSource: "Gemini CLI OAuth config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "rovo-dev",
    name: "Rovo Dev",
    kind: "ide",
    credentialSource: "Rovo Dev IDE config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
  },
  {
    id: "qclaw",
    name: "QClaw",
    kind: "cli-tool",
    credentialSource: "QClaw config",
    upstreamStatus: "supported-by-upstream",
    localStatus: "planned",
    platforms: ["windows", "linux", "darwin"]
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

function isAvailableOnPlatform(connector, platform) {
  return connector.platforms.includes(platform);
}

function buildConnectorEntry(def, platform) {
  const availableOnSelected = isAvailableOnPlatform(def, platform);
  return {
    id: def.id,
    name: def.name,
    kind: def.kind,
    credentialSource: def.credentialSource,
    upstreamStatus: def.upstreamStatus,
    localStatus: def.localStatus,
    platforms: def.platforms,
    availableOnSelectedPlatform: availableOnSelected,
    readsCredentials: false,
    modifiesAppConfig: false,
    startsGateway: false,
    safety: {
      dryRunOnly: true,
      readsTokens: false,
      readsCookies: false,
      readsSessionStorage: false,
      readsBrowserProfiles: false,
      readsIdeCredentials: false,
      modifiesConfig: false,
      writesSystemEnv: false,
      startsNetworkListener: false
    },
    requiredConsent: [
      "choose connector explicitly",
      "review credential source",
      "approve one-time local credential read in a future version"
    ],
    nextSteps: [
      "document exact credential source",
      "redacted availability probe done (0.3.16)",
      "add connector-specific security review"
    ]
  };
}

export function buildLocalConnectorPlan(options = {}) {
  const platform = resolvePlatform(options.platform || "auto");
  const connectors = CONNECTOR_DEFS.map((def) => buildConnectorEntry(def, platform));

  const summary = {
    total: connectors.length,
    planned: connectors.filter((c) => c.localStatus === "planned").length,
    implemented: connectors.filter((c) => c.localStatus === "implemented").length,
    credentialReads: 0,
    configWrites: 0
  };

  return {
    ok: true,
    version: options.version || "0.3.15",
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    platform,
    summary,
    connectors,
    safety: {
      dryRunOnly: true,
      readsTokens: false,
      readsCookies: false,
      readsSessionStorage: false,
      readsBrowserProfiles: false,
      readsIdeCredentials: false,
      modifiesConfig: false,
      writesSystemEnv: false,
      startsNetworkListener: false
    }
  };
}
