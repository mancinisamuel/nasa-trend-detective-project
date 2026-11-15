"""B-ERR2: 502 nur mit festem Text; Schlüssel, Einheiten, Werte, Exception-Texte nur im Log."""

import json
import logging
from collections.abc import Callable
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trend_detective.api.errors import (
    UPSTREAM_DATA_UNAVAILABLE,
    ApiError,
    ErrorCode,
    install_error_handling,
)
from trend_detective.domain import geometry as geo
from trend_detective.providers.demo import DEFAULT_DEMO_FILE, DemoProvider
from trend_detective.providers.geoboundaries import Layer, LayerMetadata
from trend_detective.providers.power import POWER_HOST, PowerProvider
from trend_detective.providers.power_daily import normalize_power_daily
from trend_detective.providers.power_regional import cell_centre, features_by_cell
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES
from trend_detective.services import compare, regions
from trend_detective.storage.file_cache import FileCache

SECRET = "SECRET_UPSTREAM_DETAIL"
DAILY_SAMPLE = Path(__file__).parents[1] / "fixtures" / "power_daily_sample.json"
VIENNA = next(location for location in LOCATIONS if location.id == "vienna")
TEMPERATURE = VARIABLES[0]


def _assert_neutral_502(
    error: ApiError, caplog: pytest.LogCaptureFixture, code: ErrorCode, *leaks: str
) -> None:
    """Fehler durch den echten Handler schicken: fester Text in der Antwort, Details im Log."""
    assert (error.status_code, error.code) == (502, code)
    app = FastAPI()
    install_error_handling(app)

    @app.get("/boom")
    def boom() -> None:
        raise error

    caplog.clear()
    with caplog.at_level(logging.WARNING, logger="trend_detective.api.errors"):
        response = TestClient(app).get("/boom")
    assert response.status_code == 502
    body = response.json()["error"]
    assert (body["code"], body["message"]) == (code, UPSTREAM_DATA_UNAVAILABLE)
    for leak in leaks:
        assert leak not in response.text
        assert leak in caplog.text
    assert "GET /boom" in caplog.text


async def _raised(call: Callable[[], Any]) -> ApiError:
    with pytest.raises(ApiError) as info:
        result = call()
        if hasattr(result, "__await__"):
            await result
    return info.value


class _NoCache:
    """Cache ohne Dateien (keine tmp-Dateien außerhalb des Projekts)."""

    def read(self, *_: object) -> None:
        return None

    def write(self, *_: object, **__: object) -> None:
        raise AssertionError("errors must not be cached")


def _power(client: httpx.AsyncClient) -> PowerProvider:
    async def no_sleep(_: float) -> None:
        return None

    return PowerProvider(
        client,
        cast(FileCache, _NoCache()),
        total_timeout_seconds=15,
        sleep=no_sleep,
        jitter=lambda: 0.0,
    )


async def test_regions_geometry_exception_text_stays_in_log(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(_: object) -> object:
        raise geo.GeometryError(SECRET)

    monkeypatch.setattr(geo, "parse_geometry", broken)
    meta = LayerMetadata(
        level="ADM1",
        boundary_id="TEST-ADM1",
        boundary_source="test",
        boundary_year_represented="2020",
        build_date="2020-01-01",
        license="CC0",
        license_source="https://www.geoboundaries.org",
        metadata_url="https://www.geoboundaries.org/api/current/gbOpen/USA/ADM1/",
        download_url="https://github.com/example/test.json",
    )
    feature = {"type": "Feature", "properties": {"shapeID": "s", "shapeName": "S"}}
    error = await _raised(lambda: regions._units(Layer(metadata=meta, features=[feature])))
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET, "geoBoundaries")


async def test_compare_boundary_exception_text_stays_in_log(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(_: object) -> object:
        raise geo.GeometryError(SECRET)

    class Boundaries:
        async def get_region(self, country_iso3: str, adm1_id: str) -> Any:
            return SimpleNamespace(boundary=SimpleNamespace(model_dump=lambda **_: {}))

    monkeypatch.setattr(geo, "parse_geometry", broken)
    error = await _raised(lambda: compare.state_cells(Boundaries(), "zz-leak", "ZZZ", "leak-test"))
    assert ("ZZZ", "leak-test") not in compare.STATE_CELL_CACHE
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET, "unusable")


async def test_power_wrong_unit_stays_in_log(
    caplog: pytest.LogCaptureFixture, power_payload: Callable[..., bytes]
) -> None:
    payload = power_payload(2000, 2001, unit=SECRET)
    async with httpx.AsyncClient() as client:
        with respx.mock(assert_all_called=True) as router:
            router.get(host=POWER_HOST, path="/api/temporal/monthly/point").respond(
                200, content=payload
            )
            provider = _power(client)
            error = await _raised(lambda: provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001))
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET, "T2M")


async def test_power_wrong_key_stays_in_log(
    caplog: pytest.LogCaptureFixture, power_payload: Callable[..., bytes]
) -> None:
    doc = json.loads(power_payload(2000, 2001))
    doc["properties"]["parameter"]["T2M"][SECRET] = 1.0
    async with httpx.AsyncClient() as client:
        with respx.mock(assert_all_called=True) as router:
            router.get(host=POWER_HOST, path="/api/temporal/monthly/point").respond(
                200, content=json.dumps(doc).encode()
            )
            provider = _power(client)
            error = await _raised(lambda: provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001))
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET, "month key")


async def test_power_rejected_request_keeps_status_but_neutral_text(
    caplog: pytest.LogCaptureFixture,
) -> None:
    async with httpx.AsyncClient() as client:
        with respx.mock(assert_all_called=True) as router:
            router.get(host=POWER_HOST, path="/api/temporal/monthly/point").respond(
                400, json={"messages": [SECRET]}
            )
            provider = _power(client)
            error = await _raised(lambda: provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001))
    assert error.details == {"provider_status": 400}
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_UNAVAILABLE, "rejected the request")


@pytest.mark.parametrize("broken", ["unit", "day key"])
async def test_power_daily_unit_and_key_stay_in_log(
    broken: str, caplog: pytest.LogCaptureFixture
) -> None:
    doc = json.loads(DAILY_SAMPLE.read_text(encoding="utf-8"))
    if broken == "unit":
        doc["parameters"]["T2M_MAX"]["units"] = SECRET
    else:
        doc["properties"]["parameter"]["T2M_MAX"][SECRET] = 1.0
    raw = json.dumps(doc).encode()
    error = await _raised(lambda: normalize_power_daily(raw, start_year=1981, end_year=2025))
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET)


async def test_power_regional_values_stay_in_log(caplog: pytest.LogCaptureFixture) -> None:
    latitude, longitude = cell_centre((277, 315))
    feature = {"type": "Feature", "geometry": {"coordinates": [longitude, latitude]}}
    error = await _raised(lambda: features_by_cell({"features": [feature, feature]}))
    value = f"{latitude}, {longitude}"
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, value, "Duplicate")


async def test_demo_unit_stays_in_log(caplog: pytest.LogCaptureFixture) -> None:
    doc = json.loads(DEFAULT_DEMO_FILE.read_text(encoding="utf-8"))
    doc["unit"] = SECRET
    raw = json.dumps(doc).encode()

    class InMemoryFile:
        def read_bytes(self) -> bytes:
            return raw

    provider = DemoProvider(cast(Path, InMemoryFile()))
    error = await _raised(lambda: provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001))
    _assert_neutral_502(error, caplog, ErrorCode.PROVIDER_SCHEMA_ERROR, SECRET, "demo unit")
