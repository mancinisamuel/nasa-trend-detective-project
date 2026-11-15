"""B-EXTREMES: GET /api/v1/extremes über die echte App, POWER per respx (kein Netz)."""

import socket
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
import respx
from fastapi.testclient import TestClient

from trend_detective.dependencies import get_settings
from trend_detective.main import create_app

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "power_daily_sample.json"
URL = "/api/v1/extremes?lat=48.21&lon=16.37&start_year=1983&end_year=1984"


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network access in tests")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


def _env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, mode: str) -> None:
    monkeypatch.setenv("TD_DATA_MODE", mode)
    monkeypatch.setenv("TD_CACHE_DIR", str(tmp_path / "cache"))
    monkeypatch.setenv("TD_POWER_END_YEAR", "2024")
    get_settings.cache_clear()


def test_live_extremes_single_daily_request_and_cache(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _env(monkeypatch, tmp_path, "live")
    try:
        with respx.mock(assert_all_called=False) as power, TestClient(create_app()) as client:
            route = power.get(host="power.larc.nasa.gov").mock(
                return_value=httpx.Response(200, content=SAMPLE.read_bytes())
            )
            first = client.get(URL)
            second = client.get(URL)
            bad = client.get(URL.replace("lat=48.21", "lat=91"))
    finally:
        get_settings.cache_clear()
    assert first.status_code == 200, first.text
    assert route.call_count == 1
    params = route.calls[0].request.url.params
    assert route.calls[0].request.url.path == "/api/temporal/daily/point"
    assert params["parameters"] == "T2M_MAX,T2M_MIN,PRECTOTCORR,WS10M,WS10M_MAX,ALLSKY_SFC_SW_DWN"
    assert (params["community"], params["units"], params["time-standard"]) == (
        "AG",
        "metric",
        "LST",
    )
    assert (params["start"], params["end"]) == ("19830101", "19841231")
    body = first.json()
    assert body["data_end"] == "1984-01-02"
    assert body["thresholds"]["hot_day_tmax_c"] == 30
    # Nur 4 Tage geliefert: kein Jahr vollständig -> null statt 0, kein Trend.
    assert [v["value"] for v in body["metrics"]["hot_days"]["series"]] == [None, None]
    assert body["metrics"]["hot_days"]["trend"] is None
    assert second.json()["cache_status"] == "fresh"
    assert bad.status_code == 422
    assert bad.json()["error"]["code"] == "VALIDATION_ERROR"


def test_demo_mode_rejects_extremes(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    _env(monkeypatch, tmp_path, "demo")
    try:
        response = TestClient(create_app()).get(URL)
    finally:
        get_settings.cache_clear()
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "UNKNOWN_LOCATION"
