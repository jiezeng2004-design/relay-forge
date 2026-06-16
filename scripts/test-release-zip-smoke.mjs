/**
 * test-release-zip-smoke.mjs — Smoke test for relayforge release zip.
 *
 * Verifies the release zip is usable as-is:
 *   1. Extracts the zip to a temp directory.
 *   2. Runs `node src/server.js --check` — verifies version output.
 *   3. Checks key files exist (package.json, README.md, config.example.json,
 *      src/server.js, scripts/verify-zip.mjs).
 *   4. Checks forbidden files are absent (.env, config.json, data/, backups/,
 *      node_modules/).
 *   5. Checks at least one startup script exists (start.sh or
 *      Start_OpenRelay_Local_Safe.cmd).
 *
 * Usage: node scripts/test-release-zip-smoke.mjs
 *
 * Must be run after build-dist has produced relayforge-<version>.zip.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version: VER } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const ZIP_PATH = join(ROOT, `relayforge-${VER}.zip`);

let pass = 0, fail = 0;
function ok(m) { console.log(`  ok  ${m}`); pass++; }
function nok(m, d) { console.log(`  not ok  ${m}`); if (d) console.log(`  ---\n  ${d}`); fail++; }

// ---- Setup: check zip exists ----
if (!existsSync(ZIP_PATH)) {
  nok("release zip exists", `${ZIP_PATH} not found — run build-dist first`);
  printSummary();
  process.exit(1);
}

// ---- Extract zip to temp dir ----
const TMP = join(tmpdir(), `relayforge-smoke-${Date.now()}`);
mkdirSync(TMP, { recursive: true });
console.log(`# extracting to ${TMP}`);

try {
  const zipBuf = readFileSync(ZIP_PATH);
  let off = 0;
  const extracted = new Set();
  while (off < zipBuf.length - 4) {
    const sig = zipBuf.readUInt32LE(off);
    if (sig !== 0x04034b50) { off++; continue; }
    const flags = zipBuf.readUInt16LE(off + 6);
    const method = zipBuf.readUInt16LE(off + 8);
    const compSize = zipBuf.readUInt32LE(off + 18);
    const uncompSize = zipBuf.readUInt32LE(off + 22);
    const nameLen = zipBuf.readUInt16LE(off + 26);
    const extraLen = zipBuf.readUInt16LE(off + 28);
    const name = zipBuf.subarray(off + 30, off + 30 + nameLen).toString("utf8");
    const dataStart = off + 30 + nameLen + extraLen;

    if (name.endsWith("/")) {
      // Directory entry — skip (our write-zip doesn't emit these)
      off = dataStart + compSize;
      continue;
    }

    // Extract file
    let raw;
    if (method === 0) {
      raw = zipBuf.subarray(dataStart, dataStart + compSize);
    } else if (method === 8) {
      raw = inflateRawSync(zipBuf.subarray(dataStart, dataStart + compSize));
    } else {
      throw new Error(`unsupported compression method ${method} for ${name}`);
    }

    const outPath = join(TMP, name);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, raw);
    extracted.add(name);

    if ((flags & 0x08) !== 0) {
      off += 30 + nameLen + extraLen;
      continue;
    }
    off = dataStart + compSize;
  }

  // ---- 1. Extract success ----
  if (extracted.size > 0) ok(`extracted ${extracted.size} entries to temp dir`);
  else nok("extract entries", "no entries extracted");

  // ---- 2. node src/server.js --check reports correct version ----
  try {
    const out = execSync(`node src/server.js --check`, {
      cwd: TMP, stdio: "pipe", timeout: 15000
    }).toString();
    const parsed = JSON.parse(out);
    if (parsed.ok === true && parsed.version === VER) {
      ok(`node src/server.js --check reports version ${VER}`);
    } else {
      nok("node src/server.js --check version",
        `expected ok=true, version=${VER}, got ${JSON.stringify(parsed)}`);
    }
  } catch (e) {
    nok("node src/server.js --check runs",
      `exit ${e.status}: ${(e.stderr||"").toString().slice(0, 300)}`);
  }

  // ---- 3. Key files exist ----
  const requiredFiles = [
    "package.json", "README.md", "config.example.json",
    "src/server.js", "scripts/verify-zip.mjs"
  ];
  for (const f of requiredFiles) {
    const fp = join(TMP, f);
    if (existsSync(fp)) ok(`key file exists: ${f}`);
    else nok(`key file exists: ${f}`, `not found at ${fp}`);
  }

  // ---- 4. Forbidden files absent ----
  const forbiddenFiles = [".env", "config.json"];
  const forbiddenDirs = ["data", "backups", "node_modules"];
  let badCount = 0;
  for (const f of forbiddenFiles) {
    if (existsSync(join(TMP, f))) { nok(`forbidden file absent: ${f}`); badCount++; }
  }
  for (const d of forbiddenDirs) {
    if (existsSync(join(TMP, d))) { nok(`forbidden dir absent: ${d}/`); badCount++; }
  }
  if (badCount === 0) ok("forbidden files/dirs absent");

  // ---- 5. Startup script exists ----
  const startupScripts = ["start.sh", "Start_RelayForge.cmd", "Start_OpenRelay_Local_Safe.cmd"];
  const foundStartup = startupScripts.some((s) => existsSync(join(TMP, s)));
  if (foundStartup) ok("startup script exists (Start_RelayForge.cmd or start.sh)");
  else nok("startup script exists", `none of ${startupScripts.join(", ")} found`);

  // ---- 6. package.json version inside zip matches ----
  try {
    const pkgInZip = JSON.parse(readFileSync(join(TMP, "package.json"), "utf8"));
    if (pkgInZip.version === VER) ok(`extracted package.json version is ${VER}`);
    else nok("extracted package.json version", `expected ${VER}, got ${pkgInZip.version}`);
  } catch (e) {
    nok("extracted package.json readable", e.message);
  }

} finally {
  // Cleanup temp dir
  if (existsSync(TMP)) rmSync(TMP, { recursive: true, force: true });
  console.log("# cleaned temp dir");
}

// ---- Summary ----
console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
