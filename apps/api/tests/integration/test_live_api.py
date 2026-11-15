"""E1: Live-Modus über die echte App (lifespan, PowerProvider, FileCache) mit respx statt Netz."""

import datetime as dt
import socket
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request

from trend_detective.config import Settings
from trend_detective.dependencies import get_provider, get_settings, get_year_bounds
from trend_detective.main import create_app
from trend_detective.providers.power import PowerProvider

PowerPayload = Callable[..., bytes]
BODY: dict[str, Any] = {
    "variable_id": "temperature_2m",
    "locations": [{"id": "vienna", "latitude": 48.21, "longitude": 16.37}],
    "start_year": 1981,
    "end_year": 2024,
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network access in tests")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


@pytest.fixture(autouse=True)
def live_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[None]:
    monkeypatch.setenv("TD_DATA_MODE", "live")
    monkeypatch.setenv("TD_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TD_POWER_END_YEAR", "2024")
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _power_handler(power_payload: PowerPayload) -> Callable[[httpx.Request], httpx.Response]:
    def _handler(request: httpx.Request) -> httpx.Response:
        params = request.url.params
        assert params["community"] == "AG" and params["parameters"] == "T2M"
        start, end = int(params["start"]), int(params["end"])
        return httpx.Response(200, content=power_payload(start, end))

    return _handler


@pytest.fixture
def app() -> FastAPI:
    return create_app()


def test_lifespan_starts_and_stops_power_provider(app: FastAPI) -> None:
    assert app.state.provider is None
    with TestClient(app):
        provider = get_provider(Request({"type": "http", "app": app, "headers": []}), "live")
        assert isinstance(provider, PowerProvider)
    assert app.state.provider is None


def test_live_compare_uses_power_and_cache(
    app: FastAPI, power_payload: PowerPayload, tmp_path: Path
) -> None:
    with respx.mock(assert_all_called=False) as power, TestClient(app) as client:
        route = power.get(host="power.larc.nasa.gov").mock(
            side_effect=_power_handler(power_payload)
        )
        first = client.post("/api/v1/compare", json=BODY)
        second = client.post("/api/v1/compare", json=BODY)
    assert first.status_code == 200, first.text
    assert route.call_count == 2  # Fenster 1981-2024 und Basis 1991-2020, danach nur Cache
    body = first.json()
    assert body["data_mode"] == "live"
    assert body["cache_status"] == "miss"
    series = body["series"][0]
    provenance = series["provenance"]
    assert provenance["provider"] == "nasa_power"
    assert provenance["community"] == "AG"
    assert provenance["source_url"].startswith(
        "https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M&community=AG"
    )
    assert provenance["requested_coordinates"] == {"latitude": 48.21, "longitude": 16.37}
    assert len(series["observations_monthly"]) == 44 * 12
    assert series["trend"]["n_years"] == 44
    # Synthetische Steigung 0.03 °C/Jahr -> 0.3 °C/Jahrzehnt.
    assert series["trend"]["slope_per_decade"] == pytest.approx(0.3, abs=0.01)
    again = second.json()
    assert again["cache_status"] == "fresh"
    assert again["series"][0]["cache_status"] == "fresh"
    assert again["result_id"] == body["result_id"]
    assert len(list((tmp_path / "cache" / "power").iterdir())) == 2


def test_live_end_year_bound_is_validated_before_provider(app: FastAPI) -> None:
    with respx.mock(assert_all_called=False) as power, TestClient(app) as client:
        route = power.get(host="power.larc.nasa.gov")
        response = client.post("/api/v1/compare", json={**BODY, "end_year": 2025})
        catalog = client.get("/api/v1/catalog").json()
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "VALIDATION_ERROR"
    assert error["details"]["errors"][0]["loc"] == ["body", "end_year"]
    assert route.call_count == 0
    assert catalog["data_mode"] == "live"
    assert catalog["year_bounds"] == {
        "min_year": 1981,
        "max_year": 2024,
        "max_years_per_request": 50,
    }
    assert {v["available_from_year"] for v in catalog["variables"]} == {1981}
    assert {v["available_to_year"] for v in catalog["variables"]} == {2024}


def test_live_schema_error_is_visible(app: FastAPI, power_payload: PowerPayload) -> None:
    with respx.mock(assert_all_called=False) as power, TestClient(app) as client:
        power.get(host="power.larc.nasa.gov").mock(
            return_value=httpx.Response(200, content=power_payload(1981, 2024, unit="K"))
        )
        response = client.post("/api/v1/compare", json=BODY)
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "PROVIDER_SCHEMA_ERROR"


def test_live_year_bound_defaults_to_last_complete_year() -> None:
    settings = Settings(data_mode="live", power_end_year=None)
    assert get_year_bounds(settings, dt.date(2026, 11, 14)).max_year == 2025
    assert get_year_bounds(settings, dt.date(2027, 1, 1)).max_year == 2026
    demo = Settings(data_mode="demo")
    assert get_year_bounds(demo, dt.date(2030, 1, 1)).max_year == 2025


def test_catalog_variables_follow_power_end_year(app: FastAPI) -> None:
    # live_env setzt TD_POWER_END_YEAR=2024; gleiche Grenze wie get_year_bounds.
    with TestClient(app) as client:
        catalog = client.get("/api/v1/catalog").json()
    assert catalog["year_bounds"]["max_year"] == 2024
    assert all(v["available_to_year"] == 2024 for v in catalog["variables"])
    assert all(v["available_from_year"] == 1981 for v in catalog["variables"])


def test_live_compare_accepts_free_point(app: FastAPI, power_payload: PowerPayload) -> None:
    body = {
        "variable_id": "temperature_2m",
        "locations": [{"kind": "point", "lat": 46.61, "lon": 13.85, "label": "Villach"}],
        "start_year": 1981,
        "end_year": 2024,
        "baseline": {"start_year": 1991, "end_year": 2020},
    }
    with respx.mock(assert_all_called=False) as power, TestClient(app) as client:
        power.get(host="power.larc.nasa.gov").mock(
            side_effect=_power_handler(
                lambda start, end: power_payload(start, end, latitude=46.61, longitude=13.85)
            )
        )
        response = client.post("/api/v1/compare", json=body)
    assert response.status_code == 200, response.text
    series = response.json()["series"][0]
    assert series["location"] == {
        "id": "pt:46.6100,13.8500",
        "label": "Villach",
        "latitude": 46.61,
        "longitude": 13.85,
        "spatial_kind": "grid_point",
    }
    assert series["trend"] is not None
    assert series["trend"]["n_years"] == 44
    assert series["trend"]["slope_per_decade"] == pytest.approx(0.3, abs=0.01)


def test_demo_mode_never_uses_power_provider(app: FastAPI) -> None:
    with TestClient(app):
        request = Request({"type": "http", "app": app, "headers": []})
        with pytest.raises(Exception) as info:
            get_provider(request, "demo")
    assert getattr(info.value, "status_code", None) == 503
