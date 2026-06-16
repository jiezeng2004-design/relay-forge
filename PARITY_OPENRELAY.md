# Parity: RelayForge vs romgX/openrelay

> Purpose: feature gap analysis between `openrelay-like` (our project, v0.3.32) and [romgX/openrelay](https://github.com/romgX/openrelay) (latest public GitHub release v0.10.42, GitHub source package v0.8.3). This document maps public upstream features to our current status and planned milestones. It is based only on public information such as README, FAQ, screenshots, and open-source metadata; no decompilation, reverse engineering, or license bypass is involved.

romgX/openrelay uses an Open Core license model: framework features are MIT, while some Pro features require a commercial license. `openrelay-like` is not a fork and does not copy upstream code. It is an independent Node.js implementation aiming for functional equivalence in the non-Pro, non-credential-reading space while staying zero-dependency and MIT-compatible.

---

## 1. Service Port

| Aspect | romgX/openrelay | openrelay-like | Gap | Plan |
|--------|-----------------|----------------|-----|------|
| Default port | `18765` | `18765` (0.3.23+) | Aligned | Done |
| Configurable port | `PORT` env | `PORT` env | Aligned | Done |
| Dashboard shows current port | Yes | Yes | Aligned | Done |
| 18765 compatibility banner | Yes | Yes | Aligned | Done |

---

## 2. API Compatibility

| Feature | romgX/openrelay | openrelay-like | Gap | Plan |
|---------|-----------------|----------------|-----|------|
| OpenAI Chat Completions `POST /v1/chat/completions` | Yes | Yes | None | Done |
| OpenAI Responses `POST /v1/responses` | Yes | Yes | None | Done |
| Anthropic Messages `POST /v1/messages` | Yes | Yes | None | Done |
| Azure OpenAI compatible endpoint | Yes | Yes (template) | None | Template available |
| Streaming SSE | Yes | Yes | None | Done |
| Non-streaming | Yes | Yes | None | Done |
| OpenAI to Anthropic cross-format bridge | Native dual formats upstream | Yes | Ahead/compatible | Maintain |
| Tool/function calling conversion | Yes | Partial+: Chat tool calls, Responses `function_call` / `function_call_output` input mapping, and Responses streaming `function_call` output items are covered (0.3.22, 0.3.26, 0.3.27) | Partial | Continue provider-delta edge-case validation |
| `GET /v1/models` | Grouped by type | Grouped with metadata | Aligned | Done |
| Provider-direct path `/{provider}/v1/*` | Yes | Yes | Aligned | Done |

---

## 3. Provider Coverage

### 3.1 Direct API Providers

| Provider | romgX/openrelay | openrelay-like | Notes |
|----------|-----------------|----------------|-------|
| Anthropic API | Yes | Yes | Aligned |
| Groq | Yes | Yes | Aligned |
| Cerebras | Yes | Yes | Aligned |
| OpenRouter | Yes | Yes | Aligned |
| SambaNova | Yes | Yes | Aligned |
| Gemini API | Yes | Yes | Aligned |
| Mistral | Yes | Yes | Aligned |
| xAI (Grok) | Yes | Yes | Aligned |
| SiliconFlow | Yes | Yes | Aligned |
| Zhipu / GLM | Yes | Yes | Aligned |
| Together AI | Yes | Yes | Aligned |
| DashScope | Yes | Yes | Aligned |
| DeepSeek | Yes | Yes | Aligned, includes balance endpoint |
| NVIDIA NIM | Yes | Yes | Aligned |
| GitHub Models | Yes | Yes | Aligned |
| Fireworks | Yes | Yes | Aligned |
| Volcengine | Yes | Yes | Aligned |
| Qianfan (Baidu) | Yes | Yes | Aligned |
| Qiniu | Yes | Yes | Aligned |
| Moonshot | Yes | Yes | Aligned |
| Baichuan | Yes | Yes | Aligned |
| Stepfun | Yes | Yes | Aligned |
| MiniMax | Yes | Yes | Aligned |
| Pollinations AI | Yes | Yes | Aligned, config-ready template |
| Azure OpenAI | Yes | Yes | Template with user resource placeholder |
| Hunyuan (Tencent) | Yes | Yes | Aligned |
| Cloudflare AI | Yes | Yes | Template with account/gateway placeholders |
| Hugging Face | Yes | Yes | Aligned |
| LongCat | Yes | Yes | Aligned |
| Vercel AI Gateway | Yes | Yes | Aligned |
| Kilo | Yes | Template-only placeholder (0.3.24) | Public Base URL not confirmed; visible but skipped by import |
| LLM7 | Yes | Template-only placeholder (0.3.24) | Public Base URL not confirmed; visible but skipped by import |
| BlazeAPI | Yes | Template-only placeholder (0.3.24) | Public Base URL not confirmed; visible but skipped by import |
| BazaarLink | Yes | Template-only placeholder (0.3.24) | Public Base URL not confirmed; visible but skipped by import |

Current built-in provider templates: 42 total = 37 direct/API-style templates plus 5 local endpoint templates. Four direct/API-style entries are intentionally template-only placeholders because public Base URLs are not confirmed.

Upstream public provider target: 34 API/local providers + 11 local/CLI/IDE providers = 45 non-virtual providers.

### 3.2 Local Endpoint Providers

| Provider | romgX/openrelay | openrelay-like | Notes |
|----------|-----------------|----------------|-------|
| Ollama | Yes | Yes | Aligned |
| LM Studio | Yes | Yes | Aligned |
| vLLM | Yes | Yes | Aligned |
| llama.cpp | Yes | Yes | Aligned |
| llamafile | Yes | Yes | Aligned |

### 3.3 Local App / CLI / IDE Providers

These require reading local app tokens or sessions, so they remain default-off and consent-gated.

| Provider | Credential source | openrelay-like status |
|----------|-------------------|-----------------------|
| Claude Desktop | Local session | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Claude Code | CLI credentials | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Kiro (AWS) | App session | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Windsurf (Codeium) | Session | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Antigravity | App session | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| OpenCode | Local config | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| VS Code Copilot | GitHub Copilot session | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| OpenAI Codex | Codex local auth | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Gemini CLI | `~/.gemini/oauth_creds.json` | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| Rovo Dev | Atlassian config/env | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |
| QClaw | Local gateway | Dry-run plan, availability probe, provider preview, consent manifest, metadata-only consent ledger |

Current safety boundary: no local app token, cookie, browser profile, keychain, IDE config, or local path is read or disclosed. No connector process is started and no route is registered.

---

## 4. Tool Integration

| Tool | romgX/openrelay | openrelay-like | Status |
|------|-----------------|----------------|--------|
| Claude Code | Yes | Yes | Aligned |
| OpenCode | Yes | Yes | Aligned |
| Aider | Yes | Yes | Aligned |
| Goose | Yes | Yes | Aligned |
| Amp | Yes | Yes | Aligned |
| Continue | Yes | Yes | Aligned |
| Codex CLI | Yes | Yes | Aligned |
| OpenClaw | Yes | Yes | Aligned |

The Work/Tools tab uses a toggle-style selection UX that mirrors upstream's tool selection pattern while only generating current-shell commands. It does not write system env vars, registry keys, or shell profiles.

---

## 5. IDE RPC Proxy

| IDE | romgX/openrelay method | openrelay-like | Gap |
|-----|------------------------|----------------|-----|
| Cursor | RPC proxy | Dry-run panel, status, port check, start plan | Real proxy deferred |
| Windsurf | RPC proxy | Dry-run panel, status, port check, start plan | Real proxy deferred |
| VS Code Copilot | Ollama/BYOK bridge | Dry-run panel, status, port check, start plan | Real proxy deferred |
| Antigravity | Gemini REST proxy | Dry-run panel, status, port check, start plan | Real proxy deferred |

Proxy work remains dry-run only until security review covers credential handling, consent, process lifetime, local listener binding, IDE config changes, and terms-of-service boundaries.

---

## 6. Model Groups / Routing

| Feature | romgX/openrelay | openrelay-like | Gap |
|---------|-----------------|----------------|-----|
| Fallback routing | Yes | Yes | Aligned |
| Round-robin | Yes | Yes | Aligned |
| Weighted routing | Yes | Yes | Aligned |
| Model aliases | Yes | Yes | Aligned |
| `sk-or-*` routing key format | Yes | Yes: route targets plus explicit `provider:model` targets; malformed keys rejected before proxying (0.3.31) | Aligned |
| Failover on error/429 | Yes | Yes | Aligned |
| 401/403 handling | Not clearly documented | Falls back to next candidate without retrying same bad-key provider | Compatible |
| Quota-aware routing | Pro/basic upstream behavior | 429 failover plus Retry-After provider cooldown/demotion (0.3.28), with Dashboard-visible rate-limit bucket (0.3.29) | Partial: live quota/balance sync differs |
| Per-route daily limits | Yes | Yes | Aligned |
| Per-provider daily limits | Yes | Yes | Aligned |
| Per-model daily limits | Yes or Pro | Yes (0.3.25 local soft limit via `limits.models`) | Aligned for local daily soft limits |
| Health-based routing | Yes | Yes | Aligned |

---

## 7. Dashboard

| Tab | romgX/openrelay | openrelay-like | Gap |
|-----|-----------------|----------------|-----|
| Overview | Status summary | Status summary, quick start, recent errors | Aligned |
| Provider | Provider list, quota status, health dots | Provider list, health, key count, cached quota/balance badges and filters (0.3.32), Retry-After badge/filter/details, template parity/import tools | Live quota auto-sync differs |
| Routes | Model group management | Route CRUD and preview | Aligned |
| Work / Tools | One-click tool setup | Safe tool command generator with toggles | Aligned for current-shell generation |
| IDE | Proxy controls | Dry-run proxy readiness panels | Partial |
| Usage | Usage/error history | Usage/error history with category filters | Aligned |
| Settings | Health checks, discovery, balance | Health checks, discovery, balance, aliases | Aligned/enhanced |
| i18n | CN/EN | CN/EN | Aligned |
| LINUX DO Connect | Yes | Not planned | Out of scope |
| Pro license | Yes | Not applicable | Out of scope |

---

## 8. Heatmap

| Category | Status | Notes |
|----------|--------|-------|
| API compatibility | Done | Chat, Responses, Messages |
| Streaming / non-streaming | Done | SSE and JSON |
| Cross-format bridge | Done/ahead | OpenAI/Anthropic conversion |
| Tool/function calling bridge | Partial++ | Chat request-side conversion, Responses input tool-call history, and Responses stream tool-call output items are covered; provider-specific delta edge cases still need validation |
| Direct/API/local provider template catalog | Partial | All upstream-public API/local Provider names are represented as config-ready templates or safe placeholders; four public Base URL gaps remain |
| Local endpoint providers | Done | 5/5 |
| Model routing | Done | fallback, round-robin, weighted |
| Model aliases | Done | config-level aliases |
| Provider direct path | Done | `/{provider}/v1/*` |
| Grouped `/v1/models` | Done | metadata included |
| Port 18765 compatibility | Done | default port aligned |
| Quota-aware routing | Partial+ | 429 failover plus Retry-After provider cooldown/demotion, cached quota/balance status in Provider table, and Dashboard rate-limit visibility; live quota/balance sync still differs |
| Work tab toggle UX | Done | safe current-shell commands |
| IDE RPC proxy | Partial | dry-run only |
| Local app credential connectors | Partial | dry-run/consent metadata only |
| Provider test CLI | Done | dry-run and live modes |
| Packaging | Partial | zip works; binary/npm publishing still phase 6 |
| LINUX DO Connect | Out of scope | no auth server |
| Pro license features | Out of scope | not applicable |

---

## 9. Template-Only Public-Info Gaps

These upstream-listed providers are represented in our registry but deliberately remain template-only until a public Base URL is confirmed:

| Provider | Placeholder baseUrl | Notes |
|----------|---------------------|-------|
| Kilo | `https://<kilo_base_url>/v1` | Replace with confirmed endpoint before use |
| LLM7 | `https://<llm7_base_url>/v1` | Replace with confirmed endpoint before use |
| BlazeAPI | `https://<blazeapi_base_url>/v1` | Replace with confirmed endpoint before use |
| BazaarLink | `https://<bazaarlink_base_url>/v1` | Replace with confirmed endpoint before use |

`/admin/provider-template-import-plan` and `/admin/provider-template-import` skip these entries with `requires_user_specific_base_url`. This prevents guessed endpoints from being written to `config.json`.

---

## 10. Migration & Coexistence

Users migrating from romgX/openrelay to openrelay-like should be able to:

1. Run both simultaneously by overriding one instance with `PORT=39210` or another free port.
2. Import config manually through Dashboard/config JSON tools.
3. Keep using `RELAY_TOKEN` as the preferred local relay token, or set `OPENRELAY_TOKEN` as an upstream-compatible migration alias when `RELAY_TOKEN` is not set (0.3.30).
4. Reuse `sk-or-*` routing keys for either named routes or explicit `provider:model` targets (0.3.31).
5. Use the same current-shell environment variable patterns for tools.

Not supported:

- Reading `~/.openrelay/` config files directly.
- Reading romgX/openrelay cookie stores.
- Migrating Pro license features.
- Bi-directional sync.

---

> Document version: 4.16
> Last updated: 2026-06-15
> Current project version: 0.3.32
> romgX/openrelay reference version: 0.10.42 (latest public GitHub release) / 0.8.3 (GitHub source package)
