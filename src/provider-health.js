// Sliding-window provider health tracker. Owns no I/O; persistence is
// the caller's job (mirroring src/usage.js).
//
// A provider is marked `unhealthy` after 3 consecutive failures inside
// the active window. The flag auto-clears after `unhealthyCooldownMs`
// (default 60s) so a transient outage doesn't permanently demote a
// provider to last place. The score is in [0, 1] where 1 means
// "all recent requests succeeded with sub-second latency".

const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_UNHEALTHY_FAIL_STREAK = 3;
const DEFAULT_UNHEALTHY_COOLDOWN_MS = 60_000;
const HEALTHY_LATENCY_THRESHOLD_MS = 1500;

export class ProviderHealthTracker {
  constructor(initial, options = {}) {
    this.windowSize = Math.max(1, Number(options.windowSize || DEFAULT_WINDOW_SIZE));
    this.unhealthyFailStreak = Math.max(1, Number(options.unhealthyFailStreak || DEFAULT_UNHEALTHY_FAIL_STREAK));
    // 0ms is a valid test value (immediate clear); only the default
    // when the option is missing enforces the 1s floor.
    const cooldownOption = options.unhealthyCooldownMs === undefined
      ? DEFAULT_UNHEALTHY_COOLDOWN_MS
      : Number(options.unhealthyCooldownMs);
    this.unhealthyCooldownMs = Number.isFinite(cooldownOption) && cooldownOption >= 0
      ? cooldownOption
      : DEFAULT_UNHEALTHY_COOLDOWN_MS;
    this.healthyLatencyMs = Math.max(100, Number(options.healthyLatencyMs || HEALTHY_LATENCY_THRESHOLD_MS));
    this.state = normalizeHealthState(initial);
  }

  record(providerName, { ok, latencyMs = 0, error } = {}) {
    if (!providerName) return;
    const bucket = this.ensureBucket(providerName);
    bucket.window.push({
      ok: ok === true,
      latencyMs: Number.isFinite(latencyMs) && latencyMs > 0 ? Math.floor(latencyMs) : 0,
      at: Date.now(),
      error: error ? String(error).slice(0, 120) : undefined
    });
    if (bucket.window.length > this.windowSize) {
      bucket.window.splice(0, bucket.window.length - this.windowSize);
    }
    if (ok === true) {
      bucket.consecutiveFails = 0;
      bucket.rateLimitedUntil = 0;
      bucket.rateLimitReason = null;
    } else {
      bucket.consecutiveFails += 1;
      if (bucket.consecutiveFails >= this.unhealthyFailStreak) {
        bucket.unhealthySince = Date.now();
      }
    }
    // Auto-clear stale unhealthy flag.
    if (bucket.unhealthySince && Date.now() - bucket.unhealthySince > this.unhealthyCooldownMs) {
      bucket.unhealthySince = 0;
      bucket.consecutiveFails = 0;
    }
  }

  isUnhealthy(providerName) {
    const bucket = this.state.providers[providerName];
    if (!bucket) return false;
    if (bucket.rateLimitedUntil && bucket.rateLimitedUntil > Date.now()) return true;
    if (bucket.rateLimitedUntil && bucket.rateLimitedUntil <= Date.now()) {
      bucket.rateLimitedUntil = 0;
      bucket.rateLimitReason = null;
    }
    if (!bucket.unhealthySince) return false;
    if (Date.now() - bucket.unhealthySince > this.unhealthyCooldownMs) {
      bucket.unhealthySince = 0;
      bucket.consecutiveFails = 0;
      return false;
    }
    return true;
  }

  recordRateLimit(providerName, untilMs, reason = "upstream_429") {
    if (!providerName) return;
    const until = Math.max(Date.now(), Math.floor(Number(untilMs || 0)));
    const bucket = this.ensureBucket(providerName);
    bucket.rateLimitedUntil = Math.max(bucket.rateLimitedUntil || 0, until);
    bucket.rateLimitReason = String(reason || "upstream_429").slice(0, 120);
  }

