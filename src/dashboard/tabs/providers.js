import { escapeHtml } from "../../http-helpers.js";
import { formatTimestamp } from "../shared.js";

export function renderProvidersTab(ctx) {
  const text = getText(ctx.locale);
  const status = ctx.status || {};
  const providers = status.providers || [];
  const webKeys = status.webKeys || [];
  const healthCache = status.healthCache || {};
  const providerHealth = status.providerHealth || {};
  const balanceCache = status.balanceCache || {};
  const localCount = providers.filter((p) => p.local).length;
  const cloudCount = providers.length - localCount;
  const needsKeyCount = providers.filter((p) => !p.local && (p.keyCount || 0) === 0 && webKeys.filter((k) => k.provider === p.name && k.enabled).length === 0).length;
  const failedCount = providers.filter((p) => healthCache[p.name] && !healthCache[p.name].ok).length;
  const readyCount = providers.length - needsKeyCount - failedCount;
  const untestedCount = providers.filter((p) => !healthCache[p.name]).length;
  const recentErrorProviders = new Set((status.recentErrors || []).map((entry) => entry && entry.provider).filter(Boolean));
  const rateLimitedCount = providers.filter((p) => providerHealth[p.name]?.rateLimited === true).length;
  const insecureRiskCount = providers.filter((p) => p.insecureHttpRisk === true).length;
  const balanceOkCount = providers.filter((p) => balanceCache[p.name]?.ok === true).length;
  const balanceErrorCount = providers.filter((p) => balanceCache[p.name] && balanceCache[p.name].ok !== true).length;
  const balanceUntestedCount = providers.filter((p) => p.balanceEndpoint && typeof p.balanceEndpoint === "object" && !balanceCache[p.name]).length;

  const filterDefs = [
    ["all", `${text.all} (${providers.length})`],
    ["ready", `${text.configured} (${readyCount})`],
    ["needs-key", `${text.missingKey} (${needsKeyCount})`],
    ["local", `${text.local} (${localCount})`],
    ["cloud", `${text.cloud} (${cloudCount})`],
    ["recent-failed", `${text.failed} (${recentErrorProviders.size + failedCount})`],
    ["healthy", `${text.healthy} (${Math.max(0, readyCount - failedCount)})`],
    ["untested", `${text.untested} (${untestedCount})`],
    ["rate-limited", `${text.rateLimited} (${rateLimitedCount})`],
    ["balance-ok", `${text.quotaOk} (${balanceOkCount})`],
    ["balance-error", `${text.quotaError} (${balanceErrorCount})`],
    ["balance-untested", `${text.quotaUntested} (${balanceUntestedCount})`],
    ["insecure-risk", `${text.risk} (${insecureRiskCount})`]
  ];
  const filterButtons = filterDefs.map(([key, label]) => `<button type="button" class="small" data-provider-filter="${escapeHtml(key)}" data-provider-filter-active="${key === "all" ? "true" : "false"}">${escapeHtml(label)}</button>`).join("");

  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">${text.title}</h1>
    <p class="rf-page-desc">${text.desc}</p>
  </div>
</div>

<div class="grid grid-4">
  <div class="metric"><span class="label">${text.configured}</span><span class="value ok">${readyCount}</span><span class="sub">${text.local} ${localCount} · ${text.cloud} ${cloudCount}</span></div>
  <div class="metric"><span class="label">${text.missingKey}</span><span class="value ${needsKeyCount > 0 ? "warn" : "ok"}">${needsKeyCount}</span><span class="sub">${text.cloudNoKey}</span></div>
  <div class="metric"><span class="label">${text.local}</span><span class="value">${localCount}</span><span class="sub">${text.noApiKey}</span></div>
  <div class="metric"><span class="label">${text.failed}</span><span class="value ${failedCount > 0 ? "bad" : "ok"}">${failedCount}</span><span class="sub">${text.failedChecks}</span></div>
</div>

<div class="panel">
  <div class="panel-title"><h3>${text.directory}</h3><div class="toolbar">${filterButtons}</div></div>
  <div class="scroll-x" id="provider-table-wrap">
    <table id="provider-table">
      <thead><tr><th>Provider</th><th>${text.format}</th><th>${text.type}</th><th>${text.keyStatus}</th><th>${text.health}</th><th>${text.latency}</th><th>${text.quota}</th><th>${text.actions}</th></tr></thead>
      <tbody id="provider-table-body">${ctx.providerRows || `<tr><td colspan="8" class="muted">${text.noProviders}</td></tr>`}</tbody>
    </table>
  </div>
</div>

${renderDryRunTools(text)}
${renderProviderEditor(ctx, text)}
${renderWebKeys(ctx, text)}
`;
}

function getText(locale) {
  if (locale === "en") {
    return {
      title: "Providers",
      desc: "Connect upstream API providers or local models. Key status, health, capabilities, quota cache, and dry-run checks stay visible without exposing secrets.",
      all: "All", configured: "Configured", missingKey: "Missing key", local: "Local", cloud: "Cloud", failed: "Failed", healthy: "Healthy", untested: "Untested", rateLimited: "Rate-limited", quotaOk: "Quota ok", quotaError: "Quota error", quotaUntested: "Quota untested", risk: "Risk",
      cloudNoKey: "Cloud providers without usable keys", noApiKey: "No API key required", failedChecks: "Failed health checks",
      directory: "Provider Directory", format: "Format", type: "Type", keyStatus: "Key status", health: "Health", latency: "Latency", quota: "Quota", actions: "Actions", noProviders: "No providers configured",
      localPlan: "Local Connector Plan", connectorAvailability: "Connector Availability", providerPreview: "Connector Provider Preview", consentManifest: "Connector Consent Manifest",
      providerHealthPreview: "Provider Config Health Preview", templateAudit: "Provider Template Audit", dryRun: "dry-run", pathOnly: "PATH-only", explicitConfirmation: "explicit confirmation", readOnly: "read-only",
      addProvider: "Add / edit Provider", webKeys: "Web Keys"
    };
  }
  return {
    title: "Provider 服务商",
    desc: "连接上游 API 服务商或本地模型。这里集中展示 Key 状态、健康状态、能力、额度缓存和只读检查，不暴露密钥。",
    all: "全部", configured: "已配置", missingKey: "缺少 Key", local: "本地", cloud: "云端", failed: "失败", healthy: "健康", untested: "未测试", rateLimited: "限流", quotaOk: "额度正常", quotaError: "额度异常", quotaUntested: "额度未测", risk: "风险",
    cloudNoKey: "云端服务商没有可用 Key", noApiKey: "无需 API Key", failedChecks: "健康检查失败", directory: "Provider 列表", format: "格式", type: "类型", keyStatus: "Key 状态", health: "健康", latency: "延迟", quota: "额度", actions: "操作", noProviders: "还没有配置 Provider",
    localPlan: "本地连接器计划", connectorAvailability: "连接器可用性", providerPreview: "连接器 Provider 预览", consentManifest: "连接器授权清单",
    providerHealthPreview: "Provider 配置健康预览", templateAudit: "Provider 模板审计", dryRun: "只读预览", pathOnly: "仅检查 PATH", explicitConfirmation: "需要显式确认", readOnly: "只读",
    addProvider: "新增 / 编辑 Provider", webKeys: "Web Key"
  };
}

function renderDryRunTools(text) {
  return `
<div class="grid grid-2">
  <div class="panel">
    <div class="panel-title"><h3>${text.localPlan}</h3><span class="pill ok">${text.dryRun}</span></div>
    <p class="muted">Plans local connector discovery without reading tokens, cookies, sessions, IDE credentials, or local paths.</p>
    <div class="row-actions">
      <button type="button" id="local-connector-plan-build" data-connector-plan-endpoint="/admin/local-connector-plan">Build connector plan</button>
      <button type="button" id="local-connector-plan-refresh" data-connector-plan-endpoint="/admin/local-connector-plan">Refresh plan</button>
    </div>
    <div id="local-connector-plan-output" class="notice">No connector plan has been generated yet.</div>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>${text.connectorAvailability}</h3><span class="pill ok">${text.pathOnly}</span></div>
    <p class="muted">Checks connector availability without reading credentials, disclosing paths, or starting processes.</p>
    <div class="row-actions">
      <button type="button" id="local-connector-availability-check" data-connector-availability-endpoint="/admin/local-connector-availability">Check availability</button>
      <button type="button" id="local-connector-availability-refresh" data-connector-availability-endpoint="/admin/local-connector-availability">Refresh availability</button>
    </div>
    <div id="local-connector-availability-output" class="notice">No availability check has been run yet.</div>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>${text.providerPreview}</h3><span class="pill ok">${text.dryRun}</span></div>
    <p class="muted">Previews provider/direct-route metadata only. It does not register routes or read credentials.</p>
    <div class="row-actions">
      <button type="button" id="local-connector-provider-preview-build" data-connector-provider-preview-endpoint="/admin/local-connector-provider-preview">Build provider preview</button>
      <button type="button" id="local-connector-provider-preview-refresh" data-connector-provider-preview-endpoint="/admin/local-connector-provider-preview">Refresh provider preview</button>
    </div>
    <div id="local-connector-provider-preview-output" class="notice">No provider preview has been generated yet.</div>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>${text.consentManifest}</h3><span class="pill warn">${text.explicitConfirmation}</span></div>
    <p class="muted">Shows consent scope metadata only. Approval/revoke stores metadata only and never reads credentials.</p>
    <div class="row-actions">
      <button type="button" id="local-connector-consent-manifest-build" data-connector-consent-manifest-endpoint="/admin/local-connector-consent-manifest">Build manifest</button>
      <button type="button" id="local-connector-consent-manifest-refresh" data-connector-consent-manifest-endpoint="/admin/local-connector-consent-manifest">Refresh manifest</button>
      <button type="button" id="local-connector-consent-ledger-refresh" data-connector-consent-ledger-endpoint="/admin/local-connector-consent-ledger">View ledger</button>
      <button type="button" id="local-connector-consent-approve" class="danger" data-connector-consent-endpoint="/admin/local-connector-consent">Record consent</button>
      <button type="button" id="local-connector-consent-revoke" data-connector-consent-endpoint="/admin/local-connector-consent">Revoke consent</button>
    </div>
    <div id="local-connector-consent-manifest-output" class="notice">No consent manifest has been generated yet.</div>
    <div id="local-connector-consent-ledger-output" class="notice">No consent ledger has been loaded yet.</div>
  </div>
</div>

<div class="grid grid-2">
  <div class="panel">
    <div class="panel-title"><h3>${text.providerHealthPreview}</h3><span class="pill ok">${text.readOnly}</span></div>
    <p class="muted">Dry-run only. Does not call upstream APIs, consume quota, or write runtime state.</p>
    <div class="row-actions">
      <button type="button" id="provider-test-preview-all">Check all providers</button>
      <button type="button" id="provider-test-preview-local">Check local providers</button>
    </div>
    <div id="provider-test-preview-output" class="notice">No provider health preview has been run yet.</div>
  </div>
  <div class="panel">
    <div class="panel-title"><h3>${text.templateAudit}</h3><span class="pill ok">${text.dryRun}</span></div>
    <p class="muted">Audits template coverage and import plans without writing config, storing keys, or making network requests.</p>
    <div class="row-actions">
      <button type="button" id="provider-template-parity-check" data-provider-template-parity-endpoint="/admin/provider-template-parity">Check template coverage</button>
      <button type="button" id="provider-template-parity-refresh" data-provider-template-parity-endpoint="/admin/provider-template-parity">Refresh audit</button>
      <button type="button" id="provider-template-import-plan" data-provider-template-import-plan-endpoint="/admin/provider-template-import-plan">Generate import plan</button>
      <button type="button" id="provider-template-import-apply" class="danger" data-provider-template-import-endpoint="/admin/provider-template-import">Confirm template import</button>
    </div>
    <div id="provider-template-parity-output" class="notice">No template audit has been run yet.</div>
    <div id="provider-template-import-output" class="notice">No template import plan has been generated yet.</div>
  </div>
</div>`;
}

function renderProviderEditor(ctx, text) {
  return `
<details class="collapsible" id="provider-form-card">
  <summary>${text.addProvider}</summary>
  <p class="muted" style="margin-top:8px;">Real API keys are not stored here. Use encrypted Web Keys or environment variables. Base URLs must be HTTPS or loopback HTTP unless allowInsecureHttp is explicitly enabled.</p>
  <div class="notice ok" id="provider-form-key-status" data-provider-form-key-status><strong>Web Key preservation:</strong> saving provider metadata does not delete existing encrypted Web Keys.</div>
  <div class="form-grid">
    <div class="field"><label for="provider-template">Template</label><select id="provider-template"><option value="">Choose a template</option>${ctx.providerTemplateOptions || ""}</select></div>
    <div class="field"><label for="provider-name">Provider name</label><input id="provider-name" type="text" placeholder="deepseek"></div>
    <div class="field"><label for="provider-display-name">Display name</label><input id="provider-display-name" type="text" placeholder="DeepSeek"></div>
    <div class="field"><label for="provider-base-url">Base URL</label><input id="provider-base-url" type="text" placeholder="https://api.example.com/v1"></div>
    <div class="field"><label for="provider-api-format">API format</label><select id="provider-api-format"><option value="openai">openai</option><option value="anthropic">anthropic</option></select></div>
    <div class="field"><label><input id="provider-allow-insecure-http" type="checkbox"> allowInsecureHttp</label><div class="help">Only for trusted loopback or internal endpoints.</div></div>
  </div>
  <details class="advanced-block"><summary>Advanced: environment key variable name</summary><div class="field"><label for="provider-key-env">Key env var name</label><input id="provider-key-env" type="text" placeholder="DEEPSEEK_API_KEYS"></div></details>
  <div class="form-grid-2">
    <div class="field"><label for="provider-models">Models</label><textarea id="provider-models" class="compact-area" spellcheck="false"></textarea></div>
    <div class="field"><label for="provider-extra-headers">Extra headers (JSON)</label><textarea id="provider-extra-headers" class="compact-area" spellcheck="false"></textarea></div>
    <div class="field"><label for="provider-balance-endpoint">Balance endpoint (JSON)</label><textarea id="provider-balance-endpoint" class="compact-area" spellcheck="false"></textarea></div>
  </div>
  <div class="row-actions" style="margin-top:12px;"><button id="provider-create" type="button" class="primary">Add provider</button><button id="provider-update" type="button">Save edit</button><button id="provider-clear" type="button">Clear form</button></div>
  <div id="provider-message" class="notice">Choose a row to edit or start from a template.</div>
  ${renderDiscoverModels(ctx)}
  ${renderInlineKey(ctx)}
</details>`;
}

function renderDiscoverModels(ctx) {
  const providerOptions = (ctx.status.providers || []).filter((p) => p.apiFormat === "openai").map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)}</option>`).join("");
  return `
<details class="advanced-block" id="discover-models-card">
  <summary>Discover available models</summary>
  <p class="muted" style="margin-top:8px;">Discovery does not write config, does not log keys, and does not show real API keys in responses.</p>
  <div class="form-grid-2">
    <div class="field"><label>Mode A: Base URL + temporary key</label><input id="discover-base-url" type="text" placeholder="https://api.example.com/v1"><input id="discover-api-key" type="password" autocomplete="off" placeholder="temporary key" data-discover-api-key style="margin-top:6px;"><div class="row-actions" style="margin-top:6px;"><button id="discover-models-button" type="button" data-discover-models-button>Discover (A)</button><button id="discover-models-prefill" type="button" data-discover-models-prefill>Prefill from form</button></div></div>
    <div class="field"><label>Mode B: configured provider</label><select id="discover-models-provider-select" data-discover-models-provider-select>${providerOptions}</select><div class="row-actions" style="margin-top:6px;"><button id="discover-models-from-provider" type="button" data-discover-models-from-provider>Discover (B)</button></div></div>
  </div>
  <div id="discover-models-output" data-discover-models-output class="notice">No discovery has been run yet.</div>
</details>`;
}

