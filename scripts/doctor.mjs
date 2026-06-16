#!/usr/bin/env node
// 0.5.9: local, redacted diagnostics. Run via `npm run doctor`
// or `node scripts/doctor.mjs`. The output is safe to paste
// into a GitHub issue or an AI chat — it never contains
// API keys, relay tokens, cookies, or Authorization headers.
//
// All the collection logic lives in `doctor-lib.mjs` so the
// redaction test can import it directly without spawning
// this process and parsing stdout.
//
// 0.6.4+: --summary / --sum / -s outputs a compact JSON summary.

import { readFileSync } from "node:fs";
import { connect } from "node:net";

import { collectDoctorReport } from "./doctor-lib.mjs";

const args = process.argv.slice(2);
const isSummary = args.some(a => a === "--summary" || a === "--sum" || a === "-s");

const report = collectDoctorReport();
delete report._helpers;

if (isSummary) {
  let currentRunErrorCount = 0;
  if (report.runtimeState.exists) {
    try {
      const stateData = JSON.parse(readFileSync(report.runtimeState.path, "utf8"));
      currentRunErrorCount = Array.isArray(stateData.recentErrors) ? stateData.recentErrors.length : 0;
    } catch {
      // corrupt file, treat as zero
    }
  }

  const [serverRunning, dashboardReachable] = await Promise.all([
    checkServerRunning("127.0.0.1", report.port),
    checkDashboardReachable(report.port)
  ]);

  const detail = report.config.providersDetail || [];
  const missingKeyProviders = detail.filter(p => !p.hasKey).length;
  const localProviders = detail.filter(p => p.isLocal).length;
  const cloudProviders = detail.filter(p => !p.isLocal).length;

  const summary = {
    ok: report.config.valid && currentRunErrorCount === 0 && serverRunning,
    version: report.version,
    node: report.node,
    port: report.port,
    configValid: report.config.valid,
    tokenRequired: report.relayAuth.tokenRequired,
    tokenSource: report.relayAuth.tokenSource,
    providerCount: report.config.providers,
    routeCount: report.config.routes,
    profileCount: report.config.profiles,
    activeProfile: report.config.activeProfile,
    serverRunning,
    dashboardReachable,
    missingKeyProviders,
    localProviders,
    cloudProviders,
    currentRunErrorCount,
    historicalErrorCount: 0
  };

  process.stdout.write(JSON.stringify(summary) + "\n");
} else {
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
}

function checkServerRunning(host, port, timeout = 1000) {
  return new Promise((resolve) => {
    const sock = connect(port, host, () => {
      sock.destroy();
      resolve(true);
    });
    sock.on("error", () => { sock.destroy(); resolve(false); });
    sock.setTimeout(timeout, () => { sock.destroy(); resolve(false); });
  });
}

async function checkDashboardReachable(port, timeout = 2000) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/`, {
      method: "GET",
      signal: AbortSignal.timeout(timeout)
    });
    return resp.status === 200;
  } catch {
    return false;
  }
}
