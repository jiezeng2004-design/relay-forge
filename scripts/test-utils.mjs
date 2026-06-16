// 0.5.5: shared test cleanup helpers. The 0.5.4 line left three
// reliability bugs in the test chain:
//
//   1. test-codex-compat.mjs called relayProcess.kill() without
//      waiting for the process to exit, then immediately did
//      rm(tmpDir). The relay's state.json rename could still be
//      in flight on Windows and produced EPERM. Worse, undici
//      keep-alive sockets from the test's fetch() calls pinned
//      the event loop, so npm test hung waiting for them to drain.
//
//   2. test-auth-required.mjs and test-usage-recording.mjs both
//      ended with a "safety net" 1500ms setTimeout that force-
//      exited the process and printed "handles=2 (Socket,
//      Socket)". That was a workaround, not a fix.
//
//   3. test-dashboard-http.mjs had proc.kill() + a fixed 200ms
//      setTimeout, which on Windows is not enough for the child
//      stdio Sockets to release.
//
// The fix is to centralize the cleanup contract here:
//   * closeServer — gracefully close, with a hard 1.5s deadline
//     and explicit closeIdleConnections / closeAllConnections.
//   * killChildProcess — SIGTERM, wait for "exit", SIGKILL after
//     2s, then destroy() every stdio stream. This is the only
//     way to release the child from the parent's event loop on
//     Windows.
//   * sleep / withTimeout / cleanupTempDir — the small plumbing
//     that all four test scripts were re-implementing in
//     subtly-different ways.
//   * testFetch — fetch wrapper that sets `Connection: close`
//     so the test's outgoing requests don't sit in undici's
//     keep-alive pool and pin the loop after the test returns.
//
// The safety net (force-exit) is removed from the four target
// test scripts. If a future change does leak a handle, we want
// to hear about it via the test's natural assertions, not by
// papering over it with process.exit().
//
// Zero dependencies. Uses only node:net-style APIs that ship
// with Node 18+.

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Race a promise against a timeout. The label is included in
// the rejection message so failing tests are easy to attribute.
export async function withTimeout(promise, ms, label = "operation") {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

// Close a node:http server. Order matters on Windows:
//   1. closeIdleConnections() — release any keep-alive socket
//      that has finished its last request.
//   2. closeAllConnections()  — nuke in-flight sockets, so
//      handlers like an idle-stream sleep() can be unblocked
//      and the event loop can drain.
//   3. server.close(callback) — graceful drain of the listening
//      socket. We bound it with a 1.5s timeout so a stuck
//      handler (e.g. mockServer sleeping inside an SSE handler
//      for 15s) does not deadlock the test.
//   4. server.unref() — last-ditch "let the loop exit" hint
//      in case anything still holds the server in scope.
export async function closeServer(server) {
  if (!server) return;
  try { server.closeIdleConnections?.(); } catch { /* ignore */ }
  try { server.closeAllConnections?.(); } catch { /* ignore */ }
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    try {
      server.close(() => finish());
    } catch {
      finish();
      return;
    }
    setTimeout(finish, 1500);
  });
  try { server.unref?.(); } catch { /* ignore */ }
}

// Kill a child process and wait for it to actually exit. The
// 0.5.4 line just called proc.kill() and let `rm tmpDir` race
// the OS; on Windows the relay's state.json rename could still
// be in flight and produced EPERM. Here we wait for the "exit"
// event so the OS has reaped the process and released its file
// handles before cleanup continues.
//
// SIGTERM is sent first. If the child does not honor it within
// 2s, we escalate to SIGKILL. After the child is gone, we
// destroy() the stdio streams so the parent's event loop stops
// watching the now-closed pipes. Without this, `handles=2
// (Socket, Socket)` shows up in the safety-net summary.
export async function killChildProcess(proc) {
  if (!proc) return;
  if (proc.exitCode !== null || proc.signalCode !== null || proc.killed) return;

  try { proc.kill("SIGTERM"); } catch { /* already dead */ }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => { if (settled) return; settled = true; resolve(); };
    proc.once("exit", finish);
    setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already dead */ }
      // SIGKILL on Windows is a hard terminate; the OS will
      // fire "exit" asynchronously. Resolve the wait so the
      // caller can proceed with rm(tmpDir) without EPERM.
      setTimeout(finish, 200);
    }, 2000);
  });

  for (const stream of [proc.stdout, proc.stderr, proc.stdin]) {
    if (stream && typeof stream.destroy === "function") {
      try { stream.destroy(); } catch { /* already destroyed */ }
    }
  }
}

// rm -rf a temp dir. `force: true` swallows ENOENT. The 0.5.9
// line adds a Windows-specific retry loop: on Windows the
// relay child's `state.json.tmp -> state.json` rename can
// still be in flight when the test calls `cleanupTempDir()`,
// and the OS can hand back EPERM / EBUSY / ENOTEMPTY for a
// few hundred milliseconds. We retry with linear backoff
// (200ms, 400ms, 600ms, 800ms, 1000ms) before giving up and
// re-throwing so the test can still surface a real failure.
export async function cleanupTempDir(dir) {
  if (!dir) return;
  const { rm } = await import("node:fs/promises");
  const isWin = process.platform === "win32";
  const transientCodes = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await rm(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (isWin && transientCodes.has(error && error.code)) {
        await sleep(200 * (attempt + 1));
        continue;
      }
      throw error;
    }
  }
  // Final attempt — let any remaining error propagate.
  await rm(dir, { recursive: true, force: true });
}

