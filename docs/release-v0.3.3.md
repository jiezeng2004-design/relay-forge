# RelayForge v0.3.3 Release Notes

**Release date:** 2026-07-23

**Build still in progress** — this version ships the Phase 1–4 deliverables
agreed in the optimization plan dated 2026-06-21. Below is the human-facing
snapshot of what changed.

## Highlights

1. **Docker support** — official container image on GHCR.
2. **Config hot-reload** — edit `config.json` without restarting the server.
3. **Rate limiting dashboard tab** — dedicated view for 429 stats, key-pool
   cooldown, per-provider/route quota and a live threshold editor.
4. **`server.js` modular slimdown** — pure rendering helpers and the token
   prompt page now live in dedicated modules.

## Docker

A new `Dockerfile` (node:20-alpine, ~60 MB, non-root `node` user) is now
shipped at the repo root. The companion `docker-compose.yml` starts
RelayForge on `127.0.0.1:18765` and optionally an Ollama sidecar via:

```bash
docker compose --profile local up -d
```

The CI release pipeline (`.github/workflows/release.yml`) gained a new
`docker` job that builds and pushes two tags to GHCR on every `v*` tag:

- `ghcr.io/jiezeng2004-design/relayforge:latest`
- `ghcr.io/jiezeng2004-design/relayforge:<tag>`

The push uses the built-in `GITHUB_TOKEN` scoped to `packages: write` — no
new secrets are introduced. `/app/data` is a `VOLUME` so
`runtime-state.json`, the encrypted keystore, and the auto-generated
relay token persist across restarts. The `.dockerignore` excludes
`.env`, `config.json`, `data/`, zips, docs, and any sensitive env helper
scripts; only `.env.example` and `config.example.json` are kept as
templates.

## Config hot-reload

`src/config-watcher.js` binds `fs.watch(configPath)` on server startup,
with a 500 ms debounce (Windows fires rename + change events on atomic
save) and an `O_EXCL` file lock at `data/.config-reload.lock` to prevent
reload collisions with the admin handler writing the same file. Invalid
JSON is rejected with a warn log; the previous config stays live and
in-flight requests keep their original context until they finish. The
reload counter is surfaced in:

- `/admin/status.configReload` — `{ lastReloadAt, ok, message, count }`
- `GET /admin/config/reload-status` — dedicated endpoint for the Dashboard
- Settings tab — top-of-page banner showing the last reload state

## Rate Limiting tab + `/admin/limits`

The Dashboard sidebar gains an "Rate Limiting" entry (08). The tab shows
top-line counters (today requests, 429 errors, local limit hits,
key-pool cooling), per-provider and per-route usage-vs-limit bars, the
key-pool cooldown table, and a small error-category breakdown panel.
A form at the bottom posts to the new `PATCH /admin/limits` endpoint:

- Body fields:
  - `dailyRequests` (positive integer or null for unlimited)
  - `providers: { name: { dailyRequests } }`
  - `routes`:    `{ name: { dailyRequests } }`
  - `models`:   `{ name: { dailyRequests } }`
- Writes go through the existing `applyEditableConfig` hot path → persisted
  to `config.json`, immediately reflected in subsequent requests
- Non-integer or non-positive values return `400 { error: "invalid_limits" }`

`GET /admin/limits` returns the current `config.limits` block without
secrets.

## `server.js` slimdown

Pure functions moved out of `server.js`:

- `renderTokenPrompt` → `src/dashboard/token-prompt.js`
- `renderErrorRow`, `classifyErrorCounts`, `topUsageLabel`,
  `formatTimestamp`, `buildProfileDefaultOptions`, `renderRouteRow` →
  `src/dashboard/fragments.js`
- Dead-code `renderProviderTableRow` removed — the project now relies
  entirely on `dashboard/rows.js` `renderProviderTableRow` (imported as
  `renderDashboardProviderRow`).
- A new `scripts/strip-bom.mjs` removes UTF-8 BOM from `src/**/*.js` and
  `i18n/**/*.json`. It runs automatically before `build-dist` and is
  exposed as `npm run strip-bom`. The three BOM-bearing files in the
  v0.3.1 tree (`server.js`, `dashboard/index.js`, `tabs/providers.js`)
  are now clean.

`server.js` shrinks from 629 → 626 lines after the extraction. The
remaining functions (`renderSingleTab`, `testProviderWithKey`,
`discoverProviderModels`, `checkProviderBalance`,
`runScheduledHealthChecks`) still live in `server.js` because they
close over runtime state; pulling them out properly is tracked as a
deferred item (see `ROADMAP.md` v0.4.x).

## Compatibility

- Node 18 / 20 / 22 (unchanged)
- Zero runtime npm dependencies (unchanged)
- `RELAYFORGE_*` env vars take precedence over `OPENRELAY_*` (unchanged)
- Auth defaults stay on (unchanged)
- The `--check` and `--root` CLI flags still behave the same way; the new
  `--root=/app` flag used by the Dockerfile keeps
  `detectRuntimeRootDir` deterministic in the container.

## Migration

- Existing `config.json` users: nothing to do. The new `/admin/limits`
  endpoint reuses the existing `limits` block in `config.json`.
- Existing `.dockerignore` rules: if you mount your own `config.json`
  read-only into `/app/config.json`, ensure it is not in `.dockerignore`
  inside your Docker context (the shipped `.dockerignore` allows it).
- If you operate on macOS/Linux, the new O_EXCL lock file path is
  `<data-dir>/.config-reload.lock` — make sure the relay process can
  write to the `data/` directory.

## Known limitations / next steps

- The `handlers/proxy.js` split is intentionally deferred to a later
  version: the file is 1477 lines but every handler closes over the
  same `ctx` object, so a physical split needs careful refactoring to
  avoid behavior regressions. See `ROADMAP.md` "v0.4.x".
- SSE / WebSocket real-time Dashboard push is still not implemented —
  the Dashboard polls `/admin/render-tab?tab=...` as before. See
  `ROADMAP.md` "v0.4.x".
- A `PATCH /admin/limits` write while the config-watcher's debounce
  window is still active will be serialized through the O_EXCL lock
  and may surface a brief "in-flight reload" warning in the Settings
  banner; it self-heals on the next fs event.
