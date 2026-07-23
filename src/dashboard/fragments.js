// Extracted from server.js — pure rendering helpers shared by the
// tab dispatcher and other dashboard rendering code. No closures,
// no module-level state: every function is self-contained.

import { escapeHtml } from "../http-helpers.js";

/** @param {object} entry @returns {string} */
export function renderErrorRow(entry) {
  const time = entry.scope || "";
  const cat = entry.category ? `<span class="pill warn">${escapeHtml(entry.category)}</span>` : "";
  const msg = escapeHtml((entry.message || entry.error || "")).slice(0, 120);
  return `<tr><td class="mono">${escapeHtml(time)}</td><td>${cat}</td><td class="mono">${msg}</td></tr>`;
}

/** @param {Array} errors @returns {object} */
export function classifyErrorCounts(errors) {
  const counts = {};
  for (const e of errors) { const cat = e.category || "unknown"; counts[cat] = (counts[cat] || 0) + 1; }
  return counts;
}

/** @param {object|null} data @returns {string} */
export function topUsageLabel(data) {
  if (!data || typeof data !== "object") return "";
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return entries.length > 0 ? entries[0][0] : "";
}

/** @param {string|null|undefined} ts @returns {string} */
export function formatTimestamp(ts) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString("zh-CN", { hour12: false }); } catch { return ts; }
}

/** @param {object} status @returns {Array<{value: string, label: string}>} */
export function buildProfileDefaultOptions(status) {
  const out = [];
  for (const p of status.profiles?.profiles || []) out.push({ value: p.name, label: `个人设置: ${p.name}` });
  for (const r of status.routes || []) out.push({ value: r.name, label: `模型组: ${r.name} (${r.strategy})` });
  for (const prov of status.providers || []) { for (const m of prov.models || []) out.push({ value: `${prov.name}:${m}`, label: `${prov.displayName||prov.name}: ${m}` }); }
  return out;
}

/** @param {object} route @param {object} usage @param {object} limits @returns {string} */
export function renderRouteRow(route, usage, limits) {
  const today = usage?.daily?.routes?.[route.name] || 0;
  const lim = route.limits?.dailyRequests || limits?.routes?.[route.name]?.dailyRequests || limits?.dailyRequests || "—";
  return `<tr><td><strong>${escapeHtml(route.name)}</strong>${route.description?`<div class="muted">${escapeHtml(route.description)}</div>`:""}</td><td>${escapeHtml(route.strategy)}</td><td>${route.candidates.map((c)=>escapeHtml(c.provider+":"+c.model)).join(", ")}</td><td>${today}</td><td>${lim}</td></tr>`;
}
