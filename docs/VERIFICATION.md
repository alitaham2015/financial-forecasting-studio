# Verification record

The application was built in the empty workspace from the supplied product specification and verified on Windows with Python 3.14.6 and the Codex Chromium browser. The core uses only the Python standard library; the interface uses local HTML, CSS, SVG, and JavaScript modules.

## Automated verification

Command: `python -m unittest discover -v`

**87 tests pass.** Expected financial values use hand-calculated decimal examples, exact `Fraction` arithmetic, an independent integer-cents loan ledger, and an independently written discounted-cashflow expression for the combined plan. Identity and repeatability checks supplement those independent oracles. A binary-floating-point formula is used only in one independent test oracle, never in the application's monetary calculations.

| Required verification | Evidence |
| --- | --- |
| Both loan formulas and supported methods | Two-payment hand example, published annuity example checked with exact rational arithmetic, known-payment inverse and equivalent schedules |
| Zero-interest loans | Principal and payment methods, 100 split over three payments |
| All rate bases | Nominal monthly/quarterly/yearly; exact effective monthly/quarterly/yearly examples; equivalent three-basis schedules; negative effective quarterly conversion |
| Investment behavior | Full compounding, periodic payouts, capital returned separately, zero and negative interest |
| Full and partial periods | Exact 3.5-period example, shorter-than-one-period deposits, full maturity, February stub and converted-rate equivalence |
| Income and expense growth | Annual versus every-payment, first-payment anchor, decline, fixed payments, unrounded growth basis, leap anniversary |
| Monthly/quarterly/yearly scheduling | Explicit expected dates and original-anchor restoration |
| Month ends and leap years | Jan 31, Aug 31, February 28/29, annual leap-day return |
| 30/360 interpretation | Seven independent 30E/360 date pairs and an NPV example using 29 interest days |
| Rounding and final reconciliation | Half-away-from-zero signs, zero/2/3-decimal currencies, tiny loans, 1–360-payment independent integer ledger |
| Signed custom rows | Positive, negative, neutral and same-date rows retained separately |
| Daily cash balance | Inclusive leap-day timeline, carry-forward days, exact 0.10 + 0.20 − 0.30 |
| First shortfall and lowest balance | Separate dates, tie handling and zero boundary |
| Same-day warnings | All condition boundaries, recovery day, acceptance required by confirmation interface |
| Independently calculated NPV | One-year and fractional-year exact examples, zero and negative discount rates, rounding once after summation |
| Opening cash excluded | Opening-cash edits alter feasibility and ending cash but leave NPV unchanged |
| Equivalent loan inputs | Identical posted schedules for matching rounded principal/payment inputs and all three rate bases |
| Combined scenario | All five object types; independent totals and NPV; 41 payments and 366 daily observations |
| Persistence and recalculation | New Store instance, a separately launched Python process, object edits, opening-cash edits, confirmation invalidation |

Storage and HTTP integration tests also verify transactional creation, editing, duplication, deletion, independent custom copies, stale-revision protection, atomic backup import, financially incomplete draft saving, validation at confirmation, and preservation of previously saved data after rejected requests. All tests use isolated temporary databases.

The HTTP server is checked for loopback binding, same-origin mutation checks, Host validation against DNS rebinding, no CORS permission, no caching of private responses, and refusal to serve database or source files. There are no external runtime assets or network calls.

## Browser workflow verification

The local application was run at `http://127.0.0.1:8765`. Principal screens inspected visually include the scenario library, overview and chart, financial object cards, scenario assumptions editor, all five object editors, loan payment details, daily date inspector, assumptions and conventions, validation review, and confirmation with a payment-order warning. Desktop and narrow responsive layouts were exercised.

The browser workflow included:

1. Load the optional realistic combined scenario and inspect its results.
2. Confirm that the warning acceptance checkbox is required, accept it, confirm the scenario, and verify that written warnings remain.
3. Inspect the loan's posted interest, principal, final payment adjustment and zero remaining obligation.
4. Inspect Jun 15, 2026 and its exact cash shortfall cause/contribution.
5. Duplicate the scenario; lower opening cash to zero; verify the resulting first shortfall while NPV stays unchanged.
6. Create a new blank scenario and add each of the five object types through the forms, including a loan described by payment, a periodic-interest investment, annual salary growth, every-payment expense growth and signed custom rows.
7. Enter an incorrectly signed expense, save it as a draft, verify results are withheld with a specific explanation, and correct it through the review link.
8. Copy a generated loan into a custom schedule, change one repayment to 950, and verify that the original loan still repays 1,000 per period.
9. Duplicate and delete a disposable object, and verify it disappears from the recalculated scenario.
10. Zoom, pan and hide a chart object's bars; verify that monetary result cards remain unchanged.
11. Use the keyboard to activate a payment bar and open its exact daily cash inspector.
12. Download payment CSV, daily-balance CSV and a JSON backup through the browser. HTTP integration tests independently parse the complete CSV reports and verify their final values.
13. Import a JSON fixture through the native file chooser, verify the restored scenario appears as an independent draft, then remove it.
14. Stop the running Python application, start a new server process against the same database, reload the browser and verify saved scenarios, edited schedules and recalculated results are retained.
15. Delete the complete disposable UI verification scenario through the application. The library then contains only the two intended illustrative plans.
16. Inspect the complete review dialog in the browser, including expandable inputs and custom rows. Confirm the lower-reserve example through the local HTTP interface and verify that a confirmed plan can still be infeasible; confirmation acknowledges inputs and warnings, not feasibility.

No page-level browser errors were recorded in the final workflow. A 390-pixel responsive viewport produced no document-level horizontal overflow; long tables and the chart scroll within their own panels. The retained baseline and lower-cash examples are illustrative manually entered data and can be deleted by the user.

## Defects corrected during verification

- SQLite context managers committed transactions but initially left handles open. The store now closes connections deterministically, including on failure, avoiding Windows file locks.
- Form cancel buttons explicitly use `type="button"` so cancellation cannot submit a form.
- Reused dialogs reset scroll position; custom cashflow rows become labeled stacked fields on narrow screens.
- Loan errors identify the input used by the selected method; custom-row errors identify the affected row and field.
- Custom schedule copies retain their source note and disclose double counting when the original remains included.
- Chart tooltip lookup uses maps rather than repeatedly searching every payment, keeping long schedules responsive.
- Zero-amount custom rows remain in reports but do not draw artificial inflow bars.
- The exact 100-calendar-year boundary prevents a recurring schedule from silently stopping before the stated term.
- Exponent notation is rejected so an entered monetary value cannot be misrepresented by display formatting.
- CSV and backup downloads use direct local HTTP attachment responses, avoiding inconsistent browser handling of generated blob downloads. Exported text is protected against spreadsheet-formula interpretation; monetary signs remain intact.
- Rejected cross-site request bodies are drained within a bounded size before closing the socket, preventing Windows from resetting the connection before the rejection response is received.

No calculation relies on a placeholder return, cached sample total, external credential, or unentered live rate.
