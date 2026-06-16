// Pure unit tests for src/token-estimate.js + src/usage.js metrics.
// No server, no I/O. Covers:
//   - per-family chars-per-token multipliers
//   - estimateTokens on plain strings
//   - estimateMessagesTokens on OpenAI / Anthropic / Responses message
//     shapes
//   - normalizeUsage across OpenAI / Anthropic shapes
//   - UsageTracker.recordLatency + metrics() percentile calculation
//   - Persistence round-trip with the new latencies / tokens fields

import {
  estimateMessagesTokens,
  estimateTokens,
  normalizeUsage,
  pickFamily
} from "../src/token-estimate.js";
import { UsageTracker } from "../src/usage.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
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

// ---- token-estimate.js ----

test("estimateTokens: empty / null / non-string input returns 0", () => {
  assertEqual(estimateTokens(null, "gpt-4o"), 0, "null");
  assertEqual(estimateTokens(undefined, "gpt-4o"), 0, "undefined");
  assertEqual(estimateTokens("", "gpt-4o"), 0, "empty string");
  assertEqual(estimateTokens(123, "gpt-4o"), estimateTokens("123", "gpt-4o"), "number coerced");
});

test("estimateTokens: 'hello world' is roughly 2-3 tokens for gpt-4o", () => {
  const tokens = estimateTokens("hello world", "gpt-4o");
  assert(tokens >= 2 && tokens <= 4, `expected 2-4 tokens, got ${tokens}`);
});

test("estimateTokens: a 1000-char English string is ~250-270 tokens (gpt-4o)", () => {
  const text = "a".repeat(1000);
  const tokens = estimateTokens(text, "gpt-4o");
  assert(tokens >= 240 && tokens <= 280, `expected 240-280, got ${tokens}`);
});

test("pickFamily: matches gpt-4 / gpt-3.5 / o1 / claude / gemini / deepseek / qwen / llama / mistral / cohere / grok", () => {
  assertEqual(pickFamily("gpt-4o"), "gpt4", "gpt-4o");
  assertEqual(pickFamily("gpt-4o-mini"), "gpt4", "gpt-4o-mini");
  assertEqual(pickFamily("gpt-4-turbo-preview"), "gpt4", "gpt-4-turbo");
  assertEqual(pickFamily("gpt-3.5-turbo-0125"), "gpt35", "gpt-3.5");
  assertEqual(pickFamily("o1-preview"), "gpt4", "o1-preview");
  assertEqual(pickFamily("claude-3-5-sonnet-latest"), "claude", "claude");
  assertEqual(pickFamily("gemini-2.5-flash"), "gemini", "gemini");
  assertEqual(pickFamily("deepseek-chat"), "deepseek", "deepseek");
  assertEqual(pickFamily("deepseek-reasoner"), "deepseek", "deepseek-reasoner");
  assertEqual(pickFamily("qwen2.5-7b-instruct"), "qwen", "qwen");
  assertEqual(pickFamily("llama-3.1-8b"), "llama", "llama");
  assertEqual(pickFamily("meta-llama/Llama-3.3-70B-Instruct"), "llama", "meta-llama");
  assertEqual(pickFamily("mistral-large"), "mistral", "mistral");
  assertEqual(pickFamily("command-r-plus"), "cohere", "cohere");
  assertEqual(pickFamily("grok-3"), "grok", "grok");
  assertEqual(pickFamily("totally-unknown-model"), "unknown", "unknown");
  assertEqual(pickFamily(""), "unknown", "empty");
  assertEqual(pickFamily(null), "unknown", "null");
});

test("estimateMessagesTokens: sums across plain string + content arrays + thinking", () => {
  const messages = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: [
      { type: "text", text: "Hello" },
      { type: "image_url", image_url: { url: "http://x/y.png" } }
    ]},
    { role: "assistant", content: null, thinking: "the user said hi" }
  ];
  const tokens = estimateMessagesTokens(messages, "gpt-4o");
  assert(tokens > 5, `expected at least 5 tokens, got ${tokens}`);
});

