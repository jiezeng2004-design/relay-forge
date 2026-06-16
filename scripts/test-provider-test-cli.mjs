import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupTempDir } from "./test-utils.mjs";
import { createServer } from "node:http";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NODE = process.execPath;
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) { passed++; }
  else {
    failed++;
    console.error(`FAIL: ${label}`);
  }
}

async function runProviderTest(args, envOverrides = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(NODE, ["scripts/provider-test.mjs", ...args], {
      cwd: rootDir,
      env: { ...process.env, ...envOverrides },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => { stdout += c.toString(); });
    child.stderr.on("data", (c) => { stderr += c.toString(); });
    child.on("close", (code) => {
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function testDryRun() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-dryrun-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "test-provider",
      providers: [
        { name: "test-provider", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "TEST_API_KEY", models: ["model-a", "model-b"] },
        { name: "local-provider", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", keyEnv: null, models: ["local-model"] }
      ],
      routes: [{ name: "default", candidates: [{ provider: "test-provider", model: "model-a" }], strategy: "fallback" }],
      profiles: [{ name: "default", defaultModel: "model-a" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      TEST_API_KEY: "sk-test123"
    });

    const data = JSON.parse(result.stdout);
    assert(data.ok === true, "dry-run: ok=true for valid config");
    assert(data.mode === "dry-run", "dry-run: mode is dry-run");
    assert(Array.isArray(data.providers), "dry-run: providers is array");
    assert(data.providers.length === 2, "dry-run: 2 providers");
    assert(data.providers[0].name === "test-provider", "dry-run: first provider name");
    assert(data.providers[0].hasBaseUrl === true, "dry-run: hasBaseUrl");
    assert(data.providers[0].modelCount === 2, "dry-run: modelCount=2");
    assert(data.providers[0].hasKey === true, "dry-run: hasKey=true when env set");
    assert(data.providers[0].keySource === "env", "dry-run: keySource=env");
    assert(data.providers[0].status === "ok", "dry-run: status=ok");
    // Local provider: keySource=local, present=true because local needs no key
    assert(data.providers[1].local === true, "dry-run: second provider is local");
    assert(data.providers[1].hasKey === true, "dry-run: local provider hasKey=true (implicitly available)");
    assert(data.providers[1].keySource === "local", "dry-run: local provider keySource=local");
    assert(data.providers[1].status === "ok", "dry-run: local provider status=ok");
    assert(data.summary.ok === 2, "dry-run: summary.ok=2");
    assert(data.summary.error === 0, "dry-run: summary.error=0");
    assert(data.summary.warning === 0, "dry-run: summary.warning=0");
    const stdoutLower = result.stdout.toLowerCase();
    assert(!stdoutLower.includes("sk-test123"), "dry-run: API key not leaked in output");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testMissingModels() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-nomodels-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "no-models",
      providers: [
        { name: "no-models", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "TEST_KEY", models: [] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "no-models:model-x" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json", "--fail-on=warning"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      TEST_KEY: "sk-valid"
    });

    const data = JSON.parse(result.stdout);
    assert(data.providers.length === 1, "missing-models: 1 provider");
    assert(data.providers[0].modelCount === 0, "missing-models: modelCount=0");
    assert(data.providers[0].issues.includes("no_models"), "missing-models: issue=no_models");
    assert(data.providers[0].status !== "ok", "missing-models: status not ok");
    assert(result.code !== 0, "missing-models: exit code != 0");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testMissingKey() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-nokey-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "no-key",
      providers: [
        { name: "no-key", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "MISSING_KEY_ENV", models: ["model-x"] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "model-x" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json", "--fail-on=warning"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
      // Do NOT set MISSING_KEY_ENV — intentionally absent
    });

    const data = JSON.parse(result.stdout);
    assert(data.providers[0].hasKey === false, "missing-key: hasKey=false");
    assert(data.providers[0].keyCount === 0, "missing-key: keyCount=0");
    assert(data.providers[0].status !== "ok", "missing-key: status not ok");
    assert(data.providers[0].issues.includes("missing_key_source"), "missing-key: issue=missing_key_source");
    assert(result.code !== 0, "missing-key: exit code != 0");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testMissingBaseUrl() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-nourl-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "no-url",
      providers: [
        { name: "no-url", baseUrl: "", apiFormat: "openai", keyEnv: "TEST_KEY", models: ["model-x"] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "model-x" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      TEST_KEY: "sk-test"
    });

    // Empty baseUrl fails normalizeConfig — expects config_load_failed error
    const data = JSON.parse(result.stdout);
    assert(data.ok === false, "missing-url: ok=false");
    assert(typeof data.error === "string" && data.error.includes("config_load_failed"), "missing-url: config_load_failed error");
    assert(result.code !== 0, "missing-url: exit code != 0");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testInvalidBaseUrl() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-invalidurl-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "bad-url",
      providers: [
        { name: "bad-url", baseUrl: "not-a-url", apiFormat: "openai", keyEnv: "TEST_KEY", models: ["model-x"] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "model-x" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      TEST_KEY: "sk-test"
    });

    // "not-a-url" fails normalizeConfig — expects config_load_failed error
    const data = JSON.parse(result.stdout);
    assert(data.ok === false, "invalid-url: ok=false");
    assert(typeof data.error === "string" && data.error.includes("config_load_failed"), "invalid-url: config_load_failed error");
    assert(result.code !== 0, "invalid-url: exit code != 0");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testProviderFilter() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-filter-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "provider-a",
      providers: [
        { name: "provider-a", baseUrl: "https://api.a.com/v1", apiFormat: "openai", keyEnv: "KEY_A", models: ["model-a"] },
        { name: "provider-b", baseUrl: "https://api.b.com/v1", apiFormat: "openai", keyEnv: "KEY_B", models: ["model-b"] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "model-a" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json", "--provider=provider-a"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      KEY_A: "sk-a",
      KEY_B: "sk-b"
    });

    const data = JSON.parse(result.stdout);
    assert(data.providers.length === 1, "filter: only 1 provider returned");
    assert(data.providers[0].name === "provider-a", "filter: correct provider");
    assert(data.providerFilter === "provider-a", "filter: providerFilter set");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testLiveWithMock() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-live-"));
  try {
    // Use allowInsecureHttp:true + IP that is NOT loopback so isLocalProvider
    // returns false and liveTestProvider proceeds to make the real HTTP call.
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "mock-ok",
      providers: [
        { name: "mock-ok", baseUrl: "http://127.0.0.1:18999/v1", apiFormat: "openai", keyEnv: "MOCK_KEY", models: ["mock-model"], allowInsecureHttp: true },
        { name: "mock-401", baseUrl: "http://127.0.0.1:18999/v1", apiFormat: "openai", keyEnv: "MOCK_KEY_401", models: ["mock-model"], allowInsecureHttp: true }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "mock-model" }],
      activeProfile: "default"
    }, null, 2));

    const mockServer = createServer((req, res) => {
      if (req.url && req.url.includes("chat/completions")) {
        const auth = req.headers.authorization || "";
        if (auth.includes("key-ok")) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ id: "mock", choices: [{ message: { role: "assistant", content: "pong" } }] }));
        } else if (auth.includes("key-401")) {
          res.writeHead(401, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "invalid api key", code: "invalid_api_key" } }));
        } else {
          res.writeHead(429, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: "rate limit", code: "rate_limit" } }));
        }
      } else {
        res.writeHead(404);
        res.end("not found");
      }
    });

    await new Promise((resolveListen) => mockServer.listen(18999, "127.0.0.1", resolveListen));

    const result = await runProviderTest(["--json", "--live", "--provider=mock-ok"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      MOCK_KEY: "key-ok-valid"
    });

    const result401 = await runProviderTest(["--json", "--live", "--provider=mock-401"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      MOCK_KEY_401: "key-401-invalid"
    });

    await new Promise((resolveClose) => mockServer.close(resolveClose));

    const data200 = JSON.parse(result.stdout);
    assert(data200.mode === "live", "live: mode=live");
    assert(Array.isArray(data200.liveResults), "live: liveResults array");
    assert(data200.liveResults.length === 1, "live: 1 live result");
    assert(data200.liveResults[0].ok === true, "live: mock 200 ok");
    assert(data200.liveResults[0].status === 200, "live: mock 200 status");

    const data401 = JSON.parse(result401.stdout);
    assert(data401.liveResults[0].ok === false, "live: mock 401 not ok");
    assert(data401.liveResults[0].status === 401, "live: mock 401 status");
    assert(data401.liveResults[0].category === "upstream_auth", "live: 401 category=upstream_auth");

    // Secret keys must not leak in output
    assert(!result.stdout.includes("key-ok-valid"), "live: key not leaked in 200 output");
    assert(!result401.stdout.includes("key-401-invalid"), "live: key not leaked in 401 output");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testNoKeyLeak() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-leak-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "leak-check",
      providers: [
        { name: "leak-check", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "SUPER_SECRET_ENV", models: ["model-z"] }
      ],
      routes: [],
      profiles: [{ name: "default", defaultModel: "model-z" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      SUPER_SECRET_ENV: "sk-real-secret-key-12345"
    });

    // The actual secret value (key) must never appear in output
    assert(!result.stdout.includes("sk-real-secret-key-12345"), "no-leak: API key not in output");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testDefaultJsonOutput() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-provider-test-jsonout-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "json-check",
      providers: [{ name: "json-check", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "JSON_TEST_KEY", models: ["m1"] }],
      routes: [],
      profiles: [{ name: "default", defaultModel: "m1" }],
      activeProfile: "default"
    }, null, 2));

    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot,
      OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      JSON_TEST_KEY: "sk-json-test"
    });

    assert(result.code === 0, "json-output: exit code 0");
    assert(result.stdout.trim().startsWith("{"), "json-output: starts with {");
    const parsed = JSON.parse(result.stdout);
    assert(typeof parsed.version === "string", "json-output: version is string");
    assert(typeof parsed.timestamp === "string", "json-output: timestamp is string");
  } finally {
    await cleanupTempDir(tmpRoot);
  }
}

