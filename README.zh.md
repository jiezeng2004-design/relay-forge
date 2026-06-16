# RelayForge v0.3.0

**零依赖、本地优先的 AI 编程网关** - 兼容 OpenAI / Anthropic 接口。
将本地 Ollama / LM Studio 和云端 DeepSeek / Groq 等多 providers 统一在 `http://127.0.0.1:18765/v1` 后面，
提供 Combo 路由、fallback、请求脱敏和轻量用量统计。

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](package.json)
[![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![Platform](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)]()

---

## 核心特性

- **Premium Dashboard UX** - v0.3.0 新增截图级的 Overview、Providers、Combo Models、Clients、Usage、Diagnostics 和 Settings 页面，支持 light/dark/system 外观。
- **零依赖** - 仅使用 Node.js 内置模块
- **本地优先** - 默认绑定 127.0.0.1，无遥测、无云锁定
- **OpenAI / Anthropic 兼容** - `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/models`
- **Combo 模型** - 虚拟模型名聚合多个 provider，支持 fallback / round_robin / weighted_round_robin
- **智能降级** - 429/503/超时自动切换到下一个候选
- **隐私默认开启** - 日志不记录 prompt，API Key 自动脱敏
- **最近请求记录** - 最近 20 条请求元数据（模型、provider、耗时、状态码），不含 prompt 内容
- **Provider 能力查询** - `/admin/status` 返回 providerCapabilities
- **不接入 OAuth 订阅 token** - 不读取 Claude Code / Codex / Cursor 个人登录 token

## 快速开始

### A. Windows zip 用户

1. 解压 `relayforge-0.3.0.zip`
2. 双击 **`Start_RelayForge.cmd`**
3. 打开 http://127.0.0.1:18765
4. 从启动日志中复制 token
5. 在 AI 编程工具中设置：
   ```
   Base URL: http://127.0.0.1:18765/v1
   API Key:  <RELAYFORGE_TOKEN from startup log>
   Model:    smart-coding
   ```

### B. PowerShell 用户

```powershell
$env:RELAYFORGE_TOKEN = "my-local-token"
$env:RELAYFORGE_PORT  = "18765"
node src/server.js
```

### C. macOS / Linux / WSL 用户

```bash
export RELAYFORGE_TOKEN="my-local-token"
export RELAYFORGE_PORT="18765"
node src/server.js
```

### D. 用 curl 验证

```bash
# 列出模型
curl http://127.0.0.1:18765/v1/models \
  -H "Authorization: Bearer my-local-token"

# Chat completion
curl http://127.0.0.1:18765/v1/chat/completions \
  -H "Authorization: Bearer my-local-token" \
  -H "Content-Type: application/json" \
  -d '{"model":"smart-coding","messages":[{"role":"user","content":"Hello!"}]}'

# 管理状态
curl http://127.0.0.1:18765/admin/status \
  -H "Authorization: Bearer my-local-token"
```

## 客户端配置

### CC Switch

```
Name: RelayForge
Base URL: http://127.0.0.1:18765/v1
API Key: <RELAYFORGE_TOKEN>
Model: smart-coding (或任意 combo/route/provider:model)
```

### opencode

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "smart-coding" }
    }
  },
  "models": {
    "providers": {
      "relayforge": {
        "baseUrl": "http://127.0.0.1:18765/v1",
        "apiKey": "<RELAYFORGE_TOKEN>",
        "api": "openai-completions",
        "models": [{ "id": "smart-coding" }]
      }
    }
  }
}
```

### Codex / OpenAI 兼容客户端

```bash
export OPENAI_BASE_URL="http://127.0.0.1:18765/v1"
export OPENAI_API_KEY="<RELAYFORGE_TOKEN>"
```

### Claude Code（OpenAI 兼容模式）

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:18765/v1"
export ANTHROPIC_API_KEY="<RELAYFORGE_TOKEN>"
```

> **安全提示：** RelayForge 使用 API key 认证。不会读取或转发 Claude Code、Codex、Cursor 的 OAuth 订阅 token。上游 provider 凭证始终由你控制。

## 配置

### Providers

```json
{
  "providers": [
    { "name": "ollama", "baseUrl": "http://127.0.0.1:11434/v1", "models": ["qwen2.5:7b"] },
    { "name": "deepseek", "baseUrl": "https://api.deepseek.com/v1", "keyEnv": "DEEPSEEK_API_KEYS", "models": ["deepseek-chat"] }
  ]
}
```

### Routes

```json
{
  "routes": [{
    "name": "coding-local",
    "strategy": "fallback",
    "candidates": [
      { "provider": "deepseek", "model": "deepseek-chat", "weight": 3 },
      { "provider": "ollama", "model": "qwen2.5:7b", "weight": 1 }
    ]
  }]
}
```

### Combo 模型（v0.1.0）

```json
{
  "combos": [{
    "name": "smart-coding",
    "strategy": "fallback",
    "candidates": [
      { "provider": "deepseek", "model": "deepseek-chat", "weight": 3, "priority": 2, "enabled": true },
      { "provider": "groq", "model": "llama-3.1-8b-instant", "weight": 2, "priority": 1, "enabled": true },
      { "provider": "ollama", "model": "qwen2.5:7b", "weight": 1, "priority": 0, "enabled": true }
    ]
  }]
}
```

### 隐私

```json
{
  "privacy": {
    "logPrompts": false,
    "logHeaders": false
  }
}
```

Prompt 默认不会存储在 Dashboard 日志中。

## 环境变量

| 变量 | 推荐 | 旧变量（向后兼容） |
|----------|-------------|-------------------------|
| `RELAYFORGE_TOKEN` | Yes - API 认证 token | `RELAY_TOKEN` / `OPENRELAY_TOKEN` |
| `RELAYFORGE_CONFIG` | Yes - 自定义配置路径 | `OPENRELAY_CONFIG` |
| `RELAYFORGE_STATE` | Yes - 自定义状态路径 | `OPENRELAY_STATE` |
| `RELAYFORGE_PORT` | Yes - 端口配置 | `PORT` / `OPENRELAY_PORT` |

同时设置 `RELAYFORGE_*` 和 `OPENRELAY_*` 时，`RELAYFORGE_*` 优先。

## 对比

| | RelayForge | LiteLLM | One API | 9Router |
|---|---|---|---|---|
| 依赖 | **零 npm** | 重 | 重 | 重 |
| 本地优先 | Yes | No | No | No |
| OAuth 路由 | No | No | No | Yes |
| Combo 模型 | Yes | Yes | No | Yes |
| 隐私日志 | Yes | No | No | No |
| MIT 许可证 | Yes | Yes | Yes | Yes |

## 路线图

**v0.1.x** - 完善文档、截图、demo GIF、客户端配置指南、CI 稳定

**v0.2.x** - 更好的 Dashboard UX、provider 健康页、配置导入/导出、配置校验 UI、token/费用估算

**v0.3.x** - 插件式 provider 模板、更多 AI 编程客户端预设、可选的本地加密密钥、Docker 支持

**不计划支持：** OAuth 订阅路由、云端密钥同步、内置账户共享、绕过 provider 速率限制、默认存储完整 prompt。

---

[MIT License](LICENSE) | [Third Party Notices](THIRD_PARTY_NOTICES.md) | [Release Notes](docs/release-v0.3.0.md)
