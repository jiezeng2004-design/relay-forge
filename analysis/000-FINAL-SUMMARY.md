# 分析总结：openrelay-like 第一版开发依据

> **⚠️ Historical report (pre-0.3.3).** This document describes the 0.3.0 codebase. For the current (0.3.3) status, refer to [PARITY_OPENRELAY.md](../PARITY_OPENRELAY.md).

**报告位置**: `analysis/` 目录下的 6 份文档 + `analysis/evidence/` 证据文件  
**当前项目版本**: openrelay-like 0.3.0  
**分析日期**: 2026-06-11  

> ## 证据等级说明
>
> - **[R]** README / CHANGELOG / FAQ 声称 — 仅在上游文档中出现，未黑盒验证
> - **[RL]** Release / API 证据 — 从上游 Release artifacts 可推断（binary 大小、文件名、SHA256）
> - **[S]** 公开源码证据 — 上游 `src/` 目录下的公开可读代码（仅 `src/cookie.ts`）
> - **[U]** 尚未黑盒验证 — 未运行上游 binary，无法确认实现细节
> - **[本]** 本项目已实现 — 在 openrelay-like 源码中可验证
> - **[原]** 本项目原型 — 仅有 UI 占位，无后端逻辑
> - **[未]** 本项目未实现 — 无任何代码

---

## 一、上游最新可确认版本

| 项目 | 值 | 证据来源 |
|------|----|----------|
| 仓库 | `romgX/openrelay` | GitHub 公开仓库 |
| **最新 release** | **v0.10.48**（2026-05-15） | [RL] `analysis/evidence/upstream-latest-release.json` |
| 首个 release | v0.8.3（2026-03-07） | [RL] GitHub Releases API |
| 总 release 数 | 65 | [RL] GitHub API |
| Stars / Forks | 2,191 / 305 | GitHub API |
| 公开源码 | 仅 `src/cookie.ts`（10.8 KB，macOS/Windows 凭据提取） | [S] GitHub 文件列表 |
| 其余代码 | 编译为 JS → SEA binary，不在仓库中 | [R] `package.json` 中 `files: ["dist/"]` |
| Provider 数量 | v0.10.x README: 声称 45；v0.8.3 CHANGELOG: 标记 29 | [R] README.md + CHANGELOG.md |
| 运行时依赖 | 1 个（`sql.js`，SQLite WASM） | [S] `package.json` |
| 分发形式 | Node.js SEA 单文件 binary（5 平台）+ npm | [RL] 89–241 MB binary；[R] `package.json` bin |
| 许可证 | MIT（框架层）+ Commercial（Pro 功能） | [S] `LICENSE` + `COMMERCIAL-LICENSE.txt` |
| 免费版限额 | README 写 50 req/day；COMMERCIAL-LICENSE 写 30 req/day | [R] 两个文档数值不一致 |
| 默认端口 | 18765（Dashboard）、18766–18780（IDE 代理） | [R] README、FAQ、CHANGELOG |

---

## 二、openrelay-like 0.3.0 当前状态

| 项目 | 值 | 证据 |
|------|----|------|
| 运行时依赖 | **0** | `package.json` dependencies 为空 |
| 默认端口 | **39210**（可通过 `PORT` 环境变量覆盖为 18765） | `src/server.js` |
| 语言 | 纯 Node.js ESM（全部源码可阅读） | `src/` 目录 |
| Provider 模板 | **37**（32 API + 5 本地） | `src/provider-registry.js` |
| API 实现 | OpenAI Chat Completions + Responses + Anthropic Messages（stream / non-stream） | `src/handlers/proxy.js` |
| 流式桥接 | OpenAI ↔ Anthropic 双向 | `src/stream-bridge.js` + `src/format-convert.js`，12 项测试 |
| 路由策略 | fallback / round_robin / weighted | `src/lib/route-logic.js` |
| Dashboard | 7 个 Tab（总览 / Provider / 模型组 / 工具接入 / IDE / 用量与错误 / 设置） | `src/dashboard/` |
| 单元测试 | 245+ 全部通过 | `npm run test:unit` |
| 密钥存储 | AES-256-GCM 加密，`data/keys.enc.json` | `src/secret-store.js` |
| 鉴权 | RELAY_TOKEN（env / 自动生成）+ `sk-or-*` 格式 | `src/auth.js` |
| i18n | 中文 + English | `i18n/zh.json` + `i18n/en.json` |
| CI | GitHub Actions（Node 18/20/22 × ubuntu-latest / windows-latest） | `.github/workflows/ci.yml` |
| 单文件二进制 | **不支持**，需要 Node.js ≥18 运行 | 无 exe/binary 输出 |
| npm 发布 | **不支持** | 无 |

---

## 三、核心差距（按严重程度排列）

### 3.1 默认端口差距

