"""B-EXTREMES: Kennzahlen auf handgebauten Tagen, Fill -> null, Radiation vor 1984 null."""

import datetime as dt
from pathlib import Path

from trend_detective.domain.extremes import annual_extremes, year_days
from trend_detective.providers.power_daily import (
    ALLSKY_SFC_SW_DWN,
    PRECTOTCORR,
    T2M_MAX,
    T2M_MIN,
    WS10M,
    WS10M_MAX,
    normalize_power_daily,
)

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "power_daily_sample.json"
BASE = {T2M_MAX: 15.0, T2M_MIN: 5.0, PRECTOTCORR: 0.0, WS10M: 3.0, WS10M_MAX: 5.0}


Daily = dict[str, dict[dt.date, float | None]]


def _year(year: int, overrides: dict[str, dict[str, float | None]]) -> Daily:
    data: Daily = {
        p: dict.fromkeys(year_days(year), v) for p, v in {**BASE, ALLSKY_SFC_SW_DWN: 10.0}.items()
    }
    for parameter, days in overrides.items():
        for md, value in days.items():
            data[parameter][dt.date.fromisoformat(f"{year}-{md}")] = value
    return data


def test_indices_on_handbuilt_year() -> None:
    daily = _year(
        2001,
        {
            T2M_MAX: {
                "07-01": 30,
                "07-02": 30,
                "07-03": 30,
                "07-05": 31,
                "07-10": 35.5,
                "01-02": -2,
            },
            T2M_MIN: {"07-02": 20, "07-03": 21, "01-01": -1, "01-02": -1, "01-03": -1, "01-04": -1},
            PRECTOTCORR: {"03-01": 1, "03-02": 25, "03-03": 20},
            WS10M_MAX: {"02-03": 12},
        },
    )
    result = {k: v[0] for k, v in annual_extremes(daily, 2001, 2001).items()}
    assert result["hot_days"].value == 5
    assert result["tropical_nights"].value == 2
    assert result["longest_heatwave"].value == 3
    assert (result["hottest_day"].date, result["hottest_day"].value) == (dt.date(2001, 7, 10), 35.5)
    assert result["frost_days"].value == 4
    assert result["ice_days"].value == 1
    assert (result["wettest_day"].date, result["wettest_day"].value) == (dt.date(2001, 3, 2), 25)
    assert result["wet_days"].value == 3
    assert result["heavy_rain_days"].value == 2
    assert result["longest_dry_spell"].value == 365 - 62  # 4. März bis 31. Dezember
    assert result["max_hourly_wind"].date == dt.date(2001, 2, 3)
    assert result["radiation_sum"].value == 3650


def test_missing_day_nulls_only_metrics_of_that_parameter_and_radiation_before_1984() -> None:
    daily = _year(1983, {T2M_MAX: {"05-05": None}})
    later = _year(1984, {})
    for parameter in daily:
        daily[parameter].update(later[parameter])
    result = annual_extremes(daily, 1983, 1984)
    assert result["hot_days"][0].value is None  # nicht 0
    assert result["hottest_day"][0].value is None
    assert result["frost_days"][0].value == 0  # T2M_MIN vollständig
    assert [v.value for v in result["radiation_sum"]] == [None, 3660]  # 1984 Schaltjahr


def test_normalize_fill_to_none_and_header_end() -> None:
    normalized = normalize_power_daily(SAMPLE.read_bytes(), start_year=1983, end_year=1984)
    assert normalized.values[T2M_MAX][dt.date(1983, 12, 31)] is None
    assert normalized.values[ALLSKY_SFC_SW_DWN][dt.date(1983, 12, 30)] is None
    assert normalized.values[ALLSKY_SFC_SW_DWN][dt.date(1984, 1, 1)] == 2.26
    assert normalized.data_end == dt.date(1984, 1, 2)
    assert normalized.units[ALLSKY_SFC_SW_DWN] == "MJ/m^2/day"
