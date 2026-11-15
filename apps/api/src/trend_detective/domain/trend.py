"""Trend: OLS mit HAC/Newey-West-Kovarianz auf Jahreswerten (Brief §09.3-5).

Modell y = a + b*t mit t = Jahr minus Mitteljahr. Ausgabe pro Jahrzehnt (Faktor 10).
Intervall b ± 1.96*SE_HAC und zweiseitiger asymptotischer p-Wert stammen aus derselben
Kovarianz. Degenerierte Fälle (Residuen null) werden explizit behandelt und markiert.
"""

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
import statsmodels.api as sm  # type: ignore[import-untyped]

from trend_detective.domain.quality import MIN_TREND_YEARS, SHORT_PERIOD_YEARS

METHOD: Literal["ols_hac"] = "ols_hac"
METHOD_VERSION = "ols-hac-nw3-v1"
HAC_MAXLAGS = 3
Z_95 = 1.96
YEARS_PER_DECADE = 10

FLAG_ZERO_RESIDUALS = "zero_residual_variance"
FLAG_CONSTANT_SERIES = "constant_series"
FLAG_SHORT_PERIOD = "short_period"

# Relative Schwelle, ab der Residuen als numerisch null gelten.
_RESIDUAL_TOLERANCE = 1e-12

SignificanceStatus = Literal["positive_trend", "negative_trend", "no_clear_trend"]


@dataclass(frozen=True)
class Trend:
    n_years: int
    start_year: int
    end_year: int
    slope_per_decade: float
    ci95_low: float
    ci95_high: float
    p_value: float
    significance_status: SignificanceStatus
    diagnostic_flags: tuple[str, ...]
    trend_line: tuple[tuple[int, float], ...]


def significance(ci_low: float, ci_high: float) -> SignificanceStatus:
    """Intervall komplett über/unter null: Trend unter Modellannahmen; sonst kein klarer Trend."""
    if ci_low > 0:
        return "positive_trend"
    if ci_high < 0:
        return "negative_trend"
    return "no_clear_trend"


def fit_trend(points: Sequence[tuple[int, float]]) -> Trend | None:
    """Trend über eine zusammenhängende Folge (Jahr, Wert).

    Weniger als MIN_TREND_YEARS Jahre: None (kein Test). Lücken in der Folge oder nicht
    endliche Werte sind Aufruferfehler und lösen ValueError aus.
    """
    ordered = sorted(points)
    years = [year for year, _ in ordered]
    if len(set(years)) != len(years):
        raise ValueError("duplicate years in trend input")
    if years and years != list(range(years[0], years[-1] + 1)):
        raise ValueError("trend input must be a contiguous run of years")
    if len(ordered) < MIN_TREND_YEARS:
        return None

    y = np.array([value for _, value in ordered], dtype=float)
    if not np.all(np.isfinite(y)):
        raise ValueError("trend input contains non-finite values")
    t = np.array(years, dtype=float)
    t = t - t.mean()

    slope, se = _ols_hac(t, y)
    flags: list[str] = []
    if se is None:
        # Residuen null: Steigung exakt, keine Streuung. Intervall entartet zum Punkt.
        flags.append(FLAG_ZERO_RESIDUALS)
        if slope == 0.0:
            flags.append(FLAG_CONSTANT_SERIES)
        se = 0.0
        p_value = 1.0 if slope == 0.0 else 0.0
    else:
        p_value = math.erfc(abs(slope / se) / math.sqrt(2.0))

    if len(ordered) < SHORT_PERIOD_YEARS:
        flags.append(FLAG_SHORT_PERIOD)

    low = (slope - Z_95 * se) * YEARS_PER_DECADE
    high = (slope + Z_95 * se) * YEARS_PER_DECADE
    intercept = float(y.mean())
    trend_line = tuple(
        (year, intercept + slope * float(offset)) for year, offset in zip(years, t, strict=True)
    )
    result = Trend(
        n_years=len(ordered),
        start_year=years[0],
        end_year=years[-1],
        slope_per_decade=slope * YEARS_PER_DECADE,
        ci95_low=low,
        ci95_high=high,
        p_value=p_value,
        significance_status=significance(low, high),
        diagnostic_flags=tuple(flags),
        trend_line=trend_line,
    )
    numbers = (result.slope_per_decade, low, high, p_value)
    if not all(math.isfinite(n) for n in numbers):
        raise ArithmeticError("trend fit produced non-finite numbers")
    return result


def _ols_hac(t: np.ndarray, y: np.ndarray) -> tuple[float, float | None]:
    """Steigung und HAC-Standardfehler; SE None, wenn die Residuen numerisch null sind."""
    design = sm.add_constant(t, has_constant="add")
    ols = sm.OLS(y, design).fit()
    slope = float(ols.params[1])
    scale = max(1.0, float(np.max(np.abs(y))))
    if float(np.max(np.abs(ols.resid))) <= _RESIDUAL_TOLERANCE * scale:
        constant = float(np.ptp(y)) <= _RESIDUAL_TOLERANCE * scale
        return (0.0 if constant else slope), None
    hac = sm.OLS(y, design).fit(
        cov_type="HAC",
        cov_kwds={"maxlags": HAC_MAXLAGS, "use_correction": True},
        use_t=False,
    )
    se = float(hac.bse[1])
    if not math.isfinite(se) or se <= 0.0:
        return slope, None
    return slope, se
