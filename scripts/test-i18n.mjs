// Pure unit tests for src/i18n.js. No server, no I/O. Covers key
// parity between zh and en bundles, parameter substitution,
// fallback chain (zh -> en -> key), and supported-locale
// validation. Also covers the renderDashboard locale option end
// shape (since the bundle lookup is what the dashboard uses).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  I18N_DEFAULT_LOCALE,
  I18N_SUPPORTED_LOCALES,
  getBundlesForClient,
  makeT,
  translate
} from "../src/i18n.js";
import { renderDashboard } from "../src/dashboard.js";

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

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const zhRaw = JSON.parse(readFileSync(resolve(rootDir, "i18n/zh.json"), "utf8"));
const enRaw = JSON.parse(readFileSync(resolve(rootDir, "i18n/en.json"), "utf8"));

// ---- bundle integrity ----

test("supported locales are exactly [zh, en] in this order", () => {
  assertEqual(I18N_SUPPORTED_LOCALES.length, 2, "locale count");
  assertEqual(I18N_SUPPORTED_LOCALES[0], "zh", "first locale");
  assertEqual(I18N_SUPPORTED_LOCALES[1], "en", "second locale");
  assertEqual(I18N_DEFAULT_LOCALE, "zh", "default locale");
});

test("zh and en bundles have the same set of non-meta keys", () => {
  const zhKeys = Object.keys(zhRaw).filter((k) => k !== "_meta").sort();
  const enKeys = Object.keys(enRaw).filter((k) => k !== "_meta").sort();
  assertEqual(zhKeys.length, enKeys.length, "key count parity");
  for (let i = 0; i < zhKeys.length; i += 1) {
    assertEqual(zhKeys[i], enKeys[i], `key index ${i} matches`);
  }
  assert(zhKeys.length > 50, "bundle has a meaningful number of keys");
});

test("zh bundle values are all non-empty strings", () => {
  for (const [key, value] of Object.entries(zhRaw)) {
    if (key === "_meta") continue;
    assert(typeof value === "string" && value.length > 0, `zh.${key} must be non-empty`);
  }
});

test("en bundle values are all non-empty strings", () => {
  for (const [key, value] of Object.entries(enRaw)) {
    if (key === "_meta") continue;
    assert(typeof value === "string" && value.length > 0, `en.${key} must be non-empty`);
  }
});

