# Open Source Application Evidence - RelayForge

This page is a reviewer-friendly evidence summary for open-source maintainer
support programs, including ChatGPT Pro / Codex-style open-source support
applications when such programs are available.

It does not claim eligibility. It lists public, verifiable project evidence.

## Project Summary

RelayForge is a zero-dependency, local-first AI coding gateway compatible with
OpenAI and Anthropic APIs. It helps developers connect AI coding tools such as
Codex, opencode, Claude Code, CC Switch, and Cline to multiple LLM providers
through user-controlled API-key routing, combo models, fallback strategies,
privacy-first request logs, and lightweight usage analytics.

Repository: https://github.com/jiezeng2004-design/relay-forge

Latest GitHub Release tag: `v0.3.2`

Current package / ZIP artifact version: `0.3.1`

Release note: the `v0.3.2` GitHub Release is release-workflow polish. Its
published artifact is still `relayforge-0.3.1.zip`, matching the package
version in `package.json`.

License: MIT

## Maintainer Role

The maintainer is responsible for project architecture, implementation, tests,
documentation, CI, release packaging, and privacy/security boundaries.

## Problem It Solves

AI coding users often rely on multiple providers and tools. Managing API keys,
rate limits, fallback behavior, and privacy across every tool is painful and
error-prone. RelayForge provides a local gateway that centralizes routing while
keeping provider credentials under the user's control.

## Why It Matters for AI-Assisted Coding

RelayForge gives OpenAI-compatible clients one local routing layer for model
experiments, fallback, and usage visibility. It is especially useful for
developers who want a local-first workflow instead of copying credentials into
every tool.

## Security Posture

- No OAuth subscription token routing.
- No reading local client login tokens.
- API-key based provider configuration only.
- Prompt logging disabled by default.
- API keys and Authorization headers redacted in logs.
- Local-first runtime that binds to `127.0.0.1` by default.
- Redacted doctor diagnostics for support and issue reports.

## Public Evidence

- Public GitHub repository with MIT license.
- Zero npm dependencies and Node.js built-in implementation.
- Public README with architecture diagram, screenshots, demo GIF, quick start,
  provider configuration, client setup, and security notes.
- GitHub Actions CI for Linux and Windows.
- Release artifact verification scripts for `relayforge-<version>.zip` and
  checksum files; the latest public release tag is `v0.3.2` and includes the
  verified `relayforge-0.3.1.zip` artifact.
- Unit tests, end-to-end tests, dashboard tests, privacy tests, doctor
  redaction tests, and release artifact tests.
- Local-first privacy documentation in `CONNECTOR_SECURITY.md`,
  `MAINTENANCE.md`, and release notes.
- Demo screenshots and GIF captured with demo-only configuration.

## Reviewer Verification Commands

From a fresh clone:

```powershell
# Windows PowerShell
git clone https://github.com/jiezeng2004-design/relay-forge.git
cd relay-forge
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run pre-release
npm.cmd run build-dist
npm.cmd run verify:release
npm.cmd run provider:test -- --local-only
```

The live provider test mode is intentionally separate and should only be used
by maintainers with their own provider keys.

Public release evidence:

- Latest release: https://github.com/jiezeng2004-design/relay-forge/releases/tag/v0.3.2
- Artifact: `relayforge-0.3.1.zip`
- Checksum file: `relayforge-0.3.1.zip.sha256`

## Current Status

- [x] Public GitHub repository.
- [x] MIT license.
- [x] README with architecture, features, screenshots, demo GIF, and quick
  start.
- [x] CI workflow for Node.js on Linux and Windows.
- [x] Local-first privacy design.
- [x] Unit tests and end-to-end tests.
- [x] Pre-release distribution checks.
- [x] Demo GIF and screenshots captured with demo-only configuration.
- [ ] External user feedback and third-party issue reports are still early.

## Why Support Would Help

ChatGPT Pro / Codex-style access would help maintain the project by improving:

- compatibility tests across AI coding clients;
- safe local gateway workflows for Windows, WSL, macOS, and Linux users;
- privacy and redaction regression coverage;
- documentation for local-first routing without exposing subscription tokens;
- issue triage and release preparation for a fast-moving tool category.

## Related Work

RelayForge and [CodexJournal-Lite](https://github.com/jiezeng2004-design/CodexJournal-Lite)
can complement each other in an AI-assisted coding workflow:

- CodexJournal-Lite: coding history, local work memory, and review.
- RelayForge: model routing, fallback, privacy, and provider access.
