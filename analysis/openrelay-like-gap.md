# 差距分析: openrelay-like vs romgX/openrelay

> **⚠️ Historical report (pre-0.3.3).** This document describes the 0.3.0 codebase. For the current (0.3.3) status, refer to [PARITY_OPENRELAY.md](../PARITY_OPENRELAY.md).

> 本项目: openrelay-like 0.3.0  
> 上游: romgX/openrelay v0.10.48（最新 release）/ v0.8.3（GitHub 源码版本）  
> 分析方法: 仅公开资料 + 只读检查。未运行上游 binary。  
> 证据等级: [R] README声称 / [RL] Release证据 / [S] 公开源码 / [U] 尚未黑盒验证 / [本] 已实现 / [原] 原型 / [未] 未实现

---

## 1. 启动与端口

| 维度 | 上游 | 本项目 |
|------|------|--------|
| 默认端口 | 18765 [R] | 39210 |
| 配置方式 | `PORT` env [R] | `PORT` env |
| 启动方式 | 双击 binary 或 `openrelay` [R] + [RL] | `node src/server.js`（需 Node.js） |
| Dashboard URL | `http://localhost:18765` [R] | `http://127.0.0.1:39210` |
| 诊断模式 | `openrelay --test` [R] | `npm run check` / `npm run doctor` |
| 开机自启 | 无内置 [R] FAQ | 无 |

**差距**: 端口不同但可配置消除。启动方式差异大（binary vs node）。

---

## 2. Provider 差距

### 2.1 数量

| 项目 | 上游 | 本项目 |
|------|------|--------|
| Provider 总声称数 | 45 [R] | 37 模板 |
| 直接 API | 34 [R] | 32 模板 |
| 本地模型 | 5（Ollama, LM Studio, vLLM, llama.cpp, llamafile）[R] | 5 |
| 本地/CLI/IDE 凭据 | 11 [R] + [S] | **0 — 全部暂不做** |

### 2.2 已有 API Provider

以下 32 个模板存在于 `src/provider-registry.js` 中：

OpenAI, Anthropic, DeepSeek, Gemini, Groq, OpenRouter, Mistral, SiliconFlow, Zhipu, Cohere, xAI, Together,
Cerebras, SambaNova, LongCat, DashScope, NVIDIA NIM, GitHub Models, Fireworks, Volcengine, Qianfan, Qiniu,
Hunyuan, Cloudflare AI, HuggingFace, Moonshot, Baichuan, Stepfun, MiniMax, Pollinations,
Azure OpenAI, Anthropic-direct

**其中**: 19 个在 `config.json` 中有实际配置，其余 18 个是纯模板（用户需自行填 Key）。

### 2.3 上游有 / 本项目缺

| Provider | 说明 | 原因 |
|----------|------|------|
| Kilo | [R] README 表格 | 公开 endpoint 未知 |
| LLM7 | [R] README 表格 | 公开 endpoint 未知 |
| Vercel AI Gateway | [R] README 表格 | 用户自定义 gateway，可加模板 |
| BlazeAPI | [R] README 表格 | 公开 endpoint 未知 |
| BazaarLink | [R] README 表格 | 公开 endpoint 未知 |

### 2.4 本地 / CLI / IDE Provider（全部暂不做）

共 11 个，上游证据均为 [R] README 声称，仅 Claude Desktop 有 [S] 公开源码（`src/cookie.ts`）。

| Provider | 本项目 | 安全关注 |
|----------|--------|---------|
| Claude Desktop | **暂不做** | 读取系统 Keychain / DPAPI + Chromium cookie DB |
| Claude Code | **暂不做** | 读取 `~/.claude/` 凭据文件 |
| Kiro (AWS) | **暂不做** | AWS Cognito token |
| Windsurf | **暂不做** | IDE session |
| Antigravity | **暂不做** | 未知协议 |
| OpenCode | **暂不做** | 读取本地配置文件 |
| VS Code Copilot | **暂不做** | GitHub auth token |
| OpenAI Codex | **暂不做** | Codex 本地认证 |
| Gemini CLI | **暂不做** | OAuth 凭据文件 |
| Rovo Dev | **暂不做** | 未知 |
| QClaw | **暂不做** | 未知 |

---

## 3. IDE 代理差距

| IDE | 上游 | 协议 | 本项目 |
|-----|------|------|--------|
| Cursor | port 18780 | ConnectRPC / HTTP/2 [R] | **未实现** |
| Windsurf | port 18766 | ConnectRPC [R] | **未实现** |
| VS Code Copilot | port 18769 | Ollama BYOK 桥接 [R] | **未实现** |
| Antigravity | port 18767 | Gemini REST 代理 [R] | **未实现** |

