import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { findCombo, resolveComboRoute, validateCombos, COMBO_STRATEGIES } from "../src/combo.js";

function makeConfig(providers, combos) {
  return {
    providers: providers || [],
    combos: combos || []
  };
}

describe("combo.findCombo", () => {
  it("returns null when no combos are configured", () => {
    const config = makeConfig();
    assert.equal(findCombo("anything", config), null);
  });

  it("returns null when combos is not an array", () => {
    const config = makeConfig([], null);
    assert.equal(findCombo("test", config), null);
  });

  it("returns the matching combo by name", () => {
    const combo = { name: "smart-code", strategy: "fallback", candidates: [] };
    const config = makeConfig([{ name: "deepseek", models: ["deepseek-chat"] }], [combo]);
    assert.equal(findCombo("smart-code", config), combo);
  });

  it("returns null for non-matching model", () => {
    const config = makeConfig([{ name: "deepseek", models: ["deepseek-chat"] }], [
      { name: "smart-code", candidates: [] }
    ]);
    assert.equal(findCombo("unknown-model", config), null);
  });
});

describe("combo.resolveComboRoute", () => {
  it("returns null for null combo", () => {
    assert.equal(resolveComboRoute(null, makeConfig()), null);
  });

  it("returns null for empty candidates", () => {
    const combo = { name: "empty", strategy: "fallback", candidates: [] };
    assert.equal(resolveComboRoute(combo, makeConfig()), null);
  });

  it("resolves a simple fallback combo", () => {
    const config = makeConfig(
      [
        { name: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", models: ["deepseek-chat"] },
        { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", models: ["qwen2.5:7b"] }
      ],
      []
    );
    const combo = {
      name: "my-combo",
      strategy: "fallback",
      candidates: [
        { provider: "deepseek", model: "deepseek-chat", weight: 3, priority: 1 },
        { provider: "ollama", model: "qwen2.5:7b", weight: 1, priority: 0 }
      ]
    };
    const route = resolveComboRoute(combo, config, null, null);
    assert.ok(route);
    assert.equal(route.name, "my-combo");
    assert.equal(route.strategy, "fallback");
    assert.equal(route.combo, true);
    assert.equal(route.candidates.length, 2);
    assert.equal(route.candidates[0].model, "deepseek-chat");
    assert.equal(route.candidates[1].model, "qwen2.5:7b");
  });

  it("respects disabled candidates", () => {
    const config = makeConfig(
      [
        { name: "deepseek", models: ["deepseek-chat"] },
        { name: "ollama", models: ["qwen2.5:7b"] }
      ],
      []
    );
    const combo = {
      name: "test",
      strategy: "fallback",
      candidates: [
        { provider: "deepseek", model: "deepseek-chat", enabled: false },
        { provider: "ollama", model: "qwen2.5:7b", enabled: true }
      ]
    };
    const route = resolveComboRoute(combo, config);
    assert.ok(route);
    // Only the enabled candidate should be present
    assert.equal(route.candidates.length, 1);
    assert.equal(route.candidates[0].provider.name, "ollama");
  });
});

describe("combo.validateCombos", () => {
  it("returns valid for non-array", () => {
    const result = validateCombos(null, makeConfig());
    assert.ok(result.valid);
    assert.equal(result.errors.length, 0);
  });

  it("rejects combo without name", () => {
    const result = validateCombos([{ candidates: [{ provider: "deepseek", model: "deepseek-chat" }] }], makeConfig([{ name: "deepseek" }]));
    assert.equal(result.valid, false);
    assert.ok(result.errors.length > 0);
  });

  it("rejects unknown strategy", () => {
    const result = validateCombos([{ name: "x", strategy: "unknown", candidates: [{ provider: "deepseek", model: "x" }] }], makeConfig([{ name: "deepseek" }]));
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.includes("unknown strategy")));
  });

  it("rejects empty candidates", () => {
    const result = validateCombos([{ name: "x", candidates: [] }], makeConfig());
    assert.equal(result.valid, false);
  });
});

describe("combo.COMBO_STRATEGIES", () => {
  it("includes all expected strategies", () => {
    assert.ok(COMBO_STRATEGIES.has("fallback"));
    assert.ok(COMBO_STRATEGIES.has("round_robin"));
    assert.ok(COMBO_STRATEGIES.has("weighted_round_robin"));
  });
});
