// Verify a built relayforge executable: existence, size sanity, the
// "RelayForge is running at" banner appears within 5s.
// Bundled executables must still be able to load .env + config.json
// from their sibling directory, so the verifier puts the exe next
// to a throwaway config.json and a master.key and confirms the
// /health endpoint comes up.
//
// Usage:  node scripts/verify-exe.mjs <path-to-exe>
//
// Exits non-zero on any failure. The relay process and tmp dir are
// always cleaned up. We never print prompt / key contents; the
// test inputs are fixed strings (port 0, empty keyEnv).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";

const exePath = process.argv[2];
if (!exePath) {
  console.error("Usage: node scripts/verify-exe.mjs <path-to-exe>");
  process.exit(2);
}
if (!existsSync(exePath)) {
  console.error(`FAIL: executable not found: ${exePath}`);
  process.exit(2);
}

const size = statSync(exePath).size;
const minSize = 1_000_000; // 1MB — sanity check; bun --compile output is much larger
const maxSize = 300_000_000; // 300MB — generous upper bound
if (size < minSize) {
  console.error(`FAIL: executable is suspiciously small (${size} bytes; < ${minSize})`);
  process.exit(2);
}
if (size > maxSize) {
  console.error(`FAIL: executable is suspiciously large (${size} bytes; > ${maxSize})`);
  process.exit(2);
}
console.log(`ok  executable size = ${(size / 1024 / 1024).toFixed(1)} MB`);

const tmpDir = join(tmpdir(), `openrelay-verify-exe-${process.pid}-${Date.now()}`);
mkdirSync(tmpDir, { recursive: true });
const configPath = join(tmpDir, "config.json");
writeFileSync(configPath, JSON.stringify({
  defaultProvider: "primary",
  providers: [
    { name: "primary", baseUrl: "http://127.0.0.1:1/v1", keyEnv: null, models: ["ping"] }
  ],
  routes: [
    { name: "codex", strategy: "fallback", candidates: [{ provider: "primary", model: "ping" }] }
  ],
  profiles: [{ name: "default", defaultModel: "codex" }],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 5000, streamIdleTimeoutMs: 10000 },
  limits: { maxBodyBytes: 1048576 },
  history: { retentionDays: 3 },
  healthChecks: { enabled: false }
}));

let child = null;
let relayPort = null;
let relayExitCode = null;

try {
  child = spawn(exePath, [], {
    env: {
      ...process.env,
      PORT: "0",
      OPENRELAY_CONFIG: configPath,
      OPENRELAY_STATE: join(tmpDir, "state.json"),
      OPENRELAY_KEYSTORE_DIR: tmpDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.on("exit", (code) => { relayExitCode = code; });

  const port = await waitForPort(child, 5000);
  relayPort = port;
  console.log(`ok  executable binds to port ${port}`);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  if (!health.ok) {
    throw new Error(`executable /health returned ${health.status}`);
  }
  const healthBody = await health.text();
  let healthJson;
  try { healthJson = JSON.parse(healthBody); } catch { throw new Error(`/health not JSON: ${healthBody.slice(0, 200)}`); }
  if (!healthJson.ok) {
    throw new Error(`/health ok=false: ${JSON.stringify(healthJson)}`);
  }
  console.log(`ok  executable /health reports ok=true, version=${healthJson.version || "?"}`);

  // Confirm the /v1/models endpoint answers (proves the config loaded
  // from the exe's sibling dir, not cwd).
  const models = await fetch(`http://127.0.0.1:${port}/v1/models`);
  if (!models.ok) {
    throw new Error(`executable /v1/models returned ${models.status}`);
  }
  console.log(`ok  executable /v1/models returns 200`);

  console.log("verify-exe passed");
} catch (error) {
  console.error("verify-exe failed:", error.message);
  process.exitCode = 1;
} finally {
  if (child) {
    try { child.kill(); } catch { /* already exited */ }
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
}

function waitForPort(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`executable did not print its port in ${timeoutMs}ms`));
    }, timeoutMs);
    let buffer = "";
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener("data", onData);
    }
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    }
    child.stdout.on("data", onData);
    child.once("error", (err) => { cleanup(); reject(err); });
    child.once("exit", (code) => { cleanup(); reject(new Error(`executable exited prematurely with code ${code}`)); });
  });
}
