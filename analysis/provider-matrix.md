# Provider 优先级矩阵

> **⚠️ Historical report (pre-0.3.3).** This document describes the 0.3.0 codebase. For the current (0.3.3) status, refer to [PARITY_OPENRELAY.md](../PARITY_OPENRELAY.md).

> 本项目: openrelay-like 0.3.0  
> 上游: romgX/openrelay v0.10.48（45 Provider 声称）/ v0.8.3（29 Provider CHANGELOG）  
> 证据等级: [R] / [RL] / [S] / [U] / [本] / [原] / [未]

---

## P0: v0.1.1 已实现（可直接使用）

### P0-A: API Provider（14 个，`config.json` 中有实际配置）

| # | Provider | 模板来源 | `config.json` 中已配置 | 上游证据 |
|---|----------|---------|----------------------|---------|
| 1 | OpenAI | `src/provider-registry.js` | 是 | [R] CHANGELOG + README |
| 2 | Anthropic | 同上 | 是 | [R] CHANGELOG + README |
| 3 | DeepSeek | 同上（含 balance endpoint） | 是 | [R] CHANGELOG + README |
| 4 | Gemini | 同上 | 是 | [R] CHANGELOG + README |
| 5 | Groq | 同上 | 是 | [R] CHANGELOG + README |
| 6 | OpenRouter | 同上 | 是 | [R] CHANGELOG + README |
| 7 | Mistral | 同上 | 是 | [R] CHANGELOG + README |
| 8 | SiliconFlow | 同上 | 是 | [R] CHANGELOG + README |
| 9 | Zhipu | 同上 | 是 | [R] CHANGELOG + README |
| 10 | Together | 同上 | 是 | [R] CHANGELOG + README |
| 11 | xAI | 同上 | 是 | [R] CHANGELOG + README |
| 12 | Moonshot | 同上 | 是 | [R] CHANGELOG + README |
| 13 | Volcengine | 同上 | 是 | [R] CHANGELOG + README |
| 14 | Cohere | 同上 | 否（仅模板）| [R] CHANGELOG + README |

### P0-B: 本地模型 Provider

| # | Provider | 本项目 | 上游证据 |
|---|----------|--------|---------|
| 1 | Ollama | ✅ 已配置 | [R] CHANGELOG + README |
| 2 | LM Studio | ✅ 模板 | [R] README |
| 3 | vLLM | ✅ 模板 | [R] README |
| 4 | llama.cpp | ✅ 模板 | [R] README |
| 5 | llamafile | ✅ 模板 | [R] README |

### P0-C: 核心路由 + API（本项目已实现）

| 功能 | 本项目 | 上游证据 |
|------|--------|---------|
| POST /v1/chat/completions（stream + non-stream） | ✅ `proxy.js` | [R] + [U] |
| POST /v1/messages（stream + non-stream） | ✅ `proxy.js` | [R] + [U] |
| POST /v1/responses | ✅ `proxy.js` | [R] |
| GET /v1/models（含 type 分组） | ✅ `proxy.js` | [R] FAQ |
| 双向 OpenAI ↔ Anthropic 流式转换 | ✅ `stream-bridge.js` | [R] + [U] |
| fallback 路由 | ✅ `route-logic.js` | [R] + [U] |
| round_robin 路由 | ✅（**上游列为 Pro 功能**）| [R] COMMERCIAL-LICENSE |
| weighted 路由 | ✅ | 上游未提及 |
| 健康检查 + cooldown | ✅ `provider-health.js` | [R] + [U] |
| per-route / per-provider 限额 | ✅ | [U] |
| Dashboard 7 个 Tab | ✅ | [R] 截图 |

---

## P1: 第二版补齐模板（已有模板，需完善）

以下 18 个 Provider 已有模板在 `src/provider-registry.js`，但尚未在 `config.json` 中配置，或需 endpoint 适配。

| # | Provider | 本项目模板 | 缺失原因 |
|---|----------|-----------|---------|
| 1 | Cerebras | ✅ | 用户自行填 Key |
| 2 | SambaNova | ✅ | 同上 |
| 3 | DashScope | ✅ | 同上 |
| 4 | NVIDIA NIM | ✅ | 同上 |
| 5 | GitHub Models | ✅ | 同上 |
| 6 | Fireworks | ✅ | 同上 |
| 7 | Qianfan | ✅ | 同上 |
| 8 | Qiniu | ✅ | 同上 |
| 9 | Hunyuan | ✅ | 同上 |
| 10 | Cloudflare AI | ✅ | 同上 |
| 11 | HuggingFace | ✅ | 同上 |
| 12 | LongCat | ✅ | 同上 |
| 13 | Baichuan | ✅ | 同上 |
| 14 | Stepfun | ✅ | 同上 |
| 15 | MiniMax | ✅ | 同上 |
| 16 | Pollinations | ✅ | 同上 |
| 17 | Azure OpenAI | 🟡 需 endpoint 适配 | 非标准 OpenAI endpoint |
| 18 | Anthropic-direct | 🟡 与 Anthropic 重复 | 可合并 |

### 缺失 Provider（待研究公开 endpoint）

| Provider | 上游证据 | 状态 |
|----------|---------|------|
| Kilo | [R] README | 公开 base URL 未知 |
| LLM7 | [R] README | 公开 base URL 未知 |
| Vercel AI Gateway | [R] README | 用户自定义 gateway URL |
| BlazeAPI | [R] README | 公开 base URL 未知 |
| BazaarLink | [R] README | 公开 base URL 未知 |

---

## P2: 高级路由（0.1.1 后续）

| 功能 | 上游 | 本项目 | 工作量估计 |
|------|------|--------|-----------|
| `/{provider}/v1/...` 路径路由 | [R] FAQ | ✅ 已实现 (0.1.2) | — |
| quota-aware 自动 failover | [R] README | 🟡 仅健康检查 | 3–5 天 |
| tool/function calling 显式转换 | [R] CHANGELOG | 🟡 passthrough | 2–3 天 |
| per-model 限额 | [U] | ❌ | 1–2 天 |
| 实时配额圆点 | [R] 截图 | ❌ | 1–2 天 |

---

## P3: IDE 代理（0.2.0+）

| IDE | 上游 | 协议 | 本项目 | 工作量 |
|-----|------|------|--------|--------|
| Cursor | [R] port 18780 | ConnectRPC / HTTP/2 + TLS | ❌ | 数周 |
| Windsurf | [R] port 18766 | ConnectRPC | ❌ | 数周 |
| Antigravity | [R] port 18767 | Gemini REST | ❌ | 1–2 周 |
| VS Code Copilot | [R] port 18769 | Ollama BYOK | ❌ | 1–2 周 |

---

## P4: 凭据连接器（暂不做 / 0.3.0+）

11 个凭据连接器（见 "本地/CLI/IDE Provider 差距"）全部 **暂不做**。安全设计文档见 `CONNECTOR_SECURITY.md`。

---

## 实施路线图

```
P0  (0.1.1) ─── 14 API + 5 本地 + 全部路由 + Dashboard + sk-or-* 鉴权
                 ↑ 当前已完成
P1  (0.1.2) ─── 补齐 37 模板文档 + 研究 5 个缺失 Provider
P2  (0.2.0) ─── /{provider} 路径路由 + quota-aware failover + tool calling
P3  (0.3.0) ─── IDE 代理原型（优先 Cursor, Windsurf）
P4  (0.4.0+) ─ 凭据连接器（需安全审查，来自 CONNECTOR_SECURITY.md）
```
