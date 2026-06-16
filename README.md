# RelayForge v0.3.0

**Zero-dependency local-first AI coding gateway** 鈥?OpenAI / Anthropic compatible.
Unify your local (Ollama / LM Studio) and cloud API providers behind `http://127.0.0.1:18765/v1` with combo routing,
fallback, request privacy, and lightweight usage analytics.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)]()

---

## Why RelayForge?

AI coding tools (Codex, opencode, Claude Code, CC Switch, Cline) need access to multiple LLM providers.
Managing API keys, rate limits, fallback behavior, and privacy across every tool is painful.
RelayForge gives you a single local endpoint that handles it all 鈥?with zero npm dependencies.

```mermaid
flowchart LR
  A[AI coding client] --> B[RelayForge /v1 endpoint]
  B --> C[Combo resolver]
  C --> D[Provider candidates]
  D --> E1[Ollama local]
  D --> E2[DeepSeek API]
  D --> E3[Groq API]
  D --> E4[...]
  B --> F[RequestLog / Privacy]
  B --> G[Usage Analytics]
```

## Features

- **Premium Dashboard UX** - v0.3.0 adds screenshot-ready Overview, Providers, Combo Models, Clients, Usage, Diagnostics, and Settings pages with light/dark/system appearance support.
- **Zero dependencies** 鈥?runs on Node.js built-ins only
- **Local-first** 鈥?binds to `127.0.0.1` by default, no telemetry, no cloud lock-in
- **OpenAI / Anthropic compatible** 鈥?`/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`
- **Combo models** 鈥?virtual model names that combine multiple providers with fallback / round_robin / weighted_round_robin
- **Smart fallback** 鈥?429/503/timeout triggers cascade to the next candidate
- **Privacy by default** 鈥?prompts are never logged; API keys are redacted
- **Recent requests** 鈥?last 20 request metadata (model, provider, latency, status) without prompt content
- **Provider registry** 鈥?capability-based provider queries (`openai_chat`, `anthropic_messages`, `streaming`, `tools`...)
- **No OAuth subscription tokens** 鈥?RelayForge does not read or forward Claude Code / Codex / Cursor personal tokens

## Quick Start

### A. Windows zip users

1. Unzip `relayforge-0.3.0.zip`
2. Double-click **`Start_RelayForge.cmd`**
3. Open http://127.0.0.1:18765 in your browser
4. Copy the token from the startup log
5. In your AI coding tool, set:
   ```
   Base URL: http://127.0.0.1:18765/v1
   API Key:  <RELAYFORGE_TOKEN from startup log>
   Model:    smart-coding
   ```

### B. PowerShell users

```powershell
$env:RELAYFORGE_TOKEN = "my-local-token"
$env:RELAYFORGE_PORT  = "18765"
node src/server.js
```

### C. macOS / Linux / WSL users

```bash
export RELAYFORGE_TOKEN="my-local-token"
export RELAYFORGE_PORT="18765"
node src/server.js
```

### D. Verify with curl

```bash
# List models
curl http://127.0.0.1:18765/v1/models \
  -H "Authorization: Bearer my-local-token"

# Chat completion
curl http://127.0.0.1:18765/v1/chat/completions \
  -H "Authorization: Bearer my-local-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"smart-coding","messages":[{"role":"user","content":"Hello!"}]}'

# Admin status
curl http://127.0.0.1:18765/admin/status \
  -H "Authorization: Bearer my-local-token"
```

## Client Setup

### CC Switch

```
Name: RelayForge
Base URL: http://127.0.0.1:18765/v1
API Key: <RELAYFORGE_TOKEN>
Model: smart-coding (or any combo/route/provider:model)
```

### opencode

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "smart-coding" }
    }
  },
  "models": {
    "providers": {
      "relayforge": {
        "baseUrl": "http://127.0.0.1:18765/v1",
        "apiKey": "<RELAYFORGE_TOKEN>",
        "api": "openai-completions",
        "models": [{ "id": "smart-coding" }]
      }
    }
  }
}
```

### Codex / OpenAI-compatible clients

```bash
export OPENAI_BASE_URL="http://127.0.0.1:18765/v1"
export OPENAI_API_KEY="<RELAYFORGE_TOKEN>"
```

### Claude Code (OpenAI-compatible mode)

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:18765/v1"
export ANTHROPIC_API_KEY="<RELAYFORGE_TOKEN>"
```

