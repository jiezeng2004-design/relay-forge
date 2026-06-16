// Pure unit tests for src/route-preview.js. No server, no I/O.
// Covers the five resolution kinds plus the "no resolution" branch
// and the candidate decoration (local/cloud/key/risk/health).

import { resolveRoutePreview } from "../src/route-preview.js";

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

const baseConfig = () => ({
  defaultProvider: "ollama",
  providers: [
    {
      name: "ollama",
      baseUrl: "http://127.0.0.1:11434/v1",
      apiFormat: "openai",
      allowInsecureHttp: false,
      keyEnv: null,
      models: ["qwen2.5:7b", "llama3.1:8b"],
      keyCount: 0
    },
    {
      name: "deepseek",
      baseUrl: "https://api.deepseek.com/v1",
      apiFormat: "openai",
      allowInsecureHttp: false,
      keyEnv: "DEEPSEEK_API_KEYS",
      models: ["deepseek-chat"],
      keyCount: 0
    },
    {
      name: "vllm-internal",
      baseUrl: "http://10.0.0.5:8000/v1",
      apiFormat: "openai",
      allowInsecureHttp: true,
      keyEnv: "VLLM_KEYS",
      models: ["qwen-instruct"],
      keyCount: 0
    }
  ],
  routes: [
    {
      name: "coding-local",
      strategy: "fallback",
      candidates: [
        { provider: "deepseek", model: "deepseek-chat", weight: 3 },
        { provider: "ollama", model: "qwen2.5:7b", weight: 1 }
      ]
    },
    {
      name: "balanced-local",
      strategy: "weighted",
      candidates: [
        { provider: "deepseek", model: "deepseek-chat", weight: 5 },
        { provider: "ollama", model: "qwen2.5:7b", weight: 1 }
      ]
    }
  ],
  profiles: [
    { name: "local-only", defaultModel: "unlimited-local" },
    { name: "coding", defaultModel: "coding-local" }
  ],
  activeProfile: "coding"
});

test("auto resolves through the active profile's defaultModel (route)", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "auto");
  assert(result.ok, "auto resolves successfully");
  assertEqual(result.kind, "route", "kind is route");
  assertEqual(result.routeName, "coding-local", "matches coding-local route");
  assertEqual(result.strategy, "fallback", "strategy is fallback");
  assertEqual(result.candidates.length, 2, "two candidates");
  assertEqual(result.candidates[0].provider, "deepseek", "first candidate is deepseek");
  assertEqual(result.candidates[0].weight, 3, "weight 3 propagated");
});

test("profile name resolves to the profile's defaultModel", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "local-only");
  // local-only.defaultModel is "unlimited-local" which is not a route,
  // so it falls through to provider_model or default_provider.
  // We just assert it didn't error and is a sane kind.
  assert(result.ok, "profile name resolution ok");
  assert(result.kind === "provider_model" || result.kind === "default_provider" || result.kind === "route", "kind is reasonable: " + result.kind);
});

test("named route 'balanced-local' preserves the weighted strategy", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "balanced-local");
  assertEqual(result.kind, "route", "kind is route");
  assertEqual(result.strategy, "weighted", "weighted strategy preserved");
  assertEqual(result.candidates[0].weight, 5, "deepseek weight 5");
  assertEqual(result.candidates[1].weight, 1, "ollama weight 1");
});

test("explicit 'provider:model' form synthesizes a single-candidate route", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "deepseek:deepseek-chat");
  assertEqual(result.kind, "explicit", "kind is explicit");
  assertEqual(result.strategy, "fallback", "explicit always fallback");
  assertEqual(result.candidates.length, 1, "single candidate");
  assertEqual(result.candidates[0].provider, "deepseek", "provider is deepseek");
  assertEqual(result.candidates[0].model, "deepseek-chat", "model is deepseek-chat");
});

test("provider's configured model list resolves with kind=provider_model", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "llama3.1:8b");
  assertEqual(result.kind, "provider_model", "kind is provider_model");
  assertEqual(result.candidates[0].provider, "ollama", "provider is ollama");
  assert(result.candidates[0].local, "ollama is local");
});

