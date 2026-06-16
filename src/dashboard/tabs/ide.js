import { escapeHtml } from "../../http-helpers.js";

export function renderIdeTab(status, port) {
  const base = `http://127.0.0.1:${port}`;
  const proxies = [
    {
      id: "cursor",
      name: "Cursor",
      method: "RPC proxy (ConnectRPC, HTTP/2)",
      listenPort: port + 1,
      dryRunInfo: [
        `IDE: Cursor`,
        `Protocol: ConnectRPC over HTTP/2`,
        `Dry-run listen: ${base.replace(/:(\d+)$/, ":" + (port + 1))}`,
        `Status: dry-run only — no actual proxy running`,
        `Provider: ${(status.providers && status.providers[0] && status.providers[0].displayName) || "—"}`,
        `Relay URL: ${base}/v1`
      ].join("\n")
    },
    {
      id: "windsurf",
      name: "Windsurf",
      method: "RPC proxy (ConnectRPC)",
      listenPort: port + 2,
      dryRunInfo: [
        `IDE: Windsurf`,
        `Protocol: ConnectRPC`,
        `Dry-run listen: ${base.replace(/:(\d+)$/, ":" + (port + 2))}`,
        `Status: dry-run only — no actual proxy running`,
        `Provider: ${(status.providers && status.providers[0] && status.providers[0].displayName) || "—"}`,
        `Relay URL: ${base}/v1`
      ].join("\n")
    },
    {
      id: "vscode-copilot",
      name: "VS Code Copilot",
      method: "Ollama BYOK bridge",
      listenPort: port + 3,
      dryRunInfo: [
        `IDE: VS Code Copilot`,
        `Protocol: Ollama BYOK bridge (OpenAI-compatible)`,
        `Dry-run listen: ${base.replace(/:(\d+)$/, ":" + (port + 3))}`,
        `Status: dry-run only — no actual proxy running`,
        `Provider: ${(status.providers && status.providers[0] && status.providers[0].displayName) || "—"}`,
        `Relay URL: ${base}/v1`
      ].join("\n")
    },
    {
      id: "antigravity",
      name: "Antigravity",
      method: "Gemini REST proxy",
      listenPort: port + 4,
      dryRunInfo: [
        `IDE: Antigravity`,
        `Protocol: Gemini REST proxy`,
        `Dry-run listen: ${base.replace(/:(\d+)$/, ":" + (port + 4))}`,
        `Status: dry-run only — no actual proxy running`,
        `Provider: ${(status.providers && status.providers[0] && status.providers[0].displayName) || "—"}`,
        `Relay URL: ${base}/v1`
      ].join("\n")
    }
  ];

  const proxyCards = proxies.map((proxy) => {
    const models = (status.providers || []).map((p) =>
      `<option value="${escapeHtml(p.name)}:${escapeHtml(p.models[0] || "auto")}">${escapeHtml(p.displayName || p.name)}: ${escapeHtml(p.models[0] || "auto")}</option>`
    ).join("");
    return `<div class="panel" data-ide-proxy="${escapeHtml(proxy.id)}">
      <div class="panel-title">
        <h3>${escapeHtml(proxy.name)}</h3>
        <span class="pill muted-pill">dry-run only</span>
      </div>
      <p class="muted">${escapeHtml(proxy.method)}</p>
      <div class="form-grid-2">
        <div class="field">
          <label for="ide-model-${escapeHtml(proxy.id)}">使用 Provider / Route</label>
          <select id="ide-model-${escapeHtml(proxy.id)}" data-ide-model="${escapeHtml(proxy.id)}">
            <option value="">使用当前默认</option>
            ${models}
          </select>
        </div>
        <div class="field">
          <label>监听地址</label>
          <code>${base.replace(/:(\d+)$/, ":" + proxy.listenPort)}</code>
          <span class="muted">relay 端口 + ${proxy.listenPort - port}</span>
        </div>
      </div>
      <div class="row-actions" style="margin-top: 12px;">
        <button type="button" class="primary" data-ide-start="${escapeHtml(proxy.id)}" disabled>启动代理 (disabled)</button>
        <button type="button" data-ide-stop="${escapeHtml(proxy.id)}" disabled>停止 (disabled)</button>
        <button type="button" data-ide-dry-run="${escapeHtml(proxy.id)}">查看 dry-run 信息</button>
      </div>
      <div class="row-actions" style="margin-top:6px;">
        <span class="muted" style="font-size:11px;" id="ide-proxy-status-${escapeHtml(proxy.id)}">Status: <strong>stopped</strong> · Phase: <strong>preview-only</strong></span>
      </div>
      <div class="row-actions" style="margin-top:4px;">
        <span class="muted" style="font-size:11px;" id="ide-proxy-port-${escapeHtml(proxy.id)}">Port: planned · Check not run</span>
      </div>
      <div class="command-box" style="display:none;" data-ide-dry-run-output="${escapeHtml(proxy.id)}">
        <div class="head"><strong>Dry-run 信息</strong></div>
        <pre id="ide-dry-run-${escapeHtml(proxy.id)}">${escapeHtml(proxy.dryRunInfo)}</pre>
      </div>
      <div class="command-box" style="display:none;" data-ide-preview-output="${escapeHtml(proxy.id)}">
        <div class="head"><strong>API 预览信息</strong></div>
        <pre id="ide-preview-${escapeHtml(proxy.id)}">—</pre>
      </div>
    </div>`;
  }).join("\n");

  const capabilityRows = [
    { ide: "Cursor", method: "ConnectRPC, HTTP/2", status: "Dry-run only", boundary: "不读取 Cursor token/cookie/session" },
    { ide: "Windsurf", method: "ConnectRPC", status: "Dry-run only", boundary: "不读取 Windsurf 本地凭据" },
    { ide: "VS Code Copilot", method: "Ollama BYOK bridge", status: "Dry-run only", boundary: "不读取 GitHub Copilot 会话" },
    { ide: "Antigravity", method: "Gemini REST proxy", status: "Dry-run only", boundary: "不读取 Antigravity 配置" }
  ].map((row) => `<tr>
    <td><code>${escapeHtml(row.ide)}</code></td>
    <td>${escapeHtml(row.method)}</td>
    <td><span class="pill muted-pill">${escapeHtml(row.status)}</span></td>
    <td>${escapeHtml(row.boundary)}</td>
  </tr>`).join("");

  const modelOptions = (status.providers || []).map((p) =>
    `<option value="${escapeHtml(p.name)}:${escapeHtml(p.models[0] || "auto")}">${escapeHtml(p.displayName || p.name)}: ${escapeHtml(p.models[0] || "auto")}</option>`
  ).join("");

  return `
    <h2>IDE 代理</h2>
    <div class="panel warn" style="border-color: var(--warn-soft); background: var(--warn-soft);">
      <strong>安全边界 (Safety Boundary)</strong>
      <ul style="margin: 4px 0 0 16px;">
        <li>当前仅 <strong>dry-run</strong> 模式：只展示 IDE 代理的连接信息，不启动真实代理监听。</li>
        <li>不读取 IDE 的 token、cookie、session 或本地凭据。</li>
        <li>不修改任何 IDE 的配置文件。</li>
        <li>不启动代理端口监听。</li>
        <li>后续实现真实代理前必须通过单独安全评审。</li>
      </ul>
    </div>
    <div class="toolbar">
      <select id="ide-preview-model" style="width:auto;min-width:200px;">
        <option value="">使用当前默认</option>
        ${modelOptions}
      </select>
      <button type="button" class="primary" id="ide-preview-refresh">Refresh preview</button>
      <button type="button" id="ide-status-refresh">Refresh status</button>
      <button type="button" id="ide-port-check">Check ports</button>
      <button type="button" id="ide-start-plan">Build start plan</button>
      <span id="ide-preview-status" class="muted" style="font-size:12px;"></span>
      <span id="ide-status-display" class="muted" style="font-size:12px;margin-left:8px;"></span>
      <span id="ide-port-check-display" class="muted" style="font-size:12px;margin-left:8px;"></span>
      <span id="ide-start-plan-display" class="muted" style="font-size:12px;margin-left:8px;"></span>
    </div>
    <div class="panel" id="ide-status-summary" style="display:none;">
      <div class="panel-title">
        <h3>Runtime Status</h3>
        <span class="pill muted-pill" id="ide-mode-pill">dry-run</span>
      </div>
      <p class="muted" id="ide-status-text">Summary: <span id="ide-summary-total">4</span> total · <span id="ide-summary-running">0</span> running · <span id="ide-summary-stopped">4</span> stopped · dry-run only</p>
      <div class="stack" style="margin-top:6px;">
        <span class="pill" id="ide-status-version" style="font-size:11px;"></span>
      </div>
    </div>
    <div class="panel" id="ide-port-check-summary" style="display:none;">
      <div class="panel-title">
        <h3>Port Readiness</h3>
        <span class="pill muted-pill" id="ide-port-mode-pill">dry-run</span>
      </div>
      <p class="muted" id="ide-port-check-text">Summary: <span id="ide-port-total">4</span> total · <span id="ide-port-available">0</span> available · <span id="ide-port-occupied">0</span> occupied · <span id="ide-port-unknown">0</span> unknown</p>
      <div class="stack" style="margin-top:6px;">
        <span class="pill" id="ide-port-version" style="font-size:11px;"></span>
      </div>
    </div>
    <div class="panel" id="ide-start-plan-summary" style="display:none;">
      <div class="panel-title">
        <h3>Start Plan</h3>
        <span class="pill muted-pill" id="ide-start-plan-mode">dry-run</span>
      </div>
      <p class="muted" id="ide-start-plan-text">Summary: <span id="ide-plan-total">4</span> total · <span id="ide-plan-ready">0</span> ready · <span id="ide-plan-blocked">0</span> blocked · <span id="ide-plan-review">0</span> needs review</p>
      <div class="command-box" style="margin-top:6px;">
        <div class="head"><strong>Dry-run start plan</strong></div>
        <pre id="ide-start-plan-output">Click Build start plan to generate a dry-run plan. No listener will be started.</pre>
      </div>
    </div>
    ${proxyCards}
    <div class="panel">
      <div class="panel-title">
        <h3>IDE Capability Matrix (功能矩阵)</h3>
        <span class="muted">dry-run only — 安全边界一览</span>
      </div>
      <div class="scroll-x">
        <table id="ide-capability-matrix">
          <thead><tr>
            <th>IDE</th>
            <th>上游方法</th>
            <th>本地状态</th>
            <th>安全边界</th>
          </tr></thead>
          <tbody>${capabilityRows}</tbody>
        </table>
      </div>
    </div>
    <script>
    (function () {
      var buttons = document.querySelectorAll("[data-ide-dry-run]");
      for (var i = 0; i < buttons.length; i++) {
        buttons[i].addEventListener("click", function () {
          var id = this.getAttribute("data-ide-dry-run");
          var output = document.querySelector("[data-ide-dry-run-output=\"" + id + "\"]");
          if (output) {
            var isHidden = output.style.display === "none" || output.style.display === "";
            output.style.display = isHidden ? "block" : "none";
          }
        });
      }
    })();
    </script>
    <script>
    (function () {
      var btn = document.getElementById("ide-status-refresh");
      if (!btn) return;
      btn.addEventListener("click", function () {
        var modelSelect = document.getElementById("ide-preview-model");
        var model = modelSelect ? modelSelect.value : "";
        var query = model ? "?model=" + encodeURIComponent(model) : "";
        var display = document.getElementById("ide-status-display");
        if (display) { display.textContent = "获取中…"; display.className = "muted"; }
        var xhr = new XMLHttpRequest();
        xhr.open("GET", "/admin/ide-proxy-status" + query, true);
        xhr.onload = function () {
          if (xhr.status !== 200) {
            if (display) { display.textContent = "获取状态失败 (" + xhr.status + ")"; display.className = "notice bad"; }
            return;
          }
          var data;
          try { data = JSON.parse(xhr.responseText); } catch (_) { return; }
          if (!data.ok) {
            if (display) { display.textContent = data.error || "获取状态失败"; display.className = "notice bad"; }
            return;
          }
          var summary = data.summary || {};
          var totalEl = document.getElementById("ide-summary-total");
          var runningEl = document.getElementById("ide-summary-running");
          var stoppedEl = document.getElementById("ide-summary-stopped");
          var modePill = document.getElementById("ide-mode-pill");
          var verEl = document.getElementById("ide-status-version");
          var summaryPanel = document.getElementById("ide-status-summary");
          if (totalEl) totalEl.textContent = String(summary.total || 0);
          if (runningEl) runningEl.textContent = String(summary.running || 0);
          if (stoppedEl) stoppedEl.textContent = String(summary.stopped || 0);
          if (modePill) modePill.textContent = data.mode || "dry-run";
          if (verEl) verEl.textContent = "version: " + (data.version || "—");
          if (summaryPanel) summaryPanel.style.display = "block";
          // Update per-proxy status
          (data.proxies || []).forEach(function (proxy) {
            var statusEl = document.getElementById("ide-proxy-status-" + proxy.id);
            if (statusEl) {
              statusEl.innerHTML = "Status: <strong>" + proxy.status + "</strong> · Phase: <strong>" + proxy.phase + "</strong>";
            }
          });
          if (display) { display.textContent = "状态已更新 (" + data.mode + ", v" + (data.version || "—") + ")"; display.className = "notice ok"; }
        };
        xhr.onerror = function () {
          if (display) { display.textContent = "网络请求失败"; display.className = "notice bad"; }
        };
        xhr.send();
      });
    })();
    </script>
  `;
}
