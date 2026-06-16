// Usage & errors tab: today's usage, history chart, recent error log
// with category chips + client-side filter, diagnostic summary
// (plain-text) and Codex diagnostic package (JSON) hidden textareas
// for the copy buttons.

import { escapeHtml } from "../../http-helpers.js";
import { ERROR_CATEGORIES } from "../../error-category.js";
import { buildDiagnosticSummary, buildCodexDiagnosticPackage, renderErrorRow } from "../rows.js";

export function renderUsageTab(ctx) {
  const errorCatItems = ERROR_CATEGORIES.map((key) => ({ key, label: key }));
  const errorChips = errorCatItems
    .map((c) => `<span class="err-cat ${escapeHtml(c.key)}">${escapeHtml(c.label)} · ${ctx.errorCounts[c.key] || 0}</span>`)
    .join(" ");
  const filterButtons = errorCatItems
    .map((c) => `<button class="small" data-filter-cat="${escapeHtml(c.key)}" style="margin:2px 4px 2px 0;">${escapeHtml(c.label)}</button>`)
    .join("");
  const filterAllButton = `<button class="small primary" data-filter-cat="all" data-filter-active="true" style="margin:2px 4px 2px 0;">全部</button>`;
  const diagnostic = buildDiagnosticSummary(ctx);
  const codexDiagnostic = buildCodexDiagnosticPackage(ctx);

  // Split errors into this-session (since server startedAt) and historical
  const startedAt = ctx.status?.stats?.startedAt;
  const sessionErrors = startedAt ? (ctx.errors || []).filter(e => e.at >= startedAt) : (ctx.errors || []);
  const historicalErrors = startedAt ? (ctx.errors || []).filter(e => e.at < startedAt) : [];
  return `
    <h2>用量与错误</h2>
    <div class="panel">
      <div class="panel-title"><h3>今日用量</h3>
        <span class="muted">${ctx.status.usage && ctx.status.usage.daily ? ctx.status.usage.daily.total : 0} 次</span>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>名称</th><th style="width: 80px;">次数</th><th style="width: 80px;">类型</th></tr></thead>
          <tbody>${ctx.usageRows || '<tr><td colspan="3" class="muted">今天还没有请求</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>历史用量</h3>
        <span class="muted">${ctx.status.usage?.historyDays || 14} 天</span>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>日期</th><th style="width: 80px;">总数</th><th>趋势</th><th style="width: 140px;">最高路由</th><th style="width: 140px;">最高服务方</th></tr></thead>
          <tbody>${ctx.historyRows || '<tr><td colspan="5" class="muted">还没有历史用量</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>最近错误（按时间倒序）</h3>
        <div class="row-actions">
          <button class="small" id="copy-diagnostics">复制诊断摘要</button>
          <button class="small" id="copy-codex-diagnostics">复制 Codex 诊断包</button>
          <button class="small" id="clear-error-log" title="仅清除当前浏览器显示的错误列表，不影响服务端">清除列表</button>
          <a href="/admin/error-log" target="_blank" rel="noopener" class="muted">完整 JSON</a>
        </div>
      </div>
      <p class="muted" style="margin-top: 6px;">分类：${errorChips}</p>
      <p class="muted" style="margin-top: 4px;">筛选：${filterAllButton}${filterButtons}</p>
      <p class="muted">不展示 prompt 明文。分类由服务端在错误发生时生成。本次启动后的错误优先显示，历史错误折叠。</p>

      ${sessionErrors.length > 0
        ? `<details open>
        <summary style="cursor:pointer;font-weight:600;margin:8px 0 4px;">本次启动后错误（${sessionErrors.length}）</summary>
        <div class="scroll-x" id="error-table-wrap">
        <table id="error-table">
          <thead><tr><th style="width: 180px;">时间</th><th style="width: 110px;">分类</th><th style="width: 220px;">范围</th><th>错误摘要</th></tr></thead>
          <tbody>${sessionErrors.map(e => renderErrorRow(e)).join("")}</tbody>
        </table>
      </div></details>`
        : `<div class="empty-state"><strong>本次启动后暂无错误</strong><span>relay 启动以来没有记录到错误。</span></div>`}

      ${historicalErrors.length > 0
        ? `<details>
        <summary style="cursor:pointer;font-weight:600;margin:8px 0 4px;color:var(--muted);">历史错误（${historicalErrors.length}）</summary>
        <div class="scroll-x">
        <table>
          <thead><tr><th style="width: 180px;">时间</th><th style="width: 110px;">分类</th><th style="width: 220px;">范围</th><th>错误摘要</th></tr></thead>
          <tbody>${historicalErrors.map(e => renderErrorRow(e)).join("")}</tbody>
        </table>
      </div></details>`
        : `<div class="empty-state" style="margin-top:8px;"><span class="muted">无历史错误。</span></div>`}
      <textarea id="diagnostic-summary" hidden>${escapeHtml(diagnostic)}</textarea>
      <textarea id="codex-diagnostic-summary" hidden>${escapeHtml(codexDiagnostic)}</textarea>
    </div>
  `;
}
