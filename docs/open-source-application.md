# Open Source Application — RelayForge

## Project Summary

RelayForge is a zero-dependency, local-first AI coding gateway compatible with OpenAI and
Anthropic APIs. It helps developers safely connect AI coding tools (Codex, opencode,
Claude Code, CC Switch, Cline) to multiple LLM providers through user-controlled API-key
routing, combo models, fallback strategies, privacy-first request logs, and lightweight
usage analytics.

**Repository URL:** https://github.com/jiezeng2004-design/relay-forge

**Current Release:** v0.3.0

## Maintainer Role

Primary maintainer and original author. Responsible for architecture, implementation,
testing, documentation, and release management.

## Problem It Solves

AI coding users often rely on multiple providers and tools. Managing API keys, rate limits,
fallback behavior, and privacy across every tool is painful and error-prone. RelayForge
provides a local gateway that centralizes routing without exposing upstream keys directly
to every client.

## Why It Matters for AI-Assisted Coding

RelayForge helps tools such as Codex, opencode, Claude Code, CC Switch, Cline, and other
OpenAI-compatible clients share one local routing layer while keeping provider credentials
controlled by the user. This makes it safer and simpler to experiment with different models
and providers.

## Security Posture

- No OAuth subscription token routing
- No reading local client login tokens
- API-key based provider configuration only
- Prompt logging disabled by default
- API keys and Authorization headers redacted in logs
- Local-first runtime (binds to 127.0.0.1)

## Current Status

- [x] Public GitHub repository
- [x] v0.3.0 release with release artifacts
- [x] MIT License
- [x] README with architecture, features, and quick start
- [x] CI workflow (Node 18/20/22 on ubuntu + windows)
- [x] Local-first privacy design
- [x] Unit tests and end-to-end tests
- [x] Pre-release distribution checks
- [ ] Demo GIF / screenshots (planned for v0.4.x)
- [ ] External user feedback (early stage)

## Related Work

RelayForge and [CodexJournal-Lite](https://github.com/jiezeng2004-design/CodexJournal-Lite) can
complement each other in an AI-assisted coding workflow:

- **CodexJournal-Lite**: Coding history, memory, and review
- **RelayForge**: Model routing, fallback, privacy, and provider access
