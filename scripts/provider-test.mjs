#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, getProviderKeys } from "../src/config.js";
import { sanitizeErrorMessage } from "../src/error-category.js";
import {
  checkProviderBaseUrl,
  describeKeySource,
  describeProviderStatus,
  buildProviderReport,
  buildProviderTestReport,
  readPackageVersion
} from "../src/provider-test.js";

const here = fileURLToPath(import.meta.url);
const rootDir = process.env.OPENRELAY_ROOT
  ? resolve(process.env.OPENRELAY_ROOT)
  : resolve(dirname(here), "..");

function parseArgs(argv) {
  const opts = {
    mode: "dry-run",
    provider: null,
    model: null,
    json: true,
    quiet: false,
    verbose: false,
    failOn: "error",
    localOnly: false,
    timeoutMs: 15000
  };
  for (const arg of argv) {
    if (arg === "--live") opts.mode = "live";
    else if (arg === "--dry-run") opts.mode = "dry-run";
    else if (arg === "--quiet" || arg === "-q") opts.quiet = true;
    else if (arg === "--verbose" || arg === "-v") opts.verbose = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--text") opts.json = false;
    else if (arg.startsWith("--provider=")) opts.provider = arg.slice("--provider=".length).trim();
    else if (arg.startsWith("--model=")) opts.model = arg.slice("--model=".length).trim();
    else if (arg.startsWith("--fail-on=")) {
      const val = arg.slice("--fail-on=".length).trim();
      if (["error", "warning", "never"].includes(val)) opts.failOn = val;
    }
    else if (arg === "--local-only") opts.localOnly = true;
    else if (arg.startsWith("--timeout-ms=")) {
      const parsed = parseInt(arg.slice("--timeout-ms=".length).trim(), 10);
      if (!isNaN(parsed) && parsed >= 100) opts.timeoutMs = parsed;
    }
  }
  return opts;
}

async function liveTestProvider(provider, requestedModel, opts) {
  const model = requestedModel || (Array.isArray(provider.models) && provider.models.length > 0 ? provider.models[0] : null);
  if (!model) return { ok: false, provider: provider.name, error: "no_model_available" };
  const keys = getProviderKeys(provider);
  const keyValue = keys.length > 0 ? keys[0] : null;
  if (!keyValue) return { ok: false, provider: provider.name, error: "no_key_available" };
  const startedAt = Date.now();
  const headers = { "content-type": "application/json" };
  if (provider.apiFormat === "anthropic") {
    headers["x-api-key"] = keyValue;
    headers["anthropic-version"] = provider.anthropicVersion || "2023-06-01";
  } else {
    headers.authorization = `Bearer ${keyValue}`;
  }
  if (provider.extraHeaders && typeof provider.extraHeaders === "object") Object.assign(headers, provider.extraHeaders);
  const payload = { model, messages: [{ role: "user", content: "ping" }], max_tokens: 8, temperature: 0 };
  const path = provider.apiFormat === "anthropic" ? "/messages" : "/chat/completions";
  const body = provider.apiFormat === "anthropic" ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] } : payload;
  try {
    const response = await fetch(`${provider.baseUrl}${path}`, {
      method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(opts.timeoutMs)
    });
    const responseText = await response.text();
    const elapsedMs = Date.now() - startedAt;
    let category = null;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) category = "upstream_auth";
      else if (response.status === 429) category = "upstream_429";
      else if (response.status >= 500) category = "upstream_5xx";
      else category = "upstream_error";
    }
    return {
      ok: response.ok,
      provider: provider.name,
      model,
      status: response.status,
      category,
      elapsedMs,
      bodySanitized: response.ok ? "ok" : sanitizeErrorMessage(responseText.slice(0, 200))
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    let category = "upstream_request_failed";
    if (error && (error.name === "AbortError" || error.code === "ABORT_ERR" || error.name === "TimeoutError")) category = "upstream_timeout";
    return {
      ok: false,
      provider: provider.name,
      model: model || null,
      error: "request_failed",
      category,
      message: sanitizeErrorMessage(error.message || ""),
      elapsedMs
    };
  }
}

