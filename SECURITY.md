# Security Policy

## Scope

Portfolio Tracker is a local application. It is designed to run on your own computer and listen on `127.0.0.1` only. Running it on a server or exposing it to a network is not supported.

Built-in protections:

- Loopback-only binding (`127.0.0.1:8765`)
- `Host` header allow-list against DNS rebinding
- Origin check and JSON-only write requests against cross-site request forgery
- Content Security Policy, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`
- Upload size limit and path checks for backup restore
- No credentials or API keys are used or stored

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report privately through GitHub: go to the repository's **Security** tab and choose **Report a vulnerability**. Include steps to reproduce and the affected version or commit.

## Your data

Your portfolio data is stored in `data/` on your computer and is excluded from git by `.gitignore`. Never commit it, and do not share backup files publicly: they contain your positions and balances.
