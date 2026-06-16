// RelayForge Dashboard CSS — modern, clean, zero-dependency
// Used across all tabs. Injected inline in the HTML shell.
export const DASHBOARD_CSS = `
/* ===== Reset & Base ===== */
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{font-size:14px}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif;background:#f0f4f8;color:#1e293b;line-height:1.5;min-height:100vh}
a{color:#2563eb;text-decoration:none}
a:hover{text-decoration:underline}
code,.code{font-family:ui-monospace,SFMono-Regular,Consolas,"Liberation Mono",monospace;font-size:0.9em;background:#f1f5f9;padding:1px 5px;border-radius:4px;color:#334155}
pre{background:#0f172a;color:#e2e8f0;padding:12px 16px;border-radius:8px;overflow-x:auto;font-size:12px;line-height:1.6}

/* ===== Layout ===== */
.rf-layout{display:flex;min-height:100vh}
.rf-sidebar{width:220px;background:#fff;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;position:sticky;top:0;height:100vh;overflow-y:auto;z-index:10}
.rf-sidebar-header{padding:16px 20px;border-bottom:1px solid #e2e8f0}
.rf-sidebar-header h2{font-size:16px;font-weight:700;color:#0f172a;margin:0}
.rf-sidebar-header .sub{font-size:11px;color:#64748b;margin-top:2px}
.rf-sidebar-header .ver{font-size:10px;color:#94a3b8;margin-top:1px}
.rf-nav{list-style:none;padding:8px 0;flex:1}
.rf-nav li{padding:0}
.rf-nav a{display:flex;align-items:center;gap:10px;padding:10px 20px;color:#475569;font-size:13px;font-weight:500;transition:all 0.15s;border-left:3px solid transparent;text-decoration:none}
.rf-nav a:hover{background:#f1f5f9;color:#1e293b}
.rf-nav a.active{background:#eff6ff;color:#2563eb;border-left-color:#2563eb;font-weight:600}
.rf-nav .nav-icon{width:18px;text-align:center;flex-shrink:0}
.rf-main{flex:1;min-width:0;padding:24px 32px;max-width:1400px}
.rf-main-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px}

/* ===== Components ===== */
.rf-card{background:#fff;border-radius:14px;box-shadow:0 1px 3px rgba(0,0,0,0.06),0 1px 2px rgba(0,0,0,0.04);padding:20px;transition:box-shadow 0.2s}
.rf-card:hover{box-shadow:0 4px 12px rgba(0,0,0,0.08)}
.rf-card-highlighted{border:1.5px solid #2563eb;background:#f8faff}
.rf-card-warning{border:1.5px solid #f59e0b;background:#fffbeb}
.rf-card-danger{border:1.5px solid #ef4444;background:#fef2f2}

.rf-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.rf-metric{background:#fff;border-radius:14px;padding:16px 20px;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
.rf-metric-value{font-size:28px;font-weight:700;color:#0f172a;line-height:1.2}
.rf-metric-label{font-size:12px;color:#64748b;margin-top:4px}
.rf-metric-trend{font-size:11px;margin-top:2px}

.rf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.rf-grid-2{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:16px}

.rf-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em}
.rf-badge-success{background:#dcfce7;color:#166534}
.rf-badge-warning{background:#fef3c7;color:#92400e}
.rf-badge-danger{background:#fee2e2;color:#991b1b}
.rf-badge-neutral{background:#f1f5f9;color:#475569}
.rf-badge-local{background:#f0f9ff;color:#0369a1}
.rf-badge-info{background:#e0f2fe;color:#075985}

.rf-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:none;cursor:pointer;transition:all 0.15s;text-decoration:none;line-height:1.4}
.rf-btn-primary{background:#2563eb;color:#fff}
.rf-btn-primary:hover{background:#1d4ed8}
.rf-btn-secondary{background:#f1f5f9;color:#334155}
.rf-btn-secondary:hover{background:#e2e8f0}
.rf-btn-ghost{background:transparent;color:#64748b}
.rf-btn-ghost:hover{background:#f1f5f9;color:#1e293b}
.rf-btn-danger{background:#ef4444;color:#fff}
.rf-btn-danger:hover{background:#dc2626}
.rf-btn-sm{padding:4px 10px;font-size:11px}
.rf-btn-icon{padding:6px;min-width:32px;justify-content:center}

.rf-section{margin-bottom:28px}
.rf-section-title{font-size:16px;font-weight:700;color:#0f172a;margin-bottom:4px}
.rf-section-desc{font-size:12px;color:#64748b;margin-bottom:14px}
.rf-section-actions{display:flex;gap:8px;flex-wrap:wrap}

.rf-hero{background:linear-gradient(135deg,#1e40af 0%,#3b82f6 100%);border-radius:16px;padding:28px 32px;color:#fff;margin-bottom:24px}
.rf-hero h1{font-size:22px;font-weight:700;margin:0 0 4px}
.rf-hero p{font-size:13px;opacity:0.9;margin:0 0 12px}
.rf-hero-status{display:flex;gap:10px;flex-wrap:wrap}

.rf-quick-setup{background:#fff;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,0.06);margin-bottom:24px}
.rf-quick-setup h3{font-size:14px;font-weight:700;margin-bottom:12px}
.rf-qsv{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
.rf-qsv:last-child{border:none}
.rf-qsv-label{color:#64748b;min-width:90px;flex-shrink:0}
.rf-qsv-value{font-family:ui-monospace,monospace;color:#0f172a;word-break:break-all;flex:1}
.rf-qsv-copy{flex-shrink:0}

.rf-table{width:100%;border-collapse:collapse;font-size:13px}
.rf-table th{text-align:left;padding:10px 12px;font-weight:600;color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:0.03em;border-bottom:2px solid#e2e8f0}
.rf-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
.rf-table tr:hover td{background:#f8fafc}

.rf-empty{text-align:center;padding:48px 20px;color:#94a3b8}
.rf-empty-icon{font-size:36px;margin-bottom:8px;opacity:0.5}
.rf-empty-title{font-size:15px;font-weight:600;color:#64748b;margin-bottom:4px}
.rf-empty-desc{font-size:13px;color:#94a3b8;max-width:400px;margin:0 auto}

.rf-status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:4px}
.rf-status-dot-green{background:#22c55e}
.rf-status-dot-yellow{background:#eab308}
.rf-status-dot-red{background:#ef4444}
.rf-status-dot-gray{background:#cbd5e1}

/* ===== Provider Card ===== */
.rf-provider-card{padding:16px 20px}
.rf-provider-name{font-size:15px;font-weight:700}
.rf-provider-meta{font-size:11px;color:#64748b;margin-top:2px}
.rf-provider-stats{display:flex;gap:16px;margin-top:10px;flex-wrap:wrap}
.rf-provider-stat{font-size:12px;color:#475569}
.rf-provider-stat strong{margin-right:4px}

/* ===== Combo Card ===== */
.rf-combo-card{padding:20px}
.rf-combo-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;flex-wrap:wrap;gap:8px}
.rf-combo-name{font-size:17px;font-weight:700}
.rf-combo-strategy{font-size:12px;color:#64748b;margin-top:2px}
.rf-combo-step{display:flex;align-items:flex-start;gap:12px;padding:10px 0;position:relative}
.rf-combo-step::before{content:'';position:absolute;left:11px;top:32px;bottom:-10px;width:2px;background:#e2e8f0}
.rf-combo-step:last-child::before{display:none}
.rf-combo-step-num{width:24px;height:24px;border-radius:50%;background:#e2e8f0;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#475569;flex-shrink:0;position:relative;z-index:1}
.rf-combo-step.active .rf-combo-step-num{background:#2563eb;color:#fff}
.rf-combo-step-content{flex:1;padding-top:2px}
.rf-combo-provider{font-size:14px;font-weight:600}
.rf-combo-model{font-size:12px;color:#64748b}

/* ===== Client Card ===== */
.rf-client-card{padding:20px}
.rf-client-icon{font-size:28px;margin-bottom:8px}
.rf-client-name{font-size:15px;font-weight:700;margin-bottom:4px}
.rf-client-desc{font-size:12px;color:#64748b;margin-bottom:12px}
.rf-client-code{background:#f1f5f9;border-radius:8px;padding:12px;font-size:12px;position:relative}
.rf-client-code pre{margin:0;white-space:pre-wrap;word-break:break-all;background:transparent;color:#1e293b;padding:0;font-size:12px}

/* ===== Usage ===== */
.rf-usage-bar{height:6px;border-radius:3px;background#f1f5f9;overflow:hidden;min-width:60px}
.rf-usage-fill{height:100%;border-radius:3px;transition:width 0.3s}

/* ===== Responsive ===== */
@media(max-width:900px){
  .rf-layout{flex-direction:column}
  .rf-sidebar{width:100%;height:auto;position:relative;border-right:none;border-bottom:1px solid #e2e8f0}
  .rf-sidebar-header{padding:12px 16px}
  .rf-nav{display:flex;flex-wrap:wrap;padding:4px 8px;gap:2px}
  .rf-nav a{padding:6px 12px;font-size:12px;border-left:none;border-bottom:2px solid transparent}
  .rf-nav a.active{border-left:none;border-bottom-color:#2563eb}
  .rf-main{padding:16px}
  .rf-metrics{grid-template-columns:repeat(2,1fr)}
  .rf-grid{grid-template-columns:1fr}
  .rf-grid-2{grid-template-columns:1fr}
}

/* ===== Tabs container ===== */
.rf-tab{display:none}
.rf-tab.active{display:block}
`.trim();
