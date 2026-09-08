# Project Brief

## Product

Financial Forecasting Studio is a private, local-first application for combining financial obligations and resources in one dated scenario.

## Problem

Traditional calculators usually evaluate one loan or investment at a time. They can show a payment or return while hiding whether the complete plan has enough cash on every required date. A second source of confusion is treating opening cash as if it were value produced by the arrangement.

The Studio addresses both gaps by calculating daily liquidity and net present value separately across a complete scenario.

## Intended users

- Individuals comparing borrowing, saving, income, and spending plans
- Analysts who need an inspectable dated cashflow model
- Students exploring the difference between liquidity and economic value
- Developers reviewing a compact example of exact financial arithmetic and local-first architecture

## Primary goals

1. Combine loans, investments, income, expenses, and custom payments in one horizon.
2. Identify the first date cash becomes insufficient and the lowest balance reached.
3. Calculate NPV without counting opening cash as value created by the plan.
4. Make every material assumption, schedule, and rounding decision inspectable.
5. Preserve user data locally without accounts, telemetry, or network services.
6. Reproduce financial results after restart from persisted assumptions.

## Non-goals

- Live banking, brokerage, exchange-rate, or market-data connections
- Tax, legal, accounting, or investment advice
- Automatic inflation, fee, or holiday-calendar assumptions
- Multi-user collaboration or remote access
- Encryption or access control between users of the same operating-system account
- Intraday settlement simulation

## Success criteria

- A new user can start the application with Python and a browser only.
- Valid scenarios produce deterministic schedules, daily balances, and NPV.
- Invalid or incomplete scenarios identify the assumptions requiring correction.
- Saved scenarios survive process restarts and rejected requests.
- The calculation engine is independently testable without the browser or database.
- Repository clones never include a user's local financial database.

## Product boundaries

The application supports a single currency per scenario, dates from 1900 through 2199, horizons up to 100 years, and monthly, quarterly, or yearly schedules. Additional commitments must be represented explicitly as custom cashflows when they are not part of a supported object.

The repository-safe project brief is intentionally original and concise. A locally retained source specification is excluded from version control because it is unnecessary for running or reviewing the project.