async function testFailOnDefault() {
  // --fail-on=error (default): warning-only config should exit 0
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-failon-err-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "cloud-a",
      providers: [
        { name: "cloud-a", baseUrl: "https://api.a.com/v1", apiFormat: "openai", keyEnv: "KEY_A", models: ["m1"] },
        { name: "local-ok", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", models: ["lm"] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    // KEY_A not set → cloud-a will be warning (missing_key_source), not error (only 1 issue)
    const result = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    const data = JSON.parse(result.stdout);
    // cloud-a: missing key = warning (1 issue), local-ok: ok
    assert(data.summary.warning >= 1, "failon-default: warning present");
    assert(data.summary.error === 0, "failon-default: no errors");
    assert(result.code === 0, "failon-default: exit 0 for warnings-only");
    assert(data.ok === false, "failon-default: ok=false (strict health: warnings still ok=false)");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testFailOnWarning() {
  // --fail-on=warning: warning should exit 1
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-failon-warn-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "cloud-a",
      providers: [
        { name: "cloud-a", baseUrl: "https://api.a.com/v1", apiFormat: "openai", keyEnv: "KEY_A", models: ["m1"] },
        { name: "local-ok", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", models: ["lm"] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    const result = await runProviderTest(["--json", "--fail-on=warning"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    const data = JSON.parse(result.stdout);
    assert(data.summary.warning >= 1, "failon-warning: warning present");
    assert(data.ok === false, "failon-warning: ok=false");
    assert(result.code !== 0, "failon-warning: exit 1 for warnings");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testFailOnNever() {
  // --fail-on=never: error config should still exit 0, but JSON has ok=false
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-failon-never-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "broken",
      providers: [
        { name: "broken", baseUrl: "https://api.example.com/v1", apiFormat: "openai", models: [] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "broken:no_model" }], activeProfile: "default"
    }, null, 2));
    // no models + missing key env = 2 issues → warning status (error not reachable with valid normalized config)
    const result = await runProviderTest(["--json", "--fail-on=never"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    const data = JSON.parse(result.stdout);
    assert(data.summary.warning >= 1, "failon-never: warnings present");
    assert(data.summary.error === 0, "failon-never: no errors (warning only)");
    // ok=false because there are warnings (strict ok requires no errors AND no warnings)
    assert(data.ok === false, "failon-never: ok=false (strict health: warnings cause ok=false)");
    assert(result.code === 0, "failon-never: exit 0 despite warnings");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testLocalOnly() {
  // --local-only: only local providers returned, cloud ones skipped
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-localonly-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "local-ollama",
      providers: [
        { name: "cloud-a", baseUrl: "https://api.a.com/v1", apiFormat: "openai", keyEnv: "KEY_A", models: ["m1"] },
        { name: "local-ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", models: ["llama3"] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    const result = await runProviderTest(["--json", "--local-only"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    const data = JSON.parse(result.stdout);
    assert(data.localOnly === true, "local-only: localOnly flag in output");
    assert(data.providers.length === 1, "local-only: only 1 local provider");
    assert(data.providers[0].local === true, "local-only: provider is local");
    assert(data.providers[0].name === "local-ollama", "local-only: correct provider");
    assert(data.ok === true, "local-only: ok=true (local needs no key)");
    assert(result.code === 0, "local-only: exit 0");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testLocalOnlyWithProviderFilter() {
  // --local-only + --provider=<local> works; --provider=<cloud> returns empty
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-localonly-filt-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "local-ollama",
      providers: [
        { name: "cloud-a", baseUrl: "https://api.a.com/v1", apiFormat: "openai", keyEnv: "KEY_A", models: ["m1"] },
        { name: "local-ollama", baseUrl: "http://127.0.0.1:11434/v1", apiFormat: "openai", models: ["llama3"] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    // Filtering for local provider should work
    const result = await runProviderTest(["--json", "--local-only", "--provider=local-ollama"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    const data = JSON.parse(result.stdout);
    assert(data.providers.length === 1, "localonly-filter: 1 provider found");
    assert(data.providers[0].name === "local-ollama", "localonly-filter: correct");
    assert(result.code === 0, "localonly-filter: exit 0");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testTimeoutMsInvalid() {
  // --timeout-ms with invalid/non-numeric value should not crash (use default 15000)
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-timeoutinv-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "ok",
      providers: [{ name: "ok", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "T_KEY", models: ["m1"] }],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    const result = await runProviderTest(["--json", "--timeout-ms=notanumber"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      T_KEY: "sk-valid"
    });
    const data = JSON.parse(result.stdout);
    assert(result.code === 0, "timeout-invalid: exit 0 (no crash)");
    assert(data.ok === true, "timeout-invalid: ok=true");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testTimeoutMsNegative() {
  // --timeout-ms with value < 100 should fallback to default (15000)
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-timeoutneg-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "ok",
      providers: [{ name: "ok", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "T_KEY", models: ["m1"] }],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    const result = await runProviderTest(["--json", "--timeout-ms=-1"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      T_KEY: "sk-valid"
    });
    const data = JSON.parse(result.stdout);
    assert(result.code === 0, "timeout-negative: exit 0 (no crash)");
    assert(data.ok === true, "timeout-negative: ok=true");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testLiveMock429() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-live429-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "mock-429",
      providers: [
        { name: "mock-429", baseUrl: "http://127.0.0.1:18998/v1", apiFormat: "openai", keyEnv: "MOCK_429", models: ["m"], allowInsecureHttp: true }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m" }], activeProfile: "default"
    }, null, 2));
    const mockServer = createServer((req, res) => {
      res.writeHead(429, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "rate limit", code: "rate_limit" } }));
    });
    await new Promise(r => mockServer.listen(18998, "127.0.0.1", r));
    const result = await runProviderTest(["--json", "--live", "--provider=mock-429"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      MOCK_429: "sk-429"
    });
    await new Promise(r => mockServer.close(r));
    const data = JSON.parse(result.stdout);
    assert(data.liveResults[0].ok === false, "live-429: not ok");
    assert(data.liveResults[0].category === "upstream_429", "live-429: category=upstream_429");
    assert(data.liveResults[0].status === 429, "live-429: status=429");
    assert(!result.stdout.includes("sk-429"), "live-429: key not leaked");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testLiveMock5xx() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-live5xx-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "mock-5xx",
      providers: [
        { name: "mock-5xx", baseUrl: "http://127.0.0.1:18997/v1", apiFormat: "openai", keyEnv: "MOCK_5XX", models: ["m"], allowInsecureHttp: true }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m" }], activeProfile: "default"
    }, null, 2));
    const mockServer = createServer((req, res) => {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "service unavailable", code: "service_unavailable" } }));
    });
    await new Promise(r => mockServer.listen(18997, "127.0.0.1", r));
    const result = await runProviderTest(["--json", "--live", "--provider=mock-5xx"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      MOCK_5XX: "sk-5xx"
    });
    await new Promise(r => mockServer.close(r));
    const data = JSON.parse(result.stdout);
    assert(data.liveResults[0].ok === false, "live-5xx: not ok");
    assert(data.liveResults[0].category === "upstream_5xx", "live-5xx: category=upstream_5xx");
    assert(data.liveResults[0].status === 503, "live-5xx: status=503");
    assert(!result.stdout.includes("sk-5xx"), "live-5xx: key not leaked");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testLiveMockTimeout() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-livetimeout-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "mock-slow",
      providers: [
        { name: "mock-slow", baseUrl: "http://127.0.0.1:18996/v1", apiFormat: "openai", keyEnv: "MOCK_SLOW", models: ["m"], allowInsecureHttp: true }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m" }], activeProfile: "default"
    }, null, 2));
    const mockServer = createServer((req, res) => {
      // Delay response longer than our short timeout
      setTimeout(() => {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ id: "mock", choices: [] }));
      }, 2000);
    });
    await new Promise(r => mockServer.listen(18996, "127.0.0.1", r));
    // Use --timeout-ms=300 to trigger timeout quickly (but not too fast for TCP)
    const result = await runProviderTest(["--json", "--live", "--provider=mock-slow", "--timeout-ms=300"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      MOCK_SLOW: "sk-slow"
    });
    await new Promise(r => mockServer.close(r));
    const data = JSON.parse(result.stdout);
    assert(data.liveResults[0].ok === false, "live-timeout: not ok");
    assert(data.liveResults[0].category === "upstream_timeout", "live-timeout: category=upstream_timeout");
    assert(!result.stdout.includes("sk-slow"), "live-timeout: key not leaked");
  } finally { await cleanupTempDir(tmpRoot); }
}

