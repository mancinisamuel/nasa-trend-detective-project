"""Trend und Numerik (Brief §09.3-5, §12).

Referenzwerte kommen aus geschlossenen Formeln (OLS-Steigung = Sxy/Sxx), nicht aus einem
zweiten Aufruf derselben Implementierung. Zufallsdaten nur mit festem Seed.
"""

import math

import numpy as np
import pytest

from trend_detective.domain.quality import longest_common_run
from trend_detective.domain.trend import (
    FLAG_CONSTANT_SERIES,
    FLAG_SHORT_PERIOD,
    FLAG_ZERO_RESIDUALS,
    METHOD_VERSION,
    Trend,
    fit_trend,
)

YEARS = list(range(1981, 2026))  # 45 Jahre


def _closed_form_slope(years: list[int], values: list[float]) -> float:
    t_mean = sum(years) / len(years)
    y_mean = sum(values) / len(values)
    sxy = sum((t - t_mean) * (y - y_mean) for t, y in zip(years, values, strict=True))
    sxx = sum((t - t_mean) ** 2 for t in years)
    return sxy / sxx


def _noisy(slope_per_year: float, seed: int, sd: float = 0.1) -> list[float]:
    rng = np.random.default_rng(seed)
    return [10.0 + slope_per_year * (y - 2000) + float(rng.normal(0.0, sd)) for y in YEARS]


def _fit(years: list[int], values: list[float]) -> Trend:
    result = fit_trend(list(zip(years, values, strict=True)))
    assert result is not None
    return result


def _assert_finite(trend: Trend) -> None:
    for n in (trend.slope_per_decade, trend.ci95_low, trend.ci95_high, trend.p_value):
        assert math.isfinite(n)


def test_known_slope_is_recovered_per_decade() -> None:
    # Wahre Steigung 0.03 °C/Jahr = 0.3 °C/Jahrzehnt. SE der OLS-Steigung bei sd=0.1, n=45:
    # 0.1/sqrt(7590) ≈ 0.00115/Jahr -> 0.0115/Jahrzehnt; Toleranz 0.05 sind > 4 SE.
    values = _noisy(0.03, seed=20261114)
    trend = _fit(YEARS, values)
    assert trend.slope_per_decade == pytest.approx(0.3, abs=0.05)
    assert trend.ci95_low < 0.3 < trend.ci95_high
    assert trend.significance_status == "positive_trend"
    assert trend.p_value < 0.05
    assert (trend.n_years, trend.start_year, trend.end_year) == (45, 1981, 2025)
    assert trend.diagnostic_flags == ()
    _assert_finite(trend)


def test_slope_per_decade_is_ten_times_closed_form_ols_slope() -> None:
    values = _noisy(-0.02, seed=7)
    trend = _fit(YEARS, values)
    assert trend.slope_per_decade == pytest.approx(10 * _closed_form_slope(YEARS, values), 1e-9)
    assert trend.significance_status == "negative_trend"


def test_interval_is_symmetric_and_consistent_with_p_value() -> None:
    trend = _fit(YEARS, _noisy(0.0, seed=3, sd=0.5))
    half = (trend.ci95_high - trend.ci95_low) / 2
    assert trend.slope_per_decade - trend.ci95_low == pytest.approx(half)
    assert trend.ci95_high - trend.slope_per_decade == pytest.approx(half)
    # Gleiche Kovarianz: z = b / SE, SE = half / 1.96 (beides pro Jahrzehnt).
    z = trend.slope_per_decade / (half / 1.96)
    assert trend.p_value == pytest.approx(math.erfc(abs(z) / math.sqrt(2)))
    excludes_zero = trend.ci95_low > 0 or trend.ci95_high < 0
    assert excludes_zero == (trend.p_value < 0.05)
    if not excludes_zero:
        assert trend.significance_status == "no_clear_trend"


def test_method_version_is_reported() -> None:
    assert METHOD_VERSION == "ols-hac-nw3-v1"


