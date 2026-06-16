import { PROVIDER_TEMPLATES } from "../src/provider-registry.js";
import { buildProviderTemplateParity } from "../src/provider-template-parity.js";

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
function assert(condition, message) {
  if (!condition) throw new Error("assertion failed: " + message);
}
function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

test("returns dry-run provider template parity report", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  assertEqual(result.ok, true, "ok");
  assertEqual(result.mode, "dry-run", "mode");
  assertEqual(result.dryRunOnly, true, "dryRunOnly");
  assertEqual(result.version, "0.3.32", "default version");
});

test("covers upstream published API/local provider target", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  assert(result.summary.totalTemplates >= 34, "at least 34 API/local provider templates");
  assertEqual(result.upstreamTargets.apiLocalProviders, 34, "api/local target");
  assertEqual(result.upstreamTargets.localConnectors, 11, "local connector target");
  assertEqual(result.upstreamTargets.nonVirtualProviders, 45, "non-virtual target");
  assertEqual(result.summary.apiLocalTargetCovered, true, "api/local target covered");
  assert(result.summary.nonVirtualWithLocalConnectors >= 45, "templates plus local connectors cover non-virtual target");
});

test("classifies local and API templates", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  assertEqual(result.summary.localTemplates, 5, "five local endpoint templates");
  assert(result.summary.apiTemplates >= 29, "at least 29 API templates");
  const ollama = result.providers.find((provider) => provider.name === "ollama");
  const groq = result.providers.find((provider) => provider.name === "groq");
  assert(ollama && ollama.local === true, "ollama is local");
  assertEqual(ollama.parityRole, "local_endpoint", "ollama role");
  assert(groq && groq.local === false, "groq is API provider");
  assertEqual(groq.parityRole, "direct_api", "groq role");
});

test("marks provider templates that require user-specific base URLs", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  const cloudflare = result.providers.find((provider) => provider.name === "cloudflare-ai");
  const azure = result.providers.find((provider) => provider.name === "azure-openai");
  const kilo = result.providers.find((provider) => provider.name === "kilo");
  const llm7 = result.providers.find((provider) => provider.name === "llm7");
  const blazeapi = result.providers.find((provider) => provider.name === "blazeapi");
  const bazaarlink = result.providers.find((provider) => provider.name === "bazaarlink");
  assert(cloudflare && cloudflare.templateOnly === true, "cloudflare template requires URL replacement");
  assertEqual(cloudflare.configReady, false, "cloudflare not config-ready");
  assert(azure && azure.templateOnly === true, "azure template requires URL replacement");
  for (const provider of [kilo, llm7, blazeapi, bazaarlink]) {
    assert(provider && provider.templateOnly === true, `${provider?.name || "missing"} requires URL replacement`);
    assertEqual(provider.configReady, false, `${provider.name} not config-ready`);
  }
  assertEqual(result.summary.templateOnly >= 6, true, "template-only count");
});

test("tracks configured template count without reading keys", () => {
  const result = buildProviderTemplateParity({
    templates: PROVIDER_TEMPLATES,
    configuredProviders: ["ollama", "deepseek", "moonshot"]
  });
  assertEqual(result.summary.configuredTemplates, 3, "configuredTemplates");
  assert(result.providers.find((provider) => provider.name === "deepseek").configured === true, "deepseek configured");
  assert(result.providers.find((provider) => provider.name === "groq").configured === false, "groq not configured");
});

test("safety booleans prohibit side effects", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  for (const [key, value] of Object.entries(result.safety)) {
    assertEqual(value, false, `safety.${key}`);
  }
});

test("public information gaps are represented as safe placeholders and remain non-secret", () => {
  const result = buildProviderTemplateParity({ templates: PROVIDER_TEMPLATES });
  const names = result.publicInfoGaps.map((gap) => gap.name).sort();
  assertEqual(names.join(","), "bazaarlink,blazeapi,kilo,llm7", "gap names");
  assertEqual(result.missingTemplateNames.length, 0, "all public-info gaps have placeholder templates");
  for (const gap of result.publicInfoGaps) {
    assertEqual(gap.placeholderTemplate, true, `${gap.name} gap is represented by a placeholder template`);
  }
  const raw = JSON.stringify(result).toLowerCase();
  assert(!raw.includes("sk-"), "no API key-like value");
  assert(!/[a-z]:\\/.test(raw), "no Windows absolute path");
  assert(!raw.includes("/home/"), "no home path");
  assert(!raw.includes("cookie"), "no cookie reference");
});

test("version and generatedAt can be injected", () => {
  const result = buildProviderTemplateParity({
    templates: PROVIDER_TEMPLATES,
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
