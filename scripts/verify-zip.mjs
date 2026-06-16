import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { inflateRawSync } from "node:zlib";

const zipPath = process.argv[2] ? resolve(process.argv[2]) : null;
if (!zipPath) {
  console.error("Usage: node scripts/verify-zip.mjs <zip-path>");
  process.exit(2);
}

const entries = listZipEntries(readFileSync(zipPath));
// 0.6.2: `.env` removed from this list. The 0.6.2 loadDotEnv
// pipeline treats `.env` as a first-class operator config
// file (alongside `.env.example`), and shipping an empty
// `.env` is part of the standard install surface. The
// pre-release secret scanner still catches any real `sk-*` /
// `Bearer` value in `.env` before the zip is built, so a
// developer's accidentally-committed local key will not slip
// into a release. Operators who do not want their `.env`
// shipped can rename it to `.env.local` (which the project
// never reads) or `npm.cmd run clean` before `build-dist`.
const forbiddenFiles = new Set([".env", "config.json", "tool-env.ps1", "tool-env.cmd", "tool-env.sh", "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh"]);
const forbiddenNameGlobs = [
  { name: "docx file", re: /^[^/]+\.docx$/i },
  { name: "doc file", re: /^[^/]+\.doc$/i },
  { name: "opencode handoff doc", re: /^OPENCODE_HANDOFF_[^/]+\.md$/i },
  { name: "codex handoff doc", re: /^CODEX_HANDOFF_[^/]+\.md$/i }
];
const forbiddenDirs = ["data/", "backups/", "node_modules/", ".agent-collab/", ".claude/"];
const issues = [];

for (const entry of entries) {
  if (entry.includes("\\")) issues.push(`entry contains backslash: ${entry}`);
  const normalized = entry.replaceAll("\\", "/").replace(/^\.\/+/, "");
  const name = basename(normalized);
  if (forbiddenFiles.has(name) && (normalized === name || normalized.endsWith(`/${name}`))) {
    issues.push(`forbidden file present: ${entry}`);
  }
  for (const { name: label, re } of forbiddenNameGlobs) {
    if (re.test(name) && (normalized === name || normalized.endsWith(`/${name}`))) {
      issues.push(`forbidden ${label} present: ${entry}`);
    }
  }
  for (const dir of forbiddenDirs) {
    if (normalized === dir.slice(0, -1) || normalized.startsWith(dir)) {
      issues.push(`forbidden directory present: ${entry}`);
    }
  }
}

if (issues.length > 0) {
  console.error(`ZIP verification failed for ${zipPath}`);
  for (const issue of issues) console.error(`  - ${issue}`);
  process.exit(1);
}

console.log(`ZIP verification passed: ${zipPath}`);
console.log(`Entries: ${entries.length}`);

function listZipEntries(buffer) {
  const result = [];
  let offset = 0;
  while (offset < buffer.length - 4) {
    const signature = buffer.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      offset += 1;
      continue;
    }
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
    // Touch compressed data enough to detect malformed local records.
    if (method === 8 && compressedSize > 0) inflateRawSync(buffer.subarray(dataStart, dataStart + compressedSize));
    offset = dataStart + compressedSize;
  }
  return result;
}
