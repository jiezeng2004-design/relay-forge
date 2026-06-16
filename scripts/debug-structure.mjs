// Fetch the dashboard and dump the script's outline structure
// (no template literal interpolation noise).
import { writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
const r = await fetch(`http://127.0.0.1:${port}/`);
const text = await r.text();
const m = text.match(/<script>([\s\S]*?)<\/script>/);
const scriptText = m[1];

// Find all "function " declarations and IIFEs
const lines = scriptText.split("\n");
console.log("total lines:", lines.length);

// Find lines that contain "function " (declarations) and report their line numbers + first 80 chars
const findings = [];
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (/^\s*function\s+\w+\s*\(/.test(l) || /\(function\s*\(\s*\)\s*\{/.test(l) || /\}\)\s*\(\s*\)\s*;/.test(l)) {
    findings.push({ line: i + 1, content: l.trim().slice(0, 100) });
  }
}
console.log("function declarations and IIFEs:");
for (const f of findings.slice(0, 20)) {
  console.log("  line " + f.line + ": " + f.content);
}
console.log("... total findings:", findings.length);

// Find lines that call document.body.innerHTML = ...
const innerHtmlLines = [];
for (let i = 0; i < lines.length; i++) {
  if (/document\.body\.innerHTML\s*=/.test(lines[i])) innerHtmlLines.push(i + 1);
}
console.log("document.body.innerHTML= lines:", innerHtmlLines);

// Find the IIFE wrapper range
const iifeOpen = lines.findIndex(l => /\(function\s*\(\s*\)\s*\{/.test(l));
const iifeClose = lines.findLastIndex ? lines.findLastIndex(l => /\}\)\s*\(\s*\)\s*;/.test(l)) : -1;
let lastIifeClose = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (/\}\)\s*\(\s*\)\s*;/.test(lines[i])) { lastIifeClose = i; break; }
}
console.log("IIFE open at line:", iifeOpen + 1, " close at line:", lastIifeClose + 1);
console.log("IIFE range:", iifeOpen + 1, "to", lastIifeClose + 1, "(", lastIifeClose - iifeOpen, "lines )");

// Look for any obvious mismatch in brace depth
let depth = 0;
const maxLine = lines.length;
for (let i = 0; i < maxLine; i++) {
  for (const ch of lines[i]) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
  }
}
console.log("final brace depth at end of script:", depth);
