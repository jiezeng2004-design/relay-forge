import { createHash, randomUUID } from "node:crypto";

export class KeyPool {
  constructor(providers, getKeys, cooldownMs, options = {}) {
    this.cooldownMs = cooldownMs;
    this.getKeys = getKeys;
    this.secretStore = options.secretStore || null;
    this.state = new Map();
    this.reload(providers);
  }

  reload(providers) {
    this.state.clear();
    for (const provider of providers) {
      const envValues = this.getKeys(provider) || [];
      const webValues = this.secretStore
        ? this.secretStore.getDecryptedValuesForProvider(provider.name)
        : [];
      const seen = new Set();
      const keys = [];
      // Web keys first so they get priority in round-robin.
      for (const web of webValues) {
        if (seen.has(web.hash)) continue;
        seen.add(web.hash);
        keys.push({
          value: web.value,
          source: "web",
          sourceId: web.id,
          label: web.label || web.hash,
          hash: web.hash,
          cooldownUntil: 0,
          uses: 0,
          failures: 0
        });
      }
      for (const envValue of envValues) {
        // null / undefined / empty values are intentional no-auth
        // sentinels (e.g. the local Ollama provider with keyEnv: null).
        // We still emit a key record so the proxy can call the
        // upstream without an Authorization header.
        if (envValue === null || envValue === undefined || envValue === "") {
          if (seen.has("no-auth")) continue;
          seen.add("no-auth");
          keys.push({
            value: null,
            source: "no-auth",
            sourceId: null,
            label: "no-auth",
            hash: "no-auth",
            cooldownUntil: 0,
            uses: 0,
            failures: 0
          });
          continue;
        }
        const hash = hashKey(envValue);
        if (seen.has(hash)) continue;
        seen.add(hash);
        keys.push({
          value: envValue,
          source: "env",
          sourceId: null,
          label: maskKey(envValue),
          hash,
          cooldownUntil: 0,
          uses: 0,
          failures: 0
        });
      }
      this.state.set(provider.name, { index: 0, keys });
    }
  }

  next(providerName) {
    const state = this.state.get(providerName);
    if (!state || state.keys.length === 0) return null;

    const now = Date.now();
    for (let checked = 0; checked < state.keys.length; checked += 1) {
      const idx = state.index % state.keys.length;
      state.index += 1;
      const key = state.keys[idx];
      if (key.cooldownUntil <= now) {
        key.uses += 1;
        if (key.source === "web" && this.secretStore && key.sourceId) {
          this.secretStore.markUsed(key.sourceId);
        }
        return key;
      }
    }
    return null;
  }

  markFailure(providerName, key, shouldCooldown) {
    if (!key) return;
    // A no-auth sentinel has no real key to fail; counting it would
    // just confuse the Key Pool summary.
    if (key.source === "no-auth") return;
    key.failures += 1;
    if (shouldCooldown) {
      key.cooldownUntil = Date.now() + this.cooldownMs;
    }
    const state = this.state.get(providerName);
    if (state && state.keys.length > 0 && state.keys.every((item) => item.cooldownUntil > Date.now())) {
      const oldest = state.keys.reduce((left, right) =>
        left.cooldownUntil <= right.cooldownUntil ? left : right
      );
      oldest.cooldownUntil = Date.now();
    }
  }

  // Refresh only one provider. Used after web add / update / remove so
  // the next request sees the new key list without a full config reload.
  refreshProvider(providerName) {
    const provider = (this.getKeys && this._providers) || null;
    if (!provider) return;
    // We don't have a direct provider reference here; full reload
    // through reload() is the safe path. Callers that have the full
    // providers list should use reload().
  }

  summary() {
    const result = {};
    for (const [providerName, state] of this.state.entries()) {
      result[providerName] = state.keys.map((key) => ({
        label: key.label,
        hash: key.hash,
        source: key.source,
        sourceId: key.sourceId,
        uses: key.uses,
        failures: key.failures,
        coolingDown: key.cooldownUntil > Date.now(),
        cooldownUntil: key.cooldownUntil || null
      }));
    }
    return result;
  }
}

function maskKey(value) {
  if (value.length <= 10) return "***";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function hashKey(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}
