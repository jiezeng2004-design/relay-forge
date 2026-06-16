// Tiny i18n loader. Loads both bundles eagerly (the project is
// zero-deps and the bundles together are <30KB), returns a `t()`
// function for the requested locale with fallback to English and
// finally the raw key.
//
// Param substitution uses {name} placeholders (e.g. "Found {count}
// models" -> "Found 12 models"). Unknown placeholders are left
// verbatim so a missing translation never crashes the dashboard.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const i18nDir = resolve(rootDir, "i18n");

const SUPPORTED_LOCALES = ["zh", "en"];
const DEFAULT_LOCALE = "zh";
const FALLBACK_LOCALE = "en";

const cache = new Map();

function loadBundle(locale) {
  if (cache.has(locale)) return cache.get(locale);
  const filePath = resolve(i18nDir, `${locale}.json`);
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  cache.set(locale, parsed);
  return parsed;
}

function loadAll() {
  const result = {};
  for (const locale of SUPPORTED_LOCALES) result[locale] = loadBundle(locale);
  return result;
}

function format(template, params) {
  if (!params || typeof template !== "string") return template;
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return match;
  });
}

// Lookup a key in the requested locale, falling back to English
// and finally to the key itself. Substitutes {param} placeholders.
export function translate(locale, key, params) {
  const requested = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  const primary = loadBundle(requested);
  const fallback = loadBundle(FALLBACK_LOCALE);
  const value = primary[key] != null ? primary[key] : (fallback[key] != null ? fallback[key] : key);
  return format(value, params);
}

// Construct a `t(key, params)` function bound to a locale. The
// returned function is pure (no I/O on call; bundles are cached).
export function makeT(locale) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  return (key, params) => translate(safeLocale, key, params);
}

// Eagerly load + return both bundles, with the requested locale
// as `current` and the other as `fallback`. The dashboard uses this
// to inject the active bundle into the inline <script> so the
// client can switch locales without a reload round-trip if desired
// (the current build only re-renders on a softRefresh).
export function getBundlesForClient(locale) {
  const safeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : DEFAULT_LOCALE;
  return {
    current: safeLocale,
    supported: SUPPORTED_LOCALES,
    bundles: loadAll()
  };
}

export const I18N_SUPPORTED_LOCALES = SUPPORTED_LOCALES;
export const I18N_DEFAULT_LOCALE = DEFAULT_LOCALE;
