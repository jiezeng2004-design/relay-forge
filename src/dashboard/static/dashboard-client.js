function escapeHtml(value) {
  if (value == null) return "";
  var str = String(value);
  return str.replace(/[&<>"']/g, function (ch) {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    if (ch === '"') return "&quot;";
    return "&#39;";
  });
}
    // ---- tab navigation (hash-routed) ----
    const tabLinks = Array.from(document.querySelectorAll("#tab-nav a[data-tab]"));
    const tabPanes = Array.from(document.querySelectorAll(".tab-pane"));
    function activateTab(name) {
      const safe = tabLinks.some((a) => a.dataset.tab === name) ? name : "overview";
      tabLinks.forEach((a) => a.classList.toggle("active", a.dataset.tab === safe));
      tabPanes.forEach((p) => p.classList.toggle("active", p.dataset.pane === safe));
      if (window.location.hash !== "#" + safe) {
        history.replaceState(null, "", "#" + safe);
      }
    }
    tabLinks.forEach((a) => a.addEventListener("click", (event) => {
      event.preventDefault();
      activateTab(a.dataset.tab);
    }));
    window.addEventListener("hashchange", () => {
      const name = (window.location.hash || "").replace(/^#/, "");
      activateTab(name);
    });
    activateTab((window.location.hash || "").replace(/^#/, "") || "overview");

    const setMessage = (text, kind = "muted") => {
      message.className = "notice " + kind;
      message.textContent = text;
    };
    const addKeyMessage = document.getElementById("add-key-message");
    const setAddKeyMessage = (text, kind = "muted") => {
      addKeyMessage.className = "notice " + kind;
      addKeyMessage.textContent = text;
    };
    const providerMessage = document.getElementById("provider-message");
    const setProviderMessage = (text, kind = "muted") => {
      providerMessage.className = "notice " + kind;
      providerMessage.textContent = text;
    };
    const providerInlineKeyMessage = document.getElementById("provider-inline-key-message");
    const setProviderInlineKeyMessage = (text, kind = "muted") => {
      providerInlineKeyMessage.className = "notice " + kind;
      providerInlineKeyMessage.textContent = text;
    };
    const routeMessage = document.getElementById("route-message");
    const setRouteMessage = (text, kind = "muted") => {
      routeMessage.className = "notice " + kind;
      routeMessage.textContent = text;
    };
    const adminTokenInput = document.getElementById("admin-token");
    adminTokenInput.value = sessionStorage.getItem("openrelay.adminToken") || "";
    document.getElementById("admin-token-save").addEventListener("click", () => {
      const oldToken = sessionStorage.getItem("openrelay.adminToken"); if (oldToken) sessionStorage.removeItem("openrelay.adminToken");
sessionStorage.setItem("relayforge.adminToken", adminTokenInput.value.trim());
      setMessage("本地管理 Token 已保存到本次浏览器会话。", "ok");
    });
    document.getElementById("admin-token-clear").addEventListener("click", () => {
      sessionStorage.removeItem("openrelay.adminToken");
      adminTokenInput.value = "";
      setMessage("本地管理 Token 已清除。", "muted");
    });

    function adminHeaders(extra = {}) {
      const token = sessionStorage.getItem("openrelay.adminToken") || adminTokenInput.value.trim();
      const headers = { ...extra };
      if (token) headers.authorization = "Bearer " + token;
      return headers;
    }
    async function parseJsonResponse(response) {
      const text = await response.text();
      let data = text;
      try { data = JSON.parse(text); } catch (_) {}
      if (response.status === 401) setMessage("需要输入 RELAY_TOKEN", "bad");
      return { ok: response.ok, status: response.status, data };
    }
    // Soft refresh: after a successful save / add / delete, the
    // operator used to see "left nav only, right side blank,
    // clicks do nothing" because previous attempts at re-running
    // the inline <script> after a body swap were fragile in real
    // browsers. The reliable fix is a hard reload. The trade-off
    // is a brief full-page reload after every save; in exchange we
    // get working buttons and no half-bound event listeners.
    function softRefresh() {
      window.location.reload();
    }
    function scheduleSoftRefresh(delayMs = 350) {
      window.setTimeout(softRefresh, delayMs);
    }
    async function postJson(url, body) {
      const response = await fetch(url, {
        method: "POST",
        headers: adminHeaders({ "content-type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return parseJsonResponse(response);
    }
    async function patchJson(url, body) {
      const response = await fetch(url, {
        method: "PATCH",
        headers: adminHeaders({ "content-type": "application/json" }),
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      return parseJsonResponse(response);
    }
    async function deleteJson(url) {
      const response = await fetch(url, { method: "DELETE", headers: adminHeaders() });
      return parseJsonResponse(response);
    }
    async function getJson(url) {
      const response = await fetch(url, { headers: adminHeaders() });
      return parseJsonResponse(response);
    }

    // ---- overview actions ----
    document.querySelectorAll("[data-copy-base-url]").forEach((btn) => btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy-base-url");
      navigator.clipboard.writeText(text).then(() => flashCopy(btn));
    }));
    document.querySelectorAll("[data-copy-env]").forEach((btn) => btn.addEventListener("click", () => {
      const text = btn.getAttribute("data-copy-env");
      navigator.clipboard.writeText(text).then(() => flashCopy(btn));
    }));
    document.getElementById("gen-tool-env")?.addEventListener("click", () => {
      activateTab("tools");
    });
    document.getElementById("open-v1-models")?.addEventListener("click", (event) => {
      event.preventDefault();
      window.open("/v1/models", "_blank", "noopener");
    });
    document.getElementById("copy-diagnostics")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("diagnostic-summary").value).then(() => flashCopy(document.getElementById("copy-diagnostics")));
    });
    document.getElementById("copy-codex-diagnostics")?.addEventListener("click", () => {
      navigator.clipboard.writeText(document.getElementById("codex-diagnostic-summary").value).then(() => flashCopy(document.getElementById("copy-codex-diagnostics")));
    });
    document.getElementById("clear-error-log")?.addEventListener("click", () => {
      const wrap = document.getElementById("error-table-wrap");
      if (wrap) { wrap.innerHTML = '<tr><td colspan="4" class="muted">错误列表已清空（仅当前页面）。</td></tr>'; }
      document.querySelectorAll("[data-filter-cat]").forEach(b => { b.classList.remove("primary"); b.removeAttribute("data-filter-active"); });
      document.querySelector("[data-filter-cat='all']")?.classList.add("primary");
      document.querySelector("[data-filter-cat='all']")?.setAttribute("data-filter-active", "true");
    });

    // ---- error category filter (purely client-side; no backend call) ----
    function applyErrorCategoryFilter(category) {
      const wrap = document.getElementById("error-table-wrap");
      if (!wrap) return;
      const rows = wrap.querySelectorAll("tr[data-error-category]");
      let visibleCount = 0;
      rows.forEach((row) => {
        const rowCat = row.getAttribute("data-error-category");
        const show = !category || category === "all" || rowCat === category;
        row.hidden = !show;
        if (show) visibleCount += 1;
      });
      // Toggle an empty-state row so the panel never looks broken.
      let empty = wrap.querySelector("tr[data-filter-empty]");
      if (visibleCount === 0) {
        if (!empty) {
          empty = document.createElement("tr");
          empty.setAttribute("data-filter-empty", "true");
          empty.innerHTML = '<td colspan="4" class="muted">当前筛选下没有错误。</td>';
          wrap.querySelector("tbody").appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
    }
    function setActiveFilterButton(category) {
      document.querySelectorAll("[data-filter-cat]").forEach((btn) => {
        const isActive = btn.getAttribute("data-filter-cat") === category;
        if (isActive) {
          btn.setAttribute("data-filter-active", "true");
          btn.classList.add("primary");
        } else {
          btn.removeAttribute("data-filter-active");
          btn.classList.remove("primary");
        }
      });
    }
    document.querySelectorAll("[data-filter-cat]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const category = btn.getAttribute("data-filter-cat");
        setActiveFilterButton(category);
        applyErrorCategoryFilter(category);
      });
    });
    // ---- provider status filter (purely client-side; no backend call) ----
    function applyProviderFilter(filterKey) {
      const wrap = document.getElementById("provider-table-body");
      if (!wrap) return;
      const rows = wrap.querySelectorAll("tr[data-provider-row]");
      const recentNames = new Set(
        (status.recentErrors || []).map((entry) => entry && entry.provider).filter(Boolean)
      );
      let visibleCount = 0;
      rows.forEach((row) => {
        const name = row.getAttribute("data-provider-name") || "";
        const tags = (row.getAttribute("data-provider-status") || "").split(/\s+/).filter(Boolean);
        const show = filterKey === "all" || tags.includes(filterKey) || (filterKey === "recent-failed" && recentNames.has(name));
        row.hidden = !show;
        if (show) visibleCount += 1;
      });
      let empty = wrap.querySelector("tr[data-provider-filter-empty]");
      if (visibleCount === 0) {
        if (!empty) {
          empty = document.createElement("tr");
          empty.setAttribute("data-provider-filter-empty", "true");
          empty.innerHTML = '<td colspan="7" class="muted">当前筛选下没有 Provider。</td>';
          wrap.appendChild(empty);
        }
      } else if (empty) {
        empty.remove();
      }
    }
    function setActiveProviderFilterButton(filterKey) {
      document.querySelectorAll("[data-provider-filter]").forEach((btn) => {
        const isActive = btn.getAttribute("data-provider-filter") === filterKey;
        if (isActive) {
          btn.setAttribute("data-provider-filter-active", "true");
          btn.classList.add("primary");
        } else {
          btn.setAttribute("data-provider-filter-active", "false");
          btn.classList.remove("primary");
        }
      });
    }
    document.querySelectorAll("[data-provider-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const filterKey = btn.getAttribute("data-provider-filter");
        setActiveProviderFilterButton(filterKey);
        applyProviderFilter(filterKey);
      });
    });
    document.querySelectorAll("[data-tab-link]").forEach((btn) => btn.addEventListener("click", () => {
      activateTab(btn.getAttribute("data-tab-link"));
    }));
    function flashCopy(btn) {
      const original = btn.textContent;
      btn.textContent = "已复制";
      btn.classList.add("ok");
      window.setTimeout(() => { btn.textContent = original; btn.classList.remove("ok"); }, 900);
    }

    // ---- tool config generator (P1) ----
    function readToolGeneratorData() {
      const node = document.getElementById("tool-generator-data");
      if (!node) return null;
      try { return JSON.parse(node.textContent); } catch (_) { return null; }
    }
    function renderToolCommands(tool, base) {
      if (!tool) return { ps: "", cmd: "", bash: "" };
      const ps = tool.vars.map(function (entry) { return "$env:" + entry[0] + "=" + JSON.stringify(String(entry[1] || "")); }).join("\n");
      const cmd = tool.vars.map(function (entry) { return "set " + entry[0] + "=" + entry[1]; }).join("\r\n");
      const bash = tool.vars.map(function (entry) { return "export " + entry[0] + "=" + JSON.stringify(String(entry[1] || "")); }).join("\n");
      return { ps: ps, cmd: cmd, bash: bash };
    }
    function refreshToolGenerator() {
      const data = readToolGeneratorData();
      if (!data) return;
      const toolSelect = document.getElementById("tool-generator-tool");
      const modelSelect = document.getElementById("tool-generator-model");
      if (!toolSelect || !modelSelect) return;
      const tool = data.toolById[toolSelect.value] || data.toolById.codex;
      const modelValue = modelSelect.value;
      const recommended = modelValue || data.defaultModel;
      const psEl = document.getElementById("tool-generator-ps");
      const cmdEl = document.getElementById("tool-generator-cmd");
      const bashEl = document.getElementById("tool-generator-bash");
      const verifyEl = document.getElementById("tool-generator-verify");
      const recEl = document.querySelector("[data-tool-generator-recommended]");
      const cmds = renderToolCommands(tool, data.base);
      if (psEl) psEl.textContent = cmds.ps;
      if (cmdEl) cmdEl.textContent = cmds.cmd;
      if (bashEl) bashEl.textContent = cmds.bash;
      if (recEl) recEl.textContent = recommended;
      if (verifyEl) {
        const baseUrl = data.base || "http://127.0.0.1:18765/v1";
        const safeModel = String(recommended || "auto").replace(/"/g, "\"");
        verifyEl.textContent = "Invoke-RestMethod -Uri \"" + baseUrl + "/models\" -Headers @{ Authorization = \"Bearer local\" } | Select-Object -ExpandProperty data | Select-Object -First 3 -ExpandProperty id\n$body = @{ model = \"" + safeModel + "\"; messages = @(@{ role = \"user\"; content = \"reply with the single word: pong\" }) } | ConvertTo-Json -Depth 6\nInvoke-RestMethod -Uri \"" + baseUrl + "/chat/completions\" -Method Post -ContentType \"application/json\" -Body $body";
      }
    }
    // ---- tool toggle UX (0.3.8) ----
    function setActiveToolToggle(toolId) {
      const prev = document.querySelector(".tool-toggle-btn.active");
      if (prev) { prev.classList.remove("active"); prev.style.background = "#fff"; prev.style.color = "inherit"; }
      const next = document.querySelector(`[data-tool-toggle="${toolId}"]`);
      if (next) {
        next.classList.add("active");
        next.style.background = "var(--primary,#2563eb)";
        next.style.color = "#fff";
      }
      const sel = document.getElementById("tool-generator-tool");
      if (sel && sel.value !== toolId) {
        sel.value = toolId;
        sel.dispatchEvent(new Event("change"));
      } else {
        refreshToolGenerator();
      }
    }
    document.querySelectorAll("[data-tool-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        setActiveToolToggle(btn.getAttribute("data-tool-toggle"));
      });
    });
    document.getElementById("tool-generator-tool")?.addEventListener("change", refreshToolGenerator);
    document.getElementById("tool-generator-model")?.addEventListener("change", refreshToolGenerator);
    document.querySelectorAll("[data-copy-target]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-copy-target");
        if (!targetId) return;
        const node = document.getElementById(targetId);
        if (!node) return;
        navigator.clipboard.writeText(node.textContent || "").then(() => flashCopy(btn)).catch((error) => setMessage("复制失败：" + error.message, "bad"));
      });
    });

    // ---- route preview (P2) ----
    function renderRoutePreviewResult(preview) {
      const out = document.getElementById("route-preview-output");
      if (!out) return;
      if (!preview || !preview.ok) {
        out.innerHTML = '<div class="notice bad">无法解析该 model：' + escapeHtml((preview && preview.reason) || (preview && preview.error) || "未知原因") + "</div>";
        return;
      }
      const tags = [];
      tags.push('<span class="pill">kind: ' + escapeHtml(preview.kind) + "</span>");
      if (preview.profileName) tags.push('<span class="pill">profile: ' + escapeHtml(preview.profileName) + "</span>");
      if (preview.routeName) tags.push('<span class="pill">route: ' + escapeHtml(preview.routeName) + "</span>");
      if (preview.strategy) tags.push('<span class="pill">strategy: ' + escapeHtml(preview.strategy) + "</span>");
      const candidateRows = (preview.candidates || []).map(function (candidate, index) {
        const localPill = candidate.local ? '<span class="pill local">本地</span>' : '<span class="pill cloud">云端</span>';
        const keyPill = candidate.keyAvailable
          ? '<span class="pill ok">有 Key</span>'
          : '<span class="pill bad">缺 Key</span>';
        const riskPill = candidate.insecureHttpRisk ? '<span class="pill bad">allowInsecureHttp</span>' : "";
        const healthPill = !candidate.hasHealth
          ? '<span class="pill muted-pill">未测</span>'
          : candidate.healthOk
            ? '<span class="pill ok">健康</span>'
            : '<span class="pill bad">失败</span>';
        return '<tr data-preview-candidate-index="' + index + '">'
          + '<td>' + (index + 1) + '<div class="muted">weight ' + escapeHtml(String(candidate.weight)) + '</div></td>'
          + '<td><code>' + escapeHtml(candidate.provider) + '</code>' + (candidate.baseUrl ? '<div class="muted mono">' + escapeHtml(candidate.baseUrl) + '</div>' : "") + '</td>'
          + '<td><code>' + escapeHtml(candidate.model) + '</code></td>'
          + '<td>' + localPill + '</td>'
          + '<td>' + keyPill + riskPill + '</td>'
          + '<td>' + healthPill + '</td>'
          + '</tr>';
      }).join("");
      const summary = preview.summary || {};
      const hint = preview.strategyHint ? ' · ' + escapeHtml(preview.strategyHint) : "";
      out.innerHTML = ''
        + '<div class="stack" style="margin: 8px 0;">' + tags.join(" ") + '</div>'
        + '<div class="muted" style="font-size:12px;margin-bottom:6px;">请求：<code>' + escapeHtml(preview.requested || "(空)") + '</code> → 实际：<code>' + escapeHtml(preview.normalized || "") + '</code>' + hint + '</div>'
        + '<div class="scroll-x">'
        + '<table>'
        + '<thead><tr><th style="width: 60px;">#</th><th>Provider</th><th>Model</th><th style="width: 100px;">本地 / 云端</th><th style="width: 200px;">Key / 风险</th><th style="width: 100px;">健康</th></tr></thead>'
        + '<tbody>' + (candidateRows || '<tr><td colspan="6" class="muted">没有可用的候选</td></tr>') + '</tbody>'
        + '</table>'
        + '</div>'
        + '<div class="muted" style="margin-top: 6px; font-size: 12px;">摘要：候选 ' + (summary.total || 0) + ' 个 · 本地 ' + (summary.localCount || 0) + ' · 云端 ' + (summary.cloudCount || 0) + ' · 缺 Key ' + (summary.needsKeyCount || 0) + ' · 有风险 ' + (summary.insecureRiskCount || 0) + ' · 健康失败 ' + (summary.failedHealthCount || 0) + '</div>';
    }
    async function runRoutePreview() {
      const input = document.getElementById("route-preview-input");
      const out = document.getElementById("route-preview-output");
      if (!input || !out) return;
      const model = input.value || "auto";
      out.innerHTML = '<div class="muted">正在解析…</div>';
      const result = await getJson("/admin/preview-route?model=" + encodeURIComponent(model));
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">解析失败：' + escapeHtml(String(result.status)) + " · 只读面板不会调用上游，也不会改 config。</div>";
        return;
      }
      renderRoutePreviewResult(result.data.preview);
    }
    document.getElementById("route-preview-button")?.addEventListener("click", runRoutePreview);
    document.getElementById("route-preview-input")?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); runRoutePreview(); }
    });

    // ---- provider form helpers (unchanged) ----
    function providerFormData() {
      const extraText = document.getElementById("provider-extra-headers").value.trim();
      const balanceText = document.getElementById("provider-balance-endpoint").value.trim();
      const name = document.getElementById("provider-name").value.trim();
      const baseUrl = document.getElementById("provider-base-url").value.trim();
      let keyEnv = document.getElementById("provider-key-env").value.trim();
      let extraHeaders;
      let balanceEndpoint;
      if (extraText) extraHeaders = JSON.parse(extraText);
      if (balanceText) balanceEndpoint = JSON.parse(balanceText);
      if (looksLikeRealKey(keyEnv)) {
        throw new Error("keyEnv 只能填写环境变量名。检测到像真实 API Key 的内容，请去 API Key 管理添加。");
      }
      if (isLocalProvider({ name, baseUrl })) keyEnv = "";
      return {
        name,
        displayName: document.getElementById("provider-display-name").value.trim(),
        baseUrl,
        apiFormat: document.getElementById("provider-api-format").value,
        keyEnv: keyEnv || null,
        models: document.getElementById("provider-models").value,
        allowInsecureHttp: document.getElementById("provider-allow-insecure-http").checked,
        extraHeaders,
        balanceEndpoint
      };
    }
    function fillProviderForm(provider) {
      document.getElementById("provider-name").value = provider.name || "";
      document.getElementById("provider-display-name").value = provider.displayName || "";
      document.getElementById("provider-base-url").value = provider.baseUrl || "";
      document.getElementById("provider-api-format").value = provider.apiFormat || "openai";
      document.getElementById("provider-key-env").value = provider.keyEnv || "";
      document.getElementById("provider-models").value = Array.isArray(provider.models) ? provider.models.join("\n") : "";
      document.getElementById("provider-allow-insecure-http").checked = provider.allowInsecureHttp === true;
      document.getElementById("provider-extra-headers").value = provider.extraHeaders ? JSON.stringify(provider.extraHeaders, null, 2) : "";
      document.getElementById("provider-balance-endpoint").value = provider.balanceEndpoint ? JSON.stringify(provider.balanceEndpoint, null, 2) : "";
      const inlineProvider = document.getElementById("provider-inline-key-name");
      if (inlineProvider && provider.name) inlineProvider.value = provider.name;
      if (isLocalProvider(provider)) {
        document.getElementById("provider-key-env").value = "";
      }
    }
    function clearProviderForm() {
      fillProviderForm({ apiFormat: "openai", models: [] });
      document.getElementById("provider-template").value = "";
      setProviderMessage("表单已清空。");
    }
    function isLocalProvider(provider) {
      const name = String(provider?.name || "").toLowerCase();
      const baseUrl = String(provider?.baseUrl || "").toLowerCase();
      return ["ollama", "lm-studio", "vllm", "llama-cpp"].includes(name) ||
        baseUrl.includes("127.0.0.1") ||
        baseUrl.includes("localhost");
    }
    function looksLikeRealKey(value) {
      const text = String(value || "").trim();
      return /^(sk-|sk-ant-|sk-or-|AIza|gsk-|pplx-|xai-|co-|claude-|hf_|ghp_|github_pat_)[A-Za-z0-9._:/-]{8,}/.test(text);
    }
    function providerNeedsKey(provider) {
      return !isLocalProvider(provider) && !!provider.keyEnv;
    }
    function providerDisplayLabel(name) {
      const provider = providers.find((item) => item.name === name);
      if (!provider) return name;
      const webCount = webKeys.filter((key) => key.provider === name && key.enabled).length;
      if (isLocalProvider(provider)) return name + " · 本地模型无需 Key";
      if (webCount > 0) return name + " · 有 " + webCount + " 个 Web Key";
      if (provider.keyCount > 0) return name + " · 有 " + provider.keyCount + " 个 env Key";
      return name + " · 未添加 Key";
    }

    async function createProvider() {
      let payload;
      try { payload = providerFormData(); }
      catch (error) { setProviderMessage("表单内容不正确：" + error.message, "bad"); return; }
      if (!payload.name || !payload.baseUrl) { setProviderMessage("Provider 名称和 Base URL 不能为空。", "bad"); return; }
      const result = await postJson("/admin/providers", payload);
      if (!result.ok) {
        setProviderMessage("新增失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      const nextStep = providerNeedsKey(result.data.provider)
        ? " 下一步：在 API Key 表单添加这个 provider 的真实 Key。"
        : " 本地 provider 不需要 keyEnv。";
      setProviderMessage("新增成功：" + result.data.provider.name + "。" + nextStep, "ok");
      scheduleSoftRefresh(500);
    }
    async function updateProvider() {
      let payload;
      try { payload = providerFormData(); }
      catch (error) { setProviderMessage("表单内容不正确：" + error.message, "bad"); return; }
      if (!payload.name) { setProviderMessage("请先填写或选择 Provider 名称。", "bad"); return; }
      const result = await patchJson("/admin/providers/" + encodeURIComponent(payload.name), payload);
      if (!result.ok) {
        setProviderMessage("保存失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setProviderMessage("保存成功：" + result.data.provider.name + "。", "ok");
      scheduleSoftRefresh(500);
    }
    async function deleteProvider(name) {
      if (!window.confirm("确认删除 Provider " + name + "？如果它被模型组、Profile 或 Web Key 使用，服务会拒绝删除。")) return;
      const result = await deleteJson("/admin/providers/" + encodeURIComponent(name));
      if (!result.ok) {
        setProviderMessage("删除失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)) + " " + JSON.stringify(result.data.references || []), "bad");
        return;
      }
      setProviderMessage("已删除 Provider：" + name + "。", "ok");
      scheduleSoftRefresh(500);
    }

    // ---- route form helpers (unchanged) ----
    function routeFormData() {
      const limitText = document.getElementById("route-limit").value.trim();
      const limits = limitText ? { dailyRequests: Number(limitText) } : {};
      return {
        name: document.getElementById("route-name").value.trim(),
        description: document.getElementById("route-description").value.trim(),
        strategy: document.getElementById("route-strategy").value,
        candidates: routeCandidatesFromRows(),
        limits
      };
    }
    function parseRouteCandidates(text) {
      return String(text || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line, index) => {
          const parts = line.includes("|")
            ? line.split("|").map((part) => part.trim())
            : line.split(/\s+/).map((part) => part.trim());
          const [provider, model, rawWeight] = parts;
          if (!provider || !model) throw new Error("候选第 " + (index + 1) + " 行需要 provider 和 model。");
          const weight = rawWeight ? Number(rawWeight) : 1;
          if (!Number.isFinite(weight) || weight < 1) throw new Error("候选第 " + (index + 1) + " 行 weight 必须是正整数。");
          return { provider, model, weight: Math.floor(weight) };
        });
    }
    function addRouteCandidateRow(candidate = {}) {
      const container = document.getElementById("route-candidate-rows");
      if (!container) return null;
      const row = document.createElement("div");
      row.className = "route-candidate-row field-row";
      row.style.marginTop = "6px";
      const providerSelect = document.createElement("select");
      const knownProviders = Array.isArray(providers) ? providers : [];
      const knownNames = knownProviders
        .map((p) => (p && typeof p.name === "string" ? p.name : ""))
        .filter(Boolean);
      const seen = new Set();
      const appendOption = (value, label) => {
        if (!value || seen.has(value)) return;
        seen.add(value);
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label || value;
        providerSelect.appendChild(opt);
      };
      knownNames.forEach((name) => appendOption(name, providerDisplayLabel(name)));
      if (candidate.provider) appendOption(candidate.provider, providerDisplayLabel(candidate.provider));
      if (seen.size === 0) {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "暂无可用 provider";
        providerSelect.appendChild(opt);
      }
      if (candidate.provider) providerSelect.value = candidate.provider;
      const modelInput = document.createElement("input");
      modelInput.type = "text";
      modelInput.placeholder = "模型名";
      modelInput.value = typeof candidate.model === "string" ? candidate.model : "";
      const weightInput = document.createElement("input");
      weightInput.type = "number";
      weightInput.min = "1";
      weightInput.step = "1";
      weightInput.placeholder = "weight";
      weightInput.value = candidate.weight != null && candidate.weight !== "" ? String(candidate.weight) : "1";
      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.textContent = "删除";
      removeBtn.addEventListener("click", () => {
        row.remove();
        syncRouteCandidatesTextarea();
      });
      [providerSelect, modelInput, weightInput].forEach((el) => {
        el.addEventListener("input", syncRouteCandidatesTextarea);
        el.addEventListener("change", syncRouteCandidatesTextarea);
      });
      row.appendChild(providerSelect);
      row.appendChild(modelInput);
      row.appendChild(weightInput);
      row.appendChild(removeBtn);
      container.appendChild(row);
      return row;
    }
    function syncRouteCandidatesTextarea() {
      const textarea = document.getElementById("route-candidates");
      if (!textarea) return;
      const items = routeCandidatesFromRows();
      textarea.value = items.map((item) => [item.provider, item.model, item.weight].join(" | ")).join("\n");
    }
    function routeCandidatesFromRows() {
      const container = document.getElementById("route-candidate-rows");
      if (!container) return [];
      const rows = Array.from(container.querySelectorAll(".route-candidate-row"));
      const result = [];
      rows.forEach((row, index) => {
        const selects = row.querySelectorAll("select");
        const textInputs = row.querySelectorAll('input[type="text"]');
        const numberInputs = row.querySelectorAll('input[type="number"]');
        const provider = (selects[0]?.value || "").trim();
        const model = (textInputs[0]?.value || "").trim();
        const weightText = (numberInputs[0]?.value || "").trim();
        if (!provider && !model && !weightText) return;
        if (!provider) throw new Error("候选第 " + (index + 1) + " 行缺少 provider。");
        if (!model) throw new Error("候选第 " + (index + 1) + " 行缺少 model。");
        const weight = weightText === "" ? 1 : Number(weightText);
        if (!Number.isFinite(weight) || !Number.isInteger(weight) || weight < 1) {
          throw new Error("候选第 " + (index + 1) + " 行 weight 必须是正整数。");
        }
        result.push({ provider, model, weight });
      });
      return result;
    }
    function clearRouteCandidateRows() {
      const container = document.getElementById("route-candidate-rows");
      if (container) container.innerHTML = "";
      syncRouteCandidatesTextarea();
    }
    function fillRouteForm(route) {
      document.getElementById("route-name").value = route.name || "";
      document.getElementById("route-description").value = route.description || "";
      document.getElementById("route-strategy").value = route.strategy || "fallback";
      document.getElementById("route-limit").value = route.limits?.dailyRequests || "";
      clearRouteCandidateRows();
      (Array.isArray(route.candidates) ? route.candidates : []).forEach((item) => {
        addRouteCandidateRow(item);
      });
      syncRouteCandidatesTextarea();
    }
    function clearRouteForm() {
      fillRouteForm({ strategy: "fallback", candidates: [] });
      document.getElementById("route-template").value = "";
      setRouteMessage("表单已清空。");
    }
    async function createRoute() {
      let payload;
      try { payload = routeFormData(); }
      catch (error) { setRouteMessage("表单内容不正确：" + error.message, "bad"); return; }
      if (!payload.name || payload.candidates.length === 0) { setRouteMessage("Route 名称和候选列表不能为空。", "bad"); return; }
      const result = await postJson("/admin/routes", payload);
      if (!result.ok) {
        setRouteMessage("新增失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setRouteMessage("新增成功：" + result.data.route.name + "。", "ok");
      scheduleSoftRefresh(500);
    }
    async function updateRoute() {
      let payload;
      try { payload = routeFormData(); }
      catch (error) { setRouteMessage("表单内容不正确：" + error.message, "bad"); return; }
      if (!payload.name) { setRouteMessage("请先填写或选择 Route 名称。", "bad"); return; }
      const result = await patchJson("/admin/routes/" + encodeURIComponent(payload.name), payload);
      if (!result.ok) {
        setRouteMessage("保存失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setRouteMessage("保存成功：" + result.data.route.name + "。", "ok");
      scheduleSoftRefresh(500);
    }
    async function deleteRoute(name) {
      if (!window.confirm("确认删除 Route " + name + "？如果它被 Profile 使用，服务会拒绝删除。")) return;
      const result = await deleteJson("/admin/routes/" + encodeURIComponent(name));
      if (!result.ok) {
        setRouteMessage("删除失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)) + " " + JSON.stringify(result.data.references || []), "bad");
        return;
      }
      setRouteMessage("已删除 Route：" + name + "。", "ok");
      scheduleSoftRefresh(500);
    }

    async function copyCommand(button) {
      const text = button.getAttribute("data-copy") || "";
      await navigator.clipboard.writeText(text);
      button.textContent = "已复制";
      button.classList.add("ok");
      window.setTimeout(() => {
        button.textContent = "复制";
        button.classList.remove("ok");
      }, 900);
    }
    async function addKey() {
      const provider = document.getElementById("add-key-provider").value;
      const value = document.getElementById("add-key-value").value.trim();
      const label = document.getElementById("add-key-label").value.trim();
      if (!provider) { setAddKeyMessage("请选择服务提供方。", "bad"); return; }
      if (!value) { setAddKeyMessage("请粘贴 API Key。", "bad"); return; }
      setAddKeyMessage("正在添加并加密保存…");
      const result = await postJson("/admin/keys", { provider, value, label });
      if (!result.ok) {
        setAddKeyMessage("添加失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      document.getElementById("add-key-value").value = "";
      setAddKeyMessage("添加成功：ID " + result.data.key.id + "，掩码 " + result.data.key.masked + "。", "ok");
      scheduleSoftRefresh(600);
    }
    async function addInlineProviderKey({ testAfter = false } = {}) {
      const provider = document.getElementById("provider-inline-key-name").value;
      const value = document.getElementById("provider-inline-key-value").value.trim();
      const label = document.getElementById("provider-inline-key-label").value.trim();
      if (!provider) { setProviderInlineKeyMessage("请选择 Provider。", "bad"); return; }
      if (!value) { setProviderInlineKeyMessage("请粘贴 API Key。", "bad"); return; }
      // Count current Web Keys for this provider BEFORE adding so we
      // can show "before -> after" in the success message. Web Keys
      // are stored in data/keys.enc.json, separate from the
      // provider config; saving the provider later will not touch
      // them.
      const beforeCount = (webKeys || []).filter(function (k) { return k.provider === provider && k.enabled; }).length;
      setProviderInlineKeyMessage("正在加密保存 Key...");
      const result = await postJson("/admin/providers/" + encodeURIComponent(provider) + "/keys", { value, label });
      if (!result.ok) {
        setProviderInlineKeyMessage("保存失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      document.getElementById("provider-inline-key-value").value = "";
      const newCount = beforeCount + 1;
      setProviderInlineKeyMessage("保存成功：ID " + result.data.key.id + "，掩码 " + result.data.key.masked + " · 该 Provider 现在共 " + newCount + " 个 Web Key。Web Key 独立加密保存，<strong>编辑 / 保存上方 Provider 配置不会影响它</strong>。", "ok");
      if (testAfter) {
        setProviderInlineKeyMessage("Key 已保存，正在做一次最小连通测试；云端 provider 可能消耗少量额度...", "warn");
        const test = await postJson("/admin/test-provider", { provider });
        setProviderInlineKeyMessage("Key 已保存。连通测试：" + JSON.stringify(test.data), test.ok ? "ok" : "bad");
      }
      scheduleSoftRefresh(testAfter ? 900 : 650);
    }
    async function testKey(id) {
      setAddKeyMessage("正在测试 Key " + id + "…");
      const result = await postJson("/admin/keys/" + encodeURIComponent(id) + "/test");
      if (!result.ok) {
        setAddKeyMessage("测试请求失败：" + (result.data?.message || result.data?.error || JSON.stringify(result.data)), "bad");
        return;
      }
      const ok = result.data?.result?.ok;
      setAddKeyMessage("测试 " + id + "：" + (ok ? "通过" : "失败") + "，" + JSON.stringify(result.data?.result || {}), ok ? "ok" : "bad");
      scheduleSoftRefresh(600);
    }
    async function toggleKey(id, targetEnabled) {
      setAddKeyMessage("正在更新 Key " + id + "…");
      const result = await patchJson("/admin/keys/" + encodeURIComponent(id), { enabled: targetEnabled });
      if (!result.ok) {
        setAddKeyMessage("更新失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setAddKeyMessage("已" + (targetEnabled ? "启用" : "停用") + " Key " + id + "。", "ok");
      scheduleSoftRefresh(400);
    }
    async function deleteKey(id, label) {
      if (!window.confirm("确认删除 Key " + label + "（ID " + id + "）？删除后该 Key 立刻从 Key 池中移除。")) return;
      setAddKeyMessage("正在删除 Key " + id + "…");
      const result = await deleteJson("/admin/keys/" + encodeURIComponent(id));
      if (!result.ok) {
        setAddKeyMessage("删除失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setAddKeyMessage("已删除 Key " + id + "。", "ok");
      scheduleSoftRefresh(400);
    }
    async function loadConfigEditor() {
      const result = await getJson("/admin/config/raw");
      if (!result.ok) throw new Error(result.data.message || result.data.error || "failed to load config");
      editor.value = JSON.stringify(result.data.config, null, 2);
      setMessage("已从 " + result.data.configPath + " 加载配置。");
    }
    async function saveConfigEditor() {
      let parsed;
      try { parsed = JSON.parse(editor.value); }
      catch (error) { setMessage("JSON 解析错误：" + error.message, "bad"); return; }
      const result = await postJson("/admin/config", { config: parsed });
      if (!result.ok) {
        setMessage("保存失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setMessage("保存成功。备份：" + (result.data.backupPath || "无"), "ok");
    }
    async function exportConfigFile() {
      const result = await getJson("/admin/config/export");
      if (!result.ok) throw new Error(result.data.message || result.data.error || "failed to export config");
      const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      const day = new Date().toISOString().slice(0, 10);
      link.href = URL.createObjectURL(blob);
      link.download = "openrelay-local-safe-config-" + day + ".json";
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage("已导出当前非密钥配置。", "ok");
    }
    async function importConfigFile(file) {
      if (!file) return;
      let parsed;
      try { parsed = JSON.parse(await file.text()); }
      catch (error) { setMessage("导入 JSON 解析错误：" + error.message, "bad"); return; }
      const candidate = parsed.config || parsed;
      const result = await postJson("/admin/config/import", { config: candidate });
      if (!result.ok) {
        setMessage("导入失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      editor.value = JSON.stringify(candidate, null, 2);
      setMessage("已导入。备份：" + (result.data.backupPath || "无"), "ok");
    }
    async function setProfile(profile) {
      setMessage("正在切换 Profile 到 " + profile + "…");
      const result = await postJson("/admin/profile", { profile });
      if (!result.ok) {
        setMessage("Profile 切换失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setMessage("当前 Profile：" + result.data.activeProfile + " → " + result.data.defaultModel, "ok");
      scheduleSoftRefresh(350);
    }
    async function testProvider(provider) {
      setMessage("正在测试 " + provider + "…");
      const result = await postJson("/admin/test-provider", { provider });
      setMessage(provider + " 测试：" + JSON.stringify(result.data), result.ok ? "ok" : "bad");
    }
    async function discoverProvider(provider) {
      setMessage("正在发现 " + provider + " 的模型…");
      const result = await postJson("/admin/discover-models", { provider });
      setMessage(provider + " 模型发现：" + JSON.stringify(result.data), result.ok ? "ok" : "bad");
      scheduleSoftRefresh(500);
    }
    async function checkBalance(provider) {
      setMessage("正在查询 " + provider + " 的余额…");
      const result = await postJson("/admin/balance", { provider });
      setMessage(provider + " 余额：" + JSON.stringify(result.data), result.ok ? "ok" : "bad");
      scheduleSoftRefresh(500);
    }
    async function updateProfile(originalName, profile) {
      const result = await postJson("/admin/profile/update", { originalName, profile });
      if (!result.ok) {
        setMessage("Profile 更新失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return false;
      }
      setMessage("Profile 已更新。备份：" + (result.data.backupPath || "无"), "ok");
      scheduleSoftRefresh(350);
      return true;
    }
    async function cloneProfile(originalName, newName) {
      const result = await postJson("/admin/profile/clone", { originalName, newName });
      if (!result.ok) {
        setMessage("Profile 克隆失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return false;
      }
      setMessage("已克隆为 " + newName + "。备份：" + (result.data.backupPath || "无"), "ok");
      scheduleSoftRefresh(350);
      return true;
    }
    async function deleteProfile(profile) {
      if (!window.confirm("确认删除 Profile " + profile + "？当前激活的 Profile 不能删除。")) return;
      const result = await postJson("/admin/profile/delete", { profile });
      if (!result.ok) {
        setMessage("Profile 删除失败：" + (result.data.message || result.data.error || JSON.stringify(result.data)), "bad");
        return;
      }
      setMessage("Profile 已删除。备份：" + (result.data.backupPath || "无"), "ok");
      scheduleSoftRefresh(350);
    }
    function openProfileModal({ name = "", description = "", defaultModel = "", originalName = null, title = "编辑 Profile" }) {
      const modal = document.getElementById("profile-modal");
      document.getElementById("profile-modal-title").textContent = title;
      document.getElementById("profile-modal-name").value = name;
      document.getElementById("profile-modal-description").value = description;
      document.getElementById("profile-modal-default").value = defaultModel;
      modal.classList.add("open");
      modal.dataset.originalName = originalName == null ? "" : originalName;
      modal.dataset.mode = originalName == null ? "new" : "edit";
      setTimeout(() => document.getElementById("profile-modal-name").focus(), 50);
    }
    function closeProfileModal() {
      const modal = document.getElementById("profile-modal");
      modal.classList.remove("open");
      modal.dataset.originalName = "";
      modal.dataset.mode = "";
    }
    document.getElementById("profile-modal-cancel").addEventListener("click", closeProfileModal);
    document.getElementById("profile-modal-save").addEventListener("click", async () => {
      const modal = document.getElementById("profile-modal");
      const name = document.getElementById("profile-modal-name").value.trim();
      const description = document.getElementById("profile-modal-description").value.trim();
      const defaultModel = document.getElementById("profile-modal-default").value.trim();
      if (!name || !defaultModel) { setMessage("Profile 名称和默认模型不能为空。", "bad"); return; }
      if (modal.dataset.mode === "edit") {
        const originalName = modal.dataset.originalName;
        if (!originalName) { setMessage("内部错误：缺少原始 Profile 名。", "bad"); return; }
        const ok = await updateProfile(originalName, { name, description, defaultModel });
        if (ok) closeProfileModal();
      } else {
        const ok = await updateProfile(null, { name, description, defaultModel });
        if (ok) closeProfileModal();
      }
    });
    document.getElementById("new-profile")?.addEventListener("click", () => {
      openProfileModal({ title: "新建 Profile", name: "", description: "", defaultModel: "" });
    });
    document.getElementById("add-key-submit")?.addEventListener("click", () => addKey().catch((error) => setAddKeyMessage(error.message, "bad")));
    document.getElementById("provider-inline-key-add")?.addEventListener("click", () => addInlineProviderKey().catch((error) => setProviderInlineKeyMessage(error.message, "bad")));
    document.getElementById("provider-inline-key-test")?.addEventListener("click", () => addInlineProviderKey({ testAfter: true }).catch((error) => setProviderInlineKeyMessage(error.message, "bad")));
    document.getElementById("provider-template")?.addEventListener("change", (event) => {
      const selected = providerTemplates.find((item) => item.name === event.target.value);
      if (selected) {
        fillProviderForm(selected);
        setProviderMessage("已套用模板：" + (selected.displayName || selected.name));
      }
    });
    document.getElementById("provider-create")?.addEventListener("click", () => createProvider().catch((error) => setProviderMessage(error.message, "bad")));
    // ---- discover models by URL + key (custom mode) or by saved Provider ----
    // The "discover-models-output" is a CHECKBOX list (not buttons):
    //   - each model is one checkbox, pre-checked if already in the
    //     form's "models" textarea
    //   - 全选 / 全不选 buttons + 替换 / 合并 buttons at the top
    // The provider can either paste Base URL + Key (custom) or pick
    // an already-configured Provider from a dropdown and let the
    // server use the provider's saved key (web or env) automatically.
    let lastDiscoverModels = [];
    async function runDiscover(payload, sourceLabel) {
      const out = document.getElementById("discover-models-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在请求 ' + escapeHtml(sourceLabel) + ' ...</div>';
      const result = await postJson("/admin/discover-models", payload);
      if (!result.ok) {
        const detail = (result.data && (result.data.message || result.data.error)) || JSON.stringify(result.data || {});
        out.innerHTML = '<div class="notice bad">发现失败：' + escapeHtml(String(detail)) + ' (status ' + escapeHtml(String(result.status)) + ')</div>';
        lastDiscoverModels = [];
        return;
      }
      const data = result.data || {};
      if (!data.count || data.count === 0) {
        out.innerHTML = '<div class="notice warn">返回 0 个模型。Base URL 可能是 Anthropic 原生接口（仅支持 chat）或其他非 OpenAI 兼容端点。</div>';
        lastDiscoverModels = [];
        return;
      }
      lastDiscoverModels = Array.isArray(data.models) ? data.models : [];
      renderDiscoverChecklist(data, sourceLabel);
    }
    function renderDiscoverChecklist(data, sourceLabel) {
      const out = document.getElementById("discover-models-output");
      if (!out) return;
      const textarea = document.getElementById("provider-models");
      const currentLines = String((textarea && textarea.value) || "")
        .split(/[\r\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
      const currentSet = {};
      for (const m of currentLines) currentSet[m] = true;
      const rows = (data.models || []).map(function (m) {
        const checked = currentSet[m] ? " checked" : "";
        return '<label class="discover-model-row" data-discover-model-row="' + escapeHtml(m) + '" style="display:flex;align-items:center;gap:6px;padding:3px 6px;border:1px solid var(--line);border-radius:4px;margin:2px 4px 2px 0;background:#fbfcfe;cursor:pointer;">'
          + '<input type="checkbox" data-discover-model-check="' + escapeHtml(m) + '"' + checked + ' style="margin:0;">'
          + '<code style="font-size:12px;">' + escapeHtml(m) + '</code>'
          + (currentSet[m] ? ' <span class="pill ok" style="font-size:9px;">已存在</span>' : "")
          + '</label>';
      }).join("");
      const elapsed = typeof data.elapsedMs === "number" ? data.elapsedMs + " ms" : "";
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;">通过 ' + escapeHtml(sourceLabel) + ' 发现 ' + escapeHtml(String(data.count)) + ' 个模型'
        + (elapsed ? '（耗时 ' + escapeHtml(elapsed) + '）' : '')
        + '。勾选要保留的模型：</div>'
        + '<div class="row-actions" style="margin-bottom:6px;">'
        + '<button type="button" class="small" data-discover-select-all>全选</button>'
        + '<button type="button" class="small" data-discover-select-none>全不选</button>'
        + '<button type="button" class="small" data-discover-select-invert>反选</button>'
        + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;max-height:240px;overflow:auto;padding:4px;border:1px solid var(--line);border-radius:6px;background:#fff;">' + rows + '</div>'
        + '<div class="row-actions" style="margin-top:8px;">'
        + '<button type="button" class="primary" data-discover-apply-replace>替换为选中（覆盖上方"模型"框）</button>'
        + '<button type="button" data-discover-apply-merge>合并到上方"模型"框（不删现有）</button>'
        + '</div>';
      out.querySelectorAll("[data-discover-model-check]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          const row = cb.closest("[data-discover-model-row]");
          if (row) row.style.background = cb.checked ? "#dbeafe" : "#fbfcfe";
        });
      });
      out.querySelector("[data-discover-select-all]")?.addEventListener("click", function () {
        out.querySelectorAll("[data-discover-model-check]").forEach(function (cb) { cb.checked = true; cb.dispatchEvent(new Event("change")); });
      });
      out.querySelector("[data-discover-select-none]")?.addEventListener("click", function () {
        out.querySelectorAll("[data-discover-model-check]").forEach(function (cb) { cb.checked = false; cb.dispatchEvent(new Event("change")); });
      });
      out.querySelector("[data-discover-select-invert]")?.addEventListener("click", function () {
        out.querySelectorAll("[data-discover-model-check]").forEach(function (cb) { cb.checked = !cb.checked; cb.dispatchEvent(new Event("change")); });
      });
      out.querySelector("[data-discover-apply-replace]")?.addEventListener("click", function () { applyDiscoverToTextarea(true); });
      out.querySelector("[data-discover-apply-merge]")?.addEventListener("click", function () { applyDiscoverToTextarea(false); });
    }
    function applyDiscoverToTextarea(replace) {
      const out = document.getElementById("discover-models-output");
      const textarea = document.getElementById("provider-models");
      if (!out || !textarea) return;
      const checked = Array.from(out.querySelectorAll("[data-discover-model-check]:checked")).map(function (cb) { return cb.getAttribute("data-discover-model-check"); }).filter(Boolean);
      if (replace) {
        textarea.value = checked.join("\n");
      } else {
        const current = String(textarea.value || "").split(/[\r\n,]+/).map(function (s) { return s.trim(); }).filter(Boolean);
        const seen = {};
        for (const m of current) seen[m] = true;
        const merged = current.slice();
        for (const m of checked) if (!seen[m]) { merged.push(m); seen[m] = true; }
        textarea.value = merged.join("\n");
      }
      setProviderMessage(replace
        ? ("已用 " + checked.length + " 个选中模型替换上方 '模型' 框（请记得点 '保存编辑'）。")
        : ("已合并 " + checked.length + " 个选中模型到上方 '模型' 框（保留原有 " + (textarea.value.split(/[\r\n,]+/).length - checked.length) + " 个）。"), "ok");
    }
    document.getElementById("discover-models-button")?.addEventListener("click", function () {
      const baseUrl = (document.getElementById("discover-base-url") || {}).value || "";
      const apiKey = (document.getElementById("discover-api-key") || {}).value || "";
      const trimmed = baseUrl.trim();
      if (!trimmed) { setProviderMessage("请填写 Base URL", "bad"); return; }
      runDiscover({ baseUrl: trimmed, apiKey: apiKey }, trimmed + "/models").catch(function (error) { setProviderMessage("发现失败：" + error.message, "bad"); });
    });
    document.getElementById("discover-models-prefill")?.addEventListener("click", function () {
      const baseUrl = document.getElementById("provider-base-url").value.trim();
      if (!baseUrl) { setProviderMessage("上方 Base URL 为空，无法预填。", "bad"); return; }
      const target = document.getElementById("discover-base-url");
      if (target) target.value = baseUrl;
      setProviderMessage("已把上方 Base URL 复制到发现框。", "ok");
    });
    document.getElementById("discover-models-from-provider")?.addEventListener("click", function () {
      const select = document.getElementById("discover-models-provider-select");
      if (!select) return;
      const providerName = select.value;
      if (!providerName) { setProviderMessage("请选择一个已配置的 Provider", "bad"); return; }
      const providerObj = providers.find(function (p) { return p.name === providerName; });
      const sourceLabel = providerObj ? (providerObj.displayName || providerObj.name) + " 的已保存 Key" : providerName;
      runDiscover({ provider: providerName }, sourceLabel + "（用 keyPool 里的 Key 调 /models）").catch(function (error) { setProviderMessage("发现失败：" + error.message, "bad"); });
    });
    document.getElementById("provider-update")?.addEventListener("click", () => updateProvider().catch((error) => setProviderMessage(error.message, "bad")));
    document.getElementById("provider-clear")?.addEventListener("click", clearProviderForm);
    document.getElementById("route-template")?.addEventListener("change", (event) => {
      const selected = routeTemplates.find((item) => item.name === event.target.value);
      if (selected) {
        fillRouteForm(selected);
        setRouteMessage("已套用模板：" + selected.name);
      }
    });
    document.getElementById("route-create")?.addEventListener("click", () => createRoute().catch((error) => setRouteMessage(error.message, "bad")));
    document.getElementById("route-update")?.addEventListener("click", () => updateRoute().catch((error) => setRouteMessage(error.message, "bad")));
    document.getElementById("route-clear")?.addEventListener("click", clearRouteForm);
    document.getElementById("route-add-candidate")?.addEventListener("click", () => {
      addRouteCandidateRow();
      syncRouteCandidatesTextarea();
    });
    document.getElementById("load-config")?.addEventListener("click", () => loadConfigEditor().catch((error) => setMessage(error.message, "bad")));
    document.getElementById("reload-config")?.addEventListener("click", () => loadConfigEditor().catch((error) => setMessage(error.message, "bad")));
    document.getElementById("save-config")?.addEventListener("click", () => saveConfigEditor().catch((error) => setMessage(error.message, "bad")));
    document.getElementById("export-config")?.addEventListener("click", () => exportConfigFile().catch((error) => setMessage(error.message, "bad")));
    document.getElementById("import-config")?.addEventListener("click", () => document.getElementById("import-config-file")?.click());
    document.getElementById("import-config-file")?.addEventListener("change", (event) => {
      importConfigFile(event.target.files[0]).catch((error) => setMessage(error.message, "bad"));
      event.target.value = "";
    });
    document.querySelectorAll("[data-set-profile]").forEach((button) => {
      button.addEventListener("click", () => setProfile(button.getAttribute("data-set-profile")));
    });
    document.querySelectorAll("[data-test-provider]").forEach((button) => {
      button.addEventListener("click", () => testProvider(button.getAttribute("data-test-provider")));
    });
    document.querySelectorAll("[data-discover-provider]").forEach((button) => {
      button.addEventListener("click", () => discoverProvider(button.getAttribute("data-discover-provider")));
    });
    document.querySelectorAll("[data-check-balance]").forEach((button) => {
      button.addEventListener("click", () => checkBalance(button.getAttribute("data-check-balance")));
    });
    document.querySelectorAll("[data-edit-provider]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-edit-provider");
        const provider = providers.find((item) => item.name === name);
        if (provider) {
          fillProviderForm(provider);
          setProviderMessage("正在编辑 Provider：" + name);
          const form = document.getElementById("provider-form-card");
          if (form && !form.open) form.open = true;
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    document.querySelectorAll("[data-delete-provider]").forEach((button) => {
      button.addEventListener("click", () => deleteProvider(button.getAttribute("data-delete-provider")));
    });
    document.querySelectorAll("[data-add-key-provider]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-add-key-provider");
        document.getElementById("add-key-provider").value = name;
        document.getElementById("provider-inline-key-name").value = name;
        setAddKeyMessage("已选择 Provider：" + name + "。可以在这里粘贴真实 API Key。");
        setProviderInlineKeyMessage("已选择 Provider：" + name + "。Key 会加密保存，不会写入 config.json。");
        const form = document.getElementById("provider-form-card");
        if (form && !form.open) form.open = true;
        setTimeout(() => document.getElementById("provider-inline-key-value").focus(), 250);
      });
    });
    document.querySelectorAll("[data-edit-route]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-edit-route");
        const route = routes.find((item) => item.name === name);
        if (route) {
          fillRouteForm(route);
          setRouteMessage("正在编辑 Route：" + name);
          const form = document.getElementById("route-form-card");
          if (form && !form.open) form.open = true;
          form.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    document.querySelectorAll("[data-delete-route]").forEach((button) => {
      button.addEventListener("click", () => deleteRoute(button.getAttribute("data-delete-route")));
    });
    document.querySelectorAll("[data-copy]").forEach((button) => {
      button.addEventListener("click", () => copyCommand(button).catch((error) => setMessage("复制失败：" + error.message, "bad")));
    });
    document.querySelectorAll("[data-test-key]").forEach((button) => {
      button.addEventListener("click", () => testKey(button.getAttribute("data-test-key")));
    });
    document.querySelectorAll("[data-toggle-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-toggle-key");
        const target = button.getAttribute("data-target-enabled") === "true";
        toggleKey(id, target);
      });
    });
    document.querySelectorAll("[data-delete-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.getAttribute("data-delete-key");
        const label = button.getAttribute("data-label") || id;
        deleteKey(id, label);
      });
    });
    document.querySelectorAll("[data-edit-profile]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.getAttribute("data-edit-profile");
        const row = button.closest("tr");
        const description = row ? row.querySelectorAll("td")[0].querySelector(".muted")?.textContent || "" : "";
        const defaultModel = row ? row.querySelectorAll("td")[1].querySelector("code")?.textContent || "" : "";
        openProfileModal({ name, description, defaultModel, originalName: name, title: "编辑 Profile " + name });
      });
    });
    document.querySelectorAll("[data-clone-profile]").forEach((button) => {
      button.addEventListener("click", async () => {
        const name = button.getAttribute("data-clone-profile");
        const newName = window.prompt("把 " + name + " 克隆成什么名字？", name + "-copy");
        if (!newName) return;
        await cloneProfile(name, newName.trim());
      });
    });
    document.querySelectorAll("[data-delete-profile]").forEach((button) => {
      button.addEventListener("click", () => deleteProfile(button.getAttribute("data-delete-profile")));
    });
    // ---- provider test preview (0.3.7: dry-run only, no live mode) ----
    function renderProviderTestPreviewResult(data) {
      const out = document.getElementById("provider-test-preview-output");
      if (!out) return;
      if (!data || data.error) {
        out.innerHTML = '<div class="notice bad">预览失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      const s = data.summary || {};
      const summaryParts = [];
      if (s.ok !== undefined) summaryParts.push('<span class="pill ok">' + s.ok + ' 正常</span>');
      if (s.warning !== undefined) summaryParts.push('<span class="pill warn">' + s.warning + ' 警告</span>');
      if (s.error !== undefined) summaryParts.push('<span class="pill bad">' + s.error + ' 错误</span>');
      const summaryHtml = summaryParts.length > 0 ? '<div class="stack" style="margin-bottom:8px;">' + summaryParts.join(" ") + '</div>' : "";
      const rows = (data.providers || []).map(function (p) {
        const statusPill = p.status === "ok"
          ? '<span class="pill ok">正常</span>'
          : p.status === "warning"
            ? '<span class="pill warn">警告</span>'
            : '<span class="pill bad">错误</span>';
        const localTag = p.local ? '<span class="pill local">本地</span>' : '<span class="pill cloud">云端</span>';
        const issueList = (p.issues || []).length > 0
          ? '<div class="muted" style="font-size:11px;margin-top:2px;">' + p.issues.map(function (i) { return '<span class="pill muted-pill" style="font-size:10px;">' + escapeHtml(String(i)) + '</span>'; }).join(" ") + '</div>'
          : "";
        return '<tr>'
          + '<td><strong>' + escapeHtml(p.displayName || p.name) + '</strong></td>'
          + '<td>' + localTag + '</td>'
          + '<td>' + statusPill + '</td>'
          + '<td><span class="pill">' + escapeHtml(p.apiFormat) + '</span></td>'
          + '<td>' + (p.hasBaseUrl ? '<span class="mono" style="font-size:11px;">' + escapeHtml(p.baseUrl || "") + '</span>' : '<span class="muted">缺失 URL</span>') + '</td>'
          + '<td>' + (p.hasKey ? '<span class="pill ok">有 Key</span>' : '<span class="pill bad">缺 Key</span>') + issueList + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">配置健康预览（dry-run）已完成。不调用上游、不消耗额度、不写运行时状态。</div>'
        + summaryHtml
        + '<div class="scroll-x"><table>'
        + '<thead><tr><th>Provider</th><th>本地/云端</th><th>配置状态</th><th>格式</th><th>Base URL</th><th>Key</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="6" class="muted">没有 Provider 数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runProviderTestPreview(localOnly) {
      const out = document.getElementById("provider-test-preview-output");
      if (!out) return;
      const params = localOnly ? "?localOnly=true" : "";
      out.innerHTML = '<div class="muted">正在运行配置健康预览（dry-run）…</div>';
      const result = await getJson("/admin/provider-test-preview" + params);
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">预览失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderProviderTestPreviewResult(result.data);
    }
    document.getElementById("provider-test-preview-all")?.addEventListener("click", function () { runProviderTestPreview(false); });
    document.getElementById("provider-test-preview-local")?.addEventListener("click", function () { runProviderTestPreview(true); });

    // ---- Provider template parity (0.3.19: dry-run catalog coverage audit) ----
    function renderProviderTemplateParityResult(data) {
      const out = document.getElementById("provider-template-parity-output");
      if (!out) return;
      if (!data || data.error) {
        out.innerHTML = '<div class="notice bad">模板覆盖审计失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      const s = data.summary || {};
      const targets = data.upstreamTargets || {};
      const safety = data.safety || {};
      const summaryHtml = [
        '<span class="pill">模板总数：' + escapeHtml(String(s.totalTemplates ?? 0)) + '</span>',
        '<span class="pill">直连 API：' + escapeHtml(String(s.apiTemplates ?? 0)) + '</span>',
        '<span class="pill local">本地端点：' + escapeHtml(String(s.localTemplates ?? 0)) + '</span>',
        '<span class="pill ok">配置可直接使用：' + escapeHtml(String(s.configReadyTemplates ?? 0)) + '</span>',
        '<span class="pill warn">需替换 URL：' + escapeHtml(String(s.templateOnly ?? 0)) + '</span>',
        '<span class="pill muted-pill">当前已配置：' + escapeHtml(String(s.configuredTemplates ?? 0)) + '</span>',
        '<span class="pill muted-pill">公开信息缺口：' + escapeHtml(String(s.publicInfoGaps ?? 0)) + '</span>',
        '<span class="pill muted-pill">目标 34：' + (s.apiLocalTargetCovered ? "已覆盖" : "未覆盖") + '</span>',
        '<span class="pill muted-pill">34+11=' + escapeHtml(String(targets.nonVirtualProviders || 45)) + '：' + escapeHtml(String(s.nonVirtualWithLocalConnectors ?? 0)) + '</span>'
      ].join(" ");
      const safetyHtml = [
        "readsCredentials", "readsTokens", "readsLocalPaths", "writesConfig",
        "storesKeys", "startsProcesses", "makesNetworkRequests", "registersRoutes"
      ].map(function (key) {
        return '<span class="pill ' + (safety[key] ? "bad" : "ok") + '">' + escapeHtml(key) + ': ' + String(!!safety[key]) + '</span>';
      }).join(" ");
      const gapRows = (data.publicInfoGaps || []).map(function (gap) {
        return '<tr><td><code>' + escapeHtml(gap.name) + '</code></td><td>' + escapeHtml(gap.reason || "") + '</td></tr>';
      }).join("");
      const rows = (data.providers || []).map(function (p) {
        return '<tr>'
          + '<td><strong>' + escapeHtml(p.displayName || p.name) + '</strong><div class="muted mono">' + escapeHtml(p.name) + '</div></td>'
          + '<td><span class="pill ' + (p.local ? "local" : "cloud") + '">' + escapeHtml(p.parityRole || "") + '</span></td>'
          + '<td><span class="pill">' + escapeHtml(p.apiFormat || "") + '</span></td>'
          + '<td>' + (p.keyEnv ? '<code>' + escapeHtml(p.keyEnv) + '</code>' : '<span class="muted">无需 Key</span>') + '</td>'
          + '<td>' + (p.configReady ? '<span class="pill ok">可直接配置</span>' : '<span class="pill warn">模板占位</span>') + '<div class="muted">' + escapeHtml(p.baseUrlKind || "") + '</div></td>'
          + '<td>' + (p.configured ? '<span class="pill ok">已配置</span>' : '<span class="pill muted-pill">未配置</span>') + '</td>'
          + '<td>' + (p.notes || []).map(function (note) { return '<span class="pill muted-pill">' + escapeHtml(note) + '</span>'; }).join(" ") + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">Provider 模板覆盖审计完成（dry-run）。不写配置、不保存 Key、不访问网络。</div>'
        + '<div class="stack" style="margin-bottom:8px;">' + summaryHtml + '</div>'
        + '<div class="stack" style="margin-bottom:8px;">' + safetyHtml + '</div>'
        + '<details class="advanced-block" style="margin-bottom:8px;"><summary>公开信息仍不足的候选 Provider</summary>'
        + '<div class="scroll-x"><table><thead><tr><th>Provider</th><th>原因</th></tr></thead><tbody>' + (gapRows || '<tr><td colspan="2" class="muted">无</td></tr>') + '</tbody></table></div></details>'
        + '<div class="scroll-x"><table>'
        + '<thead><tr><th>模板</th><th>角色</th><th>格式</th><th>Key 环境变量</th><th>配置状态</th><th>当前配置</th><th>备注</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="7" class="muted">没有模板数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runProviderTemplateParity() {
      const out = document.getElementById("provider-template-parity-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在检查 Provider 模板覆盖（dry-run）…</div>';
      const result = await getJson("/admin/provider-template-parity");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">模板覆盖审计失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderProviderTemplateParityResult(result.data);
    }
    document.getElementById("provider-template-parity-check")?.addEventListener("click", function () { runProviderTemplateParity().catch(function (error) { var s = document.getElementById("provider-template-parity-output"); if (s) { s.innerHTML = '<div class="notice bad">模板覆盖审计失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("provider-template-parity-refresh")?.addEventListener("click", function () { runProviderTemplateParity().catch(function (error) { var s = document.getElementById("provider-template-parity-output"); if (s) { s.innerHTML = '<div class="notice bad">模板覆盖审计失败：' + escapeHtml(error.message) + "</div>"; } }); });

    // ---- Provider template import plan (0.3.20: controlled config import) ----
    function renderProviderTemplateImportPlanResult(data) {
      const out = document.getElementById("provider-template-import-output");
      if (!out) return;
      if (!data || data.error) {
        out.innerHTML = '<div class="notice bad">导入计划失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      const s = data.summary || {};
      const safety = data.safety || {};
      const summaryHtml = [
        '<span class="pill">模板总数：' + escapeHtml(String(s.totalTemplates ?? 0)) + '</span>',
        '<span class="pill muted-pill">已配置：' + escapeHtml(String(s.configuredTemplates ?? 0)) + '</span>',
        '<span class="pill ok">可导入：' + escapeHtml(String(s.importableTemplates ?? 0)) + '</span>',
        '<span class="pill warn">跳过：' + escapeHtml(String(s.skippedTemplates ?? 0)) + '</span>',
        '<span class="pill muted-pill">导入后 Provider：' + escapeHtml(String(s.resultingProviderCount ?? 0)) + '</span>',
        '<span class="pill muted-pill">确认字符串：' + escapeHtml(data.requiredConfirmation || "") + '</span>'
      ].join(" ");
      const safetyHtml = [
        "readsCredentials", "storesKeys", "makesNetworkRequests", "registersRoutes", "writesConfig"
      ].map(function (key) {
        return '<span class="pill ' + (safety[key] ? "bad" : "ok") + '">' + escapeHtml(key) + ': ' + String(!!safety[key]) + '</span>';
      }).join(" ");
      const importRows = (data.importable || []).map(function (item) {
        return '<tr>'
          + '<td><strong>' + escapeHtml(item.displayName || item.name) + '</strong><div class="muted mono">' + escapeHtml(item.name) + '</div></td>'
          + '<td><span class="pill ' + (item.local ? "local" : "cloud") + '">' + (item.local ? "本地端点" : "直连 API") + '</span></td>'
          + '<td><span class="pill">' + escapeHtml(item.apiFormat || "") + '</span></td>'
          + '<td>' + (item.keyEnv ? '<code>' + escapeHtml(item.keyEnv) + '</code>' : '<span class="muted">无需 Key</span>') + '</td>'
          + '<td><span class="pill ok">' + escapeHtml(item.reason || "") + '</span></td>'
          + '</tr>';
      }).join("");
      const skippedRows = (data.skipped || []).slice(0, 80).map(function (item) {
        return '<tr><td><code>' + escapeHtml(item.name || "—") + '</code></td><td>' + escapeHtml(item.reason || "") + '</td><td>' + escapeHtml(item.baseUrlKind || "") + '</td></tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">导入计划已生成。只有点击"确认导入缺失模板"并输入确认字符串后，才会写入 config.json。</div>'
        + '<div class="stack" style="margin-bottom:8px;">' + summaryHtml + '</div>'
        + '<div class="stack" style="margin-bottom:8px;">' + safetyHtml + '</div>'
        + '<div class="scroll-x"><table><thead><tr><th>可导入模板</th><th>角色</th><th>格式</th><th>Key 环境变量</th><th>原因</th></tr></thead><tbody>'
        + (importRows || '<tr><td colspan="5" class="muted">没有可导入模板。</td></tr>')
        + '</tbody></table></div>'
        + '<details class="advanced-block" style="margin-top:8px;"><summary>跳过的模板</summary>'
        + '<div class="scroll-x"><table><thead><tr><th>模板</th><th>跳过原因</th><th>Base URL 类型</th></tr></thead><tbody>'
        + (skippedRows || '<tr><td colspan="3" class="muted">无</td></tr>')
        + '</tbody></table></div></details>';
    }
    async function runProviderTemplateImportPlan() {
      const out = document.getElementById("provider-template-import-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在生成 Provider 模板导入计划…</div>';
      const result = await getJson("/admin/provider-template-import-plan");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">导入计划失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return null;
      }
      renderProviderTemplateImportPlanResult(result.data);
      return result.data;
    }
    async function applyProviderTemplateImport() {
      const out = document.getElementById("provider-template-import-output");
      const confirmation = "ADD_MISSING_PROVIDER_TEMPLATES";
      const typed = window.prompt("此操作会把缺失且可直接配置的 Provider 模板写入 config.json；不会保存 API Key。请输入确认字符串：", confirmation);
      if (typed !== confirmation) {
        if (out) out.innerHTML = '<div class="notice warn">已取消：确认字符串不匹配。</div>';
        return;
      }
      if (out) out.innerHTML = '<div class="muted">正在导入缺失 Provider 模板…</div>';
      const result = await postJson("/admin/provider-template-import", { apply: true, confirm: confirmation });
      if (!result.ok) {
        if (out) out.innerHTML = '<div class="notice bad">导入失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      if (out) {
        out.innerHTML = '<div class="notice ok">导入完成：新增 ' + escapeHtml(String(result.data.imported || 0)) + ' 个 Provider 模板。页面将刷新以读取最新配置。</div>';
      }
      setTimeout(softRefresh, 800);
    }
    document.getElementById("provider-template-import-plan")?.addEventListener("click", function () { runProviderTemplateImportPlan().catch(function (error) { var s = document.getElementById("provider-template-import-output"); if (s) { s.innerHTML = '<div class="notice bad">导入计划失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("provider-template-import-apply")?.addEventListener("click", function () { applyProviderTemplateImport().catch(function (error) { var s = document.getElementById("provider-template-import-output"); if (s) { s.innerHTML = '<div class="notice bad">导入失败：' + escapeHtml(error.message) + "</div>"; } }); });

    // ---- IDE proxy runtime status (0.3.12: read-only status skeleton) ----
    async function runIdeProxyStatus() {
      const display = document.getElementById("ide-status-display");
      if (!display) return;
      const modelSelect = document.getElementById("ide-preview-model");
      const model = modelSelect ? modelSelect.value : "";
      const query = model ? "?model=" + encodeURIComponent(model) : "";
      display.textContent = "获取中…";
      display.className = "muted";
      const result = await getJson("/admin/ide-proxy-status" + query);
      if (!result.ok) {
        display.textContent = "获取状态失败：" + (result.data.error || result.data.message || "未知错误");
        display.className = "notice bad";
        return;
      }
      const data = result.data;
      const summary = data.summary || {};
      const totalEl = document.getElementById("ide-summary-total");
      const runningEl = document.getElementById("ide-summary-running");
      const stoppedEl = document.getElementById("ide-summary-stopped");
      const modePill = document.getElementById("ide-mode-pill");
      const verEl = document.getElementById("ide-status-version");
      const summaryPanel = document.getElementById("ide-status-summary");
      if (totalEl) totalEl.textContent = String(summary.total || 0);
      if (runningEl) runningEl.textContent = String(summary.running || 0);
      if (stoppedEl) stoppedEl.textContent = String(summary.stopped || 0);
      if (modePill) modePill.textContent = data.mode || "dry-run";
      if (verEl) verEl.textContent = "version: " + (data.version || "—");
      if (summaryPanel) summaryPanel.style.display = "block";
      (data.proxies || []).forEach(function (proxy) {
        const statusEl = document.getElementById("ide-proxy-status-" + proxy.id);
        if (statusEl) {
          statusEl.innerHTML = "Status: <strong>" + proxy.status + "</strong> · Phase: <strong>" + proxy.phase + "</strong>";
        }
      });
      display.textContent = "状态已更新 (" + data.mode + ", v" + (data.version || "—") + ")";
      display.className = "notice ok";
    }
    document.getElementById("ide-status-refresh")?.addEventListener("click", function () { runIdeProxyStatus().catch(function (error) { var s = document.getElementById("ide-status-display"); if (s) { s.textContent = "获取状态失败：" + error.message; s.className = "notice bad"; } }); });

    // ---- IDE proxy port readiness (0.3.13: read-only loopback check) ----
    async function runIdeProxyPortCheck() {
      const display = document.getElementById("ide-port-check-display");
      if (!display) return;
      const modelSelect = document.getElementById("ide-preview-model");
      const model = modelSelect ? modelSelect.value : "";
      const query = model ? "?model=" + encodeURIComponent(model) : "";
      display.textContent = "检查中...";
      display.className = "muted";
      const result = await getJson("/admin/ide-proxy-port-check" + query);
      if (!result.ok) {
        display.textContent = "端口检查失败：" + (result.data.error || result.data.message || "未知错误");
        display.className = "notice bad";
        return;
      }
      const data = result.data;
      const summary = data.summary || {};
      const totalEl = document.getElementById("ide-port-total");
      const availableEl = document.getElementById("ide-port-available");
      const occupiedEl = document.getElementById("ide-port-occupied");
      const unknownEl = document.getElementById("ide-port-unknown");
      const modePill = document.getElementById("ide-port-mode-pill");
      const verEl = document.getElementById("ide-port-version");
      const summaryPanel = document.getElementById("ide-port-check-summary");
      if (totalEl) totalEl.textContent = String(summary.total || 0);
      if (availableEl) availableEl.textContent = String(summary.available || 0);
      if (occupiedEl) occupiedEl.textContent = String(summary.occupied || 0);
      if (unknownEl) unknownEl.textContent = String(summary.unknown || 0);
      if (modePill) modePill.textContent = data.mode || "dry-run";
      if (verEl) verEl.textContent = "version: " + (data.version || "-") + " · timeout: " + (data.timeoutMs || "-") + "ms";
      if (summaryPanel) summaryPanel.style.display = "block";
      (data.proxies || []).forEach(function (proxy) {
        const portEl = document.getElementById("ide-proxy-port-" + proxy.id);
        if (portEl) {
          portEl.textContent = "Port: " + proxy.host + ":" + proxy.port + " · " + proxy.portStatus + " · " + proxy.reason;
        }
      });
      display.textContent = "端口检查已完成 (" + (summary.available || 0) + " available, " + (summary.occupied || 0) + " occupied)";
      display.className = (summary.occupied || summary.unknown) ? "notice warn" : "notice ok";
    }
    document.getElementById("ide-port-check")?.addEventListener("click", function () { runIdeProxyPortCheck().catch(function (error) { var s = document.getElementById("ide-port-check-display"); if (s) { s.textContent = "端口检查失败：" + error.message; s.className = "notice bad"; } }); });

    // ---- IDE proxy start plan (0.3.14: dry-run only, no listener startup) ----
    async function runIdeProxyStartPlan() {
      const display = document.getElementById("ide-start-plan-display");
      if (!display) return;
      const modelSelect = document.getElementById("ide-preview-model");
      const model = modelSelect ? modelSelect.value : "";
      const query = model ? "?model=" + encodeURIComponent(model) : "";
      display.textContent = "生成计划中...";
      display.className = "muted";
      const result = await getJson("/admin/ide-proxy-start-plan" + query);
      if (!result.ok) {
        display.textContent = "启动计划生成失败：" + (result.data.error || result.data.message || "未知错误");
        display.className = "notice bad";
        return;
      }
      const data = result.data;
      const summary = data.summary || {};
      const totalEl = document.getElementById("ide-plan-total");
      const readyEl = document.getElementById("ide-plan-ready");
      const blockedEl = document.getElementById("ide-plan-blocked");
      const reviewEl = document.getElementById("ide-plan-review");
      const modeEl = document.getElementById("ide-start-plan-mode");
      const panel = document.getElementById("ide-start-plan-summary");
      const output = document.getElementById("ide-start-plan-output");
      if (totalEl) totalEl.textContent = String(summary.total || 0);
      if (readyEl) readyEl.textContent = String(summary.ready || 0);
      if (blockedEl) blockedEl.textContent = String(summary.blocked || 0);
      if (reviewEl) reviewEl.textContent = String(summary.needsReview || 0);
      if (modeEl) modeEl.textContent = data.mode || "dry-run";
      if (panel) panel.style.display = "block";
      if (output) {
        output.textContent = (data.proxies || []).map(function (proxy) {
          const blockers = proxy.blockers && proxy.blockers.length ? " blockers: " + proxy.blockers.join("; ") : "";
          return proxy.name + " [" + proxy.readiness + "] " + proxy.listenUrl + "\n  " + proxy.dryRunCommand + blockers;
        }).join("\n\n");
      }
      display.textContent = "启动计划已生成 (" + (summary.ready || 0) + " ready, " + (summary.blocked || 0) + " blocked)";
      display.className = (summary.blocked || summary.needsReview || summary.notChecked) ? "notice warn" : "notice ok";
    }
    document.getElementById("ide-start-plan")?.addEventListener("click", function () { runIdeProxyStartPlan().catch(function (error) { var s = document.getElementById("ide-start-plan-display"); if (s) { s.textContent = "启动计划生成失败：" + error.message; s.className = "notice bad"; } }); });

    // ---- IDE proxy preview (0.3.10: read-only API preview) ----
    async function runIdeProxyPreview() {
      const out = document.getElementById("ide-preview-status");
      if (!out) return;
      const modelSelect = document.getElementById("ide-preview-model");
      const model = modelSelect ? modelSelect.value : "";
      const query = model ? "?model=" + encodeURIComponent(model) : "";
      out.textContent = "正在获取预览信息…";
      out.className = "muted";
      const result = await getJson("/admin/ide-proxy-preview" + query);
      if (!result.ok) {
        out.textContent = "预览失败：" + (result.data.message || result.data.error || "未知错误");
        out.className = "notice bad";
        return;
      }
      const data = result.data;
      out.textContent = "预览已更新 (mode: " + data.mode + ", version: " + data.version + ", model: " + data.selectedModel + ")";
      out.className = "notice ok";
      // Fill each proxy card with preview data
      (data.proxies || []).forEach(function (proxy) {
        var pre = document.getElementById("ide-preview-" + proxy.id);
        if (pre) {
          pre.textContent = JSON.stringify({ listenUrl: proxy.listenUrl, relayUrl: proxy.relayUrl, status: proxy.status, selectedModel: proxy.selectedModel, notes: proxy.notes }, null, 2);
        }
        var output = document.querySelector("[data-ide-preview-output=\"" + proxy.id + "\"]");
        if (output) {
          output.style.display = "block";
        }
      });
    }
    document.getElementById("ide-preview-refresh")?.addEventListener("click", function () { runIdeProxyPreview().catch(function (error) { var s = document.getElementById("ide-preview-status"); if (s) { s.textContent = "预览失败：" + error.message; s.className = "notice bad"; } }); });
    // ---- local connector plan (0.3.15: dry-run only) ----
    function renderConnectorPlanResult(data) {
      const out = document.getElementById("local-connector-plan-output");
      if (!out) return;
      if (!data || !data.ok) {
        out.innerHTML = '<div class="notice bad">连接器计划失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      const s = data.summary || {};
      const platform = data.platform || "—";
      const safety = data.safety || {};
      const platformPill = '<span class="pill">平台：' + escapeHtml(platform === "windows" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform) + '</span>';
      const summaryPills = [
        platformPill,
        '<span class="pill">总计：' + s.total + '</span>',
        '<span class="pill ok">已计划：' + s.planned + '</span>',
        '<span class="pill" style="background:var(--line);">已实现：' + s.implemented + '</span>',
        '<span class="pill muted-pill">凭据读取：' + s.credentialReads + '</span>',
        '<span class="pill muted-pill">配置写入：' + s.configWrites + '</span>'
      ].join(" ");
      const rows = (data.connectors || []).map(function (c) {
        const available = c.availableOnSelectedPlatform
          ? '<span class="pill ok">可用</span>'
          : '<span class="pill muted-pill">不可用</span>';
        const statusPill = c.localStatus === "implemented"
          ? '<span class="pill ok">已实现</span>'
          : '<span class="pill warn">' + escapeHtml(c.localStatus) + '</span>';
        const safe = c.safety || {};
        const flags = [];
        if (safe.readsTokens) flags.push('<span class="pill bad">读 Token</span>');
        if (safe.readsCookies) flags.push('<span class="pill bad">读 Cookie</span>');
        if (safe.readsIdeCredentials) flags.push('<span class="pill bad">读 IDE 凭据</span>');
        if (safe.modifiesConfig) flags.push('<span class="pill bad">改配置</span>');
        if (safe.writesSystemEnv) flags.push('<span class="pill bad">写系统环境</span>');
        if (safe.startsNetworkListener) flags.push('<span class="pill bad">启动监听</span>');
        if (flags.length === 0) flags.push('<span class="pill ok">安全</span>');
        return '<tr>'
          + '<td><strong>' + escapeHtml(c.name) + '</strong></td>'
          + '<td><span class="pill">' + escapeHtml(c.kind) + '</span></td>'
          + '<td>' + statusPill + '</td>'
          + '<td>' + available + '</td>'
          + '<td style="font-size:11px;">' + flags.join(" ") + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">连接器发现计划（dry-run）已生成。不读取 Token / Cookie / 会话 / IDE 凭据，不写配置。</div>'
        + summaryPills
        + '<div class="scroll-x" style="margin-top:8px;"><table>'
        + '<thead><tr><th>连接器</th><th>类型</th><th>状态</th><th>当前平台可用</th><th>安全状态</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="5" class="muted">没有连接器数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runLocalConnectorPlan() {
      const out = document.getElementById("local-connector-plan-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在生成连接器计划（dry-run）…</div>';
      const result = await getJson("/admin/local-connector-plan");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">连接器计划请求失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorPlanResult(result.data);
    }
    document.getElementById("local-connector-plan-build")?.addEventListener("click", function () { runLocalConnectorPlan().catch(function (error) { var s = document.getElementById("local-connector-plan-output"); if (s) { s.innerHTML = '<div class="notice bad">连接器计划执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-plan-refresh")?.addEventListener("click", function () { runLocalConnectorPlan().catch(function (error) { var s = document.getElementById("local-connector-plan-output"); if (s) { s.innerHTML = '<div class="notice bad">连接器计划执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    // ---- local connector availability (0.3.16: dry-run only) ----
    function renderConnectorAvailabilityResult(data) {
      const out = document.getElementById("local-connector-availability-output");
      if (!out) return;
      if (!data || !data.ok) {
        out.innerHTML = '<div class="notice bad">连接器可用性检查失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      const s = data.summary || {};
      const platform = data.platform || "—";
      const platformPill = '<span class="pill">平台：' + escapeHtml(platform === "windows" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform) + '</span>';
      const summaryPills = [
        platformPill,
        '<span class="pill ok">可用：' + s.available + '</span>',
        '<span class="pill warn">未找到：' + s.notFound + '</span>',
        '<span class="pill muted-pill">不支持：' + s.unsupportedPlatform + '</span>',
        '<span class="pill">未知：' + s.unknown + '</span>',
        '<span class="pill muted-pill">凭据读取：' + s.credentialReads + '</span>',
        '<span class="pill muted-pill">路径泄露：' + s.pathsDisclosed + '</span>',
        '<span class="pill muted-pill">进程启动：' + s.processesStarted + '</span>'
      ].join(" ");
      const rows = (data.connectors || []).map(function (c) {
        var availPill = "";
        if (c.availability === "available") availPill = '<span class="pill ok">可用</span>';
        else if (c.availability === "not_found") availPill = '<span class="pill warn">未找到</span>';
        else if (c.availability === "unsupported_platform") availPill = '<span class="pill muted-pill">不支持</span>';
        else availPill = '<span class="pill">未知</span>';
        var evidenceStr = (c.evidence || []).join(", ");
        var safe = c.safety || {};
        var flags = [];
        if (safe.readsTokens) flags.push('<span class="pill bad">读 Token</span>');
        if (safe.readsCookies) flags.push('<span class="pill bad">读 Cookie</span>');
        if (safe.readsIdeCredentials) flags.push('<span class="pill bad">读 IDE 凭据</span>');
        if (safe.modifiesConfig) flags.push('<span class="pill bad">改配置</span>');
        if (safe.writesSystemEnv) flags.push('<span class="pill bad">写系统环境</span>');
        if (safe.startsNetworkListener) flags.push('<span class="pill bad">启动监听</span>');
        if (safe.startsProcess) flags.push('<span class="pill bad">启动进程</span>');
        if (safe.disclosesPaths) flags.push('<span class="pill bad">泄露路径</span>');
        if (flags.length === 0) flags.push('<span class="pill ok">安全</span>');
        return '<tr>'
          + '<td><strong>' + escapeHtml(c.name) + '</strong></td>'
          + '<td><span class="pill">' + escapeHtml(c.kind) + '</span></td>'
          + '<td>' + availPill + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(evidenceStr) + '</td>'
          + '<td style="font-size:11px;">' + flags.join(" ") + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">连接器可用性检查（dry-run）完成。不读取凭据，不检查路径，不启动进程。</div>'
        + summaryPills
        + '<div class="scroll-x" style="margin-top:8px;"><table>'
        + '<thead><tr><th>连接器</th><th>类型</th><th>可用性</th><th>证据</th><th>安全状态</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="5" class="muted">没有连接器数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runLocalConnectorAvailability() {
      const out = document.getElementById("local-connector-availability-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在检查连接器可用性（dry-run）…</div>';
      const result = await getJson("/admin/local-connector-availability");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">连接器可用性请求失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorAvailabilityResult(result.data);
    }
    document.getElementById("local-connector-availability-check")?.addEventListener("click", function () { runLocalConnectorAvailability().catch(function (error) { var s = document.getElementById("local-connector-availability-output"); if (s) { s.innerHTML = '<div class="notice bad">连接器可用性执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-availability-refresh")?.addEventListener("click", function () { runLocalConnectorAvailability().catch(function (error) { var s = document.getElementById("local-connector-availability-output"); if (s) { s.innerHTML = '<div class="notice bad">连接器可用性执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    // ---- local connector provider preview (0.3.17: dry-run only) ----
    function renderConnectorProviderPreviewResult(data) {
      var out = document.getElementById("local-connector-provider-preview-output");
      if (!out) return;
      if (!data || !data.ok) {
        out.innerHTML = '<div class="notice bad">Provider 预览失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      var s = data.summary || {};
      var platform = data.platform || "—";
      var platformPill = '<span class="pill">平台：' + escapeHtml(platform === "windows" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform) + '</span>';
      var summaryPills = [
        platformPill,
        '<span class="pill">总计：' + s.total + '</span>',
        '<span class="pill ok">预览就绪：' + s.previewReady + '</span>',
        '<span class="pill warn">受阻：' + s.blocked + '</span>',
        '<span class="pill">需手动审查：' + s.needsManualReview + '</span>',
        '<span class="pill warn">需凭据同意：' + s.credentialConsentRequired + '</span>',
        '<span class="pill muted-pill">凭据读取：' + s.credentialReads + '</span>',
        '<span class="pill muted-pill">路径泄露：' + s.pathsDisclosed + '</span>',
        '<span class="pill muted-pill">进程启动：' + s.processesStarted + '</span>',
        '<span class="pill muted-pill">路由注册：' + s.routesRegistered + '</span>'
      ].join(" ");
      var rows = (data.providers || []).map(function (p) {
        var availPill = "";
        if (p.availability === "available") availPill = '<span class="pill ok">可用</span>';
        else if (p.availability === "not_found") availPill = '<span class="pill warn">未找到</span>';
        else if (p.availability === "unsupported_platform") availPill = '<span class="pill muted-pill">不支持</span>';
        else availPill = '<span class="pill">未知</span>';
        var readinessPill = "";
        if (p.readiness === "credential_consent_required") readinessPill = '<span class="pill warn">需凭据同意</span>';
        else if (p.readiness === "blocked_missing_tool") readinessPill = '<span class="pill bad">缺少工具</span>';
        else if (p.readiness === "blocked_unsupported_platform") readinessPill = '<span class="pill muted-pill">平台不支持</span>';
        else if (p.readiness === "needs_manual_review") readinessPill = '<span class="pill">需手动审查</span>';
        else readinessPill = '<span class="pill">' + escapeHtml(p.readiness) + '</span>';
        var blockerStr = (p.blockers || []).length > 0 ? p.blockers.join(", ") : "—";
        var apiFormatStr = (p.apiFormats || []).join(", ");
        var routeStr = p.directRoute || "—";
        var modelStr = (p.modelHints || []).join(", ");
        var safe = p.safety || {};
        var flags = [];
        if (safe.readsTokens) flags.push('<span class="pill bad">读 Token</span>');
        if (safe.readsCookies) flags.push('<span class="pill bad">读 Cookie</span>');
        if (safe.readsIdeCredentials) flags.push('<span class="pill bad">读 IDE 凭据</span>');
        if (safe.modifiesConfig) flags.push('<span class="pill bad">改配置</span>');
        if (safe.writesSystemEnv) flags.push('<span class="pill bad">写系统环境</span>');
        if (safe.startsNetworkListener) flags.push('<span class="pill bad">启动监听</span>');
        if (safe.startsProcess) flags.push('<span class="pill bad">启动进程</span>');
        if (safe.disclosesPaths) flags.push('<span class="pill bad">泄露路径</span>');
        if (safe.registersRoutes) flags.push('<span class="pill bad">注册路由</span>');
        if (flags.length === 0) flags.push('<span class="pill ok">安全</span>');
        return '<tr>'
          + '<td><strong>' + escapeHtml(p.name) + '</strong></td>'
          + '<td><span class="pill">' + escapeHtml(p.kind) + '</span></td>'
          + '<td>' + availPill + '</td>'
          + '<td>' + readinessPill + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(blockerStr) + '</td>'
          + '<td style="font-size:11px;"><code>' + escapeHtml(routeStr) + '</code></td>'
          + '<td style="font-size:11px;"><span class="pill">' + escapeHtml(apiFormatStr) + '</span></td>'
          + '<td style="font-size:11px;">' + escapeHtml(modelStr) + '</td>'
          + '<td style="font-size:11px;">' + flags.join(" ") + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">本地连接器 Provider 预览（dry-run）已完成。未注册任何路由，未读取任何凭据或路径。点在 0.3.17，仅预览阶段。</div>'
        + summaryPills
        + '<div class="scroll-x" style="margin-top:8px;"><table>'
        + '<thead><tr><th>连接器</th><th>类型</th><th>可用性</th><th>就绪状态</th><th>阻塞原因</th><th>路由示例</th><th>API 格式</th><th>模型提示</th><th>安全状态</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="9" class="muted">没有 Provider 数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runLocalConnectorProviderPreview() {
      var out = document.getElementById("local-connector-provider-preview-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在构建 Provider 预览（dry-run）…</div>';
      var result = await getJson("/admin/local-connector-provider-preview");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">Provider 预览请求失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorProviderPreviewResult(result.data);
    }
    document.getElementById("local-connector-provider-preview-build")?.addEventListener("click", function () { runLocalConnectorProviderPreview().catch(function (error) { var s = document.getElementById("local-connector-provider-preview-output"); if (s) { s.innerHTML = '<div class="notice bad">Provider 预览执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-provider-preview-refresh")?.addEventListener("click", function () { runLocalConnectorProviderPreview().catch(function (error) { var s = document.getElementById("local-connector-provider-preview-output"); if (s) { s.innerHTML = '<div class="notice bad">Provider 预览执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    // ---- local connector consent manifest (0.3.18: dry-run only) ----
    function renderConnectorConsentManifestResult(data) {
      var out = document.getElementById("local-connector-consent-manifest-output");
      if (!out) return;
      if (!data || !data.ok) {
        out.innerHTML = '<div class="notice bad">授权清单失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      var s = data.summary || {};
      var platform = data.platform || "—";
      var platformPill = '<span class="pill">平台：' + escapeHtml(platform === "windows" ? "Windows" : platform === "darwin" ? "macOS" : platform === "linux" ? "Linux" : platform) + '</span>';
      var summaryPills = [
        platformPill,
        '<span class="pill">总计：' + s.total + '</span>',
        '<span class="pill warn">需授权：' + s.consentRequired + '</span>',
        '<span class="pill muted-pill">已批准：' + s.approved + '</span>',
        '<span class="pill bad">可继续：' + s.canProceed + '</span>',
        '<span class="pill warn">受阻：' + s.blocked + '</span>',
        '<span class="pill muted-pill">凭据读取：' + s.credentialReads + '</span>',
        '<span class="pill muted-pill">路径泄露：' + s.pathsDisclosed + '</span>',
        '<span class="pill muted-pill">进程启动：' + s.processesStarted + '</span>',
        '<span class="pill muted-pill">路由注册：' + s.routesRegistered + '</span>',
        '<span class="pill muted-pill">授权保存：' + s.consentStored + '</span>'
      ].join(" ");
      var rows = (data.manifests || []).map(function (m) {
        var riskPill = m.riskLevel === "medium" ? '<span class="pill warn">medium</span>' : '<span class="pill bad">' + escapeHtml(m.riskLevel || "high") + '</span>';
        var consentPill = '<span class="pill muted-pill">' + escapeHtml(m.consentStatus || "not_requested") + '</span>';
        var proceedPill = m.canProceed ? '<span class="pill ok">可继续</span>' : '<span class="pill bad">不可继续</span>';
        var blockers = (m.blockers || []).join(", ") || "—";
        var required = (m.requiredConsent || []).join(", ");
        var forbidden = (m.forbiddenNow || []).join(", ");
        var tags = (m.reviewTags || []).join(", ");
        var safe = m.safety || {};
        var flags = [];
        if (safe.readsTokens) flags.push('<span class="pill bad">读 Token</span>');
        if (safe.readsCookies) flags.push('<span class="pill bad">读 Cookie</span>');
        if (safe.readsIdeCredentials) flags.push('<span class="pill bad">读 IDE 凭据</span>');
        if (safe.readsKeychain) flags.push('<span class="pill bad">读密钥链</span>');
        if (safe.returnsLocalPaths) flags.push('<span class="pill bad">返回路径</span>');
        if (safe.modifiesConfig) flags.push('<span class="pill bad">改配置</span>');
        if (safe.startsNetworkListener) flags.push('<span class="pill bad">启动监听</span>');
        if (safe.startsProcess) flags.push('<span class="pill bad">启动进程</span>');
        if (safe.registersRoutes) flags.push('<span class="pill bad">注册路由</span>');
        if (safe.storesConsent) flags.push('<span class="pill bad">保存授权</span>');
        if (flags.length === 0) flags.push('<span class="pill ok">安全</span>');
        return '<tr>'
          + '<td><strong>' + escapeHtml(m.name) + '</strong></td>'
          + '<td><span class="pill">' + escapeHtml(m.credentialScope || "manual_review") + '</span></td>'
          + '<td>' + riskPill + '</td>'
          + '<td>' + consentPill + '</td>'
          + '<td>' + proceedPill + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(blockers) + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(required) + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(forbidden) + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(tags) + '</td>'
          + '<td style="font-size:11px;">' + flags.join(" ") + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">本地连接器授权清单（dry-run）已完成。当前不会保存授权、读取凭据、注册路由或启动进程。</div>'
        + summaryPills
        + '<div class="scroll-x" style="margin-top:8px;"><table>'
        + '<thead><tr><th>连接器</th><th>凭据范围</th><th>风险</th><th>授权状态</th><th>是否可继续</th><th>阻塞原因</th><th>需要确认</th><th>当前禁止</th><th>审查标签</th><th>安全状态</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="10" class="muted">没有授权清单数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runLocalConnectorConsentManifest() {
      var out = document.getElementById("local-connector-consent-manifest-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在构建授权清单（dry-run）…</div>';
      var result = await getJson("/admin/local-connector-consent-manifest");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">授权清单请求失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorConsentManifestResult(result.data);
    }
    document.getElementById("local-connector-consent-manifest-build")?.addEventListener("click", function () { runLocalConnectorConsentManifest().catch(function (error) { var s = document.getElementById("local-connector-consent-manifest-output"); if (s) { s.innerHTML = '<div class="notice bad">授权清单执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-consent-manifest-refresh")?.addEventListener("click", function () { runLocalConnectorConsentManifest().catch(function (error) { var s = document.getElementById("local-connector-consent-manifest-output"); if (s) { s.innerHTML = '<div class="notice bad">授权清单执行失败：' + escapeHtml(error.message) + "</div>"; } }); });
    // ---- local connector consent ledger (0.3.21: metadata-only config write) ----
    function renderConnectorConsentLedgerResult(data) {
      var out = document.getElementById("local-connector-consent-ledger-output");
      if (!out) return;
      if (!data || !data.ok) {
        out.innerHTML = '<div class="notice bad">授权记录读取失败：' + escapeHtml((data && (data.error || data.message)) || "未知错误") + "</div>";
        return;
      }
      var s = data.summary || {};
      var summaryPills = [
        '<span class="pill">总计：' + s.total + '</span>',
        '<span class="pill ok">已记录：' + s.approved + '</span>',
        '<span class="pill warn">未记录：' + s.notApproved + '</span>',
        '<span class="pill muted-pill">凭据读取：' + s.credentialReads + '</span>',
        '<span class="pill muted-pill">路径泄露：' + s.pathsDisclosed + '</span>',
        '<span class="pill muted-pill">进程启动：' + s.processesStarted + '</span>',
        '<span class="pill muted-pill">路由注册：' + s.routesRegistered + '</span>',
        '<span class="pill muted-pill">配置写入：' + s.configWrites + '</span>'
      ].join(" ");
      var rows = (data.records || []).map(function (r) {
        var stored = r.consentStatus === "stored";
        var statusPill = stored ? '<span class="pill ok">已记录</span>' : '<span class="pill muted-pill">未记录</span>';
        var approvalPill = stored ? '<span class="pill warn">仅元数据</span>' : '<span class="pill">未批准</span>';
        var riskPill = r.riskLevel === "medium" ? '<span class="pill warn">medium</span>' : '<span class="pill bad">' + escapeHtml(r.riskLevel || "high") + '</span>';
        var blockers = (r.blockers || []).join(", ") || "—";
        return '<tr>'
          + '<td><code>' + escapeHtml(r.id) + '</code><div class="muted">' + escapeHtml(r.name || "") + '</div></td>'
          + '<td><span class="pill">' + escapeHtml(r.credentialScope || "manual_review") + '</span></td>'
          + '<td>' + riskPill + '</td>'
          + '<td>' + statusPill + '</td>'
          + '<td>' + approvalPill + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(r.approvedAt || "—") + '</td>'
          + '<td style="font-size:11px;">' + escapeHtml(blockers) + '</td>'
          + '</tr>';
      }).join("");
      out.innerHTML = ''
        + '<div class="notice ok" style="margin-bottom:8px;font-size:12px;">授权记录已读取。已记录也只代表用户确认了未来接入范围；当前仍不会读取凭据、路径、启动进程或注册路由。</div>'
        + '<div class="muted" style="font-size:12px;margin-bottom:6px;">批准确认串：<code>' + escapeHtml(data.requiredConfirmation || "APPROVE_LOCAL_CONNECTOR_CONSENT") + '</code> · 撤销确认串：<code>' + escapeHtml(data.revokeConfirmation || "REVOKE_LOCAL_CONNECTOR_CONSENT") + '</code></div>'
        + summaryPills
        + '<div class="scroll-x" style="margin-top:8px;"><table>'
        + '<thead><tr><th>连接器</th><th>凭据范围</th><th>风险</th><th>记录状态</th><th>批准状态</th><th>批准时间</th><th>仍然阻塞</th></tr></thead>'
        + '<tbody>' + (rows || '<tr><td colspan="7" class="muted">没有授权记录数据</td></tr>') + '</tbody>'
        + '</table></div>';
    }
    async function runLocalConnectorConsentLedger() {
      var out = document.getElementById("local-connector-consent-ledger-output");
      if (!out) return;
      out.innerHTML = '<div class="muted">正在读取授权记录…</div>';
      var result = await getJson("/admin/local-connector-consent-ledger");
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">授权记录请求失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorConsentLedgerResult(result.data);
    }
    async function applyLocalConnectorConsent(action) {
      var out = document.getElementById("local-connector-consent-ledger-output");
      if (!out) return;
      var connector = window.prompt("输入连接器 id，例如 opencode、gemini-cli、qclaw：");
      connector = connector ? connector.trim() : "";
      if (!connector) {
        out.innerHTML = '<div class="notice warn">已取消：没有输入连接器 id。</div>';
        return;
      }
      var required = action === "revoke" ? "REVOKE_LOCAL_CONNECTOR_CONSENT" : "APPROVE_LOCAL_CONNECTOR_CONSENT";
      var confirmation = window.prompt("请输入确认字符串：" + required);
      if (confirmation !== required) {
        out.innerHTML = '<div class="notice warn">已取消：确认字符串不匹配，未写入 config.json。</div>';
        return;
      }
      out.innerHTML = '<div class="muted">正在' + (action === "revoke" ? "撤销" : "记录") + '授权元数据…</div>';
      var result = await postJson("/admin/local-connector-consent", {
        apply: true,
        action: action,
        connector: connector,
        confirm: confirmation
      });
      if (!result.ok) {
        out.innerHTML = '<div class="notice bad">授权记录写入失败：' + escapeHtml(String(result.status)) + ' ' + escapeHtml(JSON.stringify(result.data)) + "</div>";
        return;
      }
      renderConnectorConsentLedgerResult(result.data.ledger || result.data);
    }
    document.getElementById("local-connector-consent-ledger-refresh")?.addEventListener("click", function () { runLocalConnectorConsentLedger().catch(function (error) { var s = document.getElementById("local-connector-consent-ledger-output"); if (s) { s.innerHTML = '<div class="notice bad">授权记录读取失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-consent-approve")?.addEventListener("click", function () { applyLocalConnectorConsent("approve").catch(function (error) { var s = document.getElementById("local-connector-consent-ledger-output"); if (s) { s.innerHTML = '<div class="notice bad">授权记录写入失败：' + escapeHtml(error.message) + "</div>"; } }); });
    document.getElementById("local-connector-consent-revoke")?.addEventListener("click", function () { applyLocalConnectorConsent("revoke").catch(function (error) { var s = document.getElementById("local-connector-consent-ledger-output"); if (s) { s.innerHTML = '<div class="notice bad">授权记录撤销失败：' + escapeHtml(error.message) + "</div>"; } }); });
    loadConfigEditor().catch(() => {});
    // Diagnostic summary initialization
    (function() {
      var ta = document.getElementById("diagnostic-summary");
      if (ta) {
        fetch("/admin/status").then(function(r) { return r.json(); }).then(function(s) {
          var lines = ["RelayForge diagnostic summary", "---", "Version: " + (s.version || "?"), "Providers: " + ((s.providers && s.providers.length) || 0), "Recent errors: " + ((s.recentErrors && s.recentErrors.length) || 0), "Requests: " + ((s.stats && s.stats.requests) || 0), "Upstream attempts: " + ((s.stats && s.stats.upstreamAttempts) || 0), "---", "Safe to share. No full prompts, keys, or tokens."];
          ta.value = lines.join("\n");
        }).catch(function() {
          ta.value = "RelayForge diagnostic summary\n---\nError loading diagnostics.";
        });
      }
    })();
  
