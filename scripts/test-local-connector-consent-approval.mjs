import {
  LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION,
  LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION,
  buildLocalConnectorConsentCandidate,
  buildLocalConnectorConsentLedger,
  normalizeLocalConnectorConsents
} from "../src/local-connector-consent-approval.js";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error("assertion failed: " + message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function stubCommandExists(availableCommands) {
  return function (name) {
    return availableCommands.includes(name);
  };
}

const baseConfig = {
  defaultProvider: "ollama",
  activeProfile: "default",
  providers: [{ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, apiFormat: "openai", models: ["local"] }],
  routes: [{ name: "local-route", candidates: [{ provider: "ollama", model: "local", weight: 1 }] }],
  profiles: [{ name: "default", defaultModel: "local-route" }],
  retry: { maxAttempts: 1, cooldownMs: 1000, timeoutMs: 1000, streamIdleTimeoutMs: 10000 },
  limits: { maxBodyBytes: 1048576, dailyRequests: null, providers: {}, routes: {} },
  history: { retentionDays: 14 },
  healthChecks: { enabled: false, intervalMinutes: 60, providers: [] },
  localConnectorConsents: {}
};

test("ledger is dry-run and exposes explicit approve/revoke confirmations", () => {
  const result = buildLocalConnectorConsentLedger({
    commandExists: stubCommandExists(["opencode", "opencode.cmd"]),
    ledger: {}
  });
  assertEqual(result.ok, true, "ok");
  assertEqual(result.mode, "dry-run", "mode");
  assertEqual(result.dryRunOnly, true, "dryRunOnly");
  assertEqual(result.version, "0.3.21", "default version");
  assertEqual(result.requiredConfirmation, LOCAL_CONNECTOR_CONSENT_APPROVE_CONFIRMATION, "approve confirmation");
  assertEqual(result.revokeConfirmation, LOCAL_CONNECTOR_CONSENT_REVOKE_CONFIRMATION, "revoke confirmation");
  assertEqual(result.summary.total, 11, "total connectors");
});

test("ledger overlays stored approvals without enabling credential reads or routes", () => {
  const ledger = {
    opencode: {
      approved: true,
      approvedAt: "2026-06-14T00:00:00.000Z",
      consentVersion: "local-connector-consent.v1",
      connectorId: "opencode",
      connectorName: "OpenCode",
      credentialScope: "cli_config",
      riskLevel: "medium",
      requiredConsent: ["select_connector"],
      futureActions: ["read_cli_config"],
      reviewTags: ["cli_config"]
    }
  };
  const result = buildLocalConnectorConsentLedger({ ledger, commandExists: stubCommandExists(["opencode"]) });
  const opencode = result.records.find((item) => item.id === "opencode");
  assertEqual(result.summary.approved, 1, "approved summary");
  assertEqual(result.summary.consentStored, 1, "consentStored summary");
  assertEqual(opencode.consentStatus, "stored", "opencode stored");
  assertEqual(opencode.approvalState, "approved_metadata_only", "approval metadata only");
  assertEqual(opencode.canReadCredentialsNow, false, "cannot read credentials");
  assertEqual(opencode.canRegisterRoutesNow, false, "cannot register routes");
  assert(opencode.blockers.includes("credential_reader_not_implemented"), "credential reader blocker");
});

test("approve candidate writes only localConnectorConsents and preserves providers/routes", () => {
  const result = buildLocalConnectorConsentCandidate(baseConfig, {}, {
    action: "approve",
    connector: "opencode",
    note: "student-approved-test"
  }, {
    generatedAt: "2026-06-14T00:00:00.000Z",
    commandExists: stubCommandExists(["opencode"])
  });
  assertEqual(result.ok, true, "candidate ok");
  assertEqual(result.action, "approve", "action approve");
  assert(result.candidate.localConnectorConsents.opencode, "opencode consent stored");
  assertEqual(result.candidate.providers.length, baseConfig.providers.length, "providers unchanged");
  assertEqual(result.candidate.routes.length, baseConfig.routes.length, "routes unchanged");
  assertEqual(result.candidate.localConnectorConsents.opencode.credentialScope, "cli_config", "credential scope copied");
  assertEqual(result.candidate.localConnectorConsents.opencode.note, "student-approved-test", "note stored");
});

test("revoke candidate removes one connector consent", () => {
  const ledger = {
    opencode: { approved: true, approvedAt: "2026-06-14T00:00:00.000Z", connectorId: "opencode" },
    qclaw: { approved: true, approvedAt: "2026-06-14T00:00:00.000Z", connectorId: "qclaw" }
  };
  const result = buildLocalConnectorConsentCandidate({ ...baseConfig, localConnectorConsents: ledger }, ledger, {
    action: "revoke",
    connector: "opencode"
  });
  assertEqual(result.ok, true, "candidate ok");
  assert(!result.candidate.localConnectorConsents.opencode, "opencode revoked");
  assert(result.candidate.localConnectorConsents.qclaw, "qclaw preserved");
});

test("normalizer drops malformed, unapproved, and unsafe connector ids", () => {
  const normalized = normalizeLocalConnectorConsents({
    opencode: { approved: true, approvedAt: "x", connectorId: "opencode" },
    "Bad ID": { approved: true, approvedAt: "x" },
    qclaw: { approved: false, approvedAt: "x" },
    "gemini-cli": null
  });
  assert(normalized.opencode, "opencode retained");
  assert(!normalized["Bad ID"], "bad id dropped");
  assert(!normalized.qclaw, "unapproved dropped");
  assert(!normalized["gemini-cli"], "null dropped");
});

test("ledger output does not leak secrets, paths, or execution strings", () => {
  const result = buildLocalConnectorConsentLedger({
    ledger: {
      opencode: {
        approved: true,
        approvedAt: "2026-06-14T00:00:00.000Z",
        connectorId: "opencode",
        note: "safe note"
      }
    }
  });
  const json = JSON.stringify(result);
  assert(!/[A-Z]:\\/.test(json), "no Windows absolute paths");
  assert(!/\/home\/\w+/.test(json), "no /home paths");
  assert(!/sk-[A-Za-z0-9]{16,}/.test(json), "no sk- token patterns");
  assert(!/eyJ[A-Za-z0-9_-]{10,}/.test(json), "no JWT-like token values");
  assert(!json.includes("oauth_creds"), "no OAuth credential filename");
  assert(!json.includes("master.key"), "no master.key filename");
  assert(!json.includes("child_process"), "no child_process references");
  assert(!json.includes("exec("), "no exec() references");
  assert(!json.includes("spawn("), "no spawn() references");
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
