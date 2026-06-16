// Local relay authentication (0.5.3+ / v0.1.0).
//
// The relay is bound to 127.0.0.1, but a browser tab still has a
// script that can hit `/v1/chat/completions` and burn the operator's
// upstream quota. To close that hole, we now require a Bearer token
// for /v1/* (chat / responses / messages) by default. The token can
// come from three sources, in priority order:
//
//   1. `RELAYFORGE_TOKEN` (recommended). Use this when you want
//      a stable, hand-managed token.
//   2. `RELAY_TOKEN` (legacy openrelay alias)
//   3. `OPENRELAY_TOKEN` (legacy openrelay alias)
//   4. A persisted token at `<rootDir>/data/security/relay-token`
//      (mode 0o600). The server auto-generates this on first start
//      and reuses it on every subsequent start.
//   5. Auto-generated on disk if none of the above are present.
//
// To run without authentication, set `RELAYFORGE_ALLOW_NO_AUTH=true`
// (or the legacy `OPENRELAY_ALLOW_NO_AUTH=true`) explicitly.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";

const TOKEN_BYTES = 32;
const RELAY_TOKEN_RELATIVE_PATH = "data/security/relay-token";

export function resolveRelayAuth(options = {}) {
  const {
    env = process.env,
    rootDir,
    random = randomBytes,
    fileExists = existsSync,
    readFile = readFileSync,
    writeFile = writeFileSync,
    mkdir = mkdirSync,
    chmod = chmodSync,
    logger = null,
    readonly = false
  } = options;

  if (!rootDir) throw new Error("resolveRelayAuth: rootDir is required");

  if (env.RELAYFORGE_ALLOW_NO_AUTH === "true" || env.OPENRELAY_ALLOW_NO_AUTH === "true") {
    return {
      token: "",
      source: "allowNoAuth",
      allowNoAuth: true,
      tokenFilePath: null,
      masked: null,
      note: "RELAYFORGE_ALLOW_NO_AUTH=true"
    };
  }

  if (env.RELAYFORGE_TOKEN && String(env.RELAYFORGE_TOKEN).trim()) {
    const token = String(env.RELAYFORGE_TOKEN).trim();
    return {
      token,
      source: "env",
      allowNoAuth: false,
      tokenFilePath: null,
      masked: maskToken(token),
      note: "RELAYFORGE_TOKEN from environment"
    };
  }

  if (env.RELAY_TOKEN && String(env.RELAY_TOKEN).trim()) {
    const token = String(env.RELAY_TOKEN).trim();
    return {
      token,
      source: "env",
      allowNoAuth: false,
      tokenFilePath: null,
      masked: maskToken(token),
      note: "RELAY_TOKEN from environment (openrelay compat)"
    };
  }

  if (env.OPENRELAY_TOKEN && String(env.OPENRELAY_TOKEN).trim()) {
    const token = String(env.OPENRELAY_TOKEN).trim();
    return {
      token,
      source: "openrelay_env",
      allowNoAuth: false,
      tokenFilePath: null,
      masked: maskToken(token),
      note: "OPENRELAY_TOKEN from environment (openrelay compat)"
    };
  }

  const tokenFilePath = resolve(rootDir, RELAY_TOKEN_RELATIVE_PATH);
  if (fileExists(tokenFilePath)) {
    try {
      const existing = String(readFile(tokenFilePath, "utf8") || "").trim();
      if (existing) {
        return {
          token: existing,
          source: "disk",
          allowNoAuth: false,
          tokenFilePath,
          masked: maskToken(existing),
          note: `loaded from ${RELAY_TOKEN_RELATIVE_PATH}`
        };
      }
    } catch {
      // Fall through to re-generate.
    }
  }

  // 0.5.4: in --check (and any other read-only) mode we MUST NOT
  // write the token file. Pretend we are still in token-required
  // mode (so the rest of the server / buildStatus surface is
  // shaped correctly) but return an empty token. The startup
  // banner is suppressed in this mode (handled by the caller).
  if (readonly) {
    return {
      token: "",
      source: "check-readonly",
      allowNoAuth: false,
      tokenFilePath: null,
      masked: "",
      note: "check mode; token not generated"
    };
  }

  const generated = random(TOKEN_BYTES).toString("hex");
  try {
    mkdir(dirname(tokenFilePath), { recursive: true });
    writeFile(tokenFilePath, `${generated}\n`, { mode: 0o600 });
    try {
      chmod(tokenFilePath, 0o600);
    } catch {
      // Windows often ignores POSIX mode bits; the directory ACL
      // is the operator's real protection. Best effort.
    }
  } catch (error) {
    if (logger) logger.error(`[openrelay] failed to persist relay token: ${error.message}`);
    return {
      token: generated,
      source: "generated",
      allowNoAuth: false,
      tokenFilePath: null,
      masked: maskToken(generated),
      note: "auto-generated (in-memory only; persistence failed)"
    };
  }
  return {
    token: generated,
    source: "generated",
    allowNoAuth: false,
    tokenFilePath,
    masked: maskToken(generated),
    note: `auto-generated, saved at ${RELAY_TOKEN_RELATIVE_PATH}`
  };
}

export function parseOpenRelayKey(token) {
  if (!token || typeof token !== "string") return null;
  const match = token.match(/^sk-or-([A-Za-z0-9_-]+(?::[A-Za-z0-9._/-]+)?)-([A-Fa-f0-9]{6,})$/);
  if (!match) return null;
  return {
    target: match[1],
    hex: match[2]
  };
}

export function maskToken(token) {
  if (!token) return "";
  const text = String(token);
  if (text.length <= 4) return "****";
  if (text.length <= 10) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  return `${text.slice(0, 6)}...${text.slice(-4)}`;
}

// Shape used by `buildStatus().relayAuth` and the Dashboard
// inline script. 0.5.4 removes the full `apiKey` field from the
// public status: it was previously exposed via /admin/status and
// surfaced in `npm run check` output, which is a release-grade
// token leak. The full token is now reachable only via
// /admin/auth/token (admin-authed). Visible fields are masked
// hints only.
export function describeAuth(auth) {
  if (!auth) {
    return {
      tokenRequired: false,
      allowNoAuth: true,
      apiKeyHint: "local",
      apiKeyMasked: "local",
      tokenSource: "unset"
    };
  }
  if (auth.allowNoAuth) {
    return {
      tokenRequired: false,
      allowNoAuth: true,
      apiKeyHint: "local",
      apiKeyMasked: "local",
      tokenSource: "allowNoAuth"
    };
  }
  if (auth.source === "check-readonly") {
    // --check mode: never expose a token. Tell the operator to
    // run the server normally to generate / load one.
    return {
      tokenRequired: true,
      allowNoAuth: false,
      apiKeyHint: "(check mode)",
      apiKeyMasked: "(check mode)",
      tokenSource: "check-readonly"
    };
  }
  return {
    tokenRequired: true,
    allowNoAuth: false,
    apiKeyHint: auth.masked || maskToken(auth.token),
    apiKeyMasked: auth.masked || maskToken(auth.token),
    tokenSource: auth.source
  };
}

export const RELAY_TOKEN_FILE_RELATIVE = RELAY_TOKEN_RELATIVE_PATH;
