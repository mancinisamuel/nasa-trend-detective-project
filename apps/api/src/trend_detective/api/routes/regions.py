"""Regions-Routen (Brief §14: nur Orientierungsgeometrie, keine Klimadaten).

- GET /api/v1/regions/search: Ortssuche über AUT und USA (E-52a).
- GET /api/v1/regions/{country_iso3}/{adm1_id}: Bundesland mit Bezirken und Gemeinden (E-42/E-46).

/regions/search ist zuerst registriert; mit einem Pfadsegment kollidiert es ohnehin nicht mit
/regions/{country_iso3}/{adm1_id}.
"""

from typing import Annotated

from fastapi import APIRouter, Query

from trend_detective.api.errors import ERROR_RESPONSES
from trend_detective.dependencies import RegionSearchDep, RegionServiceDep
from trend_detective.schemas.regions import RegionResponse, RegionSearchResponse

router = APIRouter(tags=["regions"])

SEARCH_LIMIT_DEFAULT = 10
SEARCH_LIMIT_MAX = 25


@router.get(
    "/regions/search",
    responses={s: ERROR_RESPONSES[s] for s in (422, 500, 502, 503, 504)},
)
async def search_regions(
    q: Annotated[
        str,
        Query(
            min_length=2,
            max_length=100,
            description="Place name; case- and diacritic-insensitive, at least 2 characters",
        ),
    ],
    search: RegionSearchDep,
    limit: Annotated[int, Query(ge=1, le=SEARCH_LIMIT_MAX)] = SEARCH_LIMIT_DEFAULT,
) -> RegionSearchResponse:
    return await search.search(q, limit)


@router.get(
    "/regions/{country_iso3}/{adm1_id}",
    responses={s: ERROR_RESPONSES[s] for s in (404, 422, 500, 502, 503, 504)},
)
async def get_region(country_iso3: str, adm1_id: str, service: RegionServiceDep) -> RegionResponse:
    return await service.get_region(country_iso3, adm1_id)
