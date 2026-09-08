import sys

from studio.server import main


if sys.version_info < (3, 11):
    raise SystemExit("Financial Forecasting Studio requires Python 3.11 or newer.")

if __name__ == "__main__":
    main()
