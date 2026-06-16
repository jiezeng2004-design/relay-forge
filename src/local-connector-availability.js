import { accessSync, constants } from "node:fs";

const CONNECTOR_AVAIL_DEFS = [
  { id: "opencode", name: "OpenCode", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: ["opencode", "opencode.cmd"], probeType: "path_command_hint" },
  { id: "openai-codex", name: "OpenAI Codex", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: ["codex", "codex.cmd"], probeType: "path_command_hint" },
  { id: "gemini-cli", name: "Gemini CLI", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: ["gemini", "gemini.cmd"], probeType: "path_command_hint" },
  { id: "claude-code", name: "Claude Code", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: ["claude", "claude.cmd"], probeType: "path_command_hint" },
  { id: "qclaw", name: "QClaw", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: ["qclaw", "qclaw.cmd"], probeType: "path_command_hint" },
  { id: "claude-desktop", name: "Claude Desktop", kind: "desktop-session", platforms: ["windows", "darwin"], commandHints: [], probeType: "platform_only" },
  { id: "kiro", name: "Kiro (AWS)", kind: "cli-tool", platforms: ["windows", "linux", "darwin"], commandHints: [], probeType: "manual_review" },
  { id: "windsurf", name: "Windsurf (Codeium)", kind: "ide", platforms: ["windows", "linux", "darwin"], commandHints: [], probeType: "manual_review" },
  { id: "antigravity", name: "Antigravity", kind: "ide", platforms: ["windows", "linux", "darwin"], commandHints: [], probeType: "manual_review" },
  { id: "vscode-copilot", name: "VS Code Copilot", kind: "ide", platforms: ["windows", "linux", "darwin"], commandHints: [], probeType: "manual_review" },
  { id: "rovo-dev", name: "Rovo Dev", kind: "ide", platforms: ["windows", "linux", "darwin"], commandHints: [], probeType: "manual_review" }
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

function safeCommandExists(commandName) {
  const pathEnv = (process.env.PATH || "");
  const separator = process.platform === "win32" ? ";" : ":";
  const dirs = pathEnv.split(separator).filter(Boolean);
  for (const dir of dirs) {
    const sep = dir.endsWith("\\") || dir.endsWith("/") ? "" : (process.platform === "win32" ? "\\" : "/");
    const candidate = dir + sep + commandName;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function resolveAvailability(def, platform, commandExists) {
  if (!def.platforms.includes(platform)) {
    return { availability: "unsupported_platform", evidence: ["platform_unsupported"] };
  }
  if (def.probeType === "platform_only") {
    return { availability: "available", evidence: ["platform_supported"] };
  }
  if (def.probeType === "manual_review") {
    return { availability: "unknown", evidence: ["manual_review_required"] };
  }
  if (def.probeType === "path_command_hint") {
    if (!def.commandHints || def.commandHints.length === 0) {
      return { availability: "unknown", evidence: ["manual_review_required"] };
    }
    for (const hint of def.commandHints) {
      if (commandExists(hint)) {
        return { availability: "available", evidence: ["command_found"] };
      }
    }
    return { availability: "not_found", evidence: ["command_missing"] };
  }
  return { availability: "unknown", evidence: ["manual_review_required"] };
}

export function buildLocalConnectorAvailability(options = {}) {
  const platform = resolvePlatform(options.platform || "auto");
  const commandExists = typeof options.commandExists === "function" ? options.commandExists : safeCommandExists;

  const connectors = CONNECTOR_AVAIL_DEFS.map((def) => {
    const resolved = resolveAvailability(def, platform, commandExists);
    return {
      id: def.id,
      name: def.name,
      kind: def.kind,
      probeType: def.probeType,
      availability: resolved.availability,
      evidence: resolved.evidence,
      pathDisclosed: false,
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
        disclosesPaths: false
      }
    };
  });

  const available = connectors.filter((c) => c.availability === "available").length;
  const notFound = connectors.filter((c) => c.availability === "not_found").length;
  const unsupportedPlatform = connectors.filter((c) => c.availability === "unsupported_platform").length;
  const unknown = connectors.filter((c) => c.availability === "unknown").length;

  return {
    ok: true,
    version: options.version || "0.3.16",
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    platform,
    summary: {
      total: connectors.length,
      available,
      notFound,
      unsupportedPlatform,
      unknown,
      credentialReads: 0,
      configWrites: 0,
      pathsDisclosed: 0,
      processesStarted: 0
    },
    connectors
  };
}
