// 0.5.4: --check must be fully read-only. The previous version
// of this test only asserted the data/ and master.key files
// were not created, but the auto-generated relay token file
// (data/security/relay-token) was still being written because
// auth.js's resolver created the file before the test's
// expectation could see it. This script now explicitly asserts
// that ALL three of:
//   - data/                 (auth + keys + runtime-state would live here)
//   - data/security/        (parent dir of the relay token)
//   - data/security/relay-token   (the file itself, when generated)
// are absent after --check exits successfully. It also asserts
// that the captured --check stdout / stderr does NOT contain
// the auto-generated token (only a "(check mode)" placeholder
// is allowed).
//
// 0.5.5 cleanup contract (see scripts/test-utils.mjs):
//   * killChildProcess — SIGTERM, wait for "exit", SIGKILL after
//     2s, then destroy() the stdio streams. Replaces the
//     hand-rolled "kill + race with setTimeout + kill SIGKILL +
//     destroy" block. The 0.5.4 line still needed a 1.5s
//     safety-net force-exit because the stdio Sockets were not
//     being released in time; with the shared helper the loop
//     drains on its own.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  killChildProcess,
  sleep
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-check-readonly-"));

function runNode(args, options) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, options);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
    // 0.5.4: hand the caller the live child handle so they can
    // SIGTERM the relay spawned in the "normal start" sanity
    // check. Without this the test would hang on a running
    // listen() server.
    resolveRun.child = child;
  });
}

try {
  await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
    defaultProvider: "local",
    providers: [
      { name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] }
    ],
    routes: [],
    profiles: [{ name: "default", defaultModel: "local-model" }],
    activeProfile: "default"
  }, null, 2));

  const dataDir = resolve(tmpRoot, "data");
  const tokenFile = resolve(tmpRoot, "data", "security", "relay-token");
  const securityDir = resolve(tmpRoot, "data", "security");
  const statePath = resolve(tmpRoot, "runtime-state.json");
  const keystoreDir = resolve(tmpRoot, "keys");

  const result = await runNode(["src/server.js", "--check"], {
    cwd: rootDir,
    env: {
      ...process.env,
      // 0.5.4: point everything at a tmp dir so the test never
      // touches the project root (a previous run with stale
      // state in <root>/data/ would have masked the bug).
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: statePath,
      OPENRELAY_KEYSTORE_DIR: keystoreDir
    }
  });
  if (result.code !== 0) {
    throw new Error(`--check failed with exit ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }

  const created = [
    { path: dataDir, label: "data/" },
    { path: securityDir, label: "data/security/" },
    { path: tokenFile, label: "data/security/relay-token" },
    { path: statePath, label: "runtime-state.json" },
    { path: resolve(dataDir, "master.key"), label: "data/master.key" },
    { path: resolve(dataDir, "keys.enc.json"), label: "data/keys.enc.json" }
  ].filter((item) => existsSync(item.path));
  if (created.length > 0) {
    throw new Error(`--check created files/directories: ${created.map((c) => c.label).join(", ")}`);
  }

  // 0.5.4: --check must not leak the relay token. The stdout
  // for the --check JSON status still contains the masked
  // placeholder, which is fine; but the actual token bytes
  // (32 random hex chars, no `...` separator) must not appear
  // anywhere. We don't have a token to compare against, so we
  // look for the tell-tale "local relay token:" banner — if
  // auth.js emitted one in --check mode, that's a leak.
  if (result.stdout.includes("local relay token:")) {
    throw new Error(`--check printed the relay-token banner; relay token would leak into stdout. stdout was:\n${result.stdout}`);
  }
  if (result.stderr.includes("local relay token:")) {
    throw new Error(`--check printed the relay-token banner on stderr; relay token would leak into stderr. stderr was:\n${result.stderr}`);
  }

  // The status JSON is part of stdout. Sanity check that the
  // placeholder is there and the relayAuth object has no
  // apiKey / token fields that would carry a real secret.
  const status = JSON.parse(result.stdout);
  if (status.relayAuth && (status.relayAuth.apiKey || status.relayAuth.token)) {
    throw new Error(`--check status.relayAuth contains a real token field: ${JSON.stringify(status.relayAuth)}`);
  }
  if (status.relayAuth && status.relayAuth.tokenSource !== "check-readonly") {
    throw new Error(`--check status.relayAuth.tokenSource should be "check-readonly", got "${status.relayAuth.tokenSource}"`);
  }

  // Sanity check 2: a normal (non --check) start in the same
  // tmp dir DOES create the token file. This protects against
  // the opposite regression: someone tightening --check so
  // far that a real start also can't write the file.
  //
  // We CANNOT use runNode() here because the normal-start
  // child never closes (it listens on a port). The
  // Promise<close> would hang forever. So spawn the child
  // directly, poll for the token file, then kill the child
  // via the shared helper and wait for it to actually exit.
  const normalChild = spawn(process.execPath, ["src/server.js"], {
    cwd: rootDir,
    env: {
      ...process.env,
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: statePath,
      OPENRELAY_KEYSTORE_DIR: keystoreDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  // Drain stdio so the parent doesn't block on a full pipe.
  let normalStdout = "";
  let normalStderr = "";
  normalChild.stdout.on("data", (c) => { normalStdout += c.toString(); });
  normalChild.stderr.on("data", (c) => { normalStderr += c.toString(); });

  // Give the relay up to 5s to write the token file.
  const tokenPath = resolve(tmpRoot, "data", "security", "relay-token");
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && !existsSync(tokenPath)) {
    if (normalChild.exitCode !== null) break;
    await sleep(50);
  }

  // 0.5.5: shared helper. The 0.5.4 line's hand-rolled
  // SIGTERM + Promise.race + SIGKILL + stdio.destroy +
  // 1.5s safety-net force-exit is replaced by a single
  // await killChildProcess(normalChild). The safety net is
  // no longer needed because the stdio Sockets are
  // deterministically destroyed and the loop can drain.
  await killChildProcess(normalChild);

  if (!existsSync(tokenPath)) {
    throw new Error(`normal start did NOT create ${tokenPath}; the auto-generation path is broken (regression check). normalStdout=${normalStdout.slice(0, 200)} normalStderr=${normalStderr.slice(0, 200)}`);
  }
  // Confirm the token file has the expected 32-byte hex shape
  // (64 hex chars).
  const tokenContent = readFileSync(tokenPath, "utf8").trim();
  if (!/^[a-f0-9]{64}$/i.test(tokenContent)) {
    throw new Error(`token file has unexpected content (not 64 hex chars): ${tokenContent.slice(0, 80)}`);
  }

  console.log("check readonly test passed");
} finally {
  await cleanupTempDir(tmpRoot);
}
