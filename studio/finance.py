"""All financial arithmetic stays in Decimal, with string JSON boundaries.

Only the chart renderer converts the already calculated strings to JS numbers.
See docs/FINANCIAL_DECISIONS.md for formulas and posting conventions.
"""
from collections import defaultdict
import re
from decimal import Decimal, localcontext, ROUND_HALF_UP, DecimalException
from .dates import parse_date, add_months, days360, split_periods, schedule_dates, calendar_days, FREQUENCIES

D = Decimal
CURRENCIES = {"USD": 2, "EUR": 2, "GBP": 2, "CAD": 2, "AUD": 2, "CHF": 2, "JPY": 0, "KWD": 3}
BASES = ("nominal", "effective", "periodic")
ENGINE_VERSION = "1.0.0"


class InvalidScenario(ValueError):
    def __init__(self, errors):
        self.errors = errors
        super().__init__("Review the highlighted assumptions before calculating.")


def decimal(value):
    if not isinstance(value, (str, int)) or isinstance(value, bool):
        raise ValueError("Enter a decimal number, without commas or a currency symbol.")
    if isinstance(value, str) and not re.fullmatch(r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)", value):
        raise ValueError("Enter a plain decimal number, without commas, exponent notation, or a currency symbol.")
    try:
        number = D(value)
    except (DecimalException, ValueError):
        raise ValueError("Enter a decimal number, without commas or a currency symbol.") from None
    if not number.is_finite():
        raise ValueError("Enter a finite decimal number.")
    return number