// fetch wrapper that disables keep-alive. globalThis.fetch in
// Node 18+ is undici, and undici's keep-alive Sockets pin the
// event loop for ~5s after the last request. The 0.5.4 line
// worked around this with a force-exit safety net. Here we fix
// the root cause by setting `Connection: close` on every
// outgoing test request, so undici tears down the socket as
// soon as the response is drained.
//
// Both `connection: "close"` and `Connection: "close"` are
// accepted by undici; we use the lowercase form to match its
// internal normalization.
export function testFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!Object.keys(headers).some((k) => k.toLowerCase() === "connection")) {
    headers.connection = "close";
  }
  return fetch(url, { ...options, headers });
}

// 0.5.6 / 0.5.7: client-side fetch with a hard timeout via
// AbortController. 0.5.5 added `testFetch` (Connection: close)
// but did not add a per-request timeout, so a single hung
// upstream could pin the test for the OS-default TCP keepalive
// time (120s on Windows).
//
// 0.5.7 clarified the contract: this helper only protects the
// FETCH PHASE. It is for non-stream requests where the caller
// only needs `response.status` / `response.json()` and does
// not need to drain a body. For streaming scenarios or any
// call that ends with `response.text()` / `response.body`, use
// `fetchTextWithTimeout` instead — that helper also aborts the
// body read so a half-closed SSE stream cannot pin the loop
// forever. Using `testFetchWithTimeout` for a body-read call
// reproduces the 0.5.6 codex-idle-stream hang.
export async function testFetchWithTimeout(url, options = {}, timeoutMs = 30000, label = "request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await testFetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
      throw new Error(`${label} timed out after ${timeoutMs}ms (${url})`);
    }
    // 0.5.6: surface the underlying cause chain (ECONNRESET,
    // ECONNREFUSED, etc.) so a flaky relay in the chained test
    // can be attributed to the right hop instead of failing as
    // a bare "fetch failed".
    const detail = {
      message: error && error.message,
      name: error && error.name,
      code: error && error.code,
      cause: error && error.cause && (error.cause.code || error.cause.message)
    };
    throw new Error(`${label} fetch failed: ${JSON.stringify(detail)} (${url})`);
  } finally {
    clearTimeout(timer);
  }
}

// 0.5.7: fetch + read the body as text, with a SINGLE hard
// timeout that covers BOTH the fetch phase and the body-read
// phase. The 0.5.6 version passed the timeout only to fetch
// and then awaited `response.text()` outside the timeout — a
// half-closed SSE body (the relay's codex-idle-stream handler
// returns a body but the upstream never closes it) would
// pin `response.text()` until the OS TCP keepalive (120s on
// Windows) eventually gave up, and `npm test` would hang with
// no diagnostic. The 0.5.7 fix threads the same AbortController
// through both phases and cancels `response.body` on timeout so
// `response.text()` unblocks with a recognizable error.
//
// USE THIS HELPER (not testFetchWithTimeout) for any call that
// will read the response body — every streaming scenario in
// test-codex-compat.mjs, every `await response.text()` site.
// The label is included in the rejection message so a hang is
// attributed to the right scenario.
export async function fetchTextWithTimeout(url, options = {}, timeoutMs = 30000, label = "request") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response = null;
  try {
    response = await testFetch(url, { ...options, signal: controller.signal });
    // 0.5.7: response.text() is not natively abortable through
    // the same AbortController (Node's Response.text() does
    // not take a signal). We bridge it: when the controller
    // fires, cancel the underlying ReadableStream so the
    // .text() promise rejects with a recognizable error. The
    // cancel() is idempotent — safe to call even if the body
    // already finished — and is the documented way to abort
    // a fetch body in undici.
    const text = await new Promise((resolve, reject) => {
      const onAbort = () => {
        try { response?.body?.cancel?.(); } catch { /* ignore */ }
        reject(new Error(`${label} body read timed out after ${timeoutMs}ms (${url})`));
      };
      if (controller.signal.aborted) {
        onAbort();
        return;
      }
      controller.signal.addEventListener("abort", onAbort, { once: true });
      response.text().then(
        (value) => { controller.signal.removeEventListener("abort", onAbort); resolve(value); },
        (error) => { controller.signal.removeEventListener("abort", onAbort); reject(error); }
      );
    });
    return { response, text };
  } catch (error) {
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR")) {
      throw new Error(`${label} timed out after ${timeoutMs}ms (${url})`);
    }
    // Surface the underlying cause chain (ECONNRESET,
    // ECONNREFUSED, etc.) so a flaky relay in the chained test
    // can be attributed to the right hop instead of failing as
    // a bare "fetch failed".
    const detail = {
      message: error && error.message,
      name: error && error.name,
      code: error && error.code,
      cause: error && error.cause && (error.cause.code || error.cause.message)
    };
    throw new Error(`${label} failed: ${JSON.stringify(detail)} (${url})`);
  } finally {
    clearTimeout(timer);
  }
}
