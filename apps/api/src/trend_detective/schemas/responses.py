"""Response-Schemas für POST /api/v1/compare (Brief §07, §08)."""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

from trend_detective.schemas.catalog import DataMode, Location
from trend_detective.schemas.requests import CompareRequest, Latitude, Longitude

CacheStatus = Literal["miss", "fresh", "stale"]
QualityStatus = Literal["complete", "partial", "insufficient_data"]
BaselineStatus = Literal["complete", "missing_baseline"]
SignificanceStatus = Literal["positive_trend", "negative_trend", "no_clear_trend"]
SpatialMethod = Literal["area_weighted_grid", "area_weighted_states", "capital_point"]


class ResponseModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Coordinates(ResponseModel):
    latitude: Latitude
    longitude: Longitude


class MonthlyObservation(ResponseModel):
    date: dt.date = Field(description="First day of the month (YYYY-MM-01)")
    value: float | None
    quality_flags: list[str]


class AnnualObservation(ResponseModel):
    year: int
    value: float | None
    valid_months: Annotated[int, Field(ge=0, le=12)]
    expected_months: Literal[12] = 12


class AnnualAnomaly(ResponseModel):
    year: int
    value: float | None


class Provenance(ResponseModel):
    provider: str
    dataset: str
    parameter: str
    community: str
    requested_coordinates: Coordinates
    returned_coordinates: Coordinates | None
    retrieved_at: dt.datetime = Field(description="UTC")
    source_url: str | None
    raw_sha256: str
    provider_version: str | None
    spatial_method: SpatialMethod | None = Field(
        default=None,
        description=(
            "null: single POWER grid point at requested_coordinates. area_weighted_grid: "
            "area-weighted mean of the POWER grid cells intersecting the state polygon. "
            "area_weighted_states: area-weighted mean of the state means. "
            "capital_point: single POWER grid point at the capital of the state/region "
            "(extremes only; see capital_name)."
        ),
    )
    cell_count: int | None = Field(
        default=None, ge=1, description="Number of POWER grid cells (area_weighted_grid only)"
    )
    capital_name: str | None = Field(
        default=None,
        description="Capital used instead of the area (spatial_method capital_point only)",
    )


class QualityReport(ResponseModel):
    status: QualityStatus
    missing_months: list[dt.date]
    complete_years: list[int]
    coverage_fraction: Annotated[float, Field(ge=0, le=1)]
    warnings: list[str]
    baseline_status: BaselineStatus


class TrendPoint(ResponseModel):
    year: int
    value: float


class TrendResult(ResponseModel):
    method: Literal["ols_hac"]
    method_version: str
    n_years: int
    start_year: int
    end_year: int
    slope_per_decade: float
    ci95_low: float
    ci95_high: float
    p_value: float
    significance_status: SignificanceStatus
    diagnostic_flags: list[str]
    trend_line: list[TrendPoint] | None = Field(
        default=None,
        description="Fitted OLS values for start_year..end_year, same scale as observations_annual",
    )


class SeriesResult(ResponseModel):
    location: Location
    observations_monthly: list[MonthlyObservation]
    observations_annual: list[AnnualObservation]
    anomalies_annual: list[AnnualAnomaly]
    trend: TrendResult | None
    quality: QualityReport
    provenance: Provenance
    cache_status: CacheStatus


class Comparison(ResponseModel):
    common_years: list[int]
    warnings: list[str]


class CompareResponse(ResponseModel):
    schema_version: Literal["1.0"] = "1.0"
    analysis_version: str
    result_id: str
    request_id: str
    data_mode: DataMode
    cache_status: CacheStatus
    generated_at: dt.datetime = Field(description="UTC ISO-8601")
    request: CompareRequest
    series: Annotated[
        list[SeriesResult],
        Field(min_length=1, max_length=2, description="One entry per requested location"),
    ]
    comparison: Comparison
