"""B-REGIONAL: Flächenmittel-Zellen über POWER-regional-Kacheln (respx, kein echtes Netz)."""

import datetime as dt
import math
import socket
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any, cast

import httpx
import pytest
import respx

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.domain.power_grid import LAT_STEP, LON_STEP, GridCell
from trend_detective.providers.base import MonthlySeries
from trend_detective.providers.power import MAX_PARALLEL_REQUESTS, POWER_HOST, PowerProvider
from trend_detective.providers.power_regional import (
    MAX_TILE_DEG,
    MIN_BOX_DEG,
    Index,
    Tile,
    cell_centre,
    cell_index,
    pick_cells,
    plan_tiles,
)
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES, Location, Variable
from trend_detective.schemas.regions import RegionResponse
from trend_detective.schemas.requests import CompareRequest
from trend_detective.services import compare as compare_module
from trend_detective.services.compare import CompareService
from trend_detective.storage.file_cache import FileCache

PowerPayload = Any
NOW = dt.datetime(2026, 11, 14, 12, 0, tzinfo=dt.UTC)
TEMPERATURE = VARIABLES[0]
MONTHLY_REGIONAL = "/api/temporal/monthly/regional"
# Kachel (30, 18): Zeilen 240..247 (30.0..33.5 °N), Spalten 126..132 (-101.25..-97.5 °E).
TILE_A: list[Index] = [(242, 127), (243, 128), (241, 130)]
OTHER_TILE: Index = (242, 133)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network access in unit tests")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(follow_redirects=False) as c:
        yield c


@pytest.fixture
def router() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        yield mock


def _value(lat: float, lon: float, year: int, month: int) -> float:
    seasonal = 10.0 * math.sin((month - 4) / 12 * 2 * math.pi)
    return round(10.0 + seasonal + 0.03 * (year - 1981) + 0.1 * lat + 0.01 * lon, 2)


def _daily_value(parameter: str, lat: float, lon: float, day: dt.date) -> float:
    return round(len(parameter) + 0.1 * lat + 0.01 * lon + day.timetuple().tm_yday / 100, 2)


def _grid_in_box(params: httpx.QueryParams) -> list[tuple[float, float]]:
    """Wie POWER: alle Zellzentren in der Box, Grenzen inklusive."""
    lat_min, lat_max = float(params["latitude-min"]), float(params["latitude-max"])
    lon_min, lon_max = float(params["longitude-min"]), float(params["longitude-max"])
    i_lo, i_hi = math.ceil((lat_min + 90) / LAT_STEP), math.floor((lat_max + 90) / LAT_STEP)
    j_lo, j_hi = math.ceil((lon_min + 180) / LON_STEP), math.floor((lon_max + 180) / LON_STEP)
    return [
        (-90 + i * LAT_STEP, -180 + j * LON_STEP)
        for i in range(i_lo, i_hi + 1)
        for j in range(j_lo, j_hi + 1)
    ]


def _feature(lat: float, lon: float, parameter: str, values: dict[str, float]) -> dict[str, Any]:
    # Leichtes Float-Rauschen in den Koordinaten wie bei echten Antworten.
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [lon + 1e-7, lat - 1e-7, 120.5]},
        "properties": {"parameter": {parameter: values}},
    }


def _monthly_regional(request: httpx.Request) -> httpx.Response:
    params = request.url.params
    parameter = params["parameters"]
    start, end = int(params["start"]), int(params["end"])
    features = []
    for lat, lon in _grid_in_box(params):
        values: dict[str, float] = {}
        for year in range(start, end + 1):
            months = [_value(lat, lon, year, m) for m in range(1, 13)]
            for month, v in enumerate(months, start=1):
                values[f"{year}{month:02d}"] = v
            values[f"{year}13"] = round(sum(months) / 12, 2)
        features.append(_feature(lat, lon, parameter, values))
    doc = {
        "type": "FeatureCollection",
        "features": features,
        "header": {
            "title": "NASA/POWER Source Native Resolution Monthly and Annual",
            "api": {"version": "v2.10.0"},
            "fill_value": -999.0,
        },
        "parameters": {parameter: {"units": "C", "longname": "Temperature at 2 Meters"}},
        "messages": [],
    }
    return httpx.Response(200, json=doc)