@pytest.mark.parametrize(("n", "has_trend"), [(2, False), (3, True)])
def test_minimum_three_years(n: int, has_trend: bool) -> None:
    years = YEARS[:n]
    values = _noisy(0.03, seed=11)[:n]
    result = fit_trend(list(zip(years, values, strict=True)))
    assert (result is not None) == has_trend


@pytest.mark.parametrize(("n", "short"), [(3, True), (9, True), (10, False), (45, False)])
def test_short_period_flag_below_ten_years(n: int, short: bool) -> None:
    trend = _fit(YEARS[:n], _noisy(0.03, seed=11)[:n])
    assert (FLAG_SHORT_PERIOD in trend.diagnostic_flags) == short
    assert math.isfinite(trend.p_value) and trend.ci95_low <= trend.ci95_high


def test_missing_years_shorten_common_run() -> None:
    a = [y for y in YEARS if y != 1985]  # Lücke früh: Folge 1986-2025 = 40 Jahre
    b = [y for y in YEARS if y != 2020]  # Lücke spät bei B: gemeinsam 1986-2019 = 34 Jahre
    common = longest_common_run(a, b)
    assert common == list(range(1986, 2020))
    values = dict(zip(YEARS, _noisy(0.03, seed=5), strict=True))
    trend = _fit(common, [values[y] for y in common])
    assert (trend.n_years, trend.start_year, trend.end_year) == (34, 1986, 2019)

    c = [y for y in YEARS if y % 3 != 0]  # längste Folge: 2 Jahre
    common_short = longest_common_run(YEARS, c)
    assert len(common_short) == 2
    assert fit_trend([(y, values[y]) for y in common_short]) is None


def test_constant_series_is_degenerate_without_nan() -> None:
    trend = _fit(YEARS, [12.5] * len(YEARS))
    assert trend.slope_per_decade == 0.0
    assert (trend.ci95_low, trend.ci95_high) == (0.0, 0.0)
    assert trend.p_value == 1.0
    assert trend.significance_status == "no_clear_trend"
    assert set(trend.diagnostic_flags) == {FLAG_ZERO_RESIDUALS, FLAG_CONSTANT_SERIES}
    _assert_finite(trend)


def test_perfect_line_is_degenerate_without_inf() -> None:
    values = [5.0 + 0.02 * (y - 1981) for y in YEARS]
    trend = _fit(YEARS, values)
    assert trend.slope_per_decade == pytest.approx(0.2, abs=1e-9)
    assert trend.ci95_low == trend.ci95_high == trend.slope_per_decade
    assert trend.p_value == 0.0
    assert trend.significance_status == "positive_trend"
    assert trend.diagnostic_flags == (FLAG_ZERO_RESIDUALS,)
    _assert_finite(trend)


def test_input_order_does_not_matter() -> None:
    values = _noisy(0.03, seed=9)
    pairs = list(zip(YEARS, values, strict=True))
    assert fit_trend(pairs) == fit_trend(list(reversed(pairs)))


@pytest.mark.parametrize(
    "points",
    [
        [(y, 1.0) for y in YEARS if y != 2000],  # Lücke
        [(y, 1.0) for y in YEARS] + [(2000, 1.0)],  # Duplikat
        [(y, math.nan if y == 2000 else 1.0) for y in YEARS],  # NaN
        [(y, math.inf if y == 2000 else 1.0) for y in YEARS],  # Infinity
    ],
)
def test_invalid_input_is_rejected(points: list[tuple[int, float]]) -> None:
    with pytest.raises(ValueError):
        fit_trend(points)


def test_trend_line_covers_fitted_years_and_matches_slope() -> None:
    values = _noisy(0.03, seed=20261114)
    trend = _fit(YEARS, values)
    assert len(trend.trend_line) == trend.n_years
    years = list(range(trend.start_year, trend.end_year + 1))
    assert [year for year, _ in trend.trend_line] == years
    step = trend.slope_per_decade / 10
    for (_, current), (_, nxt) in zip(trend.trend_line, trend.trend_line[1:], strict=False):
        assert nxt - current == pytest.approx(step, abs=1e-12)
