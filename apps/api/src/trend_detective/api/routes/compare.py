"""POST /api/v1/compare: Validierung gegen den Katalog, dann CompareService (Brief §08)."""

from typing import Annotated

from fastapi import APIRouter, Request
from fastapi import Body as BodyParam

from trend_detective.api.cancel import cancel_on_disconnect
from trend_detective.api.errors import ERROR_RESPONSES, ApiError, ErrorCode, get_request_id
from trend_detective.dependencies import (
    SettingsDep,
    get_provider,
    get_region_service,
    get_year_bounds,
)
from trend_detective.schemas.catalog import (
    LOCATIONS,
    VARIABLES,
    DataMode,
    Location,
    Variable,
    YearBounds,
)
from trend_detective.schemas.requests import (
    CompareRequest,
    LocationRef,
    PointRef,
    point_location_id,
)
from trend_detective.schemas.responses import CompareResponse
from trend_detective.services.compare import CompareService

router = APIRouter(tags=["compare"])

COORDINATE_TOLERANCE = 1e-6

EXAMPLE_REQUEST = {
    "variable_id": "temperature_2m",
    "locations": [
        {"id": "vienna", "latitude": 48.21, "longitude": 16.37},
        {"id": "madrid", "latitude": 40.42, "longitude": -3.70},
    ],
    "start_year": 1981,
    "end_year": 2025,
    "baseline": {"start_year": 1991, "end_year": 2020},
}


def _resolve_variable(variable_id: str) -> Variable:
    variable = next((v for v in VARIABLES if v.id == variable_id), None)
    if variable is None:
        raise ApiError(
            422,
            ErrorCode.UNKNOWN_VARIABLE,
            f"Unknown variable: {variable_id}",
            details={"variable_id": variable_id},
        )
    if not variable.enabled:
        raise ApiError(
            422,
            ErrorCode.VARIABLE_DISABLED,
            f"Variable is disabled: {variable_id}",
            details={"variable_id": variable_id},
        )
    return variable


def _resolve_location(ref: LocationRef | PointRef, data_mode: DataMode) -> Location:
    if isinstance(ref, PointRef):
        point_id = point_location_id(ref.lat, ref.lon)
        if data_mode == "demo":
            raise ApiError(
                422,
                ErrorCode.UNKNOWN_LOCATION,
                f"Location not available in demo data: {point_id}",
                details={"location_id": point_id},
            )
        return Location(
            id=point_id,
            label=ref.label if ref.label is not None else point_id,
            latitude=ref.lat,
            longitude=ref.lon,
        )
    location = next((loc for loc in LOCATIONS if loc.id == ref.id), None)
    if location is None:
        raise ApiError(
            422,
            ErrorCode.UNKNOWN_LOCATION,
            f"Unknown location: {ref.id}",
            details={"location_id": ref.id},
        )
    if (
        abs(location.latitude - ref.latitude) > COORDINATE_TOLERANCE
        or abs(location.longitude - ref.longitude) > COORDINATE_TOLERANCE
    ):
        raise ApiError(
            422,
            ErrorCode.LOCATION_MISMATCH,
            f"Coordinates do not match location {ref.id}",
            details={
                "location_id": ref.id,
                "expected": {"latitude": location.latitude, "longitude": location.longitude},
            },
        )
    return location


def _check_year_bounds(payload: CompareRequest, bounds: YearBounds) -> None:
    """Endjahr gegen die Katalog-Grenzen des Datenmodus (Untergrenze prüft schon das Schema)."""
    if payload.end_year > bounds.max_year:
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            "Request validation failed",
            details={
                "errors": [
                    {
                        "loc": ["body", "end_year"],
                        "msg": f"Input should be less than or equal to {bounds.max_year}",
                        "type": "less_than_equal",
                    }
                ]
            },
        )


@router.post(
    "/compare",
    responses={status: ERROR_RESPONSES[status] for status in (422, 500, 502, 503, 504)},
)
async def compare(
    payload: Annotated[CompareRequest, BodyParam(examples=[EXAMPLE_REQUEST])],
    request: Request,
    settings: SettingsDep,
) -> CompareResponse:
    _check_year_bounds(payload, get_year_bounds(settings))
    variable = _resolve_variable(payload.variable_id)
    locations = [_resolve_location(ref, settings.data_mode) for ref in payload.locations]
    # Provider erst nach der Eingabeprüfung auflösen: 422 vor 503 (Entscheidung Architekt).
    # Live: Bundesländer als Zellmittel über die geoBoundaries-Grenzen; Demo bleibt beim Punkt.
    boundaries = get_region_service(request) if settings.data_mode == "live" else None
    service = CompareService(get_provider(request, settings.data_mode), boundaries=boundaries)
    return await cancel_on_disconnect(
        request,
        service.compare(payload, locations, variable, get_request_id(request), settings.data_mode),
    )
