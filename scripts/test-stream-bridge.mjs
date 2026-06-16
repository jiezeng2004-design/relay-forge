// Pure unit tests for src/stream-bridge.js. No server, no I/O.
// Covers both directions: OpenAI chat.completion.chunk -> Anthropic
// messages SSE and Anthropic messages SSE -> OpenAI chat.completion
// chunk. Checks chunk-boundary handling, tool_use / tool_calls
// mapping, reasoning / thinking, finish_reason mapping, usage
// capture, and the stream_idle_timeout parse error contract.

import {
  createAnthropicToOpenAiSseBridge,
  createOpenAiToAnthropicSseBridge
} from "../src/stream-bridge.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

// --- helpers ---------------------------------------------------------------

function concat(events) {
  return events.join("");
}

function collect(bridge, chunks) {
  const out = [];
  // Each bridge exposes a different transform entrypoint depending on
  // the upstream format it consumes.
  const transform = typeof bridge.transformChunk === "function"
    ? (text) => bridge.transformChunk(text)
    : (text) => bridge.transformAnthropicRaw(text);
  for (const chunk of chunks) {
    try {
      for (const ev of transform(chunk)) out.push(ev);
    } catch (e) {
      e.bridge = bridge;
      throw e;
    }
  }
  for (const ev of bridge.finalize()) out.push(ev);
  return concat(out);
}

function parseSseEvents(sseString) {
  const events = [];
  for (const raw of sseString.split(/\r?\n\r?\n/)) {
    if (!raw.trim()) continue;
    let event = "message";
    let data = "";
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
    }
    if (data && data !== "[DONE]") events.push({ event, data });
  }
  return events;
}

function dataOf(events, eventName) {
  for (const ev of events) {
    if (ev.event === eventName) return JSON.parse(ev.data);
  }
  return null;
}

function chunksOf(events, eventName) {
  return events.filter((ev) => ev.event === eventName).map((ev) => JSON.parse(ev.data));
}

// --- OpenAI -> Anthropic ----------------------------------------------------

test("OpenAI->Anthropic: empty input still emits a valid message envelope", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const out = collect(bridge, []);
  const events = parseSseEvents(out);
  const start = dataOf(events, "message_start");
  assert(start && start.message.role === "assistant", "message_start emitted");
  const stop = dataOf(events, "message_stop");
  assert(stop, "message_stop emitted");
  assertEqual(stop.type, "message_stop", "stop type");
});

test("OpenAI->Anthropic: text deltas map to content_block_delta text_delta", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const chunks = [
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { role: "assistant", content: "Hello" }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { content: " world" }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }]
    })}\n\n`,
    `data: [DONE]\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const starts = events.filter((ev) => ev.event === "content_block_start" && JSON.parse(ev.data).type === "text");
  assertEqual(starts.length, 1, "one text content_block_start");
  const textStarts = JSON.parse(starts[0].data);
  assertEqual(textStarts.text, "", "text block starts empty");
  const deltas = events.filter((ev) => ev.event === "content_block_delta" && JSON.parse(ev.data).type === "text").map((ev) => JSON.parse(ev.data).delta.text);
  assertEqual(deltas.join(""), "Hello world", "concatenated text");
  const msgDelta = dataOf(events, "message_delta");
  assertEqual(msgDelta.delta.stop_reason, "end_turn", "stop_reason mapped from stop");
});

test("OpenAI->Anthropic: finish_reason tool_calls maps to stop_reason tool_use", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const chunks = [
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "" } }] }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }] }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: "\"hi\"}" } }] }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "chatcmpl-1", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }]
    })}\n\n`,
    `data: [DONE]\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const toolStarts = events.filter((ev) => ev.event === "content_block_start" && JSON.parse(ev.data).type === "tool_use").map((ev) => JSON.parse(ev.data));
  assertEqual(toolStarts.length, 1, "one tool_use block");
  assertEqual(toolStarts[0].name, "lookup", "name preserved");
  assertEqual(toolStarts[0].id, "call_1", "id preserved");
  const inputDeltas = events.filter((ev) => ev.event === "content_block_delta" && JSON.parse(ev.data).type === "input_json").map((ev) => JSON.parse(ev.data).delta.partial_json);
  assertEqual(inputDeltas.join(""), "{\"q\":\"hi\"}", "concatenated args JSON");
  const stop = dataOf(events, "content_block_stop");
  assert(stop && stop.type === "tool_use", "tool_use content_block_stop emitted");
  const msgDelta = dataOf(events, "message_delta");
  assertEqual(msgDelta.delta.stop_reason, "tool_use", "stop_reason mapped to tool_use");
});

