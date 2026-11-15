"""Österreich als Region: 9 Bundesländer, je ein Vertreterpunkt, Flächengewichtung.

Flächen: Statistik Austria, Gebietsstand 1.1.2023
(https://www.statistik.at/statistiken/bevoelkerung-und-soziales/bevoelkerung/bevoelkerungsstand).
Koordinaten: Landeshauptstädte, auf zwei Nachkommastellen wie die übrigen Katalogorte.
"""

from collections.abc import Sequence

from trend_detective.domain.models import MonthlyValue

AUSTRIA_ID = "at"

# Fläche in km², Statistik Austria, Gebietsstand 1.1.2023.
AUSTRIA_STATE_AREAS_KM2: dict[str, float] = {
    "at-burgenland": 3965.20,
    "at-kaernten": 9536.50,
    "at-niederoesterreich": 19179.76,
    "at-oberoesterreich": 11982.52,
    "at-salzburg": 7154.48,
    "at-steiermark": 16399.34,
    "at-tirol": 12648.37,
    "at-vorarlberg": 2601.48,
    "at-wien": 414.82,
}


# Katalog-Id -> ISO 3166-2 (adm1_id im RegionService, geoBoundaries AUT ADM1).
AUSTRIA_STATE_ADM1: dict[str, str] = {
    "at-burgenland": "AT-1",
    "at-kaernten": "AT-2",
    "at-niederoesterreich": "AT-3",
    "at-oberoesterreich": "AT-4",
    "at-salzburg": "AT-5",
    "at-steiermark": "AT-6",
    "at-tirol": "AT-7",
    "at-vorarlberg": "AT-8",
    "at-wien": "AT-9",
}


def austria_state_ids() -> tuple[str, ...]:
    return tuple(AUSTRIA_STATE_AREAS_KM2)


def area_weighted_monthly(
    series: Sequence[Sequence[MonthlyValue]],
    areas: Sequence[float],
) -> list[MonthlyValue]:
    """Flächengewichtetes Monatsmittel. Fehlt ein Punkt in einem Monat, ist der Monat None."""
    if len(series) != len(areas) or not series:
        raise ValueError("series and areas must be non-empty and the same length")
    if any(area <= 0 for area in areas):
        raise ValueError("areas must be positive")
    by_member = [{item.date: item.value for item in values} for values in series]
    dates = sorted({date for lookup in by_member for date in lookup})
    total = sum(areas)
    result: list[MonthlyValue] = []
    for date in dates:
        weighted = 0.0
        complete = True
        for lookup, area in zip(by_member, areas, strict=True):
            value = lookup.get(date)
            if value is None:
                complete = False
                break
            weighted += value * area
        result.append(MonthlyValue(date=date, value=weighted / total if complete else None))
    return result
