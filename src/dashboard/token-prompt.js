// Extracted from server.js — renders the token input prompt page for
// unauthenticated dashboard access. Takes a port number and returns
// a complete HTML document string.

/** @param {number} port @returns {string} */
export function renderTokenPrompt(port) {
  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RelayForge 管理 Token</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;background:#f6f7f9;color:#172033}main{width:min(540px,calc(100vw - 32px));background:#fff;border:1px solid #d9e0ea;border-radius:8px;padding:24px}h1{margin:0 0 8px;font-size:22px}p{color:#657184;line-height:1.6;font-size:14px}.hint{background:#f0f4ff;border:1px solid #d0d9f5;border-radius:6px;padding:10px 14px;margin:12px 0;font-size:13px;color:#34436b;line-height:1.5}.hint code{background:#e0e8ff;padding:1px 5px;border-radius:3px;font-size:12px}input{width:100%;box-sizing:border-box;padding:10px;border:1px solid #d9e0ea;border-radius:6px;font:inherit;font-size:14px}input:focus{border-color:#2563eb;outline:none;box-shadow:0 0 0 2px rgba(37,99,235,0.15)}button{margin-top:12px;padding:9px 16px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;font:inherit;font-size:14px;cursor:pointer}button:hover{background:#1d4ed8}.msg{margin-top:10px;color:#b42318;font-size:13px}.msg.ok{color:#16a34a}code{background:#edf2f7;padding:2px 5px;border-radius:4px;font-size:13px}</style></head>
<body><main><h1>需要输入管理 Token</h1><p>管理页已启用本地鉴权。Token 只保存在浏览器 <code>sessionStorage</code>，不会写入磁盘、URL 或日志。关闭浏览器标签页后 Token 自动清除。</p>
<div class="hint"><strong>Token 获取方式：</strong><br>
1. 终端启动日志第一行会打印：<code>local relay token: abc12...wxyz (auto-generated)</code><br>
2. 配置文件 <code>.env</code> 中设置 <code>RELAYFORGE_TOKEN=你的值</code><br>
3. 兼容旧变量：<code>RELAY_TOKEN</code> / <code>OPENRELAY_TOKEN</code><br>
4. 自动生成路径：<code>data/security/relay-token</code></div>
<input id="token" type="password" autocomplete="off" placeholder="粘贴 RELAYFORGE_TOKEN"><button id="login" type="button">进入管理页</button><div id="msg" class="msg"></div>
<script>const i=document.getElementById("token"),m=document.getElementById("msg");const oldToken=sessionStorage.getItem("openrelay.adminToken");const newToken=sessionStorage.getItem("relayforge.adminToken");i.value=newToken||oldToken||"";async function login(){const t=i.value.trim();if(!t){m.textContent="请输入 RELAYFORGE_TOKEN";m.className="msg";return}sessionStorage.setItem("relayforge.adminToken",t);if(oldToken)sessionStorage.removeItem("openrelay.adminToken");try{const r=await fetch("/",{headers:{authorization:"Bearer "+t}});if(r.status===401){m.textContent="Token 不正确或已过期，请检查 .env 或启动日志";m.className="msg";return}if(!r.ok){m.textContent="验证失败："+r.status+"，请检查 .env 或启动日志";m.className="msg";return}const x=await r.text();document.open();document.write(x);document.close()}catch(e){m.textContent="连接失败，1秒后重试";m.className="msg";setTimeout(login,1000)}}document.getElementById("login").addEventListener("click",login);i.addEventListener("keydown",e=>{if(e.key==="Enter")login()});if(i.value){m.textContent="检测到已有 Token，正在自动登录…";m.className="msg ok";login();}</script></main></body></html>`;
}