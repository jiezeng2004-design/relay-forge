import { buildLocalConnectorProviderPreview } from "../src/local-connector-provider-preview.js";

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

test("buildLocalConnectorProviderPreview returns exactly 11 providers", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  assertEqual(result.providers.length, 11, "provider count is 11");
  assertEqual(result.summary.total, 11, "summary total is 11");
});

test("all required connector ids are present", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  const ids = result.providers.map((p) => p.id).sort();
  const expected = [
    "antigravity", "claude-code", "claude-desktop", "gemini-cli",
    "kiro", "opencode", "openai-codex", "qclaw", "rovo-dev",
    "vscode-copilot", "windsurf"
  ].sort();
  assertEqual(JSON.stringify(ids), JSON.stringify(expected), "all 11 connector ids match");
});

test("injected command resolver marks CLI connectors as credential_consent_required", () => {
  const result = buildLocalConnectorProviderPreview({
    platform: "windows",
    commandExists: stubCommandExists(["opencode", "opencode.cmd", "codex", "codex.cmd"])
  });
  for (const p of result.providers) {
    if (p.id === "opencode") {
      assertEqual(p.readiness, "credential_consent_required", "opencode is credential_consent_required");
      assert(p.blockers.includes("credential_consent_required"), "opencode blocker present");
    }
    if (p.id === "openai-codex") {
      assertEqual(p.readiness, "credential_consent_required", "openai-codex is credential_consent_required");
    }
    if (p.id === "gemini-cli") {
      assertEqual(p.readiness, "blocked_missing_tool", "gemini-cli is blocked_missing_tool");
      assert(p.blockers.includes("command_missing"), "gemini-cli has command_missing blocker");
    }
  }
});

test("missing commands become blocked_missing_tool", () => {
  const result = buildLocalConnectorProviderPreview({
    platform: "windows",
    commandExists: stubCommandExists([])
  });
  for (const p of result.providers) {
    if (p.id === "opencode") {
      assertEqual(p.readiness, "blocked_missing_tool", "opencode blocked_missing_tool with empty PATH");
      assert(p.blockers.includes("command_missing"), "opencode has command_missing blocker");
    }
  }
});

test("unsupported platform becomes blocked_unsupported_platform", () => {
  const result = buildLocalConnectorProviderPreview({
    platform: "linux",
    commandExists: stubCommandExists([])
  });
  for (const p of result.providers) {
    if (p.id === "claude-desktop") {
      assertEqual(p.readiness, "blocked_unsupported_platform", "claude-desktop blocked on linux");
      assert(p.blockers.includes("platform_unsupported"), "claude-desktop has platform_unsupported blocker");
    }
  }
});

test("manual-review connectors become needs_manual_review", () => {
  const result = buildLocalConnectorProviderPreview({
    platform: "windows",
    commandExists: stubCommandExists([])
  });
  for (const p of result.providers) {
    if (p.id === "kiro" || p.id === "windsurf" || p.id === "antigravity" || p.id === "vscode-copilot" || p.id === "rovo-dev") {
      assertEqual(p.readiness, "needs_manual_review", `${p.id} is needs_manual_review`);
      assert(p.blockers.includes("manual_review_required"), `${p.id} has manual_review_required blocker`);
    }
  }
});

test("summary counts are correct", () => {
  const result = buildLocalConnectorProviderPreview({
    platform: "windows",
    commandExists: stubCommandExists(["opencode", "opencode.cmd", "codex", "codex.cmd", "gemini", "gemini.cmd", "claude", "claude.cmd", "qclaw", "qclaw.cmd"])
  });
  assertEqual(result.summary.total, 11, "total is 11");
  assertEqual(result.summary.previewReady, 6, "previewReady is 6 (5 CLI found + claude-desktop)");
  assertEqual(result.summary.blocked, 0, "blocked is 0");
  assertEqual(result.summary.needsManualReview, 5, "needsManualReview is 5 (kiro, windsurf, antigravity, vscode-copilot, rovo-dev)");
  assertEqual(result.summary.credentialConsentRequired, 11, "credentialConsentRequired is 11 (all connectors require eventual consent)");
});

