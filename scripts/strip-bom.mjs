// Strip UTF-8 BOM (EF BB BF) from all .js and .json files under src/ and i18n/.
// Run this before build-dist to ensure no BOM sneaks into the release zip.
// Zero npm dependencies — uses only node:fs and node:path.

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BOM = [0xEF, 0xBB, 0xBF];
const root = join(process.cwd(), "src");
const i18nDir = join(process.cwd(), "i18n");

let scanned = 0;
let stripped = 0;
let alreadyClean = 0;

function hasBom(bytes) {
  return bytes.length >= 3 && bytes[0] === BOM[0] && bytes[1] === BOM[1] && bytes[2] === BOM[2];
}

function walk(dir, exts) {
  const results = [];
  let entries;
  try { entries = readdirSync(dir); } catch { return results; }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      results.push(...walk(full, exts));
    } else if (exts.some((ext) => name.endsWith(ext))) {
      results.push(full);
    }
  }
  return results;
}

const targets = [
  ...walk(root, [".js"]),
  ...walk(i18nDir, [".json"])
];

for (const file of targets) {
  scanned++;
  const bytes = readFileSync(file);
  if (hasBom(bytes)) {
    writeFileSync(file, bytes.subarray(3));
    stripped++;
    console.log(`  stripped BOM: ${relative(process.cwd(), file)}`);
  } else {
    alreadyClean++;
  }
}

console.log(`\nScanned: ${scanned} files`);
console.log(`Stripped: ${stripped} files with BOM`);
console.log(`Already clean: ${alreadyClean} files`);
process.exit(0);
