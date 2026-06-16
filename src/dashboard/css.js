// RelayForge Dashboard CSS: zero-dependency product UI system.
// The dashboard stays server-rendered HTML with native CSS variables and JS.
export const DASHBOARD_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{font-size:14px}
body{margin:0;min-height:100vh;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;background:var(--bg);color:var(--text);line-height:1.5}
:root{
  color-scheme:light;
  --bg:#f8fafc;
  --bg-2:#eef2ff;
  --card:rgba(255,255,255,.92);
  --card-solid:#ffffff;
  --text:#0f172a;
  --muted:#64748b;
  --border:#e2e8f0;
  --soft:#f1f5f9;
  --primary:#4f46e5;
  --primary-2:#2563eb;
  --success:#059669;
  --warning:#d97706;
  --danger:#dc2626;
  --cyan:#0891b2;
  --shadow:0 16px 40px rgba(15,23,42,.08);
  --shadow-sm:0 1px 3px rgba(15,23,42,.08);
  --radius:16px;
}
html[data-appearance="dark"]{
  color-scheme:dark;
  --bg:#08111f;
  --bg-2:#111827;
  --card:rgba(15,23,42,.92);
  --card-solid:#0f172a;
  --text:#e5e7eb;
  --muted:#94a3b8;
  --border:#243244;
  --soft:#172033;
  --primary:#818cf8;
  --primary-2:#60a5fa;
  --success:#34d399;
  --warning:#fbbf24;
  --danger:#fb7185;
  --cyan:#22d3ee;
  --shadow:0 16px 40px rgba(0,0,0,.35);
  --shadow-sm:0 1px 3px rgba(0,0,0,.35);
}
@media (prefers-color-scheme:dark){
  html[data-appearance="system"]{
    color-scheme:dark;
    --bg:#08111f;
    --bg-2:#111827;
    --card:rgba(15,23,42,.92);
    --card-solid:#0f172a;
    --text:#e5e7eb;
    --muted:#94a3b8;
    --border:#243244;
    --soft:#172033;
    --primary:#818cf8;
    --primary-2:#60a5fa;
    --success:#34d399;
    --warning:#fbbf24;
    --danger:#fb7185;
    --cyan:#22d3ee;
    --shadow:0 16px 40px rgba(0,0,0,.35);
    --shadow-sm:0 1px 3px rgba(0,0,0,.35);
  }
}
a{color:var(--primary-2);text-decoration:none}
a:hover{text-decoration:underline}
code,.code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;background:var(--soft);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:12px;padding:2px 6px;word-break:break-word}
pre{margin:0;max-width:100%;overflow:auto;white-space:pre-wrap;word-break:break-word;background:#0f172a;color:#e5e7eb;border-radius:12px;border:1px solid #243244;padding:12px 14px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace}
button,.rf-btn{min-height:32px;display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--border);border-radius:10px;background:var(--card-solid);color:var(--text);cursor:pointer;font:inherit;font-size:12px;font-weight:650;padding:6px 12px;text-decoration:none;transition:background .15s,border-color .15s,transform .15s}
button:hover,.rf-btn:hover{border-color:var(--primary);text-decoration:none}
button:disabled{opacity:.55;cursor:not-allowed}
.primary,.rf-btn-primary{background:linear-gradient(135deg,var(--primary),var(--primary-2));border-color:transparent;color:#fff}
.danger,.rf-btn-danger{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 35%,var(--border))}
.small,.rf-btn-sm{min-height:28px;padding:4px 10px;font-size:11px;border-radius:8px}
input[type="text"],input[type="password"],select,textarea{width:100%;border:1px solid var(--border);border-radius:10px;background:var(--card-solid);color:var(--text);font:inherit;font-size:13px;padding:8px 10px}
textarea{min-height:220px;resize:vertical;font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:12px}
textarea.compact-area{min-height:74px}
input:focus,select:focus,textarea:focus{outline:0;border-color:var(--primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--primary) 22%,transparent)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:11px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{background:var(--soft);color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.04em}
tbody tr:hover td{background:color-mix(in srgb,var(--soft) 55%,transparent)}

