import {
  PROVIDER_TEMPLATE_IMPORT_CONFIRMATION,
  buildProviderTemplateImportCandidate,
  buildProviderTemplateImportPlan
} from "../src/provider-template-import-plan.js";
import { PROVIDER_TEMPLATES } from "../src/provider-registry.js";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error("assertion failed: " + message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

test("buildProviderTemplateImportPlan returns dry-run plan with confirmation", () => {
  const result = buildProviderTemplateImportPlan({ templates: PROVIDER_TEMPLATES, configuredProviders: ["ollama"] });
  assertEqual(result.ok, true, "ok");
  assertEqual(result.mode, "dry-run", "mode");
  assertEqual(result.dryRunOnly, true, "dryRunOnly");
  assertEqual(result.version, "0.3.32", "default version");
  assertEqual(result.requiredConfirmation, PROVIDER_TEMPLATE_IMPORT_CONFIRMATION, "confirmation");
  assertEqual(result.applyEndpoint, "/admin/provider-template-import", "apply endpoint");
});

test("plan imports only missing config-ready templates", () => {
  const result = buildProviderTemplateImportPlan({
    templates: PROVIDER_TEMPLATES,
    configuredProviders: ["ollama", "openai", "deepseek"]
  });
  const names = result.importable.map((item) => item.name);
  assert(!names.includes("ollama"), "already configured ollama is skipped");
  assert(!names.includes("openai"), "already configured openai is skipped");
  assert(!names.includes("cloudflare-ai"), "placeholder cloudflare is skipped");
  assert(!names.includes("azure-openai"), "placeholder azure is skipped");
  for (const name of ["kilo", "llm7", "blazeapi", "bazaarlink"]) {
    assert(!names.includes(name), `placeholder ${name} is skipped`);
  }
  assert(names.includes("groq"), "missing groq is importable");
  assert(names.includes("cerebras"), "missing cerebras is importable");
  assert(result.summary.importableTemplates > 20, "many templates importable");
  assert(result.summary.skippedAlreadyConfigured === 3, "three already configured");
  assert(result.summary.skippedTemplateOnly >= 6, "placeholder templates skipped");
});

test("safety booleans prevent side effects in plan", () => {
  const result = buildProviderTemplateImportPlan({ templates: PROVIDER_TEMPLATES, configuredProviders: [] });
  for (const [key, value] of Object.entries(result.safety)) {
    if (key === "requiresExplicitConfirmation") assertEqual(value, true, `safety.${key}`);
    else assertEqual(value, false, `safety.${key}`);
  }
  assertEqual(result.summary.configWrites, 0, "configWrites 0");
  assertEqual(result.summary.keysStored, 0, "keysStored 0");
  assertEqual(result.summary.networkRequests, 0, "networkRequests 0");
  assertEqual(result.summary.routesRegistered, 0, "routesRegistered 0");
});

test("candidate appends importable providers without changing routes or keys", () => {
  const config = {
    defaultProvider: "ollama",
    providers: [{ name: "ollama", baseUrl: "http://127.0.0.1:11434/v1", keyEnv: null, models: ["local"] }],
    routes: [{ name: "r", candidates: [{ provider: "ollama", model: "local" }] }],
    profiles: [{ name: "default", defaultModel: "r" }]
  };
  const plan = buildProviderTemplateImportPlan({ templates: PROVIDER_TEMPLATES, configuredProviders: ["ollama"] });
  const candidate = buildProviderTemplateImportCandidate(config, plan);
  assert(candidate.providers.length === 1 + plan.importable.length, "providers appended");
  assertEqual(candidate.routes.length, 1, "routes unchanged");
  assert(candidate.providers.some((provider) => provider.name === "groq"), "groq appended");
  assert(!candidate.providers.some((provider) => provider.name === "cloudflare-ai"), "placeholder not appended");
  assert(!candidate.providers.some((provider) => provider.name === "kilo"), "public-info placeholder not appended");
  const groq = candidate.providers.find((provider) => provider.name === "groq");
  assertEqual(groq.keyEnv, "GROQ_API_KEYS", "groq keyEnv only");
  assert(!Object.prototype.hasOwnProperty.call(groq, "apiKey"), "no apiKey field");
  assert(!Object.prototype.hasOwnProperty.call(groq, "token"), "no token field");
});

test("no plan output leaks secrets, local paths, or command execution strings", () => {
  const result = buildProviderTemplateImportPlan({ templates: PROVIDER_TEMPLATES, configuredProviders: [] });
  const raw = JSON.stringify(result).toLowerCase();
  assert(!raw.includes("sk-"), "no sk-like keys");
  assert(!/[a-z]:\\/.test(raw), "no Windows absolute paths");
  assert(!raw.includes("/home/"), "no home paths");
  assert(!raw.includes("cookie"), "no cookies");
  assert(!raw.includes("child_process"), "no child_process");
  assert(!raw.includes("exec("), "no exec(");
  assert(!raw.includes("spawn("), "no spawn(");
});

test("version and generatedAt can be injected", () => {
  const result = buildProviderTemplateImportPlan({
    templates: PROVIDER_TEMPLATES,
    configuredProviders: [],
    version: "0.3.32-test",
    generatedAt: "2026-06-14T00:00:00.000Z"
  });
  assertEqual(result.version, "0.3.32-test", "version injected");
  assertEqual(result.generatedAt, "2026-06-14T00:00:00.000Z", "generatedAt injected");
});

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
