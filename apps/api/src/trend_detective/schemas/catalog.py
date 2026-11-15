"""Katalog-Schemas und Register (Brief §07, §08, §10)."""

from typing import Literal

from pydantic import BaseModel, ConfigDict

from trend_detective.domain.austria import AUSTRIA_ID, austria_state_ids
from trend_detective.domain.usa import US_STATES, USA_ID
from trend_detective.schemas.requests import (
    MAX_YEARS_PER_REQUEST,
    MIN_YEAR,
    BaselinePeriod,
    Latitude,
    Longitude,
)

DataMode = Literal["demo", "live"]
SpatialKind = Literal["grid_point", "region"]
Aggregation = Literal["day_weighted_mean", "calendar_day_sum"]

ANALYSIS_VERSION = "annual-ols-hac-v2"
# Demo-Daten (demo_temperature_v1) reichen bis 2025; Live endet am letzten vollständigen Jahr.
DEMO_MAX_YEAR = 2025
MIN_TREND_YEARS = 3
HAC_MAXLAGS = 3
CONFIDENCE_LEVEL = 0.95


class CatalogModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Location(CatalogModel):
    id: str
    label: str
    latitude: Latitude
    longitude: Longitude
    spatial_kind: SpatialKind = "grid_point"


class Variable(CatalogModel):
    id: str
    label: str
    description: str
    provider_parameter: str
    unit: str
    aggregation: Aggregation
    enabled: bool
    # Katalog setzt die Werte aus year_bounds()/get_year_bounds(); im Register Demo-Spanne.
    available_from_year: int
    available_to_year: int


class YearBounds(CatalogModel):
    min_year: int
    max_year: int
    max_years_per_request: int


class MethodDescription(CatalogModel):
    analysis_version: str
    method: Literal["ols_hac"]
    description: str
    min_years: int
    hac_maxlags: int
    confidence_level: float
    slope_unit: Literal["per_decade"]


class CatalogResponse(CatalogModel):
    data_mode: DataMode
    variables: list[Variable]
    locations: list[Location]
    year_bounds: YearBounds
    default_baseline: BaselinePeriod
    method: MethodDescription


# spatial_kind "region": live flächengemittelt (B-STATEAREA); Koordinaten nur Vertreterpunkt.
# Vertreterpunkte: Landeshauptstädte, zwei Nachkommastellen wie Vienna/Madrid.
# Fläche siehe domain.austria (Statistik Austria, Gebietsstand 1.1.2023).
_AUSTRIA_STATES: tuple[Location, ...] = (
    Location(
        id="at-burgenland",
        label="Burgenland",
        latitude=47.85,
        longitude=16.52,
        spatial_kind="region",
    ),
    Location(
        id="at-kaernten", label="Carinthia", latitude=46.62, longitude=14.31, spatial_kind="region"
    ),
    Location(
        id="at-niederoesterreich",
        label="Lower Austria",
        latitude=48.20,
        longitude=15.63,
        spatial_kind="region",
    ),
    Location(
        id="at-oberoesterreich",
        label="Upper Austria",
        latitude=48.31,
        longitude=14.29,
        spatial_kind="region",
    ),
    Location(
        id="at-salzburg", label="Salzburg", latitude=47.81, longitude=13.05, spatial_kind="region"
    ),
    Location(
        id="at-steiermark", label="Styria", latitude=47.07, longitude=15.44, spatial_kind="region"
    ),
    Location(id="at-tirol", label="Tyrol", latitude=47.27, longitude=11.40, spatial_kind="region"),
    Location(
        id="at-vorarlberg",
        label="Vorarlberg",
        latitude=47.50,
        longitude=9.75,
        spatial_kind="region",
    ),
    Location(
        id="at-wien", label="Vienna (state)", latitude=48.21, longitude=16.37, spatial_kind="region"
    ),
)

# Ungefährer geografischer Mittelpunkt Österreichs; kein POWER-Gitterpunkt der Region.
AUSTRIA = Location(
    id=AUSTRIA_ID,
    label="Austria",
    latitude=47.59,
    longitude=14.12,
    spatial_kind="region",
)

# Vertreterpunkt: innerer Punkt laut US Census Gazetteer 2024 (domain.usa).
_US_STATES: tuple[Location, ...] = tuple(
    Location(
        id=state_id,
        label=s.label,
        latitude=s.latitude,
        longitude=s.longitude,
        spatial_kind="region",
    )
    for state_id, s in US_STATES.items()
)

# Geografischer Mittelpunkt der 48 zusammenhängenden Staaten (bei Lebanon, Kansas).
USA = Location(
    id=USA_ID, label="United States", latitude=39.83, longitude=-98.58, spatial_kind="region"
)

