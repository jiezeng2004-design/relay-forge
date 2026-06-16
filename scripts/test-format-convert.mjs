// Unit tests for the format-convert helpers.
// Run: node scripts/test-format-convert.mjs

import {
  anthropicResponseToOpenAi,
  anthropicResponseToResponses,
  anthropicToOpenAi,
  extractTextContent,
  normalizeAnthropicContent,
  openAiResponseToAnthropic,
  openAiResponseToResponses,
  openAiToAnthropic,
  responsesInputToMessages,
  responsesToChatPayload
} from "../src/format-convert.js";

const tests = [];
const fail = (message) => { throw new Error(message); };
const assert = (condition, message) => { if (!condition) fail(message); };
const assertEqual = (actual, expected, message) => {
  if (actual !== expected) fail(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
};

function test(name, fn) { tests.push({ name, fn }); }

test("openAiToAnthropic strips system messages into the system field", () => {
  const out = openAiToAnthropic({
    messages: [
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" }
    ],
    max_tokens: 32,
    temperature: 0.2
  }, "claude-x");
  assertEqual(out.system, "be brief", "system field");
  assertEqual(out.max_tokens, 32, "max_tokens pass-through");
  assertEqual(out.temperature, 0.2, "temperature pass-through");
  assertEqual(out.messages.length, 1, "user message preserved");
  assertEqual(out.messages[0].role, "user", "user role mapped");
});

test("openAiToAnthropic forwards tools as input_schema", () => {
  const out = openAiToAnthropic({
    messages: [{ role: "user", content: "what's the weather?" }],
    tools: [{
      type: "function",
      function: { name: "get_weather", description: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } }
    }],
    tool_choice: { type: "function", function: { name: "get_weather" } }
  }, "claude-x");
  assert(Array.isArray(out.tools), "tools should be present");
  assertEqual(out.tools[0].name, "get_weather", "tool name");
  assertEqual(out.tools[0].input_schema.type, "object", "tool input_schema");
  assertEqual(out.tool_choice.type, "tool", "tool_choice type");
  assertEqual(out.tool_choice.name, "get_weather", "tool_choice name");
});

test("openAiToAnthropic maps assistant tool_calls and tool results", () => {
  const out = openAiToAnthropic({
    messages: [
      { role: "user", content: "weather in sf?" },
      {
        role: "assistant",
        content: "checking",
        tool_calls: [{
          id: "call_weather",
          type: "function",
          function: { name: "get_weather", arguments: "{\"city\":\"sf\"}" }
        }]
      },
      { role: "tool", tool_call_id: "call_weather", content: "{\"temp\":18}" }
    ],
    tools: [{
      type: "function",
      function: { name: "get_weather", parameters: { type: "object", properties: {} } }
    }],
    tool_choice: "required"
  }, "claude-x");

  assertEqual(out.tool_choice.type, "any", "required tool_choice maps to any");
  assertEqual(out.messages.length, 3, "three messages preserved");
  assertEqual(out.messages[1].role, "assistant", "assistant role preserved");
  assertEqual(out.messages[1].content[0].type, "text", "assistant text block");
  assertEqual(out.messages[1].content[1].type, "tool_use", "assistant tool_use block");
  assertEqual(out.messages[1].content[1].id, "call_weather", "tool_use id preserved");
  assertEqual(out.messages[1].content[1].name, "get_weather", "tool_use name preserved");
  assertEqual(out.messages[1].content[1].input.city, "sf", "tool_use args parsed");
  assertEqual(out.messages[2].role, "user", "tool result maps to user role");
  assertEqual(out.messages[2].content[0].type, "tool_result", "tool_result block");
  assertEqual(out.messages[2].content[0].tool_use_id, "call_weather", "tool_result id preserved");
  assertEqual(out.messages[2].content[0].content, "{\"temp\":18}", "tool_result content preserved");
});

