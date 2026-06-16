/**
 * test-release-artifacts.mjs — Unit tests for verify-release-artifacts and
 * build-dist SHA256 generation.
 *
 * Tests:
 *   1. verify-release-artifacts.mjs exists
 *   2. verify-release-artifacts exits 0 on a valid zip
 *   3. verify-release-artifacts exits non-zero on a missing zip
 *   4. verify-release-artifacts exits non-zero on a zip with forbidden files
 *   5. build-dist produces a .sha256 file
 *   6. sha256 file contains the correct hash format
 *
 * Usage: node scripts/test-release-artifacts.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip } from "./write-zip.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const VERIFIER = join(ROOT, "scripts", "verify-release-artifacts.mjs");
const BUILD_DIST = join(ROOT, "scripts", "build-dist.mjs");
const { version: VER } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

let pass = 0, fail = 0;

function ok(m) { console.log(`  ok  ${m}`); pass++; }
function nok(m, d) { console.log(`  not ok  ${m}`); if (d) console.log(`  ---\n  ${d}`); fail++; }

// ---- Test 1: verifier script exists ----
ok(existsSync(VERIFIER) ? "verify-release-artifacts.mjs exists" : nok("verify-release-artifacts.mjs exists", "not found"));

// ---- Test 2: PASS on a valid zip ----
const TMP = join(ROOT, ".test-release-tmp");
const GOOD_ZIP = join(TMP, "test-good.zip");
const GOOD_STAGE = join(TMP, "test-good-stage");
const PKG_GOOD = join(GOOD_STAGE, "package.json");
try {
  rmSync(TMP, { recursive: true, force: true });
} catch {}
mkdirSync(GOOD_STAGE, { recursive: true });
writeFileSync(PKG_GOOD, JSON.stringify({ version: VER, name: "relayforge" }), "utf8");
writeFileSync(join(GOOD_STAGE, "README.md"), "# test", "utf8");
mkdirSync(join(GOOD_STAGE, "src"), { recursive: true });
writeFileSync(join(GOOD_STAGE, "src", "server.js"), "// test", "utf8");
mkdirSync(join(GOOD_STAGE, "scripts"), { recursive: true });
writeFileSync(join(GOOD_STAGE, "scripts", "verify-zip.mjs"), "// test", "utf8");
await writeZip(GOOD_STAGE, GOOD_ZIP);

try {
  execSync(`node "${VERIFIER}" "${GOOD_ZIP}"`, { cwd: ROOT, stdio: "pipe", timeout: 30000 });
  ok("verify-release-artifacts PASS on valid zip");
} catch (e) {
  nok("verify-release-artifacts PASS on valid zip",
    `exit ${e.status}: ${(e.stderr||"").toString().slice(0,300)}`);
}

// ---- Test 3: FAIL on missing zip ----
try {
  execSync(`node "${VERIFIER}" "${TMP}/no-such-zip.zip"`, { cwd: ROOT, stdio: "pipe", timeout: 10000 });
  nok("verify-release-artifacts FAIL on missing zip", "exited 0 when it should have failed");
} catch (e) {
  if (e.status && e.status > 0) ok("verify-release-artifacts FAIL on missing zip");
  else nok("verify-release-artifacts FAIL on missing zip", e.message);
}

// ---- Test 4: FAIL on zip with forbidden file ----
const BAD_ZIP = join(TMP, "test-bad.zip");
const BAD_STAGE = join(TMP, "test-bad-stage");
mkdirSync(BAD_STAGE, { recursive: true });
writeFileSync(join(BAD_STAGE, "package.json"), JSON.stringify({ version: VER, name: "relayforge" }), "utf8");
writeFileSync(join(BAD_STAGE, "README.md"), "# test", "utf8");
writeFileSync(join(BAD_STAGE, ".env"), "SECRET=bad", "utf8");
await writeZip(BAD_STAGE, BAD_ZIP);

try {
  execSync(`node "${VERIFIER}" "${BAD_ZIP}"`, { cwd: ROOT, stdio: "pipe", timeout: 10000 });
  nok("verify-release-artifacts FAIL on zip with .env", "exited 0 when it should have failed");
} catch (e) {
  if (e.status && e.status > 0) ok("verify-release-artifacts FAIL on zip with .env");
  else nok("verify-release-artifacts FAIL on zip with .env", e.message);
}

// ---- Test 5: build-dist produces .sha256 file (if build-dist can run) ----
const ZIP = join(ROOT, `relayforge-${VER}.zip`);
const SHA256_FILE = `${ZIP}.sha256`;
try {
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
  if (existsSync(SHA256_FILE)) rmSync(SHA256_FILE, { force: true });
} catch {}
try {
  execSync(`node "${BUILD_DIST}"`, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
  if (existsSync(SHA256_FILE)) {
    ok("build-dist produces .sha256 file");
  } else {
    nok("build-dist produces .sha256 file", "not found");
  }
} catch (e) {
  nok("build-dist produces .sha256 file", `build-dist failed: ${(e.stderr||"").toString().slice(0,300)}`);
}

// ---- Test 6: sha256 file format is correct ----
if (existsSync(SHA256_FILE)) {
  const shaContent = readFileSync(SHA256_FILE, "utf8").trim();
  const regex = /^[a-f0-9]{64}\s+(relayforge-\d+\.\d+\.\d+\.zip)$/;
  if (regex.test(shaContent)) {
    ok("sha256 file format valid");
    const zipHash = createHash("sha256").update(readFileSync(ZIP)).digest("hex");
    const storedHash = shaContent.split(/\s+/)[0];
    if (zipHash === storedHash) ok("sha256 file hash matches zip");
    else nok("sha256 file hash matches zip", `computed ${zipHash}, stored ${storedHash}`);
  } else {
    nok("sha256 file format valid", `expected format "<hash>  <filename>.zip", got "${shaContent.slice(0,100)}"`);
  }
} else {
  nok("sha256 file check skipped", "no sha256 file to test");
}

// ---- Cleanup ----
try { rmSync(TMP, { recursive: true, force: true }); } catch {}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
