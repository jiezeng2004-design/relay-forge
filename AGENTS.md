# RelayForge agent rules

RelayForge is a zero-dependency, local-first AI coding gateway. Preserve loopback defaults, authentication-on behavior, privacy redaction, deterministic routing, and the zero npm dependency contract.

## Fast and full validation

Run in Windows PowerShell with `npm.cmd`:

```powershell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run pre-release
npm.cmd run build-dist
npm.cmd run verify:release
```

Use a targeted `test:*` script during iteration. Before PR or release claims, run unit, e2e, and pre-release checks. Do not add npm dependencies without explicit maintainer approval.

## Non-negotiable safety

- Do not read browser cookies, local app tokens, session storage, system credential stores, or real provider secrets.
- Never log or package full API keys, `RELAY_TOKEN`, authorization headers, cookies, `master.key`, runtime data, or upstream prompt/error bodies.
- Keep default authentication enabled. The explicit no-auth escape hatch must remain visible and warning-gated.
- Environment helper scripts may change only the current process; never use `setx`, user/machine environment writes, registry changes, or shell-profile edits.
- Use the existing runtime-state persister; do not reintroduce ad-hoc concurrent writes.

## Change rules

- Keep `i18n/zh.json` and `i18n/en.json` in key parity.
- Update config schema, tests, CHANGELOG, and user docs with behavior changes.
- Use branch -> PR -> `CI gate` -> merge. Release tags must point to the verified merge commit.
- Keep GitHub Release truth separate from local ZIP creation; RelayForge intentionally has no npm publication target.

Read `docs/agent-reference.md` only when detailed module paths, specialized test commands, version-bump steps, or deferred architecture notes are needed.

