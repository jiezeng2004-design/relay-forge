export function buildIdeProxyRuntimeStatus(preview, options = {}) {
  const model = options.model || (preview && preview.selectedModel) || "auto";
  const baseUrl = (preview && preview.baseUrl) || "http://127.0.0.1:18765";
  const port = options.port || 18765;
  const proxyDefs = preview && preview.proxies ? preview.proxies : [
    { id: "cursor", name: "Cursor" },
    { id: "windsurf", name: "Windsurf" },
    { id: "vscode-copilot", name: "VS Code Copilot" },
    { id: "antigravity", name: "Antigravity" }
  ];
  const proxies = proxyDefs.map((def, index) => ({
    id: def.id,
    name: def.name,
    status: "stopped",
    phase: "preview-only",
    listenUrl: `http://127.0.0.1:${port + index + 1}`,
    relayUrl: `${baseUrl}/v1`,
    selectedModel: model,
    canStart: false,
    canStop: false,
    pid: null,
    startedAt: null,
    lastError: null,
    safety: {
      dryRunOnly: true,
      readsIdeCredentials: false,
      modifiesIdeConfig: false,
      startsProxyListener: false
    }
  }));
  return {
    ok: true,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    summary: {
      total: proxies.length,
      running: 0,
      stopped: proxies.length,
      error: 0
    },
    proxies
  };
}
