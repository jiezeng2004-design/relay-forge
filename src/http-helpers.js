// Pure HTTP plumbing: header / body helpers shared by all handlers.

import { parseOpenRelayKey } from "./auth.js";

// 0.5.3: server.js sets the resolved relay auth context at
// startup. isAuthorized() reads it so all existing call sites
// (admin paths, dashboard root, etc.) automatically use the
// same decision as the new /v1/* gate. The legacy behavior
// (env RELAY_TOKEN, no auth otherwise) is preserved when no
// context is set — useful for unit tests and the --check mode.
let authContext = null;

export function setAuthContext(context) {
  authContext = context || null;
}

export function getAuthContext() {
  return authContext;
}

export function sendJson(res, body, status = 200) {
  res.writeHead(status, withCorsHeaders({ "content-type": "application/json; charset=utf-8" }, res.__openrelayReq));
  res.end(JSON.stringify(body, null, 2));
}

export function sendHtml(res, body, status = 200) {
  res.writeHead(status, withCorsHeaders({ "content-type": "text/html; charset=utf-8" }, res.__openrelayReq));
  res.end(body);
}

export function sendNoContent(res) {
  res.writeHead(204, withCorsHeaders({}, res.__openrelayReq));
  res.end();
}

export function unauthorized(res) {
  return sendJson(res, { error: "unauthorized" }, 401);
}

export function forbiddenCors(res) {
  return sendJson(res, { error: "forbidden_origin" }, 403);
}

export function withCorsHeaders(headers, req = null) {
  const cors = buildCorsHeaders(req);
  return {
    ...headers,
    ...cors,
    "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-api-key,anthropic-version,x-relay-token",
    "access-control-expose-headers": "content-type"
  };
}

export function copyResponseHeaders(headers, req = null) {
  const result = {};
  for (const [key, value] of headers.entries()) {
    if (["content-encoding", "content-length", "transfer-encoding"].includes(key.toLowerCase())) continue;
    result[key] = value;
  }
  return withCorsHeaders(result, req);
}

export async function readJsonBody(req, maxBytes) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("request body too large");
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

export function isAuthorized(req) {
  // 0.5.3: prefer the server-resolved auth context. If no context
  // is set (e.g. unit tests, --check mode), fall back to the
  // legacy env-var check so the helper stays backward-compatible.
  if (authContext) {
    if (authContext.allowNoAuth) return true;
    if (!authContext.token) return true;
    return req.headers.authorization === `Bearer ${authContext.token}`;
  }
  const token = process.env.RELAY_TOKEN || process.env.OPENRELAY_TOKEN;
  if (!token) return true;
  return req.headers.authorization === `Bearer ${token}`;
}

// 0.5.3: gate for /v1/* proxy endpoints. Stricter than
// isAuthorized: when the server has resolved a token (env / disk
// / generated), /v1/* ALWAYS requires `Authorization: Bearer …`,
// even if a previous /admin/* request would have been allowed
// without a token. The intent is that the open admin surface (used
// by the local dashboard) does not accidentally expose the proxy.
//
// 0.6.6+: also accepts `sk-or-{target}-{hex}` keys (openrelay
// compatible format). When such a key is used, the routing target
// (provider or route name) is extracted and stored on the request
// as `req.__openrelayRouting`.
export function isAuthorizedV1(req) {
  if (!authContext) return true;
  if (authContext.allowNoAuth) return true;
  if (!authContext.token) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${authContext.token}`) return true;
  // Backward-compat alias: some early adopters use a custom
  // x-relay-token header. We accept it as a courtesy but
  // document Authorization: Bearer as the canonical form.
  if (req.headers["x-relay-token"] === authContext.token) return true;
  // Accept sk-or-{target}-{hex} keys for v1 proxy endpoints.
  // These keys are self-authorizing and carry routing info.
  if (header && typeof header === "string" && header.startsWith("Bearer sk-or-")) {
    const raw = header.slice("Bearer ".length);
    if (parseOpenRelayKey(raw)) {
      req.__openrelayRouting = raw;
      return true;
    }
  }
  return false;
}

export function isAdminPath(req) {
  const path = getRequestPath(req);
  return path === "/admin" || path.startsWith("/admin/");
}

export function isAllowedAdminOrigin(req, port) {
  if (!isAdminPath(req)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const originHost = parsed.hostname;
  const originPort = parsed.port || (parsed.protocol === "https:" ? "443" : "80");
  const expectedPort = String(port);
  if (originPort !== expectedPort) return false;
  if (originHost === "127.0.0.1" || originHost === "localhost" || originHost === "::1" || originHost === "[::1]") {
    return true;
  }
  const hostHeader = String(req.headers.host || "");
  return hostHeader === parsed.host;
}

export function parseMaybeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 2000);
  }
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildCorsHeaders(req) {
  if (!req || !isAdminPath(req)) return { "access-control-allow-origin": "*" };
  const origin = req.headers.origin;
  if (!origin) return {};
  return { "access-control-allow-origin": origin, "access-control-allow-credentials": "false" };
}

function getRequestPath(req) {
  try {
    return new URL(req.url || "/", "http://127.0.0.1").pathname;
  } catch {
    return req.url || "/";
  }
}
