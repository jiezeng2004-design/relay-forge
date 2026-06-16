import { buildLocalConnectorConsentManifest } from "../src/local-connector-consent-manifest.js";

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

test("buildLocalConnectorConsentManifest returns exactly 11 manifests", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  assertEqual(result.manifests.length, 11, "manifest count is 11");
  assertEqual(result.summary.total, 11, "summary total is 11");
});

test("all required connector ids are present", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  const ids = result.manifests.map((m) => m.id).sort();
  const expected = [
    "antigravity", "claude-code", "claude-desktop", "gemini-cli",
    "kiro", "opencode", "openai-codex", "qclaw", "rovo-dev",
    "vscode-copilot", "windsurf"
  ].sort();
  assertEqual(JSON.stringify(ids), JSON.stringify(expected), "all 11 connector ids match");
});

test("summary states no consent is approved or stored in dry-run mode", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists(["opencode", "opencode.cmd"]) });
  assertEqual(result.summary.consentRequired, 11, "consentRequired is 11");
  assertEqual(result.summary.approved, 0, "approved is 0");
  assertEqual(result.summary.canProceed, 0, "canProceed is 0");
  assertEqual(result.summary.blocked, 11, "blocked is 11");
  assertEqual(result.summary.consentStored, 0, "consentStored is 0");
});

test("each manifest remains not_requested and not_approved", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists(["opencode", "opencode.cmd"]) });
  for (const m of result.manifests) {
    assertEqual(m.consentStatus, "not_requested", `${m.id} consentStatus`);
    assertEqual(m.approvalState, "not_approved", `${m.id} approvalState`);
    assertEqual(m.canProceed, false, `${m.id} canProceed false`);
    assert(m.blockers.includes("explicit_user_consent_required"), `${m.id} explicit consent blocker`);
    assert(m.blockers.includes("security_review_required"), `${m.id} security review blocker`);
  }
});

test("availability and readiness are inherited from provider preview", () => {
  const result = buildLocalConnectorConsentManifest({
    platform: "windows",
    commandExists: stubCommandExists(["opencode", "opencode.cmd"])
  });
  const opencode = result.manifests.find((m) => m.id === "opencode");
  const gemini = result.manifests.find((m) => m.id === "gemini-cli");
  const kiro = result.manifests.find((m) => m.id === "kiro");
  assertEqual(opencode.availability, "available", "opencode availability");
  assertEqual(opencode.readiness, "credential_consent_required", "opencode readiness");
  assertEqual(gemini.availability, "not_found", "gemini availability");
  assertEqual(gemini.readiness, "blocked_missing_tool", "gemini readiness");
  assertEqual(kiro.availability, "unknown", "kiro availability");
  assertEqual(kiro.readiness, "needs_manual_review", "kiro readiness");
});

test("unsupported platform remains blocked with platform blocker", () => {
  const result = buildLocalConnectorConsentManifest({ platform: "linux", commandExists: stubCommandExists([]) });
  const claudeDesktop = result.manifests.find((m) => m.id === "claude-desktop");
  assertEqual(claudeDesktop.availability, "unsupported_platform", "claude-desktop unsupported on linux");
  assert(claudeDesktop.blockers.includes("platform_unsupported"), "platform_unsupported blocker present");
});

test("risk and credential scopes are connector specific", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  const opencode = result.manifests.find((m) => m.id === "opencode");
  const gemini = result.manifests.find((m) => m.id === "gemini-cli");
  const copilot = result.manifests.find((m) => m.id === "vscode-copilot");
  assertEqual(opencode.credentialScope, "cli_config", "opencode scope");
  assertEqual(opencode.riskLevel, "medium", "opencode risk");
  assertEqual(gemini.credentialScope, "cli_oauth", "gemini scope");
  assertEqual(copilot.credentialScope, "ide_session", "copilot scope");
});

test("required consent and forbidden actions are explicit", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  for (const m of result.manifests) {
    assert(m.requiredConsent.includes("approve_one_time_credential_read"), `${m.id} requires credential read approval`);
    assert(m.requiredConsent.includes("approve_provider_registration"), `${m.id} requires provider registration approval`);
    assert(m.forbiddenNow.includes("read_tokens"), `${m.id} forbids token reads`);
    assert(m.forbiddenNow.includes("return_local_paths"), `${m.id} forbids path disclosure`);
    assert(m.forbiddenNow.includes("register_provider_route"), `${m.id} forbids route registration`);
  }
});

test("safety booleans prevent credential/config/listener/process/path/route/consent writes", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  assert(result.safety.dryRunOnly === true, "top-level dryRunOnly");
  assert(result.safety.storesConsent === false, "top-level storesConsent false");
  for (const m of result.manifests) {
    const s = m.safety;
    assert(s.dryRunOnly === true, `${m.id} dryRunOnly`);
    assert(s.readsTokens === false, `${m.id} readsTokens false`);
    assert(s.readsCookies === false, `${m.id} readsCookies false`);
    assert(s.readsSessionStorage === false, `${m.id} readsSessionStorage false`);
    assert(s.readsBrowserProfiles === false, `${m.id} readsBrowserProfiles false`);
    assert(s.readsIdeCredentials === false, `${m.id} readsIdeCredentials false`);
    assert(s.readsKeychain === false, `${m.id} readsKeychain false`);
    assert(s.returnsLocalPaths === false, `${m.id} returnsLocalPaths false`);
    assert(s.modifiesConfig === false, `${m.id} modifiesConfig false`);
    assert(s.writesSystemEnv === false, `${m.id} writesSystemEnv false`);
    assert(s.startsNetworkListener === false, `${m.id} startsNetworkListener false`);
    assert(s.startsProcess === false, `${m.id} startsProcess false`);
    assert(s.registersRoutes === false, `${m.id} registersRoutes false`);
    assert(s.storesConsent === false, `${m.id} storesConsent false`);
  }
});

test("no manifest includes paths, token-like values, credential filenames, or command execution strings", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists(["opencode", "opencode.cmd"]) });
  const json = JSON.stringify(result);
  assert(!/[A-Z]:\\/.test(json), "no Windows absolute paths");
  assert(!/\/home\/\w+/.test(json), "no /home paths");
  assert(!/\/Users\/\w+/.test(json), "no /Users paths");
  assert(!/sk-[A-Za-z0-9]{16,}/.test(json), "no sk- token patterns");
  assert(!/eyJ[A-Za-z0-9_-]{10,}/.test(json), "no JWT-like token values");
  assert(!json.includes("oauth_creds"), "no OAuth credential filename");
  assert(!json.includes("master.key"), "no master.key filename");
  assert(!json.includes("child_process"), "no child_process references");
  assert(!json.includes("exec("), "no exec() references");
  assert(!json.includes("spawn("), "no spawn() references");
});

test("generatedAt and version can be injected", () => {
  const fixed = "2026-06-13T00:00:00.000Z";
  const result = buildLocalConnectorConsentManifest({
    version: "0.3.18-test",
    generatedAt: fixed,
    commandExists: stubCommandExists([])
  });
  assertEqual(result.version, "0.3.18-test", "version injected");
  assertEqual(result.generatedAt, fixed, "generatedAt injected");
});

test("default version is 0.3.18 and mode is dry-run", () => {
  const result = buildLocalConnectorConsentManifest({ commandExists: stubCommandExists([]) });
  assertEqual(result.version, "0.3.18", "default version is 0.3.18");
  assertEqual(result.mode, "dry-run", "mode is dry-run");
  assert(result.dryRunOnly === true, "dryRunOnly true");
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