def money(value, digits=2):
    result = value.quantize(D(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    return abs(result) if result == 0 else result


def periodic_rate(rate, basis, frequency):
    rate = decimal(rate)/100
    periods = D(12)/FREQUENCIES[frequency]
    if basis == "nominal":
        return rate/periods
    if basis == "effective":
        return (1+rate)**(1/periods)-1
    if basis == "periodic":
        return rate
    raise ValueError("Select the meaning of this rate.")


def validate(scenario):
    errors = []
    def error(path, message):
        errors.append({"path": path, "message": message})
    def text(value, path):
        if not isinstance(value, str) or not value.strip() or len(value) > 120:
            error(path, "Enter a name between 1 and 120 characters.")
    def date_value(value, path):
        try:
            return parse_date(value)
        except (ValueError, TypeError):
            error(path, "Enter a valid calendar date between 1900 and 2199.")
    def number(value, path, kind="amount", signed=False):
        try:
            n = decimal(value)
            if len(str(value)) > 50 or abs(n) > (D(1000) if kind == "rate" else D("1000000000000")):
                raise ValueError("Value is outside the supported range (rates up to 1,000%; amounts up to one trillion).")
            if kind == "rate":
                if n <= -100:
                    raise ValueError("The rate must be greater than -100%.")
            else:
                if n != money(n, digits):
                    raise ValueError(f"Use no more than {digits} decimal places for {currency} amounts.")
                if not signed and n <= 0:
                    raise ValueError("Enter an amount greater than zero; the object supplies its sign.")
            return n
        except (ValueError, DecimalException) as exc:
            error(path, str(exc))
    if not isinstance(scenario, dict):
        return [{"path": "scenario", "message": "A scenario must contain a set of named assumptions."}]
    currency = scenario.get("currency", "USD")
    digits = CURRENCIES.get(currency, 2)
    if currency not in CURRENCIES:
        error("currency", "Select a supported currency. All objects use this one currency.")
    text(scenario.get("name"), "name")
    start = date_value(scenario.get("start"), "start")
    end = date_value(scenario.get("end"), "end")
    if start and end and (end <= start or end > add_months(start, 1200)):
        error("end", "The end must be after the start, with a horizon no longer than 100 years.")
    opening = number(scenario.get("openingCash"), "openingCash", signed=True)
    if opening is not None and opening < 0:
        error("openingCash", "Opening cash must be zero or positive. Model an immediate obligation as a negative custom cashflow.")
    number(scenario.get("discountRate"), "discountRate", "rate")
    objects = scenario.get("objects")
    if not isinstance(objects, list) or len(objects) > 200:
        error("objects", "Use a list of at most 200 financial objects.")
        return errors
    ids = set()
    rows_count = 0
    for index, obj in enumerate(objects):
        path = f"objects.{index}"
        if not isinstance(obj, dict):
            error(path, "This object must contain named assumptions.")
            continue
        text(obj.get("name"), path+".name")
        ident = obj.get("id")
        if not isinstance(ident, str) or not ident or len(ident) > 80 or ident in ids:
            error(path+".id", "Each object needs a unique identifier.")
        if isinstance(ident, str):
            ids.add(ident)
        kind = obj.get("type")
        if kind not in ("loan", "investment", "income", "expense", "custom"):
            error(path+".type", "Select a supported financial object type.")
            continue
        if kind == "custom":
            rows = obj.get("rows")
            if not isinstance(rows, list) or not rows or len(rows) > 10000:
                error(path+".rows", "Add between 1 and 10,000 dated cashflow rows.")
                continue
            rows_count += len(rows)
            for j, row in enumerate(rows):
                rp = f"{path}.rows.{j}"
                if not isinstance(row, dict):
                    error(rp, "Enter a date and a signed amount.")
                    continue
                rd = date_value(row.get("date"), rp+".date")
                number(row.get("amount"), rp+".amount", signed=True)
                if len(str(row.get("note", ""))) > 300:
                    error(rp+".note", "Keep the row note under 300 characters.")
                if rd and start and end and not start <= rd <= end:
                    error(rp+".date", "This cashflow is outside the scenario. Extend the horizon or change the row date.")
            continue
        os = date_value(obj.get("start"), path+".start")
        if os and start and end and not start <= os <= end:
            error(path+".start", "The object must start inside the scenario horizon.")
        frequency = obj.get("frequency")
        if frequency not in FREQUENCIES:
            error(path+".frequency", "Select monthly, quarterly, or yearly.")
        first = None
        if kind != "investment" and obj.get("firstPayment"):
            first = date_value(obj["firstPayment"], path+".firstPayment")
            if first and os and first < os:
                error(path+".firstPayment", "The first payment cannot be before the object starts.")
        if kind in ("loan", "investment"):
            number(obj.get("rate"), path+".rate", "rate")
            if obj.get("rateBasis") not in BASES:
                error(path+".rateBasis", "Select whether the rate is annual nominal, annual effective, or per period.")
        if kind == "loan":
            method = obj.get("method")
            if method not in ("principal", "payment"):
                error(path+".method", "Choose known principal or known payment.")
            else:
                number(obj.get(method), path+"."+method)
                other = "payment" if method == "principal" else "principal"
                if obj.get(other) not in (None, ""):
                    error(path+"."+other, "Enter only the value for the selected loan method; the other value is calculated.")
            count = obj.get("payments")
            if not isinstance(count, int) or isinstance(count, bool) or not 1 <= count <= 1200:
                error(path+".payments", "Enter a whole number of payments between 1 and 1,200.")
            elif os and frequency in FREQUENCIES:
                try:
                    last = list(schedule_dates(os, FREQUENCIES[frequency], count=count, first=first))[-1]
                    if end and last > end:
                        error(path+".payments", f"The last repayment is {last}. Extend the scenario to include it.")
                except ValueError:
                    error(path+".payments", "This loan extends beyond the supported calendar.")
        else:
            number(obj.get("amount"), path+".amount")
            oe = date_value(obj.get("end"), path+".end")
            if oe and end and oe > end:
                error(path+".end", "Include the object's complete term. Extend the scenario end date.")
            if os and oe and (oe < os or (kind == "investment" and oe == os)):
                error(path+".end", "Maturity must follow the deposit date." if kind == "investment" else "The end cannot be before the start.")
            if kind == "investment":
                if obj.get("payout") not in ("maturity", "periodic"):
                    error(path+".payout", "Select at maturity or interest as earned.")
            else:
                if obj.get("growthMode") not in ("none", "annual", "payment"):
                    error(path+".growthMode", "Select fixed, annual anniversary, or every-payment growth.")
                number(obj.get("growthRate", "0"), path+".growthRate", "rate")
                if obj.get("growthMode") == "none" and str(obj.get("growthRate", "0")) not in ("0", "0.0", "0.00", ""):
                    try:
                        if decimal(obj.get("growthRate")) != 0:
                            error(path+".growthRate", "Use zero growth with fixed payments, or select a growth mechanism.")
                    except ValueError:
                        pass
                if os and oe and frequency in FREQUENCIES:
                    fd = first or add_months(os, FREQUENCIES[frequency])
                    if fd > oe:
                        error(path+".firstPayment", "No payment fits in this term. Set an earlier first payment or a later end date.")
    if rows_count > 25000:
        error("objects", "Limit the scenario to 25,000 custom rows.")
    return errors


def generate(obj, digits):
    flows, notes, details = [], [], {}
    def emit(date, amount, rule, **fields):
        amount = money(amount, digits)
        if abs(amount) > D("1e18"):
            raise ValueError("A generated payment exceeds 10^18 currency units. Reduce the amount, term, or growth rate.")
        flows.append({"id": f"{obj['id']}:{len(flows)}", "objectId": obj["id"], "objectName": obj["name"], "type": obj["type"], "date": date.isoformat(), "amount": format(amount, "f"), "rule": rule, **{k: format(v, "f") if isinstance(v, D) else v for k, v in fields.items()}})
    kind = obj["type"]
    if kind == "custom":
        for row in obj["rows"]:
            emit(parse_date(row["date"]), decimal(row["amount"]), row.get("note") or "Custom dated cashflow")
        if obj.get("copiedFrom"):
            notes.append("This is an independent schedule copy. Including it alongside its original counts both sets of cashflows.")
        return flows, notes, details
    start = parse_date(obj["start"])
    months = FREQUENCIES[obj["frequency"]]
    first = parse_date(obj["firstPayment"]) if obj.get("firstPayment") else None
    if kind in ("loan", "investment"):
        i = periodic_rate(obj["rate"], obj["rateBasis"], obj["frequency"])
        details["periodicRatePercent"] = format(i*100, ".12f")
        if i < 0:
            notes.append("A negative interest rate is modeled explicitly: loan interest reduces the obligation; paid investment interest is a cash charge.")
    if kind == "loan":
        n = obj["payments"]
        dates = list(schedule_dates(start, months, count=n, first=first))
        whole, stub = split_periods(start, dates[0], months)
        initial_factor = (1+i)**whole * (1+i*D(stub)/(months*30))
        annuity = D(n) if i == 0 else (1-(1+i)**(-n))/i
        factor = annuity*(1+i)/initial_factor
        if obj["method"] == "principal":
            principal = decimal(obj["principal"])
            regular = money(principal/factor, digits)
        else:
            regular = decimal(obj["payment"])
            principal = money(regular*factor, digits)
        if principal <= 0:
            raise ValueError("The derived principal rounds to zero. Increase the payment or shorten the term.")
        balance = principal
        emit(start, principal, "Loan proceeds", remaining=principal)
        interest_total = D(0)
        for k, due in enumerate(dates):
            interest = money(balance*((initial_factor-1) if k == 0 else i), digits)
            owing = balance+interest
            payment = owing if k == n-1 else min(regular, owing)
            paid_principal = payment-interest
            balance = owing-payment
            interest_total += interest
            emit(due, -payment, f"Repayment {k+1} of {n}" + (" · reconciled final payment" if k == n-1 else ""), interest=interest, principal=paid_principal, remaining=balance)
        adjustment = -decimal(flows[-1]["amount"])-regular
        details.update(principal=format(principal, "f"), regularPayment=format(regular, "f"), finalPayment=format(-decimal(flows[-1]["amount"]), "f"), finalAdjustment=format(adjustment, "f"), totalInterest=format(interest_total, "f"), finalBalance=format(balance, "f"), firstPeriodFactor=format(initial_factor, ".12f"))
        if first is not None and first != add_months(start, months):
            notes.append(f"The first repayment uses {whole} whole period(s) and {stub} days under 30E/360. Later payments follow the first payment's calendar day.")
        if regular == 0 or abs(adjustment) > max(D(1), abs(regular)*D("0.01")):
            notes.append("Currency rounding materially changes the final payment. Inspect the full repayment schedule before relying on a level-payment amount.")
    elif kind == "investment":
        amount = decimal(obj["amount"])
        end = parse_date(obj["end"])
        whole, stub = split_periods(start, end, months)
        accrued = amount*(1+i)**whole
        base = accrued if obj["payout"] == "maturity" else amount
        partial = base*i*D(stub)/(months*30)
        emit(start, -amount, "Investment deposit")
        if obj["payout"] == "maturity":
            emit(end, accrued+partial, f"Capital and compounded interest · {whole} full period(s), {stub} stub day(s)")
        else:
            for k in range(1, whole+1):
                emit(add_months(start, k*months), amount*i, f"Interest payout {k} · original principal, no compounding")
            if stub:
                emit(end, partial, f"Partial interest · {stub} days under 30E/360")
            emit(end, amount, "Return of original investment capital")
        details.update(fullPeriods=whole, partialDays=stub, fullPeriodValue=format(money(accrued if obj["payout"] == "maturity" else amount, digits), "f"), partialInterest=format(money(partial, digits), "f"), stubAnnualRatePercent=format(i*(D(12)/months)*100, ".12f"))
        if stub or whole == 0:
            notes.append(f"Final stub: {stub} interest day(s), using periodic rate × periods per year; interest applies to {'accumulated capital' if obj['payout']=='maturity' else 'original principal'}.")
    else:
        amount = decimal(obj["amount"])
        growth = decimal(obj.get("growthRate", "0"))/100
        dates = list(schedule_dates(start, months, end=parse_date(obj["end"]), first=first))
        origin = dates[0]
        for k, due in enumerate(dates):
            if obj["growthMode"] == "annual":
                steps = due.year-origin.year
                if due < add_months(origin, steps*12):
                    steps -= 1
            else:
                steps = k if obj["growthMode"] == "payment" else 0
            value = money(amount*(1+growth)**steps, digits)
            rule = "Fixed payment · no growth" if obj["growthMode"] == "none" else f"{'Annual anniversary' if obj['growthMode']=='annual' else 'Every-payment'} growth · {steps} growth step(s)"
            emit(due, value if kind == "income" else -value, rule)
        details.update(firstPayment=origin.isoformat(), payments=len(dates), growthAnchor=origin.isoformat())
    return flows, notes, details


def calculate(scenario):
    """Pure deterministic calculation: no database, clock, network, or floats."""
    with localcontext() as ctx:
        ctx.prec = 60
        ctx.rounding = ROUND_HALF_UP
        errors = validate(scenario)
        if errors:
            raise InvalidScenario(errors)
        digits = CURRENCIES[scenario["currency"]]
        flows, objects, assumptions = [], [], []
        for index, obj in enumerate(scenario["objects"]):
            try:
                generated, notes, details = generate(obj, digits)
            except (ValueError, DecimalException, OverflowError) as exc:
                raise InvalidScenario([{"path": f"objects.{index}", "message": str(exc) or "These values exceed the supported numerical range."}]) from None
            flows.extend(generated)
            if len(flows) > 25000:
                raise InvalidScenario([{"path": "objects", "message": "The complete plan produces more than 25,000 payments. Shorten the horizon or simplify the objects."}])
            objects.append({"id": obj["id"], "name": obj["name"], "type": obj["type"], "count": len(generated), "net": format(money(sum((decimal(f["amount"]) for f in generated), D(0)), digits), "f"), "details": details, "notes": notes})
            assumptions.extend({"objectId": obj["id"], "objectName": obj["name"], "message": note} for note in notes)
        if len(flows) > 25000:
            raise InvalidScenario([{"path": "objects", "message": "The complete plan produces more than 25,000 payments. Shorten the horizon or simplify the objects."}])
        flows.sort(key=lambda f: (f["date"], f["objectId"], int(f["id"].rsplit(":", 1)[1])))
        start, end = parse_date(scenario["start"]), parse_date(scenario["end"])
        r = decimal(scenario["discountRate"])/100
        groups = defaultdict(list)
        pv_objects = defaultdict(lambda: D(0))
        factors = {}
        pv = inflows = outflows = D(0)
        for f in flows:
            day = parse_date(f["date"])
            if not start <= day <= end:
                raise InvalidScenario([{"path": "objects", "message": f"{f['objectName']} generates a payment on {day} outside the horizon."}])
            amt = decimal(f["amount"])
            t = days360(start, day)
            if t not in factors:
                factors[t] = (1+r)**(D(t)/360)
            value = amt/factors[t]
            if abs(value) > D("1e30"):
                raise InvalidScenario([{"path": "discountRate", "message": "This discount rate and horizon produce a present value above 10^30. Use a less extreme assumption."}])
            f.update(presentValue=format(money(value, digits), "f"), discountDays=t)
            pv += value
            pv_objects[f["objectId"]] += value
            if amt > 0:
                inflows += amt
            else:
                outflows += amt
            groups[f["date"]].append(f)
        balance = decimal(scenario["openingCash"])
        daily, warnings = [], []
        first_shortfall = lowest = None
        for day in calendar_days(start, end):
            key = day.isoformat()
            dated = groups[key]
            incoming = sum((decimal(f["amount"]) for f in dated if decimal(f["amount"]) > 0), D(0))
            outgoing = sum((decimal(f["amount"]) for f in dated if decimal(f["amount"]) < 0), D(0))
            before = balance
            balance += incoming+outgoing
            row = {"date": key, "opening": format(money(before, digits), "f"), "inflows": format(money(incoming, digits), "f"), "outflows": format(money(outgoing, digits), "f"), "net": format(money(incoming+outgoing, digits), "f"), "balance": format(money(balance, digits), "f"), "flowIds": [f["id"] for f in dated]}
            daily.append(row)
            if lowest is None or balance < decimal(lowest["balance"]):
                lowest = row
            if balance < 0 and first_shortfall is None:
                first_shortfall = {**row, "amount": format(money(-balance, digits), "f"), "causes": list(dict.fromkeys(f["objectName"] for f in dated if decimal(f["amount"]) < 0))}
            if incoming > 0 and outgoing < 0 and before+outgoing < 0 and balance >= 0:
                warnings.append({**row, "gap": format(money(-(before+outgoing), digits), "f"), "objects": list(dict.fromkeys(f["objectName"] for f in dated))})
            for f in dated:
                f["closingBalance"] = row["balance"]
        for obj in objects:
            obj["npv"] = format(money(pv_objects[obj["id"]], digits), "f")
        return {"engineVersion": ENGINE_VERSION, "currency": scenario["currency"], "digits": digits, "flows": flows, "daily": daily, "objects": objects, "warnings": warnings, "assumptions": assumptions, "summary": {"feasible": first_shortfall is None, "npv": format(money(pv, digits), "f"), "endingCash": format(money(balance, digits), "f"), "lowest": lowest, "firstShortfall": first_shortfall, "totalInflows": format(money(inflows, digits), "f"), "totalOutflows": format(money(outflows, digits), "f"), "netCashflow": format(money(inflows+outflows, digits), "f"), "openingCash": format(money(decimal(scenario["openingCash"]), digits), "f")}}
