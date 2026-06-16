// Optional HTTP-level test for the dashboard. Boots a real relay in
// the temp dir, fetches / and /admin/status, asserts the response
// shape, then closes the subprocess. Never writes to the project
// root's data/.
//
// 0.5.5 cleanup contract (see scripts/test-utils.mjs):
//   * killChildProcess  -- SIGTERM, wait for "exit", SIGKILL after
//     2s, then destroy() the stdio streams. The 0.5.4 line did
//     proc.kill() + a fixed 200ms setTimeout, which on Windows
//     is not enough for the child stdio Sockets to release.
//   * testFetch  -- wraps globalThis.fetch with `Connection: close`
//     so undici does not park a 5s keep-alive Socket on the
//     event loop after the test returns.
//   * cleanupTempDir  -- single rm call that swallows ENOENT.

import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  cleanupTempDir,
  killChildProcess,
  sleep,
  testFetch
} from "./test-utils.mjs";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
const expectedVersion = pkg.version;
const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-dash-http-"));
const configPath = resolve(tmpRoot, "config.json");
const statePath = resolve(tmpRoot, "state.json");
const keystoreDir = resolve(tmpRoot, "keys");

await writeFile(configPath, JSON.stringify({
  defaultProvider: "local",
  providers: [
    { name: "local", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local-model"] }
  ],
  routes: [{ name: "r", candidates: [{ provider: "local", model: "local-model" }] }],
  profiles: [{ name: "default", defaultModel: "r" }],
  activeProfile: "default"
}));

const proc = spawn(process.execPath, ["src/server.js"], {
  cwd: rootDir,
  env: {
    ...process.env,
    PORT: "0",
    // 0.5.4: opt out of the /v1/* + /admin/* auth gate so this
    // test can keep asserting on the unauthenticated HTML shape
    // (the auth gate itself is covered by test-auth-required.mjs).
    OPENRELAY_ALLOW_NO_AUTH: "true",
    OPENRELAY_CONFIG: configPath,
    OPENRELAY_STATE: statePath,
    OPENRELAY_KEYSTORE_DIR: keystoreDir
  },
  stdio: ["ignore", "pipe", "pipe"]
});
proc.stderr.on("data", () => {});

const failures = [];
function check(cond, msg) {
  if (!cond) {
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  } else {
    console.log(`  ok  ${msg}`);
  }
}

function waitForRelayPort(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("relay did not print its listening port in time"));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      child.stdout.removeListener("data", onData);
    }
    function onData(chunk) {
      buffer += chunk.toString("utf8");
      const match = buffer.match(/(?:RelayForge|OpenRelay Local Safe|openrelay-like) is running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cleanup();
        resolve(Number(match[1]));
      }
    }
    child.stdout.on("data", onData);
    child.once("error", (err) => {
      cleanup();
      reject(err);
    });
    child.once("exit", (code) => {
      cleanup();
      reject(new Error(`relay exited prematurely with code ${code}`));
    });
  });
}

