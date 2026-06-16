// Tools tab: tool config generator (top), 8 static tool cards
// (recommendations), and the unified verify-script block. The
// generator is read-only — it never writes env vars / registry /
// shell profile. The 7 static cards serve as the "recommended
// defaults" reference per tool.
//
// 0.5.4: the env-var export HTML is rendered with the MASKED
// token (apiKeyMasked / apiKeyHint). An inline <script> then
// fetches /admin/auth/token with the sessionStorage admin
// token and patches the visible <pre> blocks + the verify
// command with the live value. If the fetch fails (no auth
// mode, no sessionStorage token, or wrong token), the masked
// values remain in place and the operator is told to read
// data/security/relay-token manually.

import { escapeHtml } from "../../http-helpers.js";
import { buildToolVerifyCommand, renderCommand } from "../shared.js";

export function renderToolCards(status, port) {
  const base = `http://127.0.0.1:${port}/v1`;
  const auth = status.relayAuth || {};
  // 0.5.4: visible env-var blocks and the verify command are
  // rendered with the masked value by default. The inline
  // script below patches them with the live token if the
  // admin token is in sessionStorage and /admin/auth/token
  // accepts it.
  const visibleApiKey = auth.allowNoAuth
    ? "local"
    : (auth.apiKeyMasked || auth.apiKeyHint || "（请填本地 Token）");
  const initialApiKey = visibleApiKey;
  const tokenNote = auth.allowNoAuth
    ? "无鉴权模式：API Key 可填 local 或留空。"
    : auth.tokenRequired
      ? "RELAY_TOKEN 已启用：API Key 填本机自动生成 / .env 配置的 Token 值。"
      : "RELAY_TOKEN 未设置：API Key 可填 local。";
  const tools = [
    { id: "opencode", name: "OpenCode", vars: [["OPENCODE_BASE_URL", base], ["OPENCODE_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto", verify: "opencode --version → 发一条对话" },
    { id: "codex", name: "Codex (OpenAI Codex CLI)", vars: [["CODEX_BASE_URL", base], ["CODEX_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto / coding", verify: "codex --version → codex chat" },
    { id: "openclaw", name: "OpenClaw", vars: [["OPENCLAW_BASE_URL", base], ["OPENCLAW_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto / coding", verify: "openclaw --help → 发一次对话" },
    { id: "aider", name: "Aider", vars: [["AIDER_OPENAI_API_BASE", base], ["AIDER_OPENAI_API_KEY", initialApiKey], ["OPENAI_API_BASE", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto", verify: "aider --version → aider --model auto" },
    { id: "goose", name: "Goose", vars: [["GOOSE_OPENAI_BASE_URL", base], ["GOOSE_OPENAI_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto", verify: "goose configure → OpenAI-compatible → ping" },
    { id: "continue", name: "Continue (VSCode / JetBrains)", vars: [["CONTINUE_OPENAI_BASE_URL", base], ["CONTINUE_OPENAI_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto", verify: "VSCode: Continue: Run" },
    { id: "claude", name: "Claude Code", vars: [["ANTHROPIC_BASE_URL", base], ["ANTHROPIC_API_KEY", initialApiKey]], defaultModel: "auto", verify: "claude --version → claude 'say pong'" },
    { id: "amp", name: "Amp", vars: [["AMP_BASE_URL", base], ["AMP_API_KEY", initialApiKey], ["OPENAI_BASE_URL", base], ["OPENAI_API_KEY", initialApiKey]], defaultModel: "auto", verify: "amp --version → amp chat" }
  ];
  // OpenCode is the default selected tool; the generator pre-fills its commands
  const toolById = Object.fromEntries(tools.map((tool) => [tool.id, tool]));
  const defaultModel = (status.profiles && status.profiles.defaultModel) || "auto";
  const routeOptions = (status.routes || []).map((route) =>
    `<option value="${escapeHtml(route.name)}">${escapeHtml(route.name)} · ${escapeHtml(route.strategy || "fallback")}</option>`
  ).join("");
  const verifyNote = `生成器只输出当前 shell 进程级命令，<strong>不会</strong>写入系统环境变量、Windows 注册表或 <code>~/.bashrc</code> / <code>~/.zshrc</code>，<strong>不会</strong>把 token 放 URL，<strong>不会</strong>写日志。`;
  // Pre-render the verify command with the masked key. The
  // inline script below patches it with the live value when
  // /admin/auth/token responds.
  const verifyCommand = buildToolVerifyCommand(defaultModel, base, initialApiKey);
  return `
    <h2>工具接入</h2>
    <p class="muted">${escapeHtml(tokenNote)} · 本地 relay 不主动限制调用次数（上游限制仍然存在）。</p>
    <div class="panel" id="tool-generator-panel">
      <div class="panel-title"><h3>工具配置生成器</h3>
        <span class="muted">只读 · 不调用上游 · 不写配置</span>
      </div>
      <div class="tool-toggle-strip" style="margin-bottom:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <label style="font-weight:600;font-size:13px;margin-right:4px;">快速切换：</label>
        ${tools.map((tool) => `
          <button type="button" class="tool-toggle-btn${tool.id === 'opencode' ? ' active' : ''}"
            data-tool-toggle="${escapeHtml(tool.id)}"
            data-tool-toggle-name="${escapeHtml(tool.name)}"
            style="padding:4px 12px;border:1px solid var(--line);border-radius:16px;background:${tool.id === 'opencode' ? 'var(--primary,#2563eb)' : '#fff'};color:${tool.id === 'opencode' ? '#fff' : 'inherit'};cursor:pointer;font-size:12px;font-weight:500;transition:all .15s;">${escapeHtml(tool.name)}</button>
        `).join("")}
      </div>
      <p class="muted" style="font-size:11px;margin-top:0;margin-bottom:10px;">Toggle 只标记当前页面的选中工具，<strong>不会</strong>修改系统环境变量、Windows 注册表或 <code>~/.bashrc</code> / <code>~/.zshrc</code>，<strong>不会</strong>写入 shell profile。点击"复制"按钮才会把命令写入剪贴板。</p>
      <p class="muted">选工具 + 选模型组（或 Route），下方会自动生成 PowerShell / CMD / Bash 三种当前会话命令，外加统一验证命令。${verifyNote}</p>
      <div class="form-grid-2">
        <div class="field">
          <label for="tool-generator-tool">工具</label>
          <select id="tool-generator-tool" data-tool-generator-tool>
            ${tools.map((tool) => `<option value="${escapeHtml(tool.id)}">${escapeHtml(tool.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="tool-generator-model">模型组 / Route</label>
          <select id="tool-generator-model" data-tool-generator-model>
            <option value="">使用当前 Profile 默认（${escapeHtml(defaultModel)}）</option>
            <option value="auto">auto（不指定模型）</option>
            ${routeOptions}
          </select>
        </div>
      </div>
      <div class="endpoint-block" style="margin-top: 12px;">
        <span class="muted">Base URL：</span><code data-tool-generator-base-url>${escapeHtml(base)}</code>
        <span class="muted" style="margin-left: 12px;">API Key 提示：</span><code data-tool-generator-api-hint>${escapeHtml(visibleApiKey)}</code>
        <span class="muted" style="margin-left: 12px;">推荐 model：</span><code data-tool-generator-recommended>${escapeHtml(defaultModel)}</code>
      </div>
      <div class="command-box" style="margin-top: 12px;">
        <div class="head"><strong>Windows PowerShell</strong><button type="button" class="small" data-copy-target="tool-generator-ps">复制</button></div>
        <pre id="tool-generator-ps" data-tool-generator-ps>${escapeHtml(tools[0].vars.map(([k, v]) => `$env:${k}="${v}"`).join("\n"))}</pre>
      </div>
      <div class="command-box">
        <div class="head"><strong>Windows CMD</strong><button type="button" class="small" data-copy-target="tool-generator-cmd">复制</button></div>
        <pre id="tool-generator-cmd" data-tool-generator-cmd>${escapeHtml(tools[0].vars.map(([k, v]) => `set ${k}=${v}`).join("\r\n"))}</pre>
      </div>
      <div class="command-box">
        <div class="head"><strong>WSL / Linux Bash</strong><button type="button" class="small" data-copy-target="tool-generator-bash">复制</button></div>
        <pre id="tool-generator-bash" data-tool-generator-bash>${escapeHtml(tools[0].vars.map(([k, v]) => `export ${k}="${v}"`).join("\n"))}</pre>
      </div>
      <div class="command-box">
        <div class="head"><strong>复制验证命令</strong>
          <button type="button" class="small primary" data-copy-target="tool-generator-verify">复制</button>
        </div>
        <pre id="tool-generator-verify" data-tool-generator-verify>${escapeHtml(verifyCommand)}</pre>
      </div>
      <p class="muted" style="margin-top: 8px;">生成的命令只会修改当前 shell 进程的环境变量（<code>$env:</code> / <code>set</code> / <code>export</code>），<strong>不</strong>会写入系统环境变量、注册表、shell profile；复制按钮只把字符串写进剪贴板，不会写日志。</p>
      <p class="muted" data-tool-generator-token-status style="margin-top: 4px; font-size: 12px;">${auth.allowNoAuth ? "无鉴权模式：API Key 可填 local。" : auth.tokenRequired ? "正从 /admin/auth/token 拉取完整 Token…（失败时会回退到掩码）" : "RELAY_TOKEN 未设置：API Key 可填 local。"}</p>
      <script type="application/json" id="tool-generator-data">${JSON.stringify({
        base,
        apiKey: initialApiKey,
        apiKeyHint: visibleApiKey,
        defaultModel,
        toolById
      })}</script>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>8 个工具的推荐默认配置</h3>
        <span class="muted">直接查看每个工具的 Base URL / Key 别名 / 验证方式</span>
      </div>
      <div class="tool-grid">${tools.map((tool) => {
        const ps = tool.vars.map(([key, value]) => `$env:${key}="${value}"`).join("\n");
        const cmd = tool.vars.map(([key, value]) => `set ${key}=${value}`).join("\r\n");
        const bash = tool.vars.map(([key, value]) => `export ${key}="${value}"`).join("\n");
        const meta = [];
        if (tool.defaultModel) meta.push(`推荐 model：${tool.defaultModel}`);
        if (tool.verify) meta.push(`验证：${tool.verify}`);
        const metaHtml = meta.length > 0 ? `<div class="muted" style="margin-top:4px;font-size:12px;">${escapeHtml(meta.join(" · "))}</div>` : "";
        return `<div class="tool-card" data-tool-card-id="${escapeHtml(tool.id)}">
          <h3>${escapeHtml(tool.name)}</h3>
          <div class="muted" style="font-size:12px;">Base URL：<code>${escapeHtml(base)}</code></div>
          <div class="muted" style="font-size:12px;">API Key 提示：<code>${escapeHtml(visibleApiKey)}</code></div>
          ${metaHtml}
          ${renderCommand("Windows PowerShell", ps)}
          ${renderCommand("Windows CMD", cmd)}
          ${renderCommand("WSL / Linux Bash", bash)}
        </div>`;
      }).join("")}</div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>统一验证脚本</h3></div>
      <p class="muted">先 <code>powershell -ExecutionPolicy Bypass -File scripts\write-tool-env.ps1</code> 生成 <code>tool-env.*</code> 和 <code>tool-verify.*</code>，再 <code>.\\tool-env.ps1</code>，最后 <code>.\\tool-verify.ps1</code>。脚本会 GET /v1/models + POST /v1/chat/completions (model=auto)，两个都返回 200 即视为 7 个工具的环境变量别名都打通了。</p>
      <div class="command-box">
        <div class="head"><strong>PowerShell 验证</strong><button class="small" data-copy=".\\tool-env.ps1\n.\\tool-verify.ps1">复制</button></div>
        <pre>.\\tool-env.ps1
.\\tool-verify.ps1</pre>
      </div>
      <div class="command-box">
        <div class="head"><strong>Bash / WSL 验证</strong><button class="small" data-copy="source ./tool-env.sh\nbash ./tool-verify.sh">复制</button></div>
        <pre>source ./tool-env.sh
bash ./tool-verify.sh</pre>
      </div>
    </div>
    <script>
      // 0.5.4: lazy-fetch the full RELAY_TOKEN from /admin/auth/token
      // (using the admin token the operator previously pasted into
      // the token prompt page, kept in sessionStorage). If the
      // fetch succeeds, patch the visible env-var <pre> blocks
      // + the verify command + the per-tool cards with the live
      // value. If it fails, leave the masked value in place.
      (function () {
        const status = document.querySelector("[data-tool-generator-token-status]");
        if (!status) return;
        if (relayAuth && relayAuth.allowNoAuth) {
          status.textContent = "无鉴权模式：API Key 可填 local 或留空。";
          return;
        }
        if (relayAuth && relayAuth.tokenSource === "check-readonly") {
          status.textContent = "check 模式：未生成 Token。";
          return;
        }
        const adminToken = sessionStorage.getItem("relayforge.adminToken") || sessionStorage.getItem("openrelay.adminToken") || "";
        if (!adminToken) {
          status.innerHTML = "未在 sessionStorage 找到 admin Token。复制按钮将使用掩码（abc12…wxyz），请先<a href='/'>回到登录页</a>粘贴 token，或直接读 <code>data/security/relay-token</code>。";
          return;
        }
        fetch("/admin/auth/token", { headers: { authorization: "Bearer " + adminToken } })
          .then(function (res) {
            if (!res.ok) {
              status.innerHTML = "<span class='warn'>拉取完整 Token 失败（" + res.status + "），仍使用掩码。直接读 <code>data/security/relay-token</code>。</span>";
              return null;
            }
            return res.json();
          })
          .then(function (body) {
            if (!body || !body.token) {
              status.innerHTML = "<span class='warn'>完整 Token 为空，仍使用掩码。直接读 <code>data/security/relay-token</code>。</span>";
              return;
            }
            const liveToken = body.token;
            // Patch the data injection so the dropdown-handler
            // sees the live token.
            const dataNode = document.getElementById("tool-generator-data");
            if (dataNode) {
              try {
                const parsed = JSON.parse(dataNode.textContent);
                parsed.apiKey = liveToken;
                parsed.apiKeyHint = liveToken;
                dataNode.textContent = JSON.stringify(parsed);
              } catch { /* ignore */ }
            }
            // Patch the visible hint + the 4 <pre> blocks for
            // the currently selected tool.
            const hint = document.querySelector("[data-tool-generator-api-hint]");
            if (hint) hint.textContent = liveToken;
            const base = (dataNode ? JSON.parse(dataNode.textContent).base : "") || "";
            const toolById = (dataNode ? JSON.parse(dataNode.textContent).toolById : {}) || {};
            const defaultModel = (dataNode ? JSON.parse(dataNode.textContent).defaultModel : "auto") || "auto";
            const rebuildBlocks = function (toolKey) {
              const tool = toolById[toolKey];
              if (!tool) return;
              const ps = tool.vars.map(function (v) { return "$env:" + v[0] + "=\\"" + v[1].replace(/\\\\/g, "\\\\\\\\").replace(/\\"/g, '\\\\"') + "\\""; }).join("\\n");
              // ^ the above is too clever; rebuild via simple string concat instead
            };
            const setBlocksForTool = function (toolKey) {
              const tool = toolById[toolKey];
              if (!tool) return;
              const newVars = tool.vars.map(function (v) {
                if (v[0].endsWith("BASE_URL") || v[0].endsWith("API_BASE")) return v;
                return [v[0], liveToken];
              });
              const ps = newVars.map(function (v) { return "$env:" + v[0] + "=\\"" + v[1] + "\\""; }).join("\\n");
              const cmd = newVars.map(function (v) { return "set " + v[0] + "=" + v[1]; }).join("\\r\\n");
              const bash = newVars.map(function (v) { return "export " + v[0] + "=\\"" + v[1] + "\\""; }).join("\\n");
              const psEl = document.getElementById("tool-generator-ps");
              const cmdEl = document.getElementById("tool-generator-cmd");
              const bashEl = document.getElementById("tool-generator-bash");
              if (psEl) psEl.textContent = ps;
              if (cmdEl) cmdEl.textContent = cmd;
              if (bashEl) bashEl.textContent = bash;
              // Rebuild the verify command with the live token.
              const safeModel = (defaultModel || "auto").replace(/"/g, '\\\\"');
              const safeToken = liveToken.replace(/"/g, '\\\\"');
              const verifyEl = document.getElementById("tool-generator-verify");
              if (verifyEl && base) {
                verifyEl.textContent = "Invoke-RestMethod -Uri \\"" + base + "/models\\" -Headers @{ Authorization = \\"Bearer " + safeToken + "\\" } | Select-Object -ExpandProperty data | Select-Object -First 3 -ExpandProperty id\\n$body = @{ model = \\"" + safeModel + "\\"; messages = @(@{ role = \\"user\\"; content = \\"reply with the single word: pong\\" }) } | ConvertTo-Json -Depth 6\\nInvoke-RestMethod -Uri \\"" + base + "/chat/completions\\" -Headers @{ Authorization = \\"Bearer " + safeToken + "\\" } -Method Post -ContentType \\"application/json\\" -Body $body";
              }
            };
            // Initial: patch the first tool.
            setBlocksForTool(Object.keys(toolById)[0]);
            // Wire the selector to re-patch on change.
            const sel = document.getElementById("tool-generator-tool");
            if (sel) sel.addEventListener("change", function () { setBlocksForTool(sel.value); });
            status.innerHTML = "已用完整 Token 替换掩码（仅本会话）。";
          })
          .catch(function (error) {
            status.innerHTML = "<span class='warn'>拉取 Token 出错：" + (error && error.message ? error.message : "未知") + "，仍使用掩码。</span>";
          });
      })();
    </script>
  `;
}
