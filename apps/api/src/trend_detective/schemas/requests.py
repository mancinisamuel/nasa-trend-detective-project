"""Request-Schemas für POST /api/v1/compare (Brief §08)."""

from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

# Datenbereich POWER monatlich ab 1981. Das Endjahr hängt vom Datenmodus ab (Demo 2025, Live
# letztes vollständiges Jahr) und steht in catalog.year_bounds; die Route prüft es (E1).
MIN_YEAR = 1981
MAX_YEARS_PER_REQUEST = 50
# Feste Klimanormalperiode (Gate B, Entscheidung E-11): andere Werte -> 422 VALIDATION_ERROR.
BASELINE_START_YEAR = 1991
BASELINE_END_YEAR = 2020
POINT_COORD_DECIMALS = 4

Year = Annotated[
    int,
    Field(ge=MIN_YEAR, description="Upper bound is catalog year_bounds.max_year (per data mode)"),
]
Latitude = Annotated[float, Field(ge=-90, le=90, description="WGS84 decimal degrees")]
Longitude = Annotated[float, Field(ge=-180, le=180, description="WGS84 decimal degrees")]


def validate_year_window(
    start_year: int, end_year: int, *, max_years: int = MAX_YEARS_PER_REQUEST
) -> None:
    """Prüft das Abfragefenster: start <= end und höchstens max_years Jahre (inklusive)."""
    if start_year > end_year:
        raise ValueError("start_year must not be after end_year")
    if end_year - start_year + 1 > max_years:
        raise ValueError(f"at most {max_years} years per request")


def point_location_id(lat: float, lon: float) -> str:
    """Stabile Ort-Id aus auf vier Nachkommastellen gerundeten Koordinaten."""
    return f"pt:{lat:.{POINT_COORD_DECIMALS}f},{lon:.{POINT_COORD_DECIMALS}f}"


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class BaselinePeriod(StrictModel):
    """Basisperiode für Anomalien; im Fundament fest auf 1991-2020."""

    start_year: Year = BASELINE_START_YEAR
    end_year: Year = BASELINE_END_YEAR

    @model_validator(mode="after")
    def _fixed_period(self) -> Self:
        if (self.start_year, self.end_year) != (BASELINE_START_YEAR, BASELINE_END_YEAR):
            raise ValueError(
                f"baseline must be {BASELINE_START_YEAR}-{BASELINE_END_YEAR}; "
                "other baseline periods are not supported"
            )
        return self


class LocationRef(StrictModel):
    """Katalogort in der bisherigen Form; ohne kind weiterhin gültig."""

    id: Annotated[str, Field(min_length=1, max_length=64)]
    latitude: Latitude
    longitude: Longitude


class PointRef(StrictModel):
    """Freier Punkt außerhalb des Katalogs; kind unterscheidet ihn von der Katalogform."""

    kind: Literal["point"]
    lat: Latitude
    lon: Longitude
    label: Annotated[str | None, Field(default=None, min_length=1, max_length=128)] = None


def location_identity(location: LocationRef | PointRef) -> str:
    """Vergleichsschlüssel: Katalog-Id oder gerundete Punkt-Id."""
    if isinstance(location, PointRef):
        return point_location_id(location.lat, location.lon)
    return location.id


class CompareRequest(StrictModel):
    variable_id: Annotated[str, Field(min_length=1, max_length=64)]
    locations: Annotated[
        list[LocationRef | PointRef],
        Field(
            min_length=1,
            max_length=2,
            description="One location, or two different locations to compare",
        ),
    ]
    start_year: Year
    end_year: Year
    baseline: Annotated[
        BaselinePeriod,
        Field(
            description=(
                f"Fixed to {BASELINE_START_YEAR}-{BASELINE_END_YEAR}; "
                "any other period is rejected with 422 VALIDATION_ERROR"
            )
        ),
    ] = BaselinePeriod()

    @model_validator(mode="after")
    def _consistent(self) -> Self:
        validate_year_window(self.start_year, self.end_year)
        if len(self.locations) == 2 and location_identity(self.locations[0]) == location_identity(
            self.locations[1]
        ):
            raise ValueError("two locations must be different locations")
        return self