try {
  const port = await waitForRelayPort(proc);

  // Wait for /health
  const deadline = Date.now() + 5000;
  let healthy = false;
  while (Date.now() < deadline) {
    try {
      const r = await testFetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) {
        healthy = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  check(healthy, "relay becomes healthy within 5s");

  // GET / returns 200 and HTML
  const rootResp = await testFetch(`http://127.0.0.1:${port}/`);
  check(rootResp.status === 200, "GET / returns 200");
  const rootText = await rootResp.text();
  check(rootText.length > 1000, "GET / returns non-trivial HTML");
  check(rootText.includes("RelayForge"), "GET / mentions RelayForge");
  check(rootText.includes("tab-overview"), "GET / includes overview tab");
  check(rootText.includes('data-tab="providers"'), "GET / includes providers tab anchor");

  // GET /admin/status returns version
  const statusResp = await testFetch(`http://127.0.0.1:${port}/admin/status`);
  check(statusResp.status === 200, "GET /admin/status returns 200");
  const status = await statusResp.json();
  check(status.version === expectedVersion, `version is ${expectedVersion} (got ${status.version})`);
  check(status.ok === true, "/admin/status ok=true");
  check(typeof status.recentErrors === "object" && Array.isArray(status.recentErrors), "recentErrors is an array");
  check(typeof status.providers === "object" && Array.isArray(status.providers), "providers is an array");
  check(typeof status.configPath === "string" && status.configPath.length > 0, "configPath is set");

  // GET /v1/models returns 200 (proxied or local Ollama)
  const modelsResp = await testFetch(`http://127.0.0.1:${port}/v1/models`);
  check(modelsResp.status === 200, "GET /v1/models returns 200");

  // GET /admin/error-log returns 200
  const errResp = await testFetch(`http://127.0.0.1:${port}/admin/error-log`);
  check(errResp.status === 200, "GET /admin/error-log returns 200");
  const errs = await errResp.json();
  check(Array.isArray(errs), "/admin/error-log returns an array");

  // GET /admin/preview-route?model=auto (P2 路由预览器端 -- 
  const previewResp = await testFetch(`http://127.0.0.1:${port}/admin/preview-route?model=auto`);
  check(previewResp.status === 200, "GET /admin/preview-route returns 200");
  const previewBody = await previewResp.json();
  check(previewBody.ok === true, "/admin/preview-route ok=true");
  check(previewBody.preview && typeof previewBody.preview === "object", "preview is an object");
  check(typeof previewBody.preview.kind === "string", "preview.kind is a string");
  check(Array.isArray(previewBody.preview.candidates), "preview.candidates is an array");
  check(typeof previewBody.preview.summary === "object" && typeof previewBody.preview.summary.total === "number", "preview.summary.total is a number");

  // GET /admin/preview-route?model=unknown-x  -- should not throw and should still resolve
  const previewUnknown = await testFetch(`http://127.0.0.1:${port}/admin/preview-route?model=this-model-does-not-exist`);
  check(previewUnknown.status === 200, "/admin/preview-route accepts unknown model");
  const previewUnknownBody = await previewUnknown.json();
  check(previewUnknownBody.ok === true, "unknown model still ok=true (falls back to default provider)");
  check(previewUnknownBody.preview.kind === "default_provider", "unknown model resolves as default_provider");

  // softRefresh regression: live HTML must (1) include activateTab
  // call so a hash-routed tab works, (2) call document.open /
  // document.write / document.close for the 0.6.3 in-place
  // fetch swap primitive, (3) NOT call window.location.replace
  // (the 0.5.x path that produced a 100-300ms token-prompt
  // flash because top-level navigations drop the Authorization
  // header). We never read /admin/keys or any real key
  // value  -- this is a structural check on the sanitized HTML only.
  // Collect all <script> blocks for structural checks. There are
  // multiple blocks: data injection, dashboard-client.js bundle,
  // per-tab IIFEs (tools, ide). Each has its own scope.
  const allScripts = Array.from(rootText.matchAll(/<script>([\s\S]*?)<\/script>/g)).map((m) => m[1]);
  check(allScripts.length > 0, "GET / inline <script> body present");
  if (allScripts.length > 0) {
    // Concatenate all scripts for structural pattern matching
    // (activateTab and softRefresh may live in different blocks).
    const combined = allScripts.join("\n");
    check(/activateTab\s*\(/.test(combined), "activateTab() called in the inline scripts");
    // softRefresh body: simple window.location.reload().
    const softRefreshBlock = combined.match(/function softRefresh[\s\S]*?function scheduleSoftRefresh/);
    check(softRefreshBlock, "softRefresh block extractable from the inline scripts");
    const codeOnly = softRefreshBlock[0]
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    check(
      /location\.reload\s*\(/.test(codeOnly),
      "softRefresh uses window.location.reload() (stable full-page refresh)"
    );
    check(
      !/window\.location\.replace/.test(codeOnly),
      "softRefresh does NOT call window.location.replace() (preserved)"
    );
    // The first script block (data injection) must parse cleanly
    // as a Function body (it uses var, safe to re-run).
    let parseOk = false;
    try { new Function(allScripts[0]); parseOk = true; } catch (_) { /* swallow */ }
    check(parseOk, "data injection inline script parses cleanly as a Function body");
  }

  // 0.4.10: discover-models-by-url error path. We exercise the
  // validation guards without hitting any real upstream. The
  // apiKey we POST is fake ("sk-test-...") and is NOT used by any
  // real provider; we only assert that the server rejects bad
  // input and never echoes the key back.
  const postJsonTo = async (url, body) => {
    const r = await testFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    let data = {};
    try { data = await r.json(); } catch (_) { /* keep {} */ }
    return { status: r.status, data };
  };

  const discoverMissing = await postJsonTo(`http://127.0.0.1:${port}/admin/discover-models`, {});
  check(discoverMissing.status === 400, "discover-models with no baseUrl returns 400");
  check(discoverMissing.data && discoverMissing.data.ok === false, "discover-models no baseUrl ok=false");
  check(!JSON.stringify(discoverMissing.data).includes("sk-test-"), "discover-models never echoes back the test key");

  const discoverInvalid = await postJsonTo(`http://127.0.0.1:${port}/admin/discover-models`, { baseUrl: "not-a-url", apiKey: "sk-test-noecho" });
  check(discoverInvalid.status === 400, "discover-models with invalid URL returns 400");
  check(discoverInvalid.data && discoverInvalid.data.ok === false, "discover-models invalid URL ok=false");
  check(!JSON.stringify(discoverInvalid.data).includes("sk-test-noecho"), "discover-models invalid URL never echoes key");

  const discoverRemoteHttp = await postJsonTo(`http://127.0.0.1:${port}/admin/discover-models`, { baseUrl: "http://10.0.0.5:8000/v1", apiKey: "sk-test-remotehttp" });
  check(discoverRemoteHttp.status === 400, "discover-models with remote http:// returns 400");
  check(discoverRemoteHttp.data && discoverRemoteHttp.data.ok === false, "discover-models remote http ok=false");
  check(!JSON.stringify(discoverRemoteHttp.data).includes("sk-test-remotehttp"), "discover-models remote http never echoes key");

  // Legacy {provider: "name"} path: unknown provider returns 404.
  const discoverUnknown = await postJsonTo(`http://127.0.0.1:${port}/admin/discover-models`, { provider: "no-such-provider-xyz" });
  check(discoverUnknown.status === 404, "discover-models unknown provider returns 404");
  check(discoverUnknown.data && discoverUnknown.data.error === "provider_not_found", "unknown provider error is provider_not_found");

  // Live 0.4.10 templates are visible in /admin/status. We assert
  // the new keyEnv values are present in the rendered status
  // JSON, plus the updated gemini / xai model names. We re-use
  // the `status` already parsed at the top of the test (do NOT
  // re-read statusResp  -- fetch Response bodies are single-use).
  const templateKeyEnvs = (status.providerTemplates || []).map((t) => t.keyEnv);
  for (const env of ["CEREBRAS_API_KEYS", "DASHSCOPE_API_KEYS", "FIREWORKS_API_KEYS", "VOLCENGINE_API_KEYS", "QIANFAN_API_KEYS", "HUNYUAN_API_KEYS", "CLOUDFLARE_API_KEYS", "HUGGINGFACE_API_KEYS", "GITHUB_MODELS_TOKEN", "NVIDIA_API_KEYS", "LONGCAT_API_KEYS", "SAMBANOVA_API_KEYS", "QINIU_API_KEYS", "KILO_API_KEYS", "LLM7_API_KEYS", "BLAZEAPI_API_KEYS", "BAZAARLINK_API_KEYS"]) {
    check(templateKeyEnvs.includes(env), `/admin/status providerTemplates includes ${env}`);
  }
  const gemini = (status.providerTemplates || []).find((t) => t.name === "gemini");
  const xai = (status.providerTemplates || []).find((t) => t.name === "xai");
  check(gemini && (gemini.models || []).includes("gemini-2.5-flash"), "gemini template has gemini-2.5-flash");
  check(xai && (xai.models || []).includes("grok-3"), "xai template has grok-3");

  // 0.3.19: GET /admin/provider-template-parity  -- dry-run catalog coverage audit
  const templateParityResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-template-parity`);
  check(templateParityResp.status === 200, "GET /admin/provider-template-parity returns 200");
  const templateParity = await templateParityResp.json();
  check(templateParity.ok === true, "provider-template-parity ok=true");
  check(templateParity.version === expectedVersion, `provider-template-parity version ${expectedVersion}`);
  check(templateParity.mode === "dry-run", "provider-template-parity mode dry-run");
  check(templateParity.dryRunOnly === true, "provider-template-parity dryRunOnly true");
  check(templateParity.upstreamTargets.apiLocalProviders === 34, "provider-template-parity target 34");
  check(templateParity.upstreamTargets.localConnectors === 11, "provider-template-parity target 11 local connectors");
  check(templateParity.upstreamTargets.nonVirtualProviders === 45, "provider-template-parity target 45 non-virtual");
  check(templateParity.summary.totalTemplates >= 34, "provider-template-parity has at least 34 templates");
  check(templateParity.summary.apiTemplates >= 29, "provider-template-parity has API templates");
  check(templateParity.summary.localTemplates === 5, "provider-template-parity has 5 local templates");
  check(templateParity.summary.configReadyTemplates >= 30, "provider-template-parity config-ready templates");
  check(templateParity.summary.templateOnly >= 2, "provider-template-parity template-only placeholders");
  check(templateParity.summary.apiLocalTargetCovered === true, "provider-template-parity covers API/local target");
  check(templateParity.summary.nonVirtualWithLocalConnectors >= 45, "provider-template-parity covers non-virtual target with local connectors");
  check(Array.isArray(templateParity.providers), "provider-template-parity providers array");
  check(templateParity.providers.some((p) => p.name === "ollama" && p.local === true), "provider-template-parity includes local ollama");
  check(templateParity.providers.some((p) => p.name === "groq" && p.parityRole === "direct_api"), "provider-template-parity includes groq direct API");
  check(templateParity.providers.some((p) => p.name === "cloudflare-ai" && p.templateOnly === true), "provider-template-parity flags cloudflare template-only");
  for (const name of ["kilo", "llm7", "blazeapi", "bazaarlink"]) {
    check(templateParity.providers.some((p) => p.name === name && p.templateOnly === true && p.configReady === false), `provider-template-parity includes safe placeholder ${name}`);
  }
  check(Array.isArray(templateParity.missingTemplateNames) && templateParity.missingTemplateNames.length === 0, "provider-template-parity has no missing public-info template names");
  for (const [key, value] of Object.entries(templateParity.safety || {})) {
    check(value === false, `provider-template-parity safety.${key} false`);
  }
  const templateParityRaw = JSON.stringify(templateParity).toLowerCase();
  check(!templateParityRaw.includes("sk-"), "provider-template-parity response does not contain API key-like values");
  check(!/[a-z]:\\/.test(templateParityRaw), "provider-template-parity response does not contain Windows paths");
  check(!templateParityRaw.includes("/home/"), "provider-template-parity response does not contain home paths");
  for (const param of ["live", "discover", "connect", "start", "apply", "write", "save"]) {
    const badResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-template-parity?${param}=true`);
    check(badResp.status === 400, `provider-template-parity rejects ${param}=true`);
    const badBody = await badResp.json();
    check(badBody.error === "live_mode_rejected", `provider-template-parity ${param}=true live_mode_rejected`);
  }

  // 0.3.20: GET/POST /admin/provider-template-import-plan/import  -- controlled config import
  const importPlanResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-template-import-plan`);
  check(importPlanResp.status === 200, "GET /admin/provider-template-import-plan returns 200");
  const importPlan = await importPlanResp.json();
  check(importPlan.ok === true, "provider-template-import-plan ok=true");
  check(importPlan.version === expectedVersion, `provider-template-import-plan version ${expectedVersion}`);
  check(importPlan.mode === "dry-run", "provider-template-import-plan mode dry-run");
  check(importPlan.dryRunOnly === true, "provider-template-import-plan dryRunOnly true");
  check(importPlan.requiredConfirmation === "ADD_MISSING_PROVIDER_TEMPLATES", "provider-template-import-plan exposes confirmation string");
  check(importPlan.summary.importableTemplates >= 30, "provider-template-import-plan has importable templates");
  check(importPlan.summary.skippedTemplateOnly >= 2, "provider-template-import-plan skips placeholder templates");
  check(importPlan.summary.configWrites === 0, "provider-template-import-plan configWrites 0");
  check(importPlan.summary.keysStored === 0, "provider-template-import-plan keysStored 0");
  check(importPlan.summary.networkRequests === 0, "provider-template-import-plan networkRequests 0");
  check(importPlan.summary.routesRegistered === 0, "provider-template-import-plan routesRegistered 0");
  check(importPlan.importable.some((p) => p.name === "groq"), "provider-template-import-plan includes groq import");
  check(!importPlan.importable.some((p) => p.name === "cloudflare-ai"), "provider-template-import-plan excludes placeholder cloudflare");
  check(importPlan.skipped.some((p) => p.name === "cloudflare-ai" && p.reason === "requires_user_specific_base_url"), "provider-template-import-plan records cloudflare skip");
  for (const name of ["kilo", "llm7", "blazeapi", "bazaarlink"]) {
    check(!importPlan.importable.some((p) => p.name === name), `provider-template-import-plan excludes placeholder ${name}`);
    check(importPlan.skipped.some((p) => p.name === name && p.reason === "requires_user_specific_base_url"), `provider-template-import-plan records ${name} skip`);
  }
  for (const [key, value] of Object.entries(importPlan.safety || {})) {
    if (key === "requiresExplicitConfirmation") check(value === true, `provider-template-import-plan safety.${key} true`);
    else check(value === false, `provider-template-import-plan safety.${key} false`);
  }
  const importPlanRaw = JSON.stringify(importPlan).toLowerCase();
  check(!importPlanRaw.includes("sk-"), "provider-template-import-plan response does not contain API key-like values");
  check(!/[a-z]:\\/.test(importPlanRaw), "provider-template-import-plan response does not contain Windows paths");
  check(!importPlanRaw.includes("/home/"), "provider-template-import-plan response does not contain home paths");
  for (const param of ["live", "discover", "connect", "start", "network", "keys"]) {
    const badResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-template-import-plan?${param}=true`);
    check(badResp.status === 400, `provider-template-import-plan rejects ${param}=true`);
    const badBody = await badResp.json();
    check(badBody.error === "live_mode_rejected", `provider-template-import-plan ${param}=true live_mode_rejected`);
  }
  const rejectedImport = await postJsonTo(`http://127.0.0.1:${port}/admin/provider-template-import`, { apply: true, confirm: "WRONG" });
  check(rejectedImport.status === 400, "provider-template-import rejects wrong confirmation");
  check(rejectedImport.data && rejectedImport.data.error === "confirmation_required", "provider-template-import wrong confirmation error");
  const configBeforeImport = JSON.parse(await readFile(configPath, "utf8"));
  check(configBeforeImport.providers.length === 1, "provider-template-import wrong confirmation did not mutate config");
  const acceptedImport = await postJsonTo(`http://127.0.0.1:${port}/admin/provider-template-import`, { apply: true, confirm: "ADD_MISSING_PROVIDER_TEMPLATES" });
  check(acceptedImport.status === 200, "provider-template-import with confirmation returns 200");
  check(acceptedImport.data && acceptedImport.data.ok === true, "provider-template-import confirmed ok=true");
  check(acceptedImport.data && acceptedImport.data.applied === true, "provider-template-import confirmed applied=true");
  check(acceptedImport.data && acceptedImport.data.imported >= 30, "provider-template-import confirmed imports templates");
  check(acceptedImport.data && acceptedImport.data.safety && acceptedImport.data.safety.writesConfig === true, "provider-template-import reports writesConfig true after apply");
  check(acceptedImport.data && acceptedImport.data.safety && acceptedImport.data.safety.storesKeys === false, "provider-template-import reports storesKeys false after apply");
  const configAfterImport = JSON.parse(await readFile(configPath, "utf8"));
  const importedNames = configAfterImport.providers.map((provider) => provider.name);
  check(importedNames.includes("groq"), "provider-template-import wrote groq provider");
  check(importedNames.includes("cerebras"), "provider-template-import wrote cerebras provider");
  check(!importedNames.includes("cloudflare-ai"), "provider-template-import did not write placeholder cloudflare provider");
  check(!importedNames.includes("kilo"), "provider-template-import did not write placeholder kilo provider");
  check(!JSON.stringify(configAfterImport).includes("sk-"), "provider-template-import did not write API keys to config");

  // 0.3.21: local connector consent ledger + confirmation-gated approve/revoke
  const consentLedgerResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-consent-ledger`);
  check(consentLedgerResp.status === 200, "GET /admin/local-connector-consent-ledger returns 200");
  const consentLedger = await consentLedgerResp.json();
  check(consentLedger.ok === true, "local-connector-consent-ledger ok=true");
  check(consentLedger.version === expectedVersion, `local-connector-consent-ledger version ${expectedVersion}`);
  check(consentLedger.mode === "dry-run", "local-connector-consent-ledger mode dry-run");
  check(consentLedger.dryRunOnly === true, "local-connector-consent-ledger dryRunOnly true");
  check(consentLedger.requiredConfirmation === "APPROVE_LOCAL_CONNECTOR_CONSENT", "local-connector-consent-ledger approve confirmation");
  check(consentLedger.revokeConfirmation === "REVOKE_LOCAL_CONNECTOR_CONSENT", "local-connector-consent-ledger revoke confirmation");
  check(consentLedger.summary.total === 11, "local-connector-consent-ledger has 11 connectors");
  check(consentLedger.summary.approved === 0, "local-connector-consent-ledger starts with 0 approvals");
  check(consentLedger.summary.credentialReads === 0, "local-connector-consent-ledger credentialReads 0");
  check(consentLedger.summary.pathsDisclosed === 0, "local-connector-consent-ledger pathsDisclosed 0");
  check(consentLedger.summary.processesStarted === 0, "local-connector-consent-ledger processesStarted 0");
  check(consentLedger.summary.routesRegistered === 0, "local-connector-consent-ledger routesRegistered 0");
  check(consentLedger.records.some((record) => record.id === "opencode"), "local-connector-consent-ledger includes opencode");
  for (const [key, value] of Object.entries(consentLedger.safety || {})) {
    if (key === "requiresExplicitConfirmation") check(value === true, `local-connector-consent-ledger safety.${key} true`);
    else check(value === false || key === "dryRunOnly", `local-connector-consent-ledger safety.${key} no side effect`);
  }
  const consentLedgerRaw = JSON.stringify(consentLedger);
  check(!/[A-Z]:\\/.test(consentLedgerRaw), "local-connector-consent-ledger response does not contain Windows paths");
  check(!/\/home\/\w+/.test(consentLedgerRaw), "local-connector-consent-ledger response does not contain home paths");
  check(!/sk-[A-Za-z0-9]{16,}/.test(consentLedgerRaw), "local-connector-consent-ledger response does not contain API keys");
  for (const param of ["live", "discover", "connect", "start", "read", "keys", "includePaths"]) {
    const badResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-consent-ledger?${param}=true`);
    check(badResp.status === 400, `local-connector-consent-ledger rejects ${param}=true`);
    const badBody = await badResp.json();
    check(["live_mode_rejected", "path_disclosure_rejected"].includes(badBody.error), `local-connector-consent-ledger ${param}=true rejected safely`);
  }
  const rejectedConsent = await postJsonTo(`http://127.0.0.1:${port}/admin/local-connector-consent`, {
    apply: true,
    action: "approve",
    connector: "opencode",
    confirm: "WRONG"
  });
  check(rejectedConsent.status === 400, "local-connector-consent rejects wrong approve confirmation");
  check(rejectedConsent.data && rejectedConsent.data.error === "confirmation_required", "local-connector-consent wrong approve confirmation error");
  const configBeforeConsent = JSON.parse(await readFile(configPath, "utf8"));
  check(!configBeforeConsent.localConnectorConsents || !configBeforeConsent.localConnectorConsents.opencode, "wrong consent confirmation did not mutate config");
  const acceptedConsent = await postJsonTo(`http://127.0.0.1:${port}/admin/local-connector-consent`, {
    apply: true,
    action: "approve",
    connector: "opencode",
    confirm: "APPROVE_LOCAL_CONNECTOR_CONSENT",
    note: "http-test"
  });
  check(acceptedConsent.status === 200, "local-connector-consent approve returns 200");
  check(acceptedConsent.data && acceptedConsent.data.ok === true, "local-connector-consent approve ok=true");
  check(acceptedConsent.data && acceptedConsent.data.applied === true, "local-connector-consent approve applied=true");
  check(acceptedConsent.data && acceptedConsent.data.safety && acceptedConsent.data.safety.writesConfig === true, "local-connector-consent approve writesConfig true");
  check(acceptedConsent.data && acceptedConsent.data.safety && acceptedConsent.data.safety.storesConsent === true, "local-connector-consent approve storesConsent true");
  check(acceptedConsent.data && acceptedConsent.data.safety && acceptedConsent.data.safety.readsTokens === false, "local-connector-consent approve readsTokens false");
  const configAfterConsent = JSON.parse(await readFile(configPath, "utf8"));
  check(configAfterConsent.localConnectorConsents && configAfterConsent.localConnectorConsents.opencode, "local-connector-consent wrote opencode consent metadata");
  check(configAfterConsent.localConnectorConsents.opencode.credentialScope === "cli_config", "local-connector-consent stores opencode credentialScope");
  check(!JSON.stringify(configAfterConsent).includes("sk-"), "local-connector-consent did not write API keys");
  check(!JSON.stringify(configAfterConsent).includes("oauth_creds"), "local-connector-consent did not write credential filenames");
  const rejectedRevoke = await postJsonTo(`http://127.0.0.1:${port}/admin/local-connector-consent`, {
    apply: true,
    action: "revoke",
    connector: "opencode",
    confirm: "WRONG"
  });
  check(rejectedRevoke.status === 400, "local-connector-consent rejects wrong revoke confirmation");
  const acceptedRevoke = await postJsonTo(`http://127.0.0.1:${port}/admin/local-connector-consent`, {
    apply: true,
    action: "revoke",
    connector: "opencode",
    confirm: "REVOKE_LOCAL_CONNECTOR_CONSENT"
  });
  check(acceptedRevoke.status === 200, "local-connector-consent revoke returns 200");
  check(acceptedRevoke.data && acceptedRevoke.data.ok === true, "local-connector-consent revoke ok=true");
  const configAfterRevoke = JSON.parse(await readFile(configPath, "utf8"));
  check(!configAfterRevoke.localConnectorConsents || !configAfterRevoke.localConnectorConsents.opencode, "local-connector-consent revoke removed opencode metadata");

  // 0.3.7: GET /admin/provider-test-preview  -- dry-run only, no live mode
  const previewAllResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-test-preview`);
  check(previewAllResp.status === 200, "GET /admin/provider-test-preview returns 200");
  const previewAll = await previewAllResp.json();
  check(previewAll.mode === "dry-run", "provider-test-preview mode is dry-run");
  check(typeof previewAll.ok === "boolean", "provider-test-preview ok is boolean");
  check(Array.isArray(previewAll.providers), "provider-test-preview providers is array");
  check(typeof previewAll.summary === "object", "provider-test-preview summary is object");
  check(previewAll.version === expectedVersion, `provider-test-preview version ${expectedVersion}`);
  // No liveResults in dry-run
  check(!previewAll.liveResults, "provider-test-preview has no liveResults");
  // Providers have expected fields
  if (previewAll.providers.length > 0) {
    const p = previewAll.providers[0];
    check(typeof p.name === "string", "preview provider name is string");
    check(typeof p.status === "string", "preview provider status is string");
    check(typeof p.hasKey === "boolean", "preview provider hasKey is boolean");
    check(typeof p.local === "boolean", "preview provider local is boolean");
    check(typeof p.hasBaseUrl === "boolean", "preview provider hasBaseUrl is boolean");
    check(Array.isArray(p.issues), "preview provider issues is array");
  }
  // localOnly=true filter
  const previewLocalResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-test-preview?localOnly=true`);
  check(previewLocalResp.status === 200, "localOnly preview returns 200");
  const previewLocal = await previewLocalResp.json();
  check(previewLocal.localOnly === true, "localOnly flag is true in response");
  // All returned providers should be local
  for (const p of previewLocal.providers) {
    check(p.local === true, "localOnly preview only returns local providers: " + p.name);
  }
  // Live=true rejected
  const previewLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-test-preview?live=true`);
  check(previewLiveResp.status === 400, "live=true preview returns 400");
  const previewLive = await previewLiveResp.json();
  check(previewLive.ok === false, "live=true preview ok=false");
  check(previewLive.error === "live_mode_rejected" || typeof previewLive.error === "string", "live=true preview has error message");
  // 0.3.10: GET /admin/ide-proxy-preview endpoint
  const idePreviewResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-preview`);
  check(idePreviewResp.status === 200, "GET /admin/ide-proxy-preview returns 200");
  const idePreview = await idePreviewResp.json();
  check(idePreview.mode === "dry-run", "ide-proxy-preview mode is dry-run");
  check(idePreview.version === expectedVersion, `ide-proxy-preview version ${expectedVersion}`);
  check(idePreview.ok === true, "ide-proxy-preview ok=true");
  check(Array.isArray(idePreview.proxies), "ide-proxy-preview proxies is array");
  check(idePreview.proxies.length === 4, "ide-proxy-preview has 4 proxies");
  const ideIds = idePreview.proxies.map((p) => p.id);
  check(ideIds.includes("cursor"), "ide-proxy-preview has cursor");
  check(ideIds.includes("windsurf"), "ide-proxy-preview has windsurf");
  check(ideIds.includes("vscode-copilot"), "ide-proxy-preview has vscode-copilot");
  check(ideIds.includes("antigravity"), "ide-proxy-preview has antigravity");
  check(idePreview.safety.dryRunOnly === true, "safety dryRunOnly is true");
  check(idePreview.safety.readsIdeCredentials === false, "safety readsIdeCredentials is false");
  check(idePreview.safety.modifiesIdeConfig === false, "safety modifiesIdeConfig is false");
  check(idePreview.safety.startsProxyListener === false, "safety startsProxyListener is false");
  const ideJson = JSON.stringify(idePreview);
  check(!ideJson.includes("sk-"), "ide-proxy-preview response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(ideJson), "ide-proxy-preview response does not contain JWT-like token values");

  // ?model=local:local-model echoes selectedModel
  const idePreviewModelResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-preview?model=local:local-model`);
  check(idePreviewModelResp.status === 200, "ide-proxy-preview with model returns 200");
  const idePreviewModel = await idePreviewModelResp.json();
  check(idePreviewModel.selectedModel === "local:local-model", "ide-proxy-preview selectedModel echoes the query model");
  // Each proxy should also reflect the selected model
  for (const proxy of idePreviewModel.proxies) {
    check(proxy.selectedModel === "local:local-model", `${proxy.id} selectedModel matches`);
  }

  // ?live=true rejected with 400
  const ideLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-preview?live=true`);
  check(ideLiveResp.status === 400, "ide-proxy-preview live=true returns 400");
  const ideLive = await ideLiveResp.json();
  check(ideLive.ok === false, "ide-proxy-preview live=true ok=false");
  check(ideLive.error === "live_mode_rejected", "ide-proxy-preview live=true error is live_mode_rejected");

  // 0.3.12: GET /admin/ide-proxy-status
  const ideStatusResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-status`);
  check(ideStatusResp.status === 200, "GET /admin/ide-proxy-status returns 200");
  const ideStatus = await ideStatusResp.json();
  check(ideStatus.mode === "dry-run", "ide-proxy-status mode is dry-run");
  check(ideStatus.version === expectedVersion, `ide-proxy-status version ${expectedVersion}`);
  check(ideStatus.ok === true, "ide-proxy-status ok=true");
  check(ideStatus.summary.total === 4, "ide-proxy-status summary.total is 4");
  check(ideStatus.summary.running === 0, "ide-proxy-status summary.running is 0");
  check(ideStatus.summary.stopped === 4, "ide-proxy-status summary.stopped is 4");
  check(ideStatus.summary.error === 0, "ide-proxy-status summary.error is 0");
  check(Array.isArray(ideStatus.proxies), "ide-proxy-status proxies is array");
  check(ideStatus.proxies.length === 4, "ide-proxy-status has 4 proxies");
  const ideStatusIds = ideStatus.proxies.map((p) => p.id);
  check(ideStatusIds.includes("cursor"), "ide-proxy-status has cursor");
  check(ideStatusIds.includes("windsurf"), "ide-proxy-status has windsurf");
  check(ideStatusIds.includes("vscode-copilot"), "ide-proxy-status has vscode-copilot");
  check(ideStatusIds.includes("antigravity"), "ide-proxy-status has antigravity");
  // All proxies stopped and preview-only
  for (const proxy of ideStatus.proxies) {
    check(proxy.status === "stopped", `${proxy.id} status is stopped`);
    check(proxy.phase === "preview-only", `${proxy.id} phase is preview-only`);
    check(proxy.safety.dryRunOnly === true, `${proxy.id} safety.dryRunOnly is true`);
    check(proxy.safety.readsIdeCredentials === false, `${proxy.id} safety.readsIdeCredentials is false`);
    check(proxy.safety.modifiesIdeConfig === false, `${proxy.id} safety.modifiesIdeConfig is false`);
    check(proxy.safety.startsProxyListener === false, `${proxy.id} safety.startsProxyListener is false`);
    check(proxy.canStart === false, `${proxy.id} canStart is false`);
    check(proxy.canStop === false, `${proxy.id} canStop is false`);
  }
  // ?model=local:local-model echoes selectedModel
  const ideStatusModelResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-status?model=local:local-model`);
  check(ideStatusModelResp.status === 200, "ide-proxy-status with model returns 200");
  const ideStatusModel = await ideStatusModelResp.json();
  for (const proxy of ideStatusModel.proxies) {
    check(proxy.selectedModel === "local:local-model", `${proxy.id} selectedModel matches query model`);
  }
  // ?live=true rejected with 400
  const ideStatusLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-status?live=true`);
  check(ideStatusLiveResp.status === 400, "ide-proxy-status live=true returns 400");
  const ideStatusLive = await ideStatusLiveResp.json();
  check(ideStatusLive.ok === false, "ide-proxy-status live=true ok=false");
  check(ideStatusLive.error === "live_mode_rejected", "ide-proxy-status live=true error is live_mode_rejected");
  // No tokens/cookies/sessions in response
  const ideStatusJson = JSON.stringify(ideStatus);
  check(!ideStatusJson.includes("sk-"), "ide-proxy-status response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(ideStatusJson), "ide-proxy-status response does not contain JWT-like token values");

  // 0.3.13: GET /admin/ide-proxy-port-check
  const idePortResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-port-check?timeoutMs=50`);
  check(idePortResp.status === 200, "GET /admin/ide-proxy-port-check returns 200");
  const idePortCheck = await idePortResp.json();
  check(idePortCheck.mode === "dry-run", "ide-proxy-port-check mode is dry-run");
  check(idePortCheck.version === expectedVersion, `ide-proxy-port-check version ${expectedVersion}`);
  check(idePortCheck.ok === true, "ide-proxy-port-check ok=true");
  check(idePortCheck.timeoutMs === 50, "ide-proxy-port-check timeoutMs is clamped/accepted");
  check(idePortCheck.summary.total === 4, "ide-proxy-port-check summary.total is 4");
  check(typeof idePortCheck.summary.available === "number", "ide-proxy-port-check summary.available is number");
  check(typeof idePortCheck.summary.occupied === "number", "ide-proxy-port-check summary.occupied is number");
  check(typeof idePortCheck.summary.unknown === "number", "ide-proxy-port-check summary.unknown is number");
  check(Array.isArray(idePortCheck.proxies), "ide-proxy-port-check proxies is array");
  check(idePortCheck.proxies.length === 4, "ide-proxy-port-check has 4 proxies");
  const idePortIds = idePortCheck.proxies.map((p) => p.id);
  check(idePortIds.includes("cursor"), "ide-proxy-port-check has cursor");
  check(idePortIds.includes("windsurf"), "ide-proxy-port-check has windsurf");
  check(idePortIds.includes("vscode-copilot"), "ide-proxy-port-check has vscode-copilot");
  check(idePortIds.includes("antigravity"), "ide-proxy-port-check has antigravity");
  for (const proxy of idePortCheck.proxies) {
    check(proxy.host === "127.0.0.1", `${proxy.id} port check uses loopback host`);
    check(typeof proxy.port === "number", `${proxy.id} port check has numeric port`);
    check(["available", "occupied", "unknown"].includes(proxy.portStatus), `${proxy.id} portStatus is known enum`);
    check(proxy.safety.dryRunOnly === true, `${proxy.id} port safety dryRunOnly is true`);
    check(proxy.safety.readsIdeCredentials === false, `${proxy.id} port safety readsIdeCredentials is false`);
    check(proxy.safety.modifiesIdeConfig === false, `${proxy.id} port safety modifiesIdeConfig is false`);
    check(proxy.safety.startsProxyListener === false, `${proxy.id} port safety startsProxyListener is false`);
    check(proxy.safety.writesConfig === false, `${proxy.id} port safety writesConfig is false`);
  }
  const idePortModelResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-port-check?model=local:local-model&timeoutMs=50`);
  check(idePortModelResp.status === 200, "ide-proxy-port-check with model returns 200");
  const idePortModel = await idePortModelResp.json();
  for (const proxy of idePortModel.proxies) {
    check(proxy.selectedModel === "local:local-model", `${proxy.id} port selectedModel matches query model`);
  }
  const idePortLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-port-check?live=true`);
  check(idePortLiveResp.status === 400, "ide-proxy-port-check live=true returns 400");
  const idePortLive = await idePortLiveResp.json();
  check(idePortLive.ok === false, "ide-proxy-port-check live=true ok=false");
  check(idePortLive.error === "live_mode_rejected", "ide-proxy-port-check live=true error is live_mode_rejected");
  const idePortJson = JSON.stringify(idePortCheck);
  check(!idePortJson.includes("sk-"), "ide-proxy-port-check response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(idePortJson), "ide-proxy-port-check response does not contain JWT-like token values");

  // 0.3.14: GET /admin/ide-proxy-start-plan
  const ideStartPlanResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-start-plan?timeoutMs=50`);
  check(ideStartPlanResp.status === 200, "GET /admin/ide-proxy-start-plan returns 200");
  const ideStartPlan = await ideStartPlanResp.json();
  check(ideStartPlan.mode === "dry-run", "ide-proxy-start-plan mode is dry-run");
  check(ideStartPlan.version === expectedVersion, `ide-proxy-start-plan version ${expectedVersion}`);
  check(ideStartPlan.ok === true, "ide-proxy-start-plan ok=true");
  check(ideStartPlan.summary.total === 4, "ide-proxy-start-plan summary.total is 4");
  check(typeof ideStartPlan.summary.ready === "number", "ide-proxy-start-plan summary.ready is number");
  check(typeof ideStartPlan.summary.blocked === "number", "ide-proxy-start-plan summary.blocked is number");
  check(typeof ideStartPlan.summary.needsReview === "number", "ide-proxy-start-plan summary.needsReview is number");
  check(Array.isArray(ideStartPlan.proxies), "ide-proxy-start-plan proxies is array");
  check(ideStartPlan.proxies.length === 4, "ide-proxy-start-plan has 4 proxies");
  const idePlanIds = ideStartPlan.proxies.map((p) => p.id);
  check(idePlanIds.includes("cursor"), "ide-proxy-start-plan has cursor");
  check(idePlanIds.includes("windsurf"), "ide-proxy-start-plan has windsurf");
  check(idePlanIds.includes("vscode-copilot"), "ide-proxy-start-plan has vscode-copilot");
  check(idePlanIds.includes("antigravity"), "ide-proxy-start-plan has antigravity");
  check(ideStartPlan.safety.dryRunOnly === true, "ide-proxy-start-plan safety dryRunOnly is true");
  check(ideStartPlan.safety.startsProxyListener === false, "ide-proxy-start-plan safety startsProxyListener is false");
  check(ideStartPlan.safety.readsIdeCredentials === false, "ide-proxy-start-plan safety readsIdeCredentials is false");
  check(ideStartPlan.safety.modifiesIdeConfig === false, "ide-proxy-start-plan safety modifiesIdeConfig is false");
  check(ideStartPlan.safety.writesConfig === false, "ide-proxy-start-plan safety writesConfig is false");
  check(ideStartPlan.safety.requiresExplicitConsentBeforeRealStart === true, "ide-proxy-start-plan requires explicit consent");
  for (const proxy of ideStartPlan.proxies) {
    check(proxy.canStartNow === false, `${proxy.id} start plan canStartNow false`);
    check(["ready", "blocked", "needs_review", "needs_port_check"].includes(proxy.readiness), `${proxy.id} readiness enum`);
    check(typeof proxy.dryRunCommand === "string" && proxy.dryRunCommand.includes("--dry-run"), `${proxy.id} dry-run command`);
    check(proxy.safety.startsProxyListener === false, `${proxy.id} start plan does not start listener`);
    check(proxy.safety.readsIdeCredentials === false, `${proxy.id} start plan does not read IDE credentials`);
    check(proxy.safety.writesConfig === false, `${proxy.id} start plan does not write config`);
  }
  const ideStartModelResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-start-plan?model=local:local-model&timeoutMs=50`);
  check(ideStartModelResp.status === 200, "ide-proxy-start-plan with model returns 200");
  const ideStartModel = await ideStartModelResp.json();
  for (const proxy of ideStartModel.proxies) {
    check(proxy.selectedModel === "local:local-model", `${proxy.id} start plan selectedModel matches query model`);
  }
  const ideStartLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-start-plan?live=true`);
  check(ideStartLiveResp.status === 400, "ide-proxy-start-plan live=true returns 400");
  const ideStartLive = await ideStartLiveResp.json();
  check(ideStartLive.ok === false, "ide-proxy-start-plan live=true ok=false");
  check(ideStartLive.error === "live_mode_rejected", "ide-proxy-start-plan live=true error is live_mode_rejected");
  const ideStartRealResp = await testFetch(`http://127.0.0.1:${port}/admin/ide-proxy-start-plan?start=true`);
  check(ideStartRealResp.status === 400, "ide-proxy-start-plan start=true returns 400");
  const ideStartJson = JSON.stringify(ideStartPlan);
  check(!ideStartJson.includes("sk-"), "ide-proxy-start-plan response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(ideStartJson), "ide-proxy-start-plan response does not contain JWT-like token values");

  // 0.3.15: GET /admin/local-connector-plan
  const connectorPlanResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-plan`);
  check(connectorPlanResp.status === 200, "GET /admin/local-connector-plan returns 200");
  const cp = await connectorPlanResp.json();
  check(cp.ok === true, "local-connector-plan ok=true");
  check(cp.version === expectedVersion, `local-connector-plan version ${expectedVersion}`);
  check(cp.connectors.length === 11, "local-connector-plan has 11 connectors");
  check(cp.mode === "dry-run", "local-connector-plan mode is dry-run");
  check(cp.dryRunOnly === true, "local-connector-plan dryRunOnly true");
  const cpIds = cp.connectors.map((c) => c.id);
  check(cpIds.includes("claude-desktop"), "connector plan has claude-desktop");
  check(cpIds.includes("claude-code"), "connector plan has claude-code");
  check(cpIds.includes("opencode"), "connector plan has opencode");
  check(cpIds.includes("openai-codex"), "connector plan has openai-codex");
  check(cpIds.includes("gemini-cli"), "connector plan has gemini-cli");
  check(cpIds.includes("vscode-copilot"), "connector plan has vscode-copilot");
  check(cp.summary.total === 11, "connector plan summary.total 11");
  check(cp.summary.planned === 11, "connector plan summary.planned 11");
  check(cp.summary.implemented === 0, "connector plan summary.implemented 0");
  check(cp.summary.credentialReads === 0, "connector plan summary.credentialReads 0");
  check(cp.summary.configWrites === 0, "connector plan summary.configWrites 0");
  const cpJsonRaw = JSON.stringify(cp);
  check(!cpJsonRaw.includes("sk-"), "local-connector-plan response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(cpJsonRaw), "local-connector-plan response does not contain JWT-like token values");
  // ?platform=linux
  const cpLinuxResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-plan?platform=linux`);
  check(cpLinuxResp.status === 200, "platform=linux returns 200");
  const cpLinux = await cpLinuxResp.json();
  check(cpLinux.platform === "linux", "platform=linux changes platform to linux");
  const claudeDesktopLinux = cpLinux.connectors.find((c) => c.id === "claude-desktop");
  check(claudeDesktopLinux.availableOnSelectedPlatform === false, "claude-desktop not available on linux");
  // ?live=true rejected
  const cpLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-plan?live=true`);
  check(cpLiveResp.status === 400, "live=true returns 400");
  const cpLive = await cpLiveResp.json();
  check(cpLive.ok === false, "live=true ok=false");
  check(cpLive.error === "live_mode_rejected", "live=true error is live_mode_rejected");
  // ?discover=true rejected
  const cpDiscoverResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-plan?discover=true`);
  check(cpDiscoverResp.status === 400, "discover=true returns 400");
  const cpDiscover = await cpDiscoverResp.json();
  check(cpDiscover.ok === false, "discover=true ok=false");
  check(cpDiscover.error === "live_mode_rejected", "discover=true error is live_mode_rejected");
  // Safety booleans
  check(cp.safety.dryRunOnly === true, "connector plan safety dryRunOnly true");
  check(cp.safety.readsTokens === false, "connector plan safety readsTokens false");
  check(cp.safety.readsCookies === false, "connector plan safety readsCookies false");
  check(cp.safety.readsSessionStorage === false, "connector plan safety readsSessionStorage false");
  check(cp.safety.readsBrowserProfiles === false, "connector plan safety readsBrowserProfiles false");
  check(cp.safety.readsIdeCredentials === false, "connector plan safety readsIdeCredentials false");
  check(cp.safety.modifiesConfig === false, "connector plan safety modifiesConfig false");
  check(cp.safety.writesSystemEnv === false, "connector plan safety writesSystemEnv false");
  check(cp.safety.startsNetworkListener === false, "connector plan safety startsNetworkListener false");

  // 0.3.16: GET /admin/local-connector-availability
  const availResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-availability`);
  check(availResp.status === 200, "GET /admin/local-connector-availability returns 200");
  const ca = await availResp.json();
  check(ca.ok === true, "local-connector-availability ok=true");
  check(ca.version === expectedVersion, `local-connector-availability version ${expectedVersion}`);
  check(Array.isArray(ca.connectors), "local-connector-availability connectors is array");
  check(ca.connectors.length === 11, "local-connector-availability has 11 connectors");
  check(ca.mode === "dry-run", "local-connector-availability mode is dry-run");
  check(ca.dryRunOnly === true, "local-connector-availability dryRunOnly true");
  check(ca.summary.total === 11, "availability summary.total 11");
  check(ca.summary.credentialReads === 0, "availability summary.credentialReads 0");
  check(ca.summary.pathsDisclosed === 0, "availability summary.pathsDisclosed 0");
  check(ca.summary.processesStarted === 0, "availability summary.processesStarted 0");
  const caIds = ca.connectors.map((c) => c.id);
  check(caIds.includes("opencode"), "availability has opencode");
  check(caIds.includes("openai-codex"), "availability has openai-codex");
  check(caIds.includes("claude-code"), "availability has claude-code");
  // Each connector has safety block
  for (const c of ca.connectors) {
    check(c.safety.dryRunOnly === true, `${c.id} safety dryRunOnly`);
    check(c.safety.startsProcess === false, `${c.id} safety startsProcess false`);
    check(c.safety.disclosesPaths === false, `${c.id} safety disclosesPaths false`);
  }
  // ?includePaths=true rejected
  const incPResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-availability?includePaths=true`);
  check(incPResp.status === 400, "includePaths=true returns 400");
  const incP = await incPResp.json();
  check(incP.ok === false, "includePaths=true ok=false");
  check(incP.error === "path_disclosure_rejected", "includePaths=true error is path_disclosure_rejected");
  // ?live=true rejected
  const caLiveResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-availability?live=true`);
  check(caLiveResp.status === 400, "availability live=true returns 400");
  const caLive = await caLiveResp.json();
  check(caLive.ok === false, "availability live=true ok=false");
  check(caLive.error === "live_mode_rejected", "availability live=true error is live_mode_rejected");
  // ?discover=true rejected
  const caDiscoverResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-availability?discover=true`);
  check(caDiscoverResp.status === 400, "availability discover=true returns 400");
  const caDiscover = await caDiscoverResp.json();
  check(caDiscover.ok === false, "availability discover=true ok=false");
  check(caDiscover.error === "live_mode_rejected", "availability discover=true error is live_mode_rejected");
  // JSON does not include API keys, JWT tokens, absolute Windows paths, /home paths, credential filenames
  const caJsonRaw = JSON.stringify(ca);
  check(!caJsonRaw.includes("sk-"), "availability response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(caJsonRaw), "availability response does not contain JWT-like token values");
  check(!/[A-Z]:\\/.test(caJsonRaw), "availability response does not contain absolute Windows paths");
  check(!/\/home\/\w+/.test(caJsonRaw), "availability response does not contain /home paths");
  check(!caJsonRaw.includes("master.key"), "availability response does not contain master.key filename");

  // 0.3.17: GET /admin/local-connector-provider-preview
  const ppResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-provider-preview`);
  check(ppResp.status === 200, "GET /admin/local-connector-provider-preview returns 200");
  const pp = await ppResp.json();
  check(pp.ok === true, "local-connector-provider-preview ok=true");
  check(pp.version === expectedVersion, `local-connector-provider-preview version ${expectedVersion}`);
  check(Array.isArray(pp.providers), "local-connector-provider-preview providers is array");
  check(pp.providers.length === 11, "local-connector-provider-preview has 11 providers");
  check(pp.mode === "dry-run", "local-connector-provider-preview mode is dry-run");
  check(pp.dryRunOnly === true, "local-connector-provider-preview dryRunOnly true");
  check(pp.summary.total === 11, "provider preview summary.total 11");
  check(pp.summary.routesRegistered === 0, "provider preview summary.routesRegistered 0");
  check(pp.summary.credentialReads === 0, "provider preview summary.credentialReads 0");
  check(pp.summary.pathsDisclosed === 0, "provider preview summary.pathsDisclosed 0");
  check(pp.summary.processesStarted === 0, "provider preview summary.processesStarted 0");
  const ppIds = pp.providers.map((p) => p.id);
  check(ppIds.includes("opencode"), "provider preview has opencode");
  check(ppIds.includes("openai-codex"), "provider preview has openai-codex");
  check(ppIds.includes("claude-code"), "provider preview has claude-code");
  check(ppIds.includes("claude-desktop"), "provider preview has claude-desktop");
  check(ppIds.includes("gemini-cli"), "provider preview has gemini-cli");
  check(ppIds.includes("kiro"), "provider preview has kiro");
  check(ppIds.includes("windsurf"), "provider preview has windsurf");
  check(ppIds.includes("antigravity"), "provider preview has antigravity");
  check(ppIds.includes("vscode-copilot"), "provider preview has vscode-copilot");
  check(ppIds.includes("rovo-dev"), "provider preview has rovo-dev");
  check(ppIds.includes("qclaw"), "provider preview has qclaw");
  for (const p of pp.providers) {
    check(p.registered === false, `${p.id} registered is false`);
    check(p.credentialStatus === "not_checked", `${p.id} credentialStatus is not_checked`);
    check(typeof p.readiness === "string", `${p.id} has readiness`);
    check(Array.isArray(p.blockers), `${p.id} has blockers array`);
    check(typeof p.providerName === "string", `${p.id} has providerName`);
    check(typeof p.directRoute === "string", `${p.id} has directRoute`);
    check(Array.isArray(p.apiFormats), `${p.id} has apiFormats`);
    check(typeof p.upstreamQuotaSource === "string", `${p.id} has upstreamQuotaSource`);
    check(Array.isArray(p.modelHints), `${p.id} has modelHints`);
    check(p.safety.dryRunOnly === true, `${p.id} safety dryRunOnly`);
    check(p.safety.registersRoutes === false, `${p.id} safety registersRoutes false`);
    check(p.safety.startsProcess === false, `${p.id} safety startsProcess false`);
    check(p.safety.disclosesPaths === false, `${p.id} safety disclosesPaths false`);
  }
  // ?includePaths=true rejected
  const incPPResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-provider-preview?includePaths=true`);
  check(incPPResp.status === 400, "provider preview includePaths=true returns 400");
  const incPP = await incPPResp.json();
  check(incPP.ok === false, "provider preview includePaths=true ok=false");
  check(incPP.error === "path_disclosure_rejected", "provider preview includePaths=true error is path_disclosure_rejected");
  // ?live=true / ?discover=true / ?connect=true / ?start=true rejected
  for (const param of ["live", "discover", "connect", "start"]) {
    const pResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-provider-preview?${param}=true`);
    check(pResp.status === 400, `provider preview ${param}=true returns 400`);
    const pBody = await pResp.json();
    check(pBody.ok === false, `provider preview ${param}=true ok=false`);
    check(pBody.error === "live_mode_rejected", `provider preview ${param}=true error is live_mode_rejected`);
  }
  const ppJsonRaw = JSON.stringify(pp);
  check(!ppJsonRaw.includes("sk-"), "provider preview response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(ppJsonRaw), "provider preview response does not contain JWT-like token values");
  check(!/[A-Z]:\\/.test(ppJsonRaw), "provider preview response does not contain absolute Windows paths");
  check(!/\/home\/\w+/.test(ppJsonRaw), "provider preview response does not contain /home paths");
  check(!ppJsonRaw.includes("master.key"), "provider preview response does not contain master.key filename");
  check(!ppJsonRaw.includes("child_process"), "provider preview response does not contain child_process references");
  check(!ppJsonRaw.includes("exec("), "provider preview response does not contain exec() references");
  check(!ppJsonRaw.includes("spawn("), "provider preview response does not contain spawn() references");

  // 0.3.18: GET /admin/local-connector-consent-manifest
  const consentResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-consent-manifest`);
  check(consentResp.status === 200, "GET /admin/local-connector-consent-manifest returns 200");
  const cm = await consentResp.json();
  check(cm.ok === true, "local-connector-consent-manifest ok=true");
  check(cm.version === expectedVersion, `local-connector-consent-manifest version ${expectedVersion}`);
  check(Array.isArray(cm.manifests), "local-connector-consent-manifest manifests is array");
  check(cm.manifests.length === 11, "local-connector-consent-manifest has 11 manifests");
  check(cm.mode === "dry-run", "local-connector-consent-manifest mode is dry-run");
  check(cm.dryRunOnly === true, "local-connector-consent-manifest dryRunOnly true");
  check(cm.summary.total === 11, "consent manifest summary.total 11");
  check(cm.summary.consentRequired === 11, "consent manifest summary.consentRequired 11");
  check(cm.summary.approved === 0, "consent manifest summary.approved 0");
  check(cm.summary.canProceed === 0, "consent manifest summary.canProceed 0");
  check(cm.summary.credentialReads === 0, "consent manifest summary.credentialReads 0");
  check(cm.summary.pathsDisclosed === 0, "consent manifest summary.pathsDisclosed 0");
  check(cm.summary.processesStarted === 0, "consent manifest summary.processesStarted 0");
  check(cm.summary.routesRegistered === 0, "consent manifest summary.routesRegistered 0");
  check(cm.summary.consentStored === 0, "consent manifest summary.consentStored 0");
  const cmIds = cm.manifests.map((m) => m.id);
  for (const id of ["claude-desktop", "claude-code", "kiro", "windsurf", "antigravity", "opencode", "vscode-copilot", "openai-codex", "gemini-cli", "rovo-dev", "qclaw"]) {
    check(cmIds.includes(id), `consent manifest has ${id}`);
  }
  for (const m of cm.manifests) {
    check(m.consentStatus === "not_requested", `${m.id} consentStatus is not_requested`);
    check(m.approvalState === "not_approved", `${m.id} approvalState is not_approved`);
    check(m.canProceed === false, `${m.id} canProceed false`);
    check(typeof m.credentialScope === "string", `${m.id} has credentialScope`);
    check(typeof m.riskLevel === "string", `${m.id} has riskLevel`);
    check(Array.isArray(m.requiredConsent), `${m.id} has requiredConsent`);
    check(Array.isArray(m.forbiddenNow), `${m.id} has forbiddenNow`);
    check(Array.isArray(m.reviewTags), `${m.id} has reviewTags`);
    check(m.blockers.includes("explicit_user_consent_required"), `${m.id} has explicit consent blocker`);
    check(m.safety.dryRunOnly === true, `${m.id} consent safety dryRunOnly`);
    check(m.safety.readsTokens === false, `${m.id} consent safety readsTokens false`);
    check(m.safety.readsKeychain === false, `${m.id} consent safety readsKeychain false`);
    check(m.safety.returnsLocalPaths === false, `${m.id} consent safety returnsLocalPaths false`);
    check(m.safety.startsProcess === false, `${m.id} consent safety startsProcess false`);
    check(m.safety.registersRoutes === false, `${m.id} consent safety registersRoutes false`);
    check(m.safety.storesConsent === false, `${m.id} consent safety storesConsent false`);
  }
  const incCMResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-consent-manifest?includePaths=true`);
  check(incCMResp.status === 400, "consent manifest includePaths=true returns 400");
  const incCM = await incCMResp.json();
  check(incCM.ok === false, "consent manifest includePaths=true ok=false");
  check(incCM.error === "path_disclosure_rejected", "consent manifest includePaths=true error is path_disclosure_rejected");
  for (const param of ["live", "discover", "connect", "start", "apply", "approve"]) {
    const cResp = await testFetch(`http://127.0.0.1:${port}/admin/local-connector-consent-manifest?${param}=true`);
    check(cResp.status === 400, `consent manifest ${param}=true returns 400`);
    const cBody = await cResp.json();
    check(cBody.ok === false, `consent manifest ${param}=true ok=false`);
    check(cBody.error === "live_mode_rejected", `consent manifest ${param}=true error is live_mode_rejected`);
  }
  const cmJsonRaw = JSON.stringify(cm);
  check(!cmJsonRaw.includes("sk-"), "consent manifest response does not contain sk- tokens");
  check(!/eyJ[A-Za-z0-9_-]{10,}/.test(cmJsonRaw), "consent manifest response does not contain JWT-like token values");
  check(!/[A-Z]:\\/.test(cmJsonRaw), "consent manifest response does not contain absolute Windows paths");
  check(!/\/home\/\w+/.test(cmJsonRaw), "consent manifest response does not contain /home paths");
  check(!cmJsonRaw.includes("oauth_creds"), "consent manifest response does not contain oauth_creds filename");
  check(!cmJsonRaw.includes("master.key"), "consent manifest response does not contain master.key filename");
  check(!cmJsonRaw.includes("child_process"), "consent manifest response does not contain child_process references");
  check(!cmJsonRaw.includes("exec("), "consent manifest response does not contain exec() references");
  check(!cmJsonRaw.includes("spawn("), "consent manifest response does not contain spawn() references");

  // provider filter
  if (status.providers.length > 0) {
    const firstProviderName = status.providers[0].name;
    const previewFilterResp = await testFetch(`http://127.0.0.1:${port}/admin/provider-test-preview?provider=${encodeURIComponent(firstProviderName)}`);
    check(previewFilterResp.status === 200, "provider-filtered preview returns 200");
    const previewFilter = await previewFilterResp.json();
    check(previewFilter.providers.length === 1, "provider-filtered preview has 1 provider");
    check(previewFilter.providers[0].name === firstProviderName, "provider-filtered preview returns correct provider");
  }
} catch (error) {
  failures.push("uncaught: " + error.message);
  console.log("  uncaught", error.message);
} finally {
  // 0.5.5: await full relay exit. The 0.5.4 line's
  // proc.kill() + setTimeout(200) was not enough for the child
  // stdio Sockets to release on Windows; the safety net picked
  // up the slack. killChildProcess is the explicit contract.
  await killChildProcess(proc);
  await cleanupTempDir(tmpRoot);
}

if (failures.length > 0) {
  console.log(`${failures.length} failed`);
  process.exit(1);
} else {
  console.log("all passed");
}
