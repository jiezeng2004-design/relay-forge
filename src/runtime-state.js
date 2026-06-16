// 0.5.9: serialized runtime state persistence.
//
// The 0.5.8 line wrote the runtime state file with a fixed
// `<statePath>.tmp` temporary file. Concurrent callers (record
// latency, record stream usage, update health cache, etc.) could
// all call `persistRuntimeState()` inside the same tick, race on
// the same temp file, and on Windows occasionally trip an EPERM
// during the `rename(tmp, final)` step. The relay's response path
// would then 500 the client or hand back an ECONNRESET on the
// next stream.
//
// The fix is a single-flight write queue. Every caller hands the
// persister the latest snapshot; the queue is the only place that
// touches the filesystem, and it drains in insertion order. Each
// snapshot gets its own unique temp file name (PID + Date.now() +
// random hex), so a failure mid-rename can never leave a partial
// temp file that a later caller would mistake for live state.
//
// Contract:
//   * persist(snapshot) — non-blocking; returns the current queue
//     promise so callers can `await` it for tests / shutdown.
//   * flush() — await the queue so cleanup code (test teardown,
//     `await flushRuntimeState()` in server.js) can be sure every
//     queued snapshot has been written before it removes the temp
//     directory.
//   * Write failures are logged with the file path and message,
//     never rethrown. The relay's request path must not 500
//     because persistence hiccupped.

import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createRuntimeStatePersister(statePath, options = {}) {
  const {
    serialize = JSON.stringify,
    tmpSuffix = ".tmp",
    logger = console,
    debounceMs = 200
  } = options;

  if (!statePath || typeof statePath !== "string") {
    throw new Error("createRuntimeStatePersister: statePath is required");
  }

  let writeQueue = Promise.resolve();
  let pendingState = null;
  let debounceTimer = null;
  let writeCount = 0;
  let writesCompleted = 0;

  function uniqueTmpPath() {
    const rand = Math.random().toString(16).slice(2, 10);
    return `${statePath}.${process.pid}.${Date.now()}.${writeCount++}.${rand}${tmpSuffix}`;
  }

  async function writeStateSnapshot(snapshot) {
    const tmpPath = uniqueTmpPath();
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(tmpPath, serialize(snapshot, null, 2) + "\n", "utf8");
    await rename(tmpPath, statePath);
    writesCompleted += 1;
  }

  function scheduleFlush() {
    writeQueue = writeQueue
      .catch(() => {})
      .then(async () => {
        while (pendingState) {
          const current = pendingState;
          pendingState = null;
          try {
            await writeStateSnapshot(current);
          } catch (error) {
            const code = error && error.code ? ` (${error.code})` : "";
            const message = error && error.message ? error.message : String(error);
            try {
              logger.warn?.(
                `[runtime-state] failed to persist state at ${statePath}${code}: ${message}`
              );
            } catch {
              // no-op
            }
          }
        }
      });
    return writeQueue;
  }

  function persist(snapshot) {
    pendingState = snapshot;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (debounceMs > 0) {
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        scheduleFlush();
      }, debounceMs);
      return writeQueue;
    }

    return scheduleFlush();
  }

  async function flush() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      scheduleFlush();
    }
    await writeQueue;
  }

  function stats() {
    return {
      pending: pendingState !== null || debounceTimer !== null,
      flushScheduled: debounceTimer !== null,
      writes: writeCount,
      writesCompleted
    };
  }

  return {
    persist,
    flush,
    stats
  };
}
