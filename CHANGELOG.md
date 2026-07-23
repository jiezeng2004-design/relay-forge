# Changelog

## v0.3.3 - 2026-07-23

### Added

- Docker support: official container image on GHCR (`ghcr.io/jiezeng2004-design/relayforge`),
  non-root `node` user, ~60 MB, with `docker-compose.yml` including optional Ollama sidecar.
  CI release pipeline pushes to GHCR on version tags.
- Config hot-reload: `src/config-watcher.js` watches `config.json` for external edits,
  validates, and hot-swaps `keyPool`, `providerRegistry`, and `routeRuntime` without
  restarting the server or dropping in-flight requests. Uses `fs.watch()` + debounce
  + O_EXCL lock for zero-dependency concurrent-write safety.
- `GET /admin/config/reload-status` — exposes the last reload time, success/failure,
  and message.
- Rate Limiting dashboard tab: dedicated page showing per-provider and per-route
  daily request counts vs configured limits, 429 error statistics, key-pool cooldown
  status, and a form to adjust thresholds via `PATCH /admin/limits`.
- `GET /admin/limits` and `PATCH /admin/limits` — dedicated endpoints to read and
  update `config.limits` (global, per-provider, per-route, per-model) without
  touching the full config.
- Settings page now shows a config hot-reload status banner.
- `scripts/strip-bom.mjs` — removes UTF-8 BOM from all `.js` and `.json` files
  under `src/` and `i18n/`, integrated as a `build-dist` pre-step.

### Changed

- `server.js` modular slimdown: `renderTokenPrompt` extracted to
  `src/dashboard/token-prompt.js`; `renderErrorRow`, `classifyErrorCounts`,
  `topUsageLabel`, `formatTimestamp`, `buildProfileDefaultOptions`, `renderRouteRow`
  extracted to `src/dashboard/fragments.js`. Dead-code `renderProviderTableRow`
  removed (the imported `renderDashboardProviderRow` from `dashboard/rows.js`
  was already used everywhere).
- `build-dist` now runs `strip-bom` automatically before packaging.
- ROADMAP marks Docker, config hot-reload, and rate-limiting dashboard as
  shipped in v0.3.3.
- `SUPPORTED_TABS` now includes `"rate-limiting"`.
- README (en/zh) updated with Docker deployment section and v0.3.3 roadmap.

### Fixed

- Removed UTF-8 BOM from `src/server.js`, `src/dashboard/index.js`, and
  `src/dashboard/tabs/providers.js`.

### Expanded `docs/open-source-application.md` into a reviewer-friendly evidence
  page for open-source maintainer support applications.
- Added root-level `CONTRIBUTING.md` and `SECURITY.md` files so reviewers and
  contributors can quickly find the contribution checklist and vulnerability
  reporting policy.

## v0.3.1 - 2026-06-16

### Added

- Real v0.3 dashboard screenshots captured from a local demo run with masked demo credentials only.
- Short fallback demo GIF covering Overview, Combo Models, Clients, and Diagnostics.
- v0.3.1 release notes summarizing the latest documentation, CI, screenshot, and compatibility updates.

### Changed

- Refined README, README.zh, and release documentation to reference the captured dashboard assets.
- Polished public open-source materials and removed remaining internal project/version notes.
- Aligned OpenRelay parity documentation with RelayForge branding.
- Removed the legacy openrelay-like checksum artifact from the public tree.

### Fixed

- Fixed README encoding corruption and removed a README BOM.
- Improved CI compatibility for zero-dependency installs and isolated auth environment state in e2e tests.
- Added Node 18-compatible CRC32 helper coverage and removed a Node 22-only force-exit flag.

### Security

- Screenshots and demo GIF use only demo tokens, masked key labels, and request metadata without prompt content.
- Release materials continue to avoid OAuth subscription token routing and real provider credentials.

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
