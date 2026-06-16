// Unit tests for the responses-stream bridge.
// Run: node scripts/test-responses-stream.mjs
//
// Covers the regression codex flagged: a single upstream SSE event
// can be split across two `reader.read()` chunks; the bridge must
// stitch them back together before parsing, otherwise deltas silently
// disappear. Also covers accumulated text + closing-event completeness.

import { createResponsesSseBridge } from "../src/responses-stream.js";

const tests = [];
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };

function test(name, fn) {
  tests.push({ name, fn });
}

function parseEvents(stream) {
  // stream is the joined SSE text emitted by the bridge.
  const events = [];
  for (const block of stream.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const lines = block.split(/\r?\n/);
    let name = "message";
    let data = "";
    for (const line of lines) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      else if (line.startsWith("data:")) data += (data ? "\n" : "") + line.slice(5).trim();
    }
    if (!data) continue;
    try {
      events.push({ name, data: JSON.parse(data) });
    } catch {
      events.push({ name, data });
    }
  }
  return events;
}

test("text deltas accumulate and closing event exposes full text", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { content: "Hel" } },
    { delta: { content: "lo" } },
    { delta: { content: " world" }, finish_reason: "stop" }
  ]))) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const events = parseEvents(out.join(""));
  const completed = events.find((e) => e.name === "response.completed");
  assert(completed, "response.completed should be emitted");
  assert(completed.data.output_text === "Hello world", `output_text should be 'Hello world', got '${completed.data.output_text}'`);
  const message = completed.data.output.find((item) => item.type === "message");
  assert(message, "completed snapshot should include a message output item");
  assert(message.content[0].text === "Hello world", `message content should be full text, got '${message.content[0].text}'`);
  const done = events.find((e) => e.name === "response.output_text.done");
  assert(done, "response.output_text.done should be emitted");
  assert(done.data.text === "Hello world", `output_text.done should carry full text, got '${done.data.text}'`);
});

test("reasoning and text are both accumulated independently", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { reasoning: "first, " } },
    { delta: { reasoning: "second. " } },
    { delta: { content: "answer" } },
    { delta: { content: " 42" }, finish_reason: "stop" }
  ]))) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const events = parseEvents(out.join(""));
  const completed = events.find((e) => e.name === "response.completed");
  const reasoning = completed.data.output.find((item) => item.type === "reasoning");
  const message = completed.data.output.find((item) => item.type === "message");
  assert(reasoning, "reasoning item should be present");
  assert(message, "message item should be present");
  assert(reasoning.summary[0].text === "first, second. ", `reasoning accumulated wrong: '${reasoning.summary[0].text}'`);
  assert(message.content[0].text === "answer 42", `text accumulated wrong: '${message.content[0].text}'`);
  // Reasoning comes before text in the output array.
  assert(completed.data.output.indexOf(reasoning) < completed.data.output.indexOf(message), "reasoning should appear before message in output");
});

test("REGRESSION: SSE event split across two reader.read() chunks is reassembled", () => {
  // The bug: a single `data: {...}\n\n` event arriving in two TCP
  // chunks (e.g. "data: {\"choices\":[{\"delt" + "a\":{\"content\":\"X\"}}]}\n\n")
  // used to be silently dropped. The bridge must keep a residual
  // buffer and only treat an event as complete once the blank line
  // terminator arrives.
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const fullEvent = "data: " + JSON.stringify({
    id: "c1", object: "chat.completion.chunk", model: "m",
    choices: [{ index: 0, delta: { content: "split-token" }, finish_reason: null }]
  }) + "\n\n";
  const midpoint = Math.floor(fullEvent.length / 2);
  const firstHalf = fullEvent.slice(0, midpoint);
  const secondHalf = fullEvent.slice(midpoint);

  const out = [];
  for (const ev of bridge.transformChunk(firstHalf)) out.push(ev);
  assert(bridge.openAiResidualLength > 0, "first half should leave residual in the buffer");
  for (const ev of bridge.transformChunk(secondHalf)) out.push(ev);
  assert(bridge.openAiResidualLength === 0, "second half should consume the residual and leave buffer empty");

  const deltas = parseEvents(out.join("")).filter((e) => e.name === "response.output_text.delta");
  assert(deltas.length === 1, `expected 1 text delta, got ${deltas.length}`);
  assert(deltas[0].data.delta === "split-token", `delta text mismatch: '${deltas[0].data.delta}'`);
});

