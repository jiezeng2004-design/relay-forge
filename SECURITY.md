# Security Policy

RelayForge is a local-first gateway for self-managed API keys and local AI
coding clients. Security reports are taken seriously because the project sits
between developer tools and provider credentials.

## Reporting a Vulnerability

Please do not open a public issue containing secrets, local paths, private
request data, account details, or full diagnostic logs.

Preferred reporting path:

1. Use GitHub private vulnerability reporting from the repository's
   **Security** tab, if it is available.
2. If private reporting is unavailable, open a minimal public issue that
   describes the class of problem without sensitive details and ask for a
   private channel.

Please include:

- affected version or commit;
- operating system and Node.js version;
- minimal reproduction steps;
- redacted configuration snippets, if needed;
- the relevant verification command that failed.

Do not include real API keys, relay tokens, Authorization headers, cookies,
OAuth credentials, browser storage, local account identifiers, or prompt
content.

## Scope

Please report issues that could cause:

- real API keys, relay tokens, Authorization headers, cookies, or OAuth
  credentials to appear in logs, diagnostics, dashboard output, exported
  config, or release artifacts;
- prompts or private request bodies to be logged when prompt logging is off;
- local runtime files such as `data/`, `.env`, private config, or generated
  state to be included in public release ZIPs;
- the server to bind publicly or expose admin endpoints without explicit user
  configuration;
- local connector planning code to read credentials before explicit user
  consent;
- doctor diagnostics to output unredacted sensitive data.

## Not In Scope

These are usually regular bugs or feature requests:

- provider outages or upstream API errors;
- unsupported model names;
- dashboard layout issues that do not expose sensitive data;
- missing provider templates;
- requests to bypass provider rate limits, paywalls, account restrictions, or
  terms of service.

## Safe Diagnostics

When asking for help, prefer the redacted doctor output:

```powershell
# Windows PowerShell
npm.cmd run doctor
```

The doctor redaction contract is covered by tests. If doctor output contains a
full secret or private value, treat that as a security issue and report it
privately.

## Supported Versions

Security fixes are prepared against the current public branch and latest public
release line. Older experimental or internal builds are not supported.
