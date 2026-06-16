# RelayForge v0.3.0

**闆朵緷璧栥€佹湰鍦颁紭鍏堢殑 AI 缂栫▼缃戝叧** 鈥?鍏煎 OpenAI / Anthropic 鎺ュ彛銆?灏嗘湰鍦?Ollama / LM Studio 鍜屼簯绔?DeepSeek / Groq 绛夊 providers 缁熶竴鍦?`http://127.0.0.1:18765/v1` 鍚庨潰锛?鎻愪緵 Combo 璺敱銆乫allback銆佽姹傝劚鏁忓拰杞婚噺鐢ㄩ噺缁熻銆?
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](package.json)
[![渚濊禆](https://img.shields.io/badge/dependencies-0-brightgreen.svg)]()
[![骞冲彴](https://img.shields.io/badge/platform-windows%20%7C%20macos%20%7C%20linux-lightgrey.svg)]()

---

## 鏍稿績鐗规€?
- **闆朵緷璧?* 鈥?浠呬娇鐢?Node.js 鍐呯疆妯″潡
- **鏈湴浼樺厛** 鈥?榛樿缁戝畾 127.0.0.1锛屾棤閬ユ祴銆佹棤浜戦攣瀹?- **OpenAI / Anthropic 鍏煎** 鈥?`/v1/chat/completions`銆乣/v1/messages`銆乣/v1/models`
- **Combo 妯″瀷** 鈥?铏氭嫙妯″瀷鍚嶈仛鍚堝涓?provider锛屾敮鎸?fallback / round_robin / weighted_round_robin
- **鏅鸿兘闄嶇骇** 鈥?429/503/瓒呮椂鑷姩鍒囨崲鍒颁笅涓€涓€欓€?- **闅愮榛樿寮€鍚?* 鈥?鏃ュ織涓嶈褰?prompt锛孉PI Key 鑷姩鑴辨晱
- **鏈€杩戣姹傝褰?* 鈥?鏈€杩?20 鏉¤姹傚厓鏁版嵁锛堟ā鍨嬨€乸rovider銆佽€楁椂銆佺姸鎬佺爜锛夛紝涓嶅惈 prompt 鍐呭
- **Provider 鑳藉姏鏌ヨ** 鈥?`/admin/status` 杩斿洖 providerCapabilities
- **涓嶆帴鍏?OAuth 璁㈤槄 token** 鈥?涓嶈鍙?Claude Code / Codex / Cursor 涓汉鐧诲綍 token

## 蹇€熷紑濮?
```bash
git clone <repo-url> relayforge
cd relayforge
cp config.example.json config.json

# 璁剧疆 relay token锛堟帹鑽愶級
$env:RELAYFORGE_TOKEN = "my-secret-token"

# 鍚姩
node src/server.js
# RelayForge is running at http://127.0.0.1:18765
```

## 鐜鍙橀噺

| 鍙橀噺 | 鎺ㄨ崘 | 鏃у彉閲忥紙鍚戝悗鍏煎锛?|
|----------|-------------|-------------------------|
| `RELAYFORGE_TOKEN` | 鉁?API 璁よ瘉 token | `RELAY_TOKEN` / `OPENRELAY_TOKEN` |
| `RELAYFORGE_CONFIG` | 鉁?鑷畾涔夐厤缃矾寰?| `OPENRELAY_CONFIG` |
| `RELAYFORGE_STATE` | 鉁?鑷畾涔夌姸鎬佽矾寰?| `OPENRELAY_STATE` |
| `RELAYFORGE_PORT` | 鉁?绔彛閰嶇疆 | `PORT` / `OPENRELAY_PORT` |

鍚屾椂璁剧疆 `RELAYFORGE_*` 鍜?`OPENRELAY_*` 鏃讹紝`RELAYFORGE_*` 浼樺厛銆?
## 瀹夊叏璇存槑

- RelayForge **涓嶆敮鎸?* OAuth 璁㈤槄 token 璺敱
- **涓嶈鍙?*鏈湴瀹㈡埛绔櫥褰?token
- 鎺ㄨ崘鍙皢 RELAYFORGE_TOKEN 鏆撮湶缁欏鎴风
- prompt 榛樿涓嶈褰?- Authorization / API Key 榛樿鑴辨晱

## 瀵规瘮

| | RelayForge | LiteLLM | One API | 9Router |
|---|---|---|---|---|
| 渚濊禆 | **闆?npm** | 閲?| 閲?| 閲?|
| 鏈湴浼樺厛 | 鉁?| 鉂?| 鉂?| 鉂?|
| OAuth 璺敱 | 鉂?| 鉂?| 鉂?| 鉁?|
| Combo 妯″瀷 | 鉁?| 鉁?| 鉂?| 鉁?|
| 闅愮鏃ュ織 | 鉁?| 鉂?| 鉂?| 鉂?|
| MIT 璁稿彲璇?| 鉁?| 鉁?| 鉁?| 鉁?|

---

[MIT 璁稿彲璇乚(LICENSE) 路 [绗笁鏂瑰０鏄嶿(THIRD_PARTY_NOTICES.md) 路 [鍙戝竷璇存槑](docs/release-v0.3.0.md)

## v0.3.0 Dashboard

RelayForge v0.3.0 adds a Premium Dashboard UX: Overview, Providers, Combo Models, Clients, Usage, Diagnostics, and Settings are redesigned for clearer setup, safer diagnostics, and screenshot-ready documentation. It keeps zero npm dependencies and server-rendered HTML with native CSS/JS.

