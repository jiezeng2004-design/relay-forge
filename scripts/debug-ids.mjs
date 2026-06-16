// Debug: fetch the dashboard and verify every getElementById the
// inline script references actually exists in the rendered HTML.
// If any element is missing, initDashboard throws during
// softRefresh and the page goes blank.

const port = Number(process.argv[2]);
const r = await fetch(`http://127.0.0.1:${port}/`);
const text = await r.text();

// Find every document.getElementById("...") reference
const refs = new Set();
for (const m of text.matchAll(/document\.getElementById\(\s*["']([^"']+)["']/g)) {
  refs.add(m[1]);
}
// Also: getElementById(... optional ...) — just look for all
const refsOpt = new Set();
for (const m of text.matchAll(/getElementById\(\s*["']([^"']+)["']/g)) {
  refsOpt.add(m[1]);
}

// Verify each id exists as id="..." in the body
const missing = [];
for (const id of refsOpt) {
  if (id === "config-editor-save") continue; // may not exist by that exact name; check raw
  const re = new RegExp(`id=["']${id}["']`);
  if (!re.test(text)) {
    missing.push(id);
  }
}
console.log("total getElementById refs:", refsOpt.size);
console.log("missing ids in HTML:", missing.length, missing);

// Also: enumerate all id= attributes in the page
const allIds = new Set();
for (const m of text.matchAll(/\bid=["']([^"']+)["']/g)) {
  allIds.add(m[1]);
}
console.log("total ids in HTML:", allIds.size);
// Save to file for inspection
import { writeFileSync } from "node:fs";
writeFileSync("D:/tmp-ids.txt", Array.from(allIds).sort().join("\n"));
