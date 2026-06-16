# Changelog

## v0.3.0 - 2026-06-16

### Added

- Premium Dashboard visual redesign
- Refined product-style Overview
- Improved sidebar and navigation hierarchy
- More polished Combo Models visualization
- Better client setup cards
- Improved Usage analytics layout
- Better status, empty, warning, and error states
- Optional light/dark/system appearance support without external dependencies
- Screenshot-ready dashboard sections

### Changed

- Dashboard layout refined for first-time users
- Advanced diagnostics moved behind clearer progressive disclosure
- Visual hierarchy improved across Providers, Combo Models, Clients, Usage, Diagnostics, and Settings

### Security

- Tokens remain masked by default
- Prompts remain hidden by default
- Diagnostic summaries remain redacted

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
