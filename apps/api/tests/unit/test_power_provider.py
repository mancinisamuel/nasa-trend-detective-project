"""E1: PowerProvider mit respx (Brief §06, §12 Provider/Cache). Kein echtes Netz."""

import asyncio
import datetime as dt
import hashlib
import socket
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path

import httpx
import pytest
import respx

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.providers.power import (
    MAX_PARALLEL_REQUESTS,
    POWER_HOST,
    PowerProvider,
    build_source_url,
    parse_retry_after,
)
from trend_detective.schemas.catalog import LOCATIONS, VARIABLES, Variable
from trend_detective.storage.file_cache import FileCache

PowerPayload = Callable[..., bytes]
NOW = dt.datetime(2026, 11, 14, 12, 0, tzinfo=dt.UTC)
VIENNA, MADRID = LOCATIONS[:2]
TEMPERATURE = VARIABLES[0]
VIENNA_URL = (
    "https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M&community=AG"
    "&longitude=16.37&latitude=48.21&start=2000&end=2001&format=JSON"
)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    def _blocked(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("real network access in unit tests")

    monkeypatch.setattr(socket.socket, "connect", _blocked)
    monkeypatch.setattr(socket, "create_connection", _blocked)
    yield


class Clock:
    def __init__(self) -> None:
        self.now = NOW

    def __call__(self) -> dt.datetime:
        return self.now


class Sleeper:
    def __init__(self) -> None:
        self.delays: list[float] = []

    async def __call__(self, delay: float) -> None:
        self.delays.append(delay)


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def sleeper() -> Sleeper:
    return Sleeper()


@pytest.fixture
async def client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(follow_redirects=False) as c:
        yield c


@pytest.fixture
def router() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as mock:
        yield mock


def _provider(
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    *,
    ttl: int = 86400,
    timeout: float = 15,
) -> PowerProvider:
    return PowerProvider(
        client,
        FileCache(tmp_path / "power", ttl),
        total_timeout_seconds=timeout,
        clock=clock,
        sleep=sleeper,
        jitter=lambda: 0.25,
    )


def _route(router: respx.MockRouter) -> respx.Route:
    return router.get(host=POWER_HOST, path="/api/temporal/monthly/point")


async def _fetch(provider: PowerProvider, start: int = 2000, end: int = 2001) -> object:
    return await provider.fetch_monthly(VIENNA, TEMPERATURE, start, end)


def test_source_url_uses_fixed_host_and_exact_parameters() -> None:
    assert build_source_url("T2M", 48.21, 16.37, 2000, 2001) == VIENNA_URL
    madrid = build_source_url("T2M", 40.42, -3.7, 1981, 2025)
    assert "longitude=-3.7&latitude=40.42" in madrid
    assert madrid.startswith("https://power.larc.nasa.gov/api/temporal/monthly/point?")


async def test_success_normalizes_and_records_provenance(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    raw = power_payload(2000, 2001, latitude=48.2, longitude=16.4)
    route = _route(router).mock(return_value=httpx.Response(200, content=raw))
    series = await _provider(client, tmp_path, clock, sleeper).fetch_monthly(
        VIENNA, TEMPERATURE, 2000, 2001
    )
    assert route.call_count == 1
    assert str(route.calls.last.request.url) == VIENNA_URL
    assert len(series.observations) == 24
    assert series.cache_status == "miss"
    p = series.provenance
    assert (p.provider, p.parameter, p.community) == ("nasa_power", "T2M", "AG")
    assert p.source_url == VIENNA_URL
    assert p.raw_sha256 == hashlib.sha256(raw).hexdigest()
    assert p.retrieved_at == NOW
    assert p.provider_version == "v2.10.0"
    assert (p.requested_coordinates.latitude, p.requested_coordinates.longitude) == (48.21, 16.37)
    assert p.returned_coordinates is not None
    assert (p.returned_coordinates.latitude, p.returned_coordinates.longitude) == (48.2, 16.4)
    assert sleeper.delays == []


async def test_cache_hit_avoids_second_request_and_keeps_provenance(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    raw = power_payload(2000, 2001)
    route = _route(router).mock(return_value=httpx.Response(200, content=raw))
    provider = _provider(client, tmp_path, clock, sleeper)
    first = await provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001)
    clock.now = NOW + dt.timedelta(hours=1)
    second = await provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001)
    assert route.call_count == 1
    assert (first.cache_status, second.cache_status) == ("miss", "fresh")
    assert second.observations == first.observations
    assert second.provenance == first.provenance  # retrieved_at = ursprünglicher Abruf
    files = sorted(p.name for p in (tmp_path / "power").rglob("*.json"))
    assert files == ["metadata.json", "response.json"]


async def test_ttl_expiry_refetches(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(200, content=power_payload(2000, 2001)))
    provider = _provider(client, tmp_path, clock, sleeper, ttl=3600)
    await _fetch(provider)
    clock.now = NOW + dt.timedelta(seconds=3600)
    refreshed = await provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001)
    assert route.call_count == 2
    assert refreshed.cache_status == "miss"
    assert refreshed.provenance.retrieved_at == clock.now


