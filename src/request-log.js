const MAX_RECENT_REQUESTS = 20;

export class RequestLog {
  constructor(maxSize = MAX_RECENT_REQUESTS) {
    this._maxSize = maxSize;
    this._entries = [];
  }

  record(meta) {
    const entry = {
      timestamp: meta.timestamp || new Date().toISOString(),
      method: meta.method || "POST",
      path: meta.path || "/v1/chat/completions",
      model: meta.model || "unknown",
      provider: meta.provider || "unknown",
      elapsedMs: typeof meta.elapsedMs === "number" ? meta.elapsedMs : 0,
      status: typeof meta.status === "number" ? meta.status : 0,
      errorCategory: meta.errorCategory || null,
      promptLength: typeof meta.promptLength === "number" ? meta.promptLength : 0,
      attempt: typeof meta.attempt === "number" ? meta.attempt : 1
    };
    this._entries.unshift(entry);
    if (this._entries.length > this._maxSize) {
      this._entries.length = this._maxSize;
    }
    return entry;
  }

  recent(count) {
    const n = Math.min(count || this._maxSize, this._entries.length);
    return this._entries.slice(0, n);
  }

  reset() {
    this._entries = [];
  }

  toJSON() {
    return this._entries.slice();
  }

  get size() {
    return this._entries.length;
  }
}

export function computeStats(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      total: 0,
      success: 0,
      failed: 0,
      avgLatencyMs: 0,
      byModel: {},
      byProvider: {},
      byError: {}
    };
  }
  const stats = {
    total: entries.length,
    success: 0,
    failed: 0,
    totalLatencyMs: 0,
    byModel: {},
    byProvider: {},
    byError: {}
  };
  for (const e of entries) {
    if (e.status >= 200 && e.status < 300) {
      stats.success += 1;
    } else if (e.status > 0) {
      stats.failed += 1;
    }
    stats.totalLatencyMs += e.elapsedMs || 0;
    if (e.model) {
      stats.byModel[e.model] = (stats.byModel[e.model] || 0) + 1;
    }
    if (e.provider) {
      stats.byProvider[e.provider] = (stats.byProvider[e.provider] || 0) + 1;
    }
    if (e.errorCategory) {
      stats.byError[e.errorCategory] = (stats.byError[e.errorCategory] || 0) + 1;
    }
  }
  stats.avgLatencyMs = stats.total > 0 ? Math.round(stats.totalLatencyMs / stats.total) : 0;
  return stats;
}