test("OpenAI->Anthropic: finish_reason length maps to stop_reason max_tokens", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const chunks = [
    `data: ${JSON.stringify({
      id: "c", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { role: "assistant", content: "hi" }, finish_reason: "length" }]
    })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const msgDelta = dataOf(events, "message_delta");
  assertEqual(msgDelta.delta.stop_reason, "max_tokens", "length -> max_tokens");
});

test("OpenAI->Anthropic: reasoning deltas map to a thinking content_block", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const chunks = [
    `data: ${JSON.stringify({
      id: "c", object: "chat.completion.chunk", model: "deepseek-reasoner",
      choices: [{ index: 0, delta: { role: "assistant", reasoning: "think ", reasoning_content: "think " }, finish_reason: null }]
    })}\n\n`,
    `data: ${JSON.stringify({
      id: "c", object: "chat.completion.chunk", model: "deepseek-reasoner",
      choices: [{ index: 0, delta: { reasoning_content: "more", content: "ok" }, finish_reason: "stop" }]
    })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const thinkStart = events.filter((ev) => ev.event === "content_block_start" && JSON.parse(ev.data).type === "thinking");
  assertEqual(thinkStart.length, 1, "one thinking block");
  const thinkDeltas = events.filter((ev) => ev.event === "content_block_delta" && JSON.parse(ev.data).type === "thinking").map((ev) => JSON.parse(ev.data).delta.thinking);
  assertEqual(thinkDeltas.join(""), "think more", "thinking accumulated");
  const textDeltas = events.filter((ev) => ev.event === "content_block_delta" && JSON.parse(ev.data).type === "text").map((ev) => JSON.parse(ev.data).delta.text);
  assertEqual(textDeltas.join(""), "ok", "text emitted after thinking");
});

test("OpenAI->Anthropic: usage in final chunk maps to message_delta.usage", () => {
  let captured;
  const bridge = createOpenAiToAnthropicSseBridge({
    requestModel: "claude-test",
    onUsage: (usage) => { captured = usage; }
  });
  const chunks = [
    `data: ${JSON.stringify({
      id: "c", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { role: "assistant", content: "x" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 12, completion_tokens: 34, total_tokens: 46 }
    })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const msgDelta = dataOf(events, "message_delta");
  assertEqual(msgDelta.usage.output_tokens, 34, "output_tokens in message_delta.usage");
  assert(captured, "onUsage fired");
  assertEqual(captured.input_tokens, 12, "captured prompt_tokens");
});

test("OpenAI->Anthropic: chunk split across two reads keeps state in residual", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const full = `data: ${JSON.stringify({
    id: "c", object: "chat.completion.chunk", model: "gpt-4o",
    choices: [{ index: 0, delta: { content: "Hello" }, finish_reason: "stop" }]
  })}\n\n`;
  // split mid-event
  const splitAt = Math.floor(full.length / 2);
  const out = collect(bridge, [full.slice(0, splitAt), full.slice(splitAt)]);
  const events = parseSseEvents(out);
  const textDeltas = events.filter((ev) => ev.event === "content_block_delta" && JSON.parse(ev.data).type === "text").map((ev) => JSON.parse(ev.data).delta.text);
  assertEqual(textDeltas.join(""), "Hello", "split chunk still decoded");
});

test("OpenAI->Anthropic: malformed JSON throws with streamFailureCode set", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  let caught;
  try {
    bridge.transformChunk("data: {not-json}\n\n");
  } catch (e) {
    caught = e;
  }
  assert(caught, "threw");
  assertEqual(caught.streamFailureCode, "stream_parse_failed", "streamFailureCode tagged");
});

test("OpenAI->Anthropic: ping events are skipped silently", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const out = collect(bridge, [`: ping\n\n`]);
  const events = parseSseEvents(out);
  // Should still emit message_start + message_stop
  const start = dataOf(events, "message_start");
  const stop = dataOf(events, "message_stop");
  assert(start && stop, "envelope still emitted");
});

test("OpenAI->Anthropic: tool_use block is closed by finalize even when upstream omits stop", () => {
  const bridge = createOpenAiToAnthropicSseBridge({ requestModel: "claude-test" });
  const chunks = [
    `data: ${JSON.stringify({
      id: "c", object: "chat.completion.chunk", model: "gpt-4o",
      choices: [{ index: 0, delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } }] }, finish_reason: "tool_calls" }]
    })}\n\n`
    // No explicit content_block_stop in upstream; finalize must emit it.
  ];
  const events = parseSseEvents(collect(bridge, chunks));
  const stops = events.filter((ev) => ev.event === "content_block_stop" && JSON.parse(ev.data).type === "tool_use");
  assertEqual(stops.length, 1, "tool_use content_block_stop emitted by finalize");
});

// --- Anthropic -> OpenAI ----------------------------------------------------

test("Anthropic->OpenAI: empty input still emits a valid role chunk + done", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const out = collect(bridge, []);
  const events = parseSseEvents(out);
  // The first emitted chunk should be the role announcement
  const first = JSON.parse(events[0].data);
  assertEqual(first.choices[0].delta.role, "assistant", "role chunk emitted");
  assertEqual(first.choices[0].delta.content, "", "empty content");
  // Last should be a finish_reason chunk with [DONE] following
  const lastData = JSON.parse(events[events.length - 1].data);
  assertEqual(lastData.choices[0].finish_reason, "stop", "final finish_reason");
  assertEqual(events[events.length - 1].event, "message", "final event is message");
});

test("Anthropic->OpenAI: message_start + text_delta + message_delta + message_stop", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-3-5-haiku", usage: { input_tokens: 7, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello " } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "world" } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 11 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const out = collect(bridge, chunks);
  assert(out.endsWith("data: [DONE]\n\n"), "[DONE] terminator emitted");
  const events = parseSseEvents(out);
  const deltas = events.map((ev) => JSON.parse(ev.data)).map((d) => d.choices?.[0]?.delta?.content || "").join("");
  assertEqual(deltas, "Hello world", "text concatenated");
  const last = JSON.parse(events[events.length - 1].data);
  assertEqual(last.choices[0].finish_reason, "stop", "stop -> stop");
  assert(last.usage, "usage present on final chunk");
  assertEqual(last.usage.completion_tokens, 11, "completion_tokens from message_delta");
});

test("Anthropic->OpenAI: tool_use maps to tool_calls with incremental arguments", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude", usage: { input_tokens: 1, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "lookup", input: {} } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"hi\"}" } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "tool_use" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const out = collect(bridge, chunks);
  const events = parseSseEvents(out).map((ev) => JSON.parse(ev.data));
  const toolDeltas = events.flatMap((d) => d.choices?.[0]?.delta?.tool_calls || []).map((c) => c.function?.arguments || "").join("");
  assertEqual(toolDeltas, "{\"q\":\"hi\"}", "tool arguments accumulated");
  const firstTool = events.find((d) => d.choices?.[0]?.delta?.tool_calls?.[0]?.id)?.choices[0].delta.tool_calls[0];
  assertEqual(firstTool.id, "toolu_1", "tool id preserved");
  const last = events[events.length - 1];
  assertEqual(last.choices[0].finish_reason, "tool_calls", "tool_use -> tool_calls");
});

test("Anthropic->OpenAI: thinking_delta maps to reasoning + reasoning_content", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", model: "claude", usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`,
    `event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "deep" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " thought" } })}\n\n`,
    `event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks)).map((ev) => JSON.parse(ev.data));
  const reasoning = events.flatMap((d) => d.choices?.[0]?.delta?.reasoning || []).join("");
  assertEqual(reasoning, "deep thought", "reasoning accumulated");
  const reasoningContent = events.flatMap((d) => d.choices?.[0]?.delta?.reasoning_content || []).join("");
  assertEqual(reasoningContent, "deep thought", "reasoning_content also emitted");
});

test("Anthropic->OpenAI: stop_reason refusal maps to finish_reason content_filter", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", model: "claude", usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "refusal" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks)).map((ev) => JSON.parse(ev.data));
  const last = events[events.length - 1];
  assertEqual(last.choices[0].finish_reason, "content_filter", "refusal -> content_filter");
});

test("Anthropic->OpenAI: stop_reason max_tokens maps to finish_reason length", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", model: "claude", usage: { input_tokens: 0, output_tokens: 0 } } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "max_tokens" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks)).map((ev) => JSON.parse(ev.data));
  assertEqual(events[events.length - 1].choices[0].finish_reason, "length", "max_tokens -> length");
});

test("Anthropic->OpenAI: chunk split across two reads keeps state in residual", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const full =
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "splittest" } })}\n\n`;
  const mid = Math.floor(full.length / 2);
  const out = collect(bridge, [full.slice(0, mid), full.slice(mid)]);
  const events = parseSseEvents(out).map((ev) => JSON.parse(ev.data));
  const text = events.map((d) => d.choices?.[0]?.delta?.content || "").join("");
  assertEqual(text, "splittest", "split chunk decoded");
});

