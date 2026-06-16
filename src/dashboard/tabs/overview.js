// Overview tab: quick-start wizard, base URL, 4 summary metrics,
// current profile, quick actions, last 5 errors.

import { escapeHtml } from "../../http-helpers.js";
import { renderErrorRow } from "../rows.js";

// Inspect the current status snapshot and decide which 3-step
// welcome flow to show. The wizard is read-only — it never writes
// config, never fetches upstream.
export function buildQuickStartSteps(ctx) {
  const providers = ctx.status.providers || [];
  const webKeys = ctx.status.webKeys || [];
  const healthCache = ctx.status.healthCache || {};
  const keys = ctx.status.keys || {};

  const localProviders = providers.filter((p) => p.local);
  const cloudProviders = providers.filter((p) => !p.local);
  const hasCloudKey = cloudProviders.some((p) => {
    const webCount = webKeys.filter((k) => k.provider === p.name && k.enabled).length;
    return webCount > 0 || p.keyCount > 0;
  });
  const hasLocalProvider = localProviders.length > 0;

  let modeLabel = "混合 fallback";
  if (hasLocalProvider && !hasCloudKey) modeLabel = "本地模型 only";
  else if (!hasLocalProvider && hasCloudKey) modeLabel = "自有 API Key";

  const missingKeyProviders = cloudProviders.filter((p) => {
    const webCount = webKeys.filter((k) => k.provider === p.name && k.enabled).length;
    return webCount === 0 && p.keyCount === 0;
  });
  const untestedLocalProviders = localProviders.filter((p) => !healthCache[p.name]);

  const toolEnvCommand = `powershell -ExecutionPolicy Bypass -File scripts\\write-tool-env.ps1`;
  const verifyCommand = `.\\tool-verify.ps1`;

  return { modeLabel, hasLocalProvider, hasCloudKey, missingKeyProviders, untestedLocalProviders, toolEnvCommand, verifyCommand };
}

// 0.5.3: render the auth-state panel above the quick-start
// wizard. The panel either shows the no-auth warning, the
// masked token + "Copy full token" button, or the legacy
// "RELAY_TOKEN not set" notice (only when the operator has not
// set OPENRELAY_ALLOW_NO_AUTH=true AND no env/disk token was
// found — which is no longer reachable now that the server
// auto-generates, but the fallback copy remains for clarity).
export function renderAuthPanel(ctx) {
  const auth = ctx.relayAuth || {};
  if (auth.allowNoAuth) {
    return `<div class="notice bad" data-no-auth-banner>
      <strong>无鉴权模式：</strong>当前处于 <code>OPENRELAY_ALLOW_NO_AUTH=true</code>，<strong>任何</strong>能访问 <code>127.0.0.1:${escapeHtml(ctx.port || 18765)}</code> 的浏览器标签 / 扩展都可以调用本机上游 API Key。
      请仅在临时开发 / 调试时使用，生产 / 公网环境请关闭。
    </div>`;
  }
  if (auth.tokenRequired) {
    const masked = escapeHtml(auth.apiKeyMasked || auth.apiKeyHint || "（未知）");
    const sourceLabel = auth.tokenSource === "env"
      ? "来源：.env / 环境变量"
      : auth.tokenSource === "openrelay_env"
        ? "来源：OPENRELAY_TOKEN 兼容别名"
        : auth.tokenSource === "disk"
          ? "来源：data/security/relay-token"
          : "来源：自动生成";
    return `<div class="panel" data-auth-panel>
      <div class="panel-title"><h3>本地鉴权 Token</h3>
        <span class="muted">${escapeHtml(sourceLabel)}</span>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <code data-relay-token-masked>${masked}</code>
        <button type="button" class="small" data-copy-relay-token>复制完整 Token</button>
        <span class="muted" style="font-size:12px;">仅复制到本机剪贴板；不会写入文件 / URL / 日志。</span>
      </div>
      <p class="muted" style="margin-top:8px;font-size:12px;">调用 <code>/v1/chat/completions</code> / <code>/v1/responses</code> / <code>/v1/messages</code> 时需带 <code>Authorization: Bearer &lt;token&gt;</code>。客户端工具（Codex / OpenClaw / OpenCode / Aider / Goose / Continue / Claude Code）请把 Token 填到对应环境变量，或在"工具接入"页直接生成。</p>
    </div>`;
  }
  return "";
}

