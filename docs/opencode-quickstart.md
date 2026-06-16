# OpenCode 接入最短路径（Windows 新用户）

> 从双击启动脚本到完成第一次验证调用，5 分钟。

## 1. 启动中继

双击 `Start_RelayForge.cmd`，或执行：

```powershell
cd 项目目录
node src\server.js
```

看到 `RelayForge is running at http://127.0.0.1:39210` 即启动成功。

## 2. 打开 Dashboard

浏览器打开 [http://127.0.0.1:39210](http://127.0.0.1:39210)

如果页面提示需要输入 `RELAY_TOKEN`：

- 从启动终端的日志中找到一行 `local relay token: abc12...wxyz`
- 复制该 Token，粘贴到页面输入框，点击"进入管理页"

## 3. 添加 API Key（可选）

如果使用自有 API Key（如 DeepSeek、OpenAI）：

1. 在 Dashboard 中点击 **Provider** 标签
2. 展开对应的 Provider 行
3. 在 **API Key 管理** 表单中粘贴 Key，点击添加

## 4. 配置本地模型（可选）

如果使用本地 Ollama / LM Studio：

1. 确保本地推理服务已启动
2. Dashboard 的 Provider 标签已预置本地 Provider 模板

## 5. 接入 OpenCode

点击 **工具接入** 标签，默认选中 **OpenCode**。复制对应 shell 的命令：

### Windows PowerShell

```powershell
$env:OPENCODE_BASE_URL = "http://127.0.0.1:39210/v1"
$env:OPENCODE_API_KEY = "local"
$env:OPENAI_BASE_URL = "http://127.0.0.1:39210/v1"
$env:OPENAI_API_KEY = "local"
```

### Windows CMD

```cmd
set OPENCODE_BASE_URL=http://127.0.0.1:39210/v1
set OPENCODE_API_KEY=local
set OPENAI_BASE_URL=http://127.0.0.1:39210/v1
set OPENAI_API_KEY=local
```

### WSL / Linux Bash

```bash
export OPENCODE_BASE_URL="http://127.0.0.1:39210/v1"
export OPENCODE_API_KEY="local"
export OPENAI_BASE_URL="http://127.0.0.1:39210/v1"
export OPENAI_API_KEY="local"
```

> 这些命令只修改**当前 shell 进程**的环境变量，不会写入系统环境变量、注册表或 `~/.bashrc`。
> 关闭终端后失效。

## 6. 验证连接

执行以下命令验证中继能正常工作：

### PowerShell 验证

```powershell
# 测试模型列表
Invoke-RestMethod -Uri "http://127.0.0.1:39210/v1/models" | Select-Object -ExpandProperty data | Select-Object -First 3 -ExpandProperty id

# 测试一次对话
$body = @{ model = "auto"; messages = @(@{ role = "user"; content = "reply with the single word: pong" }) } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri "http://127.0.0.1:39210/v1/chat/completions" -Method Post -ContentType "application/json" -Body $body
```

两个命令都返回 `200` 即表示中继正常工作。

## 7. 使用 OpenCode

在设置了环境变量的终端中直接运行：

```powershell
opencode
```

OpenCode 会自动读取 `OPENCODE_BASE_URL` 和 `OPENCODE_API_KEY` 连接到你配置的中继。

---

## 常见问题

| 问题 | 解决 |
|---|---|
| 启动报 `EADDRINUSE` | 端口 39210 已被占用，关掉其他中继或改端口 |
| 页面提示输入 Token | 从启动日志复制 Token 粘贴 |
| `/v1/chat/completions` 返回 401 | 需要设置 `RELAY_TOKEN` 环境变量 |
| 返回 503 `no_available_key` | 对应 Provider 没有配置 API Key |
| OpenAI 客户端报连接拒绝 | 确认中继已启动，检查端口号和 Base URL |