**工程说明**: 上游 IDE 协议适配器不是简单反向代理。Cursor/Windsurf 使用 ConnectRPC，需要理解其 protobuf schema + TLS 握手 + HTTP/2 流管理。本项目 IDE Tab 仅为 UI 占位，所有启动按钮 disabled。

---

## 4. 路由差距

| 特性 | 上游 | 本项目 |
|------|------|--------|
| `/{provider}/v1/...` | [R] FAQ 示例 `http://localhost:18765/kiro` | **未实现** |
| fallback | [R] + [U] | ✅ |
| round_robin | [R] COMMERCIAL-LICENSE 列为 **Pro 功能** | ✅ |
| weighted | 上游未明确提及 | ✅ |
| health-aware | [R] + [U] | ✅ provider-health.js |
| **quota-aware failover** | [R] README "当 Groq 不可用→自动切换 Cerebras" | **未实现**（仅有健康检查） |

---

## 5. API 接口差距

| 接口 | 上游 | 本项目 |
|------|------|--------|
| POST /v1/chat/completions | [R] + [U] | ✅ 本 |
| POST /v1/messages | [R] + [U] | ✅ 本 |
| POST /v1/responses | [R] | ✅ 本 |
| GET /v1/models | [R] FAQ | ✅ 本（含 type 字段）|
| Azure OpenAI endpoint | [R] CHANGELOG | ❌ 未（仅模板）|
| `/{provider}/v1/...` | [R] FAQ `/kiro` | ❌ 未 |
| 双向流式转换 | [R] CHANGELOG + [U] | ✅ 本 |
| tool/function calling 显式转换 | [R] "full support" + [U] | 🟡 本（passthrough）|

---

## 6. Dashboard 差距

| Tab | 上游（截图） | 本项目 |
|-----|------------|--------|
| 总览 | 有 [R] | ✅ |
| Provider 列表 | 有（表格 + 绿色圆点）[R] | ✅ 有（无圆点）|
| 工具配置 | 有（toggle 开关）[R] | ✅ 有（命令生成器）|
| IDE 代理 | 有（启动/停止）[R] | 🟡 原型 Tab |
| 模型组 | "Custom" tab [R] | ✅ Routes |
| 用量/错误 | 有 [R] | ✅ |
| 设置 | 有 [R] | ✅ |

**未黑盒验证**（[U]）：上游 Dashboard 实际交互行为（刷新、错误提示、按钮状态）无法从截图确认。

---

## 7. 发布形态差距

| 维度 | 上游 | 本项目 |
|------|------|--------|
| Windows exe | [RL] 89 MB SEA, 2140 下载 | ❌ 需 Node.js |
| macOS binary | [RL] 230 MB | ❌ |
| Linux binary | [RL] 125–123 MB | ❌ |
| npm 安装 | [R] `npm install -g openrelay` | ❌ |
| ZIP 发布 | ✅ | ✅ build-dist.ps1 |
| SHA256 校验 | [RL] 每个 binary 有 .sha256 | ❌ |
| Pre-release 检查 | — | ✅ pre-release-check.mjs |
| 禁止文件检查 | — | ✅ build-dist 排除 .env / config.json / data/ |
| CI/CD | ✅ Release workflow | ✅ |

---

## 8. 差距汇总表

| # | 差距 | 严重程度 | 工作量估计 |
|---|------|---------|-----------|
| 1 | 默认端口 18765（可配置消除） | 低 | 0.5 天（文档） |
| 2 | 45 vs 37 Provider 模板（5 个需研究） | 中 | 2–3 天 |
| 3 | 11 个本地凭据发现（全部暂不做） | 高（设计决策） | 数月（需安全审查）|
| 4 | 4 个 IDE 代理（全部未实现） | 高 | 数周–数月 |
| 5 | `/{provider}` 路径路由 | 高 | 3–5 天（P0 返修）|
| 6 | 单文件二进制发布 | 中 | 1–2 天 CI 集成 |
| 7 | Azure OpenAI 适配 | 低 | 1–2 天 |
| 8 | quota-aware 自动 failover | 中 | 3–5 天 |
| 9 | tool calling 显式转换 | 中 | 2–3 天 |
| 10 | Dashboard 行为未对齐（需黑盒验证）| 低 | 1–2 天 |
| 11 | 实时配额圆点 | 低 | 1–2 天 |
| 12 | SHA256 校验 | 低 | 0.5 天 |
| 13 | npm 发布 | 低 | 0.5 天 |
