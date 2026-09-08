# Changelog

All notable project changes are documented here.

## [1.0.0] - 2026-09-08

### Added

- Complete local financial scenario workflow for loans, investments, income, expenses, and custom cashflows.
- Daily liquidity ledger, first-shortfall detection, lowest-balance reporting, and payment-order warnings.
- Net-present-value calculation using exact decimal inputs and documented 30E/360 conventions.
- Transactional SQLite persistence, optimistic revision handling, confirmation state, scenario duplication, and atomic backup import.
- Payment and daily-balance CSV reports plus versioned JSON backup and restore.
- Responsive browser interface with keyboard-accessible charts, forms, tables, and review workflows.
- Loopback-only server security controls and 87 automated tests.

### Repository

- Added portfolio-focused project, architecture, security, contribution, sharing, and AI-context documentation.
- Added privacy-focused ignore rules and cross-platform continuous integration.
- Formatted frontend source for readable reviews and diffs.