test("anthropicToOpenAi returns tool_calls when content has tool_use", () => {
  const out = anthropicToOpenAi({
    system: "be helpful",
    messages: [
      { role: "user", content: "what's the weather?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "let me check" },
          { type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "sf" } }
        ]
      }
    ],
    max_tokens: 64
  }, "claude-x");
  assertEqual(out.messages[0].role, "system", "system mapped to system message");
  assertEqual(out.messages[1].role, "user", "user mapped");
  assertEqual(out.messages[2].role, "assistant", "assistant mapped");
  assertEqual(out.messages[2].content, "let me check", "text content joined");
  assert(Array.isArray(out.messages[2].tool_calls), "tool_calls present");
  assertEqual(out.messages[2].tool_calls[0].function.name, "get_weather", "tool call name");
  assertEqual(out.messages[2].tool_calls[0].function.arguments, JSON.stringify({ city: "sf" }), "tool call args json-encoded");
});

test("openAiResponseToAnthropic preserves tool_use blocks", () => {
  const out = openAiResponseToAnthropic({
    id: "x",
    model: "gpt-x",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "ok",
        tool_calls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{\"a\":1}" } }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2 }
  });
  const blocks = out.content;
  assertEqual(blocks.length, 2, "should have text + tool_use");
  assertEqual(blocks[0].type, "text", "first block is text");
  assertEqual(blocks[0].text, "ok", "text content");
  assertEqual(blocks[1].type, "tool_use", "second block is tool_use");
  assertEqual(blocks[1].name, "f", "tool_use name");
  assertEqual(blocks[1].input.a, 1, "tool_use input parsed back to object");
});

test("anthropicResponseToOpenAi returns tool_calls and omits content when only tools", () => {
  const out = anthropicResponseToOpenAi({
    id: "msg_x",
    model: "claude-x",
    content: [{ type: "tool_use", id: "toolu_1", name: "get_weather", input: { city: "sf" } }],
    stop_reason: "tool_use",
    usage: { input_tokens: 3, output_tokens: 4 }
  });
  const message = out.choices[0].message;
  assertEqual(message.role, "assistant", "assistant role");
  assertEqual(message.content, null, "content null when only tool_calls");
  assertEqual(message.tool_calls[0].function.name, "get_weather", "tool name");
  assertEqual(message.tool_calls[0].function.arguments, JSON.stringify({ city: "sf" }), "tool args stringified");
  assertEqual(out.usage.total_tokens, 7, "total tokens summed");
});

test("openAiResponseToResponses builds output_text and tool_call items", () => {
  const out = openAiResponseToResponses({
    id: "resp_1",
    model: "gpt-x",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: "hello",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "echo", arguments: "{\"x\":1}" } }]
      },
      finish_reason: "tool_calls"
    }],
    usage: { prompt_tokens: 1, completion_tokens: 2 }
  });
  assertEqual(out.object, "response", "object is response");
  assertEqual(out.output_text, "hello", "top-level output_text");
  const text = out.output.find((item) => item.type === "message");
  const call = out.output.find((item) => item.type === "function_call");
  assert(text, "message output present");
  assert(call, "function_call output present");
  assertEqual(call.name, "echo", "function_call name");
  assertEqual(call.arguments, "{\"x\":1}", "function_call arguments");
});

test("anthropicResponseToResponses builds text and tool_call items", () => {
  const out = anthropicResponseToResponses({
    id: "msg_1",
    model: "claude-x",
    content: [
      { type: "text", text: "ok" },
      { type: "tool_use", id: "toolu_9", name: "f", input: { a: 1 } }
    ],
    usage: { input_tokens: 2, output_tokens: 3 }
  });
  const text = out.output.find((item) => item.type === "message");
  const call = out.output.find((item) => item.type === "function_call");
  assert(text, "message output present");
  assertEqual(text.content[0].text, "ok", "message text");
  assert(call, "function_call output present");
  assertEqual(call.name, "f", "function_call name");
  assertEqual(call.arguments, JSON.stringify({ a: 1 }), "function_call arguments stringified");
});

test("openAiResponseToResponses surfaces reasoning as a reasoning item", () => {
  const out = openAiResponseToResponses({
    id: "resp_2",
    model: "o1",
    choices: [{
      index: 0,
      message: { role: "assistant", content: "answer", reasoning: "thinking step 1" },
      finish_reason: "stop"
    }],
    usage: { prompt_tokens: 0, completion_tokens: 0 }
  });
  const reasoning = out.output.find((item) => item.type === "reasoning");
  assert(reasoning, "reasoning item present");
  assertEqual(reasoning.summary[0].text, "thinking step 1", "reasoning summary text");
  assertEqual(out.output_text, "answer", "final text still exposed");
});

