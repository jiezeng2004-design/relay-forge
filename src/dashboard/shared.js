// Shared helper functions used by the dashboard tab renderers.
// Pure: no DOM, no I/O, no shared state. Each function is a small
// pure HTML string builder or utility.

import { escapeHtml } from "../http-helpers.js";

// JSON-injection for inline <script> blocks. Replaces characters that
// would break out of a <script> tag in the rendered HTML.
export function scriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => ({
    "<": "\\u003c",
    ">": "\\u003e",
    "&": "\\u0026",
    "\u2028": "\\u2028",
    "\u2029": "\\u2029"
  }[char]));
}

// Compact ISO timestamp for log / cache cells.
export function formatTimestamp(value) {
  if (!value) return "";
  try {
    return new Date(value).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return "";
  }
}

// Pick the top entry from a {name: count} object as a label like
// "coding-local (12)".
export function topUsageLabel(counts) {
  const top = Object.entries(counts || {}).sort((a, b) => b[1] - a[1])[0];
  return top ? `${top[0]} (${top[1]})` : "";
}

// Soft-limit badge: "12 / 100" with color based on used/limit ratio.
// Returns a muted span when no limit is configured.
export function renderLimit(name, limit, kind, used) {
  if (!limit) return '<span class="muted">本地 relay 不主动限制调用次数（上游限制仍然存在）</span>';
  const usedValue = used || 0;
  const className = usedValue >= limit ? "bad" : usedValue / limit > 0.8 ? "warn" : "ok";
  return `<span class="${className}">${usedValue} / ${limit}</span>`;
}

// Build the `<option>` list for the profile editor's "defaultModel"
// datalist. Includes route names, `provider:model` references, and
// bare model names. De-duplicates via a `seen` set.
export function buildProfileDefaultOptions(status) {
  const seen = new Set();
  const options = [];
  const add = (value, label) => {
    if (!value || seen.has(value)) return;
    seen.add(value);
    options.push({ value, label: label || value });
  };
  for (const route of status.routes || []) {
    add(route.name, `Route: ${route.name}`);
    for (const candidate of route.candidates || []) {
      add(`${candidate.provider}:${candidate.model}`, `${candidate.provider}:${candidate.model}`);
      add(candidate.model, candidate.model);
    }
  }
  for (const provider of status.providers || []) {
    for (const model of provider.models || []) {
      add(`${provider.name}:${model}`, `${provider.name}:${model}`);
      add(model, model);
    }
  }
  return options;
}

// Command-box HTML (label + copy button + pre block). Used by the
// tool cards panel.
export function renderCommand(label, command) {
  return `<div class="command-box">
    <div class="head"><strong>${escapeHtml(label)}</strong><button class="small" data-copy="${escapeHtml(command)}">复制</button></div>
    <pre>${escapeHtml(command)}</pre>
  </div>`;
}

// PowerShell verification one-liner: hit /v1/models + /v1/chat/completions
// with the recommended model. Used by the tool config generator.
// 0.5.3: the `token` arg carries the actual RELAY_TOKEN value
// (or "local" when no-auth is on) so the verification script
// works out of the box without the operator having to read the
// token from disk and edit the command.
export function buildToolVerifyCommand(model, baseUrl, token = "local") {
  const safeModel = String(model || "auto").replace(/"/g, '\\"');
  const base = String(baseUrl || "http://127.0.0.1:18765/v1");
  const safeToken = String(token || "local").replace(/"/g, '\\"');
  return `Invoke-RestMethod -Uri "${base}/models" -Headers @{ Authorization = "Bearer ${safeToken}" } | Select-Object -ExpandProperty data | Select-Object -First 3 -ExpandProperty id
$body = @{ model = "${safeModel}"; messages = @(@{ role = "user"; content = "reply with the single word: pong" }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "${base}/chat/completions" -Headers @{ Authorization = "Bearer ${safeToken}" } -Method Post -ContentType "application/json" -Body $body`;
}
