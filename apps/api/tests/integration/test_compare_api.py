"""C3/D1: Compare-Service und Route inklusive OLS/HAC-Trend.

Demo-Daten und Fixtures laufen durch dieselbe Domain; jede Socket-Verbindung ist blockiert.
"""

import datetime as dt
import socket
from collections.abc import Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from fastapi import FastAPI
from fastapi.testclient import TestClient

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.dependencies import get_settings
from trend_detective.main import create_app
from trend_detective.providers.base import MonthlySeries
from trend_detective.providers.demo import DemoProvider
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES, Location, Variable
from trend_detective.schemas.requests import CompareRequest, location_identity
from trend_detective.schemas.responses import CompareResponse, SeriesResult
from trend_detective.services.compare import (
    WARNING_INSUFFICIENT_DATA,
    WARNING_MISSING_BASELINE,
    WARNING_MISSING_MONTHS,
    CompareService,
)

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "demo"
VIENNA, MADRID = LOCATIONS[:2]
TEMPERATURE = VARIABLES[0]
FIXED_NOW = dt.datetime(2026, 11, 14, 10, 0, tzinfo=dt.UTC)
BODY: dict[str, Any] = {
    "variable_id": "temperature_2m",
    "locations": [
        {"id": "vienna", "latitude": 48.21, "longitude": 16.37},
        {"id": "madrid", "latitude": 40.42, "longitude": -3.70},
    ],
    "start_year": 1981,
    "end_year": 2025,
    "baseline": {"start_year": 1991, "end_year": 2020},
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("network access in demo mode")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


@pytest.fixture(autouse=True)
def fresh_settings() -> Iterator[None]:
    """Settings sind gecacht: vor und nach jedem Test leeren, damit TD_DATA_MODE nicht leakt."""
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _app_in_mode(monkeypatch: pytest.MonkeyPatch, mode: str) -> FastAPI:
    monkeypatch.setenv("TD_DATA_MODE", mode)
    get_settings.cache_clear()
    return create_app()


@pytest.fixture
def demo_client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    return TestClient(_app_in_mode(monkeypatch, "demo"))


def _post(client: TestClient, **overrides: Any) -> Any:
    return client.post("/api/v1/compare", json={**BODY, **overrides})


# --- Route mit der echten Demo-Datei -------------------------------------------------


def test_compare_vienna_madrid_demo_returns_valid_response(demo_client: TestClient) -> None:
    response = _post(demo_client)
    assert response.status_code == 200
    result = CompareResponse.model_validate(response.json())
    assert result.data_mode == "demo"
    assert result.comparison.common_years == list(range(1981, 2026))
    assert result.comparison.warnings == []
    for series, location in zip(result.series, (VIENNA, MADRID), strict=True):
        assert series.location == location
        assert series.provenance.provider == "synthetic"
        assert series.provenance.dataset == "demo_temperature_v1"
        assert series.provenance.community == "synthetic"
        assert len(series.observations_monthly) == 540
        assert all(o.quality_flags == [] for o in series.observations_monthly)
        assert len(series.observations_annual) == 45
        assert all(a.valid_months == 12 and a.value is not None for a in series.observations_annual)
        trend = series.trend
        assert trend is not None
        assert (trend.method, trend.n_years, trend.start_year, trend.end_year) == (
            "ols_hac",
            45,
            1981,
            2025,
        )
        assert trend.ci95_low < trend.slope_per_decade < trend.ci95_high
        q = series.quality
        assert (q.status, q.baseline_status, q.coverage_fraction) == ("complete", "complete", 1.0)
        assert q.missing_months == []
        assert q.complete_years == list(range(1981, 2026))
        assert q.warnings == []
        baseline = [a.value for a in series.anomalies_annual if 1991 <= a.year <= 2020]
        assert len(series.anomalies_annual) == 45
        assert abs(sum(v for v in baseline if v is not None) / 30) < 1e-9


def test_trend_line_length_and_slope_on_demo_response(demo_client: TestClient) -> None:
    payload = _post(demo_client, locations=BODY["locations"][:1]).json()
    result = CompareResponse.model_validate(payload)
    trend = result.series[0].trend
    assert trend is not None
    assert trend.trend_line is not None
    assert len(trend.trend_line) == trend.n_years
    years = list(range(trend.start_year, trend.end_year + 1))
    assert [point.year for point in trend.trend_line] == years
    step = trend.slope_per_decade / 10
    for current, nxt in zip(trend.trend_line, trend.trend_line[1:], strict=False):
        assert nxt.value - current.value == pytest.approx(step, abs=1e-12)


def test_result_id_is_stable_and_ignores_request_id(demo_client: TestClient) -> None:
    first, second = _post(demo_client).json(), _post(demo_client).json()
    assert first["result_id"] == second["result_id"]
    assert first["request_id"] != second["request_id"]
    other = _post(demo_client, start_year=1990).json()
    assert other["result_id"] != first["result_id"]


def test_single_location_request_returns_one_series(demo_client: TestClient) -> None:
    """V-1: ein Standort; common_years sind die Jahre dieser Serie, Trend wie im Paar."""
    single = _post(demo_client, locations=BODY["locations"][:1])
    assert single.status_code == 200
    result = CompareResponse.model_validate(single.json())
    assert [s.location for s in result.series] == [VIENNA]
    assert [location_identity(loc) for loc in result.request.locations] == ["vienna"]
    assert result.comparison.common_years == list(range(1981, 2026))
    assert result.comparison.warnings == []
    series = result.series[0]
    assert series.quality.status == "complete"
    assert series.trend is not None
    pair = CompareResponse.model_validate(_post(demo_client).json())
    assert series.trend == pair.series[0].trend
    assert series.anomalies_annual == pair.series[0].anomalies_annual
    assert result.result_id != pair.result_id


def test_single_location_short_window_has_no_trend(demo_client: TestClient) -> None:
    result = CompareResponse.model_validate(
        _post(demo_client, locations=BODY["locations"][1:], start_year=2024).json()
    )
    assert [s.location for s in result.series] == [MADRID]
    assert result.comparison.common_years == [2024, 2025]
    assert result.comparison.warnings == [WARNING_INSUFFICIENT_DATA]
    assert result.series[0].trend is None


def test_short_window_keeps_baseline_and_has_no_trend(demo_client: TestClient) -> None:
    """D-05: unter 3 vollständigen Jahren kein Trend."""
    result = CompareResponse.model_validate(
        _post(demo_client, start_year=2024, end_year=2025).json()
    )
    assert result.comparison.common_years == [2024, 2025]
    assert result.comparison.warnings == [WARNING_INSUFFICIENT_DATA]
    for series in result.series:
        assert series.trend is None
        assert series.quality.status == "insufficient_data"
        # Basis 1991-2020 wird unabhängig vom Fenster geladen: Anomalien bleiben verfügbar.
        assert series.quality.baseline_status == "complete"
        assert len(series.anomalies_annual) == 2


@pytest.mark.parametrize(("start", "short"), [(2023, True), (2017, True), (2016, False)])
def test_short_period_flag_below_ten_years(
    demo_client: TestClient, start: int, short: bool
) -> None:
    """D-05: Trend ab 3 Jahren; unter 10 Jahren diagnostic_flags enthält short_period."""
    result = CompareResponse.model_validate(_post(demo_client, start_year=start).json())
    assert result.comparison.warnings == []
    for series in result.series:
        assert series.trend is not None
        assert series.trend.n_years == 2026 - start
        assert ("short_period" in series.trend.diagnostic_flags) == short
        assert series.quality.status == "complete"


@pytest.mark.parametrize(
    ("overrides", "code"),
    [
        ({"variable_id": "unknown"}, "UNKNOWN_VARIABLE"),
        ({"variable_id": "precipitation"}, "UNKNOWN_VARIABLE"),
        (
            {
                "locations": [
                    BODY["locations"][0],
                    {"id": "berlin", "latitude": 52.5, "longitude": 13.4},
                ]
            },
            "UNKNOWN_LOCATION",
        ),
        ({"baseline": {"start_year": 1981, "end_year": 2010}}, "VALIDATION_ERROR"),
        ({"start_year": 1970}, "VALIDATION_ERROR"),
        ({"locations": []}, "VALIDATION_ERROR"),
        ({"locations": [BODY["locations"][0]] * 2}, "VALIDATION_ERROR"),
    ],
)
def test_invalid_requests_are_422(
    demo_client: TestClient, overrides: dict[str, Any], code: str
) -> None:
    response = _post(demo_client, **overrides)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == code


def test_window_over_50_years_is_422(demo_client: TestClient) -> None:
    # Innerhalb 1981-2025 sind höchstens 45 Jahre möglich; 1975-2025 (51 Jahre) wird abgelehnt.
    response = _post(demo_client, start_year=1975, end_year=2025)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_free_point_out_of_range_is_422(demo_client: TestClient) -> None:
    response = _post(demo_client, locations=[{"kind": "point", "lat": 91, "lon": 13.85}])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


def test_free_point_in_demo_mode_is_422(demo_client: TestClient) -> None:
    response = _post(
        demo_client,
        locations=[{"kind": "point", "lat": 46.61, "lon": 13.85, "label": "Villach"}],
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "UNKNOWN_LOCATION"
    assert error["details"]["location_id"] == "pt:46.6100,13.8500"


def test_live_mode_validates_first_then_503_without_demo_fallback(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    # Live mit PowerProvider (E1); POWER ist per respx dauerhaft 503 -> sichtbarer Fehler.
    monkeypatch.setenv("TD_CACHE_DIR", str(tmp_path))
    with (
        respx.mock(assert_all_called=False) as power,
        TestClient(_app_in_mode(monkeypatch, "live")) as client,
    ):
        route = power.get(host="power.larc.nasa.gov").mock(
            return_value=httpx.Response(503, headers={"Retry-After": "0"})
        )
        invalid = _post(client, variable_id="unknown")
        assert invalid.status_code == 422
        assert route.call_count == 0
        valid = _post(client, end_year=2024)
    assert valid.status_code == 503
    assert valid.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
    assert route.call_count == 3  # 1 Versuch + 2 Wiederholungen, kein Demo-Ersatz


# --- Service mit Fehler-Fixtures (Wien aus Fixture, Madrid aus der Demo-Datei) --------


class _FixtureProvider:
    def __init__(self, vienna_fixture: str) -> None:
        self._vienna = DemoProvider(FIXTURES / vienna_fixture, clock=lambda: FIXED_NOW)
        self._default = DemoProvider(clock=lambda: FIXED_NOW)

    async def fetch_monthly(
        self, location: Location, variable: Variable, start_year: int, end_year: int
    ) -> MonthlySeries:
        provider = self._vienna if location.id == "vienna" else self._default
        return await provider.fetch_monthly(location, variable, start_year, end_year)


async def _compare(fixture: str, **overrides: Any) -> CompareResponse:
    request = CompareRequest.model_validate({**BODY, **overrides})
    service = CompareService(_FixtureProvider(fixture), clock=lambda: FIXED_NOW)
    return await service.compare(request, [VIENNA, MADRID], TEMPERATURE, "req-1", "demo")


def _vienna(result: CompareResponse) -> SeriesResult:
    return result.series[0]


async def test_gap_fixture_makes_years_incomplete_and_disables_baseline() -> None:
    result = await _compare("series_gap.json")
    vienna = _vienna(result)
    q = vienna.quality
    assert q.missing_months == [
        dt.date(2003, 6, 1),
        dt.date(2003, 7, 1),
        dt.date(2003, 8, 1),
        dt.date(2010, 1, 1),
    ]
    assert 2003 not in q.complete_years and 2010 not in q.complete_years
    annual_2003 = next(a for a in vienna.observations_annual if a.year == 2003)
    assert (annual_2003.value, annual_2003.valid_months) == (None, 9)
    # Längste gemeinsame Folge: 1981-2002 (22 Jahre) -> Trend nur darüber.
    assert result.comparison.common_years == list(range(1981, 2003))
    assert q.status == "partial"
    assert vienna.trend is not None
    assert (vienna.trend.n_years, vienna.trend.end_year) == (22, 2002)
    assert "short_period" not in vienna.trend.diagnostic_flags
    assert q.baseline_status == "missing_baseline"
    assert vienna.anomalies_annual == []
    assert q.warnings == [WARNING_MISSING_MONTHS, WARNING_MISSING_BASELINE]
    assert q.coverage_fraction == 536 / 540


async def test_fill_fixture_values_are_missing_not_zero() -> None:
    result = await _compare("series_fill_values.json")
    vienna = _vienna(result)
    assert vienna.quality.missing_months == [
        dt.date(1995, 2, 1),
        dt.date(2012, 11, 1),
        dt.date(2018, 7, 1),
    ]
    by_date = {o.date: o.value for o in vienna.observations_monthly}
    assert by_date[dt.date(1995, 2, 1)] is None
    assert all(v != -999.0 for v in by_date.values())
    assert result.comparison.common_years == list(range(1996, 2012))
    assert vienna.quality.status == "partial"
    assert vienna.trend is not None and vienna.trend.n_years == 16
    assert vienna.quality.baseline_status == "missing_baseline"
    assert vienna.anomalies_annual == []


async def test_incomplete_last_year_is_partial_with_44_common_years() -> None:
    result = await _compare("series_incomplete_year.json")
    vienna = _vienna(result)
    assert vienna.quality.missing_months == [dt.date(2025, m, 1) for m in range(7, 13)]
    assert result.comparison.common_years == list(range(1981, 2025))
    assert vienna.quality.status == "partial"
    assert vienna.quality.baseline_status == "complete"
    # Trend nur über die gemeinsame Folge 1981-2024; 2025 ist unvollständig.
    assert vienna.trend is not None
    assert (vienna.trend.n_years, vienna.trend.end_year) == (44, 2024)
    assert vienna.quality.warnings == [WARNING_MISSING_MONTHS]
    assert result.comparison.warnings == []


async def test_twenty_year_series_gives_trend_without_short_flag() -> None:
    result = await _compare("series_20_years.json")
    vienna = _vienna(result)
    assert result.comparison.common_years == list(range(2006, 2026))
    assert result.comparison.warnings == []
    for series in result.series:
        assert series.trend is not None
        assert (series.trend.n_years, series.trend.start_year) == (20, 2006)
        assert "short_period" not in series.trend.diagnostic_flags
    assert WARNING_INSUFFICIENT_DATA not in vienna.quality.warnings


async def test_series_without_baseline_has_no_anomalies() -> None:
    result = await _compare("series_no_baseline.json")
    vienna, madrid = result.series
    assert vienna.quality.baseline_status == "missing_baseline"
    assert vienna.anomalies_annual == []
    assert WARNING_MISSING_BASELINE in vienna.quality.warnings
    assert vienna.quality.complete_years == [*range(1981, 1991), *range(2021, 2026)]
    # Madrid hat eine vollständige Basis und behält seine Anomalien.
    assert madrid.quality.baseline_status == "complete"
    assert len(madrid.anomalies_annual) == 45


async def test_community_mismatch_is_provider_schema_error() -> None:
    class _MixedCommunity(_FixtureProvider):
        async def fetch_monthly(
            self, location: Location, variable: Variable, start_year: int, end_year: int
        ) -> MonthlySeries:
            series = await super().fetch_monthly(location, variable, start_year, end_year)
            if location.id == "madrid":
                provenance = series.provenance.model_copy(update={"community": "AG"})
                return replace(series, provenance=provenance)
            return series

    request = CompareRequest.model_validate(BODY)
    service = CompareService(_MixedCommunity("series_20_years.json"))
    with pytest.raises(ApiError) as info:
        await service.compare(request, [VIENNA, MADRID], TEMPERATURE, "req-1", "demo")
    assert (info.value.status_code, info.value.code) == (502, ErrorCode.PROVIDER_SCHEMA_ERROR)


def test_demo_trends_match_generator_within_tolerance(demo_client: TestClient) -> None:
    """Manifest: ungewichtete OLS-Trends 0.359 (Wien) aus dem Generator. Unsere Jahreswerte
    sind tagesgewichtet; die Abweichung ist klein, daher 0.02 °C/Jahrzehnt Toleranz."""
    result = CompareResponse.model_validate(_post(demo_client).json())
    vienna = result.series[0].trend
    assert vienna is not None
    assert vienna.slope_per_decade == pytest.approx(0.359, abs=0.02)
    assert vienna.significance_status == "positive_trend"
