"""Extremwert-Kennzahlen pro Kalenderjahr aus POWER-Tageswerten (B-EXTREMES).

Regel für unvollständige Jahre: Eine Kennzahl hat für ein Jahr nur dann einen Wert, wenn die
benötigte Variable an jedem Kalendertag des Jahres einen gültigen Wert hat (kein Fill, kein
null, Tag geliefert). Sonst ist der Jahreswert None, nie 0. radiation_sum erst ab 1984.
"""

import datetime as dt
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from trend_detective.providers.power_daily import (
    ALLSKY_SFC_SW_DWN,
    PRECTOTCORR,
    T2M_MAX,
    T2M_MIN,
    WS10M_MAX,
    DailyValues,
)

HOT_DAY_TMAX_C = 30.0
TROPICAL_NIGHT_TMIN_C = 20.0
FROST_DAY_TMIN_C = 0.0
ICE_DAY_TMAX_C = 0.0
WET_DAY_MM = 1.0
HEAVY_RAIN_MM = 20.0
DRY_DAY_BELOW_MM = 1.0
RADIATION_FROM_YEAR = 1984

MetricKind = Literal["count", "run", "max", "sum"]
MetricId = Literal[
    "hot_days",
    "tropical_nights",
    "longest_heatwave",
    "hottest_day",
    "frost_days",
    "ice_days",
    "wettest_day",
    "wet_days",
    "heavy_rain_days",
    "longest_dry_spell",
    "max_hourly_wind",
    "radiation_sum",
]


@dataclass(frozen=True)
class MetricSpec:
    id: MetricId
    parameter: str
    kind: MetricKind
    unit: str
    predicate: Callable[[float], bool] | None = None
    from_year: int | None = None


METRICS: tuple[MetricSpec, ...] = (
    MetricSpec("hot_days", T2M_MAX, "count", "days", lambda v: v >= HOT_DAY_TMAX_C),
    MetricSpec("tropical_nights", T2M_MIN, "count", "days", lambda v: v >= TROPICAL_NIGHT_TMIN_C),
    MetricSpec("longest_heatwave", T2M_MAX, "run", "days", lambda v: v >= HOT_DAY_TMAX_C),
    MetricSpec("hottest_day", T2M_MAX, "max", "degC"),
    MetricSpec("frost_days", T2M_MIN, "count", "days", lambda v: v < FROST_DAY_TMIN_C),
    MetricSpec("ice_days", T2M_MAX, "count", "days", lambda v: v < ICE_DAY_TMAX_C),
    MetricSpec("wettest_day", PRECTOTCORR, "max", "mm/day"),
    MetricSpec("wet_days", PRECTOTCORR, "count", "days", lambda v: v >= WET_DAY_MM),
    MetricSpec("heavy_rain_days", PRECTOTCORR, "count", "days", lambda v: v >= HEAVY_RAIN_MM),
    MetricSpec("longest_dry_spell", PRECTOTCORR, "run", "days", lambda v: v < DRY_DAY_BELOW_MM),
    MetricSpec("max_hourly_wind", WS10M_MAX, "max", "m/s"),
    # Tageswerte in MJ/m^2/day, über das Jahr summiert -> MJ/m^2.
    MetricSpec("radiation_sum", ALLSKY_SFC_SW_DWN, "sum", "MJ/m^2", from_year=RADIATION_FROM_YEAR),
)


@dataclass(frozen=True)
class YearValue:
    year: int
    value: float | None
    date: dt.date | None = None


def year_days(year: int) -> list[dt.date]:
    first = dt.date(year, 1, 1)
    count = (dt.date(year + 1, 1, 1) - first).days
    return [first + dt.timedelta(days=i) for i in range(count)]


def complete_year(values: DailyValues, year: int) -> list[tuple[dt.date, float]] | None:
    """Alle Tage des Jahres mit gültigem Wert, oder None, sobald einer fehlt."""
    days: list[tuple[dt.date, float]] = []
    for day in year_days(year):
        value = values.get(day)
        if value is None:
            return None
        days.append((day, value))
    return days


def longest_run(flags: Sequence[bool]) -> int:
    best = current = 0
    for flag in flags:
        current = current + 1 if flag else 0
        best = max(best, current)
    return best


def metric_value(spec: MetricSpec, days: Sequence[tuple[dt.date, float]]) -> YearValue:
    year = days[0][0].year
    values = [v for _, v in days]
    match spec.kind:
        case "count":
            assert spec.predicate is not None
            return YearValue(year, float(sum(1 for v in values if spec.predicate(v))))
        case "run":
            assert spec.predicate is not None
            return YearValue(year, float(longest_run([spec.predicate(v) for v in values])))
        case "max":
            day, value = max(days, key=lambda item: item[1])  # erster Tag bei Gleichstand
            return YearValue(year, value, day)
        case "sum":
            return YearValue(year, sum(values))


def annual_metric(
    spec: MetricSpec, values: DailyValues, start_year: int, end_year: int
) -> list[YearValue]:
    series: list[YearValue] = []
    for year in range(start_year, end_year + 1):
        days = None if spec.from_year and year < spec.from_year else complete_year(values, year)
        series.append(YearValue(year, None) if days is None else metric_value(spec, days))
    return series


def annual_extremes(
    daily: Mapping[str, DailyValues], start_year: int, end_year: int
) -> dict[MetricId, list[YearValue]]:
    return {
        spec.id: annual_metric(spec, daily.get(spec.parameter, {}), start_year, end_year)
        for spec in METRICS
    }
