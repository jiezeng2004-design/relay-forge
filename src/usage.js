// Daily / history / runtime usage tracker.
// Owns no I/O: persistence is the caller's job (so this is testable).

const LATENCY_WINDOW_SIZE = 50;
const LATENCY_DEFAULT_THRESHOLD_MS = 1500;

export class UsageTracker {
  constructor(initial, options = {}) {
    this.state = normalizeUsageState(initial);
    this.defaultRetentionDays = normalizeRetentionDays(options.retentionDays);
  }

  setRetentionDays(days) {
    this.defaultRetentionDays = normalizeRetentionDays(days);
  }

  incrementDailyTotal() {
    this.resetIfNeeded();
    this.state.daily.total += 1;
  }

  increment(kind, name) {
    this.resetIfNeeded();
    if (kind === "routes") this.state.daily.total += 1;
    this.state.daily[kind][name] = (this.state.daily[kind][name] || 0) + 1;
  }

  incrementRuntime(kind, name, field) {
    incrementNested(this.state.runtime[kind], name, field);
  }

  incrementProviderStat(name, field) {
    incrementNested(this.state.runtime.byProvider || (this.state.runtime.byProvider = {}), name, field);
  }

  // 0.5.2: record per-request latency (ring buffer per route /
  // provider / model) + token usage. Caller is `proxyWithRetry`
  // and the stream handlers.
  recordLatency(kind, name, latencyMs) {
    if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
    this.resetIfNeeded();
    if (!this.state.runtime[kind] || typeof this.state.runtime[kind] !== "object") {
      this.state.runtime[kind] = {};
    }
    const bucket = ensureLatencyBucket(this.state.runtime[kind], name);
    if (!Array.isArray(bucket.latencies)) {
      // Legacy bucket shape: re-seed the latencies array. Other
      // fields (samples / tokens) are preserved.
      bucket.latencies = [];
    }
    // 0.5.3 fix: counters could be `undefined` or `null` when
    // a sibling code path (e.g. incrementProvider) created the
    // bucket with a different shape. `undefined + 1` yields
    // NaN, which then serializes as `null` in /admin/status
    // and breaks the Dashboard's p50/p95 panels. Initialize
    // to 0 if not already a finite number.
    if (typeof bucket.samples !== "number" || !Number.isFinite(bucket.samples)) bucket.samples = 0;
    if (typeof bucket.totalLatencyMs !== "number" || !Number.isFinite(bucket.totalLatencyMs)) bucket.totalLatencyMs = 0;
    bucket.latencies.push(Math.floor(latencyMs));
    if (bucket.latencies.length > LATENCY_WINDOW_SIZE) {
      bucket.latencies.splice(0, bucket.latencies.length - LATENCY_WINDOW_SIZE);
    }
    bucket.samples += 1;
    bucket.totalLatencyMs += Math.floor(latencyMs);
  }

  recordTokens(kind, name, promptTokens, completionTokens) {
    if (!Number.isFinite(promptTokens) && !Number.isFinite(completionTokens)) return;
    this.resetIfNeeded();
    if (!this.state.runtime[kind] || typeof this.state.runtime[kind] !== "object") {
      this.state.runtime[kind] = {};
    }
    const bucket = ensureLatencyBucket(this.state.runtime[kind], name);
    if (!Array.isArray(bucket.latencies)) bucket.latencies = [];
    if (typeof bucket.promptTokens !== "number") bucket.promptTokens = 0;
    if (typeof bucket.completionTokens !== "number") bucket.completionTokens = 0;
    if (typeof bucket.samples !== "number") bucket.samples = 0;
    if (typeof bucket.totalLatencyMs !== "number") bucket.totalLatencyMs = 0;
    bucket.promptTokens += Math.max(0, Number(promptTokens) || 0);
    bucket.completionTokens += Math.max(0, Number(completionTokens) || 0);
  }