async def test_corrupt_cache_is_refetched(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(200, content=power_payload(2000, 2001)))
    provider = _provider(client, tmp_path, clock, sleeper)
    await _fetch(provider)
    for path in (tmp_path / "power").rglob("response.json"):
        path.write_bytes(b"garbage")
    again = await provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001)
    assert route.call_count == 2
    assert again.cache_status == "miss"


async def test_separate_cache_keys_per_coordinates(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(200, content=power_payload(2000, 2001)))
    provider = _provider(client, tmp_path, clock, sleeper)
    await provider.fetch_monthly(VIENNA, TEMPERATURE, 2000, 2001)
    await provider.fetch_monthly(MADRID, TEMPERATURE, 2000, 2001)
    assert route.call_count == 2
    assert len(list((tmp_path / "power").iterdir())) == 2


async def test_schema_error_is_not_cached(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    _route(router).mock(
        return_value=httpx.Response(200, content=power_payload(2000, 2001, unit="K"))
    )
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert (info.value.status_code, info.value.code) == (502, ErrorCode.PROVIDER_SCHEMA_ERROR)
    assert not (tmp_path / "power").exists() or not any((tmp_path / "power").rglob("*.json"))


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
async def test_retry_on_temporary_status_then_success(
    status: int,
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    route = _route(router).mock(
        side_effect=[
            httpx.Response(status),
            httpx.Response(status),
            httpx.Response(200, content=power_payload(2000, 2001)),
        ]
    )
    series = await _provider(client, tmp_path, clock, sleeper).fetch_monthly(
        VIENNA, TEMPERATURE, 2000, 2001
    )
    assert route.call_count == 3
    assert len(series.observations) == 24
    assert sleeper.delays == [0.75, 1.25]  # 0.5*2^n + Jitter 0.25


async def test_retry_after_seconds_is_respected(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
    power_payload: PowerPayload,
) -> None:
    _route(router).mock(
        side_effect=[
            httpx.Response(429, headers={"Retry-After": "7"}),
            httpx.Response(200, content=power_payload(2000, 2001)),
        ]
    )
    await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert sleeper.delays == [7.0]


async def test_retry_after_longer_than_budget_fails_fast(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(429, headers={"Retry-After": "120"}))
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper, timeout=15))
    assert (info.value.status_code, info.value.code) == (503, ErrorCode.PROVIDER_UNAVAILABLE)
    assert info.value.retryable is True
    assert route.call_count == 1
    assert sleeper.delays == []


async def test_persistent_5xx_gives_503_after_two_retries(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(503))
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert (info.value.status_code, info.value.code) == (503, ErrorCode.PROVIDER_UNAVAILABLE)
    assert info.value.details == {"provider_status": 503}
    assert route.call_count == 3


@pytest.mark.parametrize("status", [400, 401, 404, 422, 501, 301])
async def test_no_retry_on_other_status(
    status: int,
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router).mock(return_value=httpx.Response(status))
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert (info.value.status_code, info.value.code) == (502, ErrorCode.PROVIDER_UNAVAILABLE)
    assert info.value.retryable is False
    assert route.call_count == 1
    assert sleeper.delays == []


async def test_connect_error_retried_then_503(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router).mock(side_effect=httpx.ConnectError("refused"))
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert (info.value.status_code, info.value.code) == (503, ErrorCode.PROVIDER_UNAVAILABLE)
    assert route.call_count == 3


async def test_request_timeout_retried_then_504(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(ApiError) as info:
        await _fetch(_provider(client, tmp_path, clock, sleeper))
    assert (info.value.status_code, info.value.code) == (504, ErrorCode.PROVIDER_TIMEOUT)
    assert route.call_count == 3


async def test_total_timeout_gives_504(tmp_path: Path, clock: Clock, sleeper: Sleeper) -> None:
    async def _slow(_request: httpx.Request) -> httpx.Response:
        await asyncio.sleep(5)
        return httpx.Response(200)

    async with httpx.AsyncClient(transport=httpx.MockTransport(_slow)) as slow_client:
        provider = _provider(slow_client, tmp_path, clock, sleeper, timeout=0.05)
        with pytest.raises(ApiError) as info:
            await _fetch(provider)
    assert (info.value.status_code, info.value.code) == (504, ErrorCode.PROVIDER_TIMEOUT)


async def test_at_most_eight_requests_in_parallel(
    tmp_path: Path, clock: Clock, sleeper: Sleeper, power_payload: PowerPayload
) -> None:
    active = 0
    peak = 0

    async def _handler(request: httpx.Request) -> httpx.Response:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.02)
        active -= 1
        start = int(request.url.params["start"])
        return httpx.Response(200, content=power_payload(start, start))

    async with httpx.AsyncClient(transport=httpx.MockTransport(_handler)) as mock_client:
        provider = _provider(mock_client, tmp_path, clock, sleeper)
        await asyncio.gather(
            *(provider.fetch_monthly(VIENNA, TEMPERATURE, y, y) for y in range(2000, 2012))
        )
    assert peak == MAX_PARALLEL_REQUESTS == 8


async def test_same_key_concurrently_fetched_once(
    tmp_path: Path, clock: Clock, sleeper: Sleeper, power_payload: PowerPayload
) -> None:
    calls = 0

    async def _handler(_request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return httpx.Response(200, content=power_payload(2000, 2001))

    async with httpx.AsyncClient(transport=httpx.MockTransport(_handler)) as mock_client:
        provider = _provider(mock_client, tmp_path, clock, sleeper)
        results = await asyncio.gather(*(_fetch(provider) for _ in range(3)))
    assert calls == 1
    assert len(results) == 3


async def test_disabled_or_foreign_variable_is_rejected_without_request(
    router: respx.MockRouter,
    client: httpx.AsyncClient,
    tmp_path: Path,
    clock: Clock,
    sleeper: Sleeper,
) -> None:
    route = _route(router)
    provider = _provider(client, tmp_path, clock, sleeper)
    forged = Variable.model_validate(
        {**TEMPERATURE.model_dump(), "provider_parameter": "T2M&community=RE"}
    )
    with pytest.raises(ApiError) as unknown:
        await provider.fetch_monthly(VIENNA, forged, 2000, 2001)
    assert unknown.value.code == ErrorCode.UNKNOWN_VARIABLE
    with pytest.raises(ApiError) as years:
        await provider.fetch_monthly(VIENNA, TEMPERATURE, 1980, 2001)
    assert years.value.code == ErrorCode.VALIDATION_ERROR
    assert route.call_count == 0


def test_parse_retry_after() -> None:
    assert parse_retry_after(None, NOW) is None
    assert parse_retry_after("3", NOW) == 3.0
    assert parse_retry_after("soon", NOW) is None
    assert parse_retry_after("Sat, 14 Nov 2026 12:00:30 GMT", NOW) == 30.0
    assert parse_retry_after("Sat, 14 Nov 2026 11:00:00 GMT", NOW) == 0.0
