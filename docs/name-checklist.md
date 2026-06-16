# RelayForge — Pre-release Name Availability Checklist

Before publishing v0.1.0, manually verify each item:

## GitHub

- [ ] GitHub repo name `relayforge` is available (or use `relayforge-ai` / `relayforge-gateway`)
- [ ] No other project dominates search results for "RelayForge AI gateway"
- [ ] GitHub organization or personal account is ready

## npm

- [ ] Package name `relayforge` is available
  - Fallback options:
    - `relayforge-ai`
    - `relayforge-gateway`
    - `relayforge-local`
    - `relayforge-dev`
- [ ] If reserved, verify there is no trademark conflict
- [ ] If taken, update `package.json` `name` field to the chosen alternative

## Trademark

- [ ] No known trademark for "RelayForge" in software/gateway context
- [ ] No obvious similarity to existing registered marks

## CLI naming

- [ ] `relayforge` CLI command is appropriate
- [ ] No conflict with existing global npm CLI tools

## Release artifact naming

- [ ] `relayforge-0.1.0.zip` is consistent across:
  - `npm run build-dist` output
  - GitHub Release asset
  - SHA256 filename

## README consistency

- [ ] No remaining `openrelay-like` in user-facing text
- [ ] `package.json` `name` is `relayforge`
- [ ] Release notes use `RelayForge` consistently
- [ ] Docs explain that `openrelay-like` was the internal development name

> **Note:** This checklist requires human verification. If `relayforge` is unavailable on npm,
> update `package.json` `name` to one of the fallback options before release.