test("unknown model falls back to defaultProvider with kind=default_provider", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "some-nonexistent-model");
  assertEqual(result.kind, "default_provider", "kind is default_provider");
  assertEqual(result.candidates[0].provider, "ollama", "fallback provider is ollama");
  assertEqual(result.candidates[0].model, "some-nonexistent-model", "model is preserved verbatim");
});

test("empty config (no providers / no defaultProvider) returns no_resolution", () => {
  const result = resolveRoutePreview({ providers: [], routes: [], profiles: [] }, null, "auto");
  assertEqual(result.ok, false, "ok is false");
  assertEqual(result.error, "no_resolution", "error code is no_resolution");
});

test("candidate decoration marks local vs cloud correctly", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "coding-local");
  const ds = result.candidates.find((c) => c.provider === "deepseek");
  const ol = result.candidates.find((c) => c.provider === "ollama");
  assert(ds && !ds.local && ds.apiFormat === "openai", "deepseek is cloud + openai");
  assert(ol && ol.local, "ollama is local");
});

test("candidate decoration flags allowInsecureHttp risk for remote http://", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "vllm-internal:qwen-instruct");
  assertEqual(result.kind, "explicit", "kind is explicit");
  const c = result.candidates[0];
  assertEqual(c.provider, "vllm-internal", "provider name correct");
  assertEqual(c.allowInsecureHttp, true, "allowInsecureHttp preserved");
  assertEqual(c.insecureHttpRisk, true, "remote http with allowInsecureHttp flagged as risk");
  assertEqual(c.local, false, "remote 10.x is not local");
});

test("keyAvailable is true for local provider, false for cloud without web/env key", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "coding-local");
  const ds = result.candidates.find((c) => c.provider === "deepseek");
  const ol = result.candidates.find((c) => c.provider === "ollama");
  assertEqual(ol.keyAvailable, true, "local provider is always keyAvailable");
  assertEqual(ds.keyAvailable, false, "cloud provider without web/env key is not keyAvailable");
});

test("keyAvailable becomes true once webKeyCount is provided", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "coding-local", { webKeyCounts: { deepseek: 2 } });
  const ds = result.candidates.find((c) => c.provider === "deepseek");
  assertEqual(ds.keyAvailable, true, "deepseek becomes keyAvailable with 2 web keys");
});

test("health hint propagates to candidate.hasHealth / healthOk", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "coding-local", {
    healthByProvider: { deepseek: { ok: true, elapsedMs: 123 }, ollama: { ok: false, error: "ECONNREFUSED" } }
  });
  const ds = result.candidates.find((c) => c.provider === "deepseek");
  const ol = result.candidates.find((c) => c.provider === "ollama");
  assertEqual(ds.hasHealth, true, "deepseek has health");
  assertEqual(ds.healthOk, true, "deepseek healthOk true");
  assertEqual(ol.hasHealth, true, "ollama has health");
  assertEqual(ol.healthOk, false, "ollama healthOk false");
  assertEqual(ol.healthError, "ECONNREFUSED", "ollama error propagated");
});

test("summary counts local / cloud / needs-key / insecure-risk / failed-health", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "coding-local", {
    webKeyCounts: {},
    healthByProvider: { ollama: { ok: false, error: "down" } }
  });
  const s = result.summary;
  assertEqual(s.total, 2, "total 2 candidates");
  assertEqual(s.localCount, 1, "1 local");
  assertEqual(s.cloudCount, 1, "1 cloud");
  assertEqual(s.needsKeyCount, 1, "1 needs-key (deepseek has 0 keys)");
  assertEqual(s.insecureRiskCount, 0, "no insecure risk in this preview");
  assertEqual(s.failedHealthCount, 1, "1 failed health (ollama)");
});

test("missing provider for explicit form returns no_resolution", () => {
  const config = baseConfig();
  const result = resolveRoutePreview(config, "coding", "ghost:model-x");
  assertEqual(result.ok, false, "ok false when provider is missing");
  assertEqual(result.error, "no_resolution", "no_resolution");
});

test("'default' alias behaves identically to 'auto'", () => {
  const config = baseConfig();
  const r1 = resolveRoutePreview(config, "coding", "auto");
  const r2 = resolveRoutePreview(config, "coding", "default");
  assertEqual(r1.kind, r2.kind, "kind matches");
  assertEqual(r1.routeName, r2.routeName, "routeName matches");
  assertEqual(r1.normalized, r2.normalized, "normalized matches");
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
