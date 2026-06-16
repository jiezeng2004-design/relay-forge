import { createConnection } from "node:net";

const DEFAULT_HOST = "127.0.0.1";
const MIN_TIMEOUT_MS = 50;
const MAX_TIMEOUT_MS = 1000;
const DEFAULT_TIMEOUT_MS = 250;

function clampTimeoutMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, Math.floor(parsed)));
}

function normalizeProbeResult(result) {
  const status = result && ["available", "occupied", "unknown"].includes(result.portStatus)
    ? result.portStatus
    : "unknown";
  return {
    portStatus: status,
    reason: result && typeof result.reason === "string" ? result.reason : "probe_unavailable"
  };
}

export function clampIdeProxyPortCheckTimeout(value) {
  return clampTimeoutMs(value);
}

export function probeLoopbackPort({ host = DEFAULT_HOST, port, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = createConnection({ host, port });
    let settled = false;

    function finish(portStatus, reason) {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve({ portStatus, reason, elapsedMs: Date.now() - startedAt });
    }

    socket.setTimeout(clampTimeoutMs(timeoutMs));
    socket.once("connect", () => finish("occupied", "connect_succeeded"));
    socket.once("timeout", () => finish("unknown", "timeout"));
    socket.once("error", (error) => {
      if (error && error.code === "ECONNREFUSED") {
        finish("available", "connection_refused");
        return;
      }
      finish("unknown", error && error.code ? String(error.code).toLowerCase() : "connect_error");
    });
  });
}

export async function buildIdeProxyPortCheck(preview, options = {}) {
  const model = options.model || (preview && preview.selectedModel) || "auto";
  const baseUrl = (preview && preview.baseUrl) || "http://127.0.0.1:18765";
  const relayPort = Number(options.port || 18765);
  const host = options.host || DEFAULT_HOST;
  const timeoutMs = clampTimeoutMs(options.timeoutMs);
  const probe = typeof options.probe === "function" ? options.probe : probeLoopbackPort;
  const proxyDefs = preview && preview.proxies ? preview.proxies : [
    { id: "cursor", name: "Cursor" },
    { id: "windsurf", name: "Windsurf" },
    { id: "vscode-copilot", name: "VS Code Copilot" },
    { id: "antigravity", name: "Antigravity" }
  ];

  const proxies = await Promise.all(proxyDefs.map(async (def, index) => {
    const plannedPort = relayPort + index + 1;
    let probeResult;
    try {
      probeResult = await probe({ id: def.id, name: def.name, host, port: plannedPort, timeoutMs });
    } catch (error) {
      probeResult = { portStatus: "unknown", reason: error && error.message ? error.message : "probe_failed" };
    }
    const normalized = normalizeProbeResult(probeResult);
    return {
      id: def.id,
      name: def.name,
      host,
      port: plannedPort,
      listenUrl: `http://${host}:${plannedPort}`,
      relayUrl: `${baseUrl}/v1`,
      selectedModel: model,
      portStatus: normalized.portStatus,
      reason: normalized.reason,
      canStart: false,
      canStop: false,
      safety: {
        dryRunOnly: true,
        readsIdeCredentials: false,
        modifiesIdeConfig: false,
        startsProxyListener: false,
        writesConfig: false
      }
    };
  }));

  const summary = {
    total: proxies.length,
    available: proxies.filter((proxy) => proxy.portStatus === "available").length,
    occupied: proxies.filter((proxy) => proxy.portStatus === "occupied").length,
    unknown: proxies.filter((proxy) => proxy.portStatus === "unknown").length
  };

  return {
    ok: true,
    mode: "dry-run",
    dryRunOnly: true,
    generatedAt: options.generatedAt || new Date().toISOString(),
    timeoutMs,
    summary,
    proxies
  };
}
