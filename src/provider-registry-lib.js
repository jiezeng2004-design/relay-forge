const PROVIDER_CAPABILITIES = {
  openai_chat: { key: "openai_chat", description: "OpenAI-compatible chat completions" },
  anthropic_messages: { key: "anthropic_messages", description: "Anthropic Messages API" },
  responses: { key: "responses", description: "OpenAI Responses API" },
  embeddings: { key: "embeddings", description: "Text embeddings" },
  streaming: { key: "streaming", description: "Server-sent event streaming" },
  tools: { key: "tools", description: "Tool/function calling" },
  vision: { key: "vision", description: "Vision/image input" }
};

const API_FORMAT_CAPABILITIES = {
  openai: ["openai_chat", "responses", "streaming", "tools", "embeddings"],
  anthropic: ["anthropic_messages", "streaming", "tools", "vision"]
};

export class ProviderRegistry {
  constructor() {
    this._providers = new Map();
  }

  registerProvider(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Invalid provider config: must be a non-null object");
    }
    const name = String(config.name || "").trim();
    if (!name) {
      throw new Error("Provider name is required");
    }
    const capabilities = resolveCapabilities(config);
    const entry = {
      name,
      displayName: config.displayName || config.name,
      baseUrl: String(config.baseUrl || ""),
      apiFormat: String(config.apiFormat || "openai"),
      keyEnv: config.keyEnv || null,
      models: Array.isArray(config.models) ? [...config.models] : [],
      allowInsecureHttp: config.allowInsecureHttp === true,
      capabilities,
      health: null,
      lastError: null,
      lastCheckedAt: null,
      extraHeaders: config.extraHeaders || null,
      balanceEndpoint: config.balanceEndpoint || null,
      anthropicVersion: config.anthropicVersion || null
    };
    this._providers.set(name, entry);
    return entry;
  }

  getProvider(name) {
    return this._providers.get(name) || null;
  }

  hasProvider(name) {
    return this._providers.has(name);
  }

  getAllProviders() {
    return Array.from(this._providers.values());
  }

  findProvidersByCapability(capability) {
    const cap = String(capability).toLowerCase();
    return this.getAllProviders().filter((p) => p.capabilities.includes(cap));
  }

  findProvidersByModel(model) {
    return this.getAllProviders().filter((p) => p.models.includes(model));
  }

  findProvidersByApiFormat(format) {
    return this.getAllProviders().filter((p) => p.apiFormat === format);
  }

  updateProviderHealth(name, health) {
    const provider = this._providers.get(name);
    if (!provider) return;
    provider.health = health;
    provider.lastCheckedAt = new Date().toISOString();
    if (health && !health.ok) {
      provider.lastError = health.error || health.message || null;
    }
  }

  removeProvider(name) {
    return this._providers.delete(name);
  }

  clear() {
    this._providers.clear();
  }

  get size() {
    return this._providers.size;
  }

  initFromConfig(configProviders) {
    this.clear();
    if (!Array.isArray(configProviders)) return;
    for (const p of configProviders) {
      try {
        this.registerProvider(p);
      } catch {
      }
    }
  }

  toJSON() {
    return this.getAllProviders().map((p) => ({
      ...p,
      capabilities: [...p.capabilities]
    }));
  }
}

function resolveCapabilities(config) {
  const format = String(config.apiFormat || "openai");
  const base = API_FORMAT_CAPABILITIES[format] || API_FORMAT_CAPABILITIES.openai;
  const caps = new Set(base);

  if (config.capabilities && Array.isArray(config.capabilities)) {
    for (const c of config.capabilities) {
      const key = String(c).toLowerCase();
      if (PROVIDER_CAPABILITIES[key]) {
        caps.add(key);
      }
    }
  }

  if (config.apiFormat === "anthropic") {
    caps.delete("embeddings");
  }

  return Array.from(caps).sort();
}

export function createProviderRegistry(configProviders) {
  const registry = new ProviderRegistry();
  registry.initFromConfig(configProviders);
  return registry;
}

export function getProviderCapabilities() {
  return Object.values(PROVIDER_CAPABILITIES);
}
