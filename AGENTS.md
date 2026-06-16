# AGENTS.md 鈥?RelayForge

Conventions for AI agents and human contributors working on this project.

## Project

`RelayForge` is a zero-dependency local-first AI coding gateway written in Node.js (zero npm dependencies).
It binds to `127.0.0.1` by default and provides OpenAI/Anthropic compatible endpoints for AI coding tools.
Supports combo routing, fallback, request privacy, and lightweight usage analytics.

Formerly known internally as `openrelay-like`.

## Current version

0.3.0 (see `package.json` and `CHANGELOG.md`).

## Combo Models (v0.1.0)

See `src/combo.js` for virtual model composition with fallback / round_robin / weighted_round_robin strategies.
Each candidate supports `weight`, `priority`, `enabled`.

## Provider Registry (v0.1.0)

See `src/provider-registry-lib.js` for capability-based provider queries (`openai_chat`, `anthropic_messages`, `streaming`, `tools`, `vision`).

## Privacy (v0.1.0)

See `src/privacy.js` for header/body/key sanitization. Prompts never logged by default.


## v0.3.0 UI audit notes

- Overview should feel like a product front page, not a raw admin table.
- Providers should foreground key status, local/cloud type, health, and quota/cache hints.
- Combo Models should visually explain one client model name routing across multiple candidates.
- Clients should be copy-ready and screenshot-ready for AI coding tools.
- Usage should read like a lightweight observability panel, while Diagnostics keeps advanced redacted state behind disclosure.
## Common commands
```powershell
npm.cmd run check              # read-only check (no data/ writes)
npm.cmd run doctor             # redacted local diagnostic (JSON to stdout)
npm.cmd run doctor:sum         # compact JSON summary (--summary mode)
npm.cmd run doctor:win         # Windows quick diagnostic (Chinese)
npm.cmd run test               # full test suite (test:unit + test:e2e)
npm.cmd run test:unit          # fast unit tests, no spawned children (~30s)
npm.cmd run test:combo         # combo model mechanism tests
npm.cmd run test:privacy       # privacy/sanitization tests
npm.cmd run test:provider-registry # provider registry lib tests
npm.cmd run test:request-log   # request log & stats tests
npm.cmd run test:e2e           # HTTP / streaming / dashboard integration
npm.cmd run test:runner        # node:test parallel runner for unit tests only
npm.cmd run test:coverage      # unit tests with experimental coverage report
npm.cmd run test:release-artifacts # release artifact verification tests (0.3.4+)
npm.cmd run test:bridge        # only stream-bridge + provider-health
npm.cmd run test:codex         # only end-to-end codex-compat
npm.cmd run test:auth          # only auth-required (0.5.3+)
npm.cmd run test:usage         # only usage-recording (0.5.3+)
npm.cmd run test:runtime       # only runtime-root detection (0.5.3+)
npm.cmd run test:runtime-state # only the 0.5.9 persister queue tests
npm.cmd run test:doctor        # only the doctor redaction tests
npm.cmd run test:spa-refresh   # only the 0.6.1 SPA softRefresh route test
npm.cmd run test:dotenv        # only the 0.6.2 loadDotEnv last-write-wins test
npm.cmd run test:soft-refresh  # only the 0.6.3 softRefresh in-place fetch test
npm.cmd run smoke              # end-to-end relay + mock upstream
npm.cmd run pre-release        # strict distribution check
npm.cmd run collab:check       # handover readiness
npm.cmd run build-dist         # produce a clean zip + sha256
npm.cmd run provider:test      # provider config check (dry-run, safe, no network)
npm.cmd run provider:test:live # provider live test (--live, requires keys/env)
npm.cmd run provider:test:strict # strict mode (--fail-on=warning, exits on warnings)
npm.cmd run provider:test:local  # local-only mode (--local-only, skips cloud)
npm.cmd run verify:release     # verify release artifacts (0.3.4+)
npm.cmd run build:exe          # bun build --compile single-file binary
npm.cmd run clean              # remove data/, tool-env.*, backups/
npm.cmd start                  # run the relay on http://127.0.0.1:18765
```

