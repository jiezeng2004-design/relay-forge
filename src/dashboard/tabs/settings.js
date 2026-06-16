import { escapeHtml } from "../../http-helpers.js";

export function renderSettingsTab(ctx) {
  const status = ctx.status || {};
  const relayAuth = ctx.relayAuth || status.relayAuth || {};
  const privacy = status.privacy || {};
  const tokenSource = relayAuth.tokenSource || "unset";
  const maskedToken = relayAuth.apiKeyMasked || relayAuth.apiKeyHint || "not shown";
  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Settings</h1>
    <p class="rf-page-desc">Manage local session auth, privacy posture, appearance, compatibility names, and editable non-secret config.</p>
  </div>
</div>

<div class="grid grid-2">
  <div class="panel">
    <div class="panel-title"><h3>Auth</h3><span class="pill ${relayAuth.allowNoAuth ? "bad" : "ok"}">${relayAuth.allowNoAuth ? "disabled" : "enabled"}</span></div>
    <div class="grid grid-2">
      <div class="metric"><span class="label">Token source</span><span class="value" style="font-size:18px;">${escapeHtml(tokenSource)}</span><span class="sub">RELAYFORGE_* preferred</span></div>
      <div class="metric"><span class="label">Masked token</span><span class="value" style="font-size:18px;">${escapeHtml(maskedToken)}</span><span class="sub">Full token is never rendered</span></div>
    </div>
    <div class="field-row" style="margin-top:12px;">
      <div class="field">
        <label for="admin-token">Admin token for this browser session</label>
        <input id="admin-token" type="password" autocomplete="off" placeholder="Paste RELAY_TOKEN if admin endpoints require it">
      </div>
      <button id="admin-token-save" type="button">Save session token</button>
      <button id="admin-token-clear" type="button">Clear</button>
    </div>
    <div id="admin-message" class="notice">Session token is stored only in this browser sessionStorage.</div>
  </div>

  <div class="panel">
    <div class="panel-title"><h3>Privacy</h3><span class="pill ok">redacted</span></div>
    <div class="grid grid-3">
      <div class="metric"><span class="label">logPrompts</span><span class="value" style="font-size:22px;">${privacy.logPrompts === true ? "true" : "false"}</span><span class="sub">Prompts hidden by default</span></div>
      <div class="metric"><span class="label">logHeaders</span><span class="value" style="font-size:22px;">${privacy.logHeaders === true ? "true" : "false"}</span><span class="sub">Headers hidden by default</span></div>
      <div class="metric"><span class="label">Redaction</span><span class="value" style="font-size:22px;">On</span><span class="sub">Keys, tokens, cookies masked</span></div>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-title"><h3>Appearance</h3><span class="pill">localStorage: relayforge.appearance</span></div>
  <p class="muted">This only changes the local dashboard theme. It does not modify server config or runtime state.</p>
  <div class="toolbar">
    <button type="button" data-appearance-choice="system">System</button>
    <button type="button" data-appearance-choice="light">Light</button>
    <button type="button" data-appearance-choice="dark">Dark</button>
    <select id="appearance-select" style="max-width:180px;">
      <option value="system">system</option>
      <option value="light">light</option>
      <option value="dark">dark</option>
    </select>
  </div>
</div>

<div class="grid grid-2">
  <div class="panel">
    <div class="panel-title"><h3>Compatibility</h3><span class="pill ok">backward-compatible</span></div>
    <table>
      <thead><tr><th>Recommended</th><th>Legacy supported</th></tr></thead>
      <tbody>
        <tr><td><code>RELAYFORGE_TOKEN</code></td><td><code>OPENRELAY_TOKEN</code>, <code>RELAY_TOKEN</code></td></tr>
        <tr><td><code>RELAYFORGE_PORT</code></td><td><code>OPENRELAY_PORT</code>, <code>PORT</code></td></tr>
        <tr><td><code>RELAYFORGE_CONFIG</code></td><td><code>OPENRELAY_CONFIG</code></td></tr>
        <tr><td><code>RELAYFORGE_STATE</code></td><td><code>OPENRELAY_STATE</code></td></tr>
      </tbody>
    </table>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>Config</h3><span class="pill warn">writes config.json</span></div>
    <p class="muted">Use the editor for non-secret provider, model, combo, route, health, and limit settings. Real API keys stay in env vars or encrypted Web Keys.</p>
    <div class="row-actions">
      <button class="small" id="load-config">Load</button>
      <button class="small primary" id="save-config">Save</button>
      <button class="small" id="export-config">Export</button>
      <button class="small" id="import-config">Import</button>
      <input id="import-config-file" type="file" accept="application/json,.json" hidden>
    </div>
  </div>
</div>

<div class="panel">
  <div class="panel-title"><h3>Editable Config JSON</h3></div>
  <textarea id="config-editor" spellcheck="false" aria-label="Editable config JSON"></textarea>
  <div class="notice">The editor rejects secret-like fields such as apiKey, token, secret, password, cookie, and authorization.</div>
</div>

<details class="collapsible">
  <summary>Model Aliases</summary>
  <div style="margin-top:10px;">${renderModelAliases(status)}</div>
</details>`;
}

function renderModelAliases(status) {
  const entries = Object.entries(status.modelAliases || {});
  if (!entries.length) {
    return '<p class="muted">No modelAliases configured yet. Add them in config.json if you need aliases to provider:model or combo names.</p>';
  }
  return `<div class="scroll-x"><table>
    <thead><tr><th>Alias</th><th>Target</th></tr></thead>
    <tbody>${entries.map(([alias, target]) => `<tr><td><code>${escapeHtml(alias)}</code></td><td><code>${escapeHtml(target)}</code></td></tr>`).join("")}</tbody>
  </table></div>`;
}
