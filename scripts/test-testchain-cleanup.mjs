// Chain-cleanup regression test for the auth -> usage -> codex sequence.
//
// Background: 0.5.5 introduced test cleanup helpers
// (killChildProcess / closeServer / cleanupTempDir / testFetch)
// and claimed in CHANGELOG.md that full npm test no longer
// hangs. The claim was wrong. Running
//
//   node scripts/test-auth-required.mjs &&
//   node scripts/test-usage-recording.mjs &&
//   node scripts/test-codex-compat.mjs
//
// still pinned npm test on Windows, because:
//
//   * test-codex-compat.mjs had no client-side request
//     timeout. A half-closed upstream socket would keep the
//     stream read alive until the OS TCP keepalive (120s on
//     Windows) eventually gave up.
//   * The mock idle-stream handler slept 15s; the relay's
//     streamIdleTimeoutMs was 10s. Even on a healthy chain
//     the idle scenario took 10s end-to-end, the slowest
//     single scenario in the test.
//   * Combined with a relay that was sometimes wedged after
//     auth + usage (a separate reliability bug we did not
//     fully diagnose), the chain would either fail with
//     "fetch failed" or pin npm test until the user
//     interrupted it.
//
// This test reproduces the original 3-step chain and fails
// the run if any step does not complete inside the
// per-step budget. The budget is generous (90s per step)
// because the codex-compat step itself includes a ~10s
// regression scenario. The point is the HARD ceiling: if a
// future change reintroduces a hang, the ceiling makes
// npm test fail fast instead of waiting for OS-level
// timeouts.
//
// This script is added to the npm test chain right after
// test-codex-compat.mjs (see package.json) so a future
// regression breaks the chain in the same place as the
// original bug report.

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Steps reproduce the original 0.5.5 hang report verbatim.
// Keep this list in the same order as the 0.5.5 chain that
// was failing, so a future reader can find this test by
// searching for the original reproduction command.
const steps = [
  { name: "test-auth-required", script: "scripts/test-auth-required.mjs" },
  { name: "test-usage-recording", script: "scripts/test-usage-recording.mjs" },
  { name: "test-codex-compat", script: "scripts/test-codex-compat.mjs" }
];

// Per-step budget. The codex-compat step alone is the bulk
// of the budget — it includes the idle-stream regression
// (mock sleep 3s + relay idle timeout 1s) plus a 150ms
// post-scenario fence and a 1.5s mock-server close.
// 90s leaves a 30x safety margin over the normal ~3s
// runtime of codex-compat. Going below 60s would risk
// false-positives on a slow CI runner; going above 120s
// starts to compete with the OS TCP keepalive that the
// fix was designed to avoid.
const PER_STEP_BUDGET_MS = 90000;

let passed = 0;
let failed = 0;
const failures = [];

function logPass(name) { console.log(`  ok  ${name}`); passed += 1; }
function logFail(name, error) { console.log(`  FAIL  ${name}: ${error}`); failed += 1; failures.push({ name, error }); }

// Spawn one step as a child process and race it against
// the per-step budget. The output is streamed live so a
// failing step shows its own assertion error before the
// timeout fires; without that, a hung step would print
// nothing and the operator would only see the timeout.
function runStepWithTimeout({ name, script, budgetMs }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [script], {
      cwd: rootDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    let resolved = false;
    const finish = (result) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already gone */ }
      // Drop the listeners so a late child event does not
      // attach an orphan to a promise we are about to
      // forget. The 0.5.5 codex-compat hang had a
      // similar "listener outlives the promise" failure
      // mode; we keep this script defensive against the
      // same pattern.
      child.stdout.removeAllListeners("data");
      child.stderr.removeAllListeners("data");
      child.removeAllListeners("exit");
      child.removeAllListeners("error");
      resolve(result);
    };
    const timer = setTimeout(() => {
      const elapsed = Date.now() - started;
      finish({
        ok: false,
        error: `${name} did not finish within ${budgetMs}ms (hung for ${elapsed}ms). This is the 0.5.5 regression signature.`
      });
    }, budgetMs);
    child.once("error", (err) => {
      finish({ ok: false, error: `${name} spawn error: ${err.message}` });
    });
    child.once("exit", (code, signal) => {
      const elapsed = Date.now() - started;
      if (code === 0) {
        finish({ ok: true, elapsedMs: elapsed });
      } else {
        // The step's own assertion already printed the
        // diagnostic to stdout/stderr; we just attribute
        // the failure to the step + exit code.
        finish({
          ok: false,
          error: `${name} exited with code=${code} signal=${signal} after ${elapsed}ms`
        });
      }
    });
  });
}

(async () => {
  console.log("testchain cleanup regression");
  for (const step of steps) {
    const result = await runStepWithTimeout({ name: step.name, script: step.script, budgetMs: PER_STEP_BUDGET_MS });
    if (result.ok) {
      logPass(`${step.name} completed in ${result.elapsedMs}ms (budget ${PER_STEP_BUDGET_MS}ms)`);
    } else {
      logFail(step.name, result.error);
    }
  }
  console.log(`${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
})();
