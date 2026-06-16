import { escapeHtml } from "../../http-helpers.js";

export function renderClientsTab(ctx) {
  const { baseUrl, apiKeyHint, relayAuth } = ctx;
  const token = apiKeyHint || "RELAYFORGE_TOKEN";
  const model = "smart-coding";

  const clients = [
    {
      icon: "🔄",
      name: "CC Switch",
      desc: "OpenAI-compatible AI coding tool switcher",
      config: `Name: RelayForge\nBase URL: ${baseUrl || "http://127.0.0.1:18765/v1"}\nAPI Key: ${token}\nModel: ${model}`,
      codeLang: "text"
    },
    {
      icon: "⚡",
      name: "opencode",
      desc: "OpenAI-compatible coding agent by anomalyco",
      config: JSON.stringify({
        provider: "openai-compatible",
        baseUrl: baseUrl || "http://127.0.0.1:18765/v1",
        apiKey: token,
        model: model
      }, null, 2),
      codeLang: "json"
    },
    {
      icon: "🤖",
      name: "Codex / OpenAI-compatible client",
      desc: "Set environment variables for any OpenAI-compatible client",
      config: `OPENAI_BASE_URL=${baseUrl || "http://127.0.0.1:18765/v1"}\nOPENAI_API_KEY=${token}\nOPENAI_MODEL=${model}`,
      codeLang: "bash"
    },
    {
      icon: "📝",
      name: "Cline",
      desc: "AI coding assistant in VS Code",
      config: JSON.stringify({
        name: "RelayForge",
        provider: "openai",
        baseUrl: (baseUrl || "http://127.0.0.1:18765/v1") + "/chat/completions",
        apiKey: token,
        model: model
      }, null, 2),
      codeLang: "json"
    },
    {
      icon: "🔗",
      name: "Generic OpenAI-compatible",
      desc: "Any tool that supports custom OpenAI endpoint",
      config: `Base URL: ${baseUrl || "http://127.0.0.1:18765/v1"}\nAPI Key: ${token}\nModel: ${model}\n\nRelayForge does not read OAuth tokens. Use API-key based configuration.`,
      codeLang: "text"
    }
  ];

  return `
<div class="rf-section">
  <div class="rf-section-title">Clients</div>
  <div class="rf-section-desc">Quick-start configs for popular AI coding tools. Replace <code>${escapeHtml(token)}</code> with your actual RELAYFORGE_TOKEN.</div>
  ${relayAuth?.allowNoAuth ? '<div class="rf-card rf-card-warning" style="margin-bottom:16px;padding:12px 16px;font-size:13px;">⚠️ Auth is disabled. Set RELAYFORGE_TOKEN in .env for security.</div>' : ''}
</div>
<div class="rf-grid">
  ${clients.map((c) => `
  <div class="rf-card rf-client-card">
    <div class="rf-client-icon">${c.icon}</div>
    <div class="rf-client-name">${escapeHtml(c.name)}</div>
    <div class="rf-client-desc">${escapeHtml(c.desc)}</div>
    <div class="rf-client-code">
      <pre id="client-config-${c.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}">${escapeHtml(c.config)}</pre>
      <button class="rf-btn rf-btn-sm rf-btn-secondary" style="position:absolute;top:8px;right:8px" data-copy="#client-config-${c.name.toLowerCase().replace(/[^a-z0-9]/g, "-")}">Copy</button>
    </div>
  </div>`).join("")}
</div>`;
}
