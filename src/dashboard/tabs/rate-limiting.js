import { escapeHtml } from "../../http-helpers.js";

/**
 * Rate Limiting dashboard tab — shows per-provider daily request counts
 * vs configured limits, 429 error statistics, and key-pool cooldown status.
 * Includes a form to adjust limit thresholds via PATCH /admin/limits.
 *
 * @param {object} ctx - { status, port }
 * @returns {string}
 */
export function renderRateLimitingTab(ctx) {
  const status = ctx.status;
  const limits = status.usage?.limits || {};
  const daily = status.usage?.daily || {};
  const dailyRequests = limits.dailyRequests;
  const todayRequests = daily.total || 0;
  const localLimitHits = status.stats?.localLimitHits || 0;
  const keys = status.keys || {};
  const providerHealth = status.providerHealth || {};
  const recentErrors = status.recentErrors || [];

  // Count error categories relevant to rate limiting
  const errorCounts = {};
  for (const e of recentErrors) {
    const cat = e.category || "unknown";
    errorCounts[cat] = (errorCounts[cat] || 0) + 1;
  }
  const error429Count = errorCounts.upstream_429 || 0;
  const error5xxCount = errorCounts.upstream_5xx || 0;
  const errorTimeoutCount = errorCounts.upstream_timeout || 0;
  const errorLocalLimitCount = errorCounts.local_limit || 0;

  // Per-provider daily usage vs limit
  const byProvider = daily.providers || {};
  const providerRows = (status.providers || []).map((p) => {
    const used = byProvider[p.name]?.total || byProvider[p.name] || 0;
    const limit = (limits.providers?.[p.name]?.dailyRequests) || dailyRequests || null;
    const pct = limit ? Math.min(100, Math.round((Number(used) / limit) * 100)) : 0;
    const barColor = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f97316" : "#16a34a";
    const health = providerHealth[p.name];
    const rateLimited = health?.rateLimited === true;
    const status = rateLimited ? `<span class="pill bad">rate-limited</span>` : pct >= 90 && limit ? `<span class="pill warn">near limit</span>` : `<span class="pill ok">healthy</span>`;
    return `<tr><td><strong>${escapeHtml(p.displayName || p.name)}</strong><div class="muted">${escapeHtml(p.name)}</div></td><td>${used}</td><td>${limit || "— (unlimited)"}</td><td><div class="bar"><span style="width:${pct}%;background:${barColor};"></span></div>${pct}%</td><td>${status}</td></tr>`;
  }).join("");

  // Per-route daily usage vs limit
  const byRoute = daily.routes || {};
  const routeRows = (status.routes || []).map((r) => {
    const used = byRoute[r.name] || 0;
    const limit = r.limits?.dailyRequests || limits.routes?.[r.name]?.dailyRequests || dailyRequests || null;
    const pct = limit ? Math.min(100, Math.round((Number(used) / limit) * 100)) : 0;
    const barColor = pct >= 90 ? "#ef4444" : pct >= 75 ? "#f97316" : "#16a34a";
    return `<tr><td><strong>${escapeHtml(r.name)}</strong><div class="muted">${escapeHtml(r.strategy)}</div></td><td>${used}</td><td>${limit || "—"}</td><td><div class="bar"><span style="width:${pct}%;background:${barColor};"></span></div>${pct}%</td></tr>`;
  }).join("");

  // Key Pool cooldown status
  const keyPoolRows = Object.entries(keys).flatMap(([prov, ks]) => ks.map((k) => {
    const cooldown = k.coolingDown;
    return `<tr><td>${escapeHtml(prov)}</td><td><code>${escapeHtml(k.label)}</code><div class="muted mono">${escapeHtml(k.hash || "")}</div></td><td>${k.uses}</td><td>${k.failures}</td><td>${cooldown ? `<span class="pill warn">cooling down</span> <span class="muted">until ${escapeHtml(String(k.cooldownUntil || ""))}</span>` : `<span class="pill ok">ready</span>`}</td></tr>`;
  })).join("");

  // Limits edit form (sends PATCH /admin/limits)
  const dailyRequestsValue = dailyRequests || "";
  const providerLimitRows = (status.providers || []).map((p) => {
    const current = limits.providers?.[p.name]?.dailyRequests || "";
    return `<tr><td><code>${escapeHtml(p.name)}</code></td><td><input type="number" min="0" data-limit-provider="${escapeHtml(p.name)}" value="${current}" placeholder="unlimited" style="width:120px;"></td></tr>`;
  }).join("");

  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Rate Limiting</h1>
    <p class="rf-page-desc">Monitor daily request counts vs configured limits, 429 error trends, and key-pool cooldown state. Adjust thresholds below.</p>
  </div>
</div>

<div class="grid grid-4">
  <div class="metric"><span class="label">Today's requests</span><span class="value" style="font-size:28px;">${todayRequests}</span><span class="sub">Global total</span></div>
  <div class="metric"><span class="label">429 errors</span><span class="value" style="font-size:28px;color:#f97316;">${error429Count}</span><span class="sub">Upstream rate-limited</span></div>
  <div class="metric"><span class="label">Local limit hits</span><span class="value" style="font-size:28px;color:#ef4444;">${localLimitHits}</span><span class="sub">Local quota exceeded</span></div>
  <div class="metric"><span class="label">Key-pool cooldown</span><span class="value" style="font-size:28px;">${Object.entries(keys).flatMap(([_, ks]) => ks.filter(k => k.coolingDown)).length}</span><span class="sub">Keys cooling</span></div>
</div>

<div class="panel">
  <div class="panel-title"><h3>Provider Daily Usage vs Limit</h3><span class="pill ${error429Count > 0 ? "bad" : "ok"}">${error429Count} 429s</span></div>
  ${providerRows ? `<table class="data-table"><thead><tr><th>Provider</th><th>Used</th><th>Limit</th><th>Progress</th><th>Status</th></tr></thead><tbody>${providerRows}</tbody></table>` : '<p class="muted">No providers configured.</p>'}
</div>

<div class="panel">
  <div class="panel-title"><h3>Route Daily Usage vs Limit</h3></div>
  ${routeRows ? `<table class="data-table"><thead><tr><th>Route</th><th>Used</th><th>Limit</th><th>Progress</th></tr></thead><tbody>${routeRows}</tbody></table>` : '<p class="muted">No routes configured.</p>'}
</div>

<div class="panel">
  <div class="panel-title"><h3>Key Pool Cooldown Status</h3></div>
  ${keyPoolRows ? `<table class="data-table"><thead><tr><th>Provider</th><th>Key</th><th>Uses</th><th>Failures</th><th>State</th></tr></thead><tbody>${keyPoolRows}</tbody></table>` : '<p class="muted">No keys in the pool.</p>'}
</div>

<div class="panel">
  <div class="panel-title"><h3>Error Breakdown (recent ${recentErrors.length})</h3></div>
  <div class="grid grid-3">
    <div class="metric"><span class="label">upstream_429</span><span class="value" style="font-size:22px;color:#f97316;">${error429Count}</span></div>
    <div class="metric"><span class="label">upstream_5xx</span><span class="value" style="font-size:22px;color:#ef4444;">${error5xxCount}</span></div>
    <div class="metric"><span class="label">upstream_timeout</span><span class="value" style="font-size:22px;color:#d97706;">${errorTimeoutCount}</span></div>
    <div class="metric"><span class="label">local_limit</span><span class="value" style="font-size:22px;color:#ef4444;">${errorLocalLimitCount}</span></div>
    <div class="metric"><span class="label">connection_failed</span><span class="value" style="font-size:22px;">${errorCounts.connection_failed || 0}</span></div>
    <div class="metric"><span class="label">other</span><span class="value" style="font-size:22px;">${errorCounts.other || 0}</span></div>
  </div>
</div>

<div class="panel">
  <div class="panel-title"><h3>Adjust Limits</h3><span class="pill">PATCH /admin/limits</span></div>
  <p class="muted">Set daily request caps. Leave blank for unlimited (null). Changes take effect immediately for new requests; in-flight requests keep their original config.</p>
  <form id="limits-form" onsubmit="return false;">
    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-title"><h4>Global</h4></div>
        <div class="field-row">
          <div class="field">
            <label for="limit-daily">Global daily limit</label>
            <input type="number" min="0" id="limit-daily" value="${dailyRequestsValue}" placeholder="null = unlimited" style="max-width:200px;">
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title"><h4>Per-provider</h4></div>
        ${providerLimitRows ? `<table class="data-table"><thead><tr><th>Provider</th><th>Daily limit</th></tr></thead><tbody>${providerLimitRows}</tbody></table>` : '<p class="muted">No providers configured.</p>'}
      </div>
    </div>
    <div class="toolbar" style="margin-top:12px;">
      <button type="button" id="limits-save" onclick="saveLimits()">Save limits</button>
      <span id="limits-message" class="muted"></span>
    </div>
  </form>
  <script>
    async function saveLimits() {
      const msg = document.getElementById("limits-message");
      const token = sessionStorage.getItem("relayforge.adminToken") || sessionStorage.getItem("openrelay.adminToken") || "";
      const globalVal = document.getElementById("limit-daily").value.trim();
      const providerInputs = document.querySelectorAll("[data-limit-provider]");
      const providers = {};
      providerInputs.forEach(input => {
        const name = input.getAttribute("data-limit-provider");
        const val = input.value.trim();
        if (val) providers[name] = { dailyRequests: parseInt(val, 10) };
      });
      const body = { providers };
      if (globalVal) body.dailyRequests = parseInt(globalVal, 10);
      try {
        const res = await fetch("/admin/limits", {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "authorization": "Bearer " + token },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (res.ok) {
          msg.textContent = "Limits updated. (" + (data.providers || 0) + " providers)";
          msg.className = "muted ok";
        } else {
          msg.textContent = "Error: " + (data.error || data.message || "unknown");
          msg.className = "muted bad";
        }
      } catch (e) {
        msg.textContent = "Network error: " + e.message;
        msg.className = "muted bad";
      }
    }
  </script>
</div>
`;
}