test("routesRegistered is 0 in summary", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  assertEqual(result.summary.routesRegistered, 0, "routesRegistered is 0");
});

test("no provider includes absolute paths, token-like values, credential filenames, or command execution strings", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  const json = JSON.stringify(result);
  assert(!/[A-Z]:\\/.test(json), "no Windows absolute paths");
  assert(!/\/home\/\w+/.test(json), "no /home paths");
  assert(!/\/Users\/\w+/.test(json), "no /Users paths");
  assert(!/\/tmp\//.test(json), "no /tmp paths");
  assert(!/sk-[A-Za-z0-9]{16,}/.test(json), "no sk- token patterns");
  assert(!/eyJ[A-Za-z0-9_-]{10,}/.test(json), "no JWT-like token values");
  assert(!json.includes("master.key"), "no master.key filename");
});

test("safety booleans all false for credential/config/listener/process/path disclosure/route registration", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  for (const p of result.providers) {
    const s = p.safety;
    assert(s.dryRunOnly === true, `${p.id} dryRunOnly`);
    assert(s.readsTokens === false, `${p.id} readsTokens false`);
    assert(s.readsCookies === false, `${p.id} readsCookies false`);
    assert(s.readsSessionStorage === false, `${p.id} readsSessionStorage false`);
    assert(s.readsBrowserProfiles === false, `${p.id} readsBrowserProfiles false`);
    assert(s.readsIdeCredentials === false, `${p.id} readsIdeCredentials false`);
    assert(s.modifiesConfig === false, `${p.id} modifiesConfig false`);
    assert(s.writesSystemEnv === false, `${p.id} writesSystemEnv false`);
    assert(s.startsNetworkListener === false, `${p.id} startsNetworkListener false`);
    assert(s.startsProcess === false, `${p.id} startsProcess false`);
    assert(s.disclosesPaths === false, `${p.id} disclosesPaths false`);
    assert(s.registersRoutes === false, `${p.id} registersRoutes false`);
  }
});

test("registered is always false for all providers", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  for (const p of result.providers) {
    assert(p.registered === false, `${p.id} registered is false`);
  }
});

test("credentialStatus is not_checked for all providers", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  for (const p of result.providers) {
    assertEqual(p.credentialStatus, "not_checked", `${p.id} credentialStatus is not_checked`);
  }
});

test("each provider has non-empty requiredConsent", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  for (const p of result.providers) {
    assert(Array.isArray(p.requiredConsent) && p.requiredConsent.length > 0, `${p.id} has requiredConsent`);
  }
});

test("each provider has providerName, directRoute, apiFormats, upstreamQuotaSource, modelHints", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  for (const p of result.providers) {
    assert(typeof p.providerName === "string" && p.providerName.length > 0, `${p.id} has providerName`);
    assert(typeof p.directRoute === "string" && p.directRoute.length > 0, `${p.id} has directRoute`);
    assert(Array.isArray(p.apiFormats) && p.apiFormats.length > 0, `${p.id} has apiFormats`);
    assert(typeof p.upstreamQuotaSource === "string" && p.upstreamQuotaSource.length > 0, `${p.id} has upstreamQuotaSource`);
    assert(Array.isArray(p.modelHints) && p.modelHints.length > 0, `${p.id} has modelHints`);
  }
});

test("generatedAt can be injected", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildLocalConnectorProviderPreview({ generatedAt: fixed, commandExists: stubCommandExists([]) });
  assertEqual(result.generatedAt, fixed, "generatedAt injected");
});

test("version can be injected", () => {
  const result = buildLocalConnectorProviderPreview({ version: "0.3.17-test", commandExists: stubCommandExists([]) });
  assertEqual(result.version, "0.3.17-test", "version injected");
});

test("default version is 0.3.17", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  assertEqual(result.version, "0.3.17", "default version is 0.3.17");
});

test("mode is dry-run, dryRunOnly is true", () => {
  const result = buildLocalConnectorProviderPreview({ commandExists: stubCommandExists([]) });
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assert(result.dryRunOnly === true, "dryRunOnly is true");
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