test("multiple SSE events in a single chunk are all delivered", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { content: "a" } },
    { delta: { content: "b" } },
    { delta: { content: "c" }, finish_reason: "stop" }
  ]))) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const deltas = parseEvents(out.join("")).filter((e) => e.name === "response.output_text.delta");
  assert(deltas.length === 3, `expected 3 deltas, got ${deltas.length}`);
  assert(deltas.map((d) => d.data.delta).join("") === "abc", `deltas wrong: ${deltas.map((d) => d.data.delta).join("|")}`);
});

test("[DONE] is silently ignored without affecting text accumulation", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  const raw = makeOpenAiChunks([{ delta: { content: "hi" }, finish_reason: "stop" }]) + "data: [DONE]\n\n";
  for (const ev of bridge.transformChunk(raw)) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const completed = parseEvents(out.join("")).find((e) => e.name === "response.completed");
  assert(completed, "completed event should still fire after [DONE]");
  assert(completed.data.output_text === "hi", `text wrong: '${completed.data.output_text}'`);
});

test("partial event in the middle of a stream is preserved", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const fullEvent = makeOpenAiChunks([{ delta: { content: "tail" }, finish_reason: "stop" }]);
  const cutoff = fullEvent.length - 5; // chop the last few bytes
  const head = fullEvent.slice(0, cutoff);
  const tail = fullEvent.slice(cutoff);
  const out = [];
  for (const ev of bridge.transformChunk(head)) out.push(ev);
  for (const ev of bridge.transformChunk(tail)) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const completed = parseEvents(out.join("")).find((e) => e.name === "response.completed");
  assert(completed.data.output_text === "tail", `text wrong: '${completed.data.output_text}'`);
});

test("Anthropic text + thinking deltas are accumulated separately", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const raw = [
    anthropicEvent({ type: "message_start", message: { model: "claude", usage: { input_tokens: 1, output_tokens: 0 } } }),
    anthropicEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    anthropicEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } }),
    anthropicEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " there" } }),
    anthropicEvent({ type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } }),
    anthropicEvent({ type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "hmm" } }),
    anthropicEvent({ type: "message_delta", usage: { output_tokens: 5 } }),
    anthropicEvent({ type: "message_stop" })
  ].join("\n\n") + "\n\n";
  const out = [];
  for (const ev of bridge.transformAnthropicRaw(raw)) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const completed = parseEvents(out.join("")).find((e) => e.name === "response.completed");
  const reasoning = completed.data.output.find((item) => item.type === "reasoning");
  const message = completed.data.output.find((item) => item.type === "message");
  assert(reasoning && reasoning.summary[0].text === "hmm", `anthropic thinking wrong: '${reasoning?.summary[0]?.text}'`);
  assert(message && message.content[0].text === "Hello there", `anthropic text wrong: '${message?.content[0]?.text}'`);
  assert(completed.data.model === "claude", `model should propagate from anthropic message_start, got '${completed.data.model}'`);
});

test("OpenAI tool_calls stream as Responses function_call output items", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { tool_calls: [{ index: 0, id: "call_lookup", type: "function", function: { name: "lookup", arguments: "" } }] } },
    { delta: { tool_calls: [{ index: 0, function: { arguments: "{\"q\":" } }] } },
    { delta: { tool_calls: [{ index: 0, function: { arguments: "\"hi\"}" } }] }, finish_reason: "tool_calls" }
  ]))) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);

  const events = parseEvents(out.join(""));
  const added = events.find((e) => e.name === "response.output_item.added" && e.data.item?.type === "function_call");
  assert(added, "function_call output item should be added");
  assert(added.data.item.name === "lookup", `function name wrong: '${added.data.item.name}'`);
  assert(added.data.item.call_id === "call_lookup", `call_id wrong: '${added.data.item.call_id}'`);

  const argDeltas = events.filter((e) => e.name === "response.function_call_arguments.delta");
  assert(argDeltas.map((e) => e.data.delta).join("") === "{\"q\":\"hi\"}", "function_call argument deltas should join to final JSON");
  const argsDone = events.find((e) => e.name === "response.function_call_arguments.done");
  assert(argsDone && argsDone.data.arguments === "{\"q\":\"hi\"}", `function_call arguments done wrong: '${argsDone?.data?.arguments}'`);
  assert(!events.some((e) => e.name === "response.output_text.done"), "tool-only stream should not emit output_text.done");

  const completed = events.find((e) => e.name === "response.completed");
  const call = completed.data.output.find((item) => item.type === "function_call");
  assert(call, "completed snapshot should include function_call item");
  assert(call.name === "lookup", `completed function name wrong: '${call.name}'`);
  assert(call.arguments === "{\"q\":\"hi\"}", `completed arguments wrong: '${call.arguments}'`);
});

