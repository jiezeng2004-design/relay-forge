import { escapeHtml } from "../../http-helpers.js";
import { formatTimestamp } from "../shared.js";

const ERROR_CATEGORIES = [
  "all", "stream_idle_timeout", "upstream_429", "upstream_5xx", "upstream_timeout",
  "upstream_auth", "upstream_request_failed", "stream_read_failed", "stream_parse_failed",
  "config_error", "local_limit", "other", "timeout", "auth_failed", "connection_failed", "missing_key"
];

export function renderUsageTab(ctx) {
  const { status, port } = ctx;
  const usage = status.usage || {};
  const daily = usage.daily || {};
  const recentRequests = status.recentRequests || [];
  const requestStats = status.requestStats || {};
  const total = daily.total || 0;
  const success = requestStats.success || 0;
  const failed = requestStats.failed || 0;
  const avgLatency = requestStats.avgLatencyMs || 0;
  const successRate = total > 0 ? Math.round((success / total) * 100) : 0;
  const errorCount = failed;
  const byProvider = requestStats.byProvider || {};
  const byModel = requestStats.byModel || {};
  const byError = requestStats.byError || {};

  return `
<div class="rf-metrics">
  <div class="rf-metric"><div class="rf-metric-value">${total}</div><div class="rf-metric-label">Requests Today</div></div>
  <div class="rf-metric"><div class="rf-metric-value" style="color:${successRate >= 80 ? '#16a34a' : successRate >= 50 ? '#d97706' : '#dc2626'}">${successRate}%</div><div class="rf-metric-label">Success Rate</div></div>
  <div class="rf-metric"><div class="rf-metric-value">${avgLatency}ms</div><div class="rf-metric-label">Avg Latency</div></div>
  <div class="rf-metric"><div class="rf-metric-value" style="color:${errorCount > 0 ? '#ef4444' : '#22c55e'}">${errorCount}</div><div class="rf-metric-label">Errors</div></div>
</div>

${renderByProvider(byProvider)}
${renderByModel(byModel)}
${renderErrorDistribution(byError)}
${renderRecentRequests(recentRequests)}
`;
}

function renderByProvider(byProvider) {
  const entries = Object.entries(byProvider).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return "";
  return `
<div class="rf-section">
  <div class="rf-section-title">Provider Usage</div>
  <table class="rf-table">
    <thead><tr><th>Provider</th><th>Requests</th><th>%</th></tr></thead>
    <tbody>${entries.map(([name, count]) => {
      const pct = count; // Simplification
      return `<tr><td>${escapeHtml(name)}</td><td>${count}</td><td><div class="rf-usage-bar"><div class="rf-usage-fill" style="width:${Math.min(100, pct)}%;background:#2563eb"></div></div></td></tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
}

function renderByModel(byModel) {
  const entries = Object.entries(byModel).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (entries.length === 0) return "";
  return `
<div class="rf-section">
  <div class="rf-section-title">Model Usage</div>
  <table class="rf-table">
    <thead><tr><th>Model</th><th>Requests</th></tr></thead>
    <tbody>${entries.map(([name, count]) => `<tr><td><code>${escapeHtml(name)}</code></td><td>${count}</td></tr>`).join("")}</tbody>
  </table>
</div>`;
}

function renderErrorDistribution(byError) {
  const entries = Object.entries(byError);
  if (entries.length === 0) return "";
  const colorMap = { missing_key: "#d97706", connection_failed: "#ef4444", upstream_429: "#f97316", upstream_5xx: "#dc2626", timeout: "#8b5cf6", auth_failed: "#db2777", unknown: "#6b7280" };
  return `
<div class="rf-section">
  <div class="rf-section-title">Error Distribution</div>
  <table class="rf-table">
    <thead><tr><th>Category</th><th>Count</th></tr></thead>
    <tbody>${entries.map(([cat, count]) => {
      const color = colorMap[cat] || "#6b7280";
      return `<tr><td><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px"></span>${escapeHtml(cat)}</td><td>${count}</td></tr>`;
    }).join("")}</tbody>
  </table>
</div>`;
}

function renderCategoryFilters() {
  return ERROR_CATEGORIES.map((cat) => {
    const isActive = cat === "all" ? ' data-filter-active="true"' : '';
    return `<button type="button" class="rf-btn rf-btn-sm rf-btn-secondary category-filter" data-filter-cat="${escapeHtml(cat)}"${isActive}><span class="err-cat ${escapeHtml(cat)}"></span>${escapeHtml(cat)}</button>`;
  }).join("");
}

function renderRecentRequests(requests) {
  const section = (content) => `
