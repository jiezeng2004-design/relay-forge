// 0.6.1: regression test for the SPA softRefresh fallback
// route. The 0.5.4 softRefresh path issues a full
// `location.replace('/?_=<timestamp>#<tab>')` so the browser
// cache-busts the dashboard HTML after a save / add / delete.
// The 0.5.x GET / route only matched a bare `req.url === "/"`
// and fell through to the catch-all 404 with a JSON body, so
// the dashboard rendered as a blank page with `{"error":
// "not_found"}`. The 0.6.1 fix accepts any `/?...` query string
// as a dashboard request.
//
// This test boots a real relay, hits GET / with a
// cache-buster query, and asserts the response is HTML (not
// JSON), is 200, and contains the dashboard chrome. The hash
// fragment is browser-only so we do not send it on the wire.
//
// Zero dependencies. Same cleanup contract as
// scripts/test-utils.mjs.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupTempDir,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-spa-refresh-"));
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
    OPENRELAY_ALLOW_NO_AUTH: "true",
    OPENRELAY_CONFIG: configPath,
    OPENRELAY_STATE: statePath,
    OPENRELAY_KEYSTORE_DIR: keystoreDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});
proc.stderr.on("data", () => {});

const failures = [];
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  } else {
    console.log(`  ok  ${msg}`);
  }
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
      if (match) {
        cleanup();
        resolveP(Number(match[1]));
      }
    }
    child.stdout.on("data", onData);
    child.once("error", (err) => {
      cleanup();
      reject(err);
    });
    child.once("exit", (code) => {
      cleanup();
      reject(new Error(`relay exited prematurely with code ${code}`));
    });
  });
}

try {
  const port = await waitForRelayPort(proc);

  // Wait for /health
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

  // Baseline: GET / with no query still works.
  const baselineResp = await testFetch(`http://127.0.0.1:${port}/`);
  check(baselineResp.status === 200, "GET / (bare) returns 200");
  const baselineText = await baselineResp.text();
  check(baselineText.length > 1000, "GET / (bare) returns non-trivial HTML");
  check(baselineText.includes("RelayForge"), "GET / (bare) mentions RelayForge");

  // 0.6.1: the SPA softRefresh fallback. Browser issues
  // `location.replace('/?_=1781004207259#providers')` after a
  // successful save / add / delete. The hash fragment is
  // browser-only (never reaches the server), so the wire-level
  // request is `GET /?_=1781004207259`. The 0.5.x server
  // returned `{"error":"not_found"}` for this request because
  // it only matched a bare `req.url === "/"`. The 0.6.1 fix
  // accepts any `/?...` query string as a dashboard request.
  const stamp = Date.now();
  const cacheBusterResp = await testFetch(`http://127.0.0.1:${port}/?_=${stamp}`);
  check(cacheBusterResp.status === 200, `GET /?_=${stamp} returns 200 (was 404 in 0.5.x)`);
  const cacheBusterText = await cacheBusterResp.text();
  const ct = cacheBusterResp.headers.get("content-type") || "";
  check(ct.includes("text/html"), `GET /?_=${stamp} content-type is HTML, got "${ct}"`);
  check(cacheBusterText.length > 1000, `GET /?_=${stamp} returns non-trivial HTML body`);
  check(cacheBusterText.includes("RelayForge"), `GET /?_=${stamp} body mentions RelayForge`);
  check(cacheBusterText.includes("tab-overview"), `GET /?_=${stamp} body still includes the overview tab`);
  check(cacheBusterText.includes('data-tab="providers"'), `GET /?_=${stamp} body still includes the providers tab anchor`);
  // 0.6.1: the response must NOT be the 0.5.x JSON payload
  // {"error":"not_found"}. The content-type check above already
  // rules out application/json, but we belt-and-suspenders it
  // here in case a future build accidentally re-introduces the
  // JSON fallback for /.
  check(!cacheBusterText.trimStart().startsWith("{"), `GET /?_=${stamp} body is not JSON`);

  // Also: the random token / cache-buster query the dashboard
  // SPA uses in production. It is not just `_=<int>`; the inline
  // softRefresh in the project uses `Date.now()` so the value
  // is always an integer timestamp. We cover the production
  // shape here.
  const productionStamp = String(Date.now());
  const prodResp = await testFetch(`http://127.0.0.1:${port}/?_=${productionStamp}`);
  check(prodResp.status === 200, `production-style GET /?_=${productionStamp} returns 200`);
  check((prodResp.headers.get("content-type") || "").includes("text/html"), "production-style GET / is HTML, not JSON");

  // Negative case: an unknown path still 404s. The 0.6.1 fix
  // is scoped to `/?...`, NOT to all unknown paths. We must not
  // accidentally regress the catch-all 404.
  const fourOhFour = await testFetch(`http://127.0.0.1:${port}/this-path-does-not-exist`);
  check(fourOhFour.status === 404, "GET /this-path-does-not-exist still returns 404");
  const fourOhFourText = await fourOhFour.text();
  check(fourOhFourText.includes("not_found"), "GET /this-path-does-not-exist body still says not_found");
} catch (error) {
  failures.push(error && error.message ? error.message : String(error));
  console.log(`  FAIL error: ${error && error.message ? error.message : String(error)}`);
} finally {
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
}

console.log(`${failures.length === 0 ? "spa refresh route test passed" : "spa refresh route test failed"}`);
if (failures.length > 0) process.exitCode = 1;
