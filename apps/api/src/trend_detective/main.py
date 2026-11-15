"""FastAPI-App-Fabrik."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from trend_detective.api.errors import install_error_handling
from trend_detective.api.routes import catalog, compare, extremes, health, regions
from trend_detective.dependencies import (
    build_provider,
    build_region_search,
    build_region_service,
    get_settings,
    live_provider,
)
from trend_detective.providers.power_daily import PowerDailyProvider
from trend_detective.storage.file_cache import FileCache

API_PREFIX = "/api/v1"


def create_app() -> FastAPI:
    settings = get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        """Live: PowerProvider mit geteiltem AsyncClient starten und sauber schließen."""
        if settings.data_mode != "live":
            yield
            return
        async with live_provider(settings) as provider:
            app.state.provider = provider
            app.state.daily_provider = PowerDailyProvider(
                provider, FileCache(settings.cache_dir / "power-daily", settings.cache_ttl_seconds)
            )
            try:
                yield
            finally:
                app.state.provider = None
                app.state.daily_provider = None

    app = FastAPI(
        title="Trend Detective API",
        version="0.1.0",
        separate_input_output_schemas=False,
        lifespan=lifespan,
    )
    app.state.provider = build_provider(settings)
    app.state.daily_provider = None
    app.state.region_service = build_region_service(settings)
    app.state.region_search = build_region_search(settings, app.state.region_service)
    install_error_handling(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(catalog.router, prefix=API_PREFIX)
    app.include_router(compare.router, prefix=API_PREFIX)
    app.include_router(regions.router, prefix=API_PREFIX)
    app.include_router(extremes.router, prefix=API_PREFIX)
    return app


app = create_app()
