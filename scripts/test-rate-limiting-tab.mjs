// Unit tests for Rate Limiting tab renderer and PATCH /admin/limits handler logic.

import { renderRateLimitingTab } from "../src/dashboard/tabs/rate-limiting.js";

let pass = 0;
let fail = 0;

function assert(cond, message) {
  if (cond) { pass++; console.log(`  ok  ${message}`); }
  else { fail++; console.log(`  FAIL  ${message}`); }
}

function testRenderWithEmptyStatus() {
  console.log("test: renderRateLimitingTab with empty status");
  const html = renderRateLimitingTab({ status: { providers: [], routes: [], keys: {}, recentErrors: [], usage: { daily: {}, limits: {} }, stats: {} }, port: 18765 });
  assert(typeof html === "string" && html.length > 100, "returns non-trivial HTML");
  assert(html.includes("Rate Limiting"), "page title present");
  assert(html.includes("No providers configured"), "empty state shown when no providers");
  assert(html.includes("No routes configured"), "empty state shown when no routes");
}

function testRenderWithProvidersAndUsage() {
  console.log("test: renderRateLimitingTab with providers and usage data");
  const status = {
    providers: [{ name: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai" }],
    routes: [{ name: "coding-local", strategy: "fallback" }],
    keys: { deepseek: [{ label: "key-1", hash: "abc123", uses: 5, failures: 1, coolingDown: false }] },
    recentErrors: [
      { category: "upstream_429" },
      { category: "upstream_429" },
      { category: "upstream_5xx" },
      { category: "local_limit" }
    ],
    usage: {
      daily: { total: 42, providers: { deepseek: { total: 40 } }, routes: { "coding-local": 38 } },
      limits: { dailyRequests: 100, providers: { deepseek: { dailyRequests: 50 } }, routes: {} }
    },
    stats: { localLimitHits: 3 },
    providerHealth: { deepseek: { rateLimited: true } }
  };
  const html = renderRateLimitingTab({ status, port: 18765 });
  assert(html.includes("Today"), "today requests metric present");
  assert(html.includes(">42<"), "today's total = 42 shown");
  assert(html.includes(">2<"), "429 count = 2 shown");
  assert(html.includes(">3<"), "local limit hits = 3 shown");
  assert(html.includes("deepseek"), "provider name in table");
  assert(html.includes("coding-local"), "route name in table");
  assert(html.includes("rate-limited"), "rate-limited pill shown for rate-limited provider");
  assert(html.includes("cooling down") === false, "no cooling down pill when key is ready");
  assert(html.includes("PATCH /admin/limits"), "endpoint reference present");
  assert(html.includes("data-limit-provider"), "per-provider limit inputs present");
  assert(html.includes("saveLimits"), "save function present");
}

function testRenderWithCoolingKey() {
  console.log("test: renderRateLimitingTab shows cooldown for cooling keys");
  const status = {
    providers: [{ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai" }],
    routes: [],
    keys: { ollama: [{ label: "env-key", hash: "xyz", uses: 10, failures: 3, coolingDown: true, cooldownUntil: "2026-07-10T12:00:00Z" }] },
    recentErrors: [],
    usage: { daily: { total: 0 }, limits: { dailyRequests: null } },
    stats: {}
  };
  const html = renderRateLimitingTab({ status, port: 18765 });
  assert(html.includes("cooling down"), "cooling down pill shown");
  assert(html.includes("2026-07-10T12:00:00Z"), "cooldown time shown");
}

function testRenderUnlimitedGlobal() {
  console.log("test: renderRateLimitingTab handles unlimited (null) global limit");
  const status = {
    providers: [{ name: "test", baseUrl: "http://127.0.0.1:9999/v1", apiFormat: "openai" }],
    routes: [],
    keys: {},
    recentErrors: [],
    usage: { daily: { total: 999 }, limits: { dailyRequests: null } },
    stats: {}
  };
  const html = renderRateLimitingTab({ status, port: 18765 });
  assert(html.includes("999"), "today's total shown");
  assert(html.includes("unlimited"), "unlimited label shown for null limit");
}

testRenderWithEmptyStatus();
testRenderWithProvidersAndUsage();
testRenderWithCoolingKey();
testRenderUnlimitedGlobal();

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);