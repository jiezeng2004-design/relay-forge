# v0.1.0 — First Public Release of RelayForge

## Highlights

- **First public release** under the RelayForge name
- **Zero-dependency** local-first AI coding gateway
- **OpenAI / Anthropic compatible** — `/v1/chat/completions`, `/v1/messages`, `/v1/responses`, `/v1/models`
- **Combo model routing** — virtual models with fallback / round_robin / weighted_round_robin
- **`profile.defaultModel`** supports combo names
- **Combo models** in `/v1/models` response
- **Privacy by default** — prompts never logged, API keys redacted
- **Recent requests** — last 20 request metadata in `/admin/status`
- **Provider capabilities** — `providerCapabilities` in `/admin/status`
- **Crash-safe** failure paths for no-key / unreachable upstream / fallback exhaustion
- **MIT license** with third-party notices

## Why this release matters

RelayForge is designed for AI coding tools that need a single local endpoint for multiple
LLM providers. It deliberately avoids risky OAuth subscription token routing:
- **API-key based** — you control which keys are used
- **Local-first** — no cloud dependency, no telemetry
- **Transparent** — every request is logged with metadata (no prompt content by default)

This makes RelayForge a safer, lighter alternative to heavier AI gateway stacks
when your goal is local development with AI coding tools.

## Upgrade / migration notes

- Project renamed from `openrelay-like` to **RelayForge**
- Public version starts at **v0.1.0**
- **`RELAYFORGE_*`** environment variables are now recommended:
  - `RELAYFORGE_TOKEN` → relay authentication
  - `RELAYFORGE_CONFIG` → custom config path
  - `RELAYFORGE_STATE` → custom runtime state path
- **`OPENRELAY_*`** variables remain backward-compatible
- Config now supports `combos` and `privacy` sections
- `profile.defaultModel` can reference combo names

## Verification

Run these commands to verify the release:

```bash
npm run check
npm run test:unit
npm run test:combo-e2e
npm run test:crash
npm run build-dist
```

## Known limitations

- No OAuth subscription token routing
- No built-in provider accounts
- No cloud sync
- No guarantee of upstream free model availability
- Prompt content is not logged by default (this is intentional)

## Assets

See [docs/assets/README.md](assets/README.md) for the screenshot and demo GIF checklist.
