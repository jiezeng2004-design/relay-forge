# API 矩阵: 推理端点

> **⚠️ Historical report (pre-0.3.3).** This document describes the 0.3.0 codebase. For the current (0.3.3) status, refer to [PARITY_OPENRELAY.md](../PARITY_OPENRELAY.md).

> 本项目: openrelay-like 0.3.0  
> 证据等级: [R] / [RL] / [U] / [本] / [未]

---

## 1. 推理端点

| 路径 | 方法 | 上游证据 | 上游 | 本项目 | 0.3.0 |
|------|------|---------|------|--------|-------|
| `/v1/chat/completions` | POST | [R] CHANGELOG + FAQ | streaming + non-streaming | ✅ [本] | **必须** |
| `/v1/messages` | POST | [R] CHANGELOG + FAQ | streaming + non-streaming | ✅ [本] | **必须** |
| `/v1/responses` | POST | [R] CHANGELOG | 有 | ✅ [本] | 可选 |
| `/v1/models` | GET | [R] FAQ curl 示例 | 有 | ✅ [本] (含 type) | **必须** |
| Azure OpenAI | POST | [R] CHANGELOG | 有 | ❌ [未] 仅模板 | 可选 |
| `/{provider}/v1/chat/completions` | POST | [R] FAQ "/kiro" | 有 | ❌ [未] | **P0 返修** |

## 2. 管理与 Dashboard API

| 路径 | 方法 | 上游证据 | 本项目 | 说明 |
|------|------|---------|--------|------|
| `/` (Dashboard) | GET | [R] README | ✅ | |
| `/health` | GET | [U] | ✅ | |
| `/admin/status` | GET | [U] | ✅ | |
| `/admin/config` | GET/POST | [U] | ✅ | |
| `/admin/providers` | GET/POST/PATCH/DELETE | [U] | ✅ | |
| `/admin/routes` | GET/POST/PATCH/DELETE | [U] | ✅ | |
| `/admin/keys` | GET/POST/PATCH/DELETE | [U] | ✅ | |
| `/admin/profile` | GET/POST | [U] | ✅ | |
| `/admin/auth/token` | GET | [U] | ✅ | |
| `/admin/render-tab` | GET | [U] | ✅ | SPA 刷新 |
| IDE proxy start/stop | POST | [R] 截图 | ❌ | 原型 Tab |

**说明**: 本项目 admin API 基于自身架构设计，未与上游黑盒对齐。

## 3. 请求 / 响应格式

### POST /v1/chat/completions

**请求**（OpenAI 标准）:
```json
{ "model": "auto", "messages": [{"role": "user", "content": "Hello"}], "stream": true }
```

**响应**（非流）:
```json
{ "id": "chatcmpl-xxx", "object": "chat.completion",
  "model": "deepseek:deepseek-chat",
  "choices": [{"index": 0, "message": {"role": "assistant", "content": "Hi!"}}],
  "usage": {"prompt_tokens": 10, "completion_tokens": 5} }
```

**本项目**: ✅ [本]。上游 [R] + [U]。

### POST /v1/messages

**请求**（Anthropic 标准）:
```json
{ "model": "auto", "messages": [{"role": "user", "content": "Hello"}],
  "stream": true, "max_tokens": 1024 }
```

**本项目**: ✅ [本]。上游 [R] + [U]。

### GET /v1/models

**响应**:
```json
{ "object": "list", "data": [
  {"id": "profile-name", "object": "model", "owned_by": "local-profile", "type": "local-profile"},
  {"id": "route-name",   "object": "model", "owned_by": "local-route",   "type": "local-route" }
]}
```

**本项目**: ✅ [本]（含 type 字段）。上游 [R] + [U]。

## 4. 认证 API

| 机制 | 上游 | 本项目 |
|------|------|--------|
| `Authorization: Bearer <token>` | [R] FAQ | ✅ |
| `sk-or-{provider}-{hex}` | [R] FAQ | ✅ parseOpenRelayKey |
| `x-relay-token: <token>` | [R] FAQ | ✅ |
| 401 响应格式 | FAQ 仅提到 401 | `{"error": "unauthorized"}` |
| 无鉴权模式 | 未提及 | ✅ OPENRELAY_ALLOW_NO_AUTH |
| License 验证 | [R] PRIVACY.md | ❌ 不适用 |

## 5. IDE 代理端口

| IDE | 端口 | 协议 | 本项目 |
|-----|------|------|--------|
| Cursor | 18780 | ConnectRPC / HTTP/2 [R] | ❌ |
| Windsurf | 18766 | ConnectRPC [R] | ❌ |
| Antigravity | 18767 | Gemini REST [R] | ❌ |
| VS Code Copilot | 18769 | Ollama BYOK [R] | ❌ |

## 6. 未黑盒验证的细节

以下行为需要运行上游 binary 黑盒测试才能确认：

1. **error 响应格式** — 429 / 401 / 500 的 JSON body 结构
2. **streaming chunk 格式** — `data: [DONE]` 和 `data: {...}` 的具体字段
3. **model 字段值** — 返回的 `model` 是 `provider:model` 还是其他格式
4. **usage 字段** — 是否返回 token 用量
5. **rate limit header** — 是否返回 `x-ratelimit-*`
6. **CORS header** — 是否允许 cross-origin 请求
7. **timeout 行为** — 具体 idle / request timeout 数值
