import { buildLocalConnectorAvailability } from "../src/local-connector-availability.js";

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}
function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function stubCommandExists(availableCommands) {
  return function (name) {
    return availableCommands.includes(name);
  };
}

test("buildLocalConnectorAvailability returns exactly 11 connectors", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  assertEqual(result.connectors.length, 11, "connector count is 11");
  assertEqual(result.summary.total, 11, "summary total is 11");
});

test("all required connector ids are present", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  const ids = result.connectors.map((c) => c.id).sort();
  const expected = [
    "antigravity", "claude-code", "claude-desktop", "gemini-cli",
    "kiro", "opencode", "openai-codex", "qclaw", "rovo-dev",
    "vscode-copilot", "windsurf"
  ].sort();
  assertEqual(JSON.stringify(ids), JSON.stringify(expected), "all 11 connector ids match");
});

test("injected command resolver marks CLI connectors as available", () => {
  const result = buildLocalConnectorAvailability({
    platform: "windows",
    commandExists: stubCommandExists(["opencode", "opencode.cmd", "codex", "codex.cmd"])
  });
  for (const c of result.connectors) {
    if (c.id === "opencode") {
      assertEqual(c.availability, "available", "opencode is available");
      assert(c.evidence.includes("command_found"), "opencode has command_found evidence");
    }
    if (c.id === "openai-codex") {
      assertEqual(c.availability, "available", "openai-codex is available");
    }
    if (c.id === "gemini-cli") {
      assertEqual(c.availability, "not_found", "gemini-cli not found");
    }
  }
});

test("missing commands become not_found", () => {
  const result = buildLocalConnectorAvailability({
    platform: "windows",
    commandExists: stubCommandExists([])
  });
  for (const c of result.connectors) {
    if (c.id === "opencode") {
      assertEqual(c.availability, "not_found", "opencode not found with empty PATH");
      assert(c.evidence.includes("command_missing"), "opencode has command_missing evidence");
    }
  }
});

test("unsupported platform handled", () => {
  const result = buildLocalConnectorAvailability({
    platform: "linux",
    commandExists: stubCommandExists([])
  });
  for (const c of result.connectors) {
    if (c.id === "claude-desktop") {
      assertEqual(c.availability, "unsupported_platform", "claude-desktop unsupported on linux");
      assert(c.evidence.includes("platform_unsupported"), "claude-desktop has platform_unsupported evidence");
    }
  }
});

test("manual-review connectors become unknown", () => {
  const result = buildLocalConnectorAvailability({
    platform: "windows",
    commandExists: stubCommandExists([])
  });
  for (const c of result.connectors) {
    if (c.id === "kiro" || c.id === "windsurf" || c.id === "antigravity" || c.id === "vscode-copilot" || c.id === "rovo-dev") {
      assertEqual(c.availability, "unknown", `${c.id} is unknown`);
      assert(c.evidence.includes("manual_review_required"), `${c.id} has manual_review_required evidence`);
    }
  }
});

test("summary counts are correct", () => {
  const result = buildLocalConnectorAvailability({
    platform: "windows",
    commandExists: stubCommandExists(["opencode", "opencode.cmd", "codex", "codex.cmd", "gemini", "gemini.cmd", "claude", "claude.cmd", "qclaw", "qclaw.cmd"])
  });
  assertEqual(result.summary.total, 11, "total is 11");
  assertEqual(result.summary.available, 6, "6 available (5 CLI + claude-desktop)");
  assertEqual(result.summary.notFound, 0, "no not found");
  assertEqual(result.summary.unsupportedPlatform, 0, "no unsupported on windows");
  assertEqual(result.summary.unknown, 5, "5 unknown (kiro, windsurf, antigravity, vscode-copilot, rovo-dev)");
});

test("no connector includes absolute paths", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  const json = JSON.stringify(result);
  assert(!/[A-Z]:\\/.test(json), "no Windows absolute paths");
  assert(!/\/home\/\w+/.test(json), "no /home paths");
  assert(!/\/Users\/\w+/.test(json), "no /Users paths");
  assert(!/\/tmp\//.test(json), "no /tmp paths");
});

test("safety booleans all false for credential/config/listener/path disclosure", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  for (const c of result.connectors) {
    const s = c.safety;
    assert(s.dryRunOnly === true, `${c.id} dryRunOnly`);
    assert(s.readsTokens === false, `${c.id} readsTokens false`);
    assert(s.readsCookies === false, `${c.id} readsCookies false`);
    assert(s.readsSessionStorage === false, `${c.id} readsSessionStorage false`);
    assert(s.readsBrowserProfiles === false, `${c.id} readsBrowserProfiles false`);
    assert(s.readsIdeCredentials === false, `${c.id} readsIdeCredentials false`);
    assert(s.modifiesConfig === false, `${c.id} modifiesConfig false`);
    assert(s.writesSystemEnv === false, `${c.id} writesSystemEnv false`);
    assert(s.startsNetworkListener === false, `${c.id} startsNetworkListener false`);
    assert(s.startsProcess === false, `${c.id} startsProcess false`);
    assert(s.disclosesPaths === false, `${c.id} disclosesPaths false`);
  }
});

test("generatedAt can be injected", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildLocalConnectorAvailability({ generatedAt: fixed, commandExists: stubCommandExists([]) });
  assertEqual(result.generatedAt, fixed, "generatedAt injected");
});

test("version can be injected", () => {
  const result = buildLocalConnectorAvailability({ version: "0.3.16-test", commandExists: stubCommandExists([]) });
  assertEqual(result.version, "0.3.16-test", "version injected");
});

test("mode is dry-run, dryRunOnly is true", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assert(result.dryRunOnly === true, "dryRunOnly is true");
});

test("pathsDisclosed and processesStarted are 0 in summary", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  assertEqual(result.summary.pathsDisclosed, 0, "pathsDisclosed is 0");
  assertEqual(result.summary.processesStarted, 0, "processesStarted is 0");
});

test("claude-desktop is available on windows (platform_only)", () => {
  const result = buildLocalConnectorAvailability({
    platform: "windows",
    commandExists: stubCommandExists([])
  });
  for (const c of result.connectors) {
    if (c.id === "claude-desktop") {
      assertEqual(c.availability, "available", "claude-desktop available on windows");
      assert(c.evidence.includes("platform_supported"), "claude-desktop has platform_supported");
    }
  }
});

test("probeType is preserved in each connector", () => {
  const result = buildLocalConnectorAvailability({ commandExists: stubCommandExists([]) });
  for (const c of result.connectors) {
    assert(typeof c.probeType === "string" && c.probeType.length > 0, `${c.id} has probeType`);
  }
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
