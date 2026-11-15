"""Flächengewichtetes Österreich-Mittel aus den 9 Bundesländer-Punkten."""

import datetime as dt
from collections.abc import Sequence

import pytest

from trend_detective.domain.austria import (
    AUSTRIA_STATE_AREAS_KM2,
    area_weighted_monthly,
    austria_state_ids,
)
from trend_detective.domain.models import MonthlyValue

JAN = dt.date(2000, 1, 1)
FEB = dt.date(2000, 2, 1)


def _month(date: dt.date, values: Sequence[float | None]) -> list[list[MonthlyValue]]:
    return [[MonthlyValue(date, value)] for value in values]


def test_austria_mean_is_area_weighted_and_drops_month_if_a_point_is_missing() -> None:
    ids = austria_state_ids()
    areas = [AUSTRIA_STATE_AREAS_KM2[state_id] for state_id in ids]
    # Einheitenwerte: Mittel muss 1 sein, unabhängig von den Flächen.
    ones = area_weighted_monthly(_month(JAN, [1.0] * len(areas)), areas)
    assert ones[0].date == JAN
    assert ones[0].value == pytest.approx(1.0)

    values: list[float | None] = [0.0] * len(areas)
    values[ids.index("at-niederoesterreich")] = 10.0
    weighted = area_weighted_monthly(_month(JAN, values), areas)[0]
    expected = 10.0 * AUSTRIA_STATE_AREAS_KM2["at-niederoesterreich"] / sum(areas)
    assert weighted.value == pytest.approx(expected)

    january: list[float | None] = [1.0] * len(areas)
    february: list[float | None] = [2.0] * len(areas)
    february[0] = None
    series = [
        [MonthlyValue(JAN, jan), MonthlyValue(FEB, feb)]
        for jan, feb in zip(january, february, strict=True)
    ]
    result = {item.date: item.value for item in area_weighted_monthly(series, areas)}
    assert result[JAN] == pytest.approx(1.0)
    assert result[FEB] is None
