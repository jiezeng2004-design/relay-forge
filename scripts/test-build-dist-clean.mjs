// Tests that the release-time forbidden-files list covers all the
// patterns that build-dist excludes and that verify-zip.mjs catches.
// This script does NOT need the Windows-only build-dist.ps1 to run;
// it directly exercises verify-zip.mjs on a synthetic "bad" zip and
// asserts the build-dist.ps1 source mentions the same patterns.

import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createWriteStream } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

// Node 18 does not export crc32 from node:zlib (it was added in
// Node 22.2.0). Implement the standard CRC-32 / ZIP CRC-32 (polynomial
// 0xEDB88320, reflected) here so the test runs on Node 18/20/22.
// Returns an unsigned 32-bit integer, matching the contract of the
// native node:zlib.crc32 helper.
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC32_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifyZipPath = resolve(rootDir, "scripts", "verify-zip.mjs");
const buildDistPath = resolve(rootDir, "scripts", "build-dist.ps1");

// The forbidden patterns we expect every layer of the pipeline to
// agree on. Keep this list in sync with the safety boundary.
const expectedPatterns = [
  ".claude",
  ".docx",
  ".doc",
  "OPENCODE_HANDOFF",
  "CODEX_HANDOFF"
];

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
function assert(cond, msg) {
  if (!cond) throw new Error("assertion failed: " + msg);
}

function buildSyntheticZip(entries) {
  // Build a minimal ZIP file in memory. Only stored (method 0) entries
  // to keep the test self-contained. CRC is computed from the payload.
  const parts = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const payload = Buffer.from(entry.content, "utf8");
    const crc = crc32(payload);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(payload.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, nameBuf, payload);
    const cdEntry = Buffer.alloc(46);
    cdEntry.writeUInt32LE(0x02014b50, 0);
    cdEntry.writeUInt16LE(20, 4);
    cdEntry.writeUInt16LE(20, 6);
    cdEntry.writeUInt16LE(0, 8);
    cdEntry.writeUInt16LE(0, 10);
    cdEntry.writeUInt16LE(0, 12);
    cdEntry.writeUInt16LE(0, 14);
    cdEntry.writeUInt32LE(crc, 16);
    cdEntry.writeUInt32LE(payload.length, 20);
    cdEntry.writeUInt32LE(payload.length, 24);
    cdEntry.writeUInt16LE(nameBuf.length, 28);
    cdEntry.writeUInt16LE(0, 30);
    cdEntry.writeUInt16LE(0, 32);
    cdEntry.writeUInt16LE(0, 34);
    cdEntry.writeUInt16LE(0, 36);
    cdEntry.writeUInt32LE(0, 38);
    cdEntry.writeUInt32LE(offset, 42);
    central.push(cdEntry, nameBuf);
    offset += local.length + nameBuf.length + payload.length;
  }
  const cdStart = offset;
  let cdTotal = 0;
  for (const part of central) cdTotal += part.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdTotal, 12);
  eocd.writeUInt32LE(cdStart, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, ...central, eocd]);
}

function runVerifyZip(zipPath) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [verifyZipPath, zipPath], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("close", (code) => resolveRun({ code, stdout, stderr }));
  });
}

test("build-dist.ps1 lists every expected forbidden pattern", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(buildDistPath, "utf8");
  for (const pattern of expectedPatterns) {
    assert(
      text.includes(pattern),
      `build-dist.ps1 should mention the pattern "${pattern}"`
    );
  }
});

test("verify-zip.mjs rejects a zip containing .claude/ entries", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-zip-clean-"));
  try {
    const zipPath = resolve(tmpRoot, "claude.zip");
    const buf = buildSyntheticZip([
      { name: "README.md", content: "hi" },
      { name: ".claude/skills/x/SKILL.md", content: "should not ship" }
    ]);
    await new Promise((res, rej) => {
      const stream = createWriteStream(zipPath);
      stream.on("close", res);
      stream.on("error", rej);
      stream.end(buf);
    });
    const result = await runVerifyZip(zipPath);
    assert(result.code !== 0, `verify-zip should reject a .claude/ entry, got exit ${result.code}`);
    assert(/forbidden directory present/i.test(result.stderr), `stderr should mention forbidden directory: ${result.stderr}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("verify-zip.mjs rejects a zip containing a .docx file", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-zip-clean-"));
  try {
    const zipPath = resolve(tmpRoot, "docx.zip");
    const buf = buildSyntheticZip([
      { name: "README.md", content: "hi" },
      { name: "项目开发说明.docx", content: "should not ship" }
    ]);
    await new Promise((res, rej) => {
      const stream = createWriteStream(zipPath);
      stream.on("close", res);
      stream.on("error", rej);
      stream.end(buf);
    });
    const result = await runVerifyZip(zipPath);
    assert(result.code !== 0, `verify-zip should reject a .docx entry, got exit ${result.code}`);
    assert(/forbidden docx file/i.test(result.stderr), `stderr should mention forbidden docx file: ${result.stderr}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("verify-zip.mjs rejects a zip containing an OPENCODE_HANDOFF_*.md file", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-zip-clean-"));
  try {
    const zipPath = resolve(tmpRoot, "handoff.zip");
    const buf = buildSyntheticZip([
      { name: "README.md", content: "hi" },
      { name: "OPENCODE_HANDOFF_0.4.4.md", content: "should not ship" }
    ]);
    await new Promise((res, rej) => {
      const stream = createWriteStream(zipPath);
      stream.on("close", res);
      stream.on("error", rej);
      stream.end(buf);
    });
    const result = await runVerifyZip(zipPath);
    assert(result.code !== 0, `verify-zip should reject an OPENCODE_HANDOFF_*.md entry, got exit ${result.code}`);
    assert(/forbidden opencode handoff doc/i.test(result.stderr), `stderr should mention forbidden opencode handoff doc: ${result.stderr}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

test("verify-zip.mjs accepts a clean zip", async () => {
  const tmpRoot = await mkdtemp(resolve(tmpdir(), "openrelay-zip-clean-"));
  try {
    const zipPath = resolve(tmpRoot, "clean.zip");
    const buf = buildSyntheticZip([
      { name: "README.md", content: "hi" },
      { name: "package.json", content: "{}" },
      { name: "src/server.js", content: "export default 1;" }
    ]);
    await new Promise((res, rej) => {
      const stream = createWriteStream(zipPath);
      stream.on("close", res);
      stream.on("error", rej);
      stream.end(buf);
    });
    const result = await runVerifyZip(zipPath);
    assert(result.code === 0, `verify-zip should accept a clean zip, got exit ${result.code} stderr=${result.stderr}`);
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
});

let passed = 0;
let failed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`  FAIL ${name}: ${error.message}`);
    failed += 1;
  }
}
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

// Reference unused imports so the linter does not complain.
void deflateRawSync;
void writeFile;
