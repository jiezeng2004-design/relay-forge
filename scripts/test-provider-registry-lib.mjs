import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ProviderRegistry, createProviderRegistry, getProviderCapabilities } from "../src/provider-registry-lib.js";

describe("ProviderRegistry", () => {
  it("registers and retrieves a provider", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "deepseek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", models: ["deepseek-chat"] });
    const p = registry.getProvider("deepseek");
    assert.ok(p);
    assert.equal(p.name, "deepseek");
    assert.equal(p.baseUrl, "https://api.deepseek.com/v1");
    assert.ok(p.capabilities.includes("openai_chat"));
    assert.ok(p.capabilities.includes("streaming"));
  });

  it("throws for invalid provider config", () => {
    const registry = new ProviderRegistry();
    assert.throws(() => registry.registerProvider(null));
    assert.throws(() => registry.registerProvider({}));
    assert.throws(() => registry.registerProvider({ name: "  " }));
  });

  it("hasProvider returns correct status", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", models: ["qwen2.5:7b"] });
    assert.ok(registry.hasProvider("ollama"));
    assert.equal(registry.hasProvider("missing"), false);
  });

  it("getAllProviders returns all entries", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "a", models: [] });
    registry.registerProvider({ name: "b", models: [] });
    assert.equal(registry.getAllProviders().length, 2);
  });

  it("findProvidersByCapability filters correctly", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "openai", baseUrl: "https://api.openai.com/v1", apiFormat: "openai", models: ["gpt-4"] });
    registry.registerProvider({ name: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiFormat: "anthropic", models: ["claude"] });
    const openaiChat = registry.findProvidersByCapability("openai_chat");
    assert.ok(openaiChat.some((p) => p.name === "openai"));
    const anthropicMsgs = registry.findProvidersByCapability("anthropic_messages");
    assert.ok(anthropicMsgs.some((p) => p.name === "anthropic"));
  });

  it("findProvidersByModel works", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "ollama", models: ["qwen2.5:7b", "llama3.1:8b"] });
    registry.registerProvider({ name: "deepseek", models: ["deepseek-chat"] });
    const found = registry.findProvidersByModel("qwen2.5:7b");
    assert.equal(found.length, 1);
    assert.equal(found[0].name, "ollama");
  });

  it("updates provider health", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "deepseek", models: ["deepseek-chat"] });
    registry.updateProviderHealth("deepseek", { ok: true, latencyMs: 150 });
    const p = registry.getProvider("deepseek");
    assert.ok(p.health);
    assert.ok(p.health.ok);
    assert.ok(p.lastCheckedAt);
    registry.updateProviderHealth("deepseek", { ok: false, error: "timeout" });
    assert.equal(registry.getProvider("deepseek").lastError, "timeout");
  });

  it("removeProvider works", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "test", models: [] });
    assert.ok(registry.hasProvider("test"));
    registry.removeProvider("test");
    assert.equal(registry.hasProvider("test"), false);
  });

  it("initFromConfig loads providers", () => {
    const registry = new ProviderRegistry();
    registry.initFromConfig([
      { name: "a", models: [] },
      { name: "b", models: [] }
    ]);
    assert.equal(registry.size, 2);
  });

  it("clear empties registry", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "x", models: [] });
    registry.clear();
    assert.equal(registry.size, 0);
  });

  it("toJSON returns serializable data", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "test", models: ["m1"] });
    const json = registry.toJSON();
    assert.equal(json.length, 1);
    assert.equal(json[0].name, "test");
  });

  it("anthropic provider gets anthropic_messages capability", () => {
    const registry = new ProviderRegistry();
    registry.registerProvider({ name: "claude", apiFormat: "anthropic", models: ["claude-sonnet"] });
    const p = registry.getProvider("claude");
    assert.ok(p.capabilities.includes("anthropic_messages"));
    assert.ok(!p.capabilities.includes("embeddings"));
  });
});

describe("createProviderRegistry", () => {
  it("creates registry from config array", () => {
    const registry = createProviderRegistry([
      { name: "ollama", models: ["qwen2.5:7b"] }
    ]);
    assert.equal(registry.size, 1);
    assert.ok(registry.hasProvider("ollama"));
  });
});

describe("getProviderCapabilities", () => {
  it("returns capability definitions", () => {
    const caps = getProviderCapabilities();
    assert.ok(Array.isArray(caps));
    assert.ok(caps.some((c) => c.key === "openai_chat"));
    assert.ok(caps.some((c) => c.key === "streaming"));
    assert.ok(caps.some((c) => c.key === "tools"));
  });
});
