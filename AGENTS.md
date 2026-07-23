# RelayForge agent rules

RelayForge is a zero-dependency, local-first AI coding gateway. Preserve loopback defaults, authentication-on behavior, privacy redaction, deterministic routing, and the zero npm dependency contract.

## Fast and full validation

Run in Windows PowerShell with `npm.cmd`:

```powershell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:e2e
npm.cmd run pre-release
npm.cmd run build-dist
npm.cmd run verify:release
```

Use a targeted `test:*` script during iteration. Before PR or release claims, run unit, e2e, and pre-release checks. Do not add npm dependencies without explicit maintainer approval.

## Non-negotiable safety

- Do not read browser cookies, local app tokens, session storage, system credential stores, or real provider secrets.
- Never log or package full API keys, `RELAY_TOKEN`, authorization headers, cookies, `master.key`, runtime data, or upstream prompt/error bodies.
- Keep default authentication enabled. The explicit no-auth escape hatch must remain visible and warning-gated.
- Environment helper scripts may change only the current process; never use `setx`, user/machine environment writes, registry changes, or shell-profile edits.
- Use the existing runtime-state persister; do not reintroduce ad-hoc concurrent writes.

## Change rules

- Keep `i18n/zh.json` and `i18n/en.json` in key parity.
- Update config schema, tests, CHANGELOG, and user docs with behavior changes.
- Use branch -> PR -> `CI gate` -> merge. Release tags must point to the verified merge commit.
- Keep GitHub Release truth separate from local ZIP creation; RelayForge intentionally has no npm publication target.

Read `docs/agent-reference.md` only when detailed module paths, specialized test commands, version-bump steps, or deferred architecture notes are needed.

## Codex Memory

本项目的长期记忆库位于：

`D:\ai_agent\CodexMemory`

处理复杂任务前请先阅读：

- `D:\ai_agent\CodexMemory\04_Index\00_INDEX.md`
- `D:\ai_agent\CodexMemory\00_Workspace\CURRENT.md`
- `D:\ai_agent\CodexMemory\03_Permanent\Projects\RelayForge.md`

如果本次任务产生长期有效结论，请更新对应项目记忆。
如果本次任务出现可复用修复经验，请记录到 Bugs_and_Fixes。
如果本次任务出现失败尝试，请记录到 Failed_Attempts。
如果本次任务形成稳定部署流程，请记录到 Runbooks。
禁止记录真实 API Key、Token、Cookie、密码、私钥。

## Docker（v0.3.3 起）

仓库根 `Dockerfile` 基于 `node:20-alpine`，非 root 用户运行，`VOLUME /app/data` 持久化 runtime-state / keystore / 自动生成 token。`docker-compose.yml` 含可选 Ollama sidecar。

```powershell
# 本地构建并运行
docker build -t relayforge:dev .
docker run --rm -p 18765:18765 -v relayforge-data:/app/data -v ./config.json:/app/config.json:ro relayforge:dev

# 选择 Ollama 本地模型 sidecar
docker compose --profile local up -d
```

GHCR 推送由 `.github/workflows/release.yml` 的 `docker` job 在打 `v*` tag 时自动触发，使用 GitHub 内置 `GITHUB_TOKEN` 注册到 `packages: write`，不需要额外 secret。

`.dockerignore` 默认排除 `.env`、`config.json`、`data/`、`relayforge-*.zip` 与所有 `*.md`，仅保留 `.env.example` 与 `config.example.json` 作为模板入口。

## 配置热重载（v0.3.3 起）

`src/config-watcher.js` 在服务启动后绑定 `fs.watch(configPath)`，500 ms debounce + `O_EXCL` 文件锁（`data/.config-reload.lock`）防止并发重载。坏 JSON 直接 warn 跳过，旧 config 仍生效；in-flight 请求保留旧 ctx 直至自然结束，下一次请求采用新 ctx。

Dashboard Settings 页面顶部新增横幅展示 `configReload.lastReloadAt / ok / count`。`GET /admin/config/reload-status` 暴露同样 JSON。

```powershell
# 触发一次重载
(Get-Content config.json) -replace 'deepseek-chat','deepseek-coder' | Set-Content config.json -NoNewline
# 1 秒内日志出现：[RelayForge] config reloaded from disk (reloaded N providers, M routes)
```

## Rate Limiting 标签页与 PATCH /admin/limits（v0.3.3 起）

Dashboard 多出 `#rate-limiting` 卡片，展示 429 统计、Key Pool 冷却状态与各 provider/route 当日用量 vs 配额条形图。表单通过 `PATCH /admin/limits` 全量替换 `limits.providers/routes/models` 与可选的 `limits.dailyRequests`（空值视为 unlimited / null）。该端点独立于 `/admin/config` 的全量更新，专用校验非负整数；非法值返回 400 `{error:"invalid_limits"}`。