test("Anthropic->OpenAI: malformed JSON throws with streamFailureCode set", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  let caught;
  try {
    bridge.transformAnthropicRaw("event: content_block_delta\ndata: {bad-json}\n\n");
  } catch (e) {
    caught = e;
  }
  assert(caught, "threw");
  assertEqual(caught.streamFailureCode, "stream_parse_failed", "streamFailureCode tagged");
});

test("Anthropic->OpenAI: tail partial event drained by finalize", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  // Simulate a chunk that doesn't end on \n\n — finalize() should drain it.
  const partial =
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "tail" } })}\n\n` +
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "drop" } })}`; // no trailing \n\n
  const out = collect(bridge, [partial]);
  const events = parseSseEvents(out).map((ev) => JSON.parse(ev.data));
  const text = events.map((d) => d.choices?.[0]?.delta?.content || "").join("");
  assertEqual(text, "taildrop", "tail partial event drained");
});

test("Anthropic->OpenAI: onUsage fires with normalized usage", () => {
  let captured;
  const bridge = createAnthropicToOpenAiSseBridge({
    requestModel: "gpt-4o",
    onUsage: (usage) => { captured = usage; }
  });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", model: "claude", usage: { input_tokens: 9, output_tokens: 0 } } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 13 } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  collect(bridge, chunks);
  assert(captured, "onUsage fired");
  assertEqual(captured.prompt_tokens, 9, "prompt_tokens");
  assertEqual(captured.completion_tokens, 13, "completion_tokens");
  assertEqual(captured.total_tokens, 22, "total_tokens");
});

test("Anthropic->OpenAI: usage missing from message_start still surfaces on final chunk", () => {
  const bridge = createAnthropicToOpenAiSseBridge({ requestModel: "gpt-4o" });
  const chunks = [
    `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { id: "m", role: "assistant", model: "claude" } })}\n\n`,
    `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hi" } })}\n\n`,
    `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" } })}\n\n`,
    `event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}\n\n`
  ];
  const events = parseSseEvents(collect(bridge, chunks)).map((ev) => JSON.parse(ev.data));
  const last = events[events.length - 1];
  assert(last.usage, "usage present on final chunk even when upstream omits");
  assertEqual(last.usage.completion_tokens, 0, "completion_tokens defaults to 0");
  assertEqual(last.usage.prompt_tokens, 0, "prompt_tokens defaults to 0");
});

// --- runner ----------------------------------------------------------------

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.fn();
    console.log(`  ok  ${t.name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL  ${t.name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
