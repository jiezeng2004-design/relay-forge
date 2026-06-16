export const COMBO_STRATEGIES = new Set(["fallback", "round_robin", "weighted_round_robin"]);

export function findCombo(model, config) {
  const combos = config.combos;
  if (!Array.isArray(combos) || combos.length === 0) return null;
  const requested = String(model || "").trim();
  if (!requested) return null;
  return combos.find((c) => c.name === requested) || null;
}

export function resolveComboRoute(combo, config, providerHealth, routeRuntime) {
  if (!combo || typeof combo !== "object") return null;
  const candidates = resolveComboCandidates(combo, config);
  if (candidates.length === 0) return null;
  const strategy = COMBO_STRATEGIES.has(combo.strategy) ? combo.strategy : "fallback";
  const ordered = applyComboStrategy(candidates, strategy, combo.name, providerHealth, routeRuntime);
  return {
    name: combo.name,
    strategy,
    combo: true,
    limits: combo.limits || {},
    candidates: ordered.map((c) => ({
      provider: c._providerRef,
      model: c.model,
      weight: c.weight || 1
    })),
    _fallbackChain: ordered.map((c) => `${c._providerRef?.name || "?"}:${c.model}`)
  };
}

function resolveComboCandidates(combo, config) {
  const candidates = combo.candidates || [];
  const resolved = [];
  for (const c of candidates) {
    if (c.enabled === false) continue;
    const provider = (config.providers || []).find((p) => p.name === c.provider);
    if (!provider) continue;
    resolved.push({
      provider: c.provider,
      model: c.model,
      weight: typeof c.weight === "number" && c.weight > 0 ? c.weight : 1,
      priority: typeof c.priority === "number" ? c.priority : 0,
      enabled: c.enabled !== false,
      _providerRef: provider
    });
  }
  return resolved.sort((a, b) => b.priority - a.priority);
}

function applyComboStrategy(candidates, strategy, comboName, providerHealth, routeRuntime) {
  if (candidates.length <= 1) return candidates;
  const healthy = filterHealthy(candidates, providerHealth);
  const pool = healthy.length > 0 ? healthy : candidates;
  if (strategy === "fallback") return pool;
  if (strategy === "round_robin") {
    const state = getComboState(comboName, routeRuntime);
    const index = state.rrIndex % pool.length;
    state.rrIndex += 1;
    return [...pool.slice(index), ...pool.slice(0, index)];
  }
  if (strategy === "weighted_round_robin") {
    const state = getComboState(comboName, routeRuntime);
    const totalWeight = pool.reduce((s, c) => s + c.weight, 0);
    const cursor = (state.wrCursor % totalWeight) + 1;
    state.wrCursor += 1;
    let running = 0;
    const idx = pool.findIndex((c) => {
      running += c.weight;
      return cursor <= running;
    });
    const start = Math.max(0, idx);
    return [...pool.slice(start), ...pool.slice(0, start)];
  }
  return pool;
}

function filterHealthy(candidates, providerHealth) {
  if (!providerHealth || typeof providerHealth.isUnhealthy !== "function") {
    return candidates;
  }
  return candidates.filter((c) => !providerHealth.isUnhealthy(c.provider));
}

function getComboState(comboName, routeRuntime) {
  if (!routeRuntime) return { rrIndex: 0, wrCursor: 0 };
  if (!routeRuntime.has(`__combo:${comboName}`)) {
    routeRuntime.set(`__combo:${comboName}`, { rrIndex: 0, wrCursor: 0 });
  }
  return routeRuntime.get(`__combo:${comboName}`);
}

export function validateCombos(combos, config) {
  if (!Array.isArray(combos)) return { valid: true, errors: [] };
  const errors = [];
  for (let i = 0; i < combos.length; i++) {
    const c = combos[i];
    if (!c.name || typeof c.name !== "string" || !c.name.trim()) {
      errors.push(`combos[${i}]: name is required`);
    }
    if (c.strategy && !COMBO_STRATEGIES.has(c.strategy)) {
      errors.push(`combos[${i}]: unknown strategy "${c.strategy}" (must be one of: ${Array.from(COMBO_STRATEGIES).join(", ")})`);
    }
    if (!Array.isArray(c.candidates) || c.candidates.length === 0) {
      errors.push(`combos[${i}]: at least one candidate is required`);
    } else {
      for (let j = 0; j < c.candidates.length; j++) {
        const cand = c.candidates[j];
        if (!cand.provider) {
          errors.push(`combos[${i}].candidates[${j}]: provider is required`);
        } else if (config && !config.providers.find((p) => p.name === cand.provider)) {
          errors.push(`combos[${i}].candidates[${j}]: provider "${cand.provider}" not found in config`);
        }
        if (!cand.model) {
          errors.push(`combos[${i}].candidates[${j}]: model is required`);
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
