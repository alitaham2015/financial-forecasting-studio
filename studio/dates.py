"""Real calendar schedules; 30E/360 for financial fractions."""
from calendar import monthrange
from datetime import date, timedelta

FREQUENCIES = {"monthly": 1, "quarterly": 3, "yearly": 12}


def parse_date(value):
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Enter a complete date as YYYY-MM-DD.")
    result = date.fromisoformat(value)
    if result.isoformat() != value or not 1900 <= result.year <= 2199:
        raise ValueError("Use a date between 1900 and 2199.")
    return result


def add_months(anchor, months):
    """Always pass the original anchor, never the last clamped payment."""
    index = anchor.year * 12 + anchor.month - 1 + months
    year, month0 = divmod(index, 12)
    month = month0 + 1
    return date(year, month, min(anchor.day, monthrange(year, month)[1]))


def days360(start, end):
    """European 30E/360; February stays 28/29, both 31s become 30."""
    return (end.year-start.year)*360 + (end.month-start.month)*30 + min(end.day, 30)-min(start.day, 30)


def split_periods(start, end, months):
    """Whole calendar anniversaries plus a 30E/360 final stub."""
    n = max(0, ((end.year-start.year)*12 + end.month-start.month)//months)
    if add_months(start, n*months) > end:
        n -= 1
    last = add_months(start, n*months)
    return n, days360(last, end)


def schedule_dates(start, months, count=None, end=None, first=None):
    if first is not None:
        anchor, offset = first, 0
    else:
        anchor, offset = start, 1
    for k in range(count if count is not None else 1201):
        current = add_months(anchor, (k+offset)*months)
        if end is not None and current > end:
            break
        yield current


def calendar_days(start, end):
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)
