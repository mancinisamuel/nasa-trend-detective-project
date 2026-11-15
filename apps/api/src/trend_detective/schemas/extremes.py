"""Response-Schema für GET /api/v1/extremes (B-EXTREMES)."""

import datetime as dt
from typing import Literal

from pydantic import Field

from trend_detective.schemas.catalog import DataMode
from trend_detective.schemas.responses import (
    CacheStatus,
    Coordinates,
    Provenance,
    ResponseModel,
    TrendResult,
)


class ExtremeThresholds(ResponseModel):
    hot_day_tmax_c: float = Field(description="Hot day: T2M_MAX >= value")
    tropical_night_tmin_c: float = Field(description="Tropical night: T2M_MIN >= value")
    frost_day_tmin_c: float = Field(description="Frost day: T2M_MIN < value")
    ice_day_tmax_c: float = Field(description="Ice day: T2M_MAX < value")
    wet_day_mm: float = Field(description="Wet day: PRECTOTCORR >= value")
    heavy_rain_mm: float = Field(description="Heavy rain day: PRECTOTCORR >= value")
    dry_day_below_mm: float = Field(description="Dry spell day: PRECTOTCORR < value")
    radiation_from_year: int = Field(description="radiation_sum is null before this year")


class ExtremeYearValue(ResponseModel):
    year: int
    value: float | None = Field(
        description="null if the year has any missing day for the required parameter"
    )
    date: dt.date | None = Field(
        description="Day of the extreme (hottest_day, wettest_day, max_hourly_wind), else null"
    )


class ExtremeMetric(ResponseModel):
    parameter: str = Field(description="NASA POWER daily parameter")
    unit: str
    series: list[ExtremeYearValue]
    trend: TrendResult | None = Field(
        description="OLS/HAC over the longest run of years with values; null below 3 years"
    )


class ExtremeMetrics(ResponseModel):
    hot_days: ExtremeMetric
    tropical_nights: ExtremeMetric
    longest_heatwave: ExtremeMetric
    hottest_day: ExtremeMetric
    frost_days: ExtremeMetric
    ice_days: ExtremeMetric
    wettest_day: ExtremeMetric
    wet_days: ExtremeMetric
    heavy_rain_days: ExtremeMetric
    longest_dry_spell: ExtremeMetric
    max_hourly_wind: ExtremeMetric = Field(
        description="Highest daily WS10M_MAX (max hourly mean wind at 10 m, not a gust)"
    )
    radiation_sum: ExtremeMetric = Field(
        description="Annual sum of ALLSKY_SFC_SW_DWN in MJ/m^2 (daily MJ/m^2/day summed)"
    )


class ExtremesResponse(ResponseModel):
    schema_version: Literal["1.0"] = "1.0"
    analysis_version: str
    request_id: str
    data_mode: DataMode
    cache_status: CacheStatus
    generated_at: dt.datetime = Field(description="UTC ISO-8601")
    coordinates: Coordinates
    start_year: int
    end_year: int
    data_end: dt.date | None = Field(description="Last day delivered by POWER (header.end)")
    thresholds: ExtremeThresholds
    metrics: ExtremeMetrics
    provenance: Provenance