test("Anthropic tool_use stream maps to Responses function_call output items", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const raw = [
    anthropicEvent({ type: "message_start", message: { model: "claude", usage: { input_tokens: 1, output_tokens: 0 } } }),
    anthropicEvent({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_lookup", name: "lookup", input: {} } }),
    anthropicEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":" } }),
    anthropicEvent({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"hi\"}" } }),
    anthropicEvent({ type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }),
    anthropicEvent({ type: "message_stop" })
  ].join("\n\n") + "\n\n";
  const out = [];
  for (const ev of bridge.transformAnthropicRaw(raw)) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);

  const events = parseEvents(out.join(""));
  const added = events.find((e) => e.name === "response.output_item.added" && e.data.item?.type === "function_call");
  assert(added, "anthropic tool_use should add function_call output item");
  assert(added.data.item.id === "toolu_lookup", `function_call id wrong: '${added.data.item.id}'`);
  assert(added.data.item.name === "lookup", `function_call name wrong: '${added.data.item.name}'`);

  const argsDone = events.find((e) => e.name === "response.function_call_arguments.done");
  assert(argsDone && argsDone.data.arguments === "{\"q\":\"hi\"}", `anthropic args done wrong: '${argsDone?.data?.arguments}'`);
  assert(!events.some((e) => e.name === "response.output_text.done"), "tool-only anthropic stream should not emit output_text.done");

  const completed = events.find((e) => e.name === "response.completed");
  const call = completed.data.output.find((item) => item.type === "function_call");
  assert(call && call.call_id === "toolu_lookup", `completed call_id wrong: '${call?.call_id}'`);
  assert(call.arguments === "{\"q\":\"hi\"}", `completed arguments wrong: '${call.arguments}'`);
  assert(completed.data.model === "claude", `model should propagate from anthropic stream, got '${completed.data.model}'`);
});

test("usage from final chunk is included in completed event", () => {
  const bridge = createResponsesSseBridge({ requestModel: "m" });
  const out = [];
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { content: "x" } },
    { delta: {}, finish_reason: "stop", usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 } }
  ]))) out.push(ev);
  for (const ev of bridge.finalize()) out.push(ev);
  const completed = parseEvents(out.join("")).find((e) => e.name === "response.completed");
  assert(completed.data.usage, "usage should be present in completed event");
  assert(completed.data.usage.total_tokens === 10, `usage total_tokens wrong: ${completed.data.usage.total_tokens}`);
});

test("onUsage callback fires on finalize", () => {
  let captured = null;
  const bridge = createResponsesSseBridge({ requestModel: "m", onUsage: (u) => { captured = u; } });
  for (const ev of bridge.transformChunk(makeOpenAiChunks([
    { delta: { content: "x" } },
    { delta: {}, finish_reason: "stop", usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } }
  ]))) { /* discard */ }
  bridge.finalize();
  assert(captured, "onUsage should fire");
  assert(captured.total_tokens === 3, `onUsage total_tokens wrong: ${captured.total_tokens}`);
});

function makeOpenAiChunks(chunks) {
  return chunks.map((c) => {
    return "data: " + JSON.stringify({
      id: "c1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [{ index: 0, delta: c.delta || {}, finish_reason: c.finish_reason || null }],
      ...(c.usage ? { usage: c.usage } : {})
    }) + "\n\n";
  }).join("");
}

function anthropicEvent(event) {
  return "data: " + JSON.stringify(event);
}

// --- runner ---

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.fn();
    passed += 1;
    console.log(`  ✓ ${t.name}`);
  } catch (error) {
    failed += 1;
    console.log(`  ✗ ${t.name}`);
    console.log(`    ${error.message}`);
  }
}
console.log("");
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
