# openrelay-like 0.3.7 — Dashboard Provider Test Preview

## Objective
Add dry-run provider config health preview to Dashboard Providers tab, extract shared `provider-test` module, refactor CLI to use it. 0.3.6 → 0.3.7 version bump.

## What was done

### 1. Shared module (`src/provider-test.js`)
Pure-logic extraction from `scripts/provider-test.mjs`:
- `checkProviderBaseUrl`, `describeKeySource`, `describeProviderStatus`, `buildProviderReport`, `buildProviderTestReport`, `readPackageVersion`
- Accepts injectable `getProviderKeys` function for server vs CLI contexts

### 2. CLI refactor (`scripts/provider-test.mjs`)
- Now imports from `../src/provider-test.js`
- Removed 5 duplicated functions (~100 lines removed)
- Same CLI behavior preserved (flags, JSON output, exit codes)

### 3. Admin endpoint (`GET /admin/provider-test-preview`)
- Dry-run only — `live=true` rejected with 400
- Supports `?provider=<name>` and `?localOnly=true`
- Uses server-aware key resolution (env vars + web keys)
- Never writes runtime state

### 4. Dashboard UI
- "检查全部 Provider" and "只检查本地 Provider" buttons
- Result table with per-provider status, issues, key availability
- Safety copy: "dry-run，不调用上游，不消耗额度，不写运行时状态"

### 5. Version bump
`package.json`, `README.md`, `README.zh.md`, `README.en.md`, `CHANGELOG.md`, `PARITY_OPENRELAY.md`, `AGENTS.md` all updated to 0.3.7.

### 6. Tests
- 1 new test group in `test-provider-test-cli.mjs` (21 shared module assertions)
- 2 new test groups in `test-dashboard-html.mjs`
- 18 new HTTP assertions in `test-dashboard-http.mjs`

## Verification Results

| Check | Result |
|-------|--------|
| `check` | PASS |
| `pre-release` | PASS |
| `provider:test` | PASS |
| `provider:test --local-only` | PASS |
| `test:unit` | PASS (107 assertions) |
| `test:e2e` | PASS |
| `build-dist` | PASS |
| `verify-zip` | PASS |
| `test-release-zip-smoke` | PASS |
| `verify:release` | PASS |

## Release Artifact
- `openrelay-like-0.3.7.zip` (424 KB, 140 entries)
- SHA256: `b56d7f08ddbae451eb04c6046e52582e403ff6bf7ce487b2216fab5308ccc26d`
- No backslash paths, no top-level prefix, no forbidden files