function formatTextSummary(report) {
  const lines = [];
  lines.push(`RelayForge provider test: ${report.mode}`);
  lines.push(`Version: ${report.version}  |  Config: ${report.configPath || "N/A"}`);
  lines.push(`Total providers: ${report.providerCount}  |  Tested: ${report.providers ? report.providers.length : 0}`);
  if (report.localOnly) lines.push("Mode: local-only (skipping cloud providers)");
  if (report.failOn) lines.push(`Fail-on: ${report.failOn}`);
  lines.push("");
  if (!report.providers) {
    lines.push(`ERROR: ${report.error || report.entry?.error || "unknown"}`);
    return lines.join("\n");
  }
  for (const p of report.providers) {
    const statusIcon = p.status === "ok" ? "OK" : p.status === "warning" ? "WARN" : "FAIL";
    const localTag = p.local ? " [local]" : "";
    lines.push(`  ${statusIcon}  ${p.displayName}${localTag}  (${p.apiFormat})`);
    if (p.hasBaseUrl) lines.push(`       URL: ${p.baseUrl}`);
    else lines.push(`       URL: MISSING`);
    lines.push(`       Models: ${p.modelCount}  |  Key: ${p.keySource}${p.keyEnv ? ` (${p.keyEnv})` : ""}${p.hasKey ? "" : " MISSING"}`);
    if (p.issues.length > 0) {
      for (const issue of p.issues) lines.push(`       Issue: ${issue}`);
    }
    lines.push("");
  }
  const s = report.summary || {};
  lines.push(`Summary: ${s.ok || 0} ok, ${s.warning || 0} warnings, ${s.error || 0} errors`);
  if (report.liveResults) {
    lines.push("--- Live Tests ---");
    for (const r of report.liveResults) {
      const icon = r.ok ? "OK" : "FAIL";
      lines.push(`  ${icon}  ${r.provider}  (${r.status || r.error || r.category})  ${r.elapsedMs}ms`);
    }
  }
  return lines.join("\n");
}

const opts = parseArgs(process.argv.slice(2));

let config;
let configPath;
try {
  const loaded = loadConfig(rootDir);
  config = loaded.config;
  configPath = loaded.configPath;
} catch (error) {
  const report = {
    version: "unknown",
    mode: opts.mode,
    timestamp: new Date().toISOString(),
    ok: false,
    error: `config_load_failed: ${sanitizeErrorMessage(error.message)}`
  };
  const output = opts.json ? JSON.stringify(report, null, 2) : `ERROR: ${report.error}`;
  process.stdout.write(output + "\n");
  process.exit(2);
}

const targetName = opts.provider;
const finalReport = buildProviderTestReport(config, {
  localOnly: opts.localOnly,
  provider: targetName,
  rootDir
});

// add CLI-specific fields
finalReport.configPath = configPath;
finalReport.failOn = opts.failOn;
finalReport.mode = opts.mode;

if (opts.mode === "live" && finalReport.providers && finalReport.providers.length > 0) {
  const liveResults = [];
  for (const reportEntry of finalReport.providers) {
    const provider = config.providers.find(p => p.name === reportEntry.name);
    if (provider) {
      liveResults.push(await liveTestProvider(provider, opts.model, opts));
    }
  }
  finalReport.liveResults = liveResults;
  finalReport.liveOk = liveResults.every(r => r.ok);
}

const output = opts.json ? JSON.stringify(finalReport, null, 2) : formatTextSummary(finalReport);
process.stdout.write(output + "\n");

let exitCode;
if (opts.failOn === "never") {
  exitCode = 0;
} else if (opts.failOn === "warning") {
  exitCode = (finalReport.summary.error === 0 && finalReport.summary.warning === 0) ? 0 : 1;
} else {
  exitCode = (finalReport.summary.error === 0) ? 0 : 1;
}
process.exit(exitCode);