## Safety rules (non-negotiable)

- Do not read, scan, or import any local app token, browser cookie, session storage, or system credential store.
- Do not bypass any cloud provider's paywall, quota, rate limit, region lock, or terms of service.
- Do not write system environment variables, the Windows registry, or any shell profile.
- Real API keys must never be written to `README.md`, `config.example.json`, log output, exported config, or the published zip.
- Tool environment variable scripts must only set current-shell-process env vars (`$env:`, `set`, `export`); never `setx`, never `[Environment]::SetEnvironmentVariable` with `User` / `Machine` scope.
- The default auth posture is **on** since 0.5.3: do not silently turn it off. The explicit `OPENRELAY_ALLOW_NO_AUTH=true` escape hatch is allowed but must log a warning and the Dashboard must surface a red banner.
- No new npm dependencies. The project is zero-deps. If you think a dep is needed, justify it in a comment in the PR and the maintainer will decide.
- No `import "npm:..."` or other dynamic installs.
- Doctor output (`scripts/doctor.mjs`, `scripts/doctor-lib.mjs`) is the only safe surface to paste into an issue / chat. It must NEVER include a full API key, a full RELAY_TOKEN, an Authorization header, a cookie, or a master.key. The redaction contract is enforced by `scripts/test-doctor-redaction.mjs`.

## Important paths

### Source layout (refactored 0.6.3+)

