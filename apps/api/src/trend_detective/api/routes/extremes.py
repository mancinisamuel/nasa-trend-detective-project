"""GET /api/v1/extremes: Extremwert-Kennzahlen pro Jahr (nur Live-Modus).

Entweder lat+lon (Punkt) oder location_id (Katalogort; Bundesland als Zellmittel, B-STATEEXT).
"""

from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import JsonValue

from trend_detective.api.cancel import cancel_on_disconnect
from trend_detective.api.errors import ERROR_RESPONSES, ApiError, ErrorCode, get_request_id
from trend_detective.dependencies import SettingsDep, get_year_bounds
from trend_detective.domain.usa import USA_ID
from trend_detective.providers.power_daily import PowerDailyProvider
from trend_detective.schemas.catalog import LOCATIONS, Location
from trend_detective.schemas.extremes import ExtremesResponse
from trend_detective.schemas.requests import (
    MAX_YEARS_PER_REQUEST,
    MIN_YEAR,
    point_location_id,
)
from trend_detective.services.extremes import ExtremesService

router = APIRouter(tags=["extremes"])


def _validation_error(field: str, msg: str, kind: str) -> ApiError:
    errors: list[JsonValue] = [{"loc": ["query", field], "msg": msg, "type": kind}]
    return ApiError(
        422, ErrorCode.VALIDATION_ERROR, "Request validation failed", details={"errors": errors}
    )


@router.get(
    "/extremes",
    responses={status: ERROR_RESPONSES[status] for status in (422, 500, 502, 503, 504)},
)
async def get_extremes(
    start_year: Annotated[int, Query(ge=MIN_YEAR)],
    end_year: Annotated[
        int, Query(ge=MIN_YEAR, description="Upper bound is catalog year_bounds.max_year")
    ],
    request: Request,
    settings: SettingsDep,
    lat: Annotated[
        float | None, Query(ge=-90, le=90, description="WGS84 decimal degrees; with lon")
    ] = None,
    lon: Annotated[
        float | None, Query(ge=-180, le=180, description="WGS84 decimal degrees; with lat")
    ] = None,
    location_id: Annotated[
        str | None,
        Query(
            description=(
                "Catalog location id instead of lat/lon, e.g. at-niederoesterreich, us-tx, at. "
                "States (at-*, us-*): POWER grid point at the capital; at: Vienna "
                "(provenance.spatial_method capital_point, capital_name)."
            )
        ),
    ] = None,
) -> ExtremesResponse:
    max_year = get_year_bounds(settings).max_year
    if end_year > max_year:
        raise _validation_error(
            "end_year", f"Input should be less than or equal to {max_year}", "less_than_equal"
        )
    if start_year > end_year:
        raise _validation_error(
            "start_year", "start_year must not be after end_year", "value_error"
        )
    if end_year - start_year + 1 > MAX_YEARS_PER_REQUEST:
        raise _validation_error(
            "start_year", f"at most {MAX_YEARS_PER_REQUEST} years per request", "value_error"
        )
    location: Location | None = None
    if location_id is not None:
        if lat is not None or lon is not None:
            raise _validation_error(
                "location_id", "use either lat/lon or location_id", "value_error"
            )
        location = next((loc for loc in LOCATIONS if loc.id == location_id), None)
        if location is None:
            raise ApiError(
                422,
                ErrorCode.UNKNOWN_LOCATION,
                f"Unknown location: {location_id}",
                details={"location_id": location_id},
            )
        if location.id == USA_ID:
            # Rund 3000+ Zellen x Tagesdaten: nicht in vertretbarer Zeit (B-USAREA).
            raise _validation_error(
                "location_id",
                "usa is not supported for extremes; use a state (us-*)",
                "value_error",
            )
    elif lat is None or lon is None:
        raise _validation_error("lat", "lat and lon (or location_id) are required", "missing")
    if settings.data_mode == "demo":
        # Wie freie Punkte bei Compare: keine Demo-Tagesdaten, kein Wechsel auf synthetische Daten.
        point_id = location.id if location is not None else point_location_id(lat or 0, lon or 0)
        raise ApiError(
            422,
            ErrorCode.UNKNOWN_LOCATION,
            f"Location not available in demo data: {point_id}",
            details={"location_id": point_id},
        )
    provider: PowerDailyProvider | None = getattr(request.app.state, "daily_provider", None)
    if provider is None:
        raise ApiError(
            503, ErrorCode.PROVIDER_UNAVAILABLE, "No live data provider is running", retryable=True
        )
    service = ExtremesService(provider)
    if location is not None:
        return await cancel_on_disconnect(
            request,
            service.extremes_for_location(
                location, start_year, end_year, get_request_id(request), settings.data_mode
            ),
        )
    assert lat is not None and lon is not None
    return await service.extremes(
        lat, lon, start_year, end_year, get_request_id(request), settings.data_mode
    )
