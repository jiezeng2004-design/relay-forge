// Providers tab: 4 summary cards, client-side filters, the
// provider table, the form for create / edit, the discover-models
// widget, and the Web Key management panel.

import { escapeHtml } from "../../http-helpers.js";
import { formatTimestamp } from "../shared.js";

export function renderProvidersTab(ctx) {
  const providers = ctx.status.providers || [];
  const webKeys = ctx.status.webKeys || [];
  const healthCache = ctx.status.healthCache || {};
  const keysByProvider = ctx.status.keys || {};
  const providerHealth = ctx.status.providerHealth || {};

  const localCount = providers.filter((p) => p.local).length;
  const cloudCount = providers.length - localCount;
  const needsKeyCount = providers.filter((p) => {
    if (p.local) return false;
    const webCount = webKeys.filter((k) => k.provider === p.name && k.enabled).length;
    return webCount === 0 && p.keyCount === 0;
  }).length;
  const failedCount = providers.filter((p) => {
    const h = healthCache[p.name];
    return h && !h.ok;
  }).length;
  const readyCount = providers.length - needsKeyCount - failedCount;

  const recentErrorProviders = new Set();
  for (const entry of (ctx.status.recentErrors || [])) {
    if (entry && entry.provider) recentErrorProviders.add(entry.provider);
  }
  const insecureRiskCount = providers.filter((p) => p.insecureHttpRisk === true).length;
  const rateLimitedCount = providers.filter((p) => providerHealth[p.name]?.rateLimited === true).length;
  const untestedCount = providers.filter((p) => {
    const h = healthCache[p.name];
    return !h;
  }).length;
  const balanceCache = ctx.status.balanceCache || {};
  const balanceOkCount = providers.filter((p) => balanceCache[p.name]?.ok === true).length;
  const balanceErrorCount = providers.filter((p) => balanceCache[p.name] && balanceCache[p.name].ok !== true).length;
  const balanceUntestedCount = providers.filter((p) => p.balanceEndpoint && typeof p.balanceEndpoint === "object" && !balanceCache[p.name]).length;

  const filterDefs = [
    { key: "all", label: `全部 (${providers.length})` },
    { key: "local", label: `本地 (${localCount})` },
    { key: "cloud", label: `云端 (${cloudCount})` },
    { key: "needs-key", label: `缺 Key (${needsKeyCount})` },
    { key: "untested", label: `未测试 (${untestedCount})` },
    { key: "insecure-risk", label: `有风险 (${insecureRiskCount})` },
    { key: "rate-limited", label: `Retry-After (${rateLimitedCount})` },
    { key: "balance-ok", label: `Quota ok (${balanceOkCount})` },
    { key: "balance-error", label: `Quota error (${balanceErrorCount})` },
    { key: "balance-untested", label: `Quota untested (${balanceUntestedCount})` },
    { key: "recent-failed", label: `最近失败 (${recentErrorProviders.size})` }
  ];
  const filterButtons = filterDefs.map((def) =>
    `<button type="button" class="small" data-provider-filter="${def.key}" data-provider-filter-active="${def.key === "all" ? "true" : "false"}" style="margin:2px 4px 2px 0;">${def.label}</button>`
  ).join("");

  const connectorPlanSection = `
    <div class="panel">
      <div class="panel-title"><h3>本地连接器发现计划</h3>
        <span class="muted">dry-run，仅计划阶段，不会读取凭据/配置</span>
      </div>
      <div class="toolbar" style="margin: 0 0 8px;">
        <button type="button" id="local-connector-plan-build" class="small" style="margin-right:8px;" data-connector-plan-endpoint="/admin/local-connector-plan">构建连接器计划</button>
        <button type="button" id="local-connector-plan-refresh" class="small" style="margin-right:8px;" data-connector-plan-endpoint="/admin/local-connector-plan">刷新连接器计划</button>
        <span class="muted" style="font-size:11px;">不读取 Token / Cookie / 会话 / IDE 凭据，不写配置。</span>
      </div>
      <div id="local-connector-plan-output" class="panel" style="background:var(--soft);padding:12px;margin-top:4px;">
        <div class="muted" style="font-size:12px;">尚未运行连接器发现计划。点"构建连接器计划"生成初始化干运行报告。</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>本地连接器可用性检查</h3>
        <span class="muted">干运行，不读取 Token / Cookie / 凭据 / 路径</span>
      </div>
      <div class="toolbar" style="margin: 0 0 8px;">
        <button type="button" id="local-connector-availability-check" class="small" style="margin-right:8px;" data-connector-availability-endpoint="/admin/local-connector-availability">检查连接器可用性</button>
        <button type="button" id="local-connector-availability-refresh" class="small" style="margin-right:8px;" data-connector-availability-endpoint="/admin/local-connector-availability">刷新可用性</button>
        <span class="muted" style="font-size:11px;">不读取凭据，不检查路径，不启动进程。</span>
      </div>
      <div id="local-connector-availability-output" class="panel" style="background:var(--soft);padding:12px;margin-top:4px;">
        <div class="muted" style="font-size:12px;">尚未检查连接器可用性。点"检查连接器可用性"触发干运行检测。</div>
      </div>
    </div>
  `;

  return `
    <h2>Provider</h2>
    ${connectorPlanSection}
    <div class="grid grid-4">
      <div class="metric"><span class="label">可用</span><span class="value ok">${readyCount}</span><span class="sub">本地 ${localCount} · 云端 ${cloudCount}</span></div>
      <div class="metric"><span class="label">缺 Key</span><span class="value ${needsKeyCount > 0 ? 'warn' : 'ok'}">${needsKeyCount}</span><span class="sub">云端 provider 无可用 Key</span></div>
      <div class="metric"><span class="label">本地</span><span class="value">${localCount}</span><span class="sub">无需 API Key</span></div>
      <div class="metric"><span class="label">最近失败</span><span class="value ${failedCount > 0 ? 'bad' : 'ok'}">${failedCount}</span><span class="sub">健康检查失败</span></div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>本地连接器 Provider 预览（Dry-Run）</h3>
        <span class="muted">干运行，不注册路由，不读取凭据/路径</span>
      </div>
      <div class="toolbar" style="margin: 0 0 8px;">
        <button type="button" id="local-connector-provider-preview-build" class="small" style="margin-right:8px;" data-connector-provider-preview-endpoint="/admin/local-connector-provider-preview">构建 Provider 预览</button>
        <button type="button" id="local-connector-provider-preview-refresh" class="small" style="margin-right:8px;" data-connector-provider-preview-endpoint="/admin/local-connector-provider-preview">刷新 Provider 预览</button>
        <span class="muted" style="font-size:11px;">不读取凭据，不暴露路径，不注册路由，不启动进程。</span>
      </div>
      <div id="local-connector-provider-preview-output" class="panel" style="background:var(--soft);padding:12px;margin-top:4px;">
        <div class="muted" style="font-size:12px;">尚未运行 Provider 预览。点"构建 Provider 预览"生成干运行报告。</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>本地连接器授权清单（Dry-Run）</h3>
        <span class="muted">干运行，不保存授权，不读取凭据/路径</span>
      </div>
      <div class="toolbar" style="margin: 0 0 8px;">
        <button type="button" id="local-connector-consent-manifest-build" class="small" style="margin-right:8px;" data-connector-consent-manifest-endpoint="/admin/local-connector-consent-manifest">构建授权清单</button>
        <button type="button" id="local-connector-consent-manifest-refresh" class="small" style="margin-right:8px;" data-connector-consent-manifest-endpoint="/admin/local-connector-consent-manifest">刷新授权清单</button>
        <button type="button" id="local-connector-consent-ledger-refresh" class="small" style="margin-right:8px;" data-connector-consent-ledger-endpoint="/admin/local-connector-consent-ledger">查看授权记录</button>
        <button type="button" id="local-connector-consent-approve" class="small danger" style="margin-right:8px;" data-connector-consent-endpoint="/admin/local-connector-consent">记录连接器授权</button>
        <button type="button" id="local-connector-consent-revoke" class="small" data-connector-consent-endpoint="/admin/local-connector-consent">撤销连接器授权</button>
        <span class="muted" style="font-size:11px;">清单只展示确认范围；授权记录需输入确认串，只保存元数据，不读取凭据。</span>
      </div>
      <div id="local-connector-consent-manifest-output" class="panel" style="background:var(--soft);padding:12px;margin-top:4px;">
        <div class="muted" style="font-size:12px;">尚未构建授权清单。点"构建授权清单"生成干运行报告。</div>
      </div>
      <div id="local-connector-consent-ledger-output" class="panel" style="background:var(--soft);padding:12px;margin-top:8px;">
        <div class="muted" style="font-size:12px;">尚未查看授权记录。记录授权只保存元数据，不读取凭据，不注册路由；撤销只删除该连接器的授权元数据。</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>配置健康预览（只读）</h3>
        <span class="muted">dry-run，不调用上游，不消耗额度，不写运行时状态</span>
      </div>
      <div class="toolbar" style="margin: 0 0 8px;">
        <button type="button" id="provider-test-preview-all" class="small" style="margin-right:8px;">检查全部 Provider</button>
        <button type="button" id="provider-test-preview-local" class="small" style="margin-right:8px;">只检查本地 Provider</button>
        <span class="muted" style="font-size:11px;">结果不会保存。</span>
      </div>
      <div id="provider-test-preview-output" class="panel" style="background:var(--soft);padding:12px;margin-top:4px;">
        <div class="muted" style="font-size:12px;">尚未运行配置健康预览。点上方按钮检查所有 Provider 的配置完整性。</div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>列表</h3>
        <div class="toolbar" style="margin: 0;">
          <span class="muted">${(ctx.status.providers || []).length} 个 Provider · 筛选：</span>
          ${filterButtons}
        </div>
      </div>
      <div class="scroll-x" id="provider-table-wrap">
        <table id="provider-table">
          <thead><tr>
            <th>Provider</th>
            <th style="width: 80px;">类型</th>
            <th style="width: 110px;">本地 / 云端</th>
            <th style="width: 150px;">Key 状态</th>
            <th style="width: 100px;">健康</th>
            <th style="width: 80px;">延迟</th>
            <th style="width: 150px;">Quota</th>
            <th style="width: 220px;">操作</th>
          </tr></thead>
          <tbody id="provider-table-body">${ctx.providerRows || '<tr><td colspan="8" class="muted">没有配置任何 Provider</td></tr>'}</tbody>
        </table>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title">
        <h3>Provider 模板覆盖审计（Dry-Run）</h3>
        <span class="muted">0.3.21</span>
      </div>
      <p class="muted">只读检查模板目录与上游公开目标的覆盖情况；不写 <code>config.json</code>，不保存 Key，不访问网络。</p>
      <div class="row-actions" style="margin-top:8px;">
        <button type="button" id="provider-template-parity-check" class="small" style="margin-right:8px;" data-provider-template-parity-endpoint="/admin/provider-template-parity">检查模板覆盖</button>
        <button type="button" id="provider-template-parity-refresh" class="small" style="margin-right:8px;" data-provider-template-parity-endpoint="/admin/provider-template-parity">刷新覆盖审计</button>
        <button type="button" id="provider-template-import-plan" class="small" style="margin-right:8px;" data-provider-template-import-plan-endpoint="/admin/provider-template-import-plan">生成导入计划</button>
        <button type="button" id="provider-template-import-apply" class="small danger" data-provider-template-import-endpoint="/admin/provider-template-import">确认导入缺失模板</button>
      </div>
      <div id="provider-template-parity-output" class="panel" style="background:var(--soft);padding:12px;margin-top:8px;">
        <div class="muted">尚未检查。点击后会列出模板总数、直连 API 模板、本地端点模板、需要用户替换 Base URL 的模板，以及公开信息仍不足的 provider。</div>
      </div>
      <div id="provider-template-import-output" class="panel" style="background:var(--soft);padding:12px;margin-top:8px;">
        <div class="muted">尚未生成导入计划。导入只会添加缺失且可直接配置的 Provider 模板；不会保存 API Key，不会调用上游 API，不会导入带占位符的 Base URL。</div>
      </div>
    </div>
    <details class="collapsible" id="provider-form-card">
      <summary>新增 / 编辑 Provider</summary>
      <p class="muted" style="margin-top: 8px;">真实 API Key 不在这里保存，<strong>仍在下面"给当前 Provider 添加真实 API Key"或 .env 里</strong>。Base URL 默认仅允许 <code>https://</code> 或本地 loopback <code>http://</code>；远程 <code>http://</code> 必须显式勾选 <code>allowInsecureHttp</code>。</p>
      <div class="notice ok" id="provider-form-key-status" data-provider-form-key-status style="margin-top: 8px;">
        <strong>关于 Web Key：</strong>真实 API Key <strong>独立</strong>加密存到 <code>data/keys.enc.json</code>，与 <code>config.json</code> 完全分离。点"保存编辑" / "新增 Provider" <strong>不会</strong>清掉已有 Web Key，<strong>也不会</strong>覆盖它们；旧的 Web Key 继续参与 Key 池轮换。要管理 / 删除 Web Key，请用下方"已添加的 Web Key"表（"停用 / 启用 / 删除"按钮独立操作）。
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="provider-template">使用模板</label>
          <select id="provider-template"><option value="">选择模板填充表单</option>${ctx.providerTemplateOptions}</select>
        </div>
        <div class="field">
          <label for="provider-name">Provider 名称</label>
          <input id="provider-name" type="text" placeholder="例如 deepseek、ollama">
        </div>
        <div class="field">
          <label for="provider-display-name">显示名称</label>
          <input id="provider-display-name" type="text" placeholder="例如 DeepSeek">
        </div>
        <div class="field">
          <label for="provider-base-url">Base URL</label>
          <input id="provider-base-url" type="text" placeholder="https://api.example.com/v1">
        </div>
        <div class="field">
          <label for="provider-api-format">接口格式</label>
          <select id="provider-api-format">
            <option value="openai">openai</option>
            <option value="anthropic">anthropic</option>
          </select>
        </div>
        <div class="field">
          <label><input id="provider-allow-insecure-http" type="checkbox"> allowInsecureHttp（默认关闭）</label>
          <div class="help">只对可信内网自建 vLLM 等场景启用；远程 http:// 会明文传输 API Key。</div>
        </div>
      </div>
      <details class="advanced-block">
        <summary>高级：.env Key 环境变量名</summary>
        <div class="field">
          <label for="provider-key-env">Key 环境变量名（不是 API Key）</label>
          <input id="provider-key-env" type="text" placeholder="例如 DEEPSEEK_API_KEYS；真实 Key 请用下面的 Web Key 表单添加">
          <div class="muted">这里只填环境变量名，例如 <code>DEEPSEEK_API_KEYS</code>。本地 loopback provider 不需要 keyEnv。</div>
        </div>
      </details>
      <div class="form-grid-2">
        <div class="field">
          <label for="provider-models">模型（一行一个或逗号分隔）</label>
          <textarea id="provider-models" class="compact-area" spellcheck="false"></textarea>
        </div>
        <div class="field">
          <label for="provider-extra-headers">额外安全 Header（JSON，可选）</label>
          <textarea id="provider-extra-headers" class="compact-area" spellcheck="false" placeholder='{"x-custom-client":"relayforge"}'></textarea>
        </div>
        <div class="field">
          <label for="provider-balance-endpoint">余额 Endpoint（JSON，可选）</label>
          <textarea id="provider-balance-endpoint" class="compact-area" spellcheck="false" placeholder='{"url":"https://api.example.com/balance","method":"GET","useKey":true}'></textarea>
        </div>
      </div>
      <div class="row-actions" style="margin-top: 12px;">
        <button id="provider-create" type="button" class="primary">新增 Provider</button>
        <button id="provider-update" type="button">保存编辑</button>
        <button id="provider-clear" type="button">清空表单</button>
      </div>
      <div id="provider-message" class="notice" style="margin-top: 12px;">可以从模板开始，或点击上方 Provider 行里的"编辑"。</div>
      <details class="advanced-block" id="discover-models-card" style="margin-top: 12px;">
        <summary>发现可用模型（用 Base URL + Key，或直接用已配置 Provider 的 Key）</summary>
        <p class="muted" style="margin-top: 8px;">两种方式都可以调 <code>/models</code> 拿到上游模型列表，然后在下方复选框里勾选要保留的：</p>
        <ol class="muted" style="margin-top: 4px; padding-left: 20px;">
          <li><strong>方式 A：任意 OpenAI 兼容 Base URL + 临时 Key</strong> —— 不会保存 Key，<strong>不会</strong>写入 config.json / 日志 / 持久化文件，<strong>不会</strong>回显在响应里。Base URL 必须 <code>https://</code> 或本地 loopback <code>http://</code>。</li>
          <li><strong>方式 B：已配置的 Provider</strong> —— 自动用该 Provider 已保存的 Key（Web Key 优先，其次 .env keyEnv）。<strong>不会</strong>影响其他 Web Key。</li>
        </ol>
        <div class="form-grid-2">
          <div class="field">
            <label>方式 A：Base URL + Key</label>
            <input id="discover-base-url" type="text" placeholder="https://api.example.com/v1" autocomplete="off">
            <input id="discover-api-key" type="password" autocomplete="off" placeholder="sk-...（本地 Ollama / LM Studio 留空）" data-discover-api-key style="margin-top:6px;">
            <div class="row-actions" style="margin-top: 6px;">
              <button id="discover-models-button" type="button" data-discover-models-button>发现（A 模式）</button>
              <button id="discover-models-prefill" type="button" data-discover-models-prefill>用上方 Base URL 预填</button>
            </div>
          </div>
          <div class="field">
            <label>方式 B：从已配置 Provider 拉取（用其已保存的 Key）</label>
            <select id="discover-models-provider-select" data-discover-models-provider-select>${(ctx.status.providers || [])
              .filter(function (p) { return p.apiFormat === "openai"; })
              .map(function (p) {
                const webCount = (ctx.status.webKeys || []).filter(function (k) { return k.provider === p.name && k.enabled; }).length;
                const tag = webCount > 0 ? " · " + webCount + " 个 Web Key" : (p.keyCount > 0 ? " · " + p.keyCount + " 个 env Key" : " · 无 Key");
                return '<option value="' + escapeHtml(p.name) + '">' + escapeHtml(p.name) + escapeHtml(tag) + '</option>';
              })
              .join("")}</select>
            <div class="row-actions" style="margin-top: 6px;">
              <button id="discover-models-from-provider" type="button" data-discover-models-from-provider>发现（B 模式）</button>
            </div>
          </div>
        </div>
        <div id="discover-models-output" data-discover-models-output style="margin-top: 12px;">
          <div class="muted">尚未发现。选择 A 模式（填 Base URL + Key）或 B 模式（选 Provider），返回的模型 ID 会以<strong>复选框</strong>形式出现在这里；用"全选/全不选/反选"挑好后点"替换为选中"或"合并到上方"模型"框"。<strong>不会</strong>自动保存，需点"保存编辑"才落盘。</div>
        </div>
      </details>
      <div class="inline-key-panel">
        <h3>给当前 Provider 添加真实 API Key</h3>
        <p class="muted">Key 只会加密保存到本机 <code>data/keys.enc.json</code>，不会写入 <code>config.json</code>、导出配置或发布包。</p>
        <div class="field-row">
          <div class="field">
            <label for="provider-inline-key-name">Provider</label>
            <select id="provider-inline-key-name">${ctx.providerOptions}</select>
          </div>
          <div class="field">
            <label for="provider-inline-key-value">API Key</label>
            <input id="provider-inline-key-value" type="password" autocomplete="off" placeholder="粘贴你的真实 API Key">
          </div>
          <div class="field">
            <label for="provider-inline-key-label">备注（可选）</label>
            <input id="provider-inline-key-label" type="text" maxlength="80" placeholder="例如：主 key、备用 key">
          </div>
        </div>
        <div class="row-actions" style="margin-top: 10px;">
          <button id="provider-inline-key-add" type="button" class="primary">加密保存 Key</button>
          <button id="provider-inline-key-test" type="button">保存并测试</button>
        </div>
        <div id="provider-inline-key-message" class="notice">Key 只会加密保存到本机，不会在页面显示明文。</div>
      </div>
    </details>
    <div class="panel">
      <div class="panel-title"><h3>已添加的 Web Key</h3>
        <span class="muted">${ctx.status.webKeys ? ctx.status.webKeys.length : 0} 条</span>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th>ID</th><th>服务方</th><th>掩码</th><th>备注</th><th>状态</th><th>使用 / 测试</th><th>操作</th></tr></thead>
          <tbody>${ctx.status.webKeys && ctx.status.webKeys.length > 0
            ? ctx.status.webKeys.map((key) => `<tr data-key-row="${escapeHtml(key.id)}">
                <td><code>${escapeHtml(key.id)}</code></td>
                <td>${escapeHtml(key.provider)}</td>
                <td><code>${escapeHtml(key.masked)}</code><div class="muted mono">hash: ${escapeHtml(key.hash || "")}</div></td>
                <td>${escapeHtml(key.label || "—")}</td>
                <td>${key.enabled ? '<span class="pill ok">启用</span>' : '<span class="pill warn">停用</span>'}</td>
                <td><div class="muted">${escapeHtml(formatTimestamp(key.lastUsedAt) || "—")}</div>${key.lastTestAt ? `<div class="muted">最近测试：${escapeHtml(formatTimestamp(key.lastTestAt))}${key.lastTestResult?.ok === true ? ' <span class="ok">通过</span>' : key.lastTestResult?.ok === false ? ' <span class="bad">失败</span>' : ""}</div>` : ""}</td>
                <td>
                  <div class="row-actions">
                    <button type="button" class="small" data-test-key="${escapeHtml(key.id)}">测试</button>
                    <button type="button" class="small" data-toggle-key="${escapeHtml(key.id)}" data-target-enabled="${key.enabled ? "false" : "true"}">${key.enabled ? "停用" : "启用"}</button>
                    <button type="button" class="small danger" data-delete-key="${escapeHtml(key.id)}" data-label="${escapeHtml(key.label || key.masked)}">删除</button>
                  </div>
                </td>
              </tr>`).join("")
            : '<tr><td colspan="7" class="muted">还没有通过 Web 添加的 Key。可以从 .env 走，也可以点击表格行"加 Key"。</td></tr>'}</tbody>
        </table>
      </div>
      <details class="collapsible" style="margin-top: 10px;">
        <summary>从 API Key 表单添加新 Key</summary>
        <p class="muted" style="margin-top: 8px;">${ctx.status.secretStore?.masterKeyInEnv ? "主密钥来源：<code>OPENRELAY_KEYSTORE_SECRET</code> 环境变量" : ctx.status.secretStore?.masterKeyOnDisk ? "主密钥来源：<code>data/master.key</code> 本地文件" : "主密钥尚未生成，首次添加 Key 时自动创建"}</p>
        <div class="field-row">
          <div class="field">
            <label for="add-key-provider">服务提供方</label>
            <select id="add-key-provider">${ctx.providerOptions}</select>
          </div>
          <div class="field">
            <label for="add-key-value">API Key</label>
            <input id="add-key-value" type="password" autocomplete="off" placeholder="sk-...">
          </div>
          <div class="field">
            <label for="add-key-label">备注（可选）</label>
            <input id="add-key-label" type="text" maxlength="80" placeholder="例如：主 key、备用 key">
          </div>
        </div>
        <div class="row-actions" style="margin-top: 10px;">
          <button id="add-key-submit" type="button" class="primary">添加 Key</button>
        </div>
        <div id="add-key-message" class="notice" style="margin-top: 12px;">尚未添加 Web Key。</div>
      </details>
    </div>
  `;
}
