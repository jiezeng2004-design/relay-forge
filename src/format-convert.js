// Pure format-conversion helpers. No side effects, no I/O, no shared state.
// Kept dependency-free so they can be unit-tested in isolation.

export function openAiToAnthropic(payload, model) {
  const systemParts = [];
  const messages = [];
  for (const message of payload.messages || []) {
    if (message.role === "system") {
      systemParts.push(extractTextContent(message.content));
    } else {
      messages.push(openAiMessageToAnthropic(message));
    }
  }

  const body = {
    model,
    max_tokens: payload.max_tokens || payload.max_completion_tokens || 1024,
    messages
  };
  if (systemParts.length > 0) body.system = systemParts.filter(Boolean).join("\n\n");
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.top_p !== undefined) body.top_p = payload.top_p;
  if (payload.stop !== undefined) body.stop_sequences = Array.isArray(payload.stop) ? payload.stop : [payload.stop];
  if (payload.stream !== undefined) body.stream = payload.stream;
  if (payload.tools !== undefined) body.tools = mapOpenAIToolsToAnthropic(payload.tools);
  if (payload.tool_choice !== undefined) body.tool_choice = mapOpenAIToolChoiceToAnthropic(payload.tool_choice);
  return body;
}

export function anthropicToOpenAi(payload, model) {
  const messages = [];
  if (payload.system) {
    messages.push({ role: "system", content: extractTextContent(payload.system) });
  }
  for (const message of payload.messages || []) {
    const converted = convertAnthropicMessageToOpenAi(message);
    if (converted) messages.push(converted);
  }
  const body = {
    model,
    messages,
    max_tokens: payload.max_tokens
  };
  if (payload.temperature !== undefined) body.temperature = payload.temperature;
  if (payload.top_p !== undefined) body.top_p = payload.top_p;
  if (payload.stop_sequences !== undefined) body.stop = payload.stop_sequences;
  if (payload.stream !== undefined) body.stream = payload.stream;
  return body;
}

export function openAiResponseToAnthropic(response) {
  const blocks = (response?.choices || [])
    .map((choice) => choiceToAnthropicBlocks(choice))
    .flat()
    .filter(Boolean);
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  return {
    id: response?.id || "msg_local",
    type: "message",
    role: "assistant",
    model: response?.model,
    content: blocks.length > 0 ? blocks : [{ type: "text", text }],
    stop_reason: response?.choices?.[0]?.finish_reason || "stop",
    stop_sequence: null,
    usage: {
      input_tokens: response?.usage?.prompt_tokens || 0,
      output_tokens: response?.usage?.completion_tokens || 0
    }
  };
}

export function anthropicResponseToOpenAi(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  const text = blocks.map((item) => item?.text || "").join("");
  const toolCalls = blocks
    .map((item, index) => anthropicBlockToOpenAiToolCall(item, index))
    .filter(Boolean);
  const message = { role: "assistant", content: text || (toolCalls.length > 0 ? null : "") };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    id: response?.id || "chatcmpl-local",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: response?.model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: response?.stop_reason || "stop"
      }
    ],
    usage: {
      prompt_tokens: response?.usage?.input_tokens || 0,
      completion_tokens: response?.usage?.output_tokens || 0,
      total_tokens: (response?.usage?.input_tokens || 0) + (response?.usage?.output_tokens || 0)
    }
  };
}