  resetIfNeeded() {
    const today = currentDay();
    if (this.state.day === today) return;
    archiveDailyUsage(this.state, this.defaultRetentionDays);
    this.state.day = today;
    this.state.daily = { total: 0, routes: {}, providers: {}, models: {} };
  }

  day() {
    return this.state.day;
  }

  current() {
    return this.state;
  }

  // 0.5.2: build a {route, provider, model} -> {p50, p95, samples, ...}
  // summary. p50 / p95 are computed from the per-name latency
  // ring buffer. Token totals are summed across all requests in
  // the current process lifetime (no per-day breakdown — daily
  // totals are in `daily`, runtime gives the live p50/p95 view).
  // A bucket shows up if it has either latency samples OR token
  // totals; empty buckets are skipped.
  metrics() {
    this.resetIfNeeded();
    const result = { byRoute: {}, byProvider: {}, byModel: {} };
    for (const kind of ["byRoute", "byProvider", "byModel"]) {
      const src = this.state.runtime[kind] || {};
      for (const [name, bucket] of Object.entries(src)) {
        if (!bucket || typeof bucket !== "object") continue;
        const hasLatency = Array.isArray(bucket.latencies) && bucket.latencies.length > 0;
        const hasTokens = (bucket.promptTokens || 0) + (bucket.completionTokens || 0) > 0;
        if (!hasLatency && !hasTokens) continue;
        let p50 = 0, p95 = 0, minMs = 0, maxMs = 0;
        if (hasLatency) {
          const sorted = bucket.latencies.slice().sort((a, b) => a - b);
          p50 = percentile(sorted, 0.5);
          p95 = percentile(sorted, 0.95);
          minMs = sorted[0];
          maxMs = sorted[sorted.length - 1];
        }
        result[kind][name] = {
          samples: bucket.samples || 0,
          avgLatencyMs: bucket.samples > 0 ? Math.round(bucket.totalLatencyMs / bucket.samples) : 0,
          p50LatencyMs: p50,
          p95LatencyMs: p95,
          minLatencyMs: minMs,
          maxLatencyMs: maxMs,
          promptTokens: bucket.promptTokens || 0,
          completionTokens: bucket.completionTokens || 0,
          totalTokens: (bucket.promptTokens || 0) + (bucket.completionTokens || 0)
        };
      }
    }
    return result;
  }

  summary(retentionDays) {
    this.resetIfNeeded();
    const days = normalizeRetentionDays(retentionDays || this.defaultRetentionDays);
    trimHistory(this.state, days);
    const todayRecord = normalizeHistoryRecord({
      day: this.state.day,
      total: this.state.daily.total || 0,
      routes: this.state.daily.routes || {},
      providers: this.state.daily.providers || {},
      models: this.state.daily.models || {}
    });
    const records = this.state.history.filter((item) => item.day !== this.state.day);
    records.push(todayRecord);
    records.sort((a, b) => a.day.localeCompare(b.day));
    return {
      day: this.state.day,
      daily: this.state.daily,
      history: records,
      runtime: this.state.runtime,
      metrics: this.metrics()
    };
  }
}

function normalizeRetentionDays(value) {
  return Math.max(1, Math.min(365, Number(value || 14)));
}

function incrementNested(bucket, name, field) {
  if (!bucket[name]) bucket[name] = {};
  bucket[name][field] = (bucket[name][field] || 0) + 1;
}

function createUsageState() {
  return {
    day: currentDay(),
    daily: { total: 0, routes: {}, providers: {}, models: {} },
    history: [],
    runtime: { byRoute: {}, byModel: {}, byProvider: {} }
  };
}

