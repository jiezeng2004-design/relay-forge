# v0.3.0 - Premium Dashboard UX for RelayForge

RelayForge v0.3.0 focuses on the local dashboard experience while keeping the project zero-dependency, local-first, and server-rendered.

## Highlights

- Product-style Overview with running status, Quick Connect, Setup Progress, metrics, next action, and recent activity.
- Premium sidebar and navigation hierarchy for Overview, Providers, Combo Models, Clients, Usage, Diagnostics, and Settings.
- Combo Models page that clearly shows one client-facing model name and the upstream routing path.
- Clients page with copy-ready setup cards for CC Switch, opencode, Codex/OpenAI-compatible clients, Cline, and generic OpenAI-compatible tools.
- Usage and Diagnostics sections designed for lightweight observability without exposing prompts, keys, or tokens.
- Light, dark, and system appearance modes powered by CSS variables and `relayforge.appearance` in localStorage.

## Security

- RelayForge still uses API-key routing only.
- OAuth subscription token routing is not implemented.
- Full API keys, relay tokens, cookies, and prompts are not rendered in the dashboard.
- Diagnostic summaries remain redacted and safe to share.

## Design References

The redesign references public UI and information architecture ideas from 9Router, Helicone, LiteLLM, One API, New API, and Portkey Gateway. No source code was copied, no external dependencies were added, and AGPL implementation code was not imported.

## Verification

Run these commands from the project root:

```powershell
npm.cmd run check
npm.cmd run test:unit
npm.cmd run test:dashboard-ui
npm.cmd run build-dist
```
