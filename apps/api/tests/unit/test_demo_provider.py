"""C2: DemoProvider liest demo_temperature_v1 ohne Netz und normalisiert Fill-Werte zu None."""

import datetime as dt
import hashlib
import json
import socket
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from starlette.requests import Request

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.config import REPO_ROOT
from trend_detective.dependencies import get_provider, get_settings
from trend_detective.main import create_app
from trend_detective.providers.base import MonthlySeries
from trend_detective.providers.demo import DEFAULT_DEMO_FILE, DemoProvider
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES, Location, Variable

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "demo"
FIXED_NOW = dt.datetime(2026, 11, 14, 9, 0, tzinfo=dt.UTC)
VIENNA, MADRID = LOCATIONS[:2]
TEMPERATURE = VARIABLES[0]


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Jede Socket-Verbindung schlägt fehl: belegt, dass der DemoProvider kein Netz braucht."""

    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("network access in demo mode")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


def _provider(path: Path = DEFAULT_DEMO_FILE) -> DemoProvider:
    return DemoProvider(path, clock=lambda: FIXED_NOW)


def _values(series: MonthlySeries) -> dict[str, float | None]:
    return {o.date.isoformat(): o.value for o in series.observations}


async def test_demo_file_vienna_and_madrid_full_period() -> None:
    provider = _provider()
    raw_sha = hashlib.sha256(DEFAULT_DEMO_FILE.read_bytes()).hexdigest()
    for location in (VIENNA, MADRID):
        series = await provider.fetch_monthly(location, TEMPERATURE, 1981, 2025)
        assert len(series.observations) == 540
        assert series.observations[0].date == dt.date(1981, 1, 1)
        assert series.observations[-1].date == dt.date(2025, 12, 1)
        assert all(o.value is not None for o in series.observations)
        p = series.provenance
        assert (p.provider, p.dataset, p.parameter) == ("synthetic", "demo_temperature_v1", "T2M")
        assert "nasa" not in p.model_dump_json().lower()
        assert p.source_url is None
        assert p.returned_coordinates is None
        assert (p.requested_coordinates.latitude, p.requested_coordinates.longitude) == (
            location.latitude,
            location.longitude,
        )
        assert p.raw_sha256 == raw_sha
        assert p.retrieved_at == FIXED_NOW
        assert p.provider_version == "1.0.0"


async def test_values_match_file_exactly() -> None:
    doc = json.loads(DEFAULT_DEMO_FILE.read_text(encoding="utf-8"))
    expected = {o["date"]: o["value"] for o in doc["series"][1]["observations_monthly"]}
    series = await _provider().fetch_monthly(MADRID, TEMPERATURE, 1981, 2025)
    assert _values(series) == expected


async def test_year_window_filters_whole_years() -> None:
    series = await _provider().fetch_monthly(VIENNA, TEMPERATURE, 1991, 2020)
    assert len(series.observations) == 360
    assert series.observations[0].date == dt.date(1991, 1, 1)
    assert series.observations[-1].date == dt.date(2020, 12, 1)


async def test_fill_values_become_none_never_zero() -> None:
    series = await _provider(FIXTURES / "series_fill_values.json").fetch_monthly(
        VIENNA, TEMPERATURE, 1981, 2025
    )
    values = _values(series)
    assert len(values) == 540
    missing = sorted(d for d, v in values.items() if v is None)
    assert missing == ["1995-02-01", "2012-11-01", "2018-07-01"]
    assert all(v != -999.0 for v in values.values())
    assert all(v != 0.0 for d, v in values.items() if d in missing)


async def test_gap_stays_none() -> None:
    values = _values(
        await _provider(FIXTURES / "series_gap.json").fetch_monthly(VIENNA, TEMPERATURE, 1981, 2025)
    )
    assert len(values) == 540
    assert sorted(d for d, v in values.items() if v is None) == [
        "2003-06-01",
        "2003-07-01",
        "2003-08-01",
        "2010-01-01",
    ]


async def test_incomplete_year_passes_through_without_padding() -> None:
    series = await _provider(FIXTURES / "series_incomplete_year.json").fetch_monthly(
        VIENNA, TEMPERATURE, 2025, 2025
    )
    assert [o.date.month for o in series.observations] == [1, 2, 3, 4, 5, 6]


async def test_twenty_year_series_passes_through() -> None:
    series = await _provider(FIXTURES / "series_20_years.json").fetch_monthly(
        VIENNA, TEMPERATURE, 1981, 2025
    )
    assert len(series.observations) == 240
    assert series.observations[0].date == dt.date(2006, 1, 1)


async def test_series_without_baseline_passes_through() -> None:
    values = _values(
        await _provider(FIXTURES / "series_no_baseline.json").fetch_monthly(
            VIENNA, TEMPERATURE, 1981, 2025
        )
    )
    assert len(values) == 540
    assert all(v is None for d, v in values.items() if "1991" <= d[:4] <= "2020")
    assert all(v is not None for d, v in values.items() if not "1991" <= d[:4] <= "2020")


async def test_unknown_location_is_422() -> None:
    berlin = Location(id="berlin", label="Berlin", latitude=52.52, longitude=13.40)
    with pytest.raises(ApiError) as info:
        await _provider().fetch_monthly(berlin, TEMPERATURE, 1981, 2025)
    assert (info.value.status_code, info.value.code) == (422, ErrorCode.UNKNOWN_LOCATION)


async def test_location_missing_in_fixture_is_422() -> None:
    with pytest.raises(ApiError) as info:
        await _provider(FIXTURES / "series_gap.json").fetch_monthly(MADRID, TEMPERATURE, 1981, 2025)
    assert info.value.code == ErrorCode.UNKNOWN_LOCATION


async def test_other_variable_is_422() -> None:
    precipitation: Variable = VARIABLES[1]
    with pytest.raises(ApiError) as info:
        await _provider().fetch_monthly(VIENNA, precipitation, 1981, 2025)
    assert (info.value.status_code, info.value.code) == (422, ErrorCode.UNKNOWN_VARIABLE)


def _write(tmp_path: Path, doc: dict[str, Any]) -> Path:
    path = tmp_path / "demo.json"
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


def _doc(**overrides: Any) -> dict[str, Any]:
    doc: dict[str, Any] = json.loads((FIXTURES / "series_20_years.json").read_text("utf-8"))
    doc.update(overrides)
    return doc


@pytest.mark.parametrize(
    "overrides",
    [{"unit": "K"}, {"provider": "nasa_power"}, {"synthetic": False}, {"series": []}],
)
async def test_wrong_metadata_is_schema_error(tmp_path: Path, overrides: dict[str, Any]) -> None:
    provider = _provider(_write(tmp_path, _doc(**overrides)))
    with pytest.raises(ApiError) as info:
        await provider.fetch_monthly(VIENNA, TEMPERATURE, 1981, 2025)
    assert (info.value.status_code, info.value.code) == (502, ErrorCode.PROVIDER_SCHEMA_ERROR)


async def test_duplicate_month_is_schema_error(tmp_path: Path) -> None:
    doc = _doc()
    observations = doc["series"][0]["observations_monthly"]
    observations.append(dict(observations[0]))
    with pytest.raises(ApiError) as info:
        await _provider(_write(tmp_path, doc)).fetch_monthly(VIENNA, TEMPERATURE, 1981, 2025)
    assert info.value.code == ErrorCode.PROVIDER_SCHEMA_ERROR


async def test_zero_stays_zero_and_unsorted_input_is_sorted(tmp_path: Path) -> None:
    doc = _doc()
    observations = doc["series"][0]["observations_monthly"]
    observations[0]["value"] = 0.0
    observations.reverse()
    series = await _provider(_write(tmp_path, doc)).fetch_monthly(VIENNA, TEMPERATURE, 1981, 2025)
    assert series.observations[0].date == dt.date(2006, 1, 1)
    assert series.observations[0].value == 0.0
    dates = [o.date for o in series.observations]
    assert dates == sorted(dates)


async def test_missing_file_is_provider_unavailable(tmp_path: Path) -> None:
    with pytest.raises(ApiError) as info:
        await _provider(tmp_path / "missing.json").fetch_monthly(VIENNA, TEMPERATURE, 1981, 2025)
    assert (info.value.status_code, info.value.code) == (503, ErrorCode.PROVIDER_UNAVAILABLE)


def _app_in_mode(monkeypatch: pytest.MonkeyPatch, mode: str) -> FastAPI:
    monkeypatch.setenv("TD_DATA_MODE", mode)
    get_settings.cache_clear()
    try:
        return create_app()
    finally:
        get_settings.cache_clear()


def test_demo_mode_injects_demo_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app_in_mode(monkeypatch, "demo")
    provider = get_provider(Request({"type": "http", "app": app, "headers": []}), "demo")
    assert isinstance(provider, DemoProvider)


def test_live_mode_has_no_silent_demo_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    app = _app_in_mode(monkeypatch, "live")
    assert app.state.provider is None
    with pytest.raises(ApiError) as info:
        get_provider(Request({"type": "http", "app": app, "headers": []}), "live")
    assert (info.value.status_code, info.value.code) == (503, ErrorCode.PROVIDER_UNAVAILABLE)


def test_default_demo_file_is_in_data_demo() -> None:
    assert DEFAULT_DEMO_FILE == REPO_ROOT / "data" / "demo" / "temperature_monthly.json"
