# RelayForge Code Wiki

## 目录

1. [项目概述](#项目概述)
2. [整体架构](#整体架构)
3. [目录结构](#目录结构)
4. [核心模块详解](#核心模块详解)
5. [关键类与函数](#关键类与函数)
6. [依赖关系图](#依赖关系图)
7. [配置系统](#配置系统)
8. [API接口说明](#api接口说明)
9. [运行方式](#运行方式)
10. [测试体系](#测试体系)
11. [安全机制](#安全机制)

---

## 项目概述

### 项目简介

**RelayForge** 是一个零依赖、本地优先的 AI 编码网关。它提供统一的 OpenAI/Anthropic 兼容接口，将本地模型（Ollama、LM Studio、vLLM、llama.cpp）和云端 API 提供商整合在 `http://127.0.0.1:18765/v1` 端点后，支持组合路由、故障转移、隐私保护和轻量级使用分析。

### 核心特性

- **零 npm 依赖** - 仅使用 Node.js 内置模块
- **本地优先** - 默认绑定到 `127.0.0.1`，无遥测，无云锁定
- **OpenAI / Anthropic 兼容** - 支持 `/v1/chat/completions`、`/v1/messages`、`/v1/responses`、`/v1/models`
- **组合模型** - 虚拟模型名称，支持 fallback / round_robin / weighted_round_robin 策略
- **智能故障转移** - 429/503/超时触发级联到下一个候选
- **默认隐私保护** - 不记录提示，API 密钥被脱敏
- **提供商注册表** - 基于能力的提供商查询
- **高级仪表板** - 包含 Overview、Providers、Combo Models、Clients、Usage、Diagnostics、Settings 页面

### 技术栈

| 类别 | 技术 |
|------|------|
| 运行时 | Node.js >= 18 |
| 语言 | JavaScript (ES Modules) |
| 包管理 | npm (零依赖) |
| HTTP 服务器 | Node.js 原生 `http` 模块 |
| 加密 | Node.js 原生 `crypto` 模块 |
| 国际化 | 内置 i18n (zh/en) |

---

## 整体架构

### 架构图

```
┌─────────────────────────────────────────────────────────┐
│                    AI 编码客户端                         │
│  (Codex / opencode / Claude Code / Cline / ...)        │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│              RelayForge HTTP Server (18765)             │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   路由层 (Router)                 │  │
│  │  - 请求分发                                        │  │
│  │  - CORS 处理                                       │  │
│  │  - 认证检查                                        │  │
│  └───────────────────┬───────────────────────────────┘  │
│                      │                                  │
│         ┌────────────┴────────────┐                     │
│         ▼                         ▼                     │
│  ┌──────────────┐        ┌──────────────┐              │
│  │  Admin 处理器 │        │  Proxy 处理器 │              │
│  │  - 配置管理   │        │  - 请求代理   │              │
│  │  - 密钥管理   │        │  - 格式转换   │              │
│  │  - 健康检查   │        │  - 重试机制   │              │
│  │  - 使用统计   │        │  - 流式桥接   │              │
│  └──────┬───────┘        └──────┬───────┘              │
│         │                       │                      │
│         └───────────┬───────────┘                      │
│                     ▼                                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │                   核心服务层                        │  │
│  │  - KeyPool (密钥池轮询)                           │  │
│  │  - SecretStore (加密密钥存储)                     │  │
│  │  - UsageTracker (使用统计)                        │  │
│  │  - ProviderHealth (健康追踪)                      │  │
│  │  - RuntimeState (运行时状态持久化)                │  │
│  │  - RequestLog (请求日志)                          │  │
│  └───────────────────┬───────────────────────────────┘  │
│                      │                                  │
└──────────────────────┼──────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         ▼                           ▼
┌──────────────────┐      ┌──────────────────┐
│  云端 API 提供商  │      │  本地模型服务     │
│  (DeepSeek/Groq/ │      │  (Ollama/LM      │
│   OpenAI/...)    │      │   Studio/vLLM)   │
└──────────────────┘      └──────────────────┘
```

### 核心设计原则

1. **零依赖原则** - 不引入任何 npm 依赖，全部使用 Node.js 内置模块
2. **本地优先原则** - 默认绑定到 127.0.0.1，认证默认启用
3. **隐私保护原则** - 默认不记录提示内容，API 密钥始终脱敏
4. **确定性路由** - 路由决策基于明确的配置和健康状态
5. **安全边界** - 不读取/转发 OAuth 订阅令牌

---

## 目录结构

```
relay-forge-clean/
├── src/                              # 源代码目录
│   ├── server.js                     # 服务器入口文件
│   ├── config.js                     # 配置加载与规范化
│   ├── config-schema.js              # 配置 schema 验证
│   ├── router.js                     # HTTP 路由器
│   ├── auth.js                       # 本地中继认证
│   ├── key-pool.js                   # API 密钥池（轮询+冷却）
│   ├── secret-store.js               # 加密密钥存储
│   ├── format-convert.js             # OpenAI/Anthropic 格式转换
│   ├── stream-bridge.js              # 流式响应桥接
│   ├── responses-stream.js           # Responses API 流式处理
│   ├── usage.js                      # 使用统计追踪器
│   ├── token-estimate.js             # Token 估算
│   ├── balance.js                    # 余额查询
│   ├── combo.js                      # 组合模型
│   ├── privacy.js                    # 隐私保护
│   ├── request-log.js                # 请求日志
│   ├── error-category.js             # 错误分类
│   ├── http-helpers.js               # HTTP 辅助函数
│   ├── i18n.js                       # 国际化
│   ├── dashboard.js                  # 仪表板渲染
│   ├── provider-registry.js          # 提供商模板注册表
│   ├── provider-registry-lib.js      # 提供商注册表类
│   ├── provider-health.js            # 提供商健康追踪
│   ├── provider-test.js              # 提供商测试
│   ├── provider-template-parity.js   # 模板一致性检查
│   ├── provider-template-import-plan.js  # 模板导入计划
│   ├── runtime-state.js              # 运行时状态持久化
│   ├── route-preview.js              # 路由预览
│   ├── ide-proxy-preview.js          # IDE 代理预览
│   ├── ide-proxy-runtime.js          # IDE 代理运行时状态
│   ├── ide-proxy-port-check.js       # IDE 代理端口检查
│   ├── ide-proxy-start-plan.js       # IDE 代理启动计划
│   ├── local-connector-plan.js       # 本地连接器计划
│   ├── local-connector-availability.js   # 本地连接器可用性
│   ├── local-connector-provider-preview.js  # 本地连接器提供商预览
│   ├── local-connector-consent-manifest.js  # 本地连接器同意清单
│   ├── local-connector-consent-approval.js  # 本地连接器同意审批
│   ├── handlers/                     # 请求处理器
│   │   ├── admin.js                  # 管理接口处理器
│   │   └── proxy.js                  # 代理接口处理器
│   ├── lib/                          # 核心库
│   │   ├── config-ops.js             # 配置操作
│   │   └── route-logic.js            # 路由逻辑
│   └── dashboard/                    # 仪表板前端
│       ├── index.js                  # 仪表板主入口
│       ├── css.js                    # CSS 样式
│       ├── rows.js                   # 表格行组件
│       ├── shared.js                 # 共享组件
│       ├── static/
│       │   └── dashboard-client.js   # 客户端 JavaScript
│       └── tabs/                     # 仪表板标签页
│           ├── index.js              # 标签页入口
│           ├── overview.js           # 概览页
│           ├── providers.js          # 提供商页
│           ├── combo-models.js       # 组合模型页
│           ├── routes.js             # 路由页
│           ├── clients.js            # 客户端页
│           ├── usage.js              # 使用统计页
│           ├── tools.js              # 工具页
│           ├── settings.js           # 设置页
│           └── ide.js                # IDE 页
├── scripts/                          # 脚本目录
│   ├── build-dist.mjs                # 构建发布包
│   ├── build-exe.mjs                 # 构建可执行文件
│   ├── pre-release-check.mjs         # 发布前检查
│   ├── doctor.mjs                    # 诊断脚本
│   ├── smoke-test.mjs                # 冒烟测试
│   ├── provider-test.mjs             # 提供商测试
│   ├── clean.mjs                     # 清理脚本
│   ├── verify-zip.mjs                # ZIP 验证
│   ├── verify-release-artifacts.mjs  # 发布产物验证
│   └── test-*.mjs                    # 各类测试脚本
├── i18n/                             # 国际化
│   ├── en.json                       # 英文翻译
│   └── zh.json                       # 中文翻译
├── docs/                             # 文档
│   ├── agent-reference.md            # Agent 参考
│   ├── release-v0.3.1.md             # 发布说明
│   └── ...
├── analysis/                         # 分析文档
├── .github/                          # GitHub 配置
│   ├── workflows/                    # CI/CD 工作流
│   └── ISSUE_TEMPLATE/               # Issue 模板
├── config.example.json               # 配置示例
├── .env.example                      # 环境变量示例
├── package.json                      # 项目配置
├── AGENTS.md                         # Agent 开发规则
├── CHANGELOG.md                      # 变更日志
├── README.md                         # 项目说明
├── SECURITY.md                       # 安全说明
├── CONTRIBUTING.md                   # 贡献指南
└── LICENSE                           # MIT 许可证
```

---

## 核心模块详解

### 1. 服务器入口 (server.js)

**文件**: [server.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/server.js)

**职责**:
- 初始化所有核心服务
- 创建 HTTP 服务器
- 构建应用上下文 (ctx)
- 注册请求处理器
- 管理服务生命周期（启动、关闭）
- 调度健康检查

**核心流程**:
1. 解析 CLI 参数和环境变量
2. 加载 .env 文件
3. 解析中继认证配置
4. 加载并规范化配置
5. 初始化 SecretStore、KeyPool、UsageTracker 等核心服务
6. 加载持久化的运行时状态
7. 创建 Admin 和 Proxy 处理器
8. 创建路由器并启动 HTTP 服务器
9. 注册 SIGINT/SIGTERM 信号处理

### 2. 配置模块 (config.js)

**文件**: [config.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/config.js)

**职责**:
- 检测运行时根目录
- 加载 .env 文件（支持 POSIX 风格的 last-write-wins 语义）
- 加载和规范化配置文件
- 验证提供商 base URL
- 获取提供商 API 密钥

**核心函数**:

| 函数 | 说明 |
|------|------|
| `detectRuntimeRootDir()` | 检测运行时根目录（支持源码和二进制模式） |
| `loadDotEnv(rootDir)` | 加载 .env 文件，支持重复键 last-write-wins |
| `loadConfig(rootDir)` | 加载配置文件 |
| `normalizeConfig(config)` | 规范化配置（验证、补全默认值） |
| `getProviderKeys(provider)` | 获取提供商的 API 密钥列表 |
| `validateProviderBaseUrl()` | 验证提供商 base URL 安全性 |
| `isLoopbackHost(hostname)` | 判断是否为回环地址 |

### 3. 路由器 (router.js)

**文件**: [router.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/router.js)

**职责**:
- HTTP 请求分发
- CORS 处理
- 认证检查
- 路由匹配

**支持的路由**:

| 路径 | 方法 | 说明 |
|------|------|------|
| `/` | GET | 仪表板页面（需认证） |
| `/health` | GET | 健康检查（公开） |
| `/admin/status` | GET | 完整状态（需管理员认证） |
| `/admin/usage` | GET | 使用统计（需管理员认证） |
| `/admin/config` | GET/POST | 配置管理 |
| `/admin/providers` | GET/POST | 提供商管理 |
| `/admin/routes` | GET/POST | 路由管理 |
| `/admin/keys` | GET/POST | 密钥管理 |
| `/admin/test-provider` | POST | 提供商测试 |
| `/v1/models` | GET | 模型列表 |
| `/v1/chat/completions` | POST | Chat Completions API |
| `/v1/responses` | POST | Responses API |
| `/v1/messages` | POST | Anthropic Messages API |
| `/{provider}/v1/*` | 多种 | 提供商直接路由 |

### 4. 认证模块 (auth.js)

**文件**: [auth.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/auth.js)

**职责**:
- 管理本地中继认证
- 支持多种令牌来源（优先级从高到低）：
  1. `RELAYFORGE_TOKEN` 环境变量
  2. `RELAY_TOKEN` 环境变量（兼容旧版）
  3. `OPENRELAY_TOKEN` 环境变量（兼容旧版）
  4. `data/security/relay-token` 文件（自动生成）
- 支持显式无认证模式（需 `RELAYFORGE_ALLOW_NO_AUTH=true`）

**核心函数**:

| 函数 | 说明 |
|------|------|
| `resolveRelayAuth(options)` | 解析中继认证配置 |
| `maskToken(token)` | 脱敏令牌（显示前6后4位） |
| `describeAuth(auth)` | 生成认证状态描述（不暴露完整令牌） |
| `parseOpenRelayKey(token)` | 解析 OpenRelay 格式的密钥 |

### 5. 密钥池 (key-pool.js)

**文件**: [key-pool.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/key-pool.js)

**职责**:
- 管理多个 API 密钥的轮询
- 支持失败冷却机制
- 合并环境变量密钥和 Web UI 添加的密钥
- 追踪密钥使用统计

**KeyPool 类**:

| 方法 | 说明 |
|------|------|
| `constructor(providers, getKeys, cooldownMs, options)` | 构造函数 |
| `reload(providers)` | 重新加载所有提供商的密钥 |
| `next(providerName)` | 获取下一个可用的密钥（轮询） |
| `markFailure(providerName, key, shouldCooldown)` | 标记密钥失败并可选冷却 |
| `summary()` | 获取密钥池状态摘要 |

**密钥优先级**:
1. Web UI 添加的密钥（SecretStore）
2. 环境变量中的密钥

### 6. 加密密钥存储 (secret-store.js)

**文件**: [secret-store.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/secret-store.js)

**职责**:
- 安全存储通过 Web UI 添加的 API 密钥
- 使用 AES-256-GCM 加密
- 主密钥来源（优先级）：
  1. `OPENRELAY_KEYSTORE_SECRET` 环境变量
  2. `data/master.key` 文件（自动生成）
- 从不通过 HTTP API 返回明文密钥

**存储布局**:
```
data/
├── keys.enc.json    # AES-256-GCM 加密的密钥记录
└── master.key       # 32 字节随机主密钥 (0600 权限)
```

**SecretStore 类**:

| 方法 | 说明 |
|------|------|
| `constructor({ dataDir, env, readOnly })` | 构造函数 |
| `list({ provider })` | 列出密钥（不含明文） |
| `get(id)` | 获取单个密钥记录（不含明文） |
| `getDecryptedValue(id)` | 获取解密后的密钥值（服务端内部用） |
| `getDecryptedValuesForProvider(providerName)` | 获取提供商的所有解密密钥 |
| `add({ provider, value, label, enabled })` | 添加新密钥 |
| `update(id, patch)` | 更新密钥 |
| `remove(id)` | 删除密钥 |
| `markUsed(id)` | 标记密钥已使用（仅内存） |
| `recordTestResult(id, result)` | 记录测试结果 |
| `hasMasterKeyOnDisk()` | 检查磁盘上是否有主密钥 |
| `hasMasterKeyInEnv()` | 检查环境变量中是否有主密钥 |

### 7. 格式转换 (format-convert.js)

**文件**: [format-convert.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/format-convert.js)

**职责**:
- OpenAI 和 Anthropic API 格式之间的双向转换
- 支持消息、响应、工具调用的转换
- 无副作用、无 I/O、无共享状态（可独立测试）

**核心转换函数**:

| 函数 | 方向 | 说明 |
|------|------|------|
| `openAiToAnthropic(payload, model)` | OpenAI → Anthropic | 请求转换 |
| `anthropicToOpenAi(payload, model)` | Anthropic → OpenAI | 请求转换 |
| `openAiResponseToAnthropic(response)` | OpenAI → Anthropic | 响应转换 |
| `anthropicResponseToOpenAi(response)` | Anthropic → OpenAI | 响应转换 |
| `openAiResponseToResponses(response)` | OpenAI → Responses | 响应转换 |
| `anthropicResponseToResponses(response)` | Anthropic → Responses | 响应转换 |
| `responsesToChatPayload(payload)` | Responses → Chat | 请求转换 |

**支持的转换内容**:
- 消息角色映射（system/user/assistant/tool）
- 内容格式（文本、图片、工具使用）
- 工具调用格式（function → tool_use）
- Token 使用统计
- 流式响应桥接（stream-bridge.js）

### 8. 代理处理器 (handlers/proxy.js)

**文件**: [handlers/proxy.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/handlers/proxy.js)

**职责**:
- 处理 API 代理请求
- 实现重试和故障转移逻辑
- 流式响应处理
- 使用统计记录
- 本地限制检查

**核心函数**:

| 函数 | 说明 |
|------|------|
| `handleChatCompletions(req, res)` | 处理 OpenAI Chat Completions |
| `handleAnthropicMessages(req, res)` | 处理 Anthropic Messages |
| `handleOpenAIResponses(req, res)` | 处理 OpenAI Responses API |
| `handleModels(req, res)` | 处理模型列表 |
| `handleProviderDirect(req, res, providerName, pathSuffix)` | 处理提供商直接路由 |
| `proxyWithRetry({ ... })` | 带重试的代理（非流式） |
| `streamWithRetry({ ... })` | 带重试的流式代理 |

**重试策略**:
- 可重试状态码: 408, 409, 425, 429, 500, 502, 503, 504
- 401/403 不重试同一提供商（密钥错误）
- 最大重试次数: `config.retry.maxAttempts`（默认 3）
- 超时时间: `config.retry.timeoutMs`（默认 120s）

### 9. 管理处理器 (handlers/admin.js)

**文件**: [handlers/admin.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/handlers/admin.js)

**职责**:
- 管理配置（读取、保存、导入、导出）
- 管理提供商（增删改查）
- 管理路由（增删改查）
- 管理密钥（增删改查、测试）
- 管理配置文件（激活、编辑、克隆、删除）
- 健康检查和诊断
- IDE 代理相关功能
- 本地连接器相关功能

### 10. 使用统计 (usage.js)

**文件**: [usage.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/usage.js)

**职责**:
- 追踪每日请求统计（按路由、提供商、模型）
- 追踪历史使用记录
- 追踪运行时延迟统计（环形缓冲区）
- 计算 P50/P95 延迟
- 追踪 Token 使用量

**UsageTracker 类**:

| 方法 | 说明 |
|------|------|
| `constructor(initial, options)` | 构造函数 |
| `increment(kind, name)` | 增加每日计数 |
| `incrementRuntime(kind, name, field)` | 增加运行时计数 |
| `recordLatency(kind, name, latencyMs)` | 记录延迟（环形缓冲区） |
| `recordTokens(kind, name, promptTokens, completionTokens)` | 记录 Token 使用 |
| `resetIfNeeded()` | 日期变更时重置每日统计 |
| `metrics()` | 获取延迟指标（P50/P95/平均） |
| `summary(retentionDays)` | 获取完整统计摘要 |

**数据结构**:
```javascript
{
  day: "2024-01-01",
  daily: {
    total: 100,
    routes: { "smart-coding": 50, ... },
    providers: { "deepseek": 30, ... },
    models: { "deepseek-chat": 30, ... }
  },
  history: [
    { day: "2023-12-31", total: 80, routes: {}, providers: {}, models: {} }
  ],
  runtime: {
    byRoute: { "smart-coding": { latencies: [...], samples: 50, totalLatencyMs: ..., promptTokens: ..., completionTokens: ... } },
    byProvider: { ... },
    byModel: { ... }
  }
}
```

### 11. 提供商注册表 (provider-registry.js)

**文件**: [provider-registry.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/provider-registry.js)

**职责**:
- 维护提供商模板列表
- 维护路由模板列表
- 定义本地提供商名称集合
- 提供提供商模板查询功能

**内置提供商模板** (40+):
- **云端**: OpenAI, Anthropic, DeepSeek, Gemini, Groq, OpenRouter, Mistral, SiliconFlow, 智谱GLM, Cohere, xAI, Together AI, Moonshot, 百川, 阶跃星辰, MiniMax, 腾讯混元, 百度千帆, 阿里云通义千问, 火山引擎豆包, 等
- **本地**: Ollama, LM Studio, vLLM, llama.cpp, llamafile

**核心常量**:

| 常量 | 说明 |
|------|------|
| `PROVIDER_TEMPLATES` | 提供商模板数组 |
| `ROUTE_TEMPLATES` | 路由模板数组 |
| `LOCAL_PROVIDER_NAMES` | 本地提供商名称集合 |
| `SUPPORTED_TABS` | 支持的仪表板标签页 |
| `V1_PROXY_PATHS` | V1 代理路径集合 |

---

## 关键类与函数

### 类列表

| 类名 | 文件 | 职责 |
|------|------|------|
| `KeyPool` | [key-pool.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/key-pool.js) | API 密钥池管理 |
| `SecretStore` | [secret-store.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/secret-store.js) | 加密密钥存储 |
| `UsageTracker` | [usage.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/usage.js) | 使用统计追踪 |
| `ProviderHealthTracker` | [provider-health.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/provider-health.js) | 提供商健康追踪 |
| `RequestLog` | [request-log.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/request-log.js) | 请求日志 |
| `ProviderRegistry` | [provider-registry-lib.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/provider-registry-lib.js) | 提供商注册表 |

### 重要函数列表

#### 配置相关

| 函数 | 文件 | 说明 |
|------|------|------|
| `loadConfig(rootDir)` | [config.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/config.js) | 加载配置 |
| `normalizeConfig(config)` | [config.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/config.js) | 规范化配置 |
| `validateConfig(config)` | [config-schema.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/config-schema.js) | 验证配置 schema |

#### 路由相关

| 函数 | 文件 | 说明 |
|------|------|------|
| `createRouter(handlers, ctx)` | [router.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/router.js) | 创建 HTTP 路由器 |
| `selectRoute(model, config, ...)` | [lib/route-logic.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/lib/route-logic.js) | 选择路由 |
| `orderCandidates(route, ...)` | [lib/route-logic.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/lib/route-logic.js) | 排序候选 |

#### 认证相关

| 函数 | 文件 | 说明 |
|------|------|------|
| `resolveRelayAuth(options)` | [auth.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/auth.js) | 解析中继认证 |
| `isAuthorized(req)` | [http-helpers.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/http-helpers.js) | 检查管理员授权 |
| `isAuthorizedV1(req)` | [http-helpers.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/http-helpers.js) | 检查 V1 API 授权 |

#### 格式转换相关

| 函数 | 文件 | 说明 |
|------|------|------|
| `openAiToAnthropic(payload, model)` | [format-convert.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/format-convert.js) | 请求转换 |
| `anthropicResponseToOpenAi(response)` | [format-convert.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/format-convert.js) | 响应转换 |
| `createAnthropicToOpenAiSseBridge(options)` | [stream-bridge.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/stream-bridge.js) | SSE 流式桥接 |

---

## 依赖关系图

### 模块依赖关系

```
server.js (入口)
├── config.js
├── config-schema.js
├── auth.js
├── key-pool.js
├── secret-store.js
├── usage.js
├── token-estimate.js
├── dashboard.js
│   └── dashboard/tabs/index.js
│       ├── overview.js
│       ├── providers.js
│       ├── combo-models.js
│       ├── routes.js
│       ├── clients.js
│       ├── usage.js
│       ├── tools.js
│       ├── settings.js
│       └── ide.js
├── router.js
├── handlers/admin.js
│   ├── config-schema.js
│   ├── route-preview.js
│   ├── ide-proxy-preview.js
│   ├── ide-proxy-runtime.js
│   ├── ide-proxy-port-check.js
│   ├── ide-proxy-start-plan.js
│   ├── provider-test.js
│   ├── local-connector-plan.js
│   ├── local-connector-availability.js
│   ├── local-connector-provider-preview.js
│   ├── local-connector-consent-manifest.js
│   ├── local-connector-consent-approval.js
│   ├── provider-template-parity.js
│   └── provider-template-import-plan.js
├── handlers/proxy.js
│   ├── auth.js
│   └── privacy.js
├── format-convert.js
├── stream-bridge.js
├── responses-stream.js
├── provider-registry.js
├── provider-registry-lib.js
├── provider-health.js
├── runtime-state.js
├── request-log.js
├── privacy.js
├── error-category.js
├── http-helpers.js
├── i18n.js
├── balance.js
├── combo.js
├── lib/config-ops.js
├── lib/route-logic.js
└── ... (更多辅助模块)
```

### 核心数据流

```
客户端请求
    ↓
路由器 (认证检查 → 路由匹配)
    ↓
Proxy 处理器
    ├→ 选择路由 (selectRoute)
    ├→ 检查本地限制
    ├→ 获取密钥 (KeyPool.next)
    ├→ 格式转换 (如需)
    ├→ 发送上游请求
    │   ├→ 成功 → 记录使用统计 → 返回响应
    │   └→ 失败 → 标记失败 → 冷却 → 尝试下一个候选
    └→ 全部失败 → 返回聚合错误
```

---

## 配置系统

### 配置文件结构

配置文件位于 `config.json`（或通过 `RELAYFORGE_CONFIG` 指定）。

```json
{
  "providers": [
    {
      "name": "deepseek",
      "displayName": "DeepSeek",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiFormat": "openai",
      "keyEnv": "DEEPSEEK_API_KEYS",
      "models": ["deepseek-chat", "deepseek-reasoner"],
      "allowInsecureHttp": false,
      "extraHeaders": {},
      "balanceEndpoint": {}
    }
  ],
  "routes": [
    {
      "name": "smart-coding",
      "description": "智能编码路由",
      "strategy": "fallback",
      "candidates": [
        { "provider": "deepseek", "model": "deepseek-chat", "weight": 3 }
      ],
      "limits": { "dailyRequests": 1000 }
    }
  ],
  "combos": [
    {
      "name": "combo-model",
      "strategy": "weighted_round_robin",
      "candidates": [
        { "provider": "deepseek", "model": "deepseek-chat", "weight": 5, "priority": 2, "enabled": true }
      ]
    }
  ],
  "profiles": [
    {
      "name": "coding",
      "description": "编码配置",
      "defaultModel": "smart-coding"
    }
  ],
  "activeProfile": "coding",
  "modelAliases": {
    "alias-name": "target-model"
  },
  "defaultProvider": "deepseek",
  "retry": {
    "maxAttempts": 3,
    "cooldownMs": 30000,
    "timeoutMs": 120000,
    "streamIdleTimeoutMs": 300000
  },
  "limits": {
    "maxBodyBytes": 10485760,
    "dailyRequests": null,
    "providers": {},
    "routes": {},
    "models": {}
  },
  "history": {
    "retentionDays": 14
  },
  "healthChecks": {
    "enabled": false,
    "intervalMinutes": 60,
    "providers": []
  },
  "privacy": {
    "logPrompts": false,
    "logHeaders": false
  }
}
```

### 配置项详解

#### providers (提供商)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 提供商名称（唯一标识） |
| `displayName` | string | 否 | 显示名称 |
| `baseUrl` | string | 是 | API 基础 URL |
| `apiFormat` | string | 是 | API 格式：`openai` 或 `anthropic` |
| `keyEnv` | string | 否 | 环境变量名（存储 API 密钥） |
| `models` | string[] | 是 | 支持的模型列表 |
| `allowInsecureHttp` | boolean | 否 | 是否允许不安全的 HTTP（默认 false） |
| `extraHeaders` | object | 否 | 额外请求头 |
| `balanceEndpoint` | object | 否 | 余额查询端点配置 |

#### routes (路由)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 路由名称（唯一标识） |
| `description` | string | 否 | 描述 |
| `strategy` | string | 是 | 策略：`fallback`、`round_robin`、`weighted` |
| `candidates` | array | 是 | 候选列表 |
| `limits` | object | 否 | 限制配置 |

**路由策略**:
- `fallback`: 按顺序尝试，失败则下一个
- `round_robin`: 轮询
- `weighted`: 加权轮询

#### combos (组合模型)

与 routes 类似，但支持更多功能：
- 优先级排序 (priority)
- 启用/禁用开关 (enabled)
- 健康感知路由

#### profiles (配置文件)

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 配置文件名 |
| `description` | string | 否 | 描述 |
| `defaultModel` | string | 是 | 默认模型 |

### 环境变量

| 变量 | 说明 | 兼容性 |
|------|------|--------|
| `RELAYFORGE_TOKEN` | 本地中继令牌 | 推荐 |
| `RELAYFORGE_CONFIG` | 自定义配置路径 | 推荐 |
| `RELAYFORGE_STATE` | 自定义状态路径 | 推荐 |
| `RELAYFORGE_PORT` | 端口覆盖 | 推荐 |
| `RELAYFORGE_ALLOW_NO_AUTH` | 禁用认证（仅开发） | 推荐 |
| `RELAYFORGE_KEYSTORE_DIR` | 密钥存储目录 | 推荐 |
| `RELAY_TOKEN` | 旧版令牌变量 | 兼容 |
| `OPENRELAY_TOKEN` | 旧版令牌变量 | 兼容 |
| `OPENRELAY_CONFIG` | 旧版配置路径 | 兼容 |
| `OPENRELAY_STATE` | 旧版状态路径 | 兼容 |
| `OPENRELAY_PORT` | 旧版端口 | 兼容 |
| `OPENRELAY_KEYSTORE_SECRET` | 密钥存储主密钥 | - |
| `PORT` | 通用端口变量 | 兼容 |

---

## API 接口说明

### 健康检查

```http
GET /health
```

**响应**:
```json
{
  "ok": true,
  "startedAt": "2024-01-01T00:00:00.000Z",
  "version": "0.3.1"
}
```

### 模型列表

```http
GET /v1/models
Authorization: Bearer <token>
```

返回所有可用模型（配置文件、路由、组合模型、别名、提供商模型）。

### Chat Completions (OpenAI 兼容)

```http
POST /v1/chat/completions
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "smart-coding",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "stream": false
}
```

### Anthropic Messages

```http
POST /v1/messages
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "smart-coding",
  "max_tokens": 1024,
  "messages": [
    { "role": "user", "content": "Hello!" }
  ]
}
```

### Responses API

```http
POST /v1/responses
Authorization: Bearer <token>
Content-Type: application/json

{
  "model": "smart-coding",
  "input": "Hello!"
}
```

### 提供商直接路由

```http
POST /{provider}/v1/chat/completions
Authorization: Bearer <token>
```

直接访问指定提供商，绕过路由选择。

### 管理接口

所有 `/admin/*` 路径都需要管理员认证。

#### 状态查询

```http
GET /admin/status
Authorization: Bearer <token>
```

返回完整的系统状态，包括：
- 版本信息
- 提供商列表
- 路由列表
- 组合模型
- 使用统计
- 健康缓存
- 密钥池状态
- 认证状态
- 等等

#### 配置管理

```http
GET /admin/config          # 获取脱敏配置
POST /admin/config         # 保存配置
GET /admin/config/raw      # 获取可编辑配置
GET /admin/config/export   # 导出配置
POST /admin/config/import  # 导入配置
```

#### 提供商管理

```http
GET /admin/providers              # 列出提供商
POST /admin/providers             # 创建提供商
PATCH /admin/providers/{name}     # 更新提供商
DELETE /admin/providers/{name}    # 删除提供商
POST /admin/test-provider         # 测试提供商
POST /admin/discover-models       # 发现模型
```

#### 路由管理

```http
GET /admin/routes              # 列出路由
POST /admin/routes             # 创建路由
PATCH /admin/routes/{name}     # 更新路由
DELETE /admin/routes/{name}    # 删除路由
```

#### 密钥管理

```http
GET /admin/keys                  # 列出密钥
POST /admin/keys                 # 添加密钥
PATCH /admin/keys/{id}           # 更新密钥
DELETE /admin/keys/{id}          # 删除密钥
POST /admin/keys/{id}/test       # 测试密钥
POST /admin/keys/test-raw        # 测试原始密钥
```

#### 配置文件管理

```http
GET /admin/profile              # 获取当前配置文件
POST /admin/profile             # 切换配置文件
POST /admin/profile/update      # 更新配置文件
POST /admin/profile/clone       # 克隆配置文件
POST /admin/profile/delete      # 删除配置文件
```

---

## 运行方式

### 前置要求

- Node.js >= 18
- npm（可选，用于运行脚本）

### 快速启动

#### Windows (ZIP 包)

1. 解压 `relayforge-0.3.1.zip`
2. 双击 `Start_RelayForge.cmd`
3. 打开 http://127.0.0.1:18765
4. 从启动日志中复制令牌

#### PowerShell

```powershell
$env:RELAYFORGE_TOKEN = "my-local-token"
$env:RELAYFORGE_PORT  = "18765"
node src/server.js
```

#### macOS / Linux / WSL

```bash
export RELAYFORGE_TOKEN="my-local-token"
export RELAYFORGE_PORT="18765"
node src/server.js
```

### 使用 npm 脚本

```bash
# 启动服务器
npm start

# 检查配置（不启动服务器）
npm run check

# 运行诊断
npm run doctor

# 冒烟测试
npm run smoke
```

### 验证安装

```bash
# 列出模型
curl http://127.0.0.1:18765/v1/models \
  --oauth2-bearer "$RELAY_TOKEN"

# 聊天完成
curl http://127.0.0.1:18765/v1/chat/completions \
  --oauth2-bearer "$RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"smart-coding","messages":[{"role":"user","content":"Hello!"}]}'

# 管理员状态
curl http://127.0.0.1:18765/admin/status \
  --oauth2-bearer "$RELAY_TOKEN"
```

### 客户端配置

#### OpenAI 兼容客户端

```bash
export OPENAI_BASE_URL="http://127.0.0.1:18765/v1"
export OPENAI_API_KEY="<RELAYFORGE_TOKEN>"
```

#### Anthropic 兼容客户端

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:18765/v1"
export ANTHROPIC_API_KEY="<RELAYFORGE_TOKEN>"
```

#### opencode

```json
{
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

---

## 测试体系

### 测试分类

| 类别 | 命令 | 说明 |
|------|------|------|
| 单元测试 | `npm run test:unit` | 纯函数测试，无网络请求 |
| 端到端测试 | `npm run test:e2e` | 集成测试，可能需要网络 |
| 冒烟测试 | `npm run test:smoke` | ZIP 包冒烟测试 |
| 全部测试 | `npm test` | 单元 + 端到端 |

### 主要测试脚本

| 测试脚本 | 测试内容 |
|----------|----------|
| `test-format-convert.mjs` | 格式转换函数 |
| `test-balance.mjs` | 余额查询 |
| `test-secret-store.mjs` | 加密密钥存储 |
| `test-auth.mjs` | 认证逻辑 |
| `test-config-schema.mjs` | 配置 schema 验证 |
| `test-token-estimate.mjs` | Token 估算 |
| `test-error-category.mjs` | 错误分类 |
| `test-route-preview.mjs` | 路由预览 |
| `test-privacy.mjs` | 隐私保护 |
| `test-request-log.mjs` | 请求日志 |
| `test-stream-bridge.mjs` | 流式桥接 |
| `test-provider-health.mjs` | 提供商健康 |
| `test-responses-stream.mjs` | Responses 流式 |
| `test-auth-required.mjs` | 认证要求 |
| `test-usage-recording.mjs` | 使用记录 |
| `test-provider-direct-route.mjs` | 提供商直接路由 |
| `test-model-alias.mjs` | 模型别名 |
| `test-provider-fallback.mjs` | 提供商故障转移 |
| `test-quota-aware-fallback.mjs` | 配额感知故障转移 |
| `test-combo.mjs` | 组合模型 |
| `test-user-flow.mjs` | 用户流程 |

### 发布前检查

```bash
npm run pre-release     # 发布前检查
npm run build-dist      # 构建发布包
npm run verify:release  # 验证发布产物
```

### CI/CD

GitHub Actions 工作流:
- `.github/workflows/ci.yml` - CI 检查
- `.github/workflows/release.yml` - 发布流程

---

## 安全机制

### 认证系统

1. **默认启用认证** - 所有 API 端点需要 Bearer Token
2. **令牌来源优先级** - 环境变量 > 磁盘文件 > 自动生成
3. **无认证模式** - 需显式设置 `RELAYFORGE_ALLOW_NO_AUTH=true`，并有警告

### 密钥安全

1. **加密存储** - Web UI 添加的密钥使用 AES-256-GCM 加密
2. **从不返回明文** - HTTP API 从不返回完整的 API 密钥
3. **脱敏显示** - 只显示前 6 位和后 4 位
4. **环境变量密钥** - 从环境变量读取，不写入磁盘
5. **主密钥保护** - 主密钥可通过环境变量提供，避免写入磁盘

### 隐私保护

1. **默认不记录提示** - `privacy.logPrompts` 默认为 false
2. **请求日志元数据** - 只记录模型、提供商、延迟、状态，不记录内容
3. **错误脱敏** - 上游错误响应经过分类，不转发完整错误体
4. **管理页 Token** - 存储在浏览器 sessionStorage，关闭标签页即清除

### 网络安全

1. **本地绑定** - 默认绑定到 `127.0.0.1`，不对外暴露
2. **HTTPS 强制** - 远程提供商必须使用 HTTPS（除非显式允许）
3. **CORS 限制** - 管理接口限制来源
4. **请求大小限制** - `limits.maxBodyBytes`（默认 10MB）

### 安全最佳实践

1. 始终设置 `RELAYFORGE_TOKEN` 环境变量
2. 不要在公共网络上运行无认证模式
3. 定期轮换 API 密钥
4. 使用 `OPENRELAY_KEYSTORE_SECRET` 环境变量提供主密钥
5. 不要分享 `data/master.key` 文件

---

## 开发指南

### 项目结构约定

- **零依赖** - 不添加 npm 依赖
- **ES Modules** - 使用 ESM 模块系统
- **纯函数优先** - 核心逻辑尽量使用无副作用的纯函数
- **测试覆盖** - 新增功能需配套测试
- **i18n 同步** - 中英文翻译键保持一致

### 代码风格

- 无构建步骤，直接运行
- 使用 JSDoc 注释类型
- 错误优先的回调风格（或 async/await）

### 常见开发命令

```bash
# 启动开发服务器
npm start

# 运行单元测试
npm run test:unit

# 运行特定测试
node scripts/test-format-convert.mjs

# 构建发布包
npm run build-dist

# 预发布检查
npm run pre-release
```

### 扩展点

- 添加新的提供商模板 → [provider-registry.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/provider-registry.js)
- 添加新的仪表板标签页 → [dashboard/tabs/](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/dashboard/tabs/)
- 添加新的管理 API → [handlers/admin.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/handlers/admin.js)
- 添加新的格式转换 → [format-convert.js](file:///d:/ai_agent/opencode_program/relay-forge-clean/src/format-convert.js)

---

## 故障排除

### 常见问题

**Q: 启动时找不到配置文件？**
A: 确保 `config.json` 存在于项目根目录，或设置 `RELAYFORGE_CONFIG` 环境变量。

**Q: 无法连接到本地模型？**
A: 检查 Ollama/LM Studio 等是否已启动，端口和 baseUrl 是否匹配。

**Q: 提供商返回 401/403？**
A: 检查 API 密钥是否正确，是否有足够的余额/配额。

**Q: 流式响应中断？**
A: 可能是上游超时，调整 `config.retry.streamIdleTimeoutMs`。

**Q: 忘记了管理令牌？**
A: 查看启动日志，或检查 `data/security/relay-token` 文件。

### 诊断工具

```bash
# 运行完整诊断
npm run doctor

# 仅摘要
npm run doctor:sum

# 检查配置（不启动服务器）
npm run check

# 提供商测试
npm run provider:test
```

---

## 版本历史

| 版本 | 主要特性 |
|------|----------|
| v0.3.1 | 错误修复和稳定性改进 |
| v0.3.0 | 仪表板 UX 重新设计，更多标签页，明暗主题 |
| v0.2.0 | 组合模型，健康检查，密钥加密存储 |
| v0.1.0 | 初始版本，基本代理功能 |

详细变更请查看 [CHANGELOG.md](file:///d:/ai_agent/opencode_program/relay-forge-clean/CHANGELOG.md) 和 `docs/release-v*.md`。

---

## 许可证

MIT License - 详见 [LICENSE](file:///d:/ai_agent/opencode_program/relay-forge-clean/LICENSE)
