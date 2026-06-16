// Check the rendered HTML body size and structure
const port = Number(process.argv[2]);
const r = await fetch(`http://127.0.0.1:${port}/`);
const text = await r.text();
const bodyMatch = text.match(/<body[^>]*>([\s\S]*)<\/body>/);
console.log("full body inner length:", bodyMatch[1].length);
console.log("full HTML length:", text.length);
const m = text.match(/<script>([\s\S]*?)<\/script>/);
console.log("script length:", m[1].length);

// Find unescaped </script> in the script body — that would be a fatal
// issue if present in the dynamic data.
const dangerousScript = m[1].indexOf("</script>");
if (dangerousScript >= 0) {
  console.log("DANGER: literal </script> found inside <script> body at offset", dangerousScript);
} else {
  console.log("OK: no literal </script> inside <script> body");
}

// Check if any dynamic JSON contains chars that would break the script
const arr = ["providers", "providerTemplates", "routes", "routeTemplates", "webKeys"];
for (const name of arr) {
  const re = new RegExp("const " + name + " = (\\[[\\s\\S]*?\\]);");
  const m2 = text.match(re);
  if (m2) {
    const val = m2[1];
    console.log(name + " JSON length:", val.length, " first 80 chars:", val.slice(0, 80));
  }
}