| 项目 | 值 |
|------|----|
| 上游默认端口 | 18765 [R] |
| 本项目默认端口 | 39210 |
| 是否支持 `PORT=18765` | 支持（`src/server.js` 第 109 行读取 `process.env.PORT`） |
| 0.1.1 是否默认改为 18765 | **不建议**。保持 39210，文档说明兼容端口为 18765 |

### 3.2 Provider 数量差距

| 项目 | 数量 |
|------|------|
| 上游声称（v0.10.x README） | 45 个非虚拟 Provider [R] |
| 上游声称（v0.8.3 CHANGELOG）| 29 个（7 IDE + 22 API）[R] |
| 本项目模板 | 37 个（32 API 模板 + 5 本地） |
| 本项目真实可用 | 19 个（14 API + 5 本地，`config.json` 中实际配置） |
| 本项目纯占位 | 18 个（有模板但 `config.json` 中未配置，需用户自行添加 Key）|
| 上游有 / 本项目缺（待研究 endpoint） | Kilo、LLM7、BlazeAPI、BazaarLink、Vercel AI Gateway |

### 3.3 本地 / CLI / IDE Provider 差距

上游 [R] 声称 11 个，本项目 **全部未实现**。

| Provider | 上游证据 | 本项目状态 | 说明 |
|----------|---------|-----------|------|
| Claude Desktop | [S] `src/cookie.ts` — macOS Keychain + AES-128-CBC；Windows DPAPI + AES-256-GCM | **暂不做** | 涉及读取系统 Keychain / DPAPI，需安全审查 |
| Claude Code | [R] README | **暂不做** | |
| Kiro (AWS) | [R] README | **暂不做** | |
| Windsurf (Codeium) | [R] README | **暂不做** | |
| Antigravity | [R] README | **暂不做** | |
| OpenCode | [R] README | **暂不做** | |
| VS Code Copilot | [R] README | **暂不做** | 涉及 GitHub auth token |
| OpenAI Codex | [R] README | **暂不做** | |
| Gemini CLI | [R] README | **暂不做** | |
| Rovo Dev | [R] README | **暂不做** | |
| QClaw | [R] README | **暂不做** | |

### 3.4 IDE 代理差距

| IDE | 上游声称 | 本项目 |
|-----|---------|--------|
| Cursor | [R] ConnectRPC / HTTP2 代理，port 18780 | **未实现** — Dashboard 有原型 Tab，按钮 disabled |
| Windsurf | [R] ConnectRPC 代理，port 18766 | **未实现** — 同上 |
| VS Code Copilot | [R] Ollama BYOK 桥接，port 18769 | **未实现** — 同上 |
| Antigravity | [R] Gemini REST 代理，port 18767 | **未实现** — 同上 |

**说明**: IDE 代理不是简单 HTTP 反向代理，涉及 ConnectRPC 协议适配和 TLS 证书管理，工作量显著。

### 3.5 路由差距

| 维度 | 上游 | 本项目 |
|------|------|--------|
| `/{provider}` 直连路径 | [R] FAQ 示例 `http://localhost:18765/kiro` | **未实现** — 路由层不解析 path 中的 provider 名 |
| fallback | [R] + [U] | ✅ 已实现 |
| round_robin | **上游 Pro 功能**（COMMERCIAL-LICENSE 明确列为付费特性）[R] | ✅ 已实现（本项目不受限制）|
| weighted | 上游未明确提及 | ✅ 已实现 |
| quota-aware failover | [R] README "当 Groq 不可用→自动切换" | **未实现** — 仅有健康检查 + cooldown，无 429 感知 |

### 3.6 发布形态差距

| 维度 | 上游 | 本项目 |
|------|------|--------|
| Windows 单文件 exe | [RL] 89 MB, 2140 下载 | ❌ 需要 Node.js |
| macOS binary | [RL] 230 MB | ❌ |
| Linux x64 binary | [RL] 125 MB | ❌ |
| Linux ARM64 binary | [RL] 123 MB | ❌ |
| npm 安装 | [R] `npm install -g openrelay` | ❌ |
| ZIP 发布 | ✅ GitHub Releases | ✅ `build-dist.ps1` |
| SHA256 校验 | ✅ 每个 binary 附带 .sha256 | ❌ |
| CI/CD 自动构建 | ✅ Release workflow | ✅ |
| 禁止 .env / config.json / data/ | — | ✅ build-dist 自动排除 |

### 3.7 Dashboard 差距

| 维度 | 上游（截图可见） | 本项目 |
|------|---------------|--------|
| 总览面板 | 有 | ✅ 有 |
| Provider 面板 | 有（表格 + 绿色/红色圆点） | ✅ 有（表格，无圆点）|
| 工具配置面板 | 有（toggle 开关） | ✅ 有（命令生成器，无 toggle 开关）|
| IDE 面板 | 有（启动/停止按钮） | 🟡 原型 Tab（按钮 disabled）|
| 模型组面板 | "Custom" tab | ✅ Routes Tab |
| 用量 / 错误面板 | 有 | ✅ Usage Tab |
| 设置面板 | 有 | ✅ Settings Tab |
| 实际行为 | **未黑盒验证** | — |