test("estimateMessagesTokens: OpenAI Responses input format", () => {
  const input = [
    { role: "user", content: [{ type: "input_text", text: "say pong" }] }
  ];
  const tokens = estimateMessagesTokens(input, "gpt-4o");
  assert(tokens >= 2, `expected >= 2 tokens, got ${tokens}`);
});

test("estimateMessagesTokens: empty / non-array input returns 0", () => {
  assertEqual(estimateMessagesTokens(null, "gpt-4o"), 0, "null");
  assertEqual(estimateMessagesTokens([], "gpt-4o"), 0, "empty array");
  assertEqual(estimateMessagesTokens("just a string", "gpt-4o"), estimateTokens("just a string", "gpt-4o"), "string");
});

test("normalizeUsage: OpenAI shape", () => {
  const u = normalizeUsage({ prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 });
  assertEqual(u.prompt_tokens, 10, "prompt");
  assertEqual(u.completion_tokens, 20, "completion");
  assertEqual(u.total_tokens, 30, "total");
});

test("normalizeUsage: Anthropic shape (input_tokens / output_tokens)", () => {
  const u = normalizeUsage({ input_tokens: 7, output_tokens: 13 });
  assertEqual(u.prompt_tokens, 7, "prompt");
  assertEqual(u.completion_tokens, 13, "completion");
  assertEqual(u.total_tokens, 20, "total");
});

test("normalizeUsage: Anthropic stream delta (output_tokens_delta only)", () => {
  const u = normalizeUsage({ input_tokens: 5, output_tokens_delta: 2 });
  assertEqual(u.prompt_tokens, 5, "prompt");
  assertEqual(u.completion_tokens, 2, "completion");
});

test("normalizeUsage: missing / invalid returns null", () => {
  assertEqual(normalizeUsage(null), null, "null");
  assertEqual(normalizeUsage({}), null, "empty object");
  assertEqual(normalizeUsage("nope"), null, "string");
  assertEqual(normalizeUsage(undefined), null, "undefined");
});

test("normalizeUsage: clamps negatives to 0", () => {
  const u = normalizeUsage({ prompt_tokens: -5, completion_tokens: 10 });
  assertEqual(u.prompt_tokens, 0, "negative prompt");
  assertEqual(u.completion_tokens, 10, "positive completion");
});

// ---- UsageTracker metrics ----

test("recordLatency: empty bucket returns 0 metrics", () => {
  const t = new UsageTracker();
  const m = t.metrics();
  assertEqual(Object.keys(m.byRoute).length, 0, "no routes");
  assertEqual(Object.keys(m.byProvider).length, 0, "no providers");
});

test("recordLatency: p50 / p95 computed correctly (ring buffer of 50)", () => {
  const t = new UsageTracker();
  for (let i = 1; i <= 50; i += 1) t.recordLatency("byRoute", "r1", i);
  const m = t.metrics();
  assertEqual(m.byRoute.r1.samples, 50, "samples");
  assertClose(m.byRoute.r1.p50LatencyMs, 25, 2, "p50 of 1..50");
  assertClose(m.byRoute.r1.p95LatencyMs, 48, 2, "p95 of 1..50");
  assertEqual(m.byRoute.r1.minLatencyMs, 1, "min");
  assertEqual(m.byRoute.r1.maxLatencyMs, 50, "max");
});

test("recordLatency: ring buffer keeps only last 50", () => {
  const t = new UsageTracker();
  for (let i = 1; i <= 100; i += 1) t.recordLatency("byRoute", "r1", i);
  const m = t.metrics();
  // samples counts all 100 (cumulative), but latencies ring buffer
  // only holds the last 50. max should be 100 (from samples), but
  // p50 of the ring buffer should be ~75.
  assertEqual(m.byRoute.r1.samples, 100, "samples counts all");
  assertClose(m.byRoute.r1.maxLatencyMs, 100, 0, "max from samples");
  assertClose(m.byRoute.r1.p50LatencyMs, 75, 2, "p50 from ring");
});

