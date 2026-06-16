import { escapeHtml } from "../../http-helpers.js";

export function renderClientsTab(ctx) {
  const { baseUrl, apiKeyHint, relayAuth } = ctx;
  const safeBaseUrl = baseUrl || "http://127.0.0.1:18765/v1";
  const token = apiKeyHint || "your RELAYFORGE_TOKEN";
  const model = "smart-coding";
  const clients = [
    {
      id: "cc-switch",
      name: "CC Switch",
      desc: "Use RelayForge as one OpenAI-compatible profile.",
      config: `Name: RelayForge\nBase URL: ${safeBaseUrl}\nAPI Key: ${token}\nModel: ${model}`
    },
    {
      id: "opencode",
      name: "opencode",
      desc: "Point opencode at the local OpenAI-compatible gateway.",
      config: JSON.stringify({ provider: "openai-compatible", baseURL: safeBaseUrl, apiKey: token, model }, null, 2)
    },
    {
      id: "codex",
      name: "Codex / OpenAI-compatible",
      desc: "Environment variables for Codex or any OpenAI-compatible client.",
      config: `OPENAI_BASE_URL=${safeBaseUrl}\nOPENAI_API_KEY=${token}\nOPENAI_MODEL=${model}`
    },
    {
      id: "cline",
      name: "Cline",
      desc: "Custom OpenAI-compatible provider configuration.",
      config: JSON.stringify({ name: "RelayForge", provider: "openai", baseUrl: safeBaseUrl, apiKey: token, model }, null, 2)
    },
    {
      id: "generic",
      name: "Generic OpenAI-compatible",
      desc: "For tools that support custom OpenAI endpoints.",
      config: `Base URL: ${safeBaseUrl}\nAPI Key: ${token}\nModel: ${model}\n\nRelayForge uses API-key routing only. Do not configure OAuth subscription tokens.`
    }
  ];

  return `
<div class="rf-page-head">
  <div>
    <h1 class="rf-page-title">Clients</h1>
    <p class="rf-page-desc">Use RelayForge with your favorite AI coding tools.</p>
  </div>
</div>
${relayAuth?.allowNoAuth ? '<div class="notice warn" style="margin-bottom:16px;">Auth is disabled. Set RELAYFORGE_TOKEN before using RelayForge outside a trusted local-only workflow.</div>' : ""}
<div class="notice ok" style="margin-bottom:16px;">Copy full config may include your relay token. Do not share this token.</div>
<div class="rf-grid">
  ${clients.map(renderClient).join("")}
</div>`;
}

function renderClient(client) {
  const id = `client-config-${client.id}`;
  return `<div class="rf-card rf-client-card">
    <div class="rf-client-header">
      <div>
        <div class="rf-client-name">${escapeHtml(client.name)}</div>
        <div class="rf-client-desc">${escapeHtml(client.desc)}</div>
      </div>
      <span class="rf-badge rf-badge-info">OpenAI-compatible</span>
    </div>
    <div class="rf-client-code">
      <pre id="${escapeHtml(id)}">${escapeHtml(client.config)}</pre>
      <button type="button" class="small copy-top" data-copy="#${escapeHtml(id)}">Copy full config</button>
    </div>
    <div class="row-actions" style="margin-top:10px;">
      <button type="button" class="small" data-copy="#${escapeHtml(id)}">Copy full config</button>
      <button type="button" class="small" data-copy="${escapeHtml(extractBaseUrl(client.config))}">Copy base URL</button>
      <button type="button" class="small" data-copy="smart-coding">Copy model</button>
    </div>
  </div>`;
}

function extractBaseUrl(config) {
  const match = String(config).match(/https?:\/\/127\.0\.0\.1:\d+\/v1/);
  return match ? match[0] : "http://127.0.0.1:18765/v1";
}
