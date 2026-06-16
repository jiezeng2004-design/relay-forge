export function buildIdeProxyPreview(status, port, options = {}) {
  const relayPort = Number(port || 18765);
  const baseUrl = `http://127.0.0.1:${relayPort}`;
  const model = options.model || "auto";

  const proxyDefs = [
    { id: "cursor", name: "Cursor", method: "RPC proxy (ConnectRPC, HTTP/2)" },
    { id: "windsurf", name: "Windsurf", method: "RPC proxy (ConnectRPC)" },
    { id: "vscode-copilot", name: "VS Code Copilot", method: "Ollama BYOK bridge" },
    { id: "antigravity", name: "Antigravity", method: "Gemini REST proxy" }
  ];

  const proxies = proxyDefs.map((def, index) => ({
    id: def.id,
    name: def.name,
    method: def.method,
    listenUrl: `http://127.0.0.1:${relayPort + index + 1}`,
    relayUrl: `${baseUrl}/v1`,
    status: "dry-run",
    selectedModel: model,
    canStart: false,
    canStop: false,
    notes: [
      "dry-run only — no actual proxy running",
      "does not read IDE credentials",
      "does not modify IDE configuration",
      "does not start a proxy listener"
    ]
  }));

  const capabilityMatrix = [
    { ide: "Cursor", method: "ConnectRPC, HTTP/2", status: "Dry-run only", boundary: "不读取 Cursor token/cookie/session" },
    { ide: "Windsurf", method: "ConnectRPC", status: "Dry-run only", boundary: "不读取 Windsurf 本地凭据" },
    { ide: "VS Code Copilot", method: "Ollama BYOK bridge", status: "Dry-run only", boundary: "不读取 GitHub Copilot 会话" },
    { ide: "Antigravity", method: "Gemini REST proxy", status: "Dry-run only", boundary: "不读取 Antigravity 配置" }
  ];

  return {
    ok: true,
    mode: "dry-run",
    baseUrl,
    selectedModel: model,
    safety: {
      dryRunOnly: true,
      readsIdeCredentials: false,
      modifiesIdeConfig: false,
      startsProxyListener: false
    },
    proxies,
    capabilityMatrix
  };
}