test("responsesInputToMessages maps string + array shapes and tool_call role", () => {
  const stringInput = responsesInputToMessages("hi");
  assertEqual(stringInput.length, 1, "string input -> 1 message");
  assertEqual(stringInput[0].role, "user", "string input role");

  const arrayInput = responsesInputToMessages([
    { role: "user", content: [{ type: "input_text", text: "ask" }] },
    { role: "assistant", content: "", tool_calls: [{ id: "c1", name: "f", arguments: "{}" }] }
  ]);
  assertEqual(arrayInput.length, 2, "array input -> 2 messages");
  assertEqual(arrayInput[0].content, "ask", "input_text extracted");
  assertEqual(arrayInput[1].role, "assistant", "assistant role");
  assertEqual(arrayInput[1].tool_calls[0].function.name, "f", "tool_calls function name");
});

test("responsesInputToMessages maps canonical function_call and function_call_output items", () => {
  const messages = responsesInputToMessages([
    { type: "message", role: "user", content: [{ type: "input_text", text: "weather?" }] },
    { type: "function_call", call_id: "call_weather", name: "get_weather", arguments: "{\"city\":\"sf\"}" },
    { type: "function_call_output", call_id: "call_weather", output: "{\"temp\":18}" }
  ]);
  assertEqual(messages.length, 3, "three messages");
  assertEqual(messages[0].role, "user", "first message is user");
  assertEqual(messages[0].content, "weather?", "user input_text extracted");
  assertEqual(messages[1].role, "assistant", "function_call becomes assistant message");
  assertEqual(messages[1].tool_calls[0].id, "call_weather", "call id preserved");
  assertEqual(messages[1].tool_calls[0].function.name, "get_weather", "function name preserved");
  assertEqual(messages[1].tool_calls[0].function.arguments, "{\"city\":\"sf\"}", "function arguments preserved");
  assertEqual(messages[2].role, "tool", "function_call_output becomes tool message");
  assertEqual(messages[2].tool_call_id, "call_weather", "tool result call id preserved");
  assertEqual(messages[2].content, "{\"temp\":18}", "tool result output preserved");
});

test("responsesToChatPayload forwards instructions, tools, tool_choice, and stream flag", () => {
  const out = responsesToChatPayload({
    model: "m",
    instructions: "be brief",
    input: "hi",
    stream: true,
    max_output_tokens: 64,
    tools: [{
      type: "function",
      name: "get_weather",
      description: "weather",
      parameters: { type: "object", properties: { city: { type: "string" } } },
      strict: true
    }],
    tool_choice: { type: "function", name: "get_weather" }
  });
  assertEqual(out.messages[0].role, "system", "instructions -> system");
  assertEqual(out.messages[0].content, "be brief", "system content");
  assertEqual(out.messages[1].role, "user", "input -> user");
  assertEqual(out.stream, true, "stream flag forwarded");
  assertEqual(out.max_tokens, 64, "max_output_tokens -> max_tokens");
  assertEqual(out.tools[0].type, "function", "tool type");
  assertEqual(out.tools[0].function.name, "get_weather", "Responses tool normalized to Chat function tool");
  assertEqual(out.tools[0].function.strict, true, "strict preserved");
  assertEqual(out.tool_choice.function.name, "get_weather", "tool_choice normalized to Chat shape");
});

test("normalizeAnthropicContent maps image_url to anthropic image block", () => {
  const out = normalizeAnthropicContent([
    { type: "image_url", image_url: { url: "https://example/cat.png" } }
  ]);
  assertEqual(out[0].type, "image", "image block type");
  assertEqual(out[0].source.url, "https://example/cat.png", "image source url");
});

test("extractTextContent tolerates string, array of strings, and array of objects", () => {
  assertEqual(extractTextContent("hi"), "hi", "string passthrough");
  assertEqual(extractTextContent(["a", "b"]), "ab", "string array");
  assertEqual(extractTextContent([{ type: "text", text: "x" }, { type: "text", text: "y" }]), "xy", "object array");
  assertEqual(extractTextContent({ text: "z" }), "z", "object with text");
  assertEqual(extractTextContent(null), "", "null -> empty string");
});

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
