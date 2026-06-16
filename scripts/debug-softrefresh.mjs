// Simulate what the dashboard softRefresh does: fetch /, parse, extract script, re-evaluate.
import { writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
console.log("using port", port);
const r = await fetch(`http://127.0.0.1:${port}/`);
const t = await r.text();
console.log("text length:", t.length);
const m = t.match(/<script>([\s\S]*?)<\/script>/);
console.log("script length:", m[1].length);
writeFileSync("D:/tmp-script.js", m[1]);

// Try to parse
let parseOk = true;
try { new Function(m[1]); } catch (e) { parseOk = false; console.log("parse err:", e.message); }
if (parseOk) console.log("script parses OK");

// Now try to simulate the IIFE pattern: extract the body between (function () { and })();
const iifeStart = m[1].indexOf("(function () {");
const iifeEnd = m[1].lastIndexOf("})();");
console.log("iifeStart:", iifeStart, "iifeEnd:", iifeEnd);
if (iifeStart >= 0 && iifeEnd > iifeStart) {
  const iifeBody = m[1].slice(iifeStart, iifeEnd + 4);
  console.log("iifeBody length:", iifeBody.length);
  try {
    new Function(iifeBody)();
    console.log("IIFE body runs OK in isolation");
  } catch (e) {
    console.log("IIFE body err:", e.message);
  }
}
