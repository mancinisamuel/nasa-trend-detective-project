"""C3: Analyse-Domain ohne Trend. Sollwerte analytisch, nicht aus derselben Implementierung."""

import datetime as dt

from trend_detective.domain.annualize import annual_means, annual_sums, complete_years
from trend_detective.domain.anomalies import anomalies, baseline_mean
from trend_detective.domain.models import AnnualValue, MonthlyValue
from trend_detective.domain.quality import coverage_fraction, longest_common_run, missing_months


def _year(year: int, values: list[float | None]) -> list[MonthlyValue]:
    return [MonthlyValue(dt.date(year, m, 1), v) for m, v in enumerate(values, start=1)]


def test_leap_year_february_has_29_day_weight() -> None:
    # Februar = 1, alle anderen Monate = 0: Mittel = Tage(Feb) / Tage(Jahr).
    values: list[float | None] = [0.0] * 12
    values[1] = 1.0
    leap = annual_means(_year(2020, values), 2020, 2020)[0]
    common = annual_means(_year(2021, values), 2021, 2021)[0]
    assert leap.value == 29 / 366
    assert common.value == 28 / 365
    assert leap.valid_months == 12


def test_constant_series_gives_constant_annual_mean() -> None:
    assert annual_means(_year(2001, [5.0] * 12), 2001, 2001)[0].value == 5.0


def test_eleven_months_is_no_annual_value_and_years_stay_visible() -> None:
    monthly = _year(2000, [1.0] * 11 + [None]) + _year(2002, [2.0] * 11)  # 2001 fehlt ganz
    annual = annual_means(monthly, 2000, 2002)
    assert [(a.year, a.value, a.valid_months) for a in annual] == [
        (2000, None, 11),
        (2001, None, 0),
        (2002, None, 11),
    ]
    assert complete_years(annual) == []


def test_missing_months_include_null_and_absent_months() -> None:
    monthly = _year(2000, [1.0] * 11 + [None])
    del monthly[5]  # Juni nicht geliefert, Dezember ist null
    missing = missing_months(monthly, 2000, 2000)
    assert missing == [dt.date(2000, 6, 1), dt.date(2000, 12, 1)]
    assert coverage_fraction(missing, 2000, 2000) == 10 / 12


def test_longest_common_run_and_tie_takes_earlier() -> None:
    a = [*range(1981, 1991), *range(1992, 2026)]
    b = [*range(1981, 2010), *range(2011, 2026)]
    assert longest_common_run(a, b) == list(range(1992, 2010))
    assert longest_common_run([1, 2, 3, 5, 6, 7], [1, 2, 3, 5, 6, 7]) == [1, 2, 3]
    assert longest_common_run([1, 2], [3, 4]) == []


def test_baseline_requires_all_years_and_anomalies_have_mean_zero() -> None:
    annual = [AnnualValue(y, float(y - 1990), 12) for y in range(1991, 2021)]
    reference = baseline_mean(annual, 1991, 2020)
    assert reference == 15.5
    values = [v for _, v in anomalies(annual, reference)]
    assert sum(v for v in values if v is not None) == 0.0
    gap = [*annual[:10], AnnualValue(2001, None, 11), *annual[11:]]
    assert baseline_mean(gap, 1991, 2020) is None
    assert baseline_mean(annual[:-1], 1991, 2020) is None


def test_anomalies_keep_incomplete_years_as_none() -> None:
    annual = [AnnualValue(2000, 3.0, 12), AnnualValue(2001, None, 5)]
    assert anomalies(annual, 1.0) == [(2000, 2.0), (2001, None)]


def test_annual_sum_multiplies_daily_rate_by_calendar_days() -> None:
    constant = annual_sums(_year(2021, [1.0] * 12), 2021, 2021)[0]
    leap = annual_sums(_year(2020, [1.0] * 12), 2020, 2020)[0]
    assert constant.value == 365.0
    assert leap.value == 366.0
    incomplete = annual_sums(_year(2021, [1.0] * 11 + [None]), 2021, 2021)[0]
    assert (incomplete.value, incomplete.valid_months) == (None, 11)
