# RelayForge Demo Guide

## A. CC Switch Integration

### Configuration

| Field | Value |
|-------|-------|
| Name | RelayForge |
| Base URL | `http://127.0.0.1:18765/v1` |
| API Key | `<YOUR_RELAYFORGE_TOKEN>` |
| Model | `smart-coding` (or any combo name) |

### Verification

1. Set `RELAYFORGE_TOKEN` and start RelayForge
2. In CC Switch, create a new provider with the values above
3. Send a test message: "你好，列出当前目录文件"
4. Expected: request reaches RelayForge, combo routes to the first available provider
5. Check `/admin/status` → `recentRequests` shows the request metadata

## B. opencode Integration

### Configuration

Add to your opencode config (`~/.opencode/opencode.json` or AGENTS.md):

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "relayforge:smart-coding" }
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

### Verification

```bash
opencode "Hello, what models are available?"
```

Expected: opencode connects via RelayForge, combo routing selects a provider.

## C. Codex / OpenAI-compatible Client

### Environment variables

```bash
export OPENAI_BASE_URL="http://127.0.0.1:18765/v1"
export OPENAI_API_KEY="<RELAYFORGE_TOKEN>"
```

> This is standard OpenAI-compatible API key usage. RelayForge does not read OAuth tokens.

## D. Fallback Demo

1. Create `config.json` with:

```json
{
  "defaultProvider": "provider-a",
  "providers": [
    { "name": "provider-a", "baseUrl": "http://127.0.0.1:19999/v1", "models": ["model-a"] },
    { "name": "provider-b", "baseUrl": "http://127.0.0.1:11434/v1", "models": ["qwen2.5:7b"] }
  ],
  "combos": [{
    "name": "fallback-demo",
    "strategy": "fallback",
    "candidates": [
      { "provider": "provider-a", "model": "model-a" },
      { "provider": "provider-b", "model": "qwen2.5:7b" }
    ]
  }]
}
```

2. Start RelayForge with `RELAYFORGE_ALLOW_NO_AUTH=true`
3. Request `model=fallback-demo`:
   ```bash
   curl -X POST http://127.0.0.1:18765/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"fallback-demo","messages":[{"role":"user","content":"hello"}]}'
   ```
4. Provider A (port 19999) is unreachable → fallback to Provider B (Ollama)
5. Check `/admin/status` → `recentRequests` shows the fallback chain

## E. Round Robin Demo

1. Add to config:

```json
{
  "combos": [{
    "name": "rr-demo",
    "strategy": "round_robin",
    "candidates": [
      { "provider": "provider-a", "model": "model-a" },
      { "provider": "provider-b", "model": "qwen2.5:7b" }
    ]
  }]
}
```

2. Send 4 consecutive requests to `model=rr-demo`
3. Expected: requests alternate between providers A/B/A/B
4. Check `/admin/status` → `recentRequests` shows alternating providers
