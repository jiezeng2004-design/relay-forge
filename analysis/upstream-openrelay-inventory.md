# 上游盘点: romgX/openrelay 公开仓库

> 分析日期: 2026-06-11  
> 仓库: https://github.com/romgX/openrelay  
> 方法: 仅抓取公开网页、GitHub API、raw 文件。不下载/运行 binary。  
> 证据等级: [R] / [RL] / [S] / [U]

---

## 1. 仓库元数据

| 字段 | 值 | 来源 |
|------|----|------|
| 全名 | `romgX/openrelay` | GitHub API |
| 描述 | "几百个免费 AI 模型配额，一键接入本地项目" | GitHub API |
| 创建时间 | 2026-03-07 | GitHub API |
| Stars / Forks | 2,191 / 305 | GitHub API |
| 主要语言 | TypeScript | GitHub API |
| Topics | ai, proxy, claude, cursor, copilot, windsurf, groq, cerebras, free-api, aider, openclaw, kiro | GitHub API |
| 许可证 | MIT（框架）+ Commercial（Pro） | LICENSE + COMMERCIAL-LICENSE.txt |

## 2. package.json

来源: `analysis/evidence/upstream-package.json`（481 bytes）

```json
{
  "name": "openrelay",
  "version": "0.8.3",
  "dependencies": { "sql.js": "^1.14.0" },
  "bin": { "openrelay": "./dist/index.js" },
  "files": ["dist/", "LICENSE", "README.md", "COMMERCIAL-LICENSE.txt"]
}
```

关键发现:
- **唯一依赖**: `sql.js`（SQLite WASM），用于读取 Chromium cookie DB
- **版本 v0.8.3 非最新**: GitHub 源码版本与最新 release binary（v0.10.48）相差 47 个版本
- **分发文件不含 src/**: 发布包只包含编译后的 `dist/`

## 3. CHANGELOG

只有一个条目: **v0.8.3 初始发布**。之后 47 个版本的变更无记录。

### v0.8.3 声称功能

| 类别 | 数量 | 明细 |
|------|------|------|
| Provider | 29（7 IDE + 22 API） | IDE: Claude Desktop, Claude Code, Kiro, Windsurf, Antigravity, OpenCode, VS Code Copilot |
| API 兼容 | 3+ | Anthropic Messages, OpenAI Chat, Azure OpenAI |
| 访问方式 | 4 种 | IDE RPC 代理, Shell env, `sk-or-*` key, 模型组 round-robin |
| 平台 | 2 | macOS + Windows（Node.js SEA binary）|
| Dashboard | 中英双语 Web 面板 | — |

## 4. 许可证

双授权:
- **MIT**: 框架代码（路由、代理、格式转换、配置）
- **Commercial**: Pro 功能（不限请求、round-robin 模型组、优先支持）

免费版限制: README 写 50 req/day, COMMERCIAL-LICENSE 写 30 req/day（不一致）。

## 5. 公开源码: `src/cookie.ts`

唯一公开源码文件（10.8 KB）。功能：读取并解密本地 Claude Desktop 的 Chromium cookie DB。

| 平台 | 方法 |
|------|------|
| macOS | Keychain → PBKDF2("saltysalt", 1003) → AES-128-CBC |
| Windows | DPAPI → Local State → AES-256-GCM |

提取 5 个 cookie: `sessionKey`, `lastActiveOrg`, `deviceId`, `cf_clearance`, `__cf_bm`。

引用的 `./sqlite.js` 和 `./dpapi.js` 不在公开源码中。

## 6. Release 产物

最新: **v0.10.48**（2026-05-15）。证据: `analysis/evidence/upstream-latest-release.json`

| 平台 | 大小 | 下载量 |
|------|------|--------|
| Windows x64 | 89.4 MB | 2,140 |
| macOS (Intel) | 230 MB | 395 |
| macOS ARM64 | 230 MB | 151 |
| Linux x64 | 125 MB | 295 |
| Linux ARM64 | 122.7 MB | 63 |

每个 binary 附带 `.sha256`。总 65 个 release（约 2.3 release/天）。

## 7. 隐私 / 安全声明

来源: PRIVACY.md, DISCLAIMER.md

凭据只读、仅内存、不上传、不记录 prompt、无遥测。网络连接仅：AI 后端 + License 服务器（`license.limitlessmeto.com`）+ GitHub 更新检查。

## 8. 已知与未知

**已知**: 仓库元数据、package.json、LICENSE、README、CHANGELOG（v0.8.3 仅）、`src/cookie.ts`、Release binary 信息、FAQ / PRIVACY / DISCLAIMER

**未知（需黑盒测试）**: 所有 API 端点的实际行为、Dashboard 交互细节、IDE 代理的实现细节、凭据发现的实现细节（除 Claude Desktop）、Pro 功能差异、45 provider 中新增 16 个的实际情况

**结论**: 上游是 **open-core 闭源分发**项目。GitHub 仓库用于文档和 issue 跟踪，实际开发在私有仓库，发布形式为 Node.js SEA binary。唯一可读公开源码是 `src/cookie.ts`。
