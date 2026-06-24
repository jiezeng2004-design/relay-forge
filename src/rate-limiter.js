const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_REQUESTS = 1000;
const DEFAULT_ADMIN_MAX_REQUESTS = 300;

export function createRateLimiter(options = {}) {
  const windowMs = options.windowMs || DEFAULT_WINDOW_MS;
  const maxRequests = options.maxRequests || DEFAULT_MAX_REQUESTS;
  const adminMaxRequests = options.adminMaxRequests || DEFAULT_ADMIN_MAX_REQUESTS;
  const enabled = options.enabled !== false;

  const ipBuckets = new Map();
  const tokenBuckets = new Map();

  function getClientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    if (forwarded && typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.socket?.remoteAddress || "unknown";
  }

  function getTokenKey(req) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith("Bearer ")) return null;
    return auth.slice("Bearer ".length).slice(0, 16);
  }

  function hitAndCheck(buckets, key, limit) {
    const now = Date.now();
    const entry = buckets.get(key);
    if (!entry || now - entry.windowStart >= windowMs) {
      buckets.set(key, { windowStart: now, count: 1 });
      return { ok: true, remaining: limit - 1, resetAt: now + windowMs };
    }
    if (entry.count >= limit) {
      return { ok: false, remaining: 0, resetAt: entry.windowStart + windowMs };
    }
    entry.count += 1;
    return { ok: true, remaining: limit - entry.count, resetAt: entry.windowStart + windowMs };
  }

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of ipBuckets) {
      if (now - entry.windowStart >= windowMs) ipBuckets.delete(key);
    }
    for (const [key, entry] of tokenBuckets) {
      if (now - entry.windowStart >= windowMs) tokenBuckets.delete(key);
    }
  }

  setInterval(cleanup, windowMs * 2).unref?.();

  return {
    check(req, isAdminPath = false) {
      if (!enabled) return { ok: true };

      const limit = isAdminPath ? adminMaxRequests : maxRequests;

      const tokenKey = getTokenKey(req);
      if (tokenKey) {
        const result = hitAndCheck(tokenBuckets, tokenKey, limit);
        if (!result.ok) return result;
      }

      const ip = getClientIp(req);
      return hitAndCheck(ipBuckets, ip, limit);
    },

    middleware(isAdminPath = false) {
      return (req, res, next) => {
        const result = this.check(req, isAdminPath);
        if (!result.ok) {
          res.writeHead(429, {
            "content-type": "application/json; charset=utf-8",
            "retry-after": Math.ceil((result.resetAt - Date.now()) / 1000),
            "x-ratelimit-limit": isAdminPath ? adminMaxRequests : maxRequests,
            "x-ratelimit-remaining": 0,
            "x-ratelimit-reset": result.resetAt
          });
          res.end(JSON.stringify({
            ok: false,
            error: "rate_limit_exceeded",
            message: "Too many requests. Please try again later.",
            details: {
              limit: isAdminPath ? adminMaxRequests : maxRequests,
              windowMs,
              retryAfterMs: result.resetAt - Date.now()
            }
          }));
          return false;
        }
        res.setHeader?.("x-ratelimit-limit", isAdminPath ? adminMaxRequests : maxRequests);
        res.setHeader?.("x-ratelimit-remaining", result.remaining);
        res.setHeader?.("x-ratelimit-reset", result.resetAt);
        return true;
      };
    }
  };
}
