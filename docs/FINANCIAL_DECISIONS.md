# Financial Decisions

This document defines the financial rules used by Financial Forecasting Studio, engine version **1.0.0**. The repository-safe [Project Brief](PROJECT_BRIEF.md) defines the product goals. The decisions below make every calculation convention explicit and preserve the central distinction between daily cash feasibility and economic value. They are application modeling conventions, not claims about the terms of a particular financial contract.

The implementation is deterministic. The same valid input produces the same posted cashflows, daily balances, warnings, and NPV. Every financial result is calculated on the server; the browser receives monetary values as decimal strings.

## 1. Decimal arithmetic and currency rounding

All financial arithmetic uses Python `Decimal` with **60 significant decimal digits** in an isolated calculation context. Entered decimal text is parsed directly without a binary floating-point conversion. Currency postings are quantized using **ROUND_HALF_UP**, meaning exact ties round away from zero. Examples: 1.005 → 1.01; −1.005 → −1.01. Negative zero is normalized to zero.

USD, EUR, GBP, CAD, AUD, and CHF use two decimals; JPY uses zero; KWD uses three. Entered amounts with excess fractional precision are validation errors rather than silently changed assumptions. Rates retain entered decimal precision. Plain decimal notation is required: exponent notation, commas, NaN, infinity, and currency symbols are rejected.

Full-period compound balances and growth bases retain calculation precision until a cash payment is posted. Loan interest is posted and rounded each payment period; the monetary obligation reconciles to those postings. Present values retain precision until the full NPV sum is rounded once. Individual present values and object contributions are separately rounded for display, so their displayed sum can differ by minor units from total NPV.

