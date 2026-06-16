// Server-authoritative error categorization. Shared between server.js
// (where the category is generated at error time) and dashboard.js
// (where the category is rendered in the UI and a fallback heuristic
// is used if an old entry without a category is loaded from
// runtime-state.json).
//
// Goals:
//   - Categorization is deterministic; no prompt plaintext, no full
//     API Key, no upstream body bytes in the stored message.
//   - Categories stay stable across releases; new categories may be
//     added but old ones should not be removed without a migration.
//   - Helpers are pure (no I/O) so they can be unit-tested in
//     isolation from a running relay.

export const ERROR_CATEGORIES = Object.freeze([
  "stream_idle_timeout",
  "stream_read_failed",
  "stream_parse_failed",
  "upstream_429",
  "upstream_5xx",
  "upstream_timeout",
  "upstream_auth",
  "upstream_request_failed",
  "config_error",
  "local_limit",
  "other"
]);

const CATEGORY_SET = new Set(ERROR_CATEGORIES);

export function isValidCategory(value) {
  return typeof value === "string" && CATEGORY_SET.has(value);
}

// Best-effort fallback for old log entries that predate the category
// field, or for ad-hoc call sites that did not pass a category.
export function inferErrorCategory(scope, error) {
  const name = String((error && error.name) || "");
  const msg = String((error && error.message) || error || "");
  const code = (error && error.streamFailureCode) || "";
  if (scope === "stream:idle" || msg.includes("stream idle timeout") || code === "stream_idle_timeout") {
    return "stream_idle_timeout";
  }
  if (code === "stream_parse_failed" || msg.includes("stream_parse_failed") || msg.includes("parse failed")) {
    return "stream_parse_failed";
  }
  if (code === "stream_read_failed" || msg.includes("stream_read_failed") || msg.includes("read failed") || msg.includes("ECONNRESET")) {
    return "stream_read_failed";
  }
  if (/status[^0-9]*401|status[^0-9]*403|unauthorized|forbidden|invalid api key|invalid_api_key/i.test(msg)) {
    return "upstream_auth";
  }
  if (/status[^0-9]*429|rate[_ -]?limit/i.test(msg)) {
    return "upstream_429";
  }
  if (/status[^0-9]*5\d\d/i.test(msg) || msg.includes("upstream_5xx")) {
    return "upstream_5xx";
  }
  if (name === "AbortError" || (msg.includes("timeout") && !msg.includes("stream idle"))) {
    return "upstream_timeout";
  }
  if (
    msg.includes("upstream_request_failed") ||
    msg.includes("upstream error") ||
    msg.includes("fetch failed") ||
    msg.includes("econnreset")
  ) {
    return "upstream_request_failed";
  }
  if (typeof scope === "string" && (scope.startsWith("config:") || scope.startsWith("profile:save"))) {
    return "config_error";
  }
  return "other";
}

// Scrub obviously sensitive substrings and bound the length. The
// error.message passed in is normally a fetch/parse error description
// (e.g. "fetch failed", "upstream error 500") and not user input, but
// we sanitize defensively in case an upstream embeds a credential or
// prompt fragment in its error body.
export function sanitizeErrorMessage(message) {
  const text = String(message == null ? "" : message);
  return text
    // More specific prefixes first so they aren't consumed by the
    // shorter `sk-` / `xai-` patterns below.
    .replace(/sk-ant-[A-Za-z0-9._-]{8,}/g, "sk-ant-***")
    .replace(/sk-or-[A-Za-z0-9._:/-]{8,}/g, "sk-or-***")
    .replace(/sk-[A-Za-z0-9._-]{8,}/g, "sk-***")
    .replace(/AIza[A-Za-z0-9._-]{8,}/g, "AIza***")
    .replace(/gsk_[A-Za-z0-9._-]{8,}/g, "gsk_***")
    .replace(/pplx-[A-Za-z0-9._-]{8,}/g, "pplx-***")
    .replace(/xai-[A-Za-z0-9._-]{8,}/g, "xai-***")
    .replace(/Bearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer ***")
    .replace(/authorization:\s*Bearer\s+\S+/gi, "authorization: Bearer ***")
    .replace(/cookie:\s*\S+/gi, "cookie: ***")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

// Heuristic that flags obvious prompt leakage in a free-form string.
// We don't try to be exhaustive; this is a guard against accidental
// inclusion of large user input in error logs. The tests assert that
// a known-prompt-shaped input is not returned verbatim by
// sanitizeErrorMessage.
const PROMPT_LIKE = new RegExp(
  "\\b(?:ignore (?:all )?(?:previous|prior) instructions\\b|" +
  "</?(?:system|assistant|user)\\b|" +
  "###\\s*instruction|" +
  "please (?:forget|disregard))",
  "i"
);

export function looksLikePrompt(text) {
  return PROMPT_LIKE.test(String(text || ""));
}

// Build the entry that gets persisted. Centralized so the
// persisted-state shape stays consistent.
export function buildErrorEntry({ scope, category, error, status, elapsedMs, provider, model, at }) {
  const finalCategory = isValidCategory(category)
    ? category
    : inferErrorCategory(scope, error);
  const entry = {
    at: at || new Date().toISOString(),
    scope: String(scope || "server"),
    category: finalCategory,
    error: sanitizeErrorMessage((error && error.message) || error)
  };
  if (status != null) entry.status = Number(status);
  if (elapsedMs != null) entry.elapsedMs = Number(elapsedMs);
  if (provider) entry.provider = String(provider);
  if (model) entry.model = String(model);
  return entry;
}
