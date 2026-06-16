// Simulate the softRefresh flow with a minimal DOM stub. The goal
// is to catch runtime errors when the inline script is re-evaluated
// after the body is swapped.

import { writeFileSync } from "node:fs";

const port = Number(process.argv[2]);
const r = await fetch(`http://127.0.0.1:${port}/`);
const text = await r.text();

// Minimal DOM stub
function makeEl(tag) {
  return {
    tagName: tag.toUpperCase(),
    children: [],
    attributes: {},
    style: {},
    classList: {
      _set: new Set(),
      add(...c) { for (const x of c) this._set.add(x); },
      remove(...c) { for (const x of c) this._set.delete(x); },
      contains(c) { return this._set.has(c); },
      toggle(c, force) {
        if (force === true) this._set.add(c);
        else if (force === false) this._set.delete(c);
        else if (this._set.has(c)) this._set.delete(c);
        else this._set.add(c);
        return this._set.has(c);
      }
    },
    dataset: {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; },
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] || null; },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) { return findOne(this, sel); },
    querySelectorAll(sel) { return findAll(this, sel); },
    get innerHTML() { return this.children.map(c => c.outerHTML || "").join(""); },
    set innerHTML(v) {
      // Parse the HTML string minimally: find top-level tags.
      // For our test, we just clear children and add a placeholder.
      this.children = [];
      this.children.push({ outerHTML: v, _raw: true });
    },
    get outerHTML() { return "<" + this.tagName.toLowerCase() + ">"; }
  };
}

function findOne(root, sel) {
  const all = findAll(root, sel);
  return all.length > 0 ? all[0] : null;
}

function findAll(root, sel) {
  const result = [];
  const visit = (node) => {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child._raw) continue;
      // Simple id selector
      if (sel.startsWith("#")) {
        const id = sel.slice(1);
        if (child.attributes && child.attributes.id === id) result.push(child);
      } else if (sel.startsWith(".")) {
        const cls = sel.slice(1);
        const classes = (child.attributes && child.attributes.class || "").split(/\s+/);
        if (classes.includes(cls)) result.push(child);
      } else if (sel.includes("[") && sel.includes("]")) {
        // like "a[data-tab]"
        const m = sel.match(/^(\w+)?\[([^=]+)(?:=([^]]+))?\]$/);
        if (m) {
          const [, tag, attr, val] = m;
          if (!tag || child.tagName === tag.toUpperCase()) {
            const v = child.attributes && child.attributes[attr];
            if (val === undefined || v === val) result.push(child);
          }
        }
      } else if (sel.includes(" ")) {
        // simple descendant - just visit children with relaxed check
      } else {
        if (child.tagName === sel.toUpperCase()) result.push(child);
      }
      visit(child);
    }
  };
  visit(root);
  return result;
}

// Set up minimal window/document
const elements = new Map();
function registerById(id) {
  return {
    id, value: "", textContent: "", innerHTML: "",
    style: {}, dataset: {}, attributes: { id },
    classList: { _set: new Set(), add() {}, remove() {}, contains() { return false; }, toggle() {} },
    appendChild() {}, removeChild() {}, addEventListener() {},
    setAttribute(k, v) { this.attributes[k] = v; },
    getAttribute(k) { return this.attributes[k] || null; },
    querySelector() { return null; }, querySelectorAll() { return []; }
  };
}

const documentStub = {
  getElementById(id) { return elements.get(id) || null; },
  querySelectorAll() { return []; },
  querySelector() { return null; }
};

const m = text.match(/<script>([\s\S]*?)<\/script>/);
const scriptText = m[1];

// First, try to parse and re-eval the script with the stub
try {
  const fn = new Function("document", "window", scriptText);
  fn(documentStub, {});
  console.log("first eval OK");
} catch (e) {
  console.log("first eval err:", e.message);
  // Find approximate line
  const lines = scriptText.split("\n");
  console.log("total script lines:", lines.length);
}
