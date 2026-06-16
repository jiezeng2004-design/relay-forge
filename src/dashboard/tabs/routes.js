// Routes tab: read-only route preview panel, virtual model group
// table, profile table, runtime key pool. Route create / edit happens
// in the same <details> form on this page (no separate tab).

import { escapeHtml } from "../../http-helpers.js";

export function renderRoutesTab(ctx) {
  return `
    <h2>模型组 / Profile / Key 池</h2>
    <div class="panel" id="route-preview-panel">
      <div class="panel-title"><h3>路由预览</h3>
        <span class="muted">只读 · 不调用上游 · 不写配置</span>
      </div>
      <p class="muted">输入一个 model 名（<code>auto</code> / <code>default</code> / 路由名 / <code>provider:model</code> / 裸 model 名），查看会匹配到哪个 route / profile、candidates 顺序、provider 本地/云端、Key 状态、健康状态，以及 <code>allowInsecureHttp</code> 风险标记。</p>
      <div class="field-row" style="grid-template-columns: 1fr auto; align-items: end;">
        <div class="field">
          <label for="route-preview-input">model 名称</label>
          <input id="route-preview-input" type="text" placeholder="auto / coding-local / deepseek:deepseek-chat / deepseek-chat" autocomplete="off" data-route-preview-input>
        </div>
        <button id="route-preview-button" type="button" class="primary" data-route-preview-button>预览</button>
      </div>
      <div id="route-preview-output" data-route-preview-output style="margin-top: 12px;">
        <div class="muted">点"预览"或按 Enter 查看解析结果。Active profile = <code>${escapeHtml(ctx.status.profiles?.activeProfile || "(无)")}</code> · defaultModel = <code>${escapeHtml(ctx.status.profiles?.defaultModel || "(无)")}</code>。</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>虚拟模型组（Route）</h3>
        <span class="muted">${ctx.status.routes ? ctx.status.routes.length : 0} 个</span>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>模型</th><th style="width: 90px;">策略</th><th style="width: 130px;">日限额</th><th>候选</th><th style="width: 170px;">状态</th><th style="width: 110px;">操作</th></tr></thead>
          <tbody>${ctx.routeRows || '<tr><td colspan="6" class="muted">还没有虚拟模型组</td></tr>'}</tbody>
        </table>
      </div>
      <details class="collapsible" id="route-form-card">
        <summary>新增 / 编辑 Route</summary>
        <p class="muted" style="margin-top: 8px;">保存时自动备份 <code>config.json</code>；删除前服务端会检查是否被 Profile 引用。本地 relay 不主动限制调用次数（上游限制仍然存在），日限额是软上限。</p>
        <div class="form-grid">
          <div class="field">
            <label for="route-template">使用模板</label>
            <select id="route-template"><option value="">选择模板填充表单</option>${ctx.routeTemplateOptions}</select>
          </div>
          <div class="field">
            <label for="route-name">Route 名称</label>
            <input id="route-name" type="text" placeholder="例如 coding-local">
          </div>
          <div class="field">
            <label for="route-description">描述</label>
            <input id="route-description" type="text" placeholder="例如 优先云端，自有 Key 失败后回落本地模型">
          </div>
          <div class="field">
            <label for="route-strategy">策略</label>
            <select id="route-strategy">
              <option value="fallback">fallback</option>
              <option value="round_robin">round_robin</option>
              <option value="weighted">weighted</option>
            </select>
          </div>
          <div class="field">
            <label for="route-limit">本地日限额（可选）</label>
            <input id="route-limit" type="number" min="1" step="1" placeholder="留空表示本地 relay 不主动限制调用次数（上游限制仍然存在）">
          </div>
        </div>
        <div class="field" style="margin-top: 12px;">
          <label for="route-candidates">候选 provider / model / weight</label>
          <div id="route-candidate-rows" class="stack"></div>
          <button id="route-add-candidate" type="button" class="small" style="margin-top: 8px;">添加候选</button>
          <textarea id="route-candidates" class="compact-area" spellcheck="false" hidden></textarea>
          <div class="muted">每个候选包含 provider、model 和 weight；weight 留空时按 1 处理。这里不会添加真实 Key，候选 provider 必须已存在。</div>
        </div>
        <div class="row-actions" style="margin-top: 12px;">
          <button id="route-create" type="button" class="primary">新增 Route</button>
          <button id="route-update" type="button">保存编辑</button>
          <button id="route-clear" type="button">清空表单</button>
        </div>
        <div id="route-message" class="notice" style="margin-top: 12px;">可以从模板开始，或点击上方模型组行里的"编辑"。</div>
      </details>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>Profile 预设</h3>
        <button class="small" id="new-profile">新建 Profile</button>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>Profile</th><th>默认模型</th><th style="width: 100px;">状态</th><th style="width: 200px;">操作</th></tr></thead>
          <tbody>${ctx.profileRows || '<tr><td colspan="4" class="muted">还没有 Profile</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>运行时 Key 池</h3>
        <span class="muted">只显示掩码和 hash 前 12 位，冷却中的 Key 下次选择会跳过。</span>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>服务方</th><th>Key</th><th style="width: 80px;">使用</th><th style="width: 80px;">失败</th><th style="width: 130px;">状态</th></tr></thead>
          <tbody>${ctx.keyPoolRows || '<tr><td colspan="5" class="muted">还没有任何 Key</td></tr>'}</tbody>
        </table>
      </div>
    </div>
  `;
}
