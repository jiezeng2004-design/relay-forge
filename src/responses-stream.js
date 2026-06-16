// Streaming bridge: turn an upstream OpenAI chat-completion SSE stream
// (or an Anthropic message SSE stream) into OpenAI Responses-style SSE
// events consumed by clients posting to /v1/responses with stream:true.
//
// We deliberately keep this conservative: it converts what the upstream
// actually emits and never fabricates tokens or fields.
//
// Key invariants:
//  - An upstream SSE event can be split across multiple `reader.read()`
//    chunks. The bridge keeps a residual buffer and only processes events
//    that have a complete blank-line terminator.
//  - `output_text.delta` and `response.reasoning_summary_text.delta`
//    events accumulate the full text so the closing
//    `output_text.done` / `response.completed` snapshot exposes the
//    complete content for clients that only read final state.

const RESPONSE_OBJECT = "response";
const OUTPUT_TEXT_TYPE = "output_text";
const MESSAGE_TYPE = "message";
const REASONING_TYPE = "reasoning";
const FUNCTION_CALL_TYPE = "function_call";

export function createResponsesSseBridge({
  requestModel,
  instructions,
  inputSummary,
  onUsage
}) {
  const responseId = `resp_${randomId()}`;
  const messageItemId = `msg_${randomId()}`;
  const reasoningItemId = `rs_${randomId()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  let textStarted = false;
  let reasoningStarted = false;
  let finalUsage = null;
  let finalModel = requestModel;
  let closed = false;
  let openAiResidual = "";
  let anthropicResidual = "";
  let accumulatedText = "";
  let accumulatedReasoning = "";
  let nextOutputIndex = 0;
  let messageOutputIndex = null;
  let reasoningOutputIndex = null;
  const functionCallItems = new Map();

  function snapshotResponse(status) {
    return {
      id: responseId,
      object: RESPONSE_OBJECT,
      created_at: createdAt,
      status,
      model: finalModel,
      output_text: accumulatedText,
      output: buildOutputSnapshot()
    };
  }

  function buildOutputSnapshot() {
    const items = [];
    if (reasoningStarted) {
      items.push({
        outputIndex: reasoningOutputIndex,
        id: reasoningItemId,
        type: REASONING_TYPE,
        status: "completed",
        summary: [{ type: "summary_text", text: accumulatedReasoning }]
      });
    }
    if (textStarted) {
      items.push({
        outputIndex: messageOutputIndex,
        id: messageItemId,
        type: MESSAGE_TYPE,
        status: "completed",
        role: "assistant",
        content: [{ type: OUTPUT_TEXT_TYPE, text: accumulatedText, annotations: [] }]
      });
    }
    for (const call of functionCallItems.values()) {
      items.push({
        outputIndex: call.outputIndex,
        id: call.itemId,
        type: FUNCTION_CALL_TYPE,
        status: "completed",
        call_id: call.callId,
        name: call.name || "",
        arguments: call.arguments
      });
    }
    return items
      .sort((a, b) => a.outputIndex - b.outputIndex)
      .map(({ outputIndex, ...item }) => item);
  }

  return {
    responseId,
    // Read-only views for tests / debugging.
    get accumulatedText() { return accumulatedText; },
    get accumulatedReasoning() { return accumulatedReasoning; },
    get finalModel() { return finalModel; },
    get finalUsage() { return finalUsage; },
    get openAiResidualLength() { return openAiResidual.length; },
    get anthropicResidualLength() { return anthropicResidual.length; },
    writeCreated(controller) {
      controller.enqueue(encoder.encode(formatEvent("response.created", { ...snapshotResponse("in_progress"), output: [] })));
    },
    writeHeaderEvents(controller) {
      // Per OpenAI docs, the first events after response.created are
      // response.in_progress and the initial output item shells.
      controller.enqueue(encoder.encode(formatEvent("response.in_progress", snapshotResponse("in_progress"))));
      if (inputSummary && typeof inputSummary === "string") {
        controller.enqueue(encoder.encode(formatComment(`input-summary: ${truncate(inputSummary, 240)}`)));
      }
    },
    bridgeOpenAiChunk(chunk) {
      return transformOpenAiChunk(chunk);
    },
    bridgeAnthropicEvent(event) {
      return transformAnthropicEvent(event);
    },
    transformChunk(rawText) {
      // Append incoming bytes to the residual buffer, then split on the
      // SSE event terminator (blank line) and only process complete
      // events. Anything left over stays in the buffer for next time.
      if (rawText) openAiResidual += rawText;
      const events = [];
      if (!openAiResidual) return events;
      const parts = openAiResidual.split(/\r?\n\r?\n/);
      // The last element is either "" (if the chunk ended on \n\n) or
      // the start of a partial event we have to keep for next time.
      openAiResidual = parts.pop() || "";
      for (const rawEvent of parts) {
        if (!rawEvent.trim()) continue;
        const parsed = parseSseEvent(rawEvent);
        if (!parsed) continue;
        if (parsed.event === "ping" || parsed.data === "[DONE]") continue;
        let data;
        try {
          data = JSON.parse(parsed.data);
        } catch (error) {
          error.streamFailureCode = "stream_parse_failed";
          throw error;
        }
        if (data && typeof data === "object" && "model" in data) finalModel = data.model || finalModel;
        if (data?.usage) finalUsage = data.usage;
        for (const ev of this.bridgeOpenAiChunk(data)) events.push(ev);
      }
      return events;
    },
    transformAnthropicRaw(rawText) {
      if (rawText) anthropicResidual += rawText;
      const events = [];
      if (!anthropicResidual) return events;
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
        for (const ev of this.bridgeAnthropicEvent(data)) events.push(ev);
      }
      return events;
    },
    finalize() {
      if (closed) return [];
      closed = true;
      // Drain any final partial event so we don't lose a tail chunk.
      const tail = [];
      if (openAiResidual.trim()) {
        const parsed = parseSseEvent(openAiResidual);
        if (parsed && parsed.data && parsed.data !== "[DONE]") {
          try {
            const data = JSON.parse(parsed.data);
            if (data && typeof data === "object" && "model" in data) finalModel = data.model || finalModel;
            if (data?.usage) finalUsage = data.usage;
            for (const ev of this.bridgeOpenAiChunk(data)) tail.push(ev);
          } catch (error) {
            error.streamFailureCode = "stream_parse_failed";
            throw error;
          }
        }
        openAiResidual = "";
      }
      if (anthropicResidual.trim()) {
        const parsed = parseSseEvent(anthropicResidual);
        if (parsed && parsed.data) {
          try {
            const data = JSON.parse(parsed.data);
            for (const ev of this.bridgeAnthropicEvent(data)) tail.push(ev);
          } catch (error) {
            error.streamFailureCode = "stream_parse_failed";
            throw error;
          }
        }
        anthropicResidual = "";
      }

      const out = [...tail];
      for (const item of outputItemsInOrder()) {
        if (item.type === MESSAGE_TYPE) {
          out.push(formatEvent("response.output_text.done", {
            item_id: messageItemId,
            output_index: messageOutputIndex,
            content_index: 0,
            text: accumulatedText,
            logprobs: []
          }));
          out.push(formatEvent("response.content_part.done", {
            item_id: messageItemId,
            output_index: messageOutputIndex,
            content_index: 0,
            part: { type: OUTPUT_TEXT_TYPE, text: accumulatedText, annotations: [] }
          }));
          out.push(formatEvent("response.output_item.done", {
            item_id: messageItemId,
            output_index: messageOutputIndex
          }));
        } else if (item.type === REASONING_TYPE) {
          out.push(formatEvent("response.reasoning_summary_text.done", {
            item_id: reasoningItemId,
            output_index: reasoningOutputIndex,
            summary_index: 0,
            text: accumulatedReasoning
          }));
          out.push(formatEvent("response.output_item.done", {
            item_id: reasoningItemId,
            output_index: reasoningOutputIndex
          }));
        } else if (item.type === FUNCTION_CALL_TYPE) {
          const call = item.call;
          out.push(formatEvent("response.function_call_arguments.done", {
            item_id: call.itemId,
            output_index: call.outputIndex,
            arguments: call.arguments
          }));
          out.push(formatEvent("response.output_item.done", {
            item_id: call.itemId,
            output_index: call.outputIndex,
            item: {
              id: call.itemId,
              type: FUNCTION_CALL_TYPE,
              status: "completed",
              call_id: call.callId,
              name: call.name || "",
              arguments: call.arguments
            }
          }));
        }
      }
      out.push(formatEvent("response.completed", {
        ...snapshotResponse("completed"),
        usage: finalUsage
      }));
      if (typeof onUsage === "function" && finalUsage) {
        try { onUsage(finalUsage); } catch (_) { /* ignore */ }
      }
      return out;
    }
  };

  function transformOpenAiChunk(chunk) {
    const out = [];
    if (!chunk || typeof chunk !== "object") return out;
    if (chunk.model) finalModel = chunk.model;
    if (chunk.usage) finalUsage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return out;
    const delta = choice.delta || {};
    if (delta.reasoning || delta.reasoning_content) {
      const reasoningText = delta.reasoning || delta.reasoning_content;
      startReasoning(out);
      accumulatedReasoning += reasoningText;
      out.push(formatEvent("response.reasoning_summary_text.delta", {
        item_id: reasoningItemId,
        output_index: reasoningOutputIndex,
        summary_index: 0,
        delta: reasoningText
      }));
    }
    if (typeof delta.content === "string" && delta.content.length > 0) {
      startMessage(out);
      accumulatedText += delta.content;
      out.push(formatEvent("response.output_text.delta", {
        item_id: messageItemId,
        output_index: messageOutputIndex,
        content_index: 0,
        delta: delta.content
      }));
    }
    if (Array.isArray(delta.tool_calls)) {
      for (const callDelta of delta.tool_calls) {
        appendOpenAiToolCallDelta(callDelta, out);
      }
    }
    return out;
  }

  function transformAnthropicEvent(event) {
    const out = [];
    if (!event || typeof event !== "object") return out;
    if (event.type === "message_start") {
      finalModel = event.message?.model || finalModel;
      if (event.message?.usage) {
        finalUsage = {
          input_tokens: event.message.usage.input_tokens || 0,
          output_tokens: event.message.usage.output_tokens || 0
        };
      }
    } else if (event.type === "content_block_start") {
      const block = event.content_block || {};
      if (block.type === "text") {
        startMessage(out);
      } else if (block.type === "thinking") {
        startReasoning(out);
      } else if (block.type === "tool_use") {
        startFunctionCall(`anthropic:${event.index ?? functionCallItems.size}`, {
          id: block.id,
          callId: block.id,
          name: block.name,
          arguments: stringifyToolInput(block.input)
        }, out);
      }
    } else if (event.type === "content_block_delta") {
      const delta = event.delta || {};
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        startMessage(out);
        accumulatedText += delta.text;
        out.push(formatEvent("response.output_text.delta", {
          item_id: messageItemId,
          output_index: messageOutputIndex,
          content_index: 0,
          delta: delta.text
        }));
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        startReasoning(out);
        accumulatedReasoning += delta.thinking;
        out.push(formatEvent("response.reasoning_summary_text.delta", {
          item_id: reasoningItemId,
          output_index: reasoningOutputIndex,
          summary_index: 0,
          delta: delta.thinking
        }));
      } else if (delta.type === "input_json_delta" && typeof delta.partial_json === "string") {
        appendAnthropicToolInputDelta(event.index, delta.partial_json, out);
      }
    } else if (event.type === "message_delta" && event.usage) {
      finalUsage = {
        input_tokens: event.usage.input_tokens || finalUsage?.input_tokens || 0,
        output_tokens: event.usage.output_tokens || event.usage.output_tokens_delta || finalUsage?.output_tokens || 0
      };
    }
    return out;
  }

  function allocateOutputIndex() {
    const outputIndex = nextOutputIndex;
    nextOutputIndex += 1;
    return outputIndex;
  }

  function startMessage(out) {
    if (textStarted) return;
    textStarted = true;
    messageOutputIndex = allocateOutputIndex();
    out.push(formatEvent("response.output_item.added", {
      output_index: messageOutputIndex,
      item: {
        id: messageItemId,
        type: MESSAGE_TYPE,
        status: "in_progress",
        role: "assistant",
        content: []
      }
    }));
    out.push(formatEvent("response.content_part.added", {
      item_id: messageItemId,
      output_index: messageOutputIndex,
      content_index: 0,
      part: { type: OUTPUT_TEXT_TYPE, text: "", annotations: [] }
    }));
  }

  function startReasoning(out) {
    if (reasoningStarted) return;
    reasoningStarted = true;
    reasoningOutputIndex = allocateOutputIndex();
    out.push(formatEvent("response.output_item.added", {
      output_index: reasoningOutputIndex,
      item: {
        id: reasoningItemId,
        type: REASONING_TYPE,
        status: "in_progress",
        summary: []
      }
    }));
  }

  function appendOpenAiToolCallDelta(callDelta, out) {
    if (!callDelta || typeof callDelta !== "object") return;
    const index = callDelta.index ?? functionCallItems.size;
    const key = `openai:${index}`;
    const fn = callDelta.function || {};
    const call = startFunctionCall(key, {
      id: callDelta.id,
      callId: callDelta.id,
      name: fn.name,
      arguments: ""
    }, out);
    if (callDelta.id && call.callId !== callDelta.id) call.callId = callDelta.id;
    if (fn.name && !call.name) call.name = fn.name;
    if (typeof fn.arguments === "string" && fn.arguments.length > 0) {
      call.arguments += fn.arguments;
      out.push(formatEvent("response.function_call_arguments.delta", {
        item_id: call.itemId,
        output_index: call.outputIndex,
        delta: fn.arguments
      }));
    }
  }

  function appendAnthropicToolInputDelta(index, partialJson, out) {
    const key = `anthropic:${index ?? functionCallItems.size}`;
    const call = startFunctionCall(key, {}, out);
    call.arguments += partialJson;
    out.push(formatEvent("response.function_call_arguments.delta", {
      item_id: call.itemId,
      output_index: call.outputIndex,
      delta: partialJson
    }));
  }

  function startFunctionCall(key, details, out) {
    let call = functionCallItems.get(key);
    if (call) {
      if (details?.name && !call.name) call.name = details.name;
      return call;
    }
    const fallbackId = `fc_${randomId()}`;
    const fallbackCallId = `call_${randomId()}`;
    call = {
      itemId: details?.id || fallbackId,
      callId: details?.callId || details?.id || fallbackCallId,
      name: details?.name || "",
      arguments: details?.arguments || "",
      outputIndex: allocateOutputIndex()
    };
    functionCallItems.set(key, call);
    out.push(formatEvent("response.output_item.added", {
      output_index: call.outputIndex,
      item: {
        id: call.itemId,
        type: FUNCTION_CALL_TYPE,
        status: "in_progress",
        call_id: call.callId,
        name: call.name,
        arguments: call.arguments
      }
    }));
    return call;
  }

  function outputItemsInOrder() {
    const items = [];
    if (textStarted) items.push({ type: MESSAGE_TYPE, outputIndex: messageOutputIndex });
    if (reasoningStarted) items.push({ type: REASONING_TYPE, outputIndex: reasoningOutputIndex });
    for (const call of functionCallItems.values()) {
      items.push({ type: FUNCTION_CALL_TYPE, outputIndex: call.outputIndex, call });
    }
    return items.sort((a, b) => a.outputIndex - b.outputIndex);
  }
}

function formatEvent(name, data) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

function formatComment(text) {
  return `: ${text}\n\n`;
}

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

function truncate(text, max) {
  if (!text) return "";
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function stringifyToolInput(input) {
  if (typeof input === "string") return input;
  if (input == null) return "";
  if (typeof input === "object" && !Array.isArray(input) && Object.keys(input).length === 0) return "";
  try {
    return JSON.stringify(input);
  } catch {
    return "";
  }
}