def _power(
    client: httpx.AsyncClient, root: Path, sleeps: list[float] | None = None
) -> PowerProvider:
    recorded = sleeps if sleeps is not None else []

    async def sleep(delay: float) -> None:
        recorded.append(delay)

    return PowerProvider(
        client,
        FileCache(root / "power", 86400),
        total_timeout_seconds=15,
        clock=lambda: NOW,
        sleep=sleep,
        jitter=lambda: 0.0,
    )


def _cells(indices: list[Index]) -> list[GridCell]:
    return [GridCell(*cell_centre(index), weight=1 / len(indices)) for index in indices]


def _box_extent(request: httpx.Request) -> tuple[float, float]:
    p = request.url.params
    return (
        float(p["latitude-max"]) - float(p["latitude-min"]),
        float(p["longitude-max"]) - float(p["longitude-min"]),
    )


def test_cell_index_rounds_to_grid_with_tolerance() -> None:
    assert cell_index(31.0, -97.5) == (242, 132)
    assert cell_index(31.0000001, -97.4999999) == (242, 132)
    assert cell_index(31.2, -97.5) is None
    assert cell_centre((242, 132)) == (31.0, -97.5)


def test_tiles_cover_needed_cells_and_stay_within_4_degrees() -> None:
    needed = {(i, j) for i in range(230, 254) for j in range(117, 140) if (i + j) % 3}
    tiles = plan_tiles(needed)
    for index in needed:
        assert sum(tile.contains(index) for tile in tiles) == 1
    for tile in tiles:
        assert any(tile.contains(cell) for cell in needed)
        box = tile.box()
        assert MIN_BOX_DEG <= box.latitude_max - box.latitude_min <= MAX_TILE_DEG
        assert MIN_BOX_DEG <= box.longitude_max - box.longitude_min <= MAX_TILE_DEG
        for corner in [(tile.i_min, tile.j_min), (tile.i_max, tile.j_max)]:
            lat, lon = cell_centre(corner)
            assert box.latitude_min < lat < box.latitude_max
            assert box.longitude_min < lon < box.longitude_max


def test_neighbouring_cells_share_the_fixed_global_tile() -> None:
    assert plan_tiles([(242, 127)]) == plan_tiles([(247, 132)]) == [Tile(240, 247, 126, 132)]
    single = Tile(242, 242, 127, 127).box()
    assert single.latitude_max - single.latitude_min == pytest.approx(MIN_BOX_DEG)


def test_pick_cells_maps_features_and_rejects_missing_cell() -> None:
    doc = {
        "features": [
            {"geometry": {"coordinates": [-97.5000001, 31.0, 5]}, "properties": {"x": 1}},
            {"geometry": {"coordinates": [-96.875, 31.0, 5]}, "properties": {"x": 2}},
            {"geometry": {"coordinates": [-96.9, 31.2, 5]}, "properties": {"x": 3}},
        ]
    }
    picked = pick_cells(doc, [(242, 132)])
    assert picked[(242, 132)]["properties"] == {"x": 1}
    with pytest.raises(ApiError) as info:
        pick_cells(doc, [(242, 132), (243, 132)])
    assert info.value.code == ErrorCode.PROVIDER_SCHEMA_ERROR


