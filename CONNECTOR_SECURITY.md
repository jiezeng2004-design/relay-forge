# Connector Security Design

> **Status**: Design document, not yet implemented. \
> **Applies to**: Phase 5 — Local App Credential Connectors \
> **Principle**: All connectors are **default OFF**. No local app token/cookie is ever read without explicit user action.

---

## 1. What Connectors Do

Connectors let the relay discover and use **local app AI quotas** — the tokens/cookies/sessions that applications like Claude Desktop, Claude Code, Kiro, Windsurf, etc. leave on your machine so you don't have to paste API keys manually.

**Example**: Instead of getting a Claude API key from Anthropic's website and entering it in the Dashboard, a connector reads the local Claude Desktop session cookie so the relay can proxy requests through Claude Pro/Max.

## 2. Safety Guarantees

| Guarantee | Detail |
|-----------|--------|
| **Default OFF** | Every connector is disabled at first launch. No auto-discovery of credentials. |
| **Per-connector toggle** | Enabling Claude Desktop does not enable Windsurf or any other connector. |
| **Dry-run first** | Before reading any credential, the connector shows what it *would* read and from where. The user must explicitly confirm. |
| **Read-only, in-memory** | Credentials are read into process memory only. Never written to disk, never logged, never uploaded. |
| **No egress** | Credentials never leave the local machine. The relay uses them only to authenticate with the credential's original provider. |
| **Redacted logs** | All log output that touches a credential shows only a masked form (first 6 + last 4 chars). Full credentials never appear in stdout, stderr, error logs, or diagnostics. |
| **Clearable** | A "Clear all connector credentials" button in Settings wipes all in-memory tokens immediately. |
| **Fresh on restart** | Connector credentials are held in memory only. A relay restart requires re-reading (after user re-enables). |

## 3. Per-Connector Specification

### 3.1 Claude Desktop

| Aspect | Detail |
|--------|--------|
| Credential | Local Claude Desktop session cookie |
| Source | macOS Keychain (`~/Library/Application Support/Claude/`) or Windows credential store |
| Read method | Read local session file; only after user toggles ON and confirms dry-run path |
| Storage | In-memory only; never persisted |
| Used for | Proxying `/v1/messages` requests through Claude Pro/Max account |
| Dry-run shows | Path to session file, app version, last used timestamp (no token value) |

### 3.2 Claude Code

| Aspect | Detail |
|--------|--------|
| Credential | Claude Code CLI session |
| Source | `~/.claude/` or `CLAUDE_CONFIG` env |
| Read method | Read credentials file; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying requests through Claude account |
| Dry-run shows | Config path, available profiles (no token value) |

### 3.3 Kiro (AWS)

| Aspect | Detail |
|--------|--------|
| Credential | Kiro app session / AWS Cognito token |
| Source | Kiro local storage / keychain |
| Read method | Read Kiro config; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying requests through Kiro account |
| Dry-run shows | App install path, account email mask (no token) |

### 3.4 Windsurf (Codeium)

| Aspect | Detail |
|--------|--------|
| Credential | Windsurf IDE session |
| Source | Windsurf config / local storage |
| Read method | Read Windsurf config; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying through Windsurf account |
| Dry-run shows | Config path, IDE version |

### 3.5 Antigravity

| Aspect | Detail |
|--------|--------|
| Credential | Antigravity app session |
| Source | Antigravity local storage |
| Read method | Read Antigravity config; only after user toggle |
| Storage | In-memory only |
| Used for | Gemini-compatible route through Antigravity |
| Dry-run shows | App install path, Gemini config |

### 3.6 OpenCode

| Aspect | Detail |
|--------|--------|
| Credential | OpenCode local config |
| Source | `~/.config/opencode/` or `OPENCODE_CONFIG` env |
| Read method | Read config file; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying through OpenCode-integrated models |
| Dry-run shows | Config path, profiles (no token) |

### 3.7 VS Code Copilot

| Aspect | Detail |
|--------|--------|
| Credential | GitHub Copilot token |
| Source | VS Code / GitHub auth storage |
| Read method | Read GitHub auth token; only after user toggle |
| Storage | In-memory only |
| Used for | Ollama BYOK bridge (Copilot Chat → local model) |
| Dry-run shows | GitHub auth status, VS Code version |

### 3.8 OpenAI Codex

