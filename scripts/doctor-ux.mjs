// RelayForge doctor:ux — user-friendly diagnostic.
// Prints plain-text guidance suitable for new users.
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));

console.log(`RelayForge v${pkg.version} — UX Diagnostic`);
console.log("=".repeat(50));
console.log();

// 1. Node version
console.log(`Node.js: ${process.version}`);

// 2. Port
const port = process.env.RELAYFORGE_PORT || process.env.PORT || process.env.OPENRELAY_PORT || "18765";
console.log(`Port: ${port}`);
console.log(`Dashboard: http://127.0.0.1:${port}`);
console.log(`API endpoint: http://127.0.0.1:${port}/v1`);

// 3. Token status
const token = process.env.RELAYFORGE_TOKEN || process.env.RELAY_TOKEN || process.env.OPENRELAY_TOKEN || "";
if (token) {
  const masked = token.length > 8 ? token.slice(0, 4) + "****" + token.slice(-4) : "****";
  console.log(`Token: enabled (${masked})`);
} else {
  console.log(`Token: NOT SET — set RELAYFORGE_TOKEN in .env`);
}

// 4. Config
const configPath = process.env.RELAYFORGE_CONFIG || process.env.OPENRELAY_CONFIG || resolve(ROOT, "config.json");
if (existsSync(configPath)) {
  console.log(`Config: ${configPath}`);
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const providers = Array.isArray(config.providers) ? config.providers : [];
    const withKeys = providers.filter((p) => p.keyEnv).length;
    const local = providers.filter((p) => !p.keyEnv).length;
    const combos = Array.isArray(config.combos) ? config.combos : [];
    console.log(`Providers: ${providers.length} total (${withKeys} cloud, ${local} local)`);
    if (combos.length > 0) {
      console.log(`Combos: ${combos.map((c) => c.name).join(", ")}`);
    }
    // Check for missing keys
    const missingKey = providers.filter((p) => p.keyEnv && !process.env[p.keyEnv]);
    if (missingKey.length > 0) {
      console.log(`WARNING: ${missingKey.length} cloud provider(s) have no API key set:`);
      for (const p of missingKey) {
        console.log(`  - ${p.name}: set ${p.keyEnv} in .env`);
      }
    }
    // Check local Ollama
    const ollamaProv = providers.find((p) => p.name === "ollama");
    if (ollamaProv) {
      console.log(`Ollama: configured at ${ollamaProv.baseUrl}`);
    }
  } catch {
    console.log("Config: (parse error)");
  }
} else {
  console.log("Config: NOT FOUND — copy config.example.json to config.json");
}

console.log();
console.log("=".repeat(50));
console.log("Recommended next steps:");
console.log("1. Set RELAYFORGE_TOKEN in .env");
console.log("2. Add provider API keys (DEEPSEEK_API_KEYS, etc.) in .env");
console.log("3. Start the relay: node src/server.js");
console.log("4. Open http://127.0.0.1:" + port + " in browser");
console.log('5. Test: curl http://127.0.0.1:' + port + '/v1/models -H "Authorization: Bearer $RELAYFORGE_TOKEN"');