test("recordLatency: ignores invalid values", () => {
  const t = new UsageTracker();
  t.recordLatency("byRoute", "r1", NaN);
  t.recordLatency("byRoute", "r1", -10);
  t.recordLatency("byRoute", "r1", 100);
  const m = t.metrics();
  assertEqual(m.byRoute.r1.samples, 1, "only 1 valid");
  assertEqual(m.byRoute.r1.p50LatencyMs, 100, "p50 = the valid one");
});

test("recordTokens: prompt + completion accumulate", () => {
  const t = new UsageTracker();
  t.recordTokens("byRoute", "r1", 10, 20);
  t.recordTokens("byRoute", "r1", 5, 5);
  const m = t.metrics();
  assertEqual(m.byRoute.r1.promptTokens, 15, "prompt total");
  assertEqual(m.byRoute.r1.completionTokens, 25, "completion total");
  assertEqual(m.byRoute.r1.totalTokens, 40, "grand total");
});

test("metrics: 3 buckets (route / provider / model) share sample space", () => {
  const t = new UsageTracker();
  t.recordLatency("byRoute", "r1", 100);
  t.recordLatency("byProvider", "p1", 200);
  t.recordLatency("byModel", "p1:m1", 300);
  const m = t.metrics();
  assertEqual(m.byRoute.r1.p50LatencyMs, 100, "route");
  assertEqual(m.byProvider.p1.p50LatencyMs, 200, "provider");
  assertEqual(m.byModel["p1:m1"].p50LatencyMs, 300, "model");
});

test("summary: includes metrics", () => {
  const t = new UsageTracker();
  t.recordLatency("byRoute", "r1", 50);
  const s = t.summary();
  assert(s.metrics && s.metrics.byRoute.r1, "metrics in summary");
  assertEqual(s.metrics.byRoute.r1.p50LatencyMs, 50, "p50 in summary");
});

test("persistence round-trip: metrics fields preserved", () => {
  const t1 = new UsageTracker();
  t1.recordLatency("byRoute", "r1", 100);
  t1.recordTokens("byRoute", "r1", 10, 20);
  const state = t1.current();
  const t2 = new UsageTracker(state);
  const m = t2.metrics();
  assertEqual(m.byRoute.r1.samples, 1, "samples preserved");
  assertEqual(m.byRoute.r1.p50LatencyMs, 100, "p50 preserved");
  assertEqual(m.byRoute.r1.promptTokens, 10, "prompt tokens preserved");
  assertEqual(m.byRoute.r1.completionTokens, 20, "completion tokens preserved");
});

test("persistence round-trip: legacy count-map state migrates to empty runtime bucket", () => {
  const legacy = {
    day: "2024-01-01",
    daily: { total: 0, routes: {}, providers: {}, models: {} },
    history: [],
    runtime: {
      byRoute: { r1: { ok: 5, failed: 1 } }, // legacy count-map shape
      byModel: {},
      byProvider: {} // a number value (e.g. { p1: 7 }) would be dropped — no longer matches the new bucket shape
    }
  };
  const t = new UsageTracker(legacy);
  const m = t.metrics();
  // Empty legacy buckets (no latencies, no tokens) are filtered
  // out of `metrics` — the operator sees them as zero until the
  // next request adds samples. Legacy ok / failed counts ARE
  // dropped on this upgrade (the runtime bucket now uses a
  // different shape); the operator's `daily` totals and history
  // are unaffected.
  assertEqual(m.byRoute.r1, undefined, "legacy empty bucket not surfaced in metrics");
  // The bucket itself is normalized to the new shape, not the
  // legacy count-map.
  assertEqual(t.current().runtime.byRoute.r1.latencies.length, 0, "normalized bucket has empty latencies");
  assertEqual(t.current().runtime.byRoute.r1.samples, 0, "normalized bucket has 0 samples");
});

test("metrics: empty / unknown provider / route returns safe defaults", () => {
  const t = new UsageTracker();
  const m = t.metrics();
  assertEqual(m.byRoute["nope"], undefined, "no entry for unknown");
  assertEqual(m.byProvider["nope"], undefined, "no entry for unknown provider");
});

// ---- runner ----

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
