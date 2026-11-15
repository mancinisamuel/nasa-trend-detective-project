"""Live-Smoke-Test gegen NASA POWER (Brief §12): nur mit `pytest -m live`, sonst übersprungen.

Wien, T2M, 1981 bis letztes vollständiges Jahr über den echten PowerProvider und CompareService.
Cache im konfigurierten TD_CACHE_DIR (Standard data/cache, gitignored). Mit -s werden
Plausibilitäts- und Metadatenwerte ausgegeben.
"""

import datetime as dt
import json

import httpx
import pytest

from trend_detective.config import Settings
from trend_detective.dependencies import get_year_bounds
from trend_detective.providers.power import PowerProvider
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES
from trend_detective.schemas.requests import CompareRequest
from trend_detective.services.compare import CompareService
from trend_detective.storage.file_cache import FileCache

pytestmark = pytest.mark.live
VIENNA = LOCATIONS[0]
TEMPERATURE = VARIABLES[0]


async def test_vienna_t2m_live_smoke() -> None:
    settings = Settings(data_mode="live")
    end_year = get_year_bounds(settings).max_year
    request = CompareRequest.model_validate(
        {
            "variable_id": TEMPERATURE.id,
            "locations": [
                {"id": VIENNA.id, "latitude": VIENNA.latitude, "longitude": VIENNA.longitude}
            ],
            "start_year": 1981,
            "end_year": end_year,
        }
    )
    cache = FileCache(settings.cache_dir / "power", settings.cache_ttl_seconds)
    async with httpx.AsyncClient(timeout=settings.power_timeout_seconds) as client:
        provider = PowerProvider(
            client, cache, total_timeout_seconds=settings.power_timeout_seconds
        )
        service = CompareService(provider)
        first = await service.compare(request, [VIENNA], TEMPERATURE, "live-smoke-1", "live")
        second = await service.compare(request, [VIENNA], TEMPERATURE, "live-smoke-2", "live")

    series = first.series[0]
    annual = [a.value for a in series.observations_annual if a.value is not None]
    trend = series.trend
    report = {
        "years": f"1981-{end_year}",
        "months": len(series.observations_monthly),
        "complete_years": len(series.quality.complete_years),
        "annual_mean_range_degC": [round(min(annual), 2), round(max(annual), 2)],
        "missing_months": [d.isoformat() for d in series.quality.missing_months],
        "trend": None if trend is None else trend.model_dump(mode="json"),
        "unit": TEMPERATURE.unit,
        "provenance": series.provenance.model_dump(mode="json"),
        "cache_status_first": first.cache_status,
        "cache_status_second": second.cache_status,
        "cache_entries": sorted(p.name for p in cache.root.iterdir()),
    }
    print(json.dumps(report, indent=2))

    assert len(series.observations_monthly) == (end_year - 1981 + 1) * 12
    # Rasterzelle (MERRA-2, ~0.5°, Zellhöhe ~370 m) ist kühler als die Stadt: live 7.0-11.6 °C.
    assert min(annual) >= 5.0 and max(annual) <= 15.0
    assert trend is not None and trend.n_years >= 30
    assert series.provenance.provider == "nasa_power"
    assert series.provenance.community == "AG"
    assert series.provenance.retrieved_at <= dt.datetime.now(dt.UTC)
    assert second.cache_status == "fresh"
