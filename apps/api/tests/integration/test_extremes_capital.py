"""B-EXTCAP: Extremwerte für Bundesländer/States an der Hauptstadt (respx, kein Netz)."""

import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from trend_detective.dependencies import get_settings
from trend_detective.domain.capitals import AUSTRIA_CAPITAL_NAMES, US_CAPITALS
from trend_detective.main import create_app
from trend_detective.schemas.catalog import LOCATIONS
from trend_detective.services.extremes import capital_of

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "power_daily_sample.json"
YEARS = "start_year=1983&end_year=1984"


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network access in tests")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


def _get(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, query: str
) -> tuple[httpx.Response, respx.Route]:
    monkeypatch.setenv("TD_DATA_MODE", "live")
    monkeypatch.setenv("TD_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TD_POWER_END_YEAR", "2024")
    get_settings.cache_clear()
    try:
        with respx.mock(assert_all_called=False) as power, TestClient(create_app()) as client:
            route = power.get(host="power.larc.nasa.gov").mock(
                return_value=httpx.Response(200, content=SAMPLE.read_bytes())
            )
            response = client.get(f"/api/v1/extremes?{query}&{YEARS}")
    finally:
        get_settings.cache_clear()
    return response, route


@pytest.mark.parametrize(
    ("location_id", "name", "lat", "lon"),
    [
        ("at-niederoesterreich", "St. Pölten", 48.20, 15.63),
        ("us-tx", "Austin", 30.2986, -97.7541),
        ("us-dc", "Washington", 38.9042, -77.0165),
        ("at", "Wien", 48.21, 16.37),
    ],
)
def test_state_extremes_use_one_daily_point_request_at_the_capital(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    location_id: str,
    name: str,
    lat: float,
    lon: float,
) -> None:
    response, route = _get(monkeypatch, tmp_path, f"location_id={location_id}")
    assert response.status_code == 200, response.text
    assert route.call_count == 1
    request = route.calls[0].request
    assert request.url.path == "/api/temporal/daily/point"
    assert (float(request.url.params["latitude"]), float(request.url.params["longitude"])) == (
        lat,
        lon,
    )
    body: dict[str, Any] = response.json()
    provenance = body["provenance"]
    assert provenance["spatial_method"] == "capital_point"
    assert provenance["capital_name"] == name
    assert provenance["cell_count"] is None
    assert provenance["requested_coordinates"] == {"latitude": lat, "longitude": lon}
    assert body["coordinates"] == {"latitude": lat, "longitude": lon}


def test_point_extremes_have_no_capital(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    response, route = _get(monkeypatch, tmp_path, "lat=48.21&lon=16.37")
    assert response.status_code == 200, response.text
    assert route.call_count == 1
    provenance = response.json()["provenance"]
    assert provenance["spatial_method"] is None
    assert provenance["capital_name"] is None


def test_catalog_grid_point_location_is_not_a_capital(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    response, route = _get(monkeypatch, tmp_path, "location_id=vienna")
    assert response.status_code == 200, response.text
    params = route.calls[0].request.url.params
    assert (params["latitude"], params["longitude"]) == ("48.21", "16.37")
    assert response.json()["provenance"]["spatial_method"] is None


def test_usa_extremes_still_rejected(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    response, route = _get(monkeypatch, tmp_path, "location_id=usa")
    assert response.status_code == 422
    assert route.call_count == 0


def test_every_state_has_a_capital_and_usa_has_none() -> None:
    by_id = {loc.id: loc for loc in LOCATIONS}
    states = [i for i in by_id if i.startswith(("at-", "us-"))]
    assert len(states) == len(AUSTRIA_CAPITAL_NAMES) + len(US_CAPITALS) == 60
    for state_id in states:
        assert capital_of(by_id[state_id]) is not None, state_id
    assert capital_of(by_id["usa"]) is None
