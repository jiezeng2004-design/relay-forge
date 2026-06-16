// Find the discover-models-card block in the rendered HTML and dump it
const port = Number(process.argv[2]);
const r = await fetch(`http://127.0.0.1:${port}/`);
const text = await r.text();

const idx = text.indexOf('id="discover-models-card"');
if (idx < 0) { console.log("not found"); process.exit(1); }
console.log("discover-models-card at offset:", idx);
console.log("---");
console.log(text.slice(idx, idx + 500));
console.log("---");

// Now also check the inline key panel
const idx2 = text.indexOf("给当前 Provider 添加真实 API Key");
if (idx2 < 0) { console.log("inline key panel not found"); process.exit(1); }
console.log("inline key panel at offset:", idx2);
console.log(text.slice(idx2 - 100, idx2 + 200));
console.log("---");

// Check provider-form-key-status
const idx3 = text.indexOf("provider-form-key-status");
console.log("provider-form-key-status at offset:", idx3);
console.log(text.slice(idx3, idx3 + 400));
