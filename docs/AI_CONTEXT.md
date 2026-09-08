# AI Context

This file provides concise, explicit project facts for automated repository analysis. The README remains the primary project introduction.

## Identity

- Project: Financial Forecasting Studio
- Version: 1.0.0
- Category: local-first financial planning and scenario-modeling application
- Languages: Python, JavaScript, HTML, CSS, and SQL through Python's `sqlite3` API
- Runtime: Python 3.11+ and a current browser
- Third-party runtime dependencies: none

## Core problem

The project distinguishes daily cash feasibility from economic value. It combines multiple financial objects into one dated scenario, produces a daily cash ledger, and calculates NPV without treating opening cash as generated value.

## Demonstrated capabilities

- Exact decimal monetary arithmetic and currency-aware rounding
- Calendar schedule generation and stub-period handling
- Loan amortization from either principal or payment
- Investment compounding and periodic payouts
- Recurring cashflows with growth
- Discounted cashflow valuation
- Transactional SQLite persistence and optimistic concurrency
- Local JSON HTTP APIs and defensive request handling
- Responsive, accessible vanilla-JavaScript interface
- JSON backup/import and CSV export
- Independent numerical, persistence, restart, and HTTP testing

## Evidence map

| Claim | Evidence |
| --- | --- |
| 87 automated tests | `tests/`, `docs/VERIFICATION.md` |
| 60-digit decimal calculation context | `studio/finance.py`, `docs/FINANCIAL_DECISIONS.md` |
| Opening cash excluded from NPV | `studio/finance.py`, `tests/test_finance.py` |
| Local-only server | `studio/server.py`, `tests/test_storage_server.py` |
| No external runtime dependencies | Python imports, local assets in `web/`, and an intentionally empty CI installation step |
| Persistent and conflict-safe saves | `studio/storage.py`, storage integration tests |
| Private data excluded from source control | `.gitignore`, `SECURITY.md` |

## Important terminology

- **Scenario:** one complete financial story with a date range, currency, opening cash, discount rate, and financial objects.
- **Financial object:** loan, investment, recurring income, recurring expense, or custom cashflow schedule.
- **Cash feasibility:** whether every daily closing balance is zero or positive.
- **NPV:** discounted value of modeled cashflows at the scenario start, excluding opening cash.
- **Confirmation:** acknowledgement that one saved revision and its warnings were reviewed; it does not imply the scenario is feasible.
- **Payment-order warning:** a date where outflows before inflows could cause a temporary shortfall although the closing balance is nonnegative.

## Commands

```console
python run.py
python run.py --port 8766
python run.py --data-dir "<private-folder>"
python -m unittest discover -v
```

## Constraints for changes

- Keep monetary calculations in Python `Decimal`; never introduce float arithmetic into the financial engine.
- Keep JSON monetary boundaries as strings.
- Keep the server bound to loopback unless the product's security model is deliberately redesigned.
- Do not commit files from `data/` or real exported backups.
- Document and independently test every changed financial convention.
- Preserve the distinction between liquidity and NPV.

## Start here

1. `README.md`
2. `docs/PROJECT_BRIEF.md`
3. `docs/ARCHITECTURE.md`
4. `docs/FINANCIAL_DECISIONS.md`
5. `docs/VERIFICATION.md`