LOCATIONS: tuple[Location, ...] = (
    Location(id="vienna", label="Vienna", latitude=48.21, longitude=16.37),
    Location(id="madrid", label="Madrid", latitude=40.42, longitude=-3.70),
    AUSTRIA,
    *_AUSTRIA_STATES,
    USA,
    *_US_STATES,
)

if tuple(loc.id for loc in _AUSTRIA_STATES) != austria_state_ids():
    raise RuntimeError("catalog Austria state ids must match AUSTRIA_STATE_AREAS_KM2")

VARIABLES: tuple[Variable, ...] = (
    Variable(
        id="temperature_2m",
        label="Air temperature at 2 m",
        description="Monthly mean air temperature 2 m above ground at a provider grid point.",
        provider_parameter="T2M",
        unit="degC",
        aggregation="day_weighted_mean",
        enabled=True,
        available_from_year=MIN_YEAR,
        available_to_year=DEMO_MAX_YEAR,
    ),
    Variable(
        id="precipitation",
        label="Precipitation (bias corrected)",
        description=(
            "Bias-corrected precipitation from NASA POWER (PRECTOTCORR). "
            "Monthly values are mean daily rates (mm/day); the annual value is the "
            "calendar-day sum (mm/year)."
        ),
        provider_parameter="PRECTOTCORR",
        unit="mm/year",
        aggregation="calendar_day_sum",
        enabled=True,
        available_from_year=MIN_YEAR,
        available_to_year=DEMO_MAX_YEAR,
    ),
    Variable(
        id="relative_humidity_2m",
        label="Relative humidity at 2 m",
        description="Monthly mean relative humidity 2 m above ground.",
        provider_parameter="RH2M",
        unit="%",
        aggregation="day_weighted_mean",
        enabled=True,
        available_from_year=MIN_YEAR,
        available_to_year=DEMO_MAX_YEAR,
    ),
    Variable(
        id="wind_speed_2m",
        label="Wind speed at 2 m",
        description="Monthly mean wind speed 2 m above ground.",
        provider_parameter="WS2M",
        unit="m/s",
        aggregation="day_weighted_mean",
        enabled=True,
        available_from_year=MIN_YEAR,
        available_to_year=DEMO_MAX_YEAR,
    ),
)


def provider_unit(variable: Variable) -> str:
    """Native POWER unit for normalization; may differ from the annual catalog unit."""
    if variable.provider_parameter == "PRECTOTCORR":
        return "mm/day"
    return variable.unit


def year_bounds(data_mode: DataMode, *, live_max_year: int) -> YearBounds:
    """Erlaubte Jahre je Datenmodus; Request-Validierung und Katalog nutzen dieselben Grenzen."""
    max_year = DEMO_MAX_YEAR if data_mode == "demo" else live_max_year
    return YearBounds(
        min_year=MIN_YEAR, max_year=max_year, max_years_per_request=MAX_YEARS_PER_REQUEST
    )


DEMO_YEAR_BOUNDS = year_bounds("demo", live_max_year=DEMO_MAX_YEAR)

METHOD = MethodDescription(
    analysis_version=ANALYSIS_VERSION,
    method="ols_hac",
    description=(
        "Ordinary least squares on complete annual values (day-weighted mean or "
        "calendar-day sum, per variable), y = a + b*t with t = year minus "
        "mean year; Newey-West (HAC) covariance; 95% interval b +/- 1.96*SE; "
        "at least 3 contiguous common complete years, otherwise no trend; "
        "fewer than 10 years adds diagnostic flag short_period."
    ),
    min_years=MIN_TREND_YEARS,
    hac_maxlags=HAC_MAXLAGS,
    confidence_level=CONFIDENCE_LEVEL,
    slope_unit="per_decade",
)


def variables_for_bounds(bounds: YearBounds) -> list[Variable]:
    """Spanne wie year_bounds()/get_year_bounds(), nicht erneut berechnet."""
    return [
        variable.model_copy(
            update={
                "available_from_year": bounds.min_year,
                "available_to_year": bounds.max_year,
            }
        )
        for variable in VARIABLES
    ]


def build_catalog(data_mode: DataMode, bounds: YearBounds = DEMO_YEAR_BOUNDS) -> CatalogResponse:
    return CatalogResponse(
        data_mode=data_mode,
        variables=variables_for_bounds(bounds),
        locations=list(LOCATIONS),
        year_bounds=bounds,
        default_baseline=BaselinePeriod(),
        method=METHOD,
    )
