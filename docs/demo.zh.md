# RelayForge Demo 指南

## A. CC Switch 接入 RelayForge

配置：

| 字段 | 值 |
|-------|-------|
| 名称 | RelayForge |
| 基础 URL | `http://127.0.0.1:18765/v1` |
| API Key | `<YOUR_RELAYFORGE_TOKEN>` |
| 模型 | `smart-coding`（或任意 combo 名称） |

## B. opencode 接入 RelayForge

配置：

```json
{
  "agents": {
    "defaults": {
      "model": { "primary": "relayforge:smart-coding" }
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

## C. Fallback 演示

参考 `docs/demo.md` 英文版 D 节。

## D. Round Robin 演示

参考 `docs/demo.md` 英文版 E 节。
