# RelayForge v0.3.0 Release Notes

RelayForge is a zero-dependency, local-first AI coding gateway that provides OpenAI / Anthropic compatible endpoints for local and cloud model providers.

## Highlights

- Local-first gateway on `127.0.0.1:18765`
- OpenAI-compatible `/v1/chat/completions`, `/v1/responses`, `/v1/models`
- Anthropic-compatible `/v1/messages`
- Combo model routing with fallback / round-robin / weighted strategies
- Privacy-first request metadata logging without prompt storage by default
- Dashboard pages for Overview, Providers, Combo Models, Clients, Usage, Diagnostics, and Settings
- CI verified on Node 18 / 20 / 22 across Ubuntu and Windows
- Light, dark, and system appearance modes powered by CSS variables
- Product-style Overview with running status, Quick Connect, Setup Progress, metrics, and recent activity
- Combo Models page with visual routing path
- Clients page with copy-ready setup cards

## Screenshots

The v0.3.0 dashboard screenshots were captured from a real local RelayForge run with a clean demo config and demo token. The images show masked demo credentials only and do not include real API keys, private prompts, usernames, or local user paths.

| Overview | Combo Models |
| --- | --- |
| ![RelayForge overview](assets/relayforge-v0.3-overview-light.png) | ![RelayForge combo models](assets/relayforge-v0.3-combo-models.png) |

| Clients | Diagnostics |
| --- | --- |
| ![RelayForge clients](assets/relayforge-v0.3-clients.png) | ![RelayForge diagnostics](assets/relayforge-v0.3-diagnostics.png) |

Additional assets:

- `assets/relayforge-v0.3-overview-dark.png`
- `assets/relayforge-v0.3-providers.png`
- `assets/relayforge-v0.3-usage.png`
- `assets/relayforge-v0.3-settings.png`
- `assets/relayforge-v0.3-fallback-demo.gif`

## Security

- RelayForge uses API-key routing only.
- OAuth subscription token routing is not implemented.
- Full API keys, relay tokens, cookies, and prompts are not rendered in the dashboard.
- Diagnostic summaries remain redacted and safe to share.

## Install / Run

```bash
git clone https://github.com/jiezeng2004-design/relay-forge.git
cd relay-forge
node src/server.js
```

Then open:

```text
http://127.0.0.1:18765
```

## Client Setup

Use:

```text
Base URL: http://127.0.0.1:18765/v1
API Key: <your RelayForge local token>
Model: smart-coding
```

## Privacy Notes

RelayForge does not route OAuth subscription tokens and does not store full prompts by default. It is designed for local API-key based provider configuration.

## Verification

The v0.3.0 CI workflow passes on:

- Node 18 on ubuntu-latest
- Node 20 on ubuntu-latest
- Node 22 on ubuntu-latest
- Node 18 on windows-latest
- Node 20 on windows-latest
- Node 22 on windows-latest
