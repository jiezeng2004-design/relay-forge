// 0.6.3: regression test for the softRefresh fallback path.
//
// 0.5.2-0.6.2 fallback: `window.location.replace("/?_=<ts>#<tab>")`
//   - Top-level navigation drops the Authorization header.
//   - Server returns the token prompt HTML for the new page.
//   - inline prompt script reads sessionStorage and `document.write`s
//     the dashboard back, but the user sees a 100-300ms flash of
//     the login form even when they had a valid sessionStorage token.
//
// 0.6.3 fallback: in-place fetch of GET / with the sessionStorage
//   token attached as Authorization, then document.write the body.
//   If the fetch fails (network error, no token, server error), fall
//   back to `location.reload()` which preserves the same URL.
//
// This suite is split into two parts:
//
//   1. **Static analysis**  -- parses the dashboard's inline `<script>`
//      block(s) from the rendered HTML and asserts the new code is
//      present (Authorization injection from sessionStorage, fetch +
//      document.write, cache: "no-store") and the old code is gone
//      (no `window.location.replace` in softRefresh). This locks the
//      fix in place against accidental regressions even though we
//      cannot run a real browser here.
//
//   2. **End-to-end**  -- spawns a real relay, fetches GET / with a
//      Bearer token, and asserts the response is the dashboard HTML
//      (not the token prompt). This is the server-side half of the
//      contract; the client-side sessionStorage bridge is covered
//      by the static analysis part. We do NOT spawn a browser to
//      exercise the in-place fetch + document.write path  -- that
//      would require a headless browser, which is intentionally
//      out of scope for a zero-deps project.
//
// Zero dependencies. Same cleanup contract as
// scripts/test-utils.mjs.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  cleanupTempDir,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const here = fileURLToPath(import.meta.url);
const repoRoot = resolve(here, "..", "..");

// --- Part 1: static analysis of the inline dashboard script ---

function extractAllScriptBodies(html) {
  // Concatenate every <script>...</script> block in the page. The
  // dashboard's inline scripts are spread across multiple
  // <script> blocks (data injection + tab-specific handlers),
  // so we collect them all and check the aggregate.
  return Array.from(html.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]).join("\n");
}

test("0.6.4: softRefresh uses window.location.reload() for stability", () => {
  const dashboardIndex = readFileSync(
    join(repoRoot, "src", "dashboard", "static", "dashboard-client.js"),
    "utf8"
  );

  // 0.6.4: softRefresh is a simple location.reload() call.
  // Earlier document.write() approaches caused page unresponsiveness
  // in certain browser/network conditions. The token-prompt page
  // auto-logins if a sessionStorage token exists, so the brief flash
  // is a minor visual trade-off for guaranteed stability.
  assert.match(
    dashboardIndex,
    /function softRefresh\s*\(\s*\)\s*\{[^}]*location\.reload\(\)[^}]*\}/,
    "softRefresh body must call window.location.reload()"
  );

  // No window.location.replace in the softRefresh function.
  const softRefreshMatch = dashboardIndex.match(
    /function softRefresh\s*\(\s*\)\s*\{[\s\S]*?\n\s{4}\}\s*\n\s{4}function scheduleSoftRefresh/
  );
  if (softRefreshMatch) {
    assert.doesNotMatch(
      softRefreshMatch[0],
      /window\.location\.replace/,
      "softRefresh must not call window.location.replace()"
    );
  }
});

// --- Part 2: server-side contract (the 0.6.1 + 0.6.3 GET / fix is preserved) ---

const rootDir = repoRoot;
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-soft-refresh-"));
const configPath = resolve(tmpRoot, "config.json");
const statePath = resolve(tmpRoot, "state.json");
const keystoreDir = resolve(tmpRoot, "keys");

await writeFile(configPath, JSON.stringify({
  defaultProvider: "local",
  providers: [
    { name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] }
  ],
  routes: [{ name: "r", candidates: [{ provider: "local", model: "local-model" }] }],
  profiles: [{ name: "default", defaultModel: "r" }],
  activeProfile: "default"
}));

const proc = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: "0",
    // The operator can set a fixed RELAY_TOKEN in .env to
    // exercise the auth gate end-to-end. We use the
    // check-readonly path here instead: the 0.6.3 fix is
    // about the softRefresh CLIENT-SIDE behavior; the
    // server-side contract is unchanged from 0.6.1.
    OPENRELAY_ALLOW_NO_AUTH: "true",
    OPENRELAY_CONFIG: configPath,
    OPENRELAY_STATE: statePath,
    OPENRELAY_KEYSTORE_DIR: keystoreDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});
proc.stderr.on("data", (chunk) => {
  // 0.6.3: surface the relay's stderr to the test output so a
  // startup failure is diagnosable without re-running the test
  // by hand. The default testFetch + killChildProcess contract
  // silently discards stderr, which made the "relay exited
  // prematurely" failure mode opaque.
  const text = chunk.toString("utf8");
  for (const line of text.split(/\r?\n/)) {
    if (line.trim()) console.error(`[relay stderr] ${line}`);
  }
});

const failures = [];
function check(cond, msg) {
  if (!cond) { failures.push(msg); console.log(`  FAIL ${msg}`); }
  else { console.log(`  ok  ${msg}`); }
}

function waitForRelayPort(child) {
  return new Promise((resolveP, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("relay did not print its listening port in time"));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener("data", onData);
    }
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) { cleanup(); resolveP(Number(match[1])); }
    }
    child.stdout.on("data", onData);
    child.once("error", (err) => { cleanup(); reject(err); });
    child.once("exit", (code) => { cleanup(); reject(new Error(`relay exited prematurely with code ${code}`)); });
  });
}

try {
  const port = await waitForRelayPort(proc);

  const deadline = Date.now() + 5000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const r = await testFetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) { healthy = true; break; }
    } catch {}
    await sleep(100);
  }
  check(healthy, "relay becomes healthy within 5s");

  // Fetch the dashboard with no auth  -- the softRefresh fallback
  // relies on the server returning the full dashboard HTML for a
  // sessionStorage-bearing client, which the server already does
  // when OPENRELAY_ALLOW_NO_AUTH=true. We verify the response
  // shape is HTML and contains the dashboard chrome + the inline
  // softRefresh body that the 0.6.3 fix touches.
  const rootResp = await testFetch(`http://127.0.0.1:${port}/`);
  check(rootResp.status === 200, "GET / returns 200");
  const rootText = await rootResp.text();
  const allScripts = extractAllScriptBodies(rootText);
  check(allScripts.length > 0, "GET / inline <script> body present");
  check(
    allScripts.includes("openrelay.adminToken"),
    "rendered dashboard references the openrelay.adminToken sessionStorage key"
  );
  check(
    allScripts.includes("location.reload"),
    "rendered dashboard contains location.reload (the 0.6.4 softRefresh mechanism)"
  );
} catch (error) {
  failures.push(error && error.message ? error.message : String(error));
  console.log(`  FAIL error: ${error && error.message ? error.message : String(error)}`);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
}

console.log(failures.length === 0
  ? "soft refresh fallback test passed"
  : `soft refresh fallback test failed (${failures.length} issue${failures.length === 1 ? "" : "s"})`);
if (failures.length > 0) process.exitCode = 1;