---

## 四、P0 返修建议（0.1.1 之后）

### P0-1: 默认端口和文档对齐 18765（1 天）

| 任务 | 说明 |
|------|------|
| 确认 `PORT=18765` 完全正常 | `src/server.js` 已经支持，只需端到端验证 |
| 启动脚本检测端口并提示 | 如果 `PORT=18765`，额外显示 "romgX/openrelay 兼容模式" |
| README / README.zh.md 更新 | 显式写明 "默认 39210，设置 PORT=18765 兼容上游" |

### P0-2: 实现 `/{provider}` 直连路径路由（3–5 天）

| 子任务 | 说明 |
|--------|------|
| 路由层识别 | `router.js` 增加 `/{provider}/v1/chat/completions` 模式 |
| handler 直接路由 | 跳过 `selectRoute()`，直接用该 provider |
| Dashboard 显示 | 每个 provider 的直连 URL 展示在工具接入 Tab |
| 测试覆盖 | 增加 path-routing 测试 |

### P0-3: 补齐上游明确列出的 API Provider 模板（2–3 天）

| 任务 | 说明 |
|------|------|
| 研究 Kilo、LLM7、BlazeAPI、BazaarLink | 搜索公开文档，如无结果则标记 "待社区补充" |
| Vercel AI Gateway 模板 | 用户自定义 gateway URL |
| 37 个模板全部验证 baseUrl 可解析 | 不要求连通，只检查 URL 格式 |

### P0-4: 修正 Dashboard / E2E 测试（2 天）

| 任务 | 说明 |
|------|------|
| Dashboard 的 "IDE" Tab 明确标注 "尚未实现" | 改为 `disabled` 样式 + 文字说明 |
| 确保所有测试通过 | `npm run test:unit` + `npm run test:e2e` |
| 修复测试中可能残留的旧版本/旧路径 | 检查 `scripts/test-*.mjs` |

### P0-5: 生成发布包（0.5 天）

| 任务 | 说明 |
|------|------|
| `npm run build-dist` | 生成 `openrelay-like-0.3.0.zip` |
| 运行 `npm run pre-release` | 通过所有检查 |
| 提供内容清单 | 见下方 |

---

## 五、已确认不做的功能

- ❌ Claude Desktop 凭据读取（涉及 Keychain / DPAPI）
- ❌ Claude Code / Kiro / Windsurf / Antigravity 等 11 个凭据发现
- ❌ Cursor / Windsurf RPC 代理
- ❌ VS Code Copilot Ollama 桥接
- ❌ LINUX DO 社区连接
- ❌ 许可证验证服务器
- ❌ Pro 商业授权机制
- ❌ 反编译 / 逆向上游二进制
- ❌ 复制上游 `src/cookie.ts` 任何代码

---

## 六、`openrelay-like-0.3.0.zip` 内容清单

```
openrelay-like-0.3.0/
├── package.json
├── README.md / README.zh.md / README.en.md
├── CHANGELOG.md
├── AGENTS.md
├── PARITY_OPENRELAY.md
├── CONNECTOR_SECURITY.md
├── config.example.json
├── .env.example
├── .gitignore
├── src/
│   ├── server.js, router.js, config.js, auth.js, ...
│   ├── handlers/ (admin.js, proxy.js)
│   ├── lib/ (route-logic.js, config-ops.js)
│   ├── dashboard/ (index.js, tabs/, static/)
│   ├── provider-registry.js
│   └── ... (all .js modules)
├── scripts/
│   ├── *.mjs (test, doctor, build, verify, smoke)
│   ├── *.ps1 (build-dist, doctor-win, start-tray)
├── i18n/
│   ├── zh.json, en.json
├── .github/workflows/
│   ├── ci.yml, release.yml
├── analysis/            ← 本次分析报告
├── docs/                ← opencode-quickstart.md
├── start.cmd / start.ps1 / Start_OpenRelay_Local_Safe.cmd
```

**排除的目录和文件**（由 `build-dist.ps1` 和 `.gitignore` 保证）：
- `.env`、`config.json`、`data/`、`backups/`、`node_modules/`
- `tool-env.*`、`tool-verify.*`
- `openrelay-*.log`、`*.err`、`package-lock.json`
- `OPENCODE_HANDOFF_*.md`、`CODEX_HANDOFF_*.md`
- `*.doc`、`*.docx`

---

*报告版本: v3.0*  
*分析方法: 仅公开资料 + 本地只读检查*  
*注意: 所有上游功能未黑盒验证的部分以 [R] 标注，不代表已确认实现*
