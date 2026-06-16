# Maintenance

This file describes the release process and the conventions for handing the project over to another maintainer or AI agent.

## Versioning

`RelayForge` follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

- Patch (`x.y.Z`): bug fixes, dependency-free internal refactors, doc updates that do not change behavior.
- Minor (`x.Y.0`): new features that are backwards-compatible (new provider templates, new dashboard tabs, new i18n keys, new test files). Bumps `version` in `package.json` and adds a `## x.Y.0` section in `CHANGELOG.md`.
- Major (`X.0.0`): breaking changes (auth gate enabled by default, schema validation introduced, dependency added, on-disk format change). Document the migration in `CHANGELOG.md`.

## Cutting a release

```powershell
# 0. Confirm a clean working tree.
git status
git log --oneline -10

# 1. Update package.json version.
#    Edit "version": "x.y.z".

# 2. Move the "Unreleased" section in CHANGELOG.md to a dated
#    "## x.y.z — short title" heading. Add a one-line summary,
#    then the categorized bullet list (Security / Fixed / Docs /
#    Tests / New).

# 3. Update AGENTS.md "Current version" line.

# 4. Run the full local verification chain:
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd test
npm.cmd run smoke
npm.cmd run doctor
npm.cmd run pre-release

# 5. Build the distribution zip:
npm.cmd run build-dist

# 6. (Optional, requires bun >= 1.1)
npm.cmd run build:exe

# 7. Tag and push.
git add -A
git commit -m "release: x.y.z"
git tag -a vx.y.z -m "openrelay-local-safe x.y.z"
git push && git push --tags
```

## Handover to another agent / maintainer

1. Run `npm.cmd run collab:check` (or `node scripts/collab-check.mjs`) — it verifies `README.md` / `README.en.md` / `README.zh.md` all mention the current version.
2. Run `npm.cmd run check`, `npm.cmd test` (which is `test:unit && test:e2e`), and `npm.cmd run doctor`. All three must be green, and the doctor JSON must NOT contain `sk-*`, `sk-ant-*`, `Bearer `, or `relay-token:` (it only contains a `apiKeyMasked` hint).
3. Confirm `data/`, `backups/`, `.env`, `config.json`, and `tool-verify.*` are not committed (the `build-dist.ps1` and `verify-zip.mjs` already enforce this for the zip; the same filters apply to git).
4. Hand over `CHANGELOG.md` and `AGENTS.md` — they describe the latest changes and the operational conventions.

## Working with downstream AI agents

The `AGENTS.md` file in the project root is the canonical prompt for AI agents. If a downstream agent needs a long-form orientation document, point them at:

- `AGENTS.md` — collaboration conventions
- `CHANGELOG.md` — what changed in each release
- `README.md` / `README.zh.md` / `README.en.md` — what the project is
- `src/server.js` (top 60 lines) — the canonical entry point and the list of routes
- `src/dashboard/index.js` (top 40 lines) — the dashboard render contract

## Current operational notes

- The default auth posture is **on** since 0.5.3. Operators who upgrade from 0.5.2 and rely on the legacy "no token = open" behavior should either set `RELAY_TOKEN` in `.env` or explicitly set `OPENRELAY_ALLOW_NO_AUTH=true`. Both paths are tested.
- `data/security/relay-token` is the new (0.5.3+) persisted token file. It is mode 0o600 and excluded from the published zip. Operators can `cat` it after first start to read the auto-generated token.
- `data/security/relay-token` is a **plain-text file** (not encrypted). The 0o600 permission is its only protection. 0.5.4 added an explicit warning in the README + CHANGELOG. Set `RELAY_TOKEN` in `.env` if you need a stronger contract.
- `data/runtime-state.json` is the persisted runtime state (v2 format). It includes `usage.runtime` with the per-bucket latency ring buffers + token totals. The shape is forward-compatible — old `{ok, failed}` count-map buckets migrate to empty runtime buckets on load.
- 0.5.9: `data/runtime-state.json` writes are now serialized through `createRuntimeStatePersister` (in `src/runtime-state.js`). Ad-hoc `writeFileSync` + `renameSync` calls in handlers are NOT allowed — they reintroduce the EPERM race the persister was added to fix. The 0.5.8 CHANGELOG documented this as a known issue; 0.5.9 ships the fix.
- The Dashboard's `__spaRefresh` path does NOT re-bind event listeners. After a save / add / delete, the affected form becomes read-only. Operators who need to keep editing should hard-reload. This is a documented trade-off; the next iteration is event delegation via `document.body` + `data-action`.
- `npm run doctor` (0.5.9+) is the redacted local diagnostic. The output is safe to paste into a GitHub issue or a chat. Re-run it after a config change to confirm the schema is still valid. The redaction contract is enforced by `scripts/test-doctor-redaction.mjs`.

## Outstanding limitations (deferred to future versions)

- `bun build --compile` is supported but optional. Operators without `bun` installed can keep running via `npm.cmd run start`.
- Provider health scoring uses a simple weighted formula. A future iteration could plug in EWMA or Bayesian smoothing.
- i18n currently covers ~140 keys. Long-form per-string translation of the dashboard tabs is incremental — chrome (title, topbar, tab names) is translated first, then the table rows, then the inline hints.
- `key-pool.js` does per-provider round-robin but does not yet weight by historical success rate per key. Adding that would require persisting per-key health separately from the provider-level `ProviderHealthTracker`.

## What this project is NOT

- Not a tool for bypassing paid API limits, scraping data behind paywalls, or circumventing a provider's rate limits. The project is for legal, self-managed API key usage only.
- Not a credential store. `data/keys.enc.json` is a convenience for Web-added keys, not a replacement for a proper secret manager.
- Not a system-level keychain. `data/master.key` is a per-directory file, not OS-managed.
- Not a public-facing proxy. The server binds 127.0.0.1 by default. Operators who expose it to a LAN/WAN must put a real auth layer (reverse proxy + mTLS, etc.) in front.
