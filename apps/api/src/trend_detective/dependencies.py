"""FastAPI-Abhängigkeiten."""

import datetime as dt
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import Depends, Request

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.config import Settings
from trend_detective.providers.base import ClimateProvider
from trend_detective.providers.demo import DemoProvider
from trend_detective.providers.power import PowerProvider
from trend_detective.schemas.catalog import DataMode, YearBounds, year_bounds
from trend_detective.services.region_search import RegionSearch
from trend_detective.services.regions import RegionService
from trend_detective.storage.file_cache import FileCache

USER_AGENT = "trend-detective-api/0.1.0"


@lru_cache
def get_settings() -> Settings:
    return Settings()


SettingsDep = Annotated[Settings, Depends(get_settings)]


def last_complete_year(today: dt.date) -> int:
    return today.year - 1


def get_year_bounds(settings: Settings, today: dt.date | None = None) -> YearBounds:
    """Live: 1981 bis TD_POWER_END_YEAR bzw. letztes vollständiges Kalenderjahr (UTC)."""
    today = today or dt.datetime.now(dt.UTC).date()
    live_max = settings.power_end_year or last_complete_year(today)
    return year_bounds(settings.data_mode, live_max_year=live_max)


def build_provider(settings: Settings) -> ClimateProvider | None:
    """Beim App-Start: Demo-Modus -> DemoProvider. Live -> None; der PowerProvider entsteht im
    lifespan, weil er einen geteilten httpx.AsyncClient braucht (siehe live_provider)."""
    if settings.data_mode == "demo":
        return DemoProvider()
    return None


@asynccontextmanager
async def live_provider(settings: Settings) -> AsyncIterator[PowerProvider]:
    """Geteilter AsyncClient für die Lebensdauer der App; beim Shutdown geschlossen."""
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(settings.power_timeout_seconds),
        follow_redirects=False,
        headers={"Accept": "application/json", "User-Agent": USER_AGENT},
    ) as client:
        yield PowerProvider(
            client,
            FileCache(settings.cache_dir / "power", settings.cache_ttl_seconds),
            total_timeout_seconds=settings.power_timeout_seconds,
        )


def get_provider(request: Request, data_mode: DataMode) -> ClimateProvider:
    """Provider aus dem App-Start; nur aufrufen, nachdem die Eingabe geprüft ist (422 vor 503).

    Kein stiller Wechsel auf synthetische Daten (Brief §06, E-11): Live liefert nie den
    DemoProvider. Umgekehrt ruft der Demo-Modus nie NASA auf (Brief §10).
    """
    provider: ClimateProvider | None = getattr(request.app.state, "provider", None)
    is_demo = isinstance(provider, DemoProvider)
    if provider is None or (data_mode == "live") == is_demo:
        raise ApiError(
            503,
            ErrorCode.PROVIDER_UNAVAILABLE,
            f"No {data_mode} data provider is running",
            retryable=True,
        )
    return provider


def build_region_service(settings: Settings) -> RegionService:
    """geoBoundaries-Grenzen (E-42): eigener kurzlebiger Client nur für den ersten Abruf;
    danach liest der Service ausschließlich aus <cache_dir>/regions."""

    def client_factory() -> httpx.AsyncClient:
        return httpx.AsyncClient(
            timeout=httpx.Timeout(settings.regions_timeout_seconds),
            headers={"Accept": "application/json", "User-Agent": USER_AGENT},
        )

    return RegionService(
        FileCache(settings.cache_dir / "regions", settings.cache_ttl_seconds), client_factory
    )


def get_region_service(request: Request) -> RegionService:
    service: RegionService = request.app.state.region_service
    return service


RegionServiceDep = Annotated[RegionService, Depends(get_region_service)]


def build_region_search(settings: Settings, regions: RegionService) -> RegionSearch:
    """Ortssuche (E-52a): Index im Speicher, zusätzlich unter <cache_dir>/region-search."""
    return RegionSearch(
        regions, FileCache(settings.cache_dir / "region-search", settings.cache_ttl_seconds)
    )


def get_region_search(request: Request) -> RegionSearch:
    search: RegionSearch = request.app.state.region_search
    return search


RegionSearchDep = Annotated[RegionSearch, Depends(get_region_search)]
