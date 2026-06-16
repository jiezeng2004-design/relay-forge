import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VER = pkg.version;

const zipArg = process.argv[2];
const ZIP = zipArg ? resolve(zipArg) : join(ROOT, `relayforge-${VER}.zip`);
const SHA256_FILE = `${ZIP}.sha256`;

const forbiddenFiles = new Set([
  ".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh",
  "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh"
]);
const forbiddenNameGlobs = [
  { label: "docx file", re: /^[^/]+\.docx$/i },
  { label: "doc file", re: /^[^/]+\.doc$/i },
  { label: "opencode handoff doc", re: /^OPENCODE_HANDOFF_[^/]+\.md$/i },
  { label: "codex handoff doc", re: /^CODEX_HANDOFF_[^/]+\.md$/i }
];
const forbiddenDirs = ["data/", "backups/", "node_modules/", ".agent-collab/", ".claude/"];

const results = { pass: true, checks: [] };

function check(name, ok, detail) {
  results.checks.push({ name, ok, detail });
  if (!ok) results.pass = false;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

console.log(`\n=== Release Artifact Verification — relayforge ${VER} ===\n`);

// 1. Zip exists
const zipExists = existsSync(ZIP);
check("zip exists", zipExists, zipExists ? ZIP : "not found");

if (!zipExists) {
  console.log(`\n=== RESULT: FAIL (zip not found) ===\n`);
  process.exit(1);
}

// 2. Zip size
const zipStat = statSync(ZIP);
const zipSizeKb = (zipStat.size / 1024).toFixed(1);
check("zip size > 0", zipStat.size > 0, `${zipSizeKb} KB`);

// 3. Read zip entries
const buf = readFileSync(ZIP);
const entries = listZipEntries(buf);
check("zip entries > 0", entries.length > 0, `${entries.length} entries`);

// 4. No backslash paths
const backslashEntries = entries.filter(e => e.includes("\\"));
check("no backslash paths", backslashEntries.length === 0,
  backslashEntries.length > 0 ? `found: ${backslashEntries.join(", ")}` : "all forward-slash");

// 5. No top-level directory prefix — ensure entries are NOT wrapped under a
//    single parent directory (e.g. `openrelay-like-0.3.4/package.json`).
//    Entries like `src/server.js` and `scripts/verify-zip.mjs` are fine —
//    they are subdirectory paths at zip root, not a wrapping prefix.
const topPrefixes = new Set();
for (const entry of entries) {
  const normalized = entry.replaceAll("\\", "/");
  const slashIdx = normalized.indexOf("/");
  if (slashIdx > 0) {
    topPrefixes.add(normalized.slice(0, slashIdx));
  }
}
// If there is exactly one top-level directory AND every entry with a "/" shares it,
// the zip wraps everything under that single directory.
const topPrefixArr = Array.from(topPrefixes);
const entriesWithSlash = entries.filter(e => e.replaceAll("\\", "/").includes("/"));
const hasTopPrefix = topPrefixArr.length === 1 && entriesWithSlash.length > 0 &&
  entriesWithSlash.every(e => e.replaceAll("\\", "/").startsWith(topPrefixArr[0] + "/"));
check("no top-level directory prefix",
  !hasTopPrefix, hasTopPrefix ? `entries wrapped under '${topPrefixArr[0]}/'` : "entries at zip root");

// 6. Forbidden files/dirs
let forbiddenCount = 0;
for (const entry of entries) {
  const normalized = entry.replaceAll("\\", "/");
  const name = normalized.split("/").pop();

  if (forbiddenFiles.has(name)) {
    check(`forbidden file absent: ${name}`, false, `present as ${entry}`);
    forbiddenCount++;
    continue;
  }

  for (const { label, re } of forbiddenNameGlobs) {
    if (re.test(name)) {
      check(`forbidden ${label} absent`, false, `present as ${entry}`);
      forbiddenCount++;
    }
  }

  for (const dir of forbiddenDirs) {
    if (normalized === dir.slice(0, -1) || normalized.startsWith(dir)) {
      check(`forbidden dir absent: ${dir}`, false, `present as ${entry}`);
      forbiddenCount++;
    }
  }
}
if (forbiddenCount === 0) {
  check("no forbidden files or directories", true, "all clean");
}

// 7. Zip's package.json version matches
let zipVersion = null;
let zipPkgFound = false;
for (const entry of entries) {
  const name = entry.replaceAll("\\", "/");
  if (name === "package.json") {
    zipPkgFound = true;
    const raw = extractEntry(buf, entry);
    if (raw) {
      try {
        zipVersion = JSON.parse(raw.toString("utf8")).version;
      } catch { /* zipVersion stays null */ }
    }
    break;
  }
}
if (zipPkgFound && zipVersion) {
  check("zip package.json version matches", zipVersion === VER,
    zipVersion === VER ? zipVersion : `expected ${VER}, got ${zipVersion}`);
} else {
  check("zip package.json found", zipPkgFound, zipPkgFound ? "package.json exists but version unreadable" : "not found in zip");
}

// 8. SHA256 file
let sha256Computed = null;
try {
  const hash = createHash("sha256");
  hash.update(buf);
  sha256Computed = hash.digest("hex");
} catch (e) {
  check("sha256 computation", false, e.message);
}

if (existsSync(SHA256_FILE)) {
  const sha256Content = readFileSync(SHA256_FILE, "utf8").trim();
  const sha256Stored = sha256Content.split(/\s+/)[0];
  const sha256Match = sha256Stored === sha256Computed;
  check("sha256 checksum", sha256Match,
    sha256Match ? `verified ${sha256Computed}` : `computed ${sha256Computed}, stored ${sha256Stored}`);
} else if (sha256Computed) {
  check("sha256 computed", true, sha256Computed);
} else {
  check("sha256", false, "could not compute");
}

// Summary
console.log(`\n=== Release Artifact Evidence ===`);
console.log(`  zip:         ${resolve(ZIP)}`);
console.log(`  size:        ${zipSizeKb} KB`);
console.log(`  entries:     ${entries.length}`);
console.log(`  backslash:   ${backslashEntries.length === 0 ? "none" : backslashEntries.length + " found"}`);
console.log(`  top-dir:     ${hasTopPrefix ? "present" : "none"}`);
console.log(`  forbidden:   ${forbiddenCount === 0 ? "none" : forbiddenCount + " found"}`);
console.log(`  sha256:      ${sha256Computed ? sha256Computed : "N/A"}`);
if (existsSync(SHA256_FILE)) console.log(`  sha256 file: ${SHA256_FILE}`);

console.log(`\n=== RESULT: ${results.pass ? "PASS" : "FAIL"} ===\n`);
if (!results.pass) process.exit(1);

function listZipEntries(buffer) {
  const result = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) { offset++; continue; }
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    result.push(name);
    if ((flags & 0x08) !== 0) {
      throw new Error(`unsupported zip data descriptor entry: ${name}`);
    }
    if (method !== 0 && method !== 8) {
      throw new Error(`unsupported compression method ${method} for entry: ${name}`);
    }
    if (method === 8 && compressedSize > 0) inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return result;
}

function extractEntry(buffer, entryName) {
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) { offset++; continue; }
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const dataStart = nameEnd + extraLength;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");
    if (name === entryName) {
      if (method === 0) return buffer.subarray(dataStart, dataStart + compressedSize);
      if (method === 8) return inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
      return null;
    }
    const flags = buffer.readUInt16LE(offset + 6);
    if ((flags & 0x08) !== 0) {
      offset += 30 + fileNameLength + extraLength;
      continue;
    }
    offset = dataStart + compressedSize;
  }
  return null;
}
