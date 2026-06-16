// 0.5.9: collect a redacted, on-disk snapshot of the local
// openrelay install for `npm run doctor` / `scripts/doctor.mjs`.
//
// The contract is strict: this function must NEVER return a
// value that contains a real API key, the full relay token,
// an Authorization header, a session cookie, or the master
// key. It is safe to paste the output into a GitHub issue
// or an AI chat.
//
// We do NOT import src/server.js — that file is the live
// process entry point and importing it would start the HTTP
// listener, write a relay-token file, and try to bind the
// dashboard port. Doctor is a pure read-side tool.
//
// We DO reuse the auth helpers and config normalizer from
// the source tree (so the redaction contract stays in sync
// with /admin/status), and the schema validator.

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { describeAuth, maskToken, resolveRelayAuth } from "../src/auth.js";
import { loadConfig, normalizeConfig } from "../src/config.js";
import { validateConfig } from "../src/config-schema.js";

const here = fileURLToPath(import.meta.url);

export function collectDoctorReport(options = {}) {
  const {
    rootDir = resolve(dirname(here), ".."),
    env = process.env,
    platform = process.platform,
    arch = process.arch,
    nodeVersion = process.version,
    port = Number(env.PORT || 18765),
    fileExists = existsSync,
    readFile = readFileSync
  } = options;

  // 1. Version
  let version = "0.0.0";
  try {
    const pkg = JSON.parse(readFile(resolve(rootDir, "package.json"), "utf8"));
    version = String(pkg.version || "0.0.0");
  } catch {
    // ignore — doctor stays useful even without a package.json
  }

  // 2. Config (load + normalize + schema check)
  const configReport = {
    path: null,
    valid: false,
    activeProfile: null,
    providers: 0,
    routes: 0,
    profiles: 0,
    errors: [],
    providersDetail: []
  };
  try {
    const { config, configPath } = loadConfig(rootDir);
    configReport.path = configPath;
    const normalized = normalizeConfig(JSON.parse(JSON.stringify(config)));
    configReport.providers = Array.isArray(normalized.providers) ? normalized.providers.length : 0;
    configReport.routes = Array.isArray(normalized.routes) ? normalized.routes.length : 0;
    configReport.profiles = Array.isArray(normalized.profiles) ? normalized.profiles.length : 0;
    configReport.activeProfile = normalized.activeProfile || null;
    configReport.providersDetail = Array.isArray(normalized.providers)
      ? normalized.providers.map(p => {
          let hostname = "";
          try { hostname = new URL(p.baseUrl).hostname; } catch { /* invalid URL */ }
          const isLocal = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1" || hostname === "[::1]";
          const hasKey = p.keyEnv ? !!process.env[p.keyEnv] : false;
          return { name: p.name, hasKey, isLocal };
        })
      : [];
    const result = validateConfig(normalized);
    if (result && result.ok) {
      configReport.valid = true;
    } else {
      configReport.valid = false;
      configReport.errors = (result && result.errors) || [];
    }
  } catch (error) {
    configReport.errors = [
      { path: "(load)", message: error && error.message ? error.message : String(error) }
    ];
  }

  // 3. Auth state (use the real resolver, but with readonly=true
  //    so it never writes data/security/relay-token on disk).
  const auth = resolveRelayAuth({ env, rootDir, readonly: true });
  const authPublic = describeAuth(auth);
  const relayAuth = {
    tokenRequired: !!authPublic.tokenRequired,
    allowNoAuth: !!authPublic.allowNoAuth,
    tokenSource: authPublic.tokenSource || "unset",
    apiKeyMasked: authPublic.apiKeyMasked || "(none)"
  };

  // 4. Runtime state
  const statePath = env.OPENRELAY_STATE
    ? resolve(rootDir, env.OPENRELAY_STATE)
    : resolve(rootDir, "data", "runtime-state.json");
  const runtimeState = {
    path: statePath,
    exists: fileExists(statePath),
    sizeBytes: 0,
    updatedAt: null
  };
  if (runtimeState.exists) {
    try {
      const st = statSync(statePath);
      runtimeState.sizeBytes = st.size;
      runtimeState.updatedAt = st.mtime.toISOString();
    } catch {
      // ignore
    }
  }

  // 5. Security file presence (no content, just "yes/no")
  const security = {
    relayTokenFile: null,
    masterKeyFile: null,
    encryptedKeysFile: null
  };
  const relayTokenPath = resolve(rootDir, "data", "security", "relay-token");
  const masterKeyPath = resolve(rootDir, "data", "master.key");
  const encKeysPath = resolve(rootDir, "data", "keys.enc.json");
  security.relayTokenFile = {
    path: relayTokenPath,
    exists: fileExists(relayTokenPath)
  };
  security.masterKeyFile = {
    path: masterKeyPath,
    exists: fileExists(masterKeyPath)
  };
  security.encryptedKeysFile = {
    path: encKeysPath,
    exists: fileExists(encKeysPath)
  };

  // 6. Error log presence (we read the count, not the body)
  let errorLog = { path: null, exists: false };
  // The error log is in-memory only in this version; surface
  // the file path the server uses for its state file (the
  // same one that holds recentErrors[]) so the operator can
  // verify it without us echoing contents.
  errorLog = { path: statePath, exists: runtimeState.exists };

  return {
    version,
    node: nodeVersion,
    platform,
    arch,
    rootDir,
    port,
    bindHost: "127.0.0.1",
    config: configReport,
    relayAuth,
    runtimeState,
    security,
    errorLog,
    // Surface the mask helper so the redaction test can assert
    // the same behavior against a synthetic token.
    _helpers: { maskToken }
  };
}
