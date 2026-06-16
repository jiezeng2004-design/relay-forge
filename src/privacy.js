const SENSITIVE_HEADERS = new Set([
  "authorization",
  "x-api-key",
  "x-relay-token",
  "cookie",
  "set-cookie",
  "x-ratelimit-key"
]);

const KEY_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /ghp_[a-zA-Z0-9]{36,}/g,
  /gho_[a-zA-Z0-9]{36,}/g,
  /ghu_[a-zA-Z0-9]{36,}/g,
  /xoxb-[a-zA-Z0-9-]+/g,
  /xoxp-[a-zA-Z0-9-]+/g,
  /xapp-[a-zA-Z0-9-]+/g,
  /key-[a-zA-Z0-9]{20,}/g,
  /api[_-]?key["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/gi,
  /Bearer\s+[a-zA-Z0-9_\-\.]{8,}/g
];

const SENSITIVE_FIELDS = new Set([
  "api_key", "apikey", "api-key",
  "apiKey", "secret", "secret_key",
  "secretKey", "password", "passwd",
  "token", "access_token", "refresh_token",
  "authorization", "x-api-key"
]);

export function sanitizeHeader(name, value) {
  if (!value) return value;
  const lower = String(name).toLowerCase();
  if (SENSITIVE_HEADERS.has(lower)) {
    const val = String(value);
    if (val.length <= 8) return "***";
    return val.slice(0, 4) + "****" + val.slice(-4);
  }
  return value;
}

export function sanitizeKey(key) {
  if (!key || typeof key !== "string") return key;
  let result = key;
  for (const pattern of KEY_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length <= 8) return "***";
      return match.slice(0, 4) + "****" + match.slice(-4);
    });
  }
  return result;
}

export function sanitizeLogMessage(msg) {
  if (!msg || typeof msg !== "string") return msg;
  let result = msg;
  for (const pattern of KEY_PATTERNS) {
    result = result.replace(pattern, (match) => {
      if (match.length <= 8) return "***";
      return match.slice(0, 4) + "****" + match.slice(-4);
    });
  }
  return result;
}

export function sanitizeRequestBody(body) {
  if (!body || typeof body !== "object") return body;
  const sanitized = Array.isArray(body) ? [] : {};
  for (const [key, value] of Object.entries(body)) {
    if (SENSITIVE_FIELDS.has(key)) {
      sanitized[key] = sanitizeKey(String(value));
    } else if (key === "messages" && Array.isArray(value)) {
      sanitized[key] = value.map((msg) => {
        if (msg && typeof msg === "object" && msg.content && typeof msg.content === "string") {
          return { ...msg, content: `[redacted: ${msg.content.length} chars]` };
        }
        if (msg && typeof msg === "object" && Array.isArray(msg.content)) {
          return { ...msg, content: `[redacted: ${msg.content.length} parts]` };
        }
        return msg;
      });
    } else if (key === "prompt" && typeof value === "string") {
      sanitized[key] = `[redacted: ${value.length} chars]`;
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeRequestBody(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export function buildRequestMeta(req, body, provider, model, startedAt, status, errorCategory) {
  const elapsedMs = Date.now() - startedAt;
  const promptLength = estimatePromptLength(body);
  return {
    method: req.method,
    path: req.url,
    model: model || body?.model || "unknown",
    provider: provider || "unknown",
    elapsedMs,
    status: status || 0,
    errorCategory: errorCategory || null,
    promptLength,
    timestamp: new Date().toISOString()
  };
}

function estimatePromptLength(body) {
  if (!body || typeof body !== "object") return 0;
  if (body.messages && Array.isArray(body.messages)) {
    return body.messages.reduce((sum, msg) => {
      if (typeof msg.content === "string") return sum + msg.content.length;
      if (Array.isArray(msg.content)) return sum + msg.content.length * 100;
      return sum + 100;
    }, 0);
  }
  if (body.prompt && typeof body.prompt === "string") {
    return body.prompt.length;
  }
  if (body.input && typeof body.input === "string") {
    return body.input.length;
  }
  return 0;
}

export function sanitizeHeadersForLog(headers) {
  if (!headers || typeof headers !== "object") return {};
  const out = {};
  for (const [key, value] of Object.entries(headers)) {
    out[key] = sanitizeHeader(key, value);
  }
  return out;
}

export function shouldLogPrompt(config) {
  return config?.privacy?.logPrompts === true;
}
