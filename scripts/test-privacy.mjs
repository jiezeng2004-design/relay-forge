import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeHeader, sanitizeKey, sanitizeLogMessage, sanitizeRequestBody, buildRequestMeta } from "../src/privacy.js";

describe("privacy.sanitizeHeader", () => {
  it("redacts authorization header", () => {
    const result = sanitizeHeader("authorization", "Bearer sk-abc123def456ghi789jkl");
    assert.ok(result.includes("****"));
    assert.ok(!result.includes("sk-abc123def456ghi789jkl"));
  });

  it("redacts x-api-key header", () => {
    const result = sanitizeHeader("x-api-key", "sk-abcdef1234567890abcdef12");
    assert.ok(result.includes("****"));
    assert.ok(!result.includes("sk-abcdef"));
  });

  it("keeps content-type header unchanged", () => {
    assert.equal(sanitizeHeader("content-type", "application/json"), "application/json");
  });

  it("handles null value", () => {
    assert.equal(sanitizeHeader("authorization", null), null);
  });
});

describe("privacy.sanitizeKey", () => {
  it("redacts sk- keys", () => {
    const result = sanitizeKey("sk-abcdef1234567890abcdef1234567890abcdef12");
    assert.ok(!result.includes("sk-abcdef1234567890abcdef1234567890abcdef12"));
    assert.ok(result.includes("****"));
  });

  it("redacts ghp_ tokens", () => {
    const result = sanitizeKey("ghp_abcdef1234567890abcdef1234567890abcdef12");
    assert.ok(result.includes("****"));
  });

  it("redacts xoxb- tokens", () => {
    const result = sanitizeKey("xoxb-1234567890-1234567890-abcdef123456");
    assert.ok(result.includes("****"));
  });

  it("handles non-string input", () => {
    assert.equal(sanitizeKey(null), null);
    assert.equal(sanitizeKey(123), 123);
  });

  it("does not alter normal text", () => {
    assert.equal(sanitizeKey("hello-world"), "hello-world");
  });
});

describe("privacy.sanitizeLogMessage", () => {
  it("redacts keys in log messages", () => {
    const msg = "Request with key sk-abcdef1234567890abcdef12 failed";
    const result = sanitizeLogMessage(msg);
    assert.ok(!result.includes("sk-abcdef1234567890abcdef12"));
    assert.ok(result.includes("****"));
  });

  it("handles null or non-string", () => {
    assert.equal(sanitizeLogMessage(null), null);
  });
});

describe("privacy.sanitizeRequestBody", () => {
  it("redacts sensitive fields at root", () => {
    const body = { api_key: "sk-abcdef1234567890abcdef12", model: "gpt-4", messages: [] };
    const result = sanitizeRequestBody(body);
    assert.ok(result.api_key.includes("****"));
    assert.ok(!result.api_key.includes("sk-abcdef1234567890abcdef12"));
    assert.equal(result.model, "gpt-4");
  });

  it("redacts message content to length indicator", () => {
    const body = { messages: [{ role: "user", content: "This is a secret prompt" }] };
    const result = sanitizeRequestBody(body);
    assert.ok(result.messages[0].content.includes("redacted"));
    assert.ok(result.messages[0].content.includes("23"));
  });

  it("redacts prompt field", () => {
    const body = { prompt: "My secret prompt text", model: "gpt-4" };
    const result = sanitizeRequestBody(body);
    assert.ok(result.prompt.includes("redacted"));
  });

  it("handles null body", () => {
    assert.equal(sanitizeRequestBody(null), null);
  });
});

describe("privacy.buildRequestMeta", () => {
  it("builds metadata without prompt content", () => {
    const req = { method: "POST", url: "/v1/chat/completions" };
    const body = { model: "gpt-4", messages: [{ role: "user", content: "hello world" }] };
    const meta = buildRequestMeta(req, body, "openai", "gpt-4", Date.now(), 200, null);
    assert.equal(meta.method, "POST");
    assert.equal(meta.model, "gpt-4");
    assert.equal(meta.provider, "openai");
    assert.equal(meta.status, 200);
    assert.equal(meta.promptLength, 11);
    assert.ok(meta.timestamp);
  });

  it("uses fallback values", () => {
    const req = { method: "GET", url: "/v1/models" };
    const meta = buildRequestMeta(req, {}, null, null, Date.now());
    assert.equal(meta.model, "unknown");
    assert.equal(meta.provider, "unknown");
  });
});