function percentile(sortedAsc, p) {
  if (!sortedAsc || sortedAsc.length === 0) return 0;
  if (p <= 0) return sortedAsc[0];
  if (p >= 1) return sortedAsc[sortedAsc.length - 1];
  const idx = (sortedAsc.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return Math.round(sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w);
}

function normalizeUsageState(state) {
  const usageState = createUsageState();
  if (!state || typeof state !== "object") return usageState;
  usageState.day = state.day || usageState.day;
  usageState.daily = {
    total: Number(state.daily?.total || 0),
    routes: normalizeCountMap(state.daily?.routes),
    providers: normalizeCountMap(state.daily?.providers),
    models: normalizeCountMap(state.daily?.models)
  };
  usageState.history = Array.isArray(state.history) ? state.history.map(normalizeHistoryRecord).filter(Boolean) : [];
  usageState.runtime = {
    byRoute: normalizeRuntimeMap(state.runtime?.byRoute),
    byModel: normalizeRuntimeMap(state.runtime?.byModel),
    byProvider: normalizeRuntimeMap(state.runtime?.byProvider)
  };
  return usageState;
}

// 0.5.2: runtime buckets now carry latency ring buffers + token
// totals. We tolerate old persisted state where the bucket is a
// plain count map (no latencies / tokens yet).
function normalizeRuntimeMap(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [name, bucket] of Object.entries(value)) {
    if (!bucket || typeof bucket !== "object") continue;
    if (Array.isArray(bucket)) {
      // Legacy shape (count map). Convert to empty runtime bucket.
      result[name] = makeRuntimeBucket();
      continue;
    }
    result[name] = {
      latencies: Array.isArray(bucket.latencies) ? bucket.latencies.map((n) => Math.max(0, Math.floor(Number(n) || 0))).slice(-LATENCY_WINDOW_SIZE) : [],
      samples: Math.max(0, Math.floor(Number(bucket.samples || 0))),
      totalLatencyMs: Math.max(0, Math.floor(Number(bucket.totalLatencyMs || 0))),
      promptTokens: Math.max(0, Math.floor(Number(bucket.promptTokens || 0))),
      completionTokens: Math.max(0, Math.floor(Number(bucket.completionTokens || 0)))
    };
  }
  return result;
}

function makeRuntimeBucket() {
  return {
    latencies: [],
    samples: 0,
    totalLatencyMs: 0,
    promptTokens: 0,
    completionTokens: 0
  };
}

function ensureLatencyBucket(parent, name) {
  if (!parent[name] || typeof parent[name] !== "object") {
    parent[name] = makeRuntimeBucket();
  }
  return parent[name];
}

function normalizeHistoryRecord(record) {
  if (!record || typeof record !== "object" || !record.day) return null;
  return {
    day: String(record.day).slice(0, 10),
    total: Number(record.total || record.daily?.total || 0),
    routes: normalizeCountMap(record.routes || record.daily?.routes),
    providers: normalizeCountMap(record.providers || record.daily?.providers),
    models: normalizeCountMap(record.models || record.daily?.models)
  };
}

function normalizeCountMap(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [name, count] of Object.entries(value)) {
    const numberValue = Number(count || 0);
    if (Number.isFinite(numberValue) && numberValue > 0) result[name] = numberValue;
  }
  return result;
}

function normalizeNestedCountMap(value) {
  const result = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return result;
  for (const [name, counts] of Object.entries(value)) {
    result[name] = normalizeCountMap(counts);
  }
  return result;
}

function archiveDailyUsage(state, retentionDays) {
  if (!state.day) return;
  const hasUsage =
    Number(state.daily?.total || 0) > 0 ||
    Object.keys(state.daily?.routes || {}).length > 0 ||
    Object.keys(state.daily?.providers || {}).length > 0 ||
    Object.keys(state.daily?.models || {}).length > 0;
  if (!hasUsage) return;

  const record = normalizeHistoryRecord({
    day: state.day,
    total: state.daily.total || 0,
    routes: state.daily.routes || {},
    providers: state.daily.providers || {},
    models: state.daily.models || {}
  });
  state.history = state.history.filter((item) => item.day !== record.day);
  state.history.push(record);
  trimHistory(state, retentionDays);
}

function trimHistory(state, retentionDays) {
  const days = Math.max(1, Math.min(365, Number(retentionDays || 14)));
  state.history = state.history
    .filter(Boolean)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-days);
}

function currentDay() {
  return new Date().toISOString().slice(0, 10);
}
