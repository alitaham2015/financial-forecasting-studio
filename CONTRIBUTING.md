# Contributing

## Development setup

Install Python 3.11 or newer. No Python or JavaScript packages are required to run or test the application.

```console
python run.py
python -m unittest discover -v
```

Use a temporary data directory while developing workflows that create scenarios:

```console
python run.py --data-dir "<temporary-folder>"
```

## Change expectations

- Keep financial arithmetic in Python `Decimal` and serialize monetary values as strings.
- Add an independent expected value for changed financial behavior; do not derive the expected result from the implementation under test.
- Document new modeling conventions in `docs/FINANCIAL_DECISIONS.md`.
- Add storage and restart coverage for persistence changes.
- Add HTTP and security regression tests for server changes.
- Preserve keyboard access, visible focus, labels, and responsive behavior in interface changes.
- Never commit a real database, backup, export, or screenshot containing private data.

## Frontend formatting

Frontend files follow the repository's Prettier configuration. Formatting is a development convenience, not a runtime dependency.

```console
npx --yes prettier@3.9.6 --write web/app.js web/chart.js web/styles.css web/index.html
```

## Review checklist

- [ ] The full test suite passes.
- [ ] New behavior has focused tests.
- [ ] Financial decisions and user-facing assumptions agree.
- [ ] No real financial or personal data is included.
- [ ] README and architecture documentation remain accurate.
- [ ] Interface changes were checked with keyboard navigation and a narrow viewport.
