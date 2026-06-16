import { escapeHtml } from "../../http-helpers.js";

export function renderComboModelsTab(status) {
  const combos = status.combos || [];
  const providers = status.providers || [];
  const healthCache = status.healthCache || {};

  function providerHealth(providerName) {
    const h = healthCache[providerName];
    return h ? (h.ok ? "healthy" : "error") : "unknown";
  }

  function providerKeyStatus(providerName) {
    const p = providers.find((pr) => pr.name === providerName);
    if (!p) return { status: "unknown", text: "Unknown" };
    if (p.local) return { status: "local", text: "Local" };
    if ((p.keyCount || 0) > 0) return { status: "ok", text: "Key configured" };
    return { status: "missing", text: "Missing " + (p.keyEnv || providerName.toUpperCase() + "_API_KEYS") };
  }

  if (combos.length === 0) {
    return `
<div class="rf-section">
  <div class="rf-section-title">Combo Models</div>
  <div class="rf-section-desc">Combine multiple provider/model candidates into one virtual model name.</div>
  <div class="rf-empty">
    <div class="rf-empty-icon">🔀</div>
    <div class="rf-empty-title">No combo models configured</div>
    <div class="rf-empty-desc">Create a combo model such as "smart-coding" to route across multiple providers with fallback, round-robin, or weighted round-robin strategies.</div>
  </div>
</div>`;
  }

  return `
<div class="rf-section">
  <div class="rf-section-title">Combo Models</div>
  <div class="rf-section-desc">Combo models let you expose one virtual model name to clients while RelayForge routes requests across multiple provider/model candidates using fallback, round-robin, or weighted round-robin.</div>
</div>
<div class="rf-grid">
  ${combos.map((combo) => {
    const c = combo.candidates || [];
    const limits = combo.limits || {};
    return `
  <div class="rf-card rf-combo-card">
    <div class="rf-combo-header">
      <div>
        <div class="rf-combo-name">${escapeHtml(combo.name)}</div>
        <div class="rf-combo-strategy">Strategy: ${escapeHtml(combo.strategy)} · ${c.length} candidate(s)${limits.dailyRequests ? ' · Limit: ' + limits.dailyRequests + '/day' : ''}</div>
      </div>
      <span class="rf-badge rf-badge-info">${escapeHtml(combo.strategy)}</span>
    </div>
    <div>
      ${c.map((ca, idx) => {
        const ks = providerKeyStatus(ca.provider);
        const health = providerHealth(ca.provider);
        const dotClass = health === "healthy" ? "rf-status-dot-green" : health === "error" ? "rf-status-dot-red" : "rf-status-dot-gray";
        return `
      <div class="rf-combo-step ${idx === 0 ? 'active' : ''}">
        <div class="rf-combo-step-num">${idx + 1}</div>
        <div class="rf-combo-step-content">
          <div class="rf-combo-provider">${escapeHtml(ca.provider)} <span class="rf-status-dot ${dotClass}"></span></div>
          <div class="rf-combo-model">${escapeHtml(ca.model)}${ca.weight > 1 ? ' · weight: ' + ca.weight : ''}${ca.priority ? ' · priority: ' + ca.priority : ''}</div>
          <div style="font-size:11px;margin-top:4px">
            ${ks.status === "missing" ? '<span class="rf-badge rf-badge-warning">' + escapeHtml(ks.text) + '</span>' : ks.status === "ok" ? '<span class="rf-badge rf-badge-success">Key ready</span>' : ks.status === "local" ? '<span class="rf-badge rf-badge-local">Local</span>' : '<span class="rf-badge rf-badge-neutral">Unknown</span>'}
            ${health === "healthy" ? '<span class="rf-badge rf-badge-success">Healthy</span>' : health === "error" ? '<span class="rf-badge rf-badge-danger">Error</span>' : '<span class="rf-badge rf-badge-neutral">Not tested</span>'}
          </div>
        </div>
      </div>`}).join("")}
    </div>
  </div>`}).join("")}
</div>`;
}
