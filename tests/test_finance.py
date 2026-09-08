"""Independent expected values: hand arithmetic, exact Fractions and published examples.

Assertions never derive expected values by calling the production calculation
being tested. Tests of identities supplement, but do not replace, fixed examples.
"""
import copy
import json
import unittest
from datetime import date
from decimal import Decimal as D, localcontext
from fractions import Fraction
from studio.dates import add_months, days360, split_periods, schedule_dates
from studio.finance import calculate, validate, InvalidScenario, money, periodic_rate
from studio.storage import demo_scenario


def scenario(objects=None, **changes):
    return {"name": "Verification plan", "start": "2024-01-01", "end": "2027-12-31", "openingCash": "0.00", "discountRate": "0", "currency": "USD", "objects": objects or [], **changes}


def loan(**changes):
    return {"id": "loan", "type": "loan", "name": "Loan", "start": "2024-01-01", "frequency": "monthly", "firstPayment": "", "rate": "12", "rateBasis": "nominal", "method": "principal", "principal": "1000.00", "payments": 2, **changes}


def investment(**changes):
    return {"id": "investment", "type": "investment", "name": "Deposit", "start": "2024-01-01", "end": "2024-04-16", "amount": "1000.00", "frequency": "monthly", "rate": "12", "rateBasis": "nominal", "payout": "maturity", **changes}


def recurring(**changes):
    return {"id": "recurring", "type": "income", "name": "Salary", "start": "2024-01-01", "end": "2025-02-01", "firstPayment": "2024-01-01", "frequency": "monthly", "amount": "100.00", "growthMode": "annual", "growthRate": "10", **changes}


def custom(rows, **changes):
    return {"id": "custom", "type": "custom", "name": "Dated payments", "rows": [{"date": d, "amount": a} for d,a in rows], **changes}


