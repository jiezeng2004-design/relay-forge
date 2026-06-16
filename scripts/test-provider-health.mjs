// Pure unit tests for src/provider-health.js. No server, no I/O.
// Covers sliding-window eviction, score monotonicity, the
// unhealthy flag with auto-clear cooldown, persistence round-trips
// (state normalization), and the summary shape exposed on
// /admin/status.

import { ProviderHealthTracker } from "../src/provider-health.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function assertClose(actual, expected, eps, msg) {
  if (Math.abs(actual - expected) > eps) {
    throw new Error(`${msg}: expected ~${expected} (±${eps}), got ${actual}`);
  }
}

// ---- baseline --------------------------------------------------------------

test("score of an unknown provider is the neutral 0.5", () => {
  const t = new ProviderHealthTracker();
  assertEqual(t.score("unknown"), 0.5, "neutral default");
  assertEqual(t.isUnhealthy("unknown"), false, "unknown is not unhealthy");
});

test("record() on success increments and lifts the score", () => {
  const t = new ProviderHealthTracker();
  t.record("p1", { ok: true, latencyMs: 200 });
  t.record("p1", { ok: true, latencyMs: 200 });
  t.record("p1", { ok: true, latencyMs: 200 });
  const s = t.score("p1");
  assert(s > 0.5, `score should be > 0.5, got ${s}`);
});

test("record() on failure lowers the score", () => {
  const t = new ProviderHealthTracker();
  for (let i = 0; i < 5; i += 1) t.record("p1", { ok: true, latencyMs: 200 });
  const before = t.score("p1");
  for (let i = 0; i < 5; i += 1) t.record("p1", { ok: false, latencyMs: 100, error: "upstream_5xx" });
  const after = t.score("p1");
  assert(after < before, `score should drop, before=${before} after=${after}`);
});

// ---- sliding window --------------------------------------------------------

test("window evicts entries past windowSize", () => {
  const t = new ProviderHealthTracker({}, { windowSize: 4 });
  for (let i = 0; i < 10; i += 1) t.record("p1", { ok: true, latencyMs: 100 });
  const summary = t.summary();
  assertEqual(summary.p1.windowSize, 4, "window capped at 4");
});

test("score blends success rate and latency", () => {
  const t = new ProviderHealthTracker({}, { windowSize: 10, healthyLatencyMs: 1000 });
  // 5 fast successes -> high score
  for (let i = 0; i < 5; i += 1) t.record("fast", { ok: true, latencyMs: 50 });
  // 5 slow successes -> lower score
  for (let i = 0; i < 5; i += 1) t.record("slow", { ok: true, latencyMs: 5000 });
  assert(t.score("fast") > t.score("slow"), "fast > slow");
});

test("score is monotonic in failure count (same latency)", () => {
  const t = new ProviderHealthTracker({}, { windowSize: 10 });
  const t1 = new ProviderHealthTracker({}, { windowSize: 10 });
  const t2 = new ProviderHealthTracker({}, { windowSize: 10 });
  for (let i = 0; i < 5; i += 1) {
    t1.record("p", { ok: true, latencyMs: 200 });
    t2.record("p", { ok: true, latencyMs: 200 });
  }
  // t1: 1 failure among 5, t2: 3 failures among 5
  t1.record("p", { ok: false, latencyMs: 200 });
  t2.record("p", { ok: false, latencyMs: 200 });
  t2.record("p", { ok: false, latencyMs: 200 });
  assert(t1.score("p") > t2.score("p"), "1 fail > 3 fail");
});