export function renderOverviewTab(ctx) {
  const recentPreview = ctx.errors.slice(0, 5);
  const errorPreviewRows = recentPreview.length === 0
    ? '<tr><td colspan="3" class="muted">暂无错误</td></tr>'
    : recentPreview.map(renderErrorRow).join("");
  const qs = buildQuickStartSteps(ctx);
  const authPanel = renderAuthPanel(ctx);
  const step2Items = [];
  if (qs.missingKeyProviders.length > 0) {
    step2Items.push(`<div class="notice warn">云端 Provider 缺 Key：<strong>${escapeHtml(qs.missingKeyProviders.map((p) => p.name).join(", "))}</strong>。请在"Provider"页添加 Web Key 或编辑 <code>.env</code>。</div>`);
  }
  if (qs.untestedLocalProviders.length > 0) {
    step2Items.push(`<div class="notice warn">本地 Provider 未测试：<strong>${escapeHtml(qs.untestedLocalProviders.map((p) => p.name).join(", "))}</strong>。请确认已启动 Ollama / LM Studio / vLLM / llama.cpp。</div>`);
  }
  if (step2Items.length === 0) {
    step2Items.push(`<div class="notice ok">Key 和本地 Provider 状态正常。</div>`);
  }

  // --- Status Dashboard computation ---
  const allProviders = ctx.status.providers || [];
  const allWebKeys = ctx.status.webKeys || [];
  const startedAt = ctx.status.serverStartedAt;
  let serverStatus;
  if (startedAt) {
    const elapsed = Date.now() - new Date(startedAt).getTime();
    serverStatus = elapsed < 5 * 60 * 1000 ? "运行中" : "正常运行";
  } else {
    serverStatus = "正常运行";
  }
  const auth = ctx.relayAuth || {};
  let authStatus, authCls;
  if (!auth.allowNoAuth && !auth.tokenRequired) {
    authStatus = "未配置"; authCls = "bad";
  } else if (auth.allowNoAuth) {
    authStatus = "无鉴权模式"; authCls = "warn";
  } else {
    authStatus = "已启用"; authCls = "ok";
  }
  const activeProfile = ctx.activeProfileName || "无";
  const availableCount = allProviders.filter((p) => {
    if (p.local) return true;
    const webCount = allWebKeys.filter((k) => k.provider === p.name && k.enabled).length;
    return webCount > 0 || p.keyCount > 0;
  }).length;
  const statusDashboardHtml = `
    <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;background:var(--panel-bg,#fff);border:1px solid var(--border,#e0e0e0);border-radius:8px;padding:12px 16px;margin-bottom:12px;">
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
        <span style="color:var(--muted,#888);white-space:nowrap;">服务状态</span>
        <span class="pill ok">${escapeHtml(serverStatus)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
        <span style="color:var(--muted,#888);white-space:nowrap;">Token 鉴权</span>
        <span class="pill ${authCls}">${escapeHtml(authStatus)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
        <span style="color:var(--muted,#888);white-space:nowrap;">激活 Profile</span>
        <span class="pill ok">${escapeHtml(activeProfile)}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px;font-size:13px;">
        <span style="color:var(--muted,#888);white-space:nowrap;">可用 Provider</span>
        <span class="pill ok">${availableCount}</span>
      </div>
      <div style="flex:1;min-width:0;"></div>
      <button id="btn-test-all" class="small primary">测试当前配置</button>
    </div>
    <div id="test-all-output" style="margin-bottom:12px;"></div>
  `;

  // Welcome wizard — shown at top on first-run
  const showWelcomeWizard = ctx.providerCount === 0 || ctx.totalWebKeys === 0;
  const welcomeCards = [];
  if (ctx.localProviderCount === 0) {
    welcomeCards.push(`<div class="card compact" style="border-left:4px solid #0d9488;">
      <div style="font-size:14px;font-weight:700;">本地模型</div>
      <p class="muted" style="margin:4px 0 8px;font-size:12px;">启动本地 Ollama/LM Studio</p>
      <button class="small primary" data-tab-link="providers">去 Provider 页配置</button>
    </div>`);
  }
  if (ctx.totalWebKeys === 0) {
    welcomeCards.push(`<div class="card compact" style="border-left:4px solid #2563eb;">
      <div style="font-size:14px;font-weight:700;">云 API Key</div>
      <p class="muted" style="margin:4px 0 8px;font-size:12px;">添加 API Key</p>
      <button class="small primary" data-tab-link="providers">去 Provider 页添加</button>
    </div>`);
  }
  welcomeCards.push(`<div class="card compact" style="border-left:4px solid #7c3aed;">
    <div style="font-size:14px;font-weight:700;">接入 OpenCode</div>
    <p class="muted" style="margin:4px 0 8px;font-size:12px;">配置 OpenCode 环境变量</p>
    <button class="small primary" data-tab-link="tools">去工具接入页查看</button>
  </div>`);
  const welcomeWizardHtml = showWelcomeWizard
    ? `<div class="panel" style="background:linear-gradient(135deg,#f8faff 0%,#fff 100%);border-color:#d0d5dd;">
      <div class="panel-title"><h3>欢迎使用 RelayForge</h3><span class="muted">本地优先 AI 编程网关</span></div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;">${welcomeCards.join("")}</div>
    </div>`
    : "";

  return `
    <h2>总览</h2>
    ${statusDashboardHtml}
    ${welcomeWizardHtml}
    ${authPanel}
    <div class="panel">
      <div class="panel-title"><h3>首次使用向导</h3><span class="muted">只读状态，不写配置</span></div>
      <div style="display:grid;gap:12px;">
        <div class="card compact">
          <div class="label" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;">Step 1 · 使用方式</div>
          <div style="margin-top:6px;font-size:14px;"><span class="pill ok">${escapeHtml(qs.modeLabel)}</span> ${qs.hasLocalProvider ? '<span class="pill local">有本地模型</span>' : ''} ${qs.hasCloudKey ? '<span class="pill ok">有云端 Key</span>' : ''}</div>
          <p class="muted" style="margin-top:6px;font-size:12px;">${qs.modeLabel === "本地模型 only" ? "当前只有本地 provider，不需要云端 API Key。" : qs.modeLabel === "自有 API Key" ? "当前已配置云端 API Key，没有本地 provider。" : "混合使用本地模型和云端 API Key，失败时自动 fallback。"}</p>
        </div>
        <div class="card compact">
          <div class="label" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;">Step 2 · 配置检查</div>
          <div style="margin-top:8px;display:grid;gap:6px;">${step2Items.join("")}</div>
        </div>
        <div class="card compact">
          <div class="label" style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.4px;">Step 3 · 生成工具脚本</div>
          <div style="margin-top:8px;display:grid;gap:6px;">
            <div class="command-box">
              <div class="head"><strong>生成环境变量脚本</strong><button class="small" data-copy="${escapeHtml(qs.toolEnvCommand)}">复制</button></div>
              <pre>${escapeHtml(qs.toolEnvCommand)}</pre>
            </div>
            <div class="command-box">
              <div class="head"><strong>验证脚本</strong><button class="small" data-copy="${escapeHtml(qs.verifyCommand)}">复制</button></div>
              <pre>${escapeHtml(qs.verifyCommand)}</pre>
            </div>
            <p class="muted" style="font-size:12px;">脚本只设置当前 shell 进程级 env vars，<strong>不会</strong>修改系统环境变量、Windows 注册表或 <code>~/.bashrc</code>。</p>
          </div>
        </div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>本地服务地址</h3></div>
      <div class="endpoint-block">
        <code>${escapeHtml(ctx.baseUrl)}</code>
        <button class="small" data-copy-base-url="${escapeHtml(ctx.baseUrl)}">复制</button>
        <a href="/v1/models" target="_blank" rel="noopener">打开 /v1/models</a>
      </div>
      <p class="muted" style="margin-top: 6px;">默认监听 127.0.0.1:${ctx.port}，不向局域网或公网开放。OpenAI 兼容 Base URL = <code>${escapeHtml(ctx.baseUrl)}</code>。</p>
    </div>
    <div class="grid grid-4">
      <div class="metric"><span class="label">Provider</span><span class="value">${ctx.providerCount}</span><span class="sub">本地 ${ctx.localProviderCount} · 云端 ${ctx.cloudProviderCount}</span></div>
      <div class="metric"><span class="label">Web Key</span><span class="value">${ctx.totalWebKeys}</span><span class="sub">${ctx.totalWebKeys > 0 ? "已加密保存到 data/keys.enc.json" : "尚未添加 Web Key"}</span></div>
      <div class="metric"><span class="label">今日请求</span><span class="value">${ctx.todayRequests}</span><span class="sub">${ctx.totalLocalLimitHits > 0 ? `<span class="warn">本地限额命中 ${ctx.totalLocalLimitHits}</span>` : "无本地限额命中"}</span></div>
      <div class="metric"><span class="label">最近错误</span><span class="value ${ctx.recentErrorCount > 0 ? "warn" : "ok"}">${ctx.recentErrorCount}</span><span class="sub">最多保留 50 条（仅错误摘要）</span></div>
    </div>
    <div class="grid grid-2">
      <div class="panel">
        <div class="panel-title"><h3>当前 Profile</h3>
          <button class="small" data-tab-link="routes">切换</button>
        </div>
        <div><span class="pill ok">${escapeHtml(ctx.activeProfileName || "无")}</span></div>
        <p class="muted" style="margin-top: 8px;">默认模型：<code>${escapeHtml(ctx.defaultModel || "—")}</code></p>
        <p class="muted">请求里 model 写 <code>auto</code> / <code>default</code> 或不传时，会用这个 Profile 的 defaultModel。</p>
      </div>
      <div class="panel">
        <div class="panel-title"><h3>快速接入</h3></div>
        <div class="quick-actions" style="margin-bottom: 8px;">
          <button data-copy-env="${escapeHtml(ctx.overviewEnvBlock)}">复制 OpenAI / Anthropic 环境变量</button>
          <button id="gen-tool-env">去工具接入页生成 tool-env</button>
          <button id="open-v1-models">验证 /v1/models</button>
          <button data-tab-link="providers">管理 Provider</button>
        </div>
        <p class="muted">这里只生成当前 shell 进程级 env vars，<strong>不会</strong>修改系统环境变量、Windows 注册表、macOS / Linux 的 <code>/etc/environment</code>、或任何 <code>~/.bashrc</code> / <code>~/.zshrc</code>。</p>
      </div>
    </div>
    <div class="panel">
      <div class="panel-title"><h3>最近 5 条错误</h3>
        <button class="small" data-tab-link="usage">查看全部</button>
      </div>
      <div class="scroll-x">
        <table>
          <thead><tr><th style="width: 180px;">时间</th><th style="width: 110px;">分类</th><th>错误摘要</th></tr></thead>
          <tbody>${errorPreviewRows}</tbody>
        </table>
      </div>
    </div>
    <script>
      // 0.5.4: wire the "Copy full token" button. The full token
      // is no longer embedded in the dashboard HTML (the
      // buildStatus() relayAuth surface only carries masked
      // hints). The button issues an admin-authed XHR to
      // /admin/auth/token using the admin token the operator
      // already entered into the token prompt page (kept in
      // sessionStorage under "openrelay.adminToken"). If the
      // XHR fails (e.g. allowNoAuth mode, or the operator
      // browsed the dashboard before pasting the token), the
      // handler shows the masked form + a hint to read
      // data/security/relay-token manually.
      const copyTokenButton = document.querySelector("[data-copy-relay-token]");
      if (copyTokenButton) {
        copyTokenButton.addEventListener("click", async () => {
          if (relayAuth && relayAuth.allowNoAuth) {
            copyTokenButton.textContent = "无鉴权模式无需 Token";
            setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 1800);
            return;
          }
          if (relayAuth && relayAuth.tokenSource === "check-readonly") {
            copyTokenButton.textContent = "check 模式未生成 Token";
            setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 1800);
            return;
          }
          const adminToken = sessionStorage.getItem("relayforge.adminToken") || sessionStorage.getItem("openrelay.adminToken") || "";
          if (!adminToken) {
            copyTokenButton.textContent = "未登录 / 无 sessionStorage Token";
            setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 2400);
            return;
          }
          copyTokenButton.textContent = "获取中…";
          try {
            const res = await fetch("/admin/auth/token", {
              headers: { authorization: "Bearer " + adminToken }
            });
            if (!res.ok) {
              copyTokenButton.textContent = "鉴权失败 (" + res.status + ")";
              setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 2400);
              return;
            }
            const body = await res.json();
            const token = body && body.token ? body.token : "";
            if (!token) {
              copyTokenButton.textContent = "Token 为空（allowNoAuth?）";
              setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 2400);
              return;
            }
            try {
              await navigator.clipboard.writeText(token);
              copyTokenButton.textContent = "已复制";
              setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 1800);
            } catch (clipError) {
              const textArea = document.createElement("textarea");
              textArea.value = token;
              document.body.appendChild(textArea);
              textArea.select();
              try { document.execCommand("copy"); } catch { /* ignore */ }
              document.body.removeChild(textArea);
              copyTokenButton.textContent = "已复制（execCommand）";
              setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 1800);
            }
          } catch (error) {
            copyTokenButton.textContent = "请求失败: " + (error && error.message ? error.message : "未知");
            setTimeout(() => { copyTokenButton.textContent = "复制完整 Token"; }, 2400);
          }
        });
      }
    </script>
    <script>
      document.getElementById("btn-test-all")?.addEventListener("click", async () => {
        const btn = document.getElementById("btn-test-all");
        const out = document.getElementById("test-all-output");
        btn.disabled = true;
        btn.textContent = "测试中…";
        out.innerHTML = '<div class="muted">正在检测…</div>';
        try {
          const res = await (await fetch("/admin/test-all")).json();
          if (res.ok) {
            out.innerHTML = '<div class="notice ok">全部通过 ✓ ' + (res.chat?.model || "") + '</div>';
          } else {
            const errs = (res.errors || []).join("<br>");
            out.innerHTML = '<div class="notice bad">' + errs + '</div>';
          }
        } catch(e) {
          out.innerHTML = '<div class="notice bad">请求失败：' + e.message + '</div>';
        }
        btn.disabled = false;
        btn.textContent = "测试当前配置";
      });
    </script>
  `;
}
