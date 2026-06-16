# Third Party Notices

openrelay-like is an independent reimplementation. Certain design patterns and feature concepts
were inspired by the following open-source projects. No code was copied from these projects;
only functional design principles were studied and independently reimplemented.

## Reference Projects

| Project | License | What we learned / adapted |
|---------|---------|--------------------------|
| [decolua/9router](https://github.com/decolua/9router) | MIT | 3-tier fallback strategy, combo model composition, format translation pattern between OpenAI and Anthropic |
| [BerriAI/litellm](https://github.com/BerriAI/litellm) | MIT | Provider capability registry, unified API abstraction, spend tracking concepts |
| [songquanpeng/one-api](https://github.com/songquanpeng/one-api) | MIT | Provider management patterns, quota control, dashboard design inspiration |
| [musistudio/claude-code-router](https://github.com/musistudio/claude-code-router) | MIT | Request/response transformer concept, dynamic model routing, multi-provider fallback |
| [Portkey-AI/gateway](https://github.com/Portkey-AI/gateway) | MIT | Retry with exponential backoff, guardrails concept, usage analytics design |
| [Helicone/helicone](https://github.com/Helicone/helicone) | Apache-2.0 | LLM observability patterns, cost/latency tracking, request logging approach |
| [QuantumNous/new-api](https://github.com/QuantumNous/new-api) | AGPL-3.0 | **Design reference only** — studied the routing and quota architecture. No AGPL code was copied or adapted. |

## Design Principles

openrelay-like follows these design constraints:

1. **Zero npm dependencies** — the entire project runs on Node.js built-in modules only
2. **Local-first** — binds to 127.0.0.1 by default, no telemetry, no cloud dependency
3. **Privacy by default** — API keys are never logged in plaintext; prompts are never stored in dashboard logs unless explicitly opted in
4. **No OAuth subscription tokens** — we do not read, store, or forward Claude Code / Codex / Cursor personal tokens
5. **MIT licensed** — fully permissive, no AGPL or commercial restrictions

## Credits

- [romgX/openrelay](https://github.com/romgX/openrelay) — the upstream project that inspired this independent reimplementation