test("consecutive failures below threshold do not flag unhealthy", () => {
  const t = new ProviderHealthTracker({}, { unhealthyFailStreak: 3 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  assertEqual(t.isUnhealthy("p"), false, "2 fails not unhealthy");
});

test("consecutive failures at or above threshold flag unhealthy", () => {
  const t = new ProviderHealthTracker({}, { unhealthyFailStreak: 3 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  assertEqual(t.isUnhealthy("p"), true, "3 fails -> unhealthy");
});

test("a single success after unhealthy streak clears the consecutive count", () => {
  const t = new ProviderHealthTracker({}, { unhealthyFailStreak: 3 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  assertEqual(t.isUnhealthy("p"), true, "unhealthy");
  t.record("p", { ok: true, latencyMs: 100 });
  assertEqual(t.consecutiveFails("p"), 0, "streak cleared");
  // Note: unhealthy flag stays until cooldown elapses or next
  // isUnhealthy() check; this is by design (transient blips).
});

test("unhealthy flag auto-clears after unhealthyCooldownMs", async () => {
  const t = new ProviderHealthTracker({}, { unhealthyFailStreak: 2, unhealthyCooldownMs: 50 });
  t.record("p", { ok: false, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100 });
  assertEqual(t.isUnhealthy("p"), true, "unhealthy at t=0");
  // Wait for cooldown to elapse, then check again.
  await sleep(80);
  assertEqual(t.isUnhealthy("p"), false, "auto-cleared after 80ms > 50ms cooldown");
});

test("rate-limit cooldown marks provider unhealthy until the deadline", async () => {
  const t = new ProviderHealthTracker();
  t.recordRateLimit("p", Date.now() + 50, "retry_after");
  assertEqual(t.isUnhealthy("p"), true, "rate-limited provider is unhealthy");
  const summary = t.summary();
  assertEqual(summary.p.rateLimited, true, "summary exposes rateLimited=true");
  assert(summary.p.rateLimitedUntil > Date.now(), "summary exposes future deadline");
  assertEqual(summary.p.rateLimitReason, "retry_after", "summary exposes reason");
  await sleep(80);
  assertEqual(t.isUnhealthy("p"), false, "rate-limit cooldown clears after deadline");
  assertEqual(t.summary().p.rateLimited, false, "summary clears rateLimited flag");
});

test("success clears active rate-limit cooldown", () => {
  const t = new ProviderHealthTracker();
  t.recordRateLimit("p", Date.now() + 10_000, "retry_after");
  assertEqual(t.isUnhealthy("p"), true, "rate-limited");
  t.record("p", { ok: true, latencyMs: 10 });
  assertEqual(t.isUnhealthy("p"), false, "success clears rate-limit state");
  assertEqual(t.summary().p.rateLimited, false, "summary no longer rate-limited");
});

// ---- summary ---------------------------------------------------------------

test("summary returns one bucket per known provider", () => {
  const t = new ProviderHealthTracker();
  t.record("a", { ok: true, latencyMs: 100 });
  t.record("b", { ok: false, latencyMs: 100, error: "x" });
  const s = t.summary();
  assert(s.a && s.b, "both providers present");
  assertEqual(s.a.successCount, 1, "a success count");
  assertEqual(s.b.failureCount, 1, "b failure count");
  assertEqual(s.b.lastError, "x", "last error captured");
});

test("summary score and unhealthy flags are consistent with the API", () => {
  const t = new ProviderHealthTracker({}, { unhealthyFailStreak: 2 });
  t.record("p", { ok: true, latencyMs: 100 });
  t.record("p", { ok: false, latencyMs: 100, error: "boom" });
  t.record("p", { ok: false, latencyMs: 100, error: "boom" });
  const s = t.summary();
  assertEqual(s.p.unhealthy, true, "summary unhealthy");
  assertClose(s.p.score, t.score("p"), 1e-9, "summary score");
});

test("reset() clears a single provider", () => {
  const t = new ProviderHealthTracker();
  t.record("a", { ok: true, latencyMs: 100 });
  t.record("b", { ok: true, latencyMs: 100 });
  t.reset("a");
  assertEqual(t.score("a"), 0.5, "a reset -> neutral");
  assert(t.score("b") > 0.5, "b intact");
});

test("reset() with no argument clears all providers", () => {
  const t = new ProviderHealthTracker();
  t.record("a", { ok: true, latencyMs: 100 });
  t.record("b", { ok: true, latencyMs: 100 });
  t.reset();
  assertEqual(t.score("a"), 0.5, "a reset");
  assertEqual(t.score("b"), 0.5, "b reset");
});

// ---- persistence round-trip ------------------------------------------------

test("constructor normalizes a serialized state from /admin/status", () => {
  const persisted = {
    providers: {
      x: {
        window: [
          { ok: true, latencyMs: 100, at: "2024-01-01T00:00:00Z" },
          { ok: false, latencyMs: 200, at: "2024-01-01T00:00:01Z", error: "boom" }
        ],
        consecutiveFails: 1,
        unhealthySince: 0,
        rateLimitedUntil: Date.now() + 60_000,
        rateLimitReason: "retry_after"
      }
    }
  };
  const t = new ProviderHealthTracker(persisted);
  const s = t.summary();
  assertEqual(s.x.windowSize, 2, "window preserved");
  assertEqual(s.x.failureCount, 1, "failures preserved");
  assertEqual(s.x.successCount, 1, "successes preserved");
  assertEqual(s.x.consecutiveFails, 1, "streak preserved");
  assertEqual(s.x.rateLimited, true, "rate limit state preserved");
  assertEqual(s.x.rateLimitReason, "retry_after", "rate limit reason preserved");
});

test("constructor tolerates garbage / wrong types in the persisted state", () => {
  const t = new ProviderHealthTracker({ providers: { x: null, y: { window: "not-an-array" } } });
  assertEqual(t.score("x"), 0.5, "null bucket -> neutral");
  assertEqual(t.score("y"), 0.5, "bad window -> neutral");
});

test("constructor clamps the window to the default size on load", () => {
  const huge = { providers: { x: { window: Array.from({ length: 100 }, () => ({ ok: true, latencyMs: 1, at: "t" })) } } };
  const t = new ProviderHealthTracker(huge);
  // 100 entries collapse to the default 20.
  assertEqual(t.summary().x.windowSize, 20, "clamped to 20");
});

test("score is bounded in [0, 1] even with extreme latency", () => {
  const t = new ProviderHealthTracker({}, { healthyLatencyMs: 1000 });
  t.record("p", { ok: true, latencyMs: 999999 });
  const s = t.score("p");
  assert(s >= 0 && s <= 1, `score in [0,1], got ${s}`);
});

test("score handles all-failures and all-successes as extreme 0 / 1", () => {
  const t = new ProviderHealthTracker({}, { windowSize: 5 });
  for (let i = 0; i < 5; i += 1) t.record("a", { ok: true, latencyMs: 1 });
  for (let i = 0; i < 5; i += 1) t.record("b", { ok: false, latencyMs: 1 });
  assertClose(t.score("a"), 1.0, 0.01, "all-success -> ~1");
  assertClose(t.score("b"), 0.0, 0.01, "all-fail -> ~0");
});

// ---- runner ----------------------------------------------------------------

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ok  ${t.name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${t.name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
