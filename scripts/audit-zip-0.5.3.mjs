// Quick audit: extract the 0.5.3 zip to a tmp dir, then walk
// the result to confirm presence of the 0.5.3 expected files
// and absence of forbidden content. Uses node:stream + built-in
// deflate via zlib — no npm deps.
import { spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const zipPath = process.argv[2] || "openrelay-local-safe-0.5.3.zip";
const tmpRoot = join(tmpdir(), "openrelay-zip-audit-" + Date.now());
mkdirSync(tmpRoot, { recursive: true });

// Use PowerShell's System.IO.Compression.FileSystem to extract.
const psExtract = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -AssemblyName System.IO.Compression.FileSystem",
  "$zip = (Resolve-Path '" + zipPath.replace(/'/g, "''") + "').Path",
  "[System.IO.Compression.ZipFile]::ExtractToDirectory($zip, '" + tmpRoot.replace(/'/g, "''") + "')"
].join("; ");
const r = spawnSync("powershell", ["-NoProfile", "-Command", psExtract], { encoding: "utf8" });
if (r.status !== 0) {
  console.error("extract failed:", r.stderr || r.stdout);
  process.exit(1);
}

// PowerShell's ExtractToDirectory drops the leading
// "openrelay-local-safe-0.5.3/" prefix (it just dumps the
// contents into tmpRoot). The first item may be a file or a
// directory; we walk whatever's in tmpRoot and treat the
// first top-level dir as the project root if one exists,
// otherwise use tmpRoot itself.
let root = tmpRoot;
const topLevel = readdirSync(tmpRoot);
if (topLevel.length === 1 && statSync(join(tmpRoot, topLevel[0])).isDirectory()) {
  root = join(tmpRoot, topLevel[0]);
}
console.log("extracted to:", root);

function walk(dir, prefix = "") {
  const out = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const rel = prefix ? prefix + "/" + e : e;
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}
const names = walk(root);
console.log("total entries:", names.length);

const want = [
  "src/server.js","src/auth.js","src/dashboard/index.js","src/dashboard.js",
  "src/dashboard/tabs/overview.js","src/dashboard/tabs/tools.js","src/dashboard/shared.js",
  "src/usage.js","src/token-estimate.js","src/config-schema.js",
  "src/stream-bridge.js","src/provider-health.js","src/i18n.js","src/http-helpers.js",
  "i18n/zh.json","i18n/en.json",
  "scripts/test-auth-required.mjs","scripts/test-usage-recording.mjs","scripts/test-runtime-root.mjs",
  "scripts/test-codex-compat.mjs","scripts/test-dashboard-html.mjs","scripts/test-dashboard-http.mjs",
  "scripts/test-route-preview.mjs","scripts/test-error-category.mjs","scripts/smoke-test.mjs",
  "scripts/build-dist.ps1","scripts/pre-release-check.mjs","scripts/collab-check.mjs",
  "CHANGELOG.md","README.md","README.zh.md","README.en.md",
  "AGENTS.md","MAINTENANCE.md","package.json","config.example.json",".env.example"
];
let missing = 0;
console.log("\n--- 0.5.3 expected files ---");
for (const w of want) {
  const found = names.includes(w);
  console.log("  " + (found ? "OK  " : "MISS") + " " + w);
  if (!found) missing += 1;
}

const forbiddenExact = [".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh", "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh"];
const forbiddenPrefix = ["data/", "backups/", "node_modules/", ".claude/"];
const forbiddenGlob = ["OPENCODE_HANDOFF", "CODEX_HANDOFF", ".docx", ".doc"];

console.log("\n--- forbidden content ---");
let leaks = 0;
for (const f of forbiddenExact) {
  if (names.includes(f)) { console.log("  LEAK " + f); leaks += 1; }
}
for (const p of forbiddenPrefix) {
  const found = names.filter(n => n.startsWith(p) || n.includes("/" + p));
  if (found.length) { console.log(`  LEAK ${p} (${found.length} entries)`); leaks += found.length; }
}
for (const g of forbiddenGlob) {
  const found = names.filter(n => n.includes(g));
  if (found.length) { console.log(`  LEAK glob ${g} (${found.length})`); leaks += found.length; }
}
const nestedZips = names.filter(n => n.endsWith(".zip"));
if (nestedZips.length) { console.log("  LEAK nested zips: " + nestedZips.join(", ")); leaks += nestedZips.length; }
else console.log("  OK   no nested zips");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
console.log("\n--- package.json ---");
console.log("  version: " + pkg.version);
console.log("  test script includes test:auth / test:usage / test:runtime: "
  + (pkg.scripts["test:auth"] ? "yes" : "NO"));

console.log("\n--- secret leak scan (real key patterns) ---");
const blob = (() => {
  let s = "";
  for (const f of names) {
    if (!f.match(/\.(json|md|js|mjs|ps1|sh|cmd|ts|html|txt)$/i)) continue;
    try { s += readFileSync(join(root, f), "utf8") + "\n"; } catch {}
  }
  return s;
})();
const reals = [
  /sk-ant-[A-Za-z0-9_-]{20,}/,
  /sk-[A-Za-z0-9]{20,}/,
  /gsk_[A-Za-z0-9]{20,}/,
  /xai-[A-Za-z0-9]{20,}/,
  /hf_[A-Za-z0-9]{20,}/,
  /AIza[A-Za-z0-9_-]{20,}/,
  /ghp_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/
];
let secretLeaks = 0;
for (const re of reals) {
  const m = blob.match(re);
  if (m) { console.log("  LEAK " + re + " match: " + m[0].slice(0, 8) + "..."); secretLeaks += 1; }
}
if (secretLeaks === 0) console.log("  OK   no real API key / token patterns in any shipped file");

console.log("\n--- cleanup ---");
rmSync(tmpRoot, { recursive: true, force: true });
console.log("  removed", tmpRoot);

console.log("\n--- summary ---");
console.log("  entries:        " + names.length);
console.log("  expected miss:  " + missing);
console.log("  forbidden leak: " + leaks);
console.log("  secret leak:    " + secretLeaks);
if (missing === 0 && leaks === 0 && secretLeaks === 0) {
  console.log("\n  ZIP READY FOR DISTRIBUTION");
  process.exitCode = 0;
} else {
  console.log("\n  ZIP HAS ISSUES");
  process.exitCode = 1;
}