Fractional powers can be irrational: no finite decimal representation makes them mathematically exact. Sixty-digit Decimal exponentiation supplies reproducible precision far beyond the currency unit; the monetary ledger itself contains exact minor-unit amounts. The chart alone converts final decimal strings to floating-point coordinates. This cannot alter the financial result. The implementation follows the documented decimal context and rounding facilities in [Python's Decimal documentation](https://docs.python.org/3/library/decimal.html).

**Worked example:** two one-cent receipts after one year, discounted at 100%, each have a present value of 0.005. Their individual displayed values are 0.01 each; total NPV is round(0.005 + 0.005) = **0.01**, not 0.02.

## 2. The specified day count is European 30E/360

For dates `a` and `b`, use:

```text
T(a,b) = 360 × (year_b − year_a)
       + 30 × (month_b − month_a)
       + min(day_b,30) − min(day_a,30)
```

This precisely implements the specification's instruction to treat a day numbered 31 as 30. February is not promoted to day 30. This is the European 30E/360 convention, not the US/NASD or ISDA variant with special February adjustments. The distinction is described in [OpenGamma Strata's day-count documentation](https://strata.opengamma.io/day_counts/).

| Dates | Financial days |
| --- | ---: |
| 2023-01-31 to 2023-02-28 | 28 |
| 2024-01-31 to 2024-02-29 | 29 |
| 2024-02-29 to 2024-03-31 | 31 |
| 2023-02-28 to 2023-03-31 | 32 |
| 2024-01-30 to 2024-01-31 | 0 |
| 2024-01-31 to 2025-01-31 | 360 |

Two distinct real dates can therefore have zero financial-day distance. Liquidity still recognizes both actual dates; their discount factors can be equal.

## 3. Calendar schedules and full periods

Monthly, quarterly and yearly mean steps of 1, 3 and 12 calendar months. Each date is computed from the **original anchor**, never from the preceding clamped date. Jan 31, 2024 produces Feb 29, Mar 31, Apr 30 and May 31. An annual schedule anchored on Feb 29 returns to Feb 29 in the next leap year.

Unless explicitly entered otherwise, the first periodic payment is one full period after the object's start. An explicitly selected first payment becomes the recurring schedule's new anchor. Income/expense and loan first payments may be on the object's start date but never before it. Investment full-period interest dates always follow the deposit anchor. There is no separate first-interest-date override for investments because that would introduce irregular deposit accrual outside the specified core product.

A complete contractual calendar period earns one full periodic rate, even when its February anniversary was clamped. This preserves the specification's level-payment annuity and full-period investment-compounding formulas. 30E/360 prorates incomplete periods and determines NPV time. For example, a Jan 31 to Feb 29 monthly investment earns a full monthly rate; ending it on Feb 28 in that leap year produces a 28/30 stub. These full-period and dated-valuation conventions are deliberately separate and visible. A regular loan need not have exactly zero NPV at its own implied annual rate when dated 30E/360 fractions differ from contractual periods.

The horizon includes both endpoints and must contain the object's complete term and every resulting payment. Dates are not shifted for weekends, holidays, settlement conventions, or time zones. Date-only arithmetic cannot create daylight-saving drift.

## 4. Rate bases and negative rates

The UI accepts percentages; formulas below use decimal fractions. For `m` periods per year and entered rate `r`:

```text
Nominal annual:     i = r / m
Effective annual:   i = (1+r)^(1/m) − 1
Per period:         i = r
```

All three methods work with monthly, quarterly, and yearly periods. Zero has an explicit path wherever division by a periodic rate would otherwise occur.

**Worked equivalence:** 40% nominal annual, 46.41% effective annual, and 10% per quarter all give `i = 0.10` for quarterly schedules. A monthly effective annual input of 12.6825030131969720661201% gives exactly 1% per month within decimal computation precision.

The product specification does not prohibit negative object rates. The application allows entered rates greater than −100%, and caps them at 1,000% as an explicit numerical boundary. Negative loan interest reduces the obligation. Negative at-maturity investment interest reduces capital. Negative investment interest paid each period is a **cash charge**, with original capital returned at maturity. A written note identifies this behavior. The model does not turn negative interest into a positive return.

## 5. Standard loans

Loans are ordinary annuities unless the first repayment date is overridden. The usual formulas are:

```text
Payment from principal: P = L × i / [1 − (1+i)^(-n)]
Principal from payment: L = P × [1 − (1+i)^(-n)] / i
At i = 0:              P = L/n; L = P×n
```

The known value is authoritative. The other loan amount is derived, and entering both is an error. In the known-payment method the derived principal is rounded to the currency unit, because the opening loan receipt must itself be a real monetary amount. The regular payment is entered in currency units. In the known-principal method the computed regular payment is rounded once to the currency unit.

These are the standard present-value annuity relationships. See the primary textbook explanations in [OpenStax Annuities](https://openstax.org/books/principles-finance-2e/pages/8-2-annuities) and [OpenStax Loan Amortization](https://openstax.org/books/principles-finance-2e/pages/8-3-loan-amortization). Expected test values use exact arithmetic rather than rounded textbook factors. For example, a 75,000 loan repaid over five years at 3% has an exact-formula rounded payment of **16,376.59**; using the source's shortened annuity factor gives a one-cent different illustration.

**Worked equivalence:** principal 1,000, monthly nominal annual rate 12%, two payments gives `P = 102010/201 = 507.512437…`, posted as 507.51. Conversely, payment 507.51 supports `507.51 × (1/1.01 + 1/1.01²) = 999.995196…`, rounded to principal 1,000.00. Both inputs produce the same dates and postings.

## 6. Loan posting and final reconciliation

For each payment:

```text
interest       = round(opening obligation × period rate)
amount owing   = opening obligation + posted interest
regular paid   = min(regular payment, amount owing)
principal paid = payment − posted interest
closing debt   = amount owing − payment
```

The final payment is **all remaining obligation plus its posted interest**. It may differ from the regular amount, and the UI shows its adjustment. This cannot hide an unexplained remaining balance. If rounding clears a very small loan early, later contractual rows are zero rather than overpayments. If the regular payment rounds to zero, the final obligation is still due; a material-rounding note calls attention to the outcome. Large adjustments relative to the regular payment also produce a note.

**Zero-interest example:** 100 over three payments produces 33.33, 33.33, 33.34. The final obligation is exactly zero. For JPY 100 the payments are 33, 33, 34; for KWD 1.000 they are 0.333, 0.333, 0.334.

**Interest example:** the 1,000 two-payment loan posts interest 10.00 and 5.02. After payment one, debt is 502.49; after payment two it is zero. The independent verification ledger uses integer cents and exact rational discount factors across 1, 12, 60 and 360 payments.

Equivalent rounded input methods cannot be promised to recover an arbitrary original principal to the last cent: rounding the regular payment loses information. Differences are limited to the explicitly posted principal/payment rounding and the reconciled final installment. Exact supported input equivalence is tested where the rounded inverse principal matches.

## 7. Irregular first loan repayments

The specification allows a different first repayment date without defining its accrual. Ignoring this interval could imply free deferral. The application divides the time from receipt to first repayment into complete calendar periods `q` and a remaining 30E/360 stub `d`:

```text
p = 30 × months per period
F = (1+i)^q × (1 + i×d/p)
standard annuity factor = [1 − (1+i)^(-n)] / i  (or n at zero)
first-date-adjusted factor = standard annuity factor × (1+i)/F
P = L / adjusted factor, or L = P × adjusted factor
```

First posted interest is `round(L×(F−1))`. Later periods use `round(opening debt×i)`. This applies both loan methods consistently and keeps the payment stream level apart from currency reconciliation.

**Worked example:** 1,000 at 1% monthly, received Jan 1, with its single repayment Mar 16, has two full periods and 15 stub days. `F = 1.01² × 1.005`; final payment = **1,025.20**. With a first repayment on the receipt date, `F = 1`; the same formulas become an annuity due. This choice is a transparent modeling convention, not a reconstruction of an unspecified lender's grace-period policy.

## 8. Investment compounding, paid interest, and stubs

At-maturity deposits retain the full-precision accrued balance for `n` complete periods: `B = A×(1+i)^n`. For a remaining stub, maturity is:

```text
Maturity payout = round(B × [1 + i×d/p])
```

The stub accrues on **accumulated capital**, because full-period interest remains invested. Using only the original deposit would drop interest on already reinvested earnings. For paid-interest deposits, each full period posts `round(A×i)`, a stub posts `round(A×i×d/p)`, and the original principal is returned as a separate maturity cashflow. No paid interest is automatically reinvested.

The specification's stub expression uses an annual rate but allows several rate bases. To make equivalent inputs equivalent, the stub annual simple rate is **`i×m`**, not the raw effective-annual or per-period input. This makes stub interest approach one periodic return as the fraction approaches one full period. A term shorter than the frequency interval is valid and uses a stub-only payout.

**Worked example:** invest 1,000 on Jan 1 at 12% nominal annually, monthly frequency, mature Apr 16. Full-period value is 1,030.301. A 15-day stub adds 5.151505 on accrued capital, so maturity pays **1,035.45**. With interest paid as earned, the cashflows are −1,000 at deposit, +10 on Feb 1, Mar 1 and Apr 1, +5 stub interest on Apr 16, and +1,000 capital on Apr 16. Full-period and stub components are separately labeled in the schedule details; their displayed rounded components are explanatory, while the maturity payout is rounded from the combined precise value.

## 9. Income and expense growth

The starting amount is the **first actual payment**. Annual anniversaries are measured from that first payment, including an explicitly entered first date. This avoids immediately growing the first yearly payment before the user has ever received the starting amount. Annual growth does not apply every month.

For each due date, `k` is the number of completed annual anniversaries, or the zero-based payment index for every-payment growth. The amount is `round(X×(1+g)^k)`. Growth uses the original unrounded mathematical base, not the preceding rounded posting, to avoid cumulative cent drift. Income supplies a positive sign; expenses supply a negative sign. Negative growth is allowed only above −100%, so it cannot reverse the meaning of the object. Fixed mode requires zero growth.

**Examples:** first payment 100, growth 10% annually, monthly payments starting Jan 1: twelve payments of 100, then 110 from the next Jan 1. Every-payment growth yields 100, 110, 121, 133.10. An expense declining 10% per payment produces −100, −90, −81. For an initial amount 1 and growth 0.5% per payment, postings are 1.00, 1.01, 1.01, 1.02; repeatedly compounding rounded cents would give a different, unintended result.

## 10. Cash balance, shortfalls and payment-order warnings

Opening cash is an existing nonnegative resource. A negative opening-cash input is rejected; enter an immediate negative custom cashflow to model a debt, payment or starting obligation explicitly. Opening cash is not itself an atomic cashflow.

The daily ledger starts on the scenario start and ends on the scenario end, inclusively. Each actual day adds all its exact signed postings. Days without flows carry the balance forward. The minimum is the minimum **daily closing cash**; ties report the first date. A beginning-of-day opening resource is not an additional closing-balance observation.

The first strictly negative closing balance makes the plan infeasible; zero is feasible. The first shortfall amount is the magnitude of that day's negative closing balance. The lowest balance and its date can be different. The date inspector lists the associated objects and individual flows, without suggesting that the displayed row order is settlement order.

A warning is produced **only** when there is at least one strictly positive and one strictly negative flow, prior closing cash plus all outflows is negative, and the final closing cash is nonnegative after inflows. A day ending negative is already a feasibility failure and does not receive this redundant ordering warning. Recovery from a previously negative balance can still produce an ordering warning on the recovery date.

**Examples:** opening 0, receive 100 and pay 100 on one date → closing 0, feasible at day end, warning gap 100. Opening 100 with the same flows → no warning. Opening 10, receive 5, pay 20 → closing −5, infeasible, no ordering warning. With opening 10 and later payments of −15, −10, +30, the first shortfall is 5; the lowest balance is −15 on the following day.

Warning acceptance is stored for the confirmed revision. Written warnings remain in the results after acceptance. Any saved input change clears both confirmation and acceptance.

## 11. Net present value and interpretation

The annual scenario discount rate is effective. For every atomic cashflow `Cj` and financial-day distance `Tj` from scenario start:

```text
NPV = round(sum(Cj / (1+r)^(Tj/360)))
```

No opening cash is added, no terminal cash balance is counted a second time, and no out-of-horizon maturity or repayment is silently dropped. At zero discount, NPV is the sum of signed cashflows. Start-date flows are undiscounted. The discount rate must exceed −100%.

**Worked examples:** −1,000 at start and +1,100 one year later at 10% gives NPV **0.00**. Adding 5,000 opening cash changes liquidity and ending cash, but NPV stays 0.00. −1,000 now and +1,210 six months later at 21% gives `−1000 + 1210/1.1 = 100.00`. A +900 receipt in one year at −10% discounts to 1,000.00.

A zero displayed NPV means the plan meets the hurdle rate **to the selected currency precision**. Positive and negative results refer to the entered deterministic assumptions, without predicting actual returns. Feasibility is separately reported even when NPV is positive. The application does not offer a direct NPV comparison between differing discount rates.

## 12. Custom schedules, completeness, and numerical bounds

Every custom row is retained separately, even with the same date, same object or a zero amount. A zero row is neutral, does not create an ordering warning, and is omitted only from the chart's payment bars. It remains in the payment table and export. Copying a generated schedule creates a separate independent custom object. Keeping both counts both; this is disclosed before adding the copy and again in the assumptions.

Validation permits incomplete drafts but blocks calculations until the full saved scenario is valid. It checks every date, amount, rate basis, supported method, growth setting and horizon. Explicit limits (100 calendar years, 200 objects, 25,000 cashflows, 1–1,200 loan payments, entered amounts up to 10^12, generated payments up to 10^18 and individual present values up to 10^30) prevent unbounded computation and unsupported display magnitudes. Exceeding a limit produces an error rather than truncating a schedule. A 100-year monthly stream with an immediate first payment contains 1,201 rows, including its final anniversary; this boundary is tested.

Taxes, fees, inflation, exchange rates, automatic credit, idle-cash interest, and forced liquidation are not invented. All can affect real-world outcomes, but any modeled cash effect must be explicitly entered. The product specification marks additional lending methods, IRR, stochastic analysis and other enhancements as future expansion; they are outside this completed deterministic core.

## 13. Combined worked example

The optional illustrative plan runs Jan 1, 2026 through Jan 1, 2027, in USD, with 3,500 opening cash and a 6% annual discount rate:

- Loan: 12,000 on Jan 1, 8% nominal annual, twelve monthly repayments. Eleven payments are 1,043.86 and the final payment is 1,043.87. Posted total interest is 526.33; final debt is zero.
- Investment: 10,000 on Jan 1 at 10% effective annually, monthly compounding, all proceeds at maturity Jan 1, 2027. Maturity returns 11,000.
- Salary: 3,200 on the 25th each month in 2026. A 3% annual growth assumption has no anniversary inside this one-year income term.
- Living costs: 2,100 on the 2nd each month in 2026, fixed.
- Custom: −1,800 on Jun 15 and +2,500 on Dec 20.

| Independently verified result | Value |
| --- | ---: |
| Total inflows | 63,900.00 |
| Total outflows | −49,526.33 |
| Net modeled cashflow | 14,373.67 |
| Ending cash | 17,873.67 |
| Lowest closing cash | 1,880.70 on Jun 15, 2026 |
| Net present value at 6% | 13,561.30 |
| Atomic cashflows / daily observations | 41 / 366 |

The Jan 1 deposit needs loan proceeds to arrive before it can be paid: opening cash 3,500 plus outflows −10,000 leaves a temporary gap of 6,500; the day's final balance is 5,500. This produces the retained ordering warning.

With opening cash reduced to zero, NPV stays **13,561.30**, the first shortfall is **100.00 on Jan 2, 2026**, and the lowest closing cash is **−1,619.30 on Jun 15**. These two illustrative scenarios demonstrate why value and liquidity must remain separate.