<div class="rf-section">
  <div class="rf-section-title">Recent Requests</div>
  <div class="rf-section-desc">Last ${requests.length || 0} requests (most recent first). No prompt content is stored.</div>
  <div style="margin-bottom:12px;display:flex;gap:4px;flex-wrap:wrap;">
    ${renderCategoryFilters()}
  </div>
  ${content}
</div>`;

  const emptyContent = `<div class="rf-empty"><div class="rf-empty-icon">📡</div><div class="rf-empty-title">No requests yet</div><div class="rf-empty-desc">Send a request or connect an AI coding tool to see request history here.</div></div>`;

  if (requests.length === 0) {
    return section(emptyContent) + renderCodexDiagnostics(requests) + renderErrorSummary([]);
  }

  const errorRows = requests.filter(r => r.status >= 400).slice(0, 5).map((r) => {
    const cat = r.errorCategory || "unknown";
    return `<tr data-error-category="${escapeHtml(cat)}">
      <td class="code">${escapeHtml(formatTimestamp(r.timestamp))}</td>
      <td><code>${escapeHtml(r.model || "?")}</code></td>
      <td>${escapeHtml(r.provider || "?")}</td>
      <td><span class="rf-badge rf-badge-danger">${r.status || "?"}</span></td>
      <td>${escapeHtml(cat)}</td>
    </tr>`;
  }).join("");

  return section(`
    <table class="rf-table" id="error-table">
      <thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Status</th><th>Category</th></tr></thead>
      <tbody>${errorRows || '<tr><td colspan="5"><span class="muted">No errors</span></td></tr>'}</tbody>
    </table>
    <table class="rf-table" style="margin-top:16px">
      <thead><tr><th>Time</th><th>Model</th><th>Provider</th><th>Status</th><th>Latency</th><th>Attempts</th></tr></thead>
      <tbody>${requests.slice(0,5).map((r) => {
        const sc = r.status >= 200 && r.status < 300 ? "success" : r.status >= 400 ? "danger" : "neutral";
        return `<tr>
          <td class="code">${escapeHtml(formatTimestamp(r.timestamp))}</td>
          <td><code>${escapeHtml(r.model || "?")}</code></td>
          <td>${escapeHtml(r.provider || "?")}</td>
          <td><span class="rf-badge rf-badge-${sc}">${r.status || "?"}</span></td>
          <td>${r.elapsedMs ? r.elapsedMs + "ms" : "?"}</td>
          <td>${r.attempt || 1}</td>
        </tr>`;
      }).join("")}</tbody>
    </table>
  `) + renderCodexDiagnostics(requests) + renderErrorSummary(requests);
}

function renderErrorSummary(requests) {
  const errors = requests.filter(r => r.status >= 400 && r.errorCategory);
  const errCats = new Set();
  for (const e of errors) { errCats.add(e.errorCategory || "unknown"); }
  const allCats = ERROR_CATEGORIES.filter(c => c !== "all");
  const catChips = allCats.map(c => `<span class="err-cat ${escapeHtml(c)}"></span>`).join("");
  const counts = {};
  for (const e of errors) { const c = e.errorCategory || "unknown"; counts[c] = (counts[c] || 0) + 1; }
  return `<div class="rf-section">
    <div class="rf-section-title">Error Summary ${catChips}</div>
    <table class="rf-table"><thead><tr><th>Category</th><th>Count</th></tr></thead>
    <tbody>${Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${escapeHtml(k)}</td><td>${v}</td></tr>`).join("") || '<tr><td colspan="2"><span class="muted">No errors recorded</span></td></tr>'}</tbody></table></div>`;
}

function renderCodexDiagnostics(requests) {
  const errors = requests.filter(r => r.status >= 400);
  const lines = [
    "RelayForge Codex Diagnostics",
    "---",
    "Recent requests: " + requests.length,
    "Errors: " + errors.length,
    "---",
    ...errors.slice(0, 10).map((r) => {
      const ec = r.errorCategory || "unknown";
      return `  [${r.status}] ${r.model || "?"} via ${r.provider || "?"} — ${ec} (${r.elapsedMs || "?"}ms, attempts: ${r.attempt || 1})`;
    })
  ];
  const text = lines.join("\n");
  return `
<div class="rf-section">
  <div class="rf-section-title">Codex Diagnostics</div>
  <div class="rf-section-desc">Redacted diagnostic data safe to share for troubleshooting.</div>
  <textarea id="codex-diagnostic-summary" style="width:100%;height:120px;font-family:monospace;font-size:11px;padding:8px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc" readonly>${escapeHtml(text.slice(0, 2000))}</textarea>
  <div style="margin-top:8px"><button id="copy-codex-diagnostics" class="rf-btn rf-btn-sm rf-btn-secondary" onclick="(()=>{const t=document.getElementById('codex-diagnostic-summary');t.select();navigator.clipboard.writeText(t.value);})()">Copy diagnostics</button></div>
</div>`;
}