  consecutiveFails(providerName) {
    const bucket = this.state.providers[providerName];
    return bucket ? bucket.consecutiveFails : 0;
  }

  score(providerName) {
    const bucket = this.state.providers[providerName];
    if (!bucket || bucket.window.length === 0) return 0.5; // unknown = neutral
    const total = bucket.window.length;
    const ok = bucket.window.reduce((sum, item) => sum + (item.ok ? 1 : 0), 0);
    const successRate = ok / total;
    // Latency score is computed only over successful requests — a
    // failure already drags the success rate down; using the
    // failures' (often near-instant) latency to inflate the score
    // would mask real problems.
    const successes = bucket.window.filter((item) => item.ok);
    const latencyScore = successes.length === 0
      ? 0
      : Math.max(0, 1 - (successes.reduce((s, item) => s + item.latencyMs, 0) / successes.length) / (this.healthyLatencyMs * 3));
    const blended = 0.7 * successRate + 0.3 * latencyScore;
    return Math.max(0, Math.min(1, blended));
  }

  summary() {
    const result = {};
    for (const name of Object.keys(this.state.providers)) {
      const bucket = this.state.providers[name];
      const rateLimited = !!(bucket.rateLimitedUntil && bucket.rateLimitedUntil > Date.now());
      result[name] = {
        score: this.score(name),
        unhealthy: this.isUnhealthy(name),
        rateLimited,
        rateLimitedUntil: rateLimited ? bucket.rateLimitedUntil : null,
        rateLimitReason: rateLimited ? (bucket.rateLimitReason || "upstream_429") : null,
        windowSize: bucket.window.length,
        successCount: bucket.window.filter((item) => item.ok).length,
        failureCount: bucket.window.filter((item) => !item.ok).length,
        consecutiveFails: bucket.consecutiveFails,
        unhealthySince: bucket.unhealthySince || null,
        lastError: bucket.window.filter((item) => !item.ok).slice(-1)[0]?.error || null
      };
    }
    return result;
  }

  ensureBucket(providerName) {
    if (!this.state.providers[providerName]) {
      this.state.providers[providerName] = {
        window: [],
        consecutiveFails: 0,
        unhealthySince: 0,
        rateLimitedUntil: 0,
        rateLimitReason: null
      };
    }
    return this.state.providers[providerName];
  }

  reset(providerName) {
    if (providerName) {
      delete this.state.providers[providerName];
    } else {
      this.state.providers = {};
    }
  }
}

function normalizeHealthState(state) {
  const result = { providers: {} };
  if (!state || typeof state !== "object") return result;
  const providers = state.providers && typeof state.providers === "object" ? state.providers : {};
  for (const [name, bucket] of Object.entries(providers)) {
    if (!bucket || typeof bucket !== "object") continue;
    result.providers[name] = {
      window: Array.isArray(bucket.window)
        ? bucket.window
            .filter((item) => item && typeof item === "object")
            .slice(-DEFAULT_WINDOW_SIZE)
            .map((item) => ({
              ok: item.ok === true,
              latencyMs: Math.max(0, Math.floor(Number(item.latencyMs || 0))),
              at: typeof item.at === "string" ? item.at : new Date().toISOString(),
              error: typeof item.error === "string" ? item.error.slice(0, 120) : undefined
            }))
        : [],
      consecutiveFails: Math.max(0, Math.floor(Number(bucket.consecutiveFails || 0))),
      unhealthySince: Math.max(0, Math.floor(Number(bucket.unhealthySince || 0))),
      rateLimitedUntil: Math.max(0, Math.floor(Number(bucket.rateLimitedUntil || 0))),
      rateLimitReason: typeof bucket.rateLimitReason === "string" ? bucket.rateLimitReason.slice(0, 120) : null
    };
  }
  return result;
}
