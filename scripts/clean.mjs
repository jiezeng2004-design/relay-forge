import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const targets = [
  "data",
  "backups",
  "tool-env.ps1",
  "tool-env.cmd",
  "tool-env.sh",
  "openrelay-local-safe.log",
  "openrelay-local-safe.err",
  "_new_section.txt",
  "_s.txt"
];

const removed = [];
for (const rel of targets) {
  const fullPath = resolve(rootDir, rel);
  if (!isInsideRoot(fullPath)) throw new Error(`refusing to clean outside project root: ${fullPath}`);
  if (!existsSync(fullPath)) continue;
  rmSync(fullPath, { recursive: true, force: true });
  removed.push(rel);
}

console.log(JSON.stringify({
  ok: true,
  rootDir,
  removed,
  kept: ["src/", "scripts/", "README.md", "config.example.json", "package.json", "*.zip"]
}, null, 2));

function isInsideRoot(fullPath) {
  const root = rootDir.toLowerCase();
  const target = fullPath.toLowerCase();
  return target === root || target.startsWith(root + "\\") || target.startsWith(root + "/");
}
