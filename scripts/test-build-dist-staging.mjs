/**
 * test-build-dist-staging.mjs — Verify that build-dist produces a clean,
 * verifiable release zip with correct version and no forbidden files.
 *
 * 8+ assertions:
 *   1. build-dist.mjs exists
 *   2. build-dist exits 0
 *   3. zip file exists
 *   4. verify-zip passes on the zip
 *   5. zip package.json version matches current package.json
 *   6. zip has no forbidden/backslash entries, no relay-forge*.txt
 *   7. report.md has no old openrelay-like 0.3.7 report (or excluded)
 *   8. staging tree passed strict pre-release
 *
 * Usage: node scripts/test-build-dist-staging.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(ROOT, "scripts", "build-dist.mjs");
const VERIFIER = join(ROOT, "scripts", "verify-zip.mjs");
const { version: VER } = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const ZIP = join(ROOT, `relayforge-${VER}.zip`);
const STAGE = join(ROOT, `relayforge-${VER}`);

let pass = 0, fail = 0, built = false;

function ok(m) { console.log(`  ok  ${m}`); pass++; }
function nok(m, d) { console.log(`  not ok  ${m}`); if (d) console.log(`  ---\n  ${d}`); fail++; }

// 1
if (existsSync(BIN)) ok("build-dist.mjs exists"); else nok("build-dist.mjs exists", "not found");

// 2
try {
  if (existsSync(ZIP)) rmSync(ZIP, { force: true });
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
} catch {}
try {
  execSync(`node "${BIN}"`, { cwd: ROOT, stdio: "pipe", timeout: 120000 });
  ok("build-dist exits 0");
  built = true;
} catch (e) {
  nok("build-dist exits 0", `exit ${e.status}: ${(e.stderr||"").toString().slice(0,400)}`);
}

// 3
if (existsSync(ZIP)) ok(`zip file exists: relayforge-${VER}.zip`);
else nok("zip file exists", "not found");

// 4
try {
  execSync(`node "${VERIFIER}" "${ZIP}"`, { cwd: ROOT, stdio: "pipe" });
  ok("verify-zip passes on the zip");
} catch (e) {
  nok("verify-zip passes on the zip", ((e.stderr||"").toString().slice(0,300)));
}

// 5 — scan zip entries for package.json
try {
  const buf = readFileSync(ZIP);
  let found = null, off = 0;
  while (off < buf.length - 4) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) { off++; continue; }
    const nl = buf.readUInt16LE(off + 26);
    const el = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nl).toString("utf8");
    const cs = buf.readUInt32LE(off + 18);
    const mt = buf.readUInt16LE(off + 8);
    if (name === "package.json") {
      const raw = mt === 0 ? buf.subarray(off + 30 + nl + el, off + 30 + nl + el + cs)
        : inflateRawSync(buf.subarray(off + 30 + nl + el, off + 30 + nl + el + cs));
      found = JSON.parse(raw.toString("utf8")).version;
      break;
    }
    off += 30 + nl + el + cs;
  }
  if (found === VER) ok(`zip package.json version is ${VER}`);
  else nok("zip package.json version", `expected ${VER}, got ${found||"not found"}`);
} catch (e) { nok("zip package.json version", e.message); }

// 6 — forbidden files & backslash check
let reportMdContent = null;
try {
  const buf = readFileSync(ZIP);
  const bad = [];
  const relayForgeTxt = [];
  let off = 0;
  while (off < buf.length - 4) {
    const sig = buf.readUInt32LE(off);
    if (sig !== 0x04034b50) { off++; continue; }
    const flags = buf.readUInt16LE(off + 6);
    const method = buf.readUInt16LE(off + 8);
    const nl = buf.readUInt16LE(off + 26);
    const el = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nl).toString("utf8");
    const cs = buf.readUInt32LE(off + 18);
    if (name.includes("\\")) bad.push(name);
    const n = name.replaceAll("\\", "/");
    if (n === ".env" || n === "config.json") bad.push(n);
    for (const d of ["data/", "backups/", "node_modules/"]) {
      if (n === d.slice(0,-1) || n.startsWith(d)) bad.push(n);
    }
    if (/\.zip$/.test(n) || /\.zip\.sha256$/.test(n)) bad.push(n);
    if (/^relay-forge.*\.txt$/.test(name.split("/").pop())) relayForgeTxt.push(name);
    if (n === "report.md") {
      const ds = off + 30 + nl + el;
      const de = ds + cs;
      reportMdContent = method === 0
        ? buf.subarray(ds, de).toString("utf8")
        : (method === 8 ? inflateRawSync(buf.subarray(ds, de)).toString("utf8") : null);
    }
    off += 30 + nl + el + cs;
  }
  if (bad.length === 0) ok("zip has no forbidden/backslash entries");
  else nok("zip forbidden/backslash check", bad.join(", "));
  if (relayForgeTxt.length === 0) ok("no relay-forge*.txt in zip");
  else nok("zip contains relay-forge*.txt", relayForgeTxt.join(", "));
} catch (e) { nok("zip forbidden/backslash check", e.message); }

// 7 — report.md content clean check
if (reportMdContent !== null) {
  if (reportMdContent.includes("openrelay-like 0.3.7")) {
    nok("report.md has no old openrelay-like 0.3.7 report", "found 'openrelay-like 0.3.7'");
  } else {
    ok("report.md is clean (no openrelay-like 0.3.7 report)");
  }
} else {
  ok("report.md not in zip (clean by exclusion)");
}

// 7
if (built) ok("staging strict pre-release passed (proven by build-dist exit 0)");
else nok("staging strict pre-release passed", "build-dist failed");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
