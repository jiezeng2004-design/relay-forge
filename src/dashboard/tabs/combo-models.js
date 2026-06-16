import { escapeHtml } from "../../http-helpers.js";

export function renderComboModelsTab(status) {
  const combos = status.combos || [];
  const providers = status.providers || [];
  const healthCache = status.healthCache || {};

  if (combos.length === 0) {
    return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Combo Models</h1>
    <p class="rf-page-desc">Expose one virtual model name while RelayForge routes across multiple upstream candidates.</p>
  </div>
</div>
<div class="rf-card">
  <div class="rf-route-path">
    <div class="rf-route-node"><strong>Client uses</strong><br><code>smart-coding</code></div>
    <span class="rf-route-arrow">-></span>
    <div class="rf-route-node"><strong>RelayForge routes to</strong><br>deepseek -> groq -> ollama</div>
  </div>
</div>
<div class="rf-empty" style="margin-top:16px;">
  <div class="rf-empty-title">No combo models configured</div>
  <div class="rf-empty-desc">Create a combo such as smart-coding to show fallback, round-robin, or weighted routing here.</div>
</div>`;
  }

  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Combo Models</h1>
    <p class="rf-page-desc">Expose one virtual model name while RelayForge routes across multiple upstream candidates.</p>
  </div>
</div>
<div class="rf-card" style="margin-bottom:16px;">
  <div class="rf-route-path">
    <div class="rf-route-node"><strong>Client uses</strong><br><code>${escapeHtml(combos[0]?.name || "smart-coding")}</code></div>
    <span class="rf-route-arrow">-></span>
    <div class="rf-route-node"><strong>RelayForge routes to</strong><br>${escapeHtml((combos[0]?.candidates || []).map((c) => c.provider).join(" -> ") || "provider candidates")}</div>
  </div>
</div>
<div class="rf-grid">
  ${combos.map((combo) => renderComboCard(combo, providers, healthCache)).join("")}
</div>`;
}

function renderComboCard(combo, providers, healthCache) {
  const candidates = combo.candidates || [];
  const unavailable = candidates.filter((c) => providerKeyStatus(c.provider, providers).status === "missing").length;
  const available = unavailable === 0 && candidates.length > 0;
  return `<div class="rf-card rf-combo-card">
    <div class="rf-combo-header">
      <div>
        <div class="rf-combo-name">${escapeHtml(combo.name)}</div>
        <div class="rf-combo-strategy">Strategy: ${escapeHtml(combo.strategy || "fallback")} · ${candidates.length} candidate(s)</div>
      </div>
      <div class="stack">
        <span class="rf-badge rf-badge-info">${escapeHtml(combo.strategy || "fallback")}</span>
        <span class="rf-badge ${available ? "rf-badge-success" : "rf-badge-warning"}">${available ? "available" : "needs attention"}</span>
      </div>
    </div>
    <div class="rf-client-code">
      <div class="muted" style="font-size:12px;margin-bottom:6px;">Model name to use in clients</div>
      <pre id="combo-model-${escapeHtml(slug(combo.name))}">${escapeHtml(combo.name)}</pre>
      <button type="button" class="small copy-top" data-copy="#combo-model-${escapeHtml(slug(combo.name))}">Copy</button>
    </div>
    <div class="rf-route-path">
      ${candidates.map((c, index) => `${index > 0 ? '<span class="rf-route-arrow">fallback</span>' : ""}<div class="rf-route-node"><strong>${escapeHtml(c.provider)}</strong><br><code>${escapeHtml(c.model || "?")}</code></div>`).join("")}
    </div>
    <div style="margin-top:14px;">
      ${candidates.map((candidate, index) => renderCandidate(candidate, index, providers, healthCache)).join("")}
    </div>
    ${renderHints(candidates, providers, healthCache)}
  </div>`;
}

function renderCandidate(candidate, index, providers, healthCache) {
  const key = providerKeyStatus(candidate.provider, providers);
  const health = providerHealth(candidate.provider, healthCache);
  return `<div class="rf-combo-step ${index === 0 ? "active" : ""}">
    <div class="rf-combo-step-num">${index + 1}</div>
    <div class="rf-combo-step-content">
      <div class="rf-combo-provider">${escapeHtml(candidate.provider)} <span class="rf-status-dot ${health.dot}"></span></div>
      <div class="rf-combo-model">${escapeHtml(candidate.model || "?")}</div>
      <div class="stack" style="margin-top:6px;">
        <span class="rf-badge ${key.className}">${escapeHtml(key.text)}</span>
        <span class="rf-badge ${health.className}">${escapeHtml(health.text)}</span>
        <span class="rf-badge rf-badge-neutral">priority ${escapeHtml(String(candidate.priority ?? 0))}</span>
        <span class="rf-badge rf-badge-neutral">weight ${escapeHtml(String(candidate.weight ?? 1))}</span>
        <span class="rf-badge ${candidate.enabled === false ? "rf-badge-warning" : "rf-badge-success"}">${candidate.enabled === false ? "disabled" : "enabled"}</span>
      </div>
    </div>
  </div>`;
}

function providerKeyStatus(providerName, providers) {
  const provider = providers.find((p) => p.name === providerName);
  if (!provider) return { status: "unknown", text: "Unknown provider", className: "rf-badge-neutral" };
  if (provider.local) return { status: "local", text: "Local provider", className: "rf-badge-local" };
  if ((provider.keyCount || 0) > 0) return { status: "ok", text: "Key ready", className: "rf-badge-success" };
  return { status: "missing", text: "Missing " + (provider.keyEnv || providerName.toUpperCase() + "_API_KEYS"), className: "rf-badge-warning" };
}

function providerHealth(providerName, healthCache) {
  const health = healthCache[providerName];
  if (!health) return { text: "Not tested", className: "rf-badge-neutral", dot: "rf-status-dot-gray" };
  if (health.ok) return { text: "Healthy", className: "rf-badge-success", dot: "rf-status-dot-green" };
  return { text: "Failed", className: "rf-badge-danger", dot: "rf-status-dot-red" };
}

function renderHints(candidates, providers, healthCache) {
  const hints = [];
  for (const candidate of candidates) {
    const key = providerKeyStatus(candidate.provider, providers);
    const health = providerHealth(candidate.provider, healthCache);
    if (key.status === "missing") hints.push(key.text);
    if (candidate.provider === "ollama" && health.text === "Failed") hints.push("Ollama may not be running on 127.0.0.1:11434.");
  }
  if (!hints.length) return "";
  return `<div class="notice warn">${hints.map(escapeHtml).join("<br>")}</div>`;
}

function slug(value) {
  return String(value || "combo").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "combo";
}
