const DEFAULT_PROXY_DEFS = [
  { id: "cursor", name: "Cursor", protocol: "ConnectRPC over HTTP/2" },
  { id: "windsurf", name: "Windsurf", protocol: "ConnectRPC" },
  { id: "vscode-copilot", name: "VS Code Copilot", protocol: "Ollama BYOK bridge" },
  { id: "antigravity", name: "Antigravity", protocol: "Gemini REST proxy" }
];

function proxyDefsFrom(portCheck) {
  if (portCheck && Array.isArray(portCheck.proxies) && portCheck.proxies.length > 0) {
    return portCheck.proxies;
  }
  return DEFAULT_PROXY_DEFS;
}

function readinessFor(proxy) {
  if (proxy.portStatus === "available") return "ready";
  if (proxy.portStatus === "occupied") return "blocked";
  if (proxy.portStatus === "unknown") return "needs_review";
  return "needs_port_check";
}

function blockersFor(proxy) {
  if (proxy.portStatus === "occupied") {
    return [`planned port ${proxy.port} is already occupied`];
  }
  if (proxy.portStatus === "unknown") {
    return [`planned port ${proxy.port} could not be verified`];
  }
  if (!proxy.portStatus || proxy.portStatus === "not_checked") {
    return ["port readiness has not been checked"];
  }
  return [];
}

export function buildIdeProxyStartPlan(portCheck, options = {}) {
  const selectedModel = options.model || (portCheck && portCheck.selectedModel) || "auto";
  const proxies = proxyDefsFrom(portCheck).map((proxy, index) => {
    const port = proxy.port || Number(options.port || 18765) + index + 1;
    const host = proxy.host || "127.0.0.1";
    const portStatus = proxy.portStatus || "not_checked";
    const readiness = readinessFor({ ...proxy, portStatus });
    const blockers = blockersFor({ ...proxy, port, portStatus });
    const dryRunCommand = `relayforge ide-proxy start --ide ${proxy.id} --host ${host} --port ${port} --model ${selectedModel} --dry-run`;
    return {
      id: proxy.id,
      name: proxy.name,
      protocol: proxy.protocol || proxy.method || "IDE proxy",
      host,
      port,
      listenUrl: proxy.listenUrl || `http://${host}:${port}`,
      relayUrl: proxy.relayUrl || "http://127.0.0.1:18765/v1",
      selectedModel,
      portStatus,
      readiness,
      canStartNow: false,
      dryRunCommand,
      requiredConsent: [
        "confirm IDE target and model route",
        "confirm local loopback listener startup",
        "confirm no IDE credential import unless explicitly enabled later"
      ],
      nextActions: readiness === "ready"
        ? ["review plan", "run future explicit start command after security review"]
        : ["resolve blockers", "rerun port readiness check"],
      blockers,
      safety: {
        dryRunOnly: true,
        startsProxyListener: false,
        readsIdeCredentials: false,
        modifiesIdeConfig: false,
        writesConfig: false,
        requiresExplicitConsentBeforeRealStart: true
      }
    };
  });

  const summary = {
    total: proxies.length,
    ready: proxies.filter((proxy) => proxy.readiness === "ready").length,
    blocked: proxies.filter((proxy) => proxy.readiness === "blocked").length,
    needsReview: proxies.filter((proxy) => proxy.readiness === "needs_review").length,
    notChecked: proxies.filter((proxy) => proxy.readiness === "needs_port_check").length
  };

  return {
    ok: true,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    selectedModel,
    summary,
    proxies,
    safety: {
      dryRunOnly: true,
      startsProxyListener: false,
      readsIdeCredentials: false,
      modifiesIdeConfig: false,
      writesConfig: false,
      requiresExplicitConsentBeforeRealStart: true
    }
  };
}
