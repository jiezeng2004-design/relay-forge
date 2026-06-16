# 功能矩阵: romgX/openrelay vs openrelay-like

> **⚠️ Historical report (pre-0.3.3).** This document describes the 0.3.0 codebase. For the current (0.3.3) status, refer to [PARITY_OPENRELAY.md](../PARITY_OPENRELAY.md).

> 本项目: openrelay-like 0.3.0  
> 上游: romgX/openrelay v0.10.48（最新 release）/ v0.8.3（GitHub 源码版本）  
> 证据等级: [R] / [RL] / [S] / [U] / [本] / [原] / [未]

---

## 1. 启动与端口

| 维度 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| Dashboard URL | `http://localhost:18765` | [R] README, FAQ | `http://127.0.0.1:39210` | 端口不同，`PORT` 可覆盖 |
| 端口配置 | `PORT` env | [R] FAQ | `PORT` env | 一致 |
| 启动方式 | 双击 binary 或 `openrelay` | [R] + [RL] | `node src/server.js` | 需 Node.js |
| 诊断模式 | `openrelay --test` | [R] FAQ | `npm run check` / `npm run doctor` | 功能等价 |

## 2. Dashboard

| 维度 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| 总览 | 有 | [R] 截图 | ✅ [本] | 可用 |
| Provider 面板 | 有（表格 + 绿色圆点） | [R] 截图 | ✅ [本]（无圆点）| 可用 |
| 工具配置 | toggle 开关 | [R] 截图 | ✅ [本]（命令生成器）| 交互不同 |
| IDE 面板 | 启动/停止按钮 | [R] 截图 | 🟡 [原] 按钮 disabled | **后端缺失** |
| 模型组面板 | Custom tab | [R] 截图 | ✅ [本] Routes Tab | 可用 |
| 用量 / 错误 | 有 | [R] 截图 | ✅ [本] | 可用 |
| 设置 | 有 | [R] 截图 | ✅ [本] | 可用 |
| i18n | 中 / EN | [R] README | ✅ [本] zh.json + en.json | 一致 |
| LINUX DO 登录 | 有 | [R] FAQ | ❌ [未] | 不相关 |
| 实时配额圆点 | 绿色/红色 | [R] 截图 | ❌ [未] | 未实现 |
| Token 复制 | 有 | [R] FAQ | ✅ [本] | 可用 |

## 3. Provider

| 维度 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| 总声称数 | 45 | [R] README | 37 模板 | 差约 8 |
| 直接 API | 34 | [R] README | 32 模板 | 差 ~2–7 |
| 本地模型 | 5 | [R] README | 5 | 一致 |
| 本地 app 凭据 | 11 | [R] + [S] cookie.ts | 0 | **全部暂不做** |
| 模板添加 | 有 | [R] 截图推断 | ✅ [本] | 可用 |
| 健康检查 | 滑动窗口 + cooldown | [R] + [U] | ✅ [本] | 可用 |
| 模型发现 | GET /models | [R] FAQ | ✅ [本] | 可用 |
| 余额查询 | 只读 endpoint | [R] FAQ | ✅ [本] | 可用 |
| CRUD | Dashboard 面板 | [R] 截图推断 | ✅ [本] | 可用 |

## 4. API 兼容

| 接口 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| OpenAI Chat Completions | stream + non-stream | [R] + [U] | ✅ [本] | 可用 |
| Anthropic Messages | stream + non-stream | [R] + [U] | ✅ [本] | 可用 |
| OpenAI Responses | 有 | [R] CHANGELOG | ✅ [本] | 可用 |
| Azure OpenAI | 有 | [R] CHANGELOG | ❌ [未] 仅模板 | 未实现 |
| GET /v1/models | 有 | [R] FAQ curl | ✅ [本]（含 type） | 可用 |
| 双向流式转换 | 有 | [R] + [U] | ✅ [本] | 可用 |
| tool calling 显式转换 | "full support" | [R] + [U] | 🟡 [本] passthrough | 部分实现 |
| `/{provider}/v1/...` 路径 | `/kiro` 示例 | [R] FAQ | ❌ [未] | **未实现** |

## 5. 认证

| 模式 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| Bearer token | 必填 | [R] FAQ | ✅ [本] | 可用 |
| `sk-or-*` key | 支持 | [R] FAQ | ✅ [本] | 已实现 |
| `x-relay-token` | 兼容 | [R] FAQ | ✅ [本] | 可用 |
| 无鉴权模式 | — | — | ✅ [本] OPENRELAY_ALLOW_NO_AUTH | 本项目特有 |
| License 验证 | `license.limitlessmeto.com` | [R] PRIVACY.md | ❌ | 不适用 |

## 6. IDE 代理

| IDE | 上游 | 证据 | 本项目 |
|-----|------|------|--------|
| Cursor | ConnectRPC/HTTP2, port 18780 | [R] CHANGELOG + README | 🟡 [原] 原型 Tab，无后端 |
| Windsurf | ConnectRPC, port 18766 | [R] CHANGELOG + README | 🟡 [原] 同上 |
| Antigravity | Gemini REST, port 18767 | [R] CHANGELOG + README | 🟡 [原] 同上 |
| VS Code Copilot | Ollama BYOK bridge, port 18769 | [R] CHANGELOG + README | 🟡 [原] 同上 |

## 7. 凭据连接器

| App | 上游 | 证据 | 本项目 |
|-----|------|------|--------|
| Claude Desktop | 读取 Chromium cookie DB + Keychain/DPAPI | [S] `src/cookie.ts` | **暂不做** |
| 其余 10 个（Claude Code, Kiro, Windsurf 等）| 读取 app 凭据 | [R] README | **暂不做** |

## 8. 路由

| 策略 | 上游 | 证据 | 本项目 | 差距 |
|------|------|------|--------|------|
| fallback | 免费版可用 | [R] + [U] | ✅ | 可用 |
| round_robin | **Pro 功能** | [R] COMMERCIAL-LICENSE | ✅ | 本项目不受限制 |
| weighted | — | — | ✅ | 本项目超额实现 |
| health-aware | 有 | [R] + [U] | ✅ | 可用 |
| **quota-aware failover** | "自动 failover" | [R] + [U] | 🟡 仅健康检查 | **未实现** |

## 9. 配置与存储

| 维度 | 上游 | 本项目 |
|------|------|--------|
| 配置文件 | `~/.openrelay/config.json` [R] | `./config.json` |
| env 支持 | `.env` [R] | `.env` |
| schema 校验 | — | ✅ config-schema.js（42 项测试）|
| 密钥加密 | —（未声明是否加密）| ✅ AES-256-GCM, keys.enc.json |
| 运行时持久化 | — | ✅ runtime-state.js |
| 导入/导出 | 可能有 | ✅ Dashboard |
| 自动备份 | — | ✅ backups/ |
| 诊断工具 | `openrelay --test` [R] | ✅ `npm run doctor`（脱敏 JSON）|

## 10. 发布包

| 维度 | 上游 | 本项目 |
|------|------|--------|
| Windows exe | 89 MB [RL] | ❌ |
| macOS binary | 230 MB [RL] | ❌ |
| Linux binary | 125/123 MB [RL] | ❌ |
| npm | `npm install -g openrelay` [R] | ❌ |
| ZIP 发布 | GitHub Releases [RL] | ✅ build-dist.ps1 |
| SHA256 校验 | ✅ [RL] | ❌ |
| pre-release 检查 | — | ✅ pre-release-check.mjs |
| CI/CD | ✅ | ✅ |
| 禁止文件检查 | — | ✅ build-dist 排除 .env / config.json / data/ |