async def test_one_request_per_tile_then_cache_hit_without_http(
    router: respx.MockRouter, client: httpx.AsyncClient, tmp_path: Path
) -> None:
    route = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(side_effect=_monthly_regional)
    cells = _cells([*TILE_A, OTHER_TILE])
    first = await _power(client, tmp_path).fetch_cells_monthly(cells, TEMPERATURE, 2000, 2001)
    assert route.call_count == 2
    for call in route.calls:
        assert call.request.url.params["parameters"] == "T2M"
        assert call.request.url.params["community"] == "AG"
        lat_extent, lon_extent = _box_extent(call.request)
        assert lat_extent <= MAX_TILE_DEG and lon_extent <= MAX_TILE_DEG
    assert [s.cache_status for s in first] == ["miss"] * 4
    for cell, series in zip(cells, first, strict=True):
        assert len(series.observations) == 24
        assert series.observations[0].value == _value(cell.latitude, cell.longitude, 2000, 1)
        requested = series.provenance.requested_coordinates
        assert (requested.latitude, requested.longitude) == (cell.latitude, cell.longitude)
        assert series.provenance.source_url is not None
        assert "/monthly/regional?" in series.provenance.source_url

    again = await _power(client, tmp_path).fetch_cells_monthly(cells, TEMPERATURE, 2000, 2001)
    assert route.call_count == 2
    assert [s.cache_status for s in again] == ["fresh"] * 4
    assert [s.observations for s in again] == [s.observations for s in first]


