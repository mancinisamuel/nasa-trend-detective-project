import pytest
from pydantic import ValidationError

from trend_detective.schemas.catalog import (
    DEMO_MAX_YEAR,
    LOCATIONS,
    VARIABLES,
    build_catalog,
    year_bounds,
)
from trend_detective.schemas.requests import (
    MAX_YEARS_PER_REQUEST,
    MIN_YEAR,
    CompareRequest,
    LocationRef,
    PointRef,
    location_identity,
    point_location_id,
    validate_year_window,
)

VIENNA = {"id": "vienna", "latitude": 48.21, "longitude": 16.37}
MADRID = {"id": "madrid", "latitude": 40.42, "longitude": -3.70}
POINT = {"kind": "point", "lat": 46.61, "lon": 13.85, "label": "Villach"}
VALID: dict[str, object] = {
    "variable_id": "temperature_2m",
    "locations": [VIENNA, MADRID],
    "start_year": 1981,
    "end_year": 2025,
}


def test_valid_request_gets_default_baseline() -> None:
    request = CompareRequest.model_validate(VALID)
    assert (request.baseline.start_year, request.baseline.end_year) == (1991, 2020)


def test_explicit_baseline_1991_2020_is_accepted() -> None:
    request = CompareRequest.model_validate(
        {**VALID, "baseline": {"start_year": 1991, "end_year": 2020}}
    )
    assert (request.baseline.start_year, request.baseline.end_year) == (1991, 2020)


def test_single_location_request_is_accepted() -> None:
    request = CompareRequest.model_validate({**VALID, "locations": [VIENNA]})
    assert [location_identity(loc) for loc in request.locations] == ["vienna"]


@pytest.mark.parametrize(
    "patch",
    [
        {"start_year": 2000, "end_year": 1999},
        {"start_year": 1980},
        {"end_year": 1980},
        {"locations": []},
        {"locations": [VIENNA, MADRID, {**VIENNA, "id": "other"}]},
        {"locations": [VIENNA, VIENNA]},
        {"locations": [{"id": "x", "latitude": 91, "longitude": 0}, MADRID]},
        {"locations": [{"kind": "point", "lat": 91, "lon": 0}]},
        {"locations": [{"kind": "point", "lat": 0, "lon": 181}]},
        {"locations": [{"kind": "point", "lat": -91, "lon": 0}]},
        {"locations": [{"kind": "point", "lat": 0, "lon": -181}]},
        {"locations": [POINT, POINT]},
        {"locations": [POINT, {"kind": "point", "lat": 46.6100, "lon": 13.8500}]},
        {"baseline": {"start_year": 2020, "end_year": 1991}},
        {"baseline": {"start_year": 1981, "end_year": 2010}},
        {"baseline": {"start_year": 1991, "end_year": 2019}},
        {"baseline": {"start_year": 1981}},
        {"unexpected": 1},
    ],
)
def test_invalid_requests_are_rejected(patch: dict[str, object]) -> None:
    with pytest.raises(ValidationError):
        CompareRequest.model_validate({**VALID, **patch})


def test_catalog_register() -> None:
    catalog = build_catalog("demo")
    assert catalog.data_mode == "demo"
    assert all(
        (v.available_from_year, v.available_to_year) == (1981, 2025) for v in catalog.variables
    )
    assert [v.id for v in VARIABLES if v.enabled] == [
        "temperature_2m",
        "precipitation",
        "relative_humidity_2m",
        "wind_speed_2m",
    ]
    temperature = VARIABLES[0]
    precipitation = VARIABLES[1]
    assert (temperature.provider_parameter, temperature.unit) == ("T2M", "degC")
    assert (precipitation.unit, precipitation.aggregation) == ("mm/year", "calendar_day_sum")
    assert {"vienna", "madrid", "at"} <= {loc.id for loc in LOCATIONS}
    regions = {loc.id for loc in LOCATIONS if loc.spatial_kind == "region"}
    assert regions == {loc.id for loc in LOCATIONS if loc.id in {"at", "usa"} or "-" in loc.id}
    assert {"vienna", "madrid"}.isdisjoint(regions)


def test_catalog_has_us_states_and_usa_weights_are_state_areas() -> None:
    """B-USAREA: 50 States + DC, usa = Mittel der States mit Census-Landfläche."""
    from trend_detective.domain.usa import US_STATE_AREAS_KM2
    from trend_detective.services.compare import STATE_BOUNDARY, region_members
    from trend_detective.services.regions import USA

    states = [loc for loc in LOCATIONS if loc.id.startswith("us-")]
    assert len(states) == 51
    assert {STATE_BOUNDARY[loc.id][1] for loc in states} == set(USA.states)
    members, areas = region_members(next(loc for loc in LOCATIONS if loc.id == "usa"))
    assert [m.id for m in members] == [loc.id for loc in states]
    assert areas == [US_STATE_AREAS_KM2[m.id] for m in members]
    weights = [a / sum(areas) for a in areas]
    assert sum(weights) == pytest.approx(1.0)
    assert max(zip(weights, [m.id for m in members], strict=True))[1] == "us-ak"


@pytest.mark.parametrize(
    ("start_year", "end_year", "max_years"),
    [
        (1950, 1999, 50),
        (1981, 2025, 50),
        (2000, 2000, 50),
        (2000, 2009, 10),
    ],
)
def test_year_window_within_limit_is_accepted(
    start_year: int, end_year: int, max_years: int
) -> None:
    validate_year_window(start_year, end_year, max_years=max_years)


@pytest.mark.parametrize(
    ("start_year", "end_year", "max_years"),
    [
        (1950, 2000, 50),
        (1900, 2025, 50),
        (2000, 2010, 10),
        (2001, 2000, 50),
    ],
)
def test_year_window_over_limit_is_rejected(start_year: int, end_year: int, max_years: int) -> None:
    with pytest.raises(ValueError):
        validate_year_window(start_year, end_year, max_years=max_years)


def test_default_window_limit_and_api_year_bounds() -> None:
    assert MAX_YEARS_PER_REQUEST == 50
    assert (MIN_YEAR, DEMO_MAX_YEAR) == (1981, 2025)
    validate_year_window(1976, 2025)
    with pytest.raises(ValueError, match="at most 50 years"):
        validate_year_window(1975, 2025)


def test_year_bounds_depend_on_data_mode() -> None:
    assert year_bounds("demo", live_max_year=2030).max_year == 2025
    live = year_bounds("live", live_max_year=2030)
    assert (live.min_year, live.max_year, live.max_years_per_request) == (1981, 2030, 50)


def test_schema_has_no_fixed_end_year() -> None:
    # Obergrenze kommt aus catalog.year_bounds und wird in der Route geprüft (E1).
    request = CompareRequest.model_validate({**VALID, "start_year": 1990, "end_year": 2026})
    assert request.end_year == 2026


def test_free_point_request_is_accepted() -> None:
    request = CompareRequest.model_validate({**VALID, "locations": [POINT]})
    point = request.locations[0]
    assert isinstance(point, PointRef)
    assert (point.kind, point.lat, point.lon, point.label) == ("point", 46.61, 13.85, "Villach")
    assert point_location_id(point.lat, point.lon) == "pt:46.6100,13.8500"


def test_catalog_form_without_kind_is_still_a_location_ref() -> None:
    request = CompareRequest.model_validate({**VALID, "locations": [VIENNA]})
    assert isinstance(request.locations[0], LocationRef)
    assert request.locations[0].id == "vienna"
