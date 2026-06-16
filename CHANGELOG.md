# Changelog

## v0.1.0 - 2026-06-15

First public release under the RelayForge name. Earlier internal builds used the temporary
`openrelay-like` project name.

### Added

- First public release as **RelayForge**
- Combo model routing: `fallback`, `round_robin`, `weighted_round_robin`
- `profile.defaultModel` support for combo names
- Combo models listed in `/v1/models` response
- `privacy.logPrompts` / `privacy.logHeaders` config (default: `false`)
- `RequestLog` — recent 20 request metadata in `/admin/status`
- `providerCapabilities` field in `/admin/status`
- `RELAYFORGE_TOKEN`, `RELAYFORGE_CONFIG`, `RELAYFORGE_STATE` environment variables
- Crash regression tests for no-key, unreachable upstream, and concurrent failure scenarios

### Changed

- Public project identity renamed from `openrelay-like` to **RelayForge**
- Public release version line starts at `v0.1.0`
- `OPENRELAY_*` environment variables remain backward-compatible
- `build-dist` output renamed to `relayforge-<version>.zip`

### Fixed

- Fixed final-failure crash caused by out-of-scope `attemptStartedAt` in `proxyWithRetry`
- Fixed crash regression test `path.resolve` shadowing by Promise parameter
- Fixed combo config serialization in `serializeEditableConfig`
- Fixed combo route limits via `getResolvedRouteDailyLimit`

### Security

- Prompt logging disabled by default
- Authorization/API keys redacted in logs
- No OAuth subscription token routing

### Docs

- Added `docs/demo.md`, `docs/demo.zh.md` — client setup guides with CC Switch, opencode, fallback/round_robin demos
- Added `docs/release-v0.1.0.md` — GitHub release notes
- Added `docs/name-checklist.md` — pre-release name availability checklist
- Added `docs/open-source-application.md` — application draft for ChatGPT Pro / Codex for Open Source
- Added `docs/assets/README.md` — screenshot asset checklist
- Added `ROADMAP.md` — future version plans
- Added `THIRD_PARTY_NOTICES.md` — design reference credits
- Added `LICENSE` (MIT)

---

## Internal history (pre-release)

### 0.4.0 — AI Gateway Reference Merge

- Combo model mechanism
- Provider registry with capabilities
- Privacy sanitization module
- Request log and usage stats
- Enhanced retry/fallback with weighted_round_robin
- Config validation for combos and privacy
- ProviderRegistry runtime usage

### 0.3.x — IDE Proxy, Template Parity, Local Connectors

- 0.3.32: Provider quota visibility
- 0.3.31: `sk-or-*` provider:model routing parity
- 0.3.30: `OPENRELAY_TOKEN` compatibility alias
- 0.3.29: Dashboard Retry-After visibility
- 0.3.28: Retry-After aware quota routing
- 0.3.27: Responses streaming tool-call output parity
- 0.3.26: Responses API tool-call input parity
- 0.3.25: Per-model daily local limits
- 0.3.24: Provider catalog placeholder parity
- 0.3.23: Upstream default port parity (18765)
- 0.3.22: OpenAI ↔ Anthropic tool-call request parity
- 0.3.21: Local connector consent ledger
- 0.3.20: Provider template import
- 0.3.19: Provider template parity audit
- 0.3.18: Local connector consent manifest
- 0.3.17: Local connector provider preview
- 0.3.16: Redacted local connector availability
- 0.3.13-0.3.15: IDE proxy port check, start plan, connector plan
- 0.3.12: IDE proxy runtime status skeleton
- 0.3.11: Vercel AI Gateway provider template
