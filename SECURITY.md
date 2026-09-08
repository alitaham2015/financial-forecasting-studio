# Security Policy

## Security model

Financial Forecasting Studio is a single-user, local-first application. Its server binds to `127.0.0.1` and is not designed for internet exposure, remote hosting, or multi-user access.

The application has no accounts, remote API credentials, analytics, telemetry, external fonts, or cloud persistence. Runtime assets are served from the repository itself.

## Sensitive data

Scenario names, amounts, dates, and notes may be sensitive. They are stored in `data/scenarios.sqlite3` by default. This directory and common export filenames are excluded from Git.

The SQLite database, JSON backups, and CSV exports are not encrypted. Protect them with operating-system access controls and encrypted storage where appropriate. Do not attach real scenarios to shared bug reports.

## Supported use

- Run the server only through its loopback binding.
- Do not place it behind a public proxy without a separate authentication and security design.
- Use a currently supported Python release and current browser.
- Review imported backups before relying on their assumptions.

## Reporting a vulnerability

Report suspected vulnerabilities privately to the repository owner. Do not include real financial information, database files, or private exports in an issue.

Include a minimal fictional reproduction, affected version, expected behavior, and observed behavior.

## Scope clarification

The application includes controls against cross-site mutations, DNS rebinding, cached private responses, oversized requests, and spreadsheet-formula interpretation in exports. These controls reduce risk within the documented local-only model; they do not turn the application into an encrypted vault or an internet-facing service.