def cents(fraction):
    """Independent integer half-away-from-zero rounding for exact rational numbers."""
    value = Fraction(fraction)*100
    sign = -1 if value < 0 else 1
    numerator, denominator = abs(value.numerator), value.denominator
    return sign*((2*numerator+denominator)//(2*denominator))


class CalendarTests(unittest.TestCase):
    def test_monthly_original_anchor(self):
        dates = list(schedule_dates(date(2024,1,31),1,count=4))
        self.assertEqual([d.isoformat() for d in dates], ["2024-02-29","2024-03-31","2024-04-30","2024-05-31"])

    def test_non_leap_and_no_drift(self):
        self.assertEqual([add_months(date(2023,1,31),n).isoformat() for n in [1,2,13]], ["2023-02-28","2023-03-31","2024-02-29"])

    def test_quarterly_anchor(self):
        self.assertEqual([d.isoformat() for d in schedule_dates(date(2024,8,31),3,count=3)], ["2024-11-30","2025-02-28","2025-05-31"])

    def test_yearly_leap_anchor(self):
        self.assertEqual([d.isoformat() for d in schedule_dates(date(2024,2,29),12,count=4)], ["2025-02-28","2026-02-28","2027-02-28","2028-02-29"])

    def test_explicit_first_date_becomes_anchor(self):
        self.assertEqual([d.isoformat() for d in schedule_dates(date(2024,1,1),1,count=3,first=date(2024,1,31))], ["2024-01-31","2024-02-29","2024-03-31"])

    def test_30e_360_known_date_pairs(self):
        pairs=[('2023-01-31','2023-02-28',28),('2024-01-31','2024-02-29',29),('2024-02-29','2024-03-31',31),('2023-02-28','2023-03-31',32),('2024-01-30','2024-01-31',0),('2024-01-31','2025-01-31',360),('2024-08-31','2024-11-30',90)]
        for a,b,expected in pairs:
            with self.subTest(a=a,b=b):
                self.assertEqual(days360(date.fromisoformat(a),date.fromisoformat(b)),expected)

    def test_calendar_full_period_overrides_stub_fraction(self):
        self.assertEqual(split_periods(date(2024,1,31),date(2024,2,29),1),(1,0))
        self.assertEqual(split_periods(date(2024,1,1),date(2024,4,16),1),(3,15))


class RateAndRoundingTests(unittest.TestCase):
    def test_nominal_frequencies(self):
        for freq,expected in [('monthly','0.01'),('quarterly','0.03'),('yearly','0.12')]:
            self.assertEqual(periodic_rate('12','nominal',freq),D(expected))

    def test_exact_effective_root(self):
        # (1.1)^4 - 1 = 0.4641, so quarterly periodic rate is exactly 10%.
        self.assertEqual(periodic_rate('46.41','effective','quarterly'),D('0.1'))

    def test_periodic_basis(self):
        for freq in ['monthly','quarterly','yearly']:
            self.assertEqual(periodic_rate('1.25','periodic',freq),D('.0125'))

    def test_effective_monthly_and_negative_quarterly(self):
        with localcontext() as ctx:
            ctx.prec=60
            monthly=periodic_rate('12.6825030131969720661201','effective','monthly')
            self.assertLess(abs(monthly-D('.01')),D('1e-55'))
            self.assertEqual(periodic_rate('-34.39','effective','quarterly'),D('-.1'))
            self.assertEqual(periodic_rate('8','effective','yearly'),D('.08'))

    def test_half_away_rounding_and_currency_precision(self):
        for raw,digits,expected in [('1.005',2,'1.01'),('-1.005',2,'-1.01'),('1.0049',2,'1.00'),('1.5',0,'2'),('-1.5',0,'-2'),('1.2345',3,'1.235'),('-0.0001',2,'0.00')]:
            self.assertEqual(str(money(D(raw),digits)),expected)

    def test_money_never_crosses_float_boundary(self):
        r=calculate(scenario([custom([('2024-01-01','.10'),('2024-01-01','.20'),('2024-01-02','-.30')])]))
        self.assertEqual(r['daily'][0]['balance'],'0.30')
        self.assertEqual(r['daily'][1]['balance'],'0.00')
        def check(value):
            self.assertNotIsInstance(value,float)
            if isinstance(value,dict):
                for v in value.values():check(v)
            if isinstance(value,list):
                for v in value:check(v)
        check(r)


class LoanTests(unittest.TestCase):
    def test_known_principal_two_payment_hand_example(self):
        # P=1000*0.01/(1-1.01^-2) = 102010/201 = 507.512437...
        r=calculate(scenario([loan()]))
        self.assertEqual([f['amount'] for f in r['flows']],['1000.00','-507.51','-507.51'])
        self.assertEqual([f.get('interest') for f in r['flows'][1:]],['10.00','5.02'])
        self.assertEqual([f['remaining'] for f in r['flows']],['1000.00','502.49','0.00'])

    def test_known_payment_independent_principal(self):
        obj=loan(method='payment',payment='507.51');obj.pop('principal')
        # 507.51 * (1/1.01 + 1/1.01^2) = 999.9951965..., rounded 1000.00.
        self.assertEqual(cents(Fraction(50751,100)*(Fraction(100,101)+Fraction(10000,10201))),100000)
        r=calculate(scenario([obj]))
        self.assertEqual(r['objects'][0]['details']['principal'],'1000.00')
        self.assertEqual([f['amount'] for f in r['flows']],['1000.00','-507.51','-507.51'])

    def test_equivalent_loan_methods(self):
        known=loan(method='payment',payment='507.51');known.pop('principal')
        a=calculate(scenario([loan()]))['flows'];b=calculate(scenario([known]))['flows']
        self.assertEqual(a,b)

    def test_zero_interest_and_final_reconciliation(self):
        r=calculate(scenario([loan(principal='100.00',rate='0',payments=3)]))
        self.assertEqual([f['amount'] for f in r['flows']],['100.00','-33.33','-33.33','-33.34'])
        self.assertEqual(r['objects'][0]['details']['finalBalance'],'0.00')
        self.assertEqual(r['objects'][0]['details']['finalAdjustment'],'0.01')

    def test_zero_interest_known_payment(self):
        obj=loan(method='payment',payment='33.33',rate='0',payments=3);obj.pop('principal')
        r=calculate(scenario([obj]))
        self.assertEqual([f['amount'] for f in r['flows']],['99.99','-33.33','-33.33','-33.33'])

    def test_published_openstax_payment(self):
        # OpenStax Principles of Finance: 75,000; 3%; 5 annual installments.
        s=scenario([loan(principal='75000.00',rate='3',payments=5,frequency='yearly')],end='2029-01-01')
        r=calculate(s)
        self.assertEqual(r['objects'][0]['details']['regularPayment'],'16376.59')
        # Exact rational check is more accurate than the source's six-place factor (16,376.60).
        exact=Fraction(75000,1)/sum((Fraction(100,103)**k for k in range(1,6)),Fraction(0))
        self.assertEqual(cents(exact),1637659)

    def test_three_rate_bases_equivalent(self):
        variants=[loan(rate='40',rateBasis='nominal',frequency='quarterly'),loan(rate='46.41',rateBasis='effective',frequency='quarterly'),loan(rate='10',rateBasis='periodic',frequency='quarterly')]
        flows=[calculate(scenario([o]))['flows'] for o in variants]
        self.assertEqual(flows[0],flows[1]);self.assertEqual(flows[1],flows[2])

    def test_delayed_first_payment_consistent_both_methods(self):
        # One repayment after 2 months and 15 days: 1000*1.01^2*1.005=1025.2005.
        first='2024-03-16'
        a=calculate(scenario([loan(payments=1,firstPayment=first)]))
        self.assertEqual(a['flows'][-1]['amount'],'-1025.20')
        obj=loan(payments=1,firstPayment=first,method='payment',payment='1025.20');obj.pop('principal')
        b=calculate(scenario([obj]))
        self.assertEqual(a['flows'],b['flows'])

    def test_first_payment_on_receipt_annuity_due(self):
        # 1000/(1+1/1.01)=502.487562..., first immediate, second one month later.
        r=calculate(scenario([loan(firstPayment='2024-01-01')]))
        payments=[f for f in r['flows'] if 'interest' in f]
        self.assertEqual([f['amount'] for f in payments],['-502.49','-502.49'])
        self.assertEqual([f['interest'] for f in payments],['0.00','4.98'])

    def test_end_of_month_full_loan_period(self):
        r=calculate(scenario([loan(start='2024-01-31',payments=3)]))
        self.assertEqual([f['date'] for f in r['flows'][1:]],['2024-02-29','2024-03-31','2024-04-30'])
        self.assertEqual(r['flows'][1]['interest'],'10.00')

    def test_negative_interest_loan(self):
        r=calculate(scenario([loan(rate='-12',payments=1)]))
        self.assertEqual(r['flows'][-1]['amount'],'-990.00')
        self.assertEqual(r['flows'][-1]['interest'],'-10.00')

    def test_tiny_loan_does_not_overpay_or_create_negative_obligation(self):
        r=calculate(scenario([loan(principal='0.02',rate='0',payments=3)]))
        self.assertEqual([f['amount'] for f in r['flows']],['0.02','-0.01','-0.01','0.00'])
        self.assertEqual(r['flows'][-1]['remaining'],'0.00')

    def test_reconciliation_matrix_independent_integer_ledger(self):
        # Independent cents ledger for fixed annual nominal 12% => 1% monthly.
        for principal in [10000,100001,1234567]:
            for n in [1,12,60,360]:
                with self.subTest(principal=principal,n=n):
                    s=scenario([loan(principal=f'{principal//100}.{principal%100:02}',payments=n)],end='2054-01-01')
                    r=calculate(s);balance=principal
                    exact_payment=Fraction(principal,100)/sum((Fraction(100,101)**k for k in range(1,n+1)),Fraction(0))
                    regular=cents(exact_payment)
                    self.assertEqual(int(D(r['objects'][0]['details']['regularPayment'])*100),regular)
                    for k,f in enumerate(r['flows'][1:]):
                        interest=(balance+50)//100
                        pay=balance+interest if k==n-1 else min(regular,balance+interest)
                        balance+=interest-pay
                        self.assertEqual(int(D(f['amount'])*-100),pay)
                        self.assertEqual(int(D(f['remaining'])*100),balance)
                    self.assertEqual(balance,0)


class InvestmentTests(unittest.TestCase):
    def test_maturity_compounds_full_periods_and_stub(self):
        # 1000*1.01^3 = 1030.301; stub 0.5% = 5.151505; total 1035.452505.
        r=calculate(scenario([investment()]))
        self.assertEqual([f['amount'] for f in r['flows']],['-1000.00','1035.45'])
        details=r['objects'][0]['details']
        self.assertEqual(details['fullPeriods'],3);self.assertEqual(details['partialDays'],15)
        self.assertEqual(details['partialInterest'],'5.15')

    def test_periodic_interest_never_compounds(self):
        r=calculate(scenario([investment(payout='periodic')]))
        self.assertEqual([f['amount'] for f in r['flows']],['-1000.00','10.00','10.00','10.00','5.00','1000.00'])

    def test_full_period_maturity_no_extra_stub(self):
        for payout,expected in [('maturity',['-1000.00','1030.30']),('periodic',['-1000.00','10.00','10.00','10.00','1000.00'])]:
            r=calculate(scenario([investment(end='2024-04-01',payout=payout)]))
            self.assertEqual([f['amount'] for f in r['flows']],expected)
            self.assertEqual(r['objects'][0]['details']['partialDays'],0)

    def test_less_than_one_period(self):
        r=calculate(scenario([investment(end='2024-01-16')]))
        self.assertEqual([f['amount'] for f in r['flows']],['-1000.00','1005.00'])

    def test_rate_basis_normalizes_stub(self):
        # quarterly i=10%; a 45/90 quarter stub earns 5%, for all bases.
        for basis,rate in [('nominal','40'),('effective','46.41'),('periodic','10')]:
            r=calculate(scenario([investment(frequency='quarterly',end='2024-02-16',rate=rate,rateBasis=basis)]))
            self.assertEqual(r['flows'][-1]['amount'],'1050.00')

    def test_quarterly_and_yearly_investment_dates(self):
        r=calculate(scenario([investment(start='2024-08-31',end='2025-05-31',frequency='quarterly',payout='periodic')]))
        self.assertEqual([f['date'] for f in r['flows']],['2024-08-31','2024-11-30','2025-02-28','2025-05-31','2025-05-31'])
        r=calculate(scenario([investment(start='2024-02-29',end='2026-02-28',frequency='yearly',payout='periodic')]))
        self.assertEqual([f['date'] for f in r['flows']],['2024-02-29','2025-02-28','2026-02-28','2026-02-28'])

    def test_january_31_february_stub_and_full_period(self):
        for end,expected in [('2024-02-28','1009.33'),('2024-02-29','1010.00')]:
            r=calculate(scenario([investment(start='2024-01-31',end=end)]))
            self.assertEqual(r['flows'][-1]['amount'],expected)

    def test_negative_rates_and_zero(self):
        r=calculate(scenario([investment(end='2024-02-01',rate='-12',payout='periodic')]))
        self.assertEqual([f['amount'] for f in r['flows']],['-1000.00','-10.00','1000.00'])
        r=calculate(scenario([investment(rate='0')]))
        self.assertEqual(r['flows'][-1]['amount'],'1000.00')

    def test_interest_rounding_each_posting(self):
        r=calculate(scenario([investment(amount='1.00',rate='6',end='2024-04-01',payout='periodic')]))
        self.assertEqual([f['amount'] for f in r['flows']],['-1.00','0.01','0.01','0.01','1.00'])


class GrowthTests(unittest.TestCase):
    def test_annual_growth_changes_once_not_every_month(self):
        flows=calculate(scenario([recurring()]))['flows']
        self.assertEqual([f['amount'] for f in flows],['100.00']*12+['110.00']*2)

    def test_every_payment_growth_first_unchanged(self):
        flows=calculate(scenario([recurring(growthMode='payment',end='2024-04-01')]))['flows']
        self.assertEqual([f['amount'] for f in flows],['100.00','110.00','121.00','133.10'])

    def test_growth_uses_unrounded_base(self):
        flows=calculate(scenario([recurring(amount='1.00',growthMode='payment',growthRate='0.5',end='2024-04-01')]))['flows']
        # 1, 1.005, 1.010025, 1.015075125 -> 1.00,1.01,1.01,1.02.
        self.assertEqual([f['amount'] for f in flows],['1.00','1.01','1.01','1.02'])

    def test_declining_expense_sign_remains_negative(self):
        flows=calculate(scenario([recurring(type='expense',growthMode='payment',growthRate='-10',end='2024-03-01')]))['flows']
        self.assertEqual([f['amount'] for f in flows],['-100.00','-90.00','-81.00'])

    def test_zero_growth_fixed(self):
        flows=calculate(scenario([recurring(growthMode='none',growthRate='0',end='2024-03-01')]))['flows']
        self.assertEqual([f['amount'] for f in flows],['100.00']*3)

    def test_default_first_after_full_period_and_growth_from_first_payment(self):
        flows=calculate(scenario([recurring(firstPayment='',end='2025-02-01')]))['flows']
        self.assertEqual(flows[0]['date'],'2024-02-01')
        self.assertEqual(flows[-2]['amount'],'100.00')
        self.assertEqual(flows[-1]['amount'],'110.00')

    def test_leap_growth_anniversary(self):
        flows=calculate(scenario([recurring(start='2024-02-29',firstPayment='2024-02-29',end='2025-03-31')]))['flows']
        self.assertEqual(flows[12]['date'],'2025-02-28');self.assertEqual(flows[12]['amount'],'110.00')
        self.assertEqual(flows[13]['date'],'2025-03-29')

    def test_yearly_first_payment_is_base_then_anniversary_growth(self):
        flows=calculate(scenario([recurring(firstPayment='',frequency='yearly',end='2026-01-01')]))['flows']
        self.assertEqual([f['amount'] for f in flows],['100.00','110.00'])


class LiquidityAndNPVTests(unittest.TestCase):
    def test_all_days_start_end_and_idle_days(self):
        r=calculate(scenario([custom([('2024-02-28','10'),('2024-03-01','-3')])],start='2024-02-28',end='2024-03-02',openingCash='5'))
        self.assertEqual([d['date'] for d in r['daily']],['2024-02-28','2024-02-29','2024-03-01','2024-03-02'])
        self.assertEqual([d['balance'] for d in r['daily']],['15.00','15.00','12.00','12.00'])

    def test_first_shortfall_and_lowest_are_different(self):
        r=calculate(scenario([custom([('2024-01-02','-15'),('2024-01-03','-10'),('2024-01-04','30')])],end='2024-01-05',openingCash='10'))
        s=r['summary'];self.assertFalse(s['feasible']);self.assertEqual(s['firstShortfall']['date'],'2024-01-02');self.assertEqual(s['firstShortfall']['amount'],'5.00');self.assertEqual(s['lowest']['date'],'2024-01-03');self.assertEqual(s['lowest']['balance'],'-15.00')

    def test_lowest_first_occurrence_and_zero_is_feasible(self):
        r=calculate(scenario([custom([('2024-01-03','10')])],end='2024-01-05'))
        self.assertTrue(r['summary']['feasible']);self.assertEqual(r['summary']['lowest']['date'],'2024-01-01')

    def test_same_day_warning_exact_boundary_cases(self):
        cases=[('0','100','-100',True),('100','100','-100',False),('10','5','-20',False),('0','100','0',False),('10','0','-10',False)]
        for opening,received,paid,warning in cases:
            r=calculate(scenario([custom([('2024-01-01',received),('2024-01-01',paid)])],openingCash=opening))
            self.assertEqual(bool(r['warnings']),warning)
        r=calculate(scenario([custom([('2024-01-01','100'),('2024-01-01','-100')])]))
        self.assertEqual(r['warnings'][0]['gap'],'100.00')

    def test_recovery_day_ordering_from_negative_prior_cash(self):
        r=calculate(scenario([custom([('2024-01-01','-10'),('2024-01-02','20'),('2024-01-02','-5')])]))
        self.assertEqual(r['warnings'][0]['date'],'2024-01-02');self.assertEqual(r['warnings'][0]['gap'],'15.00')

    def test_atomic_rows_same_date_and_signs_preserved(self):
        r=calculate(scenario([custom([('2024-01-01','10'),('2024-01-01','-7'),('2024-01-01','0')])]))
        self.assertEqual(len(r['flows']),3);self.assertEqual(r['summary']['netCashflow'],'3.00')

    def test_npv_one_year_hand_example_and_opening_excluded(self):
        s=scenario([custom([('2024-01-01','-1000'),('2025-01-01','1100')])],discountRate='10')
        self.assertEqual(calculate(s)['summary']['npv'],'0.00')
        s['openingCash']='5000';r=calculate(s)
        self.assertEqual(r['summary']['npv'],'0.00');self.assertEqual(r['summary']['endingCash'],'5100.00')

    def test_fractional_year_npv_independent_square_root(self):
        # 21% EAR has an exact 6-month factor sqrt(1.21)=1.1. 1210/1.1=1100.
        r=calculate(scenario([custom([('2024-01-01','-1000'),('2024-07-01','1210')])],discountRate='21'))
        self.assertEqual(r['summary']['npv'],'100.00')

    def test_npv_30e_february_fraction_independent_rational_factor(self):
        # Jan31 -> Feb29 has 29 financial days. An annual factor 1.01^360
        # would exceed allowed rate, so use (1.001)^360 as the effective rate.
        # Independently evaluate with 90-digit Decimal, not production helpers.
        with localcontext() as ctx:
            ctx.prec=90
            r_pct=((D('1.001')**360)-1)*100
            s=scenario([custom([('2024-02-29','1000')])],start='2024-01-31',discountRate=str(r_pct)[:18])
            value=calculate(s)
            exact=Fraction(1000)*Fraction(1000,1001)**29
            self.assertEqual(int(D(value['summary']['npv'])*100),cents(exact))
            self.assertEqual(value['flows'][0]['discountDays'],29)

    def test_negative_discount_rate(self):
        r=calculate(scenario([custom([('2025-01-01','900')])],discountRate='-10'))
        self.assertEqual(r['summary']['npv'],'1000.00')

    def test_zero_discount_is_sum_and_start_day_undiscounted(self):
        r=calculate(scenario([custom([('2024-01-01','-100'),('2025-02-10','130')])]))
        self.assertEqual(r['summary']['npv'],'30.00')
        self.assertEqual(r['flows'][0]['presentValue'],'-100.00')

    def test_npv_round_once_not_sum_rounded_rows(self):
        # Two 1-cent flows each worth 0.005 under 100% annual discount.
        r=calculate(scenario([custom([('2025-01-01','0.01'),('2025-01-01','0.01')])],discountRate='100'))
        self.assertEqual([f['presentValue'] for f in r['flows']],['0.01','0.01'])
        self.assertEqual(r['summary']['npv'],'0.01')

    def test_positive_npv_can_have_shortfall(self):
        r=calculate(scenario([custom([('2024-01-01','-1000'),('2025-01-01','1200')])],discountRate='10'))
        self.assertEqual(r['summary']['npv'],'90.91');self.assertFalse(r['summary']['feasible'])

    def test_negative_npv_can_be_cash_feasible(self):
        r=calculate(scenario([custom([('2024-01-01','-100'),('2025-01-01','90')])],openingCash='100',discountRate='0'))
        self.assertTrue(r['summary']['feasible']);self.assertEqual(r['summary']['npv'],'-10.00')

    def test_combined_scenario_independent_cash_totals(self):
        r=calculate(demo_scenario())
        # Loan 12,000; salary 12*3,200; principal+interest 11,000; bonus 2,500.
        self.assertEqual(r['summary']['totalInflows'],'63900.00')
        # Rent 12*2100 + custom 1800 + investment 10000 + loan 12526.33.
        self.assertEqual(r['summary']['totalOutflows'],'-49526.33')
        self.assertEqual(r['summary']['endingCash'],'17873.67')
        self.assertEqual(r['summary']['lowest']['balance'],'1880.70')
        self.assertEqual(r['summary']['lowest']['date'],'2026-06-15')
        self.assertEqual(len(r['flows']),41)

    def test_combined_npv_independent_discounted_formula(self):
        # Independent math functions intentionally use binary double solely as an
        # outside oracle; far below half-cent tolerance for this moderate example.
        import math
        import calendar
        def pv(a,m,d):
            return a/math.pow(1.06,(m*30+d-1)/360)
        value=12000-10000+11000/1.06
        value+=sum(pv(3200,m,25)-pv(2100,m,2) for m in range(12))
        value-=sum(1043.86/math.pow(1.06,m/12) for m in range(1,12))
        value-=1043.87/1.06
        value+=pv(-1800,5,15)+pv(2500,11,20)
        self.assertEqual(f'{value:.2f}','13561.30')
        self.assertEqual(calculate(demo_scenario())['summary']['npv'],'13561.30')

    def test_reproducible_and_does_not_mutate_inputs(self):
        s=demo_scenario();before=copy.deepcopy(s)
        self.assertEqual(json.dumps(calculate(s),sort_keys=True),json.dumps(calculate(s),sort_keys=True))
        self.assertEqual(s,before)


class ValidationTests(unittest.TestCase):
    def test_missing_fields_report_all_errors(self):
        errors=validate({})
        self.assertGreaterEqual(len(errors),6)

    def test_horizon_rejects_omitted_future_cost(self):
        with self.assertRaises(InvalidScenario) as context:
            calculate(scenario([loan(payments=60)],end='2024-12-31'))
        self.assertIn('last repayment',context.exception.errors[0]['message'])

    def test_validation_matrix(self):
        invalid=[scenario(start='2024-02-30'),scenario(end='2024-01-01'),scenario(discountRate='-100'),scenario(openingCash='-1'),scenario(currency='BAD'),scenario([loan(rateBasis='')]),scenario([loan(payments=0)]),scenario([loan(payments='12.5')]),scenario([loan(principal='-100')]),scenario([loan(principal='1.005')]),scenario([loan(payment='100')]),scenario([investment(end='2024-01-01')]),scenario([recurring(growthRate='-100')]),scenario([recurring(end='2024-01-01',firstPayment='')]),scenario([custom([('2023-12-31','10')])]),scenario([custom([('2024-01-01','NaN')])]),scenario([custom([('2024-01-01',0.1)])])]
        for index,s in enumerate(invalid):
            with self.subTest(index=index):
                with self.assertRaises(InvalidScenario):calculate(s)

    def test_currency_minor_units_jpy_and_kwd(self):
        s=scenario([loan(principal='100',rate='0',payments=3)],currency='JPY')
        self.assertEqual([f['amount'] for f in calculate(s)['flows']],['100','-33','-33','-34'])
        s=scenario([loan(principal='1.000',rate='0',payments=3)],currency='KWD')
        self.assertEqual([f['amount'] for f in calculate(s)['flows']],['1.000','-0.333','-0.333','-0.334'])

    def test_generated_value_limit(self):
        with self.assertRaises(InvalidScenario):
            calculate(scenario([recurring(end='2027-01-01',growthMode='payment',growthRate='1000')]))

    def test_exponent_notation_is_rejected_for_clear_input_display(self):
        with self.assertRaises(InvalidScenario):
            calculate(scenario(openingCash='1e3'))

    def test_hundred_year_calendar_limit_no_silent_schedule_truncation(self):
        s=scenario([recurring(start='2000-01-01',firstPayment='2000-01-01',end='2100-01-01',growthMode='none',growthRate='0')],start='2000-01-01',end='2100-01-01')
        result=calculate(s)
        self.assertEqual(len(result['flows']),1201)
        self.assertEqual(result['flows'][-1]['date'],'2100-01-01')
        s['end']='2100-01-02'
        with self.assertRaises(InvalidScenario):calculate(s)


if __name__ == '__main__':
    unittest.main()
