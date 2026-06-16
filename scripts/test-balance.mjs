// Unit tests for the balance path. Run: node scripts/test-balance.mjs
//
// Covers codex's catch: a 3xx from the balance endpoint must NOT be
// followed (the bearer token could leak to the redirect target) and
// must surface as a refused result. Also covers 4xx / 5xx, 2xx with
// fieldMap, and the URL guard (https-only, method allow-list).

import { guardBalanceEndpoint, interpretBalanceResponse, extractBalanceSummary, getByPath } from "../src/balance.js";

const tests = [];
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const assertEqual = (actual, expected, message) => {
  if (actual !== expected) fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function test(name, fn) { tests.push({ name, fn }); }

// Fake Response objects that match the surface area the interpreter uses.
function fakeResponse({ type = "default", status = 200, ok, headers } = {}) {
  return {
    type,
    status,
    ok: ok !== undefined ? ok : status >= 200 && status < 300,
    headers: headers || new Map()
  };
}

test("2xx with fieldMap exposes a parsed summary", () => {
  const out = interpretBalanceResponse({
    response: fakeResponse({ status: 200, ok: true }),
    responseText: JSON.stringify({ remaining: 17, used: 3, limit: 20, currency: "USD" }),
    fieldMap: { remaining: "remaining", limit: "limit", used: "used", currency: "currency" },
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 12
  });
  assert(out.ok === true, "should be ok");
  assertEqual(out.status, 200, "status 200");
  assertEqual(out.summary, "remaining=17, used=3, limit=20, currency=USD", "summary");
  assert(out.body === undefined, "body not exposed on success");
});

test("2xx without known fields falls back to a JSON snippet", () => {
  const out = interpretBalanceResponse({
    response: fakeResponse({ status: 200, ok: true }),
    responseText: JSON.stringify({ free_credit: 5, weird_shape: true }),
    fieldMap: undefined,
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 4
  });
  assert(out.ok === true, "ok");
  assert(out.summary && out.summary.startsWith("{"), `expected JSON snippet, got '${out.summary}'`);
});

test("REGRESSION: opaqueredirect is refused and never treated as 2xx", () => {
  // With `redirect: "manual"`, the WHATWG shape would be
  // type === "opaqueredirect". The interpreter must NOT call
  // response.ok on the redirect (which would be true) and must NOT
  // surface a body or summary. The bearer token should never leak
  // to the redirect target because the relay never re-fetches.
  const out = interpretBalanceResponse({
    response: fakeResponse({ type: "opaqueredirect", status: 0 }),
    responseText: "",
    fieldMap: { remaining: "remaining" },
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 7
  });
  assert(out.ok === false, `opaqueredirect must not be ok, got ok=${out.ok}`);
  assertEqual(out.status, 302, "status surfaces as 302");
  assertEqual(out.error, "balance_endpoint_redirect_refused", "error code");
  assert(out.message && out.message.includes("does not follow"), "error message mentions no-follow");
  assertEqual(out.summary, null, "summary must be null for refused redirect");
  assertEqual(out.body, undefined, "body must be undefined for refused redirect");
});

test("REGRESSION: real 3xx (type=basic, status=302) is also refused", () => {
  // In practice, Node 18+ fetch with `redirect: "manual"` returns a
  // regular Response with type="basic" and status=302, NOT an
  // opaqueredirect. We still want the relay to refuse it. Verified
  // manually against Node 24.15; covered here so we never regress.
  const out = interpretBalanceResponse({
    response: fakeResponse({ type: "basic", status: 302, ok: false }),
    responseText: "",
    fieldMap: { remaining: "remaining" },
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 5
  });
  assert(out.ok === false, "3xx must not be ok");
  assertEqual(out.status, 302, "status surfaces as 302");
  assertEqual(out.error, "balance_endpoint_redirect_refused", "error code");
  assertEqual(out.summary, null, "summary must be null");
});

test("4xx is not ok and the body is preserved for debugging", () => {
  const out = interpretBalanceResponse({
    response: fakeResponse({ status: 401, ok: false }),
    responseText: JSON.stringify({ error: "invalid_key" }),
    fieldMap: undefined,
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 5
  });
  assert(out.ok === false, "4xx not ok");
  assertEqual(out.status, 401, "status 401");
  assertEqual(out.body.error, "invalid_key", "body parsed");
  assertEqual(out.summary, null, "no summary on error");
});

test("5xx is not ok", () => {
  const out = interpretBalanceResponse({
    response: fakeResponse({ status: 503, ok: false }),
    responseText: "service unavailable",
    fieldMap: undefined,
    providerName: "mock",
    endpointUrl: "https://example.test/balance",
    elapsedMs: 5
  });
  assert(out.ok === false, "5xx not ok");
  assertEqual(out.status, 503, "status 503");
  assertEqual(out.body, "service unavailable", "body preserved as text");
});

test("guard rejects non-https non-loopback URL", () => {
  const out = guardBalanceEndpoint({ url: "http://api.example.com/balance" }, { name: "x" });
  assertEqual(out.ok, false, "should refuse http on non-loopback");
  assertEqual(out.error, "balance_endpoint_https_required", "error code");
});

test("guard allows https", () => {
  const out = guardBalanceEndpoint({ url: "https://api.example.com/balance" }, { name: "x" });
  assertEqual(out.ok, true, "https allowed");
  assertEqual(out.method, "GET", "default method GET");
});

test("guard allows http only on loopback hosts", () => {
  const loopback = guardBalanceEndpoint({ url: "http://127.0.0.1:39210/v1/balance" }, { name: "x" });
  assertEqual(loopback.ok, true, "127.0.0.1 loopback allowed");
  const localhost = guardBalanceEndpoint({ url: "http://localhost:39210/v1/balance" }, { name: "x" });
  assertEqual(localhost.ok, true, "localhost loopback allowed");
  const ipv6 = guardBalanceEndpoint({ url: "http://[::1]:39210/v1/balance" }, { name: "x" });
  assertEqual(ipv6.ok, true, "::1 loopback allowed");
  const publicHttp = guardBalanceEndpoint({ url: "http://10.0.0.5/balance" }, { name: "x" });
  assertEqual(publicHttp.ok, false, "private http refused");
});

test("guard rejects POST and other non-GET/HEAD methods", () => {
  const post = guardBalanceEndpoint({ url: "https://api.example.com/balance", method: "POST" }, { name: "x" });
  assertEqual(post.ok, false, "POST refused");
  assertEqual(post.error, "balance_endpoint_method_forbidden", "error code");
  const head = guardBalanceEndpoint({ url: "https://api.example.com/balance", method: "HEAD" }, { name: "x" });
  assertEqual(head.ok, true, "HEAD allowed");
});

test("guard refuses invalid URLs", () => {
  const out = guardBalanceEndpoint({ url: "not a url" }, { name: "x" });
  assertEqual(out.ok, false, "invalid url refused");
  assertEqual(out.error, "balance_endpoint_url_invalid", "error code");
});

test("guard strips dangerous headers and keeps safe custom ones", () => {
  const out = guardBalanceEndpoint({
    url: "https://api.example.com/balance",
    headers: {
      "Authorization": "Bearer secret",
      "Cookie": "session=abc",
      "X-Custom-Trace": "abc123",
      "X-Forwarded-For": "1.2.3.4",
      "Accept": "application/json"
    }
  }, { name: "x" });
  assertEqual(out.ok, true, "guard ok");
  assert(!("authorization" in out.allowedHeaders), "authorization must be stripped");
  assert(!("cookie" in out.allowedHeaders), "cookie must be stripped");
  assert(!("x-forwarded-for" in out.allowedHeaders), "x-forwarded-for stripped");
  assertEqual(out.allowedHeaders["x-custom-trace"], "abc123", "x-custom-* allowed");
  assertEqual(out.allowedHeaders["accept"], "application/json", "accept allowed");
});

test("getByPath supports dotted and array paths", () => {
  const obj = { a: { b: 1 }, list: [{ value: 2 }], balance_infos: [{ currency_balance: 17 }] };
  assertEqual(getByPath(obj, "a.b"), 1, "dotted path");
  assertEqual(getByPath(obj, "list[0].value"), 2, "array path");
  assertEqual(getByPath(obj, "balance_infos[0].currency_balance"), 17, "balance info path");
});

test("extractBalanceSummary uses fieldMap nested paths", () => {
  const summary = extractBalanceSummary(
    JSON.stringify({ balance_infos: [{ currency_balance: 17, total_balance: 20, granted_balance: 3, currency: "USD" }] }),
    {
      remaining: "balance_infos[0].currency_balance",
      limit: "balance_infos[0].total_balance",
      used: "balance_infos[0].granted_balance",
      currency: "balance_infos[0].currency"
    }
  );
  assertEqual(summary, "remaining=17, used=3, limit=20, currency=USD", "nested balance summary");
});

test("extractBalanceSummary returns null for non-JSON body", () => {
  assertEqual(extractBalanceSummary("not json", undefined), null, "non-JSON -> null");
  assertEqual(extractBalanceSummary("", undefined), null, "empty -> null");
});

// --- runner ---

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log(`  ✓ ${t.name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${error.message}`);
  }
}
console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
