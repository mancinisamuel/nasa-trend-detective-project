"""GET /api/v1/catalog: Variablen, Standorte, Zeitgrenzen, Datenmodus, Methode (Brief §08)."""

from fastapi import APIRouter

from trend_detective.api.errors import ERROR_RESPONSES
from trend_detective.dependencies import SettingsDep, get_year_bounds
from trend_detective.schemas.catalog import CatalogResponse, build_catalog

router = APIRouter(tags=["catalog"])


@router.get("/catalog", responses={500: ERROR_RESPONSES[500]})
def get_catalog(settings: SettingsDep) -> CatalogResponse:
    return build_catalog(settings.data_mode, get_year_bounds(settings))