export function openAiResponseToResponses(response) {
  const text = response?.choices?.[0]?.message?.content || "";
  const model = response?.model;
  const toolCalls = (response?.choices?.[0]?.message?.tool_calls || []).map((call, index) => ({
    id: call.id || `call_${index}`,
    type: "function_call",
    status: "completed",
    name: call?.function?.name || "",
    arguments: call?.function?.arguments || "",
    call_id: call.id || `call_${index}`
  }));
  const reasoningText = extractReasoningText(response);
  const output = [];
  if (reasoningText) {
    output.push({
      id: `rs_${Date.now()}`,
      type: "reasoning",
      status: "completed",
      summary: [{ type: "summary_text", text: reasoningText }]
    });
  }
  if (text) {
    output.push({
      id: `msg_${Date.now()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }]
    });
  }
  for (const call of toolCalls) output.push(call);
  return {
    id: response?.id || `resp_${Date.now()}`,
    object: "response",
    created_at: response?.created || Math.floor(Date.now() / 1000),
    status: "completed",
    model,
    output,
    output_text: text,
    usage: response?.usage || null
  };
}

export function anthropicResponseToResponses(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  const text = blocks.map((item) => item?.text || "").join("");
  const toolCalls = blocks
    .map((item, index) => anthropicBlockToResponsesToolCall(item, index))
    .filter(Boolean);
  const output = [];
  if (text) {
    output.push({
      id: `msg_${Date.now()}`,
      type: "message",
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text }]
    });
  }
  for (const call of toolCalls) output.push(call);
  return {
    id: response?.id || `resp_${Date.now()}`,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    status: "completed",
    model: response?.model,
    output,
    output_text: text,
    usage: response?.usage
      ? {
          input_tokens: response.usage.input_tokens || 0,
          output_tokens: response.usage.output_tokens || 0
        }
      : null
  };
}

export function responsesToChatPayload(payload) {
  const messages = [];
  if (payload.instructions) {
    messages.push({ role: "system", content: extractTextContent(payload.instructions) });
  }
  messages.push(...responsesInputToMessages(payload.input));

  const result = {
    model: payload.model,
    messages: messages.length > 0 ? messages : [{ role: "user", content: "" }]
  };
  if (payload.stream !== undefined) result.stream = payload.stream;
  if (payload.max_output_tokens !== undefined) result.max_tokens = payload.max_output_tokens;
  if (payload.max_tokens !== undefined) result.max_tokens = payload.max_tokens;
  if (payload.temperature !== undefined) result.temperature = payload.temperature;
  if (payload.top_p !== undefined) result.top_p = payload.top_p;
  if (payload.stop !== undefined) result.stop = payload.stop;
  if (payload.tools !== undefined) result.tools = mapResponsesToolsToOpenAi(payload.tools);
  if (payload.tool_choice !== undefined) result.tool_choice = mapResponsesToolChoiceToOpenAi(payload.tool_choice);
  return result;
}

export function responsesInputToMessages(input) {
  if (typeof input === "string") return [{ role: "user", content: input }];
  if (!Array.isArray(input)) return [];
  return input.map((item) => {
    if (typeof item === "string") return { role: "user", content: item };
    const role = inferResponsesInputRole(item);
    const content = extractResponsesInputContent(item?.content ?? item?.text ?? item);
    const toolCalls = item?.tool_calls || (item?.type === "function_call" ? [item] : null);
    if (role === "assistant" && toolCalls) {
      return {
        role: "assistant",
        content: content || "",
        tool_calls: toolCalls
          .map((call, index) => ({
            id: call.id || call.call_id || `call_${index}`,
            type: "function",
            function: {
              name: call.name || call.function?.name || "",
              arguments: call.arguments || call.function?.arguments || ""
            }
          }))
          .filter((call) => call.function.name)
      };
    }
    if (role === "tool" || role === "function") {
      return {
        role: "tool",
        tool_call_id: item?.call_id || item?.tool_call_id || item?.id || "",
        content: extractTextContent(item?.output ?? item?.content ?? content)
      };
    }
    return { role, content: extractTextContent(content) };
  });
}

export function extractTextContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item == null) return "";
        if (typeof item === "string") return item;
        if (typeof item === "object") {
          if (typeof item.text === "string") return item.text;
          if (typeof item.input_text === "string") return item.input_text;
          if (typeof item.output_text === "string") return item.output_text;
          if (item.type === "image_url" && item.image_url) return `[image:${item.image_url.url || ""}]`;
          return "";
        }
        return String(item);
      })
      .join("");
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") return content.text;
  }
  return String(content);
}

export function normalizeAnthropicContent(content) {
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (item == null) return null;
        if (typeof item === "string") return { type: "text", text: item };
        if (item.type === "text" || typeof item.text === "string") {
          return { type: "text", text: item.text || "" };
        }
        if (item.type === "image_url" && item.image_url) {
          return { type: "image", source: { type: "url", url: item.image_url.url } };
        }
        if (item.type === "tool_use" || item.type === "function") {
          return {
            type: "tool_use",
            id: item.id || `toolu_${Math.random().toString(36).slice(2, 10)}`,
            name: item.name || item.function?.name || "",
            input: item.input || item.arguments || {}
          };
        }
        if (item.type === "tool_result") {
          return {
            type: "tool_result",
            tool_use_id: item.tool_use_id || item.tool_call_id || "",
            content: extractTextContent(item.content)
          };
        }
        return item;
      })
      .filter(Boolean);
  }
  return extractTextContent(content);
}

export function normalizeChatRole(role) {
  return ["system", "user", "assistant", "tool", "function"].includes(role) ? role : "user";
}

export function inferResponsesInputRole(item) {
  if (item?.role) return normalizeChatRole(item.role);
  if (item?.type === "function_call") return "assistant";
  if (item?.type === "function_call_output" || item?.type === "tool_result") return "tool";
  return "user";
}

export function extractResponsesInputContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "input_text" || part?.type === "output_text" || part?.type === "text") {
          return part.text || "";
        }
        return part?.text || "";
      })
      .filter(Boolean)
      .join("");
  }
  return extractTextContent(content);
}

// --- private helpers ---

function mapOpenAIToolsToAnthropic(tools) {
  if (!Array.isArray(tools)) return undefined;
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      const functionDef = tool.type === "function" ? tool.function : tool.function || tool;
      if (!functionDef?.name) return null;
      return {
        name: functionDef.name,
        description: functionDef.description || "",
        input_schema: functionDef.parameters || { type: "object", properties: {} }
      };
    })
    .filter(Boolean);
}

function mapOpenAIToolChoiceToAnthropic(choice) {
  if (choice === "auto") return { type: "auto" };
  if (choice === "required") return { type: "any" };
  if (choice === "none") return { type: "none" };
  if (choice && typeof choice === "object") {
    const name = choice.function?.name || choice.name;
    if (name) return { type: "tool", name };
  }
  return undefined;
}

function mapResponsesToolsToOpenAi(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools
    .map((tool) => {
      if (!tool || typeof tool !== "object") return null;
      if (tool.type !== "function") return tool;
      const functionDef = tool.function || tool;
      if (!functionDef?.name) return null;
      const out = {
        type: "function",
        function: {
          name: functionDef.name,
          description: functionDef.description || "",
          parameters: functionDef.parameters || { type: "object", properties: {} }
        }
      };
      if (functionDef.strict !== undefined) out.function.strict = functionDef.strict;
      return out;
    })
    .filter(Boolean);
}

function mapResponsesToolChoiceToOpenAi(choice) {
  if (choice === "auto" || choice === "required" || choice === "none") return choice;
  if (choice && typeof choice === "object") {
    const name = choice.function?.name || choice.name;
    if (choice.type === "function" && name) {
      return { type: "function", function: { name } };
    }
  }
  return choice;
}

function openAiMessageToAnthropic(message) {
  if (message?.role === "tool" || message?.role === "function") {
    return {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: message.tool_call_id || message.id || message.name || "",
        content: extractTextContent(message.content)
      }]
    };
  }

  const role = message?.role === "assistant" ? "assistant" : "user";
  const content = normalizeAnthropicContent(message?.content);
  const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  if (toolCalls.length === 0) return { role, content };

  const blocks = Array.isArray(content)
    ? content.slice()
    : (extractTextContent(content) ? [{ type: "text", text: extractTextContent(content) }] : []);
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    blocks.push({
      type: "tool_use",
      id: call.id || `toolu_${index}`,
      name: call.function?.name || call.name || "",
      input: parseMaybeJsonObject(call.function?.arguments ?? call.arguments)
    });
  }
  return { role, content: blocks };
}

function convertAnthropicMessageToOpenAi(message) {
  if (!message) return null;
  const role = message.role === "assistant" ? "assistant" : "user";
  if (Array.isArray(message.content)) {
    const text = message.content
      .filter((block) => block?.type === "text")
      .map((block) => block.text || "")
      .join("");
    const toolUses = message.content.filter((block) => block?.type === "tool_use");
    if (toolUses.length > 0) {
      return {
        role,
        content: text || null,
        tool_calls: toolUses.map((block, index) => ({
          id: block.id || `toolu_${index}`,
          type: "function",
          function: {
            name: block.name || "",
            arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {})
          }
        }))
      };
    }
    return { role, content: text };
  }
  return { role, content: extractTextContent(message.content) };
}

function choiceToAnthropicBlocks(choice) {
  const blocks = [];
  const message = choice?.message || {};
  const text = typeof message.content === "string" ? message.content : extractTextContent(message.content);
  if (text) blocks.push({ type: "text", text });
  const toolCalls = message.tool_calls || [];
  for (let index = 0; index < toolCalls.length; index += 1) {
    const call = toolCalls[index];
    blocks.push({
      type: "tool_use",
      id: call.id || `toolu_${index}`,
      name: call?.function?.name || "",
      input: parseMaybeJsonObject(call?.function?.arguments)
    });
  }
  return blocks;
}

function anthropicBlockToOpenAiToolCall(block, index) {
  if (!block || block.type !== "tool_use") return null;
  return {
    id: block.id || `toolu_${index}`,
    type: "function",
    function: {
      name: block.name || "",
      arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {})
    }
  };
}

function anthropicBlockToResponsesToolCall(block, index) {
  if (!block || block.type !== "tool_use") return null;
  return {
    id: block.id || `call_${index}`,
    type: "function_call",
    status: "completed",
    name: block.name || "",
    arguments: typeof block.input === "string" ? block.input : JSON.stringify(block.input || {}),
    call_id: block.id || `call_${index}`
  };
}

function extractReasoningText(response) {
  const reasoning = response?.choices?.[0]?.message?.reasoning || response?.choices?.[0]?.message?.reasoning_content;
  if (typeof reasoning === "string") return reasoning;
  if (Array.isArray(reasoning)) {
    return reasoning
      .map((item) => (typeof item === "string" ? item : item?.text || ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

function parseMaybeJsonObject(value) {
  if (typeof value !== "string") return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return { raw: value };
  }
}
