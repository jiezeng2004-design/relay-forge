// Token estimation. Upstream providers (OpenAI, Anthropic, DeepSeek,
// Gemini, etc.) usually return exact `usage.prompt_tokens` /
// `usage.completion_tokens` in the response or final stream
// chunk. When that is unavailable (Ollama, custom models, proxies
// that don't forward usage), we fall back to a character-based
// heuristic calibrated per family.
//
// We deliberately do NOT pull in tiktoken (1 MB+, requires model
// files) to keep the project zero-deps. The multipliers below are
// approximate (within ±20% of tiktoken's cl100k_base on real
// prompts) and good enough for "today's usage estimate" surfaces.

// Approximate characters per token for known model families.
// Untrained languages + code tend to compress better than natural
// English prose, so these numbers err on the conservative side.
const FAMILY_CHARS_PER_TOKEN = {
  gpt4: 3.8,
  gpt35: 3.8,
  o1: 3.8,
  claude: 3.7,
  gemini: 3.9,
  deepseek: 3.7,
  qwen: 3.6,
  llama: 3.6,
  mistral: 3.7,
  cohere: 3.7,
  grok: 3.8,
  unknown: 4.0
};

const UNKNOWN_FAMILY_CHARS_PER_TOKEN = 4.0; // OpenAI's "1 token ≈ 4 chars" rule of thumb

export function pickFamily(model) {
  if (!model) return "unknown";
  const m = String(model).toLowerCase();
  if (/\bgpt-?4(\b|o|o-mini|-turbo|-preview|\.)/.test(m) || /\bo1(\b|-preview|-mini)/.test(m)) return "gpt4";
  if (/\bgpt-?3\.5(\b|-turbo|-0125|-instruct|-16k)/.test(m)) return "gpt35";
  if (/\bclaude[-_]?/.test(m)) return "claude";
  if (/\bgemini[-_]?/.test(m)) return "gemini";
  if (/\bdeepseek[-_]?/.test(m)) return "deepseek";
  if (/\bqwen(\d|[-_]|\b)/.test(m)) return "qwen";
  if (/\bllama[-_]?\d|\bmeta-llama/.test(m)) return "llama";
  if (/\bmistral/.test(m) || /\bmixtral/.test(m)) return "mistral";
  if (/\bcommand/.test(m) || /\bembed-/.test(m)) return "cohere";
  if (/\bgrok[-_]?/.test(m)) return "grok";
  return "unknown";
}

// Estimate tokens for an arbitrary string using the model's family
// multiplier. Returns 0 for null/empty/non-string input.
export function estimateTokens(text, model) {
  if (text == null) return 0;
  if (typeof text !== "string") text = String(text);
  if (!text) return 0;
  const family = pickFamily(model);
  const charsPerToken = FAMILY_CHARS_PER_TOKEN[family] || UNKNOWN_FAMILY_CHARS_PER_TOKEN;
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

// Sum prompt tokens from a list of message-content-like strings.
// Messages can be plain strings (treated as a single user
// message), content arrays with `text` fields, or full
// OpenAI / Anthropic / Responses message objects.
export function estimateMessagesTokens(messages, model) {
  if (messages == null) return 0;
  if (!Array.isArray(messages)) {
    // Single string / object — coerce to a one-message array.
    return estimateMessagesTokens([messages], model);
  }
  let total = 0;
  for (const m of messages) {
    if (m == null) continue;
    if (typeof m === "string") {
      total += estimateTokens(m, model);
      continue;
    }
    if (typeof m !== "object") continue;
    const role = m.role;
    if (role) total += estimateTokens(role, model);
    const content = m.content;
    if (typeof content === "string") {
      total += estimateTokens(content, model);
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part == null) continue;
        if (typeof part === "string") {
          total += estimateTokens(part, model);
        } else if (typeof part === "object") {
          if (typeof part.text === "string") total += estimateTokens(part.text, model);
          else if (typeof part.input_text === "string") total += estimateTokens(part.input_text, model);
          else if (typeof part.output_text === "string") total += estimateTokens(part.output_text, model);
          else if (typeof part.content === "string") total += estimateTokens(part.content, model);
          else if (Array.isArray(part.content)) total += estimateMessagesTokens(part.content, model);
        }
      }
    } else if (typeof content === "object" && content !== null) {
      if (typeof content.text === "string") total += estimateTokens(content.text, model);
    }
    if (typeof m.text === "string") total += estimateTokens(m.text, model);
    if (typeof m.thinking === "string") total += estimateTokens(m.thinking, model);
  }
  return total;
}

// Normalize usage from any of OpenAI / Anthropic / Responses shape
// to `{ prompt_tokens, completion_tokens, total_tokens }`. Returns
// null if no usage data is present (caller falls back to
// heuristic).
export function normalizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const prompt = Number(usage.prompt_tokens || usage.input_tokens);
  const completion = Number(usage.completion_tokens || usage.output_tokens || usage.output_tokens_delta);
  if (!Number.isFinite(prompt) && !Number.isFinite(completion)) return null;
  return {
    prompt_tokens: Number.isFinite(prompt) ? Math.max(0, prompt) : 0,
    completion_tokens: Number.isFinite(completion) ? Math.max(0, completion) : 0,
    total_tokens: Number.isFinite(prompt) && Number.isFinite(completion)
      ? Math.max(0, prompt) + Math.max(0, completion)
      : 0
  };
}

export const TOKEN_ESTIMATE_FAMILIES = Object.keys(FAMILY_CHARS_PER_TOKEN);