- `src/server.js` 鈥?thin wiring module (~600 lines); state init, context wiring, handler factory calls
- `src/router.js` 鈥?request dispatch table (~80 lines); `createRouter(handlers, ctx)` 鈫?`handleRequest(req, res)`
- `src/lib/route-logic.js` 鈥?pure business logic: `selectRoute`, `orderCandidates`, `buildStatus`, route strategy
- `src/lib/config-ops.js` 鈥?config editing/validation/serialization: `applyEditableConfig`, `sanitizeProviderInput`, etc.
- `src/handlers/admin.js` 鈥?factory `createAdminHandlers(ctx)` 鈫?all /admin/* CRUD handlers
- `src/handlers/proxy.js` 鈥?factory `createProxyHandlers(ctx)` 鈫?proxy/streaming/chat handlers

### Existing modules (unchanged)

- `src/runtime-state.js` 鈥?single-flight runtime state persister with 200ms write coalescing debounce
- `src/config.js` 鈥?`loadConfig`, `loadDotEnv`, `normalizeConfig`, `detectRuntimeRootDir`, `isLoopbackHost`, `validateProviderBaseUrl`
- `src/config-schema.js` 鈥?`validateConfig(config)` (0.5.2+)
- `src/auth.js` 鈥?`resolveRelayAuth`, `maskToken`, `describeAuth` (0.5.3+)
- `src/i18n.js` 鈥?`translate`, `makeT`, `getBundlesForClient`
- `src/error-category.js` 鈥?11 server-authoritative error categories + `sanitizeErrorMessage`
- `src/format-convert.js` 鈥?OpenAI 鈫?Anthropic non-stream shape conversion
- `src/ide-proxy-port-check.js` 鈥?0.3.13 dry-run loopback port readiness checks for planned IDE proxy ports
- `src/ide-proxy-start-plan.js` 鈥?0.3.14 dry-run IDE proxy startup plan, explicit-consent checklist, no listener startup
- `src/local-connector-plan.js` 鈥?0.3.15 dry-run local connector discovery plan for 11 local/CLI/IDE providers
- `src/local-connector-availability.js` 鈥?0.3.16 redacted PATH-only availability dry-run for local/CLI connectors
- `src/local-connector-provider-preview.js` 鈥?0.3.17 dry-run provider/direct-route preview for 11 local/CLI/IDE connectors
- `src/local-connector-consent-manifest.js` 鈥?0.3.18 dry-run consent/security manifest; no consent storage or credential reads
- `src/local-connector-consent-approval.js` 鈥?0.3.21 metadata-only local connector consent ledger; confirmation-gated approve/revoke, no credential reads or route registration
- `src/provider-template-parity.js` 鈥?0.3.19 dry-run provider template catalog coverage audit; no config writes, key storage, network calls, or route registration
- `src/provider-template-import-plan.js` 鈥?0.3.20 confirmation-gated provider template import plan/apply helpers; imports metadata only, never keys or placeholder URLs
- `src/responses-stream.js` 鈥?OpenAI Responses client 鈫?any upstream SSE bridge
- `src/stream-bridge.js` 鈥?OpenAI 鈫?Anthropic SSE bridge (0.5.0+)
- `src/provider-health.js` 鈥?sliding-window health tracker (0.5.0+)
- `src/usage.js` 鈥?`UsageTracker` with `recordLatency` / `recordTokens` / `metrics` (0.5.2+)
- `src/token-estimate.js` 鈥?per-family chars-per-token heuristic (0.5.2+)
- `src/route-preview.js` 鈥?pure `resolveRoutePreview(config, ...)` (0.4.x+)
- `src/secret-store.js` 鈥?AES-256-GCM encrypted local key store
- `src/key-pool.js` 鈥?key rotation + cooldown
- `src/balance.js` 鈥?read-only balance endpoint guard
- `src/http-helpers.js` 鈥?`sendJson`, `sendHtml`, `withCorsHeaders`, `isAuthorized`, `isAuthorizedV1`, `setAuthContext`
- `src/dashboard/` 鈥?split dashboard renderer; inline client JS extracted to `static/dashboard-client.js`
- `scripts/doctor.mjs` + `scripts/doctor-lib.mjs` 鈥?redacted local diagnostic (0.5.9+)
- `scripts/` 鈥?25+ test / build scripts
- `i18n/{zh,en}.json` 鈥?UI string bundles; keep key parity
- `.github/workflows/ci.yml` 鈥?Node 18 / 20 / 22 脳 ubuntu-latest / windows-latest
- `.github/workflows/release.yml` 鈥?tag-triggered release (test 鈫?build-dist 鈫?GitHub Release)

## When you make changes

- Run `npm.cmd run test:unit` for fast feedback, then `npm.cmd run test:e2e`, then `npm.cmd run pre-release` before claiming a change is ready. `npm.cmd test` is `test:unit && test:e2e`.
- Add tests for any new code path the existing suites do not cover.
- Update `CHANGELOG.md` (add a `## <next-version>` section under "Unreleased" or your version).
- Update `i18n/{zh,en}.json` together 鈥?they must stay in 1:1 key parity. The `scripts/test-i18n.mjs` suite enforces this.
- Update `config-schema.js` rules if you add new required `config.json` fields.
- Do not commit real API keys, real tokens, real cookies, real `Authorization` headers, or any output of `/admin/error-log` that includes upstream error bodies.
- The 0.5.9 `runtimeStatePersister` is the ONLY way to touch `data/runtime-state.json`. Ad-hoc `writeFileSync`+`renameSync` calls in handlers reintroduce the EPERM race the persister was added to fix.

## When you need to bump the version

1. Edit `package.json` and update the `version` field.
2. Move the "Unreleased" section in `CHANGELOG.md` to `## <new-version>` and add a dated heading.
3. Update the `Current version` line in this `AGENTS.md`.
4. Update the top of `README.md` / `README.zh.md` / `README.en.md` only if the user-facing description changed.
5. Run `npm.cmd run test && npm.cmd run pre-release` and capture the output in the PR.

## Out of scope (deferred)

- Native platform keychain integration (Windows DPAPI / macOS Keychain / Linux Secret Service) 鈥?keep `data/master.key` + `OPENRELAY_KEYSTORE_SECRET` for now.
- A real SPA framework (the current `__spaRefresh` is intentionally minimal; event delegation via `document.body` + `data-action` is the documented next step).
- A separate "doctor" command 鈥?covered today by `npm.cmd run check` + `scripts/check-local.ps1`.
- Replacing the `dashboard.js` re-export shim with a fully module-relative import (the shim stays for back-compat until 0.6).

