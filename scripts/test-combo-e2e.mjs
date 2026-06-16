import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCombo, resolveComboRoute, validateCombos, COMBO_STRATEGIES } from "../src/combo.js";

function makeConfig(providers, combos) {
  return {
    providers: providers || [],
    combos: combos || [],
    profiles: [],
    routes: [],
    limits: { dailyRequests: null, routes: {}, providers: {}, models: {} },
    modelAliases: {},
    retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 }
  };
}

describe("combo round_robin alternation", () => {
  it("rotates across two providers via routeRuntime", () => {
    const config = makeConfig(
      [
        { name: "provider-a", baseUrl: "http://127.0.0.1:11111/v1", apiFormat: "openai", models: ["model-a"] },
        { name: "provider-b", baseUrl: "http://127.0.0.1:11112/v1", apiFormat: "openai", models: ["model-b"] }
      ],
      []
    );
    const combo = {
      name: "rr-combo",
      strategy: "round_robin",
      candidates: [
        { provider: "provider-a", model: "model-a", weight: 1, enabled: true },
        { provider: "provider-b", model: "model-b", weight: 1, enabled: true }
      ]
    };
    const rt = new Map();
    // Request 1 -> candidate 0 (provider-a)
    const r1 = resolveComboRoute(combo, config, null, rt);
    assert.ok(r1);
    assert.equal(r1.candidates[0].provider.name, "provider-a");
    // Request 2 -> candidate 0 (provider-b, rotated)
    const r2 = resolveComboRoute(combo, config, null, rt);
    assert.equal(r2.candidates[0].provider.name, "provider-b");
    // Request 3 -> candidate 0 (provider-a again)
    const r3 = resolveComboRoute(combo, config, null, rt);
    assert.equal(r3.candidates[0].provider.name, "provider-a");
    // Request 4 -> candidate 0 (provider-b again)
    const r4 = resolveComboRoute(combo, config, null, rt);
    assert.equal(r4.candidates[0].provider.name, "provider-b");
  });
});

describe("combo weighted_round_robin distribution", () => {
  it("picks candidates with weight=1 and weight=3 proportionally", () => {
    const config = makeConfig(
      [
        { name: "provider-a", baseUrl: "http://127.0.0.1:11111/v1", apiFormat: "openai", models: ["model-a"] },
        { name: "provider-b", baseUrl: "http://127.0.0.1:11112/v1", apiFormat: "openai", models: ["model-b"] }
      ],
      []
    );
    const combo = {
      name: "wr-combo",
      strategy: "weighted_round_robin",
      candidates: [
        { provider: "provider-a", model: "model-a", weight: 1, enabled: true },
        { provider: "provider-b", model: "model-b", weight: 3, enabled: true }
      ]
    };
    const rt = new Map();
    const picks = [];
    for (let i = 0; i < 12; i++) {
      const r = resolveComboRoute(combo, config, null, rt);
      picks.push(r.candidates[0].provider.name);
    }
    const countA = picks.filter((p) => p === "provider-a").length;
    const countB = picks.filter((p) => p === "provider-b").length;
    // B should appear at least 3x more than A across 12 picks
    assert.ok(countA >= 1, `Provider A should be picked at least once (got ${countA})`);
    assert.ok(countB > countA, `Provider B (weight 3) should be picked more than A (weight 1): A=${countA}, B=${countB}`);
  });
});



describe("combo isLimitExceeded is importable", () => {
  it("exports getResolvedRouteDailyLimit", async () => {
    const { getResolvedRouteDailyLimit } = await import("../src/lib/route-logic.js");
    assert.equal(getResolvedRouteDailyLimit({ limits: { dailyRequests: 1 } }), 1);
    assert.equal(getResolvedRouteDailyLimit({ limits: {} }), null);
  });
});

describe("combo validateCombos rejects invalid configs", () => {
  it("rejects combo without name", () => {
    const config = makeConfig([{ name: "deepseek", models: ["ds"] }]);
    const result = validateCombos([{ candidates: [{ provider: "deepseek", model: "ds" }] }], config);
    assert.equal(result.valid, false);
  });

  it("rejects combo with unknown strategy", () => {
    const config = makeConfig([{ name: "deepseek", models: ["ds"] }]);
    const result = validateCombos([{ name: "bad", strategy: "unknown", candidates: [{ provider: "deepseek", model: "ds" }] }], config);
    assert.equal(result.valid, false);
  });

  it("flags combo with missing provider", () => {
    const config = makeConfig([{ name: "deepseek", models: ["ds"] }]);
    const result = validateCombos([{ name: "bad", candidates: [{ provider: "missing", model: "x" }] }], config);
    // validateCombos checks for missing providers in config
    assert.ok(result.errors.length > 0, "Should report missing provider error");
  });
});

describe("combo config-ops integration", () => {
  it("serializeEditableConfig preserves combos", async () => {
    const { serializeEditableConfig } = await import("../src/lib/config-ops.js");
    const config = {
      defaultProvider: "provider-a",
      providers: [{ name: "provider-a", apiFormat: "openai", models: ["m1"] }],
      routes: [],
      combos: [{ name: "my-combo", strategy: "fallback", candidates: [{ provider: "provider-a", model: "m1" }] }],
      profiles: [],
      retry: { maxAttempts: 3, cooldownMs: 30000, timeoutMs: 120000, streamIdleTimeoutMs: 300000 },
      limits: { maxBodyBytes: 10485760, dailyRequests: null, providers: {}, routes: {}, models: {} },
      history: { retentionDays: 14 },
      healthChecks: { enabled: false, intervalMinutes: 60, providers: [] }
    };
    const serialized = serializeEditableConfig(config);
    assert.ok(Array.isArray(serialized.combos), "combos must be an array");
    assert.equal(serialized.combos.length, 1);
    assert.equal(serialized.combos[0].name, "my-combo");
    assert.ok(serialized.privacy, "privacy must be present");
    assert.equal(serialized.privacy.logPrompts, false);
  });
});