.rf-layout{display:flex;min-height:100vh;background:linear-gradient(135deg,var(--bg) 0%,var(--bg-2) 100%)}
.rf-sidebar{width:248px;position:sticky;top:0;height:100vh;display:flex;flex-direction:column;background:color-mix(in srgb,var(--card-solid) 90%,transparent);border-right:1px solid var(--border);backdrop-filter:blur(18px);z-index:10}
.rf-sidebar-header{padding:22px 20px 14px;border-bottom:1px solid var(--border)}
.rf-sidebar-header h2{margin:0;font-size:20px;line-height:1.1;letter-spacing:0;font-weight:800;color:var(--text)}
.rf-sidebar-header .sub{margin-top:6px;font-size:12px;color:var(--muted)}
.rf-sidebar-header .ver{margin-top:12px;display:inline-flex;gap:6px;align-items:center;border:1px solid var(--border);background:var(--soft);border-radius:999px;padding:4px 9px;font-size:11px;color:var(--muted)}
.rf-nav{list-style:none;margin:0;padding:12px;display:grid;gap:4px;flex:1;align-content:start}
.rf-nav a{display:flex;align-items:center;gap:10px;padding:10px 11px;border-radius:12px;color:var(--muted);font-weight:650;font-size:13px;text-decoration:none;border:1px solid transparent}
.rf-nav a:hover{background:var(--soft);color:var(--text)}
.rf-nav a.active{background:color-mix(in srgb,var(--primary) 12%,var(--card-solid));border-color:color-mix(in srgb,var(--primary) 35%,var(--border));color:var(--primary)}
.rf-nav .nav-icon{width:18px;text-align:center;flex:0 0 18px}
.rf-nav .count{margin-left:auto;min-width:22px;text-align:center;border-radius:999px;background:var(--soft);color:var(--muted);font-size:11px;padding:1px 6px}
.rf-sidebar-footer{margin:12px;border:1px solid var(--border);border-radius:14px;background:var(--soft);padding:12px;font-size:11px;color:var(--muted)}
.rf-sidebar-footer strong{display:block;color:var(--text);font-size:12px;margin-bottom:3px}
.rf-main{flex:1;min-width:0;width:100%;max-width:1360px;margin:0 auto;padding:28px 32px 40px}
.topbar{display:none}
.tab-pane{display:none}
.tab-pane.active{display:block}

.rf-page-head{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:18px}
.rf-page-title{margin:0;font-size:24px;line-height:1.15;font-weight:800;color:var(--text)}
.rf-page-desc{margin:6px 0 0;color:var(--muted);max-width:760px}
.rf-actions{display:flex;gap:8px;flex-wrap:wrap}
.rf-card,.card,.metric,.panel,.rf-metric,.rf-quick-setup,.rf-client-card,.rf-combo-card,.rf-provider-card,.tool-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow-sm)}
.rf-card,.card,.panel,.rf-client-card,.rf-combo-card,.rf-provider-card,.tool-card{padding:18px}
.panel{margin-bottom:16px}
.panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px}
.panel-title h3{margin:0;font-size:15px;color:var(--text)}
.rf-section{margin-bottom:24px}
.rf-section-title{font-size:16px;font-weight:800;color:var(--text);margin-bottom:4px}
.rf-section-desc{font-size:13px;color:var(--muted);margin-bottom:14px}
.section-label{margin:20px 0 8px;color:var(--muted);font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.muted{color:var(--muted)}
.ok{color:var(--success)}
.warn{color:var(--warning)}
.bad{color:var(--danger)}

.rf-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.rf-grid-2{display:grid;grid-template-columns:repeat(auto-fit,minmax(420px,1fr));gap:16px}
.grid{display:grid;gap:14px}
.grid-4{grid-template-columns:repeat(4,minmax(0,1fr))}
.grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}
.grid-2{grid-template-columns:repeat(2,minmax(0,1fr))}
.rf-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:0 0 20px}
.rf-metric,.metric{padding:16px}
.rf-metric-value,.metric .value{display:block;font-size:30px;line-height:1.05;font-weight:850;color:var(--text)}
.rf-metric-label,.metric .label{display:block;margin-top:7px;color:var(--muted);font-size:12px}
.metric .sub{display:block;margin-top:4px;color:var(--muted);font-size:11px}

