import { renderDashboard } from "../src/dashboard.js";
const status = {
  ok: true, version: "0.4.9", startedAt: "", configPath: "", statePath: "",
  providers: [], routes: [], routeTemplates: [], routeReferences: {},
  profiles: { activeProfile: "p", defaultModel: "r", profiles: [] },
  stats: {}, usage: {},
  healthCache: {}, modelDiscoveryCache: {}, balanceCache: {}, recentErrors: [],
  healthChecks: { enabled: false, intervalMinutes: 60, providers: [] },
  keys: {}, webKeys: [], secretStore: {}, providerTemplates: [],
  relayAuth: { tokenRequired: false, apiKeyHint: "local" }
};
const html = renderDashboard(status, 39210);
const m2 = html.match(/<script>([\s\S]*?)<\/script>/);
console.log("script length:", m2[1].length);
const idx = m2[1].indexOf("split(");
console.log("around split:", JSON.stringify(m2[1].slice(idx - 20, idx + 80)));
const idx2 = m2[1].indexOf("discoverModelsByUrl");
console.log("around discover:", JSON.stringify(m2[1].slice(idx2 - 10, idx2 + 100)));
import { writeFileSync } from "node:fs";
writeFileSync("D:/tmp-dashboard-script.js", m2[1]);
