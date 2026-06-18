# Contributing

Thanks for helping improve RelayForge. This project is a local-first,
zero-dependency AI coding gateway, so contributions are reviewed with a strong
focus on privacy, reproducibility, and small reviewable changes.

## Project Boundaries

- Keep the runtime dependency-free. Do not add npm dependencies unless an issue
  first explains why Node.js built-ins cannot cover the need.
- Keep the default network posture local-first. The server binds to
  `127.0.0.1` by default and should not introduce telemetry.
- Do not read browser cookies, OAuth session stores, IDE account tokens, or
  local app credentials unless a future feature has explicit user consent,
  dry-run preview, and redaction tests.
- Do not log full API keys, relay tokens, Authorization headers, cookies, local
  usernames, or absolute private paths.
- Keep prompt logging disabled by default.
- Keep public release artifacts free of `data/`, `.env`, local config files,
  caches, logs, and generated runtime state.

## Local Development

Use Node.js 18 or newer. On Windows PowerShell, prefer `npm.cmd`.

```powershell
# Windows PowerShell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run pre-release
```

For a faster targeted loop, run the test that matches your change:

```powershell
# Windows PowerShell
npm.cmd run test:privacy
npm.cmd run test:doctor
npm.cmd run test:request-log
npm.cmd run test:release-artifacts
```

Before a release-oriented pull request, also verify the public artifact:

```powershell
# Windows PowerShell
npm.cmd run build-dist
npm.cmd run verify:release
npm.cmd run provider:test -- --local-only
```

## Pull Request Checklist

- [ ] The change is focused and reviewable.
- [ ] `CHANGELOG.md` is updated for user-visible behavior, docs, tests, or
      security changes.
- [ ] Relevant tests or verification commands are listed in the PR body.
- [ ] New dashboard or config behavior has matching tests.
- [ ] New user-facing text keeps `i18n/en.json` and `i18n/zh.json` in sync.
- [ ] The diff does not include real API keys, tokens, cookies, local logs,
      private config, or generated `data/` state.
- [ ] Public release packaging still excludes local runtime files.

## Documentation Changes

Documentation-only PRs are welcome when they make setup, privacy boundaries,
release verification, or client configuration easier to understand. Please keep
examples generic and use placeholder values such as `<RELAYFORGE_TOKEN>`.

## Security-Sensitive Changes

For changes that touch authentication, provider credentials, request logging,
doctor diagnostics, connector planning, or release packaging:

- add or update a regression test;
- run `npm.cmd run test:privacy` and `npm.cmd run test:doctor` when relevant;
- confirm the public zip does not include local runtime files;
- avoid pasting raw diagnostic output unless it has been redacted.

See [SECURITY.md](SECURITY.md) for vulnerability reporting guidance.