.rf-badge,.pill,.err-cat{display:inline-flex;align-items:center;gap:5px;border-radius:999px;font-size:11px;font-weight:750;line-height:1;padding:5px 9px;background:var(--soft);color:var(--muted);border:1px solid transparent;white-space:nowrap}
.rf-badge-success,.pill.ok{background:color-mix(in srgb,var(--success) 16%,transparent);color:var(--success)}
.rf-badge-warning,.pill.warn{background:color-mix(in srgb,var(--warning) 18%,transparent);color:var(--warning)}
.rf-badge-danger,.pill.bad{background:color-mix(in srgb,var(--danger) 16%,transparent);color:var(--danger)}
.rf-badge-neutral,.pill.muted-pill{background:var(--soft);color:var(--muted)}
.rf-badge-local,.pill.local{background:color-mix(in srgb,var(--cyan) 16%,transparent);color:var(--cyan)}
.rf-badge-info,.pill.cloud{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--primary)}
.rf-status-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 8px}
.rf-status-dot-green{background:var(--success)}
.rf-status-dot-yellow{background:var(--warning)}
.rf-status-dot-red{background:var(--danger)}
.rf-status-dot-gray{background:var(--muted)}

.rf-hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:20px;margin-bottom:18px;padding:26px;border-radius:22px;border:1px solid color-mix(in srgb,var(--primary) 20%,var(--border));background:linear-gradient(135deg,color-mix(in srgb,var(--primary) 14%,var(--card-solid)),color-mix(in srgb,var(--cyan) 10%,var(--card-solid)));box-shadow:var(--shadow)}
.rf-hero h1{margin:0;font-size:32px;line-height:1.08;color:var(--text)}
.rf-hero p{margin:10px 0 0;color:var(--muted);font-size:15px;max-width:720px}
.rf-hero-status{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.rf-status-card{background:var(--card-solid);border:1px solid var(--border);border-radius:18px;padding:16px;display:grid;gap:10px;align-content:start}
.rf-status-card .label{color:var(--muted);font-size:12px}
.rf-status-card strong{font-size:18px;color:var(--text)}
.rf-quick-setup{padding:18px;margin-bottom:20px}
.rf-qsv{display:grid;grid-template-columns:132px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)}
.rf-qsv:last-child{border-bottom:0}
.rf-qsv-label{font-size:12px;font-weight:750;color:var(--muted)}
.rf-qsv-value{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;word-break:break-all}
.rf-progress{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.rf-progress-step{border:1px solid var(--border);border-radius:14px;background:var(--card-solid);padding:12px}
.rf-progress-step .dot{width:10px;height:10px;border-radius:50%;display:block;margin-bottom:8px;background:var(--muted)}
.rf-progress-step.ok .dot{background:var(--success)}
.rf-progress-step.warn .dot{background:var(--warning)}
.rf-progress-step span{display:block;color:var(--muted);font-size:11px}
.rf-progress-step strong{display:block;font-size:13px;color:var(--text)}
.rf-next-action{display:flex;align-items:center;justify-content:space-between;gap:14px;border:1px solid color-mix(in srgb,var(--primary) 28%,var(--border));background:color-mix(in srgb,var(--primary) 8%,var(--card-solid));border-radius:16px;padding:16px;margin:16px 0}
.rf-empty{display:grid;gap:6px;place-items:center;text-align:center;padding:34px 16px;background:var(--soft);border:1px dashed var(--border);border-radius:16px;color:var(--muted)}
.rf-empty-title{font-weight:800;color:var(--text);font-size:15px}
.rf-empty-desc{max-width:470px;font-size:13px}
.scroll-x{overflow-x:auto}
.stack{display:flex;flex-wrap:wrap;gap:6px}
.toolbar,.row-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.toolbar .spacer{flex:1}
.field{display:grid;gap:5px;margin-top:8px}
.field label{font-size:12px;color:var(--muted);font-weight:650}
.field .help{font-size:11px;color:var(--muted)}
.field-row{display:grid;grid-template-columns:1fr 2fr auto;gap:10px;align-items:end}
.form-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
.form-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.advanced-block,details.collapsible{border:1px solid var(--border);border-radius:14px;background:var(--card-solid);padding:12px;margin-top:10px}
.advanced-block summary,details.collapsible summary{cursor:pointer;font-weight:750;color:var(--text)}
.notice{margin-top:8px;border:1px solid var(--border);border-radius:12px;background:var(--soft);padding:10px 12px;color:var(--muted);font-size:12px;word-break:break-word}
.notice.ok{background:color-mix(in srgb,var(--success) 12%,var(--card-solid));border-color:color-mix(in srgb,var(--success) 35%,var(--border));color:var(--success)}
.notice.warn{background:color-mix(in srgb,var(--warning) 14%,var(--card-solid));border-color:color-mix(in srgb,var(--warning) 36%,var(--border));color:var(--warning)}
.notice.bad{background:color-mix(in srgb,var(--danger) 12%,var(--card-solid));border-color:color-mix(in srgb,var(--danger) 35%,var(--border));color:var(--danger)}

.rf-combo-header,.rf-client-header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.rf-combo-name,.rf-client-name,.rf-provider-name{font-size:17px;font-weight:850;color:var(--text)}
.rf-combo-strategy,.rf-client-desc,.rf-provider-meta{font-size:12px;color:var(--muted)}
.rf-client-code,.command-box{position:relative;margin-top:12px;border:1px solid var(--border);border-radius:14px;background:var(--soft);padding:12px}
.rf-client-code pre,.command-box pre{background:transparent;color:var(--text);border:0;padding:0}
.rf-client-code .copy-top{position:absolute;top:8px;right:8px}
.rf-combo-step{display:grid;grid-template-columns:28px minmax(0,1fr);gap:12px;position:relative;padding:10px 0}
.rf-combo-step::before{content:"";position:absolute;left:13px;top:38px;bottom:-10px;width:2px;background:var(--border)}
.rf-combo-step:last-child::before{display:none}
.rf-combo-step-num{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:var(--soft);border:1px solid var(--border);font-size:12px;font-weight:850;color:var(--muted);z-index:1}
.rf-combo-step.active .rf-combo-step-num{background:var(--primary);border-color:var(--primary);color:#fff}
.rf-combo-provider{font-weight:800;color:var(--text)}
.rf-combo-model{font-size:12px;color:var(--muted);word-break:break-word}
.rf-route-path{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
.rf-route-node{border:1px solid var(--border);border-radius:12px;background:var(--card-solid);padding:9px 10px;min-width:150px}
.rf-route-arrow{color:var(--muted);font-weight:800}
.rf-usage-bar,.bar{height:8px;border-radius:999px;background:var(--soft);overflow:hidden;min-width:74px}
.rf-usage-fill,.bar span{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--primary),var(--cyan))}
.err-cat{font-size:10px;padding:4px 7px}
.modal-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.55);display:none;align-items:center;justify-content:center;z-index:30;padding:24px}
.modal-backdrop.open{display:flex}
.modal{background:var(--card-solid);border:1px solid var(--border);border-radius:18px;max-width:560px;width:100%;padding:20px;box-shadow:var(--shadow)}

@media(max-width:1100px){
  .grid-4,.rf-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
  .rf-hero{grid-template-columns:1fr}
}
@media(max-width:900px){
  .rf-layout{display:block}
  .rf-sidebar{position:relative;width:100%;height:auto;border-right:0;border-bottom:1px solid var(--border)}
  .rf-sidebar-header{padding:14px 16px}
  .rf-nav{display:flex;flex-wrap:wrap;padding:8px;gap:6px}
  .rf-nav a{padding:8px 10px;font-size:12px}
  .rf-sidebar-footer{display:none}
  .rf-main{padding:16px}
  .rf-page-head{display:block}
  .grid-4,.grid-3,.grid-2,.rf-metrics,.rf-progress,.form-grid,.form-grid-2,.field-row,.rf-grid-2{grid-template-columns:1fr}
  .rf-qsv{grid-template-columns:1fr}
  .rf-qsv-copy{justify-self:start}
  .rf-hero h1{font-size:28px}
}
`.trim();
