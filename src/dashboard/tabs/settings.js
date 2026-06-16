// Settings tab: admin token (sessionStorage only, never written to
// disk), config editor (load / save / export / import), and the
// read-only caches (health / balance / discovery).

import { escapeHtml } from "../../http-helpers.js";

export function renderSettingsTab(ctx) {
  return `
    <h2>设置</h2>
    <div class="section-label">会话与会话级安全</div>
    <div class="panel">
      <div class="panel-title"><h3>本地管理 Token</h3></div>
      <p class="muted">如果设置了 <code>RELAY_TOKEN</code>，把 Token 粘到下面保存到本浏览器 sessionStorage（<strong>不</strong>写入文件 / URL / 日志）。<strong>未设置 RELAY_TOKEN 时仍可本地使用</strong>，但建议在 <code>.env</code> 配一个保护管理接口。</p>
      <div class="field-row">
        <div class="field">
          <label for="admin-token">RELAY_TOKEN</label>
          <input id="admin-token" type="password" autocomplete="off" placeholder="未设置 RELAY_TOKEN 时可留空">
        </div>
        <button id="admin-token-save" type="button">保存到本次会话</button>
        <button id="admin-token-clear" type="button">清除</button>
      </div>
    </div>
    <div class="section-label">写操作（会改 config.json）</div>
    <div class="panel">
      <div class="panel-title"><h3>配置编辑器</h3>
        <div class="row-actions">
          <button class="small" id="load-config">加载</button>
          <button class="small primary" id="save-config">保存</button>
          <button class="small" id="export-config">导出</button>
          <button class="small" id="import-config">导入</button>
          <input id="import-config-file" type="file" accept="application/json,.json" hidden>
        </div>
      </div>
      <p class="muted">只编辑 Provider / 模型组 / 限额 / 健康检查等非密钥配置。编辑器会拒绝 <code>apiKey</code> / <code>token</code> / <code>secret</code> / <code>password</code> / <code>cookie</code> / <code>authorization</code> 字段，真实 Key 仍在 <code>.env</code> 或 Web Key 管理里。保存前会校验 JSON，自动备份旧 <code>config.json</code>。</p>
      <textarea id="config-editor" spellcheck="false" aria-label="配置 JSON 编辑器"></textarea>
      <div id="admin-message" class="notice">配置编辑器空闲中。</div>
    </div>
    <div class="section-label">只读缓存</div>
    <div class="panel">
      <div class="panel-title"><h3>健康检查缓存</h3>
        <span class="muted">${ctx.status.healthChecks?.enabled ? `已开启，每 ${ctx.status.healthChecks.intervalMinutes} 分钟` : "已关闭（默认）"}</span>
      </div>
      <p class="muted">健康检查会向上游发一次极小的请求，可能消耗上游额度，建议仅在确实需要监控时打开。</p>
      <div class="scroll-x">
        <table>
          <thead><tr><th>服务方</th><th style="width: 80px;">结果</th><th>模型</th><th>状态</th><th style="width: 80px;">耗时 (ms)</th><th>检查时间</th></tr></thead>
          <tbody>${ctx.healthRows || '<tr><td colspan="6" class="muted">还没有健康检查记录</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>余额检测缓存</h3></div>
      <p class="muted">点击 Provider 行里的"查余额"按钮，会调用该 Provider 在 <code>config.json</code> 里配置的公开 <code>balanceEndpoint</code>。<strong>不会自动轮询，不会读取任何本地 app 的 token/cookie</strong>。遇到 302 重定向会主动拒绝。</p>
      <div class="scroll-x">
        <table>
          <thead><tr><th>服务方</th><th style="width: 80px;">结果</th><th>摘要</th><th>检查时间</th></tr></thead>
          <tbody>${ctx.balanceRows || '<tr><td colspan="4" class="muted">还没有余额检测。需要在 Provider 的 <code>config.json</code> 里配置 <code>balanceEndpoint</code> 才能用。</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>模型发现缓存</h3>
        <span class="muted">Provider 行里的"发现模型"按钮调用 <code>/models</code> 端点，把模型列表缓存到本地。不会自动修改 <code>config.json</code>。</span>
      </div>
      <p class="muted">Provider 行里的"发现模型"按钮调用 <code>/models</code> 端点，把模型列表缓存到本地。不会自动修改 <code>config.json</code>。</p>
      <div class="scroll-x">
        <table>
          <thead><tr><th>服务方</th><th style="width: 80px;">结果</th><th style="width: 80px;">数量</th><th>模型（前 8 个）</th><th>发现时间</th></tr></thead>
          <tbody>${ctx.discoveryRows || '<tr><td colspan="5" class="muted">还没有模型发现</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>模型别名 (modelAliases)</h3>
        <span class="muted">0.1.3+：用户请求的模型名到 provider:model 或 route 的映射</span>
      </div>
      ${renderModelAliases(ctx.status)}
    </div>
  `;
}

/**
 * Renders the modelAliases table from the status object.
 * @param {object} status
 * @returns {string}
 */
function renderModelAliases(status) {
  const configModelAliases = status.modelAliases || {};
  const aliasEntries = Object.entries(configModelAliases);
  if (aliasEntries.length === 0) {
    return '<p class="muted">还没有配置模型别名。可在 <code>config.json</code> 的 <code>modelAliases</code> 段添加，参见 <code>config.example.json</code>。</p>';
  }
  const rows = aliasEntries.map(([alias, target]) =>
    `<tr><td><code>${escapeHtml(alias)}</code></td><td><code>${escapeHtml(target)}</code></td></tr>`
  ).join("");
  return `
    <p class="muted">定义在 <code>config.modelAliases</code> 中的别名：</p>
    <div class="scroll-x">
      <table>
        <thead><tr><th>别名</th><th>目标 (provider:model / route)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}
