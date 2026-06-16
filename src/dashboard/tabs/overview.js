import { escapeHtml } from "../../http-helpers.js";
import { formatTimestamp } from "../shared.js";

export function renderOverviewTab(ctx) {
  const { status, port, relayAuth, baseUrl, apiKeyHint } = ctx;
  const providers = status.providers || [];
  const combos = status.combos || [];
  const recentRequests = status.recentRequests || [];
  const recentErrors = status.recentErrors || [];
  const usage = status.usage || {};
  const todayReq = (usage.daily && usage.daily.total) || 0;
  const providerReady = providers.filter((p) => p.local || (p.keyCount || 0) > 0).length;
  const missingProviderKeys = providers.filter((p) => !p.local && (p.keyCount || 0) === 0).length;
  const authEnabled = relayAuth?.tokenRequired && !relayAuth?.allowNoAuth;
  const maskedToken = relayAuth?.apiKeyMasked || apiKeyHint || "te****en";
  const model = "smart-coding";
  const safeBaseUrl = baseUrl || `http://127.0.0.1:${port}/v1`;
  const firstRequestSeen = recentRequests.length > 0 || todayReq > 0;
  const providerConfigured = providerReady > 0;
  const next = chooseNextAction({ providerConfigured, firstRequestSeen });

  return `
<div class="rf-hero">
  <div>
    <h1>RelayForge is running</h1>
    <p>Local-first AI coding gateway for OpenAI-compatible and Anthropic-compatible clients.</p>
    <div class="rf-hero-status">
      <span class="rf-badge rf-badge-success"><span class="rf-status-dot rf-status-dot-green"></span>Running</span>
      <span class="rf-badge ${authEnabled ? "rf-badge-success" : "rf-badge-warning"}">${authEnabled ? "Auth enabled" : "Auth disabled"}</span>
      <span class="rf-badge rf-badge-local">Local only</span>
      <span class="rf-badge rf-badge-info">Zero dependencies</span>
    </div>
  </div>
  <div class="rf-status-card">
    <span class="label">Gateway endpoint</span>
    <strong>${escapeHtml(safeBaseUrl)}</strong>
    <span class="muted">Use this in CC Switch, opencode, Codex, Cline, or any OpenAI-compatible client.</span>
  </div>
</div>

<div class="rf-quick-setup">
  <div class="panel-title">
    <h3>Quick Connect</h3>
    <span class="pill ok">screenshot-ready</span>
  </div>
  ${renderQuickLine("Base URL", safeBaseUrl, "overview-base-url")}
  ${renderQuickLine("API Key", maskedToken, "overview-api-key")}
  ${renderQuickLine("Recommended Model", model, "overview-model")}
  <div class="notice warn">Do not share this token. The UI only displays masked token hints.</div>
</div>

<div class="rf-section">
  <div class="rf-section-title">Setup Progress</div>
  <div class="rf-section-desc">Follow the status trail from local server to first request.</div>
  <div class="rf-progress">
    ${renderStep("RelayForge running", true, "Server is reachable")}
    ${renderStep("Auth token configured", authEnabled, authEnabled ? "Token required" : "Set RELAYFORGE_TOKEN")}
    ${renderStep("Provider key configured", providerConfigured, providerConfigured ? `${providerReady} provider(s) ready` : "No provider keys configured yet")}
    ${renderStep("First request received", firstRequestSeen, firstRequestSeen ? `${todayReq} today` : "No requests yet")}
  </div>
</div>

<div class="rf-metrics">
  <div class="rf-metric"><span class="rf-metric-value">${providerReady}/${providers.length}</span><span class="rf-metric-label">Providers ready</span></div>
  <div class="rf-metric"><span class="rf-metric-value">${combos.length}</span><span class="rf-metric-label">Combo models</span></div>
  <div class="rf-metric"><span class="rf-metric-value">${todayReq}</span><span class="rf-metric-label">Requests today</span></div>
  <div class="rf-metric"><span class="rf-metric-value ${recentErrors.length > 0 ? "bad" : "ok"}">${recentErrors.length}</span><span class="rf-metric-label">Recent errors</span></div>
</div>

<div class="rf-next-action">
  <div>
    <div class="rf-section-title">Recommended next action</div>
    <div class="muted">${escapeHtml(next.hint)}</div>
  </div>
  <button type="button" class="primary" data-tab-link="${escapeHtml(next.tab)}">${escapeHtml(next.label)}</button>
</div>

${missingProviderKeys > 0 ? `<div class="notice warn">${missingProviderKeys} provider(s) are missing API keys. Add environment keys or encrypted Web Keys before routing cloud traffic.</div>` : ""}
${renderRecentActivity(recentRequests)}
`;
}

function renderQuickLine(label, value, id) {
  return `<div class="rf-qsv">
    <span class="rf-qsv-label">${escapeHtml(label)}</span>
    <span class="rf-qsv-value" id="${escapeHtml(id)}">${escapeHtml(value)}</span>
    <button type="button" class="rf-qsv-copy" data-copy="#${escapeHtml(id)}">Copy</button>
  </div>`;
}

function renderStep(label, ok, detail) {
  return `<div class="rf-progress-step ${ok ? "ok" : "warn"}">
    <span class="dot"></span>
    <strong>${escapeHtml(label)}</strong>
    <span>${escapeHtml(detail)}</span>
  </div>`;
}

function chooseNextAction(state) {
  if (!state.providerConfigured) {
    return { label: "Add your first provider key", tab: "providers", hint: "Connect one local or cloud provider before sending client traffic." };
  }
  if (!state.firstRequestSeen) {
    return { label: "Copy client config", tab: "clients", hint: "Your route is ready; copy a client preset and send the first request." };
  }
  return { label: "View usage logs", tab: "usage", hint: "Requests are flowing. Check latency, status codes, and error categories." };
}

function renderRecentActivity(requests) {
  if (!requests.length) {
    return `<div class="rf-section">
      <div class="rf-section-title">Recent Activity</div>
      <div class="rf-empty">
        <div class="rf-empty-title">No requests yet</div>
        <div class="rf-empty-desc">Connect a client to send your first request. Prompt content is not shown here.</div>
      </div>
    </div>`;
  }
  return `<div class="rf-section">
    <div class="rf-section-title">Recent Activity</div>
    <div class="rf-section-desc">Last ${Math.min(requests.length, 5)} requests. No prompt content is displayed.</div>
    <div class="scroll-x"><table class="rf-table">
      <thead><tr><th>Status</th><th>Model</th><th>Provider</th><th>Latency</th><th>Time</th></tr></thead>
      <tbody>${requests.slice(0, 5).map((r) => {
        const ok = r.status >= 200 && r.status < 300;
        return `<tr>
          <td><span class="rf-status-dot ${ok ? "rf-status-dot-green" : "rf-status-dot-red"}"></span>${escapeHtml(String(r.status || "?"))}</td>
          <td><code>${escapeHtml(r.model || "?")}</code></td>
          <td>${escapeHtml(r.provider || r.route || "?")}</td>
          <td>${escapeHtml(r.elapsedMs ? r.elapsedMs + "ms" : "?")}</td>
          <td>${escapeHtml(formatTimestamp(r.timestamp))}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>
  </div>`;
}
