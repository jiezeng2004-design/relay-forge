// Config hot-reload watcher — uses node:fs.watch() + debounce + O_EXCL lock.
// Zero npm dependencies. Resilient to rename events (atomic-save editors)
// and transient file deletion. Invalid configs are rejected without
// disrupting the running server.

import { watch, existsSync, readFileSync, openSync, closeSync, unlinkSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

/**
 * Start watching configPath for changes. On change, debounce, re-read,
 * validate, and call onReload with the parsed file content (raw JSON,
 * not yet normalized — the caller is expected to normalizeConfig() it).
 *
 * The O_EXCL lock prevents concurrent reloads (e.g. the admin handler
 * writing config.json while the watcher also fires).
 *
 * @param {{
 *   configPath: string,
 *   lockDir: string,
 *   onReload: (rawConfig: object) => void | Promise<void>,
 *   onError?: (error: Error, context: string) => void | Promise<void>,
 *   debounceMs?: number
 * }} opts
 * @returns {{ stop: () => void }}
 */
export function startConfigWatcher(opts) {
  if (!opts || typeof opts !== "object") throw new TypeError("startConfigWatcher: opts required");
  const { configPath, lockDir, onReload, onError } = opts;
  if (typeof configPath !== "string" || !configPath) throw new TypeError("configPath must be a non-empty string");
  if (typeof lockDir !== "string" || !lockDir) throw new TypeError("lockDir must be a non-empty string");
  if (typeof onReload !== "function") throw new TypeError("onReload must be a function");
  const debounceMs = Math.max(100, Number(opts.debounceMs) || 500);

  const lockPath = resolve(lockDir, ".config-reload.lock");

  // Ensure lockDir exists so openSync('wx') doesn't fail on a missing dir.
  try { mkdirSync(lockDir, { recursive: true }); } catch { /* may already exist */ }

  let watcher = null;
  let debounceTimer = null;
  let stopped = false;

  function handleError(error, context) {
    if (onError) {
      try { onError(error, context); } catch { /* swallow */ }
    }
  }

  function acquireLock() {
    try {
      const fd = openSync(lockPath, "wx");
      return fd;
    } catch (e) {
      if (e.code === "EEXIST") {
        // Stale lock from a crashed process — best-effort cleanup + single retry.
        try { unlinkSync(lockPath); } catch { /* race */ }
        try { return openSync(lockPath, "wx"); } catch { return null; }
      }
      return null;
    }
  }

  function releaseLock(fd) {
    if (fd === null || fd === undefined) return;
    try { closeSync(fd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* already removed */ }
  }

  async function attemptReload() {
    if (stopped) return;
    let fd = null;
    try {
      fd = acquireLock();
      if (fd === null) {
        // Another reload is in progress; the debounce timer will
        // naturally retry on the next event.
        return;
      }
      if (!existsSync(configPath)) {
        handleError(new Error("config file was removed; keeping the last known config"), "file_missing");
        return;
      }
      const content = readFileSync(configPath, "utf8");
      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch (parseError) {
        handleError(parseError, "parse");
        return;
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        handleError(new Error("config must be a JSON object"), "validate");
        return;
      }
      await onReload(parsed);
    } catch (error) {
      handleError(error, "reload");
    } finally {
      releaseLock(fd);
    }
  }

  function scheduleReload() {
    if (stopped) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      attemptReload().catch((error) => handleError(error, "debounce_catch"));
    }, debounceMs);
  }

  function setupWatcher() {
    if (stopped) return;
    try {
      watcher = watch(configPath, { recursive: false }, (eventType) => {
        // Both 'change' and 'rename' events trigger a debounced reload.
        // 'rename' on Windows fires when editors do atomic save (write to
        // temp then rename over the original), so we must re-watch in
        // that case since the inode may have changed.
        scheduleReload();
        if (eventType === "rename" && !stopped) {
          // Re-watch: the file was replaced (atomic save) or temporarily
          // deleted. Close the old watcher and set up a new one after a
          // short delay.
          try { if (watcher) watcher.close(); } catch { /* already closed */ }
          watcher = null;
          setTimeout(() => {
            if (stopped) return;
            if (existsSync(configPath)) {
              setupWatcher();
            } else {
              // File is gone — keep polling for recreation.
              const recreationInterval = setInterval(() => {
                if (stopped) { clearInterval(recreationInterval); return; }
                if (existsSync(configPath)) {
                  clearInterval(recreationInterval);
                  setupWatcher();
                }
              }, 2000);
            }
          }, 200);
        }
      });
      watcher.on("error", (error) => handleError(error, "watcher_error"));
    } catch (error) {
      handleError(error, "setup_watcher");
      // Retry setup after 5s if the file doesn't exist yet.
      setTimeout(() => { if (!stopped) setupWatcher(); }, 5000);
    }
  }

  setupWatcher();

  return {
    stop() {
      stopped = true;
      if (debounceTimer) { clearTimeout(debounceTimer); debounceTimer = null; }
      try { if (watcher) watcher.close(); } catch { /* already closed */ }
      watcher = null;
    }
  };
}