async def test_422_splits_tile_until_power_accepts(
    router: respx.MockRouter, client: httpx.AsyncClient, tmp_path: Path
) -> None:
    extents: list[tuple[float, float]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        extent = _box_extent(request)
        extents.append(extent)
        if max(extent) > 2.5:
            return httpx.Response(422, json={"messages": ["region too large"]})
        return _monthly_regional(request)

    route = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(side_effect=handler)
    corners: list[Index] = [(240, 126), (247, 132), (240, 132), (247, 126)]
    series = await _power(client, tmp_path).fetch_cells_monthly(
        _cells(corners), TEMPERATURE, 2000, 2000
    )
    for index, item in zip(corners, series, strict=True):
        assert item.observations[0].value == _value(*cell_centre(index), 2000, 1)
    assert extents[0] == pytest.approx((3.7, 3.95))
    assert route.call_count > 1
    assert sum(max(extent) <= 2.5 for extent in extents) == 4


async def test_422_at_minimal_box_is_an_error(
    router: respx.MockRouter, client: httpx.AsyncClient, tmp_path: Path
) -> None:
    route = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(
        return_value=httpx.Response(422, json={"messages": ["bad"]})
    )
    with pytest.raises(ApiError) as info:
        await _power(client, tmp_path).fetch_cells_monthly(
            _cells([(242, 127)]), TEMPERATURE, 2000, 2000
        )
    assert info.value.status_code == 502
    assert info.value.details == {"provider_status": 422}
    assert route.call_count <= 4
    assert max(_box_extent(route.calls.last.request)) == pytest.approx(MIN_BOX_DEG)


async def test_429_aborts_immediately_without_retry(
    router: respx.MockRouter, client: httpx.AsyncClient, tmp_path: Path
) -> None:
    route = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(
        return_value=httpx.Response(429, headers={"Retry-After": "120"})
    )
    sleeps: list[float] = []
    cells = _cells([(242, 7 * k) for k in range(10, 16)])  # sechs verschiedene Kacheln
    provider = _power(client, tmp_path, sleeps)
    with pytest.raises(ApiError) as info:
        await provider.fetch_cells_monthly(cells, TEMPERATURE, 2000, 2000)
    assert info.value.status_code == 503
    assert info.value.code == ErrorCode.PROVIDER_UNAVAILABLE
    assert info.value.details == {"provider_status": 429, "retry_after_s": 120.0}
    assert "rate limit" in info.value.message
    assert route.call_count == 1  # kein Retry, keine weitere Kachel
    assert sleeps == []

    # Sperre bis Retry-After: auch ein neuer Abruf geht nicht mehr an POWER.
    with pytest.raises(ApiError) as again:
        await provider.fetch_cells_monthly(cells[:1], TEMPERATURE, 2000, 2000)
    assert again.value.details == {"provider_status": 429, "retry_after_s": 120.0}
    assert route.call_count == 1


class _NoBoundaries:
    async def get_region(self, country_iso3: str, adm1_id: str) -> RegionResponse:
        raise AssertionError("state_cells is patched in this test")


class _PointOnly:
    """Bisheriger Weg: ein Punktabruf je Zelle (kein PowerProvider -> kein Regional)."""

    def __init__(self, power: PowerProvider) -> None:
        self._power = power

    async def fetch_monthly(
        self, location: Location, variable: Variable, start_year: int, end_year: int
    ) -> MonthlySeries:
        return await self._power.fetch_monthly(location, variable, start_year, end_year)


async def test_area_mean_from_tiles_equals_point_based_mean(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    power_payload: PowerPayload,
) -> None:
    indices = [*TILE_A, OTHER_TILE]
    cells = [
        GridCell(*cell_centre(index), weight=w)
        for index, w in zip(indices, [0.4, 0.3, 0.2, 0.1], strict=True)
    ]

    async def fake_state_cells(*_args: object) -> list[GridCell]:
        return cells

    monkeypatch.setattr(compare_module, "state_cells", fake_state_cells)
    regional = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(
        side_effect=_monthly_regional
    )

    def point_handler(request: httpx.Request) -> httpx.Response:
        p = request.url.params
        lat, lon = float(p["latitude"]), float(p["longitude"])
        raw = power_payload(
            int(p["start"]),
            int(p["end"]),
            latitude=lat,
            longitude=lon,
            value=lambda year, month: _value(lat, lon, year, month),
        )
        return httpx.Response(200, content=raw)

    point = router.get(host=POWER_HOST, path="/api/temporal/monthly/point").mock(
        side_effect=point_handler
    )
    location = next(loc for loc in LOCATIONS if loc.id == "us-tx")
    request = CompareRequest.model_validate(
        {
            "variable_id": TEMPERATURE.id,
            "locations": [
                {"id": location.id, "latitude": location.latitude, "longitude": location.longitude}
            ],
            "start_year": 1990,
            "end_year": 2020,
        }
    )
    new = await CompareService(
        _power(client, tmp_path / "new"), boundaries=_NoBoundaries()
    ).compare(request, [location], TEMPERATURE, "r-new", "live")
    old = await CompareService(
        _PointOnly(_power(client, tmp_path / "old")), boundaries=_NoBoundaries()
    ).compare(request, [location], TEMPERATURE, "r-old", "live")

    assert regional.call_count == 2  # zwei Kacheln statt vier Zellen
    assert point.call_count == 4
    a, b = new.series[0], old.series[0]
    assert a.observations_monthly == b.observations_monthly
    assert a.observations_annual == b.observations_annual
    assert a.anomalies_annual == b.anomalies_annual
    assert a.trend is not None and a.trend == b.trend
    assert a.provenance.spatial_method == b.provenance.spatial_method == "area_weighted_grid"
    assert a.provenance.cell_count == 4


class _Boundary:
    def model_dump(self, mode: str) -> dict[str, Any]:
        ring = [[16.2, 48.1], [16.5, 48.1], [16.5, 48.3], [16.2, 48.3], [16.2, 48.1]]
        return {"type": "Polygon", "coordinates": [ring]}


class _CountingBoundaries:
    def __init__(self) -> None:
        self.calls = 0

    async def get_region(self, country_iso3: str, adm1_id: str) -> RegionResponse:
        self.calls += 1
        return cast(RegionResponse, type("Region", (), {"boundary": _Boundary()})())


async def test_state_cells_are_cached_per_process(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(compare_module, "STATE_CELL_CACHE", {})
    computed: list[int] = []
    from trend_detective.domain.power_grid import grid_cells as real

    def counting(polygons: Any) -> list[GridCell]:
        computed.append(1)
        return real(polygons)

    monkeypatch.setattr(compare_module, "grid_cells", counting)
    boundaries = _CountingBoundaries()
    first = await compare_module.state_cells(boundaries, "at-wien", "AUT", "AT-9")
    second = await compare_module.state_cells(boundaries, "at-wien", "AUT", "AT-9")
    assert first == second
    assert [(c.latitude, c.longitude) for c in first] == [(48.0, 16.25), (48.5, 16.25)]
    assert (len(computed), boundaries.calls) == (1, 1)


async def test_region_parses_each_tile_once_for_all_states(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from trend_detective.providers import power as power_module

    async def fake_state_cells(*_args: object) -> list[GridCell]:
        return [GridCell(*cell_centre(TILE_A[0]), 0.5), GridCell(*cell_centre(OTHER_TILE), 0.5)]

    monkeypatch.setattr(compare_module, "state_cells", fake_state_cells)
    parsed: list[int] = []
    from trend_detective.providers.normalize_power import _parse as real_parse

    def counting_parse(raw: bytes) -> dict[str, Any]:
        parsed.append(1)
        return real_parse(raw)

    monkeypatch.setattr(power_module, "_parse", counting_parse)
    route = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(side_effect=_monthly_regional)
    location = next(loc for loc in LOCATIONS if loc.id == "at")
    request = CompareRequest.model_validate(
        {
            "variable_id": TEMPERATURE.id,
            "locations": [
                {"id": location.id, "latitude": location.latitude, "longitude": location.longitude}
            ],
            "start_year": 2000,
            "end_year": 2020,
        }
    )
    result = await CompareService(_power(client, tmp_path), boundaries=_NoBoundaries()).compare(
        request, [location], TEMPERATURE, "r", "live"
    )
    assert result.series[0].provenance.spatial_method == "area_weighted_states"
    assert route.call_count == 2  # neun Bundesländer, zwei gemeinsame Kacheln
    assert len(parsed) == 2


async def test_at_most_eight_power_requests_in_parallel_tiles_and_points_together(
    router: respx.MockRouter, client: httpx.AsyncClient, tmp_path: Path, power_payload: Any
) -> None:
    import asyncio

    running = {"tiles": 0, "points": 0}
    peak = {"tiles": 0, "points": 0, "total": 0}

    async def slow(kind: str, response: httpx.Response) -> httpx.Response:
        running[kind] += 1
        peak[kind] = max(peak[kind], running[kind])
        peak["total"] = max(peak["total"], running["tiles"] + running["points"])
        await asyncio.sleep(0.01)
        running[kind] -= 1
        return response

    async def tile(request: httpx.Request) -> httpx.Response:
        return await slow("tiles", _monthly_regional(request))

    async def point(request: httpx.Request) -> httpx.Response:
        return await slow("points", httpx.Response(200, content=power_payload(2000, 2000)))

    tiles = router.get(host=POWER_HOST, path=MONTHLY_REGIONAL).mock(side_effect=tile)
    points = router.get(host=POWER_HOST, path="/api/temporal/monthly/point").mock(side_effect=point)
    provider = _power(client, tmp_path)
    cells = _cells([(242, 7 * k) for k in range(10, 24)])  # 14 verschiedene Kacheln
    point_work = [
        provider.fetch_monthly(
            Location(id=f"p{k}", label="p", latitude=10.0 + k, longitude=10.0),
            TEMPERATURE,
            2000,
            2000,
        )
        for k in range(10)
    ]
    await asyncio.gather(provider.fetch_cells_monthly(cells, TEMPERATURE, 2000, 2000), *point_work)
    assert (tiles.call_count, points.call_count) == (14, 10)
    assert peak["total"] == MAX_PARALLEL_REQUESTS == 8
    assert peak["tiles"] >= 1 and peak["points"] >= 1  # gemischt, eine gemeinsame Grenze
