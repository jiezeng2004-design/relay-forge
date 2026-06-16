import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isLoopbackHost } from "./config.js";
import { isLocalProvider } from "./provider-registry.js";

export function checkProviderBaseUrl(provider) {
  if (!provider.baseUrl) return { ok: false, issue: "missing_base_url" };
  try {
    const parsed = new URL(provider.baseUrl);
    const needsKey = !isLocalProvider(provider);
    if (parsed.protocol !== "https:" && !isLoopbackHost(parsed.hostname) && !provider.allowInsecureHttp && needsKey) {
      return { ok: false, issue: "insecure_remote_url", detail: `${provider.baseUrl} must use https for remote providers` };
    }
    return { ok: true };
  } catch {
    return { ok: false, issue: "invalid_base_url" };
  }
}

function defaultGetProviderKeys(provider) {
  if (!provider.keyEnv) return [null];
  return String(process.env[provider.keyEnv] || "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export function describeKeySource(provider, getProviderKeys = defaultGetProviderKeys) {
  if (isLocalProvider(provider)) return { type: "local", detail: "local models need no key", present: true };
  if (provider.keyEnv) {
    const keys = getProviderKeys(provider);
    if (keys.length > 0 && keys[0]) return { type: "env", envName: provider.keyEnv, count: keys.length, present: true };
    return { type: "env", envName: provider.keyEnv, count: 0, present: false };
  }
  return { type: "none", present: false };
}

export function describeProviderStatus(provider, getProviderKeys = defaultGetProviderKeys) {
  const issues = [];
  const urlCheck = checkProviderBaseUrl(provider);
  if (!urlCheck.ok) issues.push(urlCheck.issue);
  if (!Array.isArray(provider.models) || provider.models.length === 0) issues.push("no_models");
  if (!provider.apiFormat) issues.push("missing_api_format");
  if (provider.apiFormat && !["openai", "anthropic"].includes(provider.apiFormat)) issues.push("unsupported_api_format");
  const keyInfo = describeKeySource(provider, getProviderKeys);
  if (!keyInfo.present && !isLocalProvider(provider)) issues.push("missing_key_source");
  if (issues.length === 0) return "ok";
  if (issues.length <= 2) return "warning";
  return "error";
}

export function buildProviderReport(provider, getProviderKeys = defaultGetProviderKeys) {
  const keyInfo = describeKeySource(provider, getProviderKeys);
  const urlCheck = checkProviderBaseUrl(provider);
  const issues = [];
  if (!urlCheck.ok) issues.push(urlCheck);
  if (!Array.isArray(provider.models) || provider.models.length === 0) issues.push({ ok: false, issue: "no_models" });
  if (!provider.apiFormat) issues.push({ ok: false, issue: "missing_api_format" });
  if (provider.apiFormat && !["openai", "anthropic"].includes(provider.apiFormat)) {
    issues.push({ ok: false, issue: "unsupported_api_format", detail: provider.apiFormat });
  }
  if (!keyInfo.present && !isLocalProvider(provider)) issues.push({ ok: false, issue: "missing_key_source" });

  return {
    name: provider.name,
    displayName: provider.displayName || provider.name,
    apiFormat: provider.apiFormat || "unknown",
    baseUrl: provider.baseUrl || null,
    hasBaseUrl: !!provider.baseUrl,
    modelCount: Array.isArray(provider.models) ? provider.models.length : 0,
    models: Array.isArray(provider.models) ? provider.models.slice(0, 5) : [],
    keySource: keyInfo.type,
    keyEnv: provider.keyEnv || null,
    keyCount: keyInfo.count || 0,
    hasKey: keyInfo.present,
    local: isLocalProvider(provider),
    status: describeProviderStatus(provider, getProviderKeys),
    issues: issues.map(i => i.issue || i)
  };
}

export function buildProviderTestReport(config, opts = {}) {
  const localOnly = opts.localOnly === true;
  const providerFilter = opts.provider || null;
  const getProviderKeys = opts.getProviderKeys || defaultGetProviderKeys;
  const rootDir = opts.rootDir || (typeof process !== "undefined" ? process.cwd() : ".");

  const allFiltered = localOnly
    ? config.providers.filter(p => isLocalProvider(p))
    : config.providers;

  const providers = providerFilter
    ? allFiltered.filter(p => p.name === providerFilter)
    : allFiltered;

  const version = readPackageVersion(rootDir);

  if (providers.length === 0) {
    const entry = providerFilter
      ? { ok: false, error: `provider_not_found: ${providerFilter}` }
      : localOnly
        ? { ok: false, error: "no_local_providers_configured" }
        : { ok: false, error: "no_providers_configured" };
    return {
      version,
      mode: "dry-run",
      timestamp: new Date().toISOString(),
      localOnly,
      providerFilter,
      providerCount: config.providers.length,
      providers: config.providers.map(p => buildProviderReport(p, getProviderKeys)),
      entry,
      summary: { total: 0, ok: 0, warning: 0, error: 0 },
      ok: false
    };
  }

  const reports = providers.map(p => buildProviderReport(p, getProviderKeys));
  const summaryCounts = { ok: 0, warning: 0, error: 0 };
  for (const r of reports) {
    if (r.status === "ok") summaryCounts.ok++;
    else if (r.status === "warning") summaryCounts.warning++;
    else summaryCounts.error++;
  }

  const report = {
    version,
    mode: "dry-run",
    timestamp: new Date().toISOString(),
    localOnly,
    providerFilter,
    providerCount: config.providers.length,
    providers: reports,
    summary: summaryCounts
  };

  report.ok = summaryCounts.error === 0 && summaryCounts.warning === 0;
  return report;
}

export function readPackageVersion(rootDir) {
  try {
    const pkg = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}