async function testNoKeyLeakFailOnNever() {
  // Ensure --fail-on=never still redacts keys
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-leak-never-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "leak-check",
      providers: [
        { name: "leak-check", baseUrl: "https://api.example.com/v1", apiFormat: "openai", keyEnv: "SUPER_DUPER_KEY", models: ["m1"] }
      ],
      routes: [], profiles: [{ name: "default", defaultModel: "m1" }], activeProfile: "default"
    }, null, 2));
    const result = await runProviderTest(["--json", "--fail-on=never"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      SUPER_DUPER_KEY: "sk-never-leak-98765"
    });
    assert(!result.stdout.includes("sk-never-leak-98765"), "failon-never-leak: key not in output");
  } finally { await cleanupTempDir(tmpRoot); }
}

// 0.3.7: Shared module unit tests
async function testSharedModuleDirect() {
  const {
    checkProviderBaseUrl,
    describeKeySource,
    describeProviderStatus,
    buildProviderReport,
    buildProviderTestReport
  } = await import("../src/provider-test.js");

  // checkProviderBaseUrl
  const noUrl = checkProviderBaseUrl({ name: "test", baseUrl: "" });
  assert(noUrl.ok === false, "shared: empty baseUrl returns ok=false");
  assert(noUrl.issue === "missing_base_url", "shared: empty baseUrl issue=missing_base_url");

  const validHttps = checkProviderBaseUrl({ name: "test", baseUrl: "https://api.example.com/v1" });
  assert(validHttps.ok === true, "shared: valid https URL returns ok=true");

  const invalidUrl = checkProviderBaseUrl({ name: "test", baseUrl: "not-a-url" });
  assert(invalidUrl.ok === false, "shared: invalid URL returns ok=false");

  // describeKeySource with custom getProviderKeys
  const localProvider = { name: "ollama", baseUrl: "http://127.0.0.1:11434/v1" };
  const localKey = describeKeySource(localProvider);
  assert(localKey.present === true, "shared: local provider has key implicitly");
  assert(localKey.type === "local", "shared: local provider keySource=local");

  const cloudWithKey = describeKeySource(
    { name: "test", keyEnv: "TEST_ENV", models: ["m1"] },
    () => ["sk-real-key"]
  );
  assert(cloudWithKey.present === true, "shared: cloud provider with custom getProviderKeys has key");
  assert(cloudWithKey.type === "env", "shared: cloud provider keySource=env");

  const cloudNoKey = describeKeySource(
    { name: "test", keyEnv: "MISSING_ENV", models: ["m1"] },
    () => []
  );
  assert(cloudNoKey.present === false, "shared: cloud provider with no key returns present=false");

  // describeProviderStatus
  const statusOk = describeProviderStatus(
    { name: "ok", baseUrl: "https://api.example.com/v1", keyEnv: "OK_ENV", models: ["m1"], apiFormat: "openai" },
    () => ["sk-key"]
  );
  assert(statusOk === "ok", "shared: well-configured provider status=ok");

  const statusWarning = describeProviderStatus(
    { name: "warn", baseUrl: "https://api.example.com/v1", keyEnv: "WARN_ENV", models: [] },
    () => ["sk-key"]
  );
  assert(statusWarning === "warning", "shared: no-models provider status=warning");

  // buildProviderReport shape
  const report = buildProviderReport(
    { name: "test-p", baseUrl: "https://api.test.com/v1", keyEnv: "TEST_ENV", models: ["m1"], apiFormat: "openai" },
    () => ["sk-key"]
  );
  assert(report.name === "test-p", "shared: report.name correct");
  assert(report.status === "ok", "shared: report.status ok");
  assert(report.hasKey === true, "shared: report.hasKey true");
  assert(report.hasBaseUrl === true, "shared: report.hasBaseUrl true");
  assert(report.modelCount === 1, "shared: report.modelCount 1");
  assert(report.local === false, "shared: report.local false");

  // buildProviderTestReport empty provider test
  const emptyReport = buildProviderTestReport({ providers: [] }, {});
  assert(emptyReport.ok === false, "shared: empty providers report ok=false");
  assert(emptyReport.entry && emptyReport.entry.error === "no_providers_configured", "shared: empty providers error message");
}

