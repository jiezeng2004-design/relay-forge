import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RequestLog, computeStats } from "../src/request-log.js";

describe("RequestLog", () => {
  it("records and returns recent entries", () => {
    const log = new RequestLog(5);
    log.record({ model: "gpt-4", provider: "openai", elapsedMs: 100, status: 200 });
    assert.equal(log.size, 1);
    const recent = log.recent(5);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].model, "gpt-4");
    assert.equal(recent[0].provider, "openai");
  });

  it("respects max size", () => {
    const log = new RequestLog(3);
    for (let i = 0; i < 10; i++) {
      log.record({ model: `m${i}`, elapsedMs: i * 10, status: 200 });
    }
    assert.equal(log.size, 3);
    const recent = log.recent(10);
    assert.equal(recent.length, 3);
    assert.equal(recent[0].model, "m9");
  });

  it("uses default values for missing fields", () => {
    const log = new RequestLog();
    log.record({});
    const entry = log.recent(1)[0];
    assert.equal(entry.method, "POST");
    assert.equal(entry.model, "unknown");
    assert.equal(entry.elapsedMs, 0);
    assert.equal(entry.status, 0);
  });

  it("reset clears all entries", () => {
    const log = new RequestLog();
    log.record({ model: "gpt-4", status: 200 });
    log.reset();
    assert.equal(log.size, 0);
  });

  it("toJSON returns a copy of entries", () => {
    const log = new RequestLog();
    log.record({ model: "test", status: 200 });
    const json = log.toJSON();
    assert.equal(json.length, 1);
    // Modifying json should not affect log
    json.pop();
    assert.equal(log.size, 1);
  });
});

describe("computeStats", () => {
  it("returns zeros for empty array", () => {
    const stats = computeStats([]);
    assert.equal(stats.total, 0);
    assert.equal(stats.success, 0);
    assert.equal(stats.failed, 0);
  });

  it("computes success/fail counts", () => {
    const entries = [
      { status: 200, model: "gpt-4", provider: "openai" },
      { status: 200, model: "gpt-4", provider: "openai" },
      { status: 500, model: "claude", provider: "anthropic", errorCategory: "upstream_5xx" },
      { status: 429, model: "gpt-4", provider: "openai", errorCategory: "upstream_429" }
    ];
    const stats = computeStats(entries);
    assert.equal(stats.total, 4);
    assert.equal(stats.success, 2);
    assert.equal(stats.failed, 2);
    assert.equal(stats.byModel["gpt-4"], 3);
    assert.equal(stats.byProvider["openai"], 3);
    assert.equal(stats.byError["upstream_5xx"], 1);
    assert.equal(stats.byError["upstream_429"], 1);
  });

  it("skips zero status in failed count", () => {
    const entries = [
      { status: 0, model: "x", provider: "y" },
      { status: 200, model: "x", provider: "y" }
    ];
    const stats = computeStats(entries);
    assert.equal(stats.success, 1);
    assert.equal(stats.failed, 0);
  });

  it("computes average latency", () => {
    const entries = [
      { status: 200, elapsedMs: 100 },
      { status: 200, elapsedMs: 200 },
      { status: 200, elapsedMs: 300 }
    ];
    const stats = computeStats(entries);
    assert.equal(stats.avgLatencyMs, 200);
  });
});
