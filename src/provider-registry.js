export const PROVIDER_TEMPLATES = [
  { name: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", apiFormat: "openai", keyEnv: "OPENAI_API_KEYS", models: ["gpt-4.1-mini", "gpt-4o-mini"] },
  { name: "anthropic", displayName: "Anthropic", baseUrl: "https://api.anthropic.com/v1", apiFormat: "anthropic", keyEnv: "ANTHROPIC_API_KEYS", models: ["claude-3-5-haiku-latest", "claude-sonnet-4-20250514"] },
  { name: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", apiFormat: "openai", keyEnv: "DEEPSEEK_API_KEYS", models: ["deepseek-chat", "deepseek-reasoner"], balanceEndpoint: { url: "https://api.deepseek.com/v1/user/balance", method: "GET", useKey: true, fieldMap: { remaining: "balance_infos[0].currency_balance", limit: "balance_infos[0].total_balance", used: "balance_infos[0].granted_balance", currency: "balance_infos[0].currency" } } },
  { name: "gemini", displayName: "Gemini (OpenAI-compatible)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", apiFormat: "openai", keyEnv: "GEMINI_API_KEYS", models: ["gemini-2.5-flash", "gemini-2.5-flash-lite"] },
  { name: "groq", displayName: "Groq", baseUrl: "https://api.groq.com/openai/v1", apiFormat: "openai", keyEnv: "GROQ_API_KEYS", models: ["llama-3.1-8b-instant", "llama-3.3-70b-versatile"] },
  { name: "openrouter", displayName: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", apiFormat: "openai", keyEnv: "OPENROUTER_API_KEYS", models: ["openrouter/auto", "deepseek/deepseek-chat-v3-0324"] },
  { name: "mistral", displayName: "Mistral", baseUrl: "https://api.mistral.ai/v1", apiFormat: "openai", keyEnv: "MISTRAL_API_KEYS", models: ["mistral-small-latest", "codestral-latest"] },
  { name: "siliconflow", displayName: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", apiFormat: "openai", keyEnv: "SILICONFLOW_API_KEYS", models: ["Qwen/Qwen2.5-7B-Instruct", "deepseek-ai/DeepSeek-V3"] },
  { name: "zhipu", displayName: "智谱 GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", apiFormat: "openai", keyEnv: "ZHIPU_API_KEYS", models: ["glm-4-flash", "glm-4-plus"] },
  { name: "cohere", displayName: "Cohere", baseUrl: "https://api.cohere.com/compatibility/v1", apiFormat: "openai", keyEnv: "COHERE_API_KEYS", models: ["command-r-plus", "command-r"] },
  { name: "xai", displayName: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", apiFormat: "openai", keyEnv: "XAI_API_KEYS", models: ["grok-3", "grok-3-mini"] },
  { name: "together", displayName: "Together AI", baseUrl: "https://api.together.xyz/v1", apiFormat: "openai", keyEnv: "TOGETHER_API_KEYS", models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen2.5-7B-Instruct-Turbo"] },
  { name: "ollama", displayName: "Ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", keyEnv: null, models: ["qwen2.5:7b", "llama3.1:8b"] },
  { name: "lm-studio", displayName: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1", apiFormat: "openai", keyEnv: null, models: ["local-model"] },
  { name: "vllm", displayName: "vLLM", baseUrl: "http://127.0.0.1:8000/v1", apiFormat: "openai", keyEnv: null, models: ["local-model"] },
  { name: "llama-cpp", displayName: "llama.cpp server", baseUrl: "http://127.0.0.1:8080/v1", apiFormat: "openai", keyEnv: null, models: ["local-model"] },
  { name: "llamafile", displayName: "llamafile", baseUrl: "http://127.0.0.1:8080/v1", apiFormat: "openai", keyEnv: null, models: ["local-model"] },
  { name: "cerebras", displayName: "Cerebras", baseUrl: "https://api.cerebras.ai/v1", apiFormat: "openai", keyEnv: "CEREBRAS_API_KEYS", models: ["llama-3.3-70b", "llama-3.1-8b", "qwen-3-32b"] },
  { name: "sambanova", displayName: "SambaNova", baseUrl: "https://api.sambanova.ai/v1", apiFormat: "openai", keyEnv: "SAMBANOVA_API_KEYS", models: ["Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-8B-Instruct"] },
  { name: "longcat", displayName: "LongCat (Meituan)", baseUrl: "https://api.longcat.chat/v1", apiFormat: "openai", keyEnv: "LONGCAT_API_KEYS", models: ["longcat-128k-chat", "longcat-pro"] },
  { name: "dashscope", displayName: "DashScope (Alibaba Cloud)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiFormat: "openai", keyEnv: "DASHSCOPE_API_KEYS", models: ["qwen-plus", "qwen-turbo", "qwen-coder-plus", "qwen-max"] },
  { name: "nvidia-nim", displayName: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", apiFormat: "openai", keyEnv: "NVIDIA_API_KEYS", models: ["meta/llama-3.1-70b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct"] },
  { name: "github-models", displayName: "GitHub Models", baseUrl: "https://models.inference.ai.azure.com", apiFormat: "openai", keyEnv: "GITHUB_MODELS_TOKEN", models: ["gpt-4o", "gpt-4o-mini", "Phi-3.5-mini-instruct"] },
  { name: "fireworks", displayName: "Fireworks", baseUrl: "https://api.fireworks.ai/inference/v1", apiFormat: "openai", keyEnv: "FIREWORKS_API_KEYS", models: ["accounts/fireworks/models/llama-v3p3-70b-instruct", "accounts/fireworks/models/deepseek-v3"] },
  { name: "volcengine", displayName: "Volcengine (Doubao)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", apiFormat: "openai", keyEnv: "VOLCENGINE_API_KEYS", models: ["doubao-pro-32k", "doubao-lite-32k", "doubao-1-5-pro-32k-250115"] },
  { name: "qianfan", displayName: "Qianfan (Baidu)", baseUrl: "https://qianfan.baidubce.com/v2", apiFormat: "openai", keyEnv: "QIANFAN_API_KEYS", models: ["ernie-4.5-8k", "ernie-3.5-8k", "ernie-speed-128k"] },
  { name: "qiniu", displayName: "Qiniu AI", baseUrl: "https://api.qnaigc.com/v1", apiFormat: "openai", keyEnv: "QINIU_API_KEYS", models: ["qwen2.5-72b-instruct", "deepseek-v3"] },
  { name: "hunyuan", displayName: "Hunyuan (Tencent)", baseUrl: "https://api.hunyuan.tencent.com/v1", apiFormat: "openai", keyEnv: "HUNYUAN_API_KEYS", models: ["hunyuan-pro", "hunyuan-standard", "hunyuan-turbo"] },
  { name: "cloudflare-ai", displayName: "Cloudflare AI Gateway", baseUrl: "https://gateway.ai.cloudflare.com/v1/<account_id>/<gateway_id>/openai/v1", apiFormat: "openai", keyEnv: "CLOUDFLARE_API_KEYS", models: ["@cf/meta/llama-3.1-8b-instruct", "@cf/mistral/mistral-7b-instruct-v0.1"] },
  { name: "huggingface", displayName: "Hugging Face (router)", baseUrl: "https://router.huggingface.co/v1", apiFormat: "openai", keyEnv: "HUGGINGFACE_API_KEYS", models: ["meta-llama/Llama-3.3-70B-Instruct", "Qwen/Qwen2.5-7B-Instruct"] },
  { name: "moonshot", displayName: "Moonshot", baseUrl: "https://api.moonshot.cn/v1", apiFormat: "openai", keyEnv: "MOONSHOT_API_KEYS", models: ["moonshot-v1-8k", "moonshot-v1-32k"] },
  { name: "baichuan", displayName: "Baichuan", baseUrl: "https://api.baichuan-ai.com/v1", apiFormat: "openai", keyEnv: "BAICHUAN_API_KEYS", models: ["Baichuan4", "Baichuan3-Turbo"] },
  { name: "stepfun", displayName: "Stepfun (阶跃星辰)", baseUrl: "https://api.stepfun.com/v1", apiFormat: "openai", keyEnv: "STEPFUN_API_KEYS", models: ["step-2-16k", "step-1-8k"] },
  { name: "minimax", displayName: "MiniMax", baseUrl: "https://api.minimax.chat/v1", apiFormat: "openai", keyEnv: "MINIMAX_API_KEYS", models: ["MiniMax-M2.7", "MiniMax-M1"] },
  { name: "pollinations", displayName: "Pollinations AI", baseUrl: "https://text.pollinations.ai/openai", apiFormat: "openai", keyEnv: null, models: ["openai", "openai-large", "openai-reasoning", "mistral", "llama", "qwen-coder"] },
  { name: "kilo", displayName: "Kilo", baseUrl: "https://<kilo_base_url>/v1", apiFormat: "openai", keyEnv: "KILO_API_KEYS", models: [] },
  { name: "llm7", displayName: "LLM7", baseUrl: "https://<llm7_base_url>/v1", apiFormat: "openai", keyEnv: "LLM7_API_KEYS", models: [] },
  { name: "blazeapi", displayName: "BlazeAPI", baseUrl: "https://<blazeapi_base_url>/v1", apiFormat: "openai", keyEnv: "BLAZEAPI_API_KEYS", models: [] },
  { name: "bazaarlink", displayName: "BazaarLink", baseUrl: "https://<bazaarlink_base_url>/v1", apiFormat: "openai", keyEnv: "BAZAARLINK_API_KEYS", models: [] },
  { name: "azure-openai", displayName: "Azure OpenAI", baseUrl: "https://<resource>.openai.azure.com", apiFormat: "openai", keyEnv: "AZURE_OPENAI_API_KEYS", models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo"] },
  { name: "anthropic-direct", displayName: "Anthropic Direct API", baseUrl: "https://api.anthropic.com/v1", apiFormat: "anthropic", keyEnv: "ANTHROPIC_API_KEYS", models: ["claude-sonnet-4-20250514", "claude-3-5-haiku-latest", "claude-3-opus-latest"] },
  { name: "vercel-ai-gateway", displayName: "Vercel AI Gateway", baseUrl: "https://ai-gateway.vercel.sh/v1", apiFormat: "openai", keyEnv: "AI_GATEWAY_API_KEYS", models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.6", "xai/grok-4.1-fast-reasoning"] }
];

export const ROUTE_TEMPLATES = [
  { name: "coding-local", description: "Prefer owned coding APIs, then fall back to local Ollama", strategy: "fallback", candidates: [{ provider: "deepseek", model: "deepseek-chat", weight: 3 }, { provider: "moonshot", model: "moonshot-v1-8k", weight: 1 }, { provider: "ollama", model: "qwen2.5:7b", weight: 1 }] },
  { name: "offline-local", description: "Use local models only", strategy: "round_robin", candidates: [{ provider: "ollama", model: "qwen2.5:7b" }, { provider: "ollama", model: "llama3.1:8b" }] },
  { name: "balanced-local", description: "Weighted route across configured providers", strategy: "weighted", candidates: [{ provider: "deepseek", model: "deepseek-chat", weight: 5 }, { provider: "moonshot", model: "moonshot-v1-8k", weight: 2 }, { provider: "ollama", model: "qwen2.5:7b", weight: 1 }] },
  { name: "free-api-pool", description: "Manual BYOK route for providers with free tiers", strategy: "weighted", candidates: [{ provider: "groq", model: "llama-3.1-8b-instant", weight: 4 }, { provider: "gemini", model: "gemini-2.0-flash", weight: 3 }, { provider: "siliconflow", model: "Qwen/Qwen2.5-7B-Instruct", weight: 2 }, { provider: "ollama", model: "qwen2.5:7b", weight: 1 }] }
];

export const LOCAL_PROVIDER_NAMES = new Set(["ollama", "lm-studio", "vllm", "llama-cpp", "llama.cpp", "llamafile"]);

export const SUPPORTED_TABS = new Set(["overview", "providers", "routes", "tools", "usage", "settings", "ide"]);

export const V1_PROXY_PATHS = new Set(["/v1/chat/completions", "/v1/responses", "/v1/messages"]);

export function isLocalProvider(provider) {
  const name = String(provider?.name || "").toLowerCase();
  const baseUrl = String(provider?.baseUrl || "").toLowerCase();
  return LOCAL_PROVIDER_NAMES.has(name) ||
    baseUrl.includes("127.0.0.1") ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("[::1]");
}

export function getProviderTemplate(name) {
  return PROVIDER_TEMPLATES.find((p) => p.name === name) || null;
}

export function findProviderTemplatesByKeyEnv(keyEnv) {
  if (!keyEnv) return [];
  return PROVIDER_TEMPLATES.filter((p) => p.keyEnv === keyEnv);
}