> **Security note:** RelayForge uses API-key based configuration. It does not read or forward OAuth subscription tokens from Claude Code, Codex, or Cursor. Your upstream provider credentials stay under your control.

## Configuration

### Providers

```json
{
  "providers": [
    { "name": "ollama", "baseUrl": "http://127.0.0.1:11434/v1", "models": ["qwen2.5:7b"] },
    { "name": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "keyEnv": "DEEPSEEK_API_KEYS", "models": ["deepseek-chat"] }
  ]
}
```

### Routes

Routes define named model groups with fallback/round_robin/weighted strategies:

```json
{
  "routes": [{
    "name": "coding-local",
    "strategy": "fallback",
    "candidates": [
      { "provider": "deepseek", "model": "deepseek-chat", "weight": 3 },
      { "provider": "ollama", "model": "qwen2.5:7b", "weight": 1 }
    ]
  }]
}
```

### Combo Models (v0.1.0)

Combos are virtual models with built-in health-aware routing:

```json
{
  "combos": [{
    "name": "smart-coding",
    "strategy": "fallback",
    "candidates": [
      { "provider": "deepseek", "model": "deepseek-chat", "weight": 3, "priority": 2, "enabled": true },
      { "provider": "groq", "model": "llama-3.1-8b-instant", "weight": 2, "priority": 1, "enabled": true },
      { "provider": "ollama", "model": "qwen2.5:7b", "weight": 1, "priority": 0, "enabled": true }
    ]
  }, {
    "name": "weighted-pool",
    "strategy": "weighted_round_robin",
    "candidates": [
      { "provider": "deepseek", "model": "deepseek-chat", "weight": 5 },
      { "provider": "siliconflow", "model": "Qwen/Qwen2.5-7B-Instruct", "weight": 2 },
      { "provider": "ollama", "model": "qwen2.5:7b", "weight": 1 }
    ]
  }]
}
```

Use `profile.defaultModel` to reference combo names:

```json
{
  "profiles": [{
    "name": "coding",
    "defaultModel": "smart-coding"
  }]
}
```

### Privacy

```json
{
  "privacy": {
    "logPrompts": false,
    "logHeaders": false
  }
}
```

Prompts are never stored in dashboard logs by default.

## Environment Variables

| Variable | Recommended | Legacy (backward compat) |
|----------|-------------|-------------------------|
| `RELAYFORGE_TOKEN` | 鉁?Token for /v1/* and /admin/* | `RELAY_TOKEN` / `OPENRELAY_TOKEN` |
| `RELAYFORGE_CONFIG` | 鉁?Custom config path | `OPENRELAY_CONFIG` |
| `RELAYFORGE_STATE` | 鉁?Custom state path | `OPENRELAY_STATE` |
| `RELAYFORGE_PORT` | 鉁?Port override | `PORT` / `OPENRELAY_PORT` |
| `RELAYFORGE_ALLOW_NO_AUTH` | 鉁?Disable auth (dev only) | `OPENRELAY_ALLOW_NO_AUTH` |

If both `RELAYFORGE_*` and `OPENRELAY_*` are set, `RELAYFORGE_*` takes precedence.

## Comparison

| | RelayForge | LiteLLM | One API | 9Router |
|---|---|---|---|---|
| Dependencies | **Zero npm** | Heavy | Heavy | Heavy |
| Local-first | 鉁?| 鉂?| 鉂?| 鉂?|
| OAuth token routing | 鉂?| 鉂?| 鉂?| 鉁?|
| Combo models | 鉁?| 鉁?| 鉂?| 鉁?|
| Privacy logs | 鉁?| 鉂?| 鉂?| 鉂?|
| MIT License | 鉁?| 鉁?| 鉁?| 鉁?|

## Roadmap

**v0.1.x** 鈥?Polish docs, screenshots, demo GIFs, client setup guides, CI stabilization

**v0.2.x** 鈥?Better dashboard UX, provider health page, config import/export, config validation UI, token/cost estimation

**v0.3.x** 鈥?Plugin-like provider templates, more AI coding client presets, optional local encrypted secrets, Docker support

**Not planned:** OAuth subscription routing, cloud-hosted key sync, built-in account sharing, bypassing provider rate limits, storing full prompts by default.

---

[MIT License](LICENSE) 路 [Third Party Notices](THIRD_PARTY_NOTICES.md) 路 [Release Notes](docs/release-v0.3.0.md)

