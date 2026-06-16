// Pure helpers for the balance lookup path. Kept free of I/O so the
// redirect / 3xx / non-2xx behavior can be unit-tested without a
// network mock. The I/O wrapper in server.js still owns the actual
// fetch and timeout.

export function interpretBalanceResponse({ response, responseText, fieldMap, providerName, endpointUrl, elapsedMs }) {
  const result = {
    ok: false,
    provider: providerName,
    endpoint: endpointUrl,
    status: response.status,
    elapsedMs,
    summary: null
  };
  // With `redirect: "manual"` Node fetch should surface 3xx as
  // response.type === "opaqueredirect" per WHATWG, but in practice
  // Node 18+ also returns a real 3xx response object with status in
  // [300, 400) and ok=false. We treat both shapes as a refused
  // redirect so the bearer token never lands on the redirect target.
  // The actual Location header is intentionally NOT exposed in the
  // cache result because that URL may carry session or vendor-specific
  // state.
  if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
    result.status = 302;
    result.error = "balance_endpoint_redirect_refused";
    result.message = "balanceEndpoint returned a redirect; this relay does not follow 3xx for balance lookups to avoid leaking the bearer token to the redirect target.";
    return result;
  }
  if (!response.ok) {
    result.body = parseMaybeJsonBody(responseText);
    return result;
  }
  result.ok = true;
  result.summary = extractBalanceSummary(responseText, fieldMap);
  return result;
}

export function extractBalanceSummary(text, fieldMap) {
  const parsed = parseMaybeJsonBody(text);
  if (typeof parsed === "string" || parsed == null) return null;
  const map = fieldMap && typeof fieldMap === "object" ? fieldMap : {};
  const pick = (key) => {
    const value = getByPath(parsed, key);
    if (typeof value === "string" || typeof value === "number") return value;
    return undefined;
  };
  const remaining = map.remaining != null ? pick(map.remaining) : pick("remaining") ?? pick("remaining_credits") ?? pick("balance");
  const limit = map.limit != null ? pick(map.limit) : pick("limit") ?? pick("quota") ?? pick("total");
  const used = map.used != null ? pick(map.used) : pick("used") ?? pick("consumed");
  const currency = pick(map.currency || "currency");
  const reset = pick(map.reset || "reset_at") || pick("resets_at");
  if (remaining == null && limit == null && used == null) {
    return JSON.stringify(parsed).slice(0, 240);
  }
  const parts = [];
  if (remaining != null) parts.push(`remaining=${remaining}`);
  if (used != null) parts.push(`used=${used}`);
  if (limit != null) parts.push(`limit=${limit}`);
  if (currency != null) parts.push(`currency=${currency}`);
  if (reset != null) parts.push(`reset=${reset}`);
  return parts.join(", ");
}

export function getByPath(obj, path) {
  if (!obj || path == null || path === "") return undefined;
  const parts = [];
  const re = /([^.[\]]+)|\[(\d+)\]/g;
  const text = String(path);
  let match;
  while ((match = re.exec(text)) !== null) {
    parts.push(match[1] !== undefined ? match[1] : Number(match[2]));
  }
  if (parts.length === 0) return undefined;
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function parseMaybeJsonBody(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return String(text).slice(0, 2000);
  }
}

// Hard guard rail for balanceEndpoint: the relay only ever calls
// https:// (or loopback http:// for the local Ollama case) GETs against
// a URL the operator wrote into config.json. We still validate here so
// a typo or stale value cannot be turned into an SSRF / arbitrary
// outbound POST. Non-https hosts other than loopback are refused; POST /
// PUT / PATCH / DELETE are refused.
export function guardBalanceEndpoint(endpoint, provider) {
  let url;
  try {
    url = new URL(endpoint.url);
  } catch {
    return { ok: false, error: "balance_endpoint_url_invalid", message: "balanceEndpoint.url is not a valid URL." };
  }
  const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "::1" || url.hostname === "[::1]" || url.hostname === "localhost";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    return {
      ok: false,
      error: "balance_endpoint_https_required",
      message: "balanceEndpoint.url must use https (loopback http is allowed only for local Ollama)."
    };
  }
  // Strip any header that could leak the bearer token; only allow a
  // narrow allow-list of safe custom headers (accept, accept-language,
  // x-custom-*).
  const allowedHeaderNames = new Set(["accept", "accept-language", "user-agent"]);
  const allowedHeaders = {};
  if (endpoint.headers && typeof endpoint.headers === "object") {
    for (const [name, value] of Object.entries(endpoint.headers)) {
      const lowered = String(name).toLowerCase();
      if (allowedHeaderNames.has(lowered) || lowered.startsWith("x-custom-")) {
        if (typeof value === "string" || typeof value === "number") {
          allowedHeaders[lowered] = String(value);
        }
      }
    }
  }
  const method = String(endpoint.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return {
      ok: false,
      error: "balance_endpoint_method_forbidden",
      message: "balanceEndpoint.method must be GET or HEAD. Anything else is refused to avoid mutating state on the upstream."
    };
  }
  return {
    ok: true,
    url: endpoint.url,
    method,
    allowedHeaders,
    requiresKey: endpoint.useKey !== false
  };
}