| Aspect | Detail |
|--------|--------|
| Credential | Codex CLI local auth |
| Source | `~/.codex/` config |
| Read method | Read Codex config; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying through Codex account |
| Dry-run shows | Config path, available endpoints |

### 3.9 Gemini CLI

| Aspect | Detail |
|--------|--------|
| Credential | Gemini CLI OAuth credentials |
| Source | `~/.gemini/oauth_creds.json` |
| Read method | Read OAuth file; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying through Gemini API account |
| Dry-run shows | File path, account email (no token) |

### 3.10 Rovo Dev

| Aspect | Detail |
|--------|--------|
| Credential | Atlassian / Rovo Dev config |
| Source | Atlassian config or env vars |
| Read method | Read config; only after user toggle |
| Storage | In-memory only |
| Used for | Proxying through Rovo account |
| Dry-run shows | Config path, available models |

### 3.11 QClaw

| Aspect | Detail |
|--------|--------|
| Credential | QClaw local gateway |
| Source | QClaw config / local gateway port |
| Read method | Detect gateway; only after user toggle |
| Storage | In-memory only |
| Used for | Agent gateway routing |
| Dry-run shows | Gateway URL, available agents |

## 4. Implementation Plan

### 4.1 Module Structure

```
src/connectors/
  connector-registry.js    # Registry of all connectors (metadata only)
  connector-base.js         # Base class / interface
  connectors/
    claude-desktop.js       # Claude Desktop connector
    claude-code.js
    kiro.js
    windsurf.js
    antigravity.js
    opencode.js
    vscode-copilot.js
    codex.js
    gemini-cli.js
    rovo-dev.js
    qclaw.js
```

### 4.2 Connector Interface

```javascript
class Connector {
  // Metadata
  static id = "claude-desktop";
  static name = "Claude Desktop";
  static description = "Use Claude Pro/Max quota via local session";

  // Lifecycle
  async detect()          // Dry-run: detect app, return paths, no credential reading
  async connect()         // Read credential into memory (user must confirm first)
  async disconnect()      // Clear in-memory credential
  async status()          // Return connected/disconnected/error

  // Credential access (read-only after connect)
  getCredential()         // Return the in-memory token/cookie (null if disconnected)
  getMasked()             // Return masked form for display
}
```

### 4.3 Dashboard Integration

- **Settings tab**: New "Connectors" section with toggle switches
- **Each toggle**: Shows dry-run info before enabling
- **Status indicator**: Connected/disconnected/error per connector
- **Clear all**: One button to disconnect all connectors and wipe memory

### 4.4 Routing Integration

When a connector is active, its credential is available to the proxy handler:

```
Request with model=claude-desktop
  → connector-registry.getCredential("claude-desktop")
  → if available: use as upstream API key
  → if unavailable: fall back to normal routing
```

## 5. Audit & Transparency

- All connector code is in `src/connectors/` for easy review
- The credential reading functions are isolated and never mixed with config/state code
- `npm run doctor` reports connector status (connected/disconnected) but NEVER outputs the credential value
- Dashboard shows per-connector status without exposing the credential

## 6. Threat Model

| Threat | Mitigation |
|--------|-----------|
| Malicious website at 127.0.0.1 reads connector tokens | All connectors default OFF; tokens exist only in relay process memory, not exposed to web pages |
| Extension access to Dashboard | Dashboard only shows "connected" status, never the token value; /admin/auth/token only returns RELAY_TOKEN, not connector tokens |
| Process memory dump | Same risk as any credential stored in process memory; connector tokens are not written to disk |
| Relay restart | All in-memory credentials are lost; user must re-enable connectors |
| Accidental log exposure | All connector-related log output is redacted; unit tests enforce no-full-token-in-log |
| Operator error (forgot to disable) | "Clear all" button in Settings; periodic nag if connectors active for >24h |

## 7. Testing

| Test | Description |
|------|-------------|
| `test-connector-detect.mjs` | Dry-run shows paths, doesn't read credentials |
| `test-connector-connect.mjs` | Connect without user confirmation is rejected |
| `test-connector-redact.mjs` | No full credential in any output |
| `test-connector-clear.mjs` | Disconnect + clear wipes memory |
| `test-connector-dashboard.mjs` | Dashboard shows status without exposing token |

---

> **Document version**: 1.0 \
> **Last updated**: 2026-06-11 \
> **Status**: Design only — not implemented
