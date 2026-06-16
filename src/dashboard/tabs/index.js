// Re-exports the 6 tab renderers + the tool card renderer so the
// server can import them via `./dashboard/tabs/index.js` (one
// statement per family, in line with server.js's existing import
// style for other dashboard internals).

export { renderOverviewTab } from "./overview.js";
export { renderProvidersTab } from "./providers.js";
export { renderRoutesTab } from "./routes.js";
export { renderUsageTab } from "./usage.js";
export { renderSettingsTab } from "./settings.js";
export { renderToolCards } from "./tools.js";
export { renderIdeTab } from "./ide.js";
