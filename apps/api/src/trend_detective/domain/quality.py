"""Qualität: fehlende Monate, Abdeckung, gemeinsame Folge vollständiger Jahre (Brief §09.1)."""

import datetime as dt
from collections.abc import Iterable, Sequence

from trend_detective.domain.annualize import month_dates, valid_values
from trend_detective.domain.models import MonthlyValue

# Potter-Entscheid D-05: Trend ab 3 vollständigen Jahren (HAC braucht Freiheitsgrade);
# unter SHORT_PERIOD_YEARS wird der Trend als kurzer Zeitraum markiert.
MIN_TREND_YEARS = 3
SHORT_PERIOD_YEARS = 10


def missing_months(
    monthly: Iterable[MonthlyValue], start_year: int, end_year: int
) -> list[dt.date]:
    """Alle Kalendermonate im Fenster ohne gültigen Wert (null oder gar nicht geliefert)."""
    values = valid_values(monthly)
    return [d for d in month_dates(start_year, end_year) if d not in values]


def coverage_fraction(missing: Sequence[dt.date], start_year: int, end_year: int) -> float:
    expected = (end_year - start_year + 1) * 12
    return (expected - len(missing)) / expected


def longest_common_run(*year_sets: Iterable[int]) -> list[int]:
    """Längste zusammenhängende Folge von Jahren, die in allen Mengen liegt; bei Gleichstand
    die frühere."""
    sets = [set(s) for s in year_sets]
    common = sorted(set.intersection(*sets)) if sets else []
    best: list[int] = []
    current: list[int] = []
    for year in common:
        current = [*current, year] if current and year == current[-1] + 1 else [year]
        if len(current) > len(best):
            best = current
    return best