function renderInlineKey(ctx) {
  return `
<div class="inline-key-panel">
  <h3>Add encrypted Web Key for the selected provider</h3>
  <p class="muted">Keys are encrypted into the local key store and are not written to config.json or release artifacts.</p>
  <div class="field-row">
    <div class="field"><label for="provider-inline-key-name">Provider</label><select id="provider-inline-key-name">${ctx.providerOptions || ""}</select></div>
    <div class="field"><label for="provider-inline-key-value">API Key</label><input id="provider-inline-key-value" type="password" autocomplete="off" placeholder="sk-..."></div>
    <div class="field"><label for="provider-inline-key-label">Label</label><input id="provider-inline-key-label" type="text" maxlength="80" placeholder="primary key"></div>
  </div>
  <div class="row-actions" style="margin-top:10px;"><button id="provider-inline-key-add" type="button" class="primary">Save encrypted key</button><button id="provider-inline-key-test" type="button">Save and test</button></div>
  <div id="provider-inline-key-message" class="notice">The key will not be displayed in plaintext.</div>
</div>`;
}

function renderWebKeys(ctx, text) {
  const webKeys = ctx.status.webKeys || [];
  return `
<div class="panel">
  <div class="panel-title"><h3>${text.webKeys}</h3><span class="muted">${webKeys.length} key(s)</span></div>
  <div class="scroll-x"><table><thead><tr><th>ID</th><th>Provider</th><th>Masked key</th><th>Label</th><th>Status</th><th>Usage / test</th><th>Actions</th></tr></thead><tbody>${webKeys.length ? webKeys.map(renderWebKeyRow).join("") : '<tr><td colspan="7" class="muted">No Web Keys added yet. Add keys here or use environment variables.</td></tr>'}</tbody></table></div>
  <details class="collapsible" style="margin-top:10px;"><summary>Add a Web Key from the API key form</summary><p class="muted" style="margin-top:8px;">Real API keys are encrypted locally and never exported.</p><div class="field-row"><div class="field"><label for="add-key-provider">Provider</label><select id="add-key-provider">${ctx.providerOptions || ""}</select></div><div class="field"><label for="add-key-value">API Key</label><input id="add-key-value" type="password" autocomplete="off" placeholder="sk-..."></div><div class="field"><label for="add-key-label">Label</label><input id="add-key-label" type="text" maxlength="80" placeholder="primary key"></div></div><div class="row-actions" style="margin-top:10px;"><button id="add-key-submit" type="button" class="primary">Add key</button></div><div id="add-key-message" class="notice">No Web Key added yet.</div></details>
</div>`;
}

function renderWebKeyRow(key) {
  return `<tr data-key-row="${escapeHtml(key.id)}"><td><code>${escapeHtml(key.id)}</code></td><td>${escapeHtml(key.provider)}</td><td><code>${escapeHtml(key.masked)}</code><div class="muted mono">hash: ${escapeHtml(key.hash || "")}</div></td><td>${escapeHtml(key.label || "-")}</td><td>${key.enabled ? '<span class="pill ok">enabled</span>' : '<span class="pill warn">disabled</span>'}</td><td><div class="muted">${escapeHtml(formatTimestamp(key.lastUsedAt) || "-")}</div>${key.lastTestAt ? `<div class="muted">last test: ${escapeHtml(formatTimestamp(key.lastTestAt))}</div>` : ""}</td><td><div class="row-actions"><button type="button" class="small" data-test-key="${escapeHtml(key.id)}">Test</button><button type="button" class="small" data-toggle-key="${escapeHtml(key.id)}" data-target-enabled="${key.enabled ? "false" : "true"}">${key.enabled ? "Disable" : "Enable"}</button><button type="button" class="small danger" data-delete-key="${escapeHtml(key.id)}" data-label="${escapeHtml(key.label || key.masked)}">Delete</button></div></td></tr>`;
}