test("en bundle actually contains English (most values contain ASCII)", () => {
  let englishCount = 0;
  for (const [key, value] of Object.entries(enRaw)) {
    if (key === "_meta") continue;
    if (/^[A-Za-z0-9 \-,.;:'"()/<>{}[\]=&?!@#$%^*+_|~`]+$/.test(value)) englishCount += 1;
  }
  assert(englishCount > Object.keys(enRaw).length * 0.6, `en bundle should be mostly English: ${englishCount}/${Object.keys(enRaw).length - 1}`);
});

// ---- translate() / makeT() ----

test("translate(zh, ...) returns the Chinese value", () => {
  assertEqual(translate("zh", "tab.overview"), "总览", "zh tab.overview");
  assertEqual(translate("zh", "app.title"), "RelayForge 管理台", "zh app.title");
});

test("translate(en, ...) returns the English value", () => {
  assertEqual(translate("en", "tab.overview"), "Overview", "en tab.overview");
  assertEqual(translate("en", "app.title"), "RelayForge Admin", "en app.title");
});

test("translate substitutes {param} placeholders", () => {
  assert(translate("en", "app.subtitle", { version: "0.5.1" }).includes("v0.5.1"), "version substituted");
  assert(translate("en", "usage.today.count", { count: 42 }).includes("42"), "count substituted");
});

test("translate with unsupported locale falls back to the default (zh)", () => {
  assertEqual(translate("xx", "tab.overview"), "总览", "falls back to zh");
});

test("translate with an unknown key returns the key itself (no crash)", () => {
  assertEqual(translate("en", "totally.bogus.key"), "totally.bogus.key", "unknown key");
});

test("translate: missing {param} placeholders are left verbatim (no crash)", () => {
  const out = translate("en", "app.subtitle", {});
  assert(out.includes("{version}"), `unknown placeholder left intact: ${out}`);
});

test("makeT(zh) is a function bound to zh", () => {
  const t = makeT("zh");
  assertEqual(t("tab.overview"), "总览", "makeT(zh) returns zh value");
});

test("makeT(en) is a function bound to en", () => {
  const t = makeT("en");
  assertEqual(t("tab.overview"), "Overview", "makeT(en) returns en value");
});

test("getBundlesForClient returns the active locale + both bundles", () => {
  const result = getBundlesForClient("en");
  assertEqual(result.current, "en", "current locale");
  assertEqual(result.supported.length, 2, "supported list");
  assert(result.bundles.zh && result.bundles.en, "both bundles present");
  assertEqual(result.bundles.zh["tab.overview"], "总览", "zh bundle content");
  assertEqual(result.bundles.en["tab.overview"], "Overview", "en bundle content");
});

test("getBundlesForClient falls back to default for bad locale", () => {
  const result = getBundlesForClient("xx");
  assertEqual(result.current, "zh", "fallback locale");
});

// ---- renderDashboard locale option ----

test("renderDashboard with default locale (zh) preserves existing chrome", () => {
  const html = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210);
  // The i18nBundle JSON is embedded in the HTML, so the en strings
  // (e.g. "OpenRelay Local Relay - Admin") appear in the page
  // source. To verify the visible topbar chrome, we look for the
  // <title> tag, the topbar h1, and the rendered tab labels
  // (which are NOT inside the JSON bundle).
  assert(html.includes("<title>RelayForge 管理台</title>"), "zh html <title>");
  assert(/<h1>RelayForge /.test(html), "zh topbar h1");
  assert(/data-tab="overview"/.test(html), "zh tab overview present");
  assert(html.includes("RELAYFORGE_TOKEN 已启用") || html.includes("RELAYFORGE_TOKEN 未设置"), "zh RELAYFORGE_TOKEN pill text");
  assert(/data-tab="providers"/.test(html), "zh tab providers present");
});

test("renderDashboard with locale=en produces English chrome in the topbar", () => {
  const html = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210, { locale: "en" });
  assert(html.includes("<title>RelayForge Admin</title>"), "en html <title>");
  assert(/<h1>RelayForge /.test(html), "en topbar subtitle");
  assert(/data-tab="overview"/.test(html), "en tab overview present");
  assert(/data-tab="providers"/.test(html), "en tab providers present");
  assert(/data-tab="settings"/.test(html), "en tab settings present");
  assert(html.includes("RELAYFORGE_TOKEN enabled") || html.includes("RELAYFORGE_TOKEN not set"), "en RELAYFORGE_TOKEN pill text");
});

test("renderDashboard with locale=zh explicitly is identical to no option", () => {
  const status = { version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] };
  const a = renderDashboard(status, 39210);
  const b = renderDashboard(status, 39210, { locale: "zh" });
  assertEqual(a, b, "explicit zh matches default");
});

test("renderDashboard locale=en still embeds the i18n bundle", () => {
  const html = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210, { locale: "en" });
  assert(html.includes("i18nBundle"), "i18n bundle script tag present");
  assert(html.includes("\"current\":\"en\""), "current locale in bundle JSON");
  assert(html.includes("\"supported\":[\"zh\",\"en\"]"), "supported list in bundle");
});

test("renderDashboard with bad locale falls back to zh without throwing", () => {
  const html = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210, { locale: "fr" });
  assert(html.includes("RelayForge"), "fr falls back to zh");
});

test("renderDashboard locale switcher is rendered in the topbar", () => {
  const html = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210, { locale: "zh" });
  assert(html.includes("id=\"locale-select\""), "locale select element present");
  assert(html.includes("action=\"/admin/locale\""), "form posts to /admin/locale");
  assert(html.includes("<option value=\"zh\" selected"), "zh option selected by default for zh locale");
  const htmlEn = renderDashboard({ version: "0.5.1", providers: [], webKeys: [], routes: [], usage: { daily: { total: 0, routes: {} } }, recentErrors: [] }, 39210, { locale: "en" });
  assert(htmlEn.includes("<option value=\"en\" selected"), "en option selected for en locale");
});

// ---- runner ----

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
