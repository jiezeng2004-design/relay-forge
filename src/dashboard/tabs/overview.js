import { escapeHtml } from "../../http-helpers.js";
import { formatTimestamp } from "../shared.js";

export function renderOverviewTab(ctx) {
  const { status, port, relayAuth, baseUrl, apiKeyHint, recentPreview } = ctx;
  const providers = status.providers || [];
  const combos = status.combos || [];
  const recentRequests = status.recentRequests || [];
  const stats = status.stats || {};
  const todayReq = (status.usage && status.usage.daily && status.usage.daily.total) || 0;
  const totalProv = providers.length;
  const keyedProv = providers.filter((p) => (p.keyCount || 0) > 0 || p.local).length;
  const errCount = (status.recentErrors || []).length;
  const authStatus = relayAuth?.allowNoAuth ? "warning" : relayAuth?.tokenRequired ? "success" : "neutral";
  const authLabel = relayAuth?.allowNoAuth ? "Auth disabled" : relayAuth?.tokenRequired ? "Auth enabled" : "No token set";
  const hasLocalOnly = providers.every((p) => p.local);

  const authSource = relayAuth?.tokenSource || "unset";
  const authSourceLabel = authSource === "openrelay_env" ? "OPENRELAY_TOKEN (backward compat)" : authSource === "env" ? "RELAYFORGE_TOKEN" : authSource === "generated" ? "Auto-generated token" : authSource === "disk" ? "Persisted token" : authSource === "allowNoAuth" ? "No auth" : "Unset";
  const maskedToken = relayAuth?.apiKeyMasked || apiKeyHint || "";

  const setupLines = [
    { label: "Base URL", value: baseUrl || `http://127.0.0.1:${port}/v1` },
    { label: "API Key", value: maskedToken || "RELAYFORGE_TOKEN" },
    { label: "Model", value: "smart-coding (or any combo name)" }
  ];

  return `
<div class="rf-hero">
  <h1>RelayForge is running</h1>
  <p>A local-first AI coding gateway for OpenAI-compatible and Anthropic-compatible clients.</p>
  <div class="rf-hero-status">
    <span class="rf-badge rf-badge-success"><span class="rf-status-dot rf-status-dot-green"></span>Running</span>
    <span class="rf-badge rf-badge-${authStatus}">${escapeHtml(authLabel)}</span>
    ${hasLocalOnly ? '<span class="rf-badge rf-badge-local">Local only</span>' : '<span class="rf-badge rf-badge-info">Cloud + Local</span>'}
  </div>
  <div style="margin-top:10px;font-size:12px;opacity:0.8">
    Auth source: ${escapeHtml(authSourceLabel)} · Token: ${escapeHtml(maskedToken || "none")}
  </div>
</div>

<div class="rf-quick-setup">
  <h3>Quick Setup</h3>
  ${setupLines.map((l) => `
  <div class="rf-qsv">
    <span class="rf-qsv-label">${escapeHtml(l.label)}</span>
    <span class="rf-qsv-value" id="qsv-${l.label.toLowerCase().replace(/\s+/g,"-")}">${escapeHtml(l.value)}</span>
    <button class="rf-btn rf-btn-sm rf-btn-secondary rf-qsv-copy" data-copy="#qsv-${l.label.toLowerCase().replace(/\s+/g,"-")}">Copy</button>
  </div>`).join("")}
  <p style="margin-top:10px;font-size:11px;color:#94a3b8;">Do not share your API Key.</p>
</div>

<div class="rf-metrics">
  <div class="rf-metric"><div class="rf-metric-value">${escapeHtml(String(keyedProv))}/${escapeHtml(String(totalProv))}</div><div class="rf-metric-label">Providers (keyed / total)</div></div>
  <div class="rf-metric"><div class="rf-metric-value">${combos.length}</div><div class="rf-metric-label">Combo Models</div></div>
  <div class="rf-metric"><div class="rf-metric-value">${todayReq}</div><div class="rf-metric-label">Requests Today</div></div>
  <div class="rf-metric"><div class="rf-metric-value" style="color:${errCount > 0 ? '#ef4444' : '#22c55e'}">${errCount}</div><div class="rf-metric-label">Recent Errors</div></div>
</div>

${renderNextSteps(providers, combos, recentRequests)}
${renderRecentActivity(recentRequests)}
`;
}

function renderNextSteps(providers, combos, recentRequests) {
  const hasKeys = providers.some((p) => (p.keyCount || 0) > 0 || p.local);
  const hasRequests = recentRequests.length > 0;
  const steps = hasKeys
    ? [
        "Copy your client config from Quick Setup above",
        'Use "<strong>smart-coding</strong>" as your model name',
        recentRequests.length === 0 ? "Send a test request via curl or your AI coding tool" : "Check recent requests below",
        providers.filter((p) => p.keyEnv && !(p.keyCount || 0) > 0).length > 0 ? "Add missing provider API keys" : ""
      ].filter(Boolean)
    : [
        "Add your first provider API key in <strong>Providers</strong> tab",
        'Use "<strong>smart-coding</strong>" as your model name',
        "Copy client config from <strong>Clients</strong> tab",
        "Send a test request via curl or your AI coding tool"
      ];

  return `
<div class="rf-section">
  <div class="rf-section-title">${hasKeys ? "Next Steps" : "Getting Started"}</div>
  <div class="rf-section-desc">${hasKeys ? "Your relay is ready. Here's what to do next:" : "No provider keys configured yet. Get started:"}</div>
  <ol style="padding-left:20px;font-size:13px;color:#334155;line-height:2">
    ${steps.map((s) => `<li>${s}</li>`).join("")}
  </ol>
</div>`;
}

function renderRecentActivity(requests) {
  if (requests.length === 0) {
    return `
<div class="rf-section">
  <div class="rf-section-title">Recent Activity</div>
  <div class="rf-empty">
    <div class="rf-empty-icon">⚡</div>
    <div class="rf-empty-title">No requests yet</div>
    <div class="rf-empty-desc">Connect CC Switch, opencode, Codex, Cline, or any OpenAI-compatible client to start using RelayForge.</div>
  </div>
</div>`;
  }

  return `
<div class="rf-section">
  <div class="rf-section-title">Recent Activity</div>
  <div class="rf-section-desc">Last ${Math.min(requests.length, 5)} requests</div>
  <table class="rf-table">
    <thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Status</th><th>Latency</th></tr></thead>
    <tbody>
      ${requests.slice(0, 5).map((r) => `
      <tr>
        <td class="code">${escapeHtml(formatTimestamp(r.timestamp))}</td>
        <td><code>${escapeHtml(r.model || "?")}</code></td>
        <td>${escapeHtml(r.provider || "?")}</td>
        <td>${r.status >= 200 && r.status < 300 ? '<span class="rf-badge rf-badge-success">' + r.status + '</span>' : r.status >= 400 ? '<span class="rf-badge rf-badge-danger">' + r.status + '</span>' : '<span class="rf-badge rf-badge-neutral">' + (r.status || "?") + '</span>'}</td>
        <td>${r.elapsedMs ? r.elapsedMs + "ms" : "?"}</td>
      </tr>`).join("")}
    </tbody>
  </table>
</div>`;
}
