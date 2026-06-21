import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { writeZip } from "./write-zip.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const VERSION = pkg.version;
if (!VERSION) { console.error("FATAL: package.json missing version"); process.exit(1); }
const DIST_NAME = `relayforge-${VERSION}`;
const STAGE = join(ROOT, DIST_NAME);
const OUT_ZIP = join(ROOT, `${DIST_NAME}.zip`);
const PRE_RELEASE_SCRIPT = join(ROOT, "scripts", "pre-release-check.mjs");
const VERIFY_ZIP_SCRIPT = join(ROOT, "scripts", "verify-zip.mjs");
const KEEP_STAGE = !!process.env.OPENRELAY_DIST_KEEP_STAGE;

const EXCLUDE_FILE_NAMES = new Set([
  ".git", ".env", "config.json",
  "tool-env.ps1", "tool-env.cmd", "tool-env.sh",
  "tool-verify.ps1", "tool-verify.cmd", "tool-verify.sh",
  "package-lock.json"
]);
const EXCLUDE_DIR_NAMES = new Set([
  ".git", "node_modules", "data", "backups", "dist", ".agent-collab", ".claude", "analysis"
]);
const EXCLUDE_EXT = new Set([".log", ".err", ".tmp", ".bak", ".zip"]);
const EXCLUDE_NAME_GLOBS = [
  /^OPENCODE_HANDOFF_.+\.md$/i,
  /^CODEX_HANDOFF_.+\.md$/i,
  /^relayforge-\d+\.\d+\.\d+$/,
  /^relayforge-\d+\.\d+\.\d+\.zip$/,
  /^relayforge-\d+\.\d+\.\d+\.zip\.sha256$/,
  /^openrelay-local-safe-\d+\.\d+\.\d+$/,
  /^openrelay-like-.+\.zip$/,
  /^openrelay-like-.+\.zip\.sha256$/,
  /^relay-forge.*\.txt$/
];

function shouldExclude(e) {
  if (e.isDirectory()) {
    if (EXCLUDE_DIR_NAMES.has(e.name)) return true;
    for (const g of EXCLUDE_NAME_GLOBS) { if (g.test(e.name)) return true; }
    return false;
  }
  if (EXCLUDE_FILE_NAMES.has(e.name)) return true;
  const i = e.name.lastIndexOf(".");
  if (i >= 0 && EXCLUDE_EXT.has(e.name.slice(i).toLowerCase())) return true;
  for (const g of EXCLUDE_NAME_GLOBS) { if (g.test(e.name)) return true; }
  return false;
}

function copyTree(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const e of readdirSync(src, { withFileTypes: true })) {
    if (shouldExclude(e)) continue;
    const s = join(src, e.name), d = join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (e.isFile()) copyFileSync(s, d);
  }
}

try {
  if (existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });
  if (existsSync(OUT_ZIP)) rmSync(OUT_ZIP, { force: true });

  console.log(`\nStaging ${DIST_NAME}...`);
  copyTree(ROOT, STAGE);

  const SHA256_PATH = `${OUT_ZIP}.sha256`;

  console.log(`\n--- Pre-release check (strict) on staged tree ---`);
  const env = { ...process.env, OPENRELAY_ROOT: STAGE };
  const { execSync } = await import("node:child_process");
  execSync(`node "${PRE_RELEASE_SCRIPT}" --strict`, { cwd: ROOT, env, stdio: "inherit" });
  console.log("Pre-release check on staging: PASS");

  console.log(`\n--- Building ${DIST_NAME}.zip ---`);
  await writeZip(STAGE, OUT_ZIP);
  console.log(`Built: ${OUT_ZIP}`);

  console.log(`\n--- Verifying zip ---`);
  execSync(`node "${VERIFY_ZIP_SCRIPT}" "${OUT_ZIP}"`, { cwd: ROOT, stdio: "inherit" });
  console.log("Zip verification: PASS");

  console.log(`\n--- Generating SHA256 ---`);
  const zipBuf = readFileSync(OUT_ZIP);
  const sha256 = createHash("sha256").update(zipBuf).digest("hex");
  writeFileSync(SHA256_PATH, `${sha256}  ${DIST_NAME}.zip\n`, "utf8");
  console.log(`SHA256: ${sha256}`);
  console.log(`SHA256 file: ${SHA256_PATH}`);

  if (!KEEP_STAGE && existsSync(STAGE)) rmSync(STAGE, { recursive: true, force: true });

  const sizeKb = (statSync(OUT_ZIP).size / 1024).toFixed(1);
  console.log(`\n=== Built ${DIST_NAME}.zip (${sizeKb} KB) ===`);
} catch (error) {
  console.error("Build failed:", error && error.stack ? error.stack : error);
  if (!KEEP_STAGE && existsSync(STAGE)) {
    console.log(`Staging tree preserved at: ${STAGE}`);
  }
  process.exit(1);
}
