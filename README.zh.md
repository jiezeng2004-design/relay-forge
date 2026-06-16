# RelayForge v0.1.0

**零依赖、本地优先的 AI 编程网关** — 兼容 OpenAI / Anthropic 接口。
将本地 Ollama / LM Studio 和云端 DeepSeek / Groq 等多 providers 统一在 `http://127.0.0.1:18765/v1` 后面，
提供 Combo 路由、fallback、请求脱敏和轻量用量统计。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](package.json)
[![依赖](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![平台](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)]()

---

## 核心特性

- **零依赖** — 仅使用 Node.js 内置模块
- **本地优先** — 默认绑定 127.0.0.1，无遥测、无云锁定
- **OpenAI / Anthropic 兼容** — `/v1/chat/completions`、`/v1/messages`、`/v1/models`
- **Combo 模型** — 虚拟模型名聚合多个 provider，支持 fallback / round_robin / weighted_round_robin
- **智能降级** — 429/503/超时自动切换到下一个候选
- **隐私默认开启** — 日志不记录 prompt，API Key 自动脱敏
- **最近请求记录** — 最近 20 条请求元数据（模型、provider、耗时、状态码），不含 prompt 内容
- **Provider 能力查询** — `/admin/status` 返回 providerCapabilities
- **不接入 OAuth 订阅 token** — 不读取 Claude Code / Codex / Cursor 个人登录 token

## 快速开始

```bash
git clone <repo-url> relayforge
cd relayforge
cp config.example.json config.json

# 设置 relay token（推荐）
$env:RELAYFORGE_TOKEN = "my-secret-token"

# 启动
node src/server.js
# RelayForge is running at http://127.0.0.1:18765
```

## 环境变量

| 变量 | 推荐 | 旧变量（向后兼容） |
|----------|-------------|-------------------------|
| `RELAYFORGE_TOKEN` | ✅ API 认证 token | `RELAY_TOKEN` / `OPENRELAY_TOKEN` |
| `RELAYFORGE_CONFIG` | ✅ 自定义配置路径 | `OPENRELAY_CONFIG` |
| `RELAYFORGE_STATE` | ✅ 自定义状态路径 | `OPENRELAY_STATE` |
| `RELAYFORGE_PORT` | ✅ 端口配置 | `PORT` / `OPENRELAY_PORT` |

同时设置 `RELAYFORGE_*` 和 `OPENRELAY_*` 时，`RELAYFORGE_*` 优先。

## 安全说明

- RelayForge **不支持** OAuth 订阅 token 路由
- **不读取**本地客户端登录 token
- 推荐只将 RELAYFORGE_TOKEN 暴露给客户端
- prompt 默认不记录
- Authorization / API Key 默认脱敏

## 对比

| | RelayForge | LiteLLM | One API | 9Router |
|---|---|---|---|---|
| 依赖 | **零 npm** | 重 | 重 | 重 |
| 本地优先 | ✅ | ❌ | ❌ | ❌ |
| OAuth 路由 | ❌ | ❌ | ❌ | ✅ |
| Combo 模型 | ✅ | ✅ | ❌ | ✅ |
| 隐私日志 | ✅ | ❌ | ❌ | ❌ |
| MIT 许可证 | ✅ | ✅ | ✅ | ✅ |

---

[MIT 许可证](LICENSE) · [第三方声明](THIRD_PARTY_NOTICES.md) · [发布说明](docs/release-v0.1.0.md)
