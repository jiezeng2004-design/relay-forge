# RelayForge v0.3.1 Release Notes

RelayForge v0.3.1 is a documentation, CI compatibility, screenshot, and release-material polish release based on the latest 14 commits on `main`.

## Included Commit Range

- `aca65e1` docs: add v0.3.0 dashboard screenshots
- `51f9b95` docs: prepare v0.3.0 release materials
- `163a5c1` test: remove Node 22-only force-exit flag
- `940d99d` test: add Node 18 compatible crc32 helper
- `7625ddd` ci: isolate auth env in e2e tests
- `b898803` ci: avoid install step in zero-dependency workflow
- `dd86b5e` docs: remove remaining internal version note
- `1c81db6` docs: clean remaining legacy project metadata
- `f95d9ce` docs: remove internal version markers from parity notes
- `437d32e` docs: align OpenRelay parity notes with RelayForge branding
- `5f5f853` chore: remove legacy openrelay-like checksum artifact
- `740dab9` docs: polish open-source project materials
- `9ef5129` docs: remove README BOM
- `b22211a` docs: fix README encoding corruption

## Highlights

- Published real dashboard screenshots and a short fallback demo GIF captured from a local RelayForge demo run.
- Updated README, README.zh, docs asset inventory, and release documentation to reference the real assets.
- Preserved zero-dependency runtime and avoided changes to business logic, test logic, or CI matrix shape.
- Improved CI stability for Node 18/20/22 by removing Node 22-only test behavior and adding compatible CRC32 coverage.
- Isolated auth-related e2e environment state so CI tests do not leak configuration between cases.
- Cleaned legacy internal naming and open-source metadata for the public RelayForge repository.

## Screenshots

The dashboard assets were captured from a real local RelayForge run with a clean demo config. They show masked demo credentials only and do not include real API keys, private prompts, usernames, or private logs.

| Overview | Combo Models |
| --- | --- |
| ![RelayForge overview](assets/relayforge-v0.3-overview-light.png) | ![RelayForge combo models](assets/relayforge-v0.3-combo-models.png) |

| Clients | Diagnostics |
| --- | --- |
| ![RelayForge clients](assets/relayforge-v0.3-clients.png) | ![RelayForge diagnostics](assets/relayforge-v0.3-diagnostics.png) |

Demo:

![RelayForge fallback demo](assets/relayforge-v0.3-fallback-demo.gif)

## Compatibility

- Verified target runtime remains Node.js `>=18`.
- CI compatibility work covers Node 18, Node 20, and Node 22.
- Release packaging remains a zero-dependency zip produced by `npm.cmd run build-dist`.

## Security

- No real provider credentials are included in the screenshots, docs, or release assets.
- OAuth subscription token routing remains unsupported by design.
- Prompt logging remains disabled by default, and diagnostics stay redacted.

## Install / Run

```bash
git clone https://github.com/jiezeng2004-design/relay-forge.git
cd relay-forge
node src/server.js
```

Then open:

```text
http://127.0.0.1:18765
```

## Client Setup

Use:

```text
Base URL: http://127.0.0.1:18765/v1
API Key: <your RelayForge local token>
Model: smart-coding
```
