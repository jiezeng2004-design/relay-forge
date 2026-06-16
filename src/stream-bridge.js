// Bidirectional streaming bridges between OpenAI chat.completion.chunk SSE
// and Anthropic messages SSE. Pure, dependency-free, stateful via closures.
//
// Invariants (matching src/responses-stream.js):
//  - An upstream SSE event can be split across multiple `reader.read()`
//    chunks. Each bridge keeps a residual buffer and only emits events
//    that have a complete blank-line terminator.
//  - The final partial event is drained by `finalize()` so we never
//    lose the tail.
//  - Upstream parse errors are surfaced with `streamFailureCode =
//    "stream_parse_failed"` so the caller can attribute them to the
//    right category in recentErrors.
//  - Usage is exposed via `onUsage` and tracked in the bridge's
//    `finalUsage` field for tests / debugging.

const OPENAI_OBJECT = "chat.completion.chunk";
const ANTHROPIC_EVENT = "message";

// ---------- OpenAI chat.completion.chunk -> Anthropic messages SSE ----------

export function createOpenAiToAnthropicSseBridge({
  requestModel,
  upstreamModel,
  onUsage
}) {
  const messageId = `msg_${randomId()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const model = upstreamModel || requestModel || "unknown";
  let openAiResidual = "";
  let textBlockOpened = false;
  let textBlockIndex = 0;
  let thinkingBlockOpened = false;
  let thinkingBlockIndex = -1;
  let toolBlocks = []; // [{ index, id, name, argsBuffer, opened }]
  let messageStartSent = false;
  let messageStopSent = false;
  let finalUsage = null;
  let finalFinishReason = "stop"; // maps to Anthropic end_turn / tool_use / max_tokens

  function emitEvent(name, data) {
    return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
  }

  function buildMessageStartUsage() {
    return { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
  }

  function buildMessageStart() {
    return {
      message: {
        id: messageId,
        type: ANTHROPIC_EVENT,
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: buildMessageStartUsage()
      }
    };
  }

  function finishToolBufferIfNeeded() {
    // Flush any tool_use blocks that the upstream never closed (some
    // providers omit content_block_stop). For each unfinished block,
    // emit a content_block_stop.
    const out = [];
    for (const block of toolBlocks) {
      if (block.opened && !block.closed) {
        out.push(emitEvent("content_block_stop", { index: block.index, type: "tool_use" }));
        block.closed = true;
      }
    }
    return out;
  }

  function mapFinishReasonToStopReason(reason) {
    if (reason === "tool_calls" || reason === "function_call") return "tool_use";
    if (reason === "length") return "max_tokens";
    if (reason === "content_filter") return "refusal";
    return "end_turn";
  }

  function transformChunk(rawText) {
    if (rawText) openAiResidual += rawText;
    const out = [];
    if (!openAiResidual) return out;
    const parts = openAiResidual.split(/\r?\n\r?\n/);
    openAiResidual = parts.pop() || "";
    for (const rawEvent of parts) {
      if (!rawEvent.trim()) continue;
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;
      if (parsed.event === "ping") continue;
      if (parsed.data === "[DONE]") continue;
      let data;
      try {
        data = JSON.parse(parsed.data);
      } catch (error) {
        error.streamFailureCode = "stream_parse_failed";
        throw error;
      }
      if (data && typeof data === "object" && "model" in data && data.model) {
        // upstream knows its own model; adopt it so the snapshot
        // matches what the client sees.
        // (intentionally not reassigning the const `model`; tracked separately)
      }
      for (const ev of transformOpenAiChunk(data)) out.push(ev);
    }
    return out;
  }

  function transformOpenAiChunk(chunk) {
    const out = [];
    if (!chunk || typeof chunk !== "object") return out;
    if (chunk.usage) {
      finalUsage = normalizeOpenAiUsage(chunk.usage);
    }
    if (!messageStartSent) {
      messageStartSent = true;
      out.push(emitEvent("message_start", buildMessageStart()));
      out.push(emitEvent("ping", {}));
    }
    const choice = chunk.choices?.[0];
    if (!choice) return out;
    const delta = choice.delta || {};
    // Reasoning / thinking (DeepSeek-R1, o1, etc.) — emitted as
    // a `thinking` content_block on the Anthropic side.
    const reasoningText = delta.reasoning || delta.reasoning_content;
    if (typeof reasoningText === "string" && reasoningText.length > 0) {
      if (!thinkingBlockOpened) {
        thinkingBlockIndex = textBlockIndex; // will be inserted before any text/tool blocks
        // Shift text/tool block indices by 1 to make room.
        textBlockIndex += 1;
        for (const block of toolBlocks) block.index += 1;
        thinkingBlockOpened = true;
        out.push(emitEvent("content_block_start", {
          index: thinkingBlockIndex,
          type: "thinking"
        }));
      }
      out.push(emitEvent("content_block_delta", {
        index: thinkingBlockIndex,
        type: "thinking",
        delta: { type: "thinking_delta", thinking: reasoningText }
      }));
    }
    // Text content
    if (typeof delta.content === "string" && delta.content.length > 0) {
      if (!textBlockOpened) {
        textBlockOpened = true;
        out.push(emitEvent("content_block_start", {
          index: textBlockIndex,
          type: "text",
          text: ""
        }));
      }
      out.push(emitEvent("content_block_delta", {
        index: textBlockIndex,
        type: "text",
        delta: { type: "text_delta", text: delta.content }
      }));
    }
    // Tool calls (incremental). Upstreams split a single tool_call
    // across multiple chunks: first with the name, later with
    // argument deltas (delta with id may repeat, name appears once).
    const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const call of toolCalls) {
      const callIndex = typeof call.index === "number" ? call.index : 0;
      let block = toolBlocks[callIndex];
      if (!block) {
        // Allocate at the next free content index. textBlockIndex may
        // not be the right anchor anymore if we have a thinking
        // block in front of it; compute defensively.
        const nextIndex = Math.max(
          textBlockIndex + (textBlockOpened ? 1 : 0),
          thinkingBlockIndex + (thinkingBlockOpened ? 1 : 0),
          ...toolBlocks.filter((b) => b).map((b) => b.index + 1)
        );
        block = {
          index: nextIndex,
          id: call.id || `toolu_${randomId()}`,
          name: call.function?.name || "",
          argsBuffer: "",
          opened: false,
          closed: false
        };
        toolBlocks[callIndex] = block;
        textBlockIndex = Math.max(textBlockIndex, block.index);
      } else if (call.id) {
        block.id = call.id;
      }
      if (call.function?.name) block.name = call.function.name;
      if (!block.opened) {
        block.opened = true;
        out.push(emitEvent("content_block_start", {
          index: block.index,
          type: "tool_use",
          id: block.id,
          name: block.name,
          input: {}
        }));
      }
      if (typeof call.function?.arguments === "string" && call.function.arguments.length > 0) {
        block.argsBuffer += call.function.arguments;
        out.push(emitEvent("content_block_delta", {
          index: block.index,
          type: "input_json",
          delta: { type: "input_json_delta", partial_json: call.function.arguments }
        }));
      }
    }
    // Final chunk carries finish_reason
    if (choice.finish_reason) {
      finalFinishReason = mapFinishReasonToStopReason(choice.finish_reason);
    }
    return out;
  }

  function finalize() {
    if (messageStopSent) return [];
    messageStopSent = true;
    const out = [];
    if (!messageStartSent) {
      // Empty stream: still emit a complete message envelope.
      messageStartSent = true;
      out.push(emitEvent("message_start", buildMessageStart()));
    }
    if (thinkingBlockOpened) {
      out.push(emitEvent("content_block_stop", { index: thinkingBlockIndex, type: "thinking" }));
    }
    if (textBlockOpened) {
      out.push(emitEvent("content_block_stop", { index: textBlockIndex, type: "text" }));
    }
    out.push(...finishToolBufferIfNeeded());
    // message_delta: carries the final stop_reason + output_tokens.
    const deltaPayload = {
      delta: { stop_reason: finalFinishReason, stop_sequence: null }
    };
    if (finalUsage) {
      deltaPayload.usage = { output_tokens: finalUsage.output_tokens || 0 };
    }
    out.push(emitEvent("message_delta", deltaPayload));
    out.push(emitEvent("message_stop", { type: "message_stop" }));
    if (typeof onUsage === "function" && finalUsage) {
      try { onUsage(finalUsage); } catch (_) { /* ignore */ }
    }
    return out;
  }

  return {
    messageId,
    encoder,
    get finalUsage() { return finalUsage; },
    get finalFinishReason() { return finalFinishReason; },
    get openAiResidualLength() { return openAiResidual.length; },
    transformChunk,
    finalize
  };
}

// ---------- Anthropic messages SSE -> OpenAI chat.completion.chunk ----------

export function createAnthropicToOpenAiSseBridge({
  requestModel,
  upstreamModel,
  onUsage
}) {
  const chatId = `chatcmpl-${randomId()}`;
  const created = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const model = upstreamModel || requestModel || "unknown";
  let anthropicResidual = "";
  let roleSent = false;
  let finalUsage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finalFinishReason = "stop";
  let closed = false;

  function emitChunk(delta, finishReason, includeUsage) {
    const payload = {
      id: chatId,
      object: OPENAI_OBJECT,
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finishReason || null }]
    };
    if (includeUsage && finalUsage) {
      payload.usage = finalUsage;
    }
    return `data: ${JSON.stringify(payload)}\n\n`;
  }

  function mapStopReasonToFinishReason(reason) {
    if (reason === "tool_use") return "tool_calls";
    if (reason === "max_tokens") return "length";
    if (reason === "refusal") return "content_filter";
    return "stop";
  }

  function transformAnthropicRaw(rawText) {
    if (rawText) anthropicResidual += rawText;
    const out = [];
    if (!anthropicResidual) return out;
    const parts = anthropicResidual.split(/\r?\n\r?\n/);
    anthropicResidual = parts.pop() || "";
    for (const rawEvent of parts) {
      if (!rawEvent.trim()) continue;
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;
      let data;
      try {
        data = JSON.parse(parsed.data);
      } catch (error) {
        error.streamFailureCode = "stream_parse_failed";
        throw error;
      }
      for (const ev of transformAnthropicEvent(data)) out.push(ev);
    }
    return out;
  }

  function transformAnthropicEvent(event) {
    const out = [];
    if (!event || typeof event !== "object") return out;
    if (event.type === "message_start") {
      const message = event.message || {};
      if (message.model) {
        // upstream knows its own model; adopted
      }
      if (message.usage) {
        finalUsage = {
          prompt_tokens: message.usage.input_tokens || 0,
          completion_tokens: message.usage.output_tokens || 0,
          total_tokens: (message.usage.input_tokens || 0) + (message.usage.output_tokens || 0)
        };
      } else {
        // Keep the placeholder usage object so the final chunk's
        // `usage` field is present (OpenAI clients like to read it
        // even when the upstream is silent on counts).
        finalUsage = finalUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      }
      if (!roleSent) {
        roleSent = true;
        out.push(emitChunk({ role: "assistant", content: "" }, null, false));
      }
    } else if (event.type === "content_block_start") {
      const block = event.content_block || {};
      if (block.type === "tool_use") {
        out.push(emitChunk({
          tool_calls: [{
            index: typeof event.index === "number" ? event.index : 0,
            id: block.id,
            type: "function",
            function: { name: block.name || "", arguments: "" }
          }]
        }, null, false));
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta || {};
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        out.push(emitChunk({ content: delta.text }, null, false));
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        out.push(emitChunk({
          tool_calls: [{
            index: typeof event.index === "number" ? event.index : 0,
            function: { arguments: delta.partial_json }
          }]
        }, null, false));
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        // OpenAI's chat-completion stream does not have a first-class
        // reasoning field, but several providers (DeepSeek, o1) and
        // downstream consumers use delta.reasoning_content. We emit
        // both `reasoning` and `reasoning_content` so consumers that
        // expect either will work.
        out.push(emitChunk({ reasoning: delta.thinking, reasoning_content: delta.thinking }, null, false));
      }
    } else if (event.type === "message_delta") {
      if (event.delta?.stop_reason) {
        finalFinishReason = mapStopReasonToFinishReason(event.delta.stop_reason);
      }
      if (event.usage) {
        finalUsage = {
          prompt_tokens: event.usage.input_tokens || finalUsage?.prompt_tokens || 0,
          completion_tokens: event.usage.output_tokens || event.usage.output_tokens_delta || finalUsage?.completion_tokens || 0,
          total_tokens: (event.usage.input_tokens || finalUsage?.prompt_tokens || 0) + (event.usage.output_tokens || event.usage.output_tokens_delta || finalUsage?.completion_tokens || 0)
        };
      } else {
        finalUsage = finalUsage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      }
    }
    return out;
  }

  function finalize() {
    if (closed) return [];
    closed = true;
    const out = [];
    if (anthropicResidual.trim()) {
      const parsed = parseSseEvent(anthropicResidual);
      if (parsed && parsed.data) {
        try {
          const data = JSON.parse(parsed.data);
          for (const ev of transformAnthropicEvent(data)) out.push(ev);
        } catch (error) {
          error.streamFailureCode = "stream_parse_failed";
          throw error;
        }
      }
      anthropicResidual = "";
    }
    if (!roleSent) {
      out.push(emitChunk({ role: "assistant", content: "" }, null, false));
    }
    out.push(emitChunk({}, finalFinishReason, true));
    out.push("data: [DONE]\n\n");
    if (typeof onUsage === "function" && finalUsage) {
      try { onUsage(finalUsage); } catch (_) { /* ignore */ }
    }
    return out;
  }

  return {
    chatId,
    encoder,
    get finalUsage() { return finalUsage; },
    get finalFinishReason() { return finalFinishReason; },
    get anthropicResidualLength() { return anthropicResidual.length; },
    transformAnthropicRaw,
    finalize
  };
}

// ---------- shared helpers ----------

function parseSseEvent(rawEvent) {
  let event = "message";
  let data = "";
  for (const line of rawEvent.split(/\r?\n/)) {
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
  }
  if (!data) return null;
  return { event, data };
}

function randomId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function normalizeOpenAiUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  return {
    input_tokens: usage.prompt_tokens || 0,
    output_tokens: usage.completion_tokens || 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0
  };
}