// 0.3.11: Vercel AI Gateway provider test
async function testVercelDryRun() {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "opencode-ft-vercel-dryrun-"));
  try {
    await writeFile(resolve(tmpRoot, "config.json"), JSON.stringify({
      defaultProvider: "vercel-test",
      providers: [
        { name: "vercel-test", baseUrl: "https://ai-gateway.vercel.sh/v1", apiFormat: "openai", keyEnv: "AI_GATEWAY_API_KEYS", models: ["openai/gpt-5.4", "anthropic/claude-sonnet-4.6"] }
      ],
      routes: [{ name: "default", candidates: [{ provider: "vercel-test", model: "openai/gpt-5.4" }], strategy: "fallback" }],
      profiles: [{ name: "default", defaultModel: "openai/gpt-5.4" }],
      activeProfile: "default"
    }, null, 2));
    // With key set -> ok
    const resultWithKey = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json"),
      AI_GATEWAY_API_KEYS: "sk-vercel-test-key"
    });
    let data = JSON.parse(resultWithKey.stdout);
    assert(data.ok === true, "vercel-dryrun-withkey: ok=true");
    assert(data.providers[0].hasKey === true, "vercel-dryrun-withkey: hasKey=true");
    assert(data.providers[0].status === "ok", "vercel-dryrun-withkey: status=ok");
    assert(!resultWithKey.stdout.includes("sk-vercel-test-key"), "vercel-dryrun-withkey: key not leaked");
    // Without key -> warning, exit 0 with --fail-on=error (default)
    const resultNoKey = await runProviderTest(["--json"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
      // AI_GATEWAY_API_KEYS not set
    });
    data = JSON.parse(resultNoKey.stdout);
    assert(data.ok === false, "vercel-dryrun-nokey: ok=false (warning)");
    assert(data.providers[0].hasKey === false, "vercel-dryrun-nokey: hasKey=false");
    assert(data.providers[0].issues.includes("missing_key_source"), "vercel-dryrun-nokey: issue=missing_key_source");
    assert(data.summary.warning >= 1, "vercel-dryrun-nokey: warning count >= 1");
    assert(data.summary.error === 0, "vercel-dryrun-nokey: error count = 0");
    assert(resultNoKey.code === 0, "vercel-dryrun-nokey: exit 0 with default --fail-on=error");
    // --fail-on=error (explicit) should exit 0 for missing key warning
    const resultFailOnError = await runProviderTest(["--json", "--fail-on=error"], {
      OPENRELAY_ROOT: tmpRoot, OPENRELAY_CONFIG: "config.json",
      OPENRELAY_STATE: resolve(tmpRoot, "runtime-state.json")
    });
    data = JSON.parse(resultFailOnError.stdout);
    assert(data.summary.warning >= 1, "vercel-failonerror: warning present");
    assert(data.summary.error === 0, "vercel-failonerror: error count = 0");
    assert(resultFailOnError.code === 0, "vercel-failonerror: exit 0 for warnings-only");
  } finally { await cleanupTempDir(tmpRoot); }
}

const tests = [
  testDryRun,
  testMissingModels,
  testMissingKey,
  testMissingBaseUrl,
  testInvalidBaseUrl,
  testProviderFilter,
  testLiveWithMock,
  testNoKeyLeak,
  testDefaultJsonOutput,
  testFailOnDefault,
  testFailOnWarning,
  testFailOnNever,
  testLocalOnly,
  testLocalOnlyWithProviderFilter,
  testTimeoutMsInvalid,
  testTimeoutMsNegative,
  testLiveMock429,
  testLiveMock5xx,
  testLiveMockTimeout,
  testNoKeyLeakFailOnNever,
  testSharedModuleDirect,
  testVercelDryRun
];

console.log(`Running ${tests.length} provider-test-cli test groups (0.3.7)...\n`);

for (const test of tests) {
  try {
    await test();
  } catch (error) {
    failed++;
    console.error(`FAIL (exception): ${test.name}: ${error.message}`);
  }
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.error(`\n${failed} test group(s) had failures.`);
  process.exit(1);
}
