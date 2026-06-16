// 0.5.1 split: the implementation now lives in ./dashboard/index.js
// (and ./dashboard/{shared,rows}.js, ./dashboard/tabs/*.js). This
// file is kept as a re-export so server.js + test-dashboard-html.mjs
// can keep importing from ./dashboard.js without churn.

export { renderDashboard } from "./dashboard/index.js";
