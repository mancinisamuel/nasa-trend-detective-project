"""PowerProvider: NASA POWER monthly/point mit Retry, Begrenzung und Dateicache (Brief §06, §10).

- URL nur aus festem HTTPS-Host und validierten Katalogparametern, keine Nutzer-URL.
- Ein geteilter httpx.AsyncClient (Lebenszyklus im FastAPI-lifespan), max. 8 Abfragen
  parallel, gemeinsam für Kacheln, Punkte und daily/point (B-PAR8).
- Retry nur bei temporären Netzwerkfehlern, 429 und 500/502/503/504: max. 2 Wiederholungen,
  Backoff mit Jitter, Retry-After hat Vorrang. Gesamtdauer pro Abruf begrenzt.
- Fehler sind sichtbar (502/503/504 im Fehlerformat), nie stiller Wechsel zu Demo-Daten.
- Antworten werden erst nach erfolgreicher Normalisierung gecacht.
- Flächenmittel (B-REGIONAL): Zellen über monthly/regional-Kacheln (power_regional), Cache pro
  Kachel, Parameter und Zeitraum. Dort 429 ohne Retry sofort als Fehler (Rate-Limit-Schutz).
"""

import asyncio
import datetime as dt
import email.utils
import hashlib
import logging
import random
import time
from collections import defaultdict
from collections.abc import Awaitable, Callable, Sequence
from typing import Final

import httpx
from pydantic import JsonValue

from trend_detective.api.errors import (
    UPSTREAM_DATA_UNAVAILABLE,
    ApiError,
    ErrorCode,
    provider_schema_error,
    provider_timeout,
    provider_unavailable,
)
from trend_detective.domain.power_grid import GridCell
from trend_detective.providers.base import MonthlySeries
from trend_detective.providers.normalize_power import (
    NORMALIZATION_SCHEMA_VERSION,
    PowerMonthly,
    _parse,
    normalize_power,
    normalize_power_doc,
)
from trend_detective.providers.power_regional import (
    Box,
    Index,
    Tile,
    box_fields,
    cell_centre,
    collect_tiles,
    pick_cells,
    require_index,
)
from trend_detective.schemas.catalog import VARIABLES, Location, Variable, provider_unit
from trend_detective.schemas.requests import MIN_YEAR
from trend_detective.schemas.responses import CacheStatus, Coordinates, Provenance
from trend_detective.storage.file_cache import FileCache, cache_key

logger = logging.getLogger(__name__)

POWER_HOST: Final = "power.larc.nasa.gov"
POWER_ENDPOINT: Final = "/api/temporal/monthly/point"
POWER_BASE_URL: Final = f"https://{POWER_HOST}{POWER_ENDPOINT}"
REGIONAL_ENDPOINT: Final = "/api/temporal/monthly/regional"
REGIONAL_BASE_URL: Final = f"https://{POWER_HOST}{REGIONAL_ENDPOINT}"
POWER_PROVIDER: Final = "nasa_power"
POWER_DATASET_FALLBACK: Final = "NASA/POWER Monthly and Annual"
POWER_COMMUNITY: Final = "AG"
POWER_CONTENT_TYPE: Final = "application/json"
# Nur Parameter aktivierter Katalogvariablen dürfen in die URL.
ALLOWED_PARAMETERS: Final = frozenset(v.provider_parameter for v in VARIABLES if v.enabled)
RETRY_STATUS: Final = frozenset({429, 500, 502, 503, 504})
MAX_RETRIES: Final = 2
MAX_PARALLEL_REQUESTS: Final = 8
BACKOFF_BASE_SECONDS: Final = 0.5
MAX_JITTER_SECONDS: Final = 0.5
MAX_RESPONSE_BYTES: Final = 5_000_000
# Regionale Kacheln (bis 8 x 7 Zellen, daily bis 50 Jahre) sind deutlich größer.
REGIONAL_MAX_RESPONSE_BYTES: Final = 64_000_000
RATE_LIMIT_STATUS: Final = 429
# Nach einem 429 (regional) startet bis Retry-After, sonst so lange, kein POWER-Abruf mehr.
RATE_LIMIT_COOLDOWN_SECONDS: Final = 60.0

Sleep = Callable[[float], Awaitable[None]]


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def _jitter() -> float:
    return random.uniform(0, MAX_JITTER_SECONDS)


def build_source_url(
    parameter: str, latitude: float, longitude: float, start_year: int, end_year: int
) -> str:
    """Vollständige öffentliche Abfrage-URL; Koordinaten exakt (repr), ohne Runden."""
    params = [
        ("parameters", parameter),
        ("community", POWER_COMMUNITY),
        ("longitude", repr(longitude)),
        ("latitude", repr(latitude)),
        ("start", str(start_year)),
        ("end", str(end_year)),
        ("format", "JSON"),
    ]
    return str(httpx.URL(POWER_BASE_URL, params=params))


def power_cache_fields(
    parameter: str, latitude: float, longitude: float, start_year: int, end_year: int
) -> dict[str, JsonValue]:
    """Kanonische Schlüsselfelder nach Brief §10."""
    return {
        "provider": POWER_PROVIDER,
        "endpoint": POWER_ENDPOINT,
        "parameter": parameter,
        "community": POWER_COMMUNITY,
        "latitude": latitude,
        "longitude": longitude,
        "start_year": start_year,
        "end_year": end_year,
        "normalization_schema_version": NORMALIZATION_SCHEMA_VERSION,
    }


def regional_params(parameter: str, box: Box) -> list[tuple[str, str]]:
    """Gemeinsamer Teil der monthly/daily-regional-URL; Grenzen exakt (repr)."""
    return [
        ("parameters", parameter),
        ("community", POWER_COMMUNITY),
        ("latitude-min", repr(box.latitude_min)),
        ("latitude-max", repr(box.latitude_max)),
        ("longitude-min", repr(box.longitude_min)),
        ("longitude-max", repr(box.longitude_max)),
    ]


def build_regional_url(parameter: str, box: Box, start_year: int, end_year: int) -> str:
    params = [
        *regional_params(parameter, box),
        ("start", str(start_year)),
        ("end", str(end_year)),
        ("format", "JSON"),
    ]
    return str(httpx.URL(REGIONAL_BASE_URL, params=params))


def regional_cache_fields(
    parameter: str, box: Box, start_year: int, end_year: int
) -> dict[str, JsonValue]:
    return {
        "provider": POWER_PROVIDER,
        "endpoint": REGIONAL_ENDPOINT,
        "parameter": parameter,
        "community": POWER_COMMUNITY,
        **box_fields(box),
        "start_year": start_year,
        "end_year": end_year,
        "normalization_schema_version": NORMALIZATION_SCHEMA_VERSION,
    }


def _rate_limited(retry_after: float | None) -> ApiError:
    """429 bei regionalen Kacheln: sofort abbrechen, kein Retry (B-REGIONAL)."""
    details: dict[str, JsonValue] = {"provider_status": RATE_LIMIT_STATUS}
    if retry_after is not None:
        details["retry_after_s"] = retry_after
    return ApiError(
        503,
        ErrorCode.PROVIDER_UNAVAILABLE,
        "NASA POWER rate limit reached (HTTP 429); not retrying, try again later",
        retryable=True,
        details=details,
    )


def parse_retry_after(value: str | None, now: dt.datetime) -> float | None:
    """Retry-After als Sekunden oder HTTP-Datum; ungültig -> None, Vergangenheit -> 0."""
    if value is None:
        return None
    value = value.strip()
    if value.isdigit():
        return float(value)
    try:
        when = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError):
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=dt.UTC)
    return max(0.0, (when - now).total_seconds())


def _validated_parameter(variable: Variable) -> str:
    known = next((v for v in VARIABLES if v.id == variable.id), None)
    if known is None or known != variable:
        raise ApiError(
            422,
            ErrorCode.UNKNOWN_VARIABLE,
            f"Unknown variable: {variable.id}",
            details={"variable_id": variable.id},
        )
    if not known.enabled or known.provider_parameter not in ALLOWED_PARAMETERS:
        raise ApiError(
            422,
            ErrorCode.VARIABLE_DISABLED,
            f"Variable is disabled: {variable.id}",
            details={"variable_id": variable.id},
        )
    return known.provider_parameter


def _validate_years(start_year: int, end_year: int) -> None:
    if not MIN_YEAR <= start_year <= end_year:
        raise ApiError(
            422,
            ErrorCode.VALIDATION_ERROR,
            f"Invalid POWER year range {start_year}-{end_year}",
            details={"start_year": start_year, "end_year": end_year},
        )


class PowerProvider:
    def __init__(
        self,
        client: httpx.AsyncClient,
        cache: FileCache,
        *,
        total_timeout_seconds: float,
        max_concurrency: int = MAX_PARALLEL_REQUESTS,
        clock: Callable[[], dt.datetime] = _utc_now,
        sleep: Sleep = asyncio.sleep,
        jitter: Callable[[], float] = _jitter,
    ) -> None:
        self._client = client
        self._cache = cache
        self._total_timeout = total_timeout_seconds
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._clock = clock
        self._sleep = sleep
        self._jitter = jitter
        self._key_locks: defaultdict[str, asyncio.Lock] = defaultdict(asyncio.Lock)
        self._blocked_until: dt.datetime | None = None

    async def fetch_monthly(
        self, location: Location, variable: Variable, start_year: int, end_year: int
    ) -> MonthlySeries:
        parameter = _validated_parameter(variable)
        _validate_years(start_year, end_year)
        lat, lon = location.latitude, location.longitude
        url = build_source_url(parameter, lat, lon, start_year, end_year)
        fields = power_cache_fields(parameter, lat, lon, start_year, end_year)

        def parse(raw: bytes, retrieved_at: dt.datetime, status: CacheStatus) -> MonthlySeries:
            return self._series(
                raw,
                location,
                variable,
                start_year,
                end_year,
                url,
                retrieved_at=retrieved_at,
                cache_status=status,
            )

        return await self.cached(self._cache, fields, url, parse)

    async def fetch_cells_monthly(
        self, cells: Sequence[GridCell], variable: Variable, start_year: int, end_year: int
    ) -> list[MonthlySeries]:
        """Monatswerte vieler Rasterzellen über monthly/regional-Kacheln (B-REGIONAL).

        Reihenfolge wie cells; je Zelle dieselben Werte wie fetch_monthly am Zellzentrum.
        Ein Abruf je Kachel, gecacht pro Kachel, Parameter und Zeitraum.
        """
        parameter = _validated_parameter(variable)
        _validate_years(start_year, end_year)
        indices = [require_index(cell.latitude, cell.longitude) for cell in cells]

        async def load(tile: Tile, wanted: list[Index]) -> dict[Index, MonthlySeries]:
            box = tile.box()
            url = build_regional_url(parameter, box, start_year, end_year)

            def parse(
                raw: bytes, retrieved_at: dt.datetime, status: CacheStatus
            ) -> dict[Index, MonthlySeries]:
                return self._regional_series(
                    raw,
                    wanted,
                    variable,
                    start_year,
                    end_year,
                    url,
                    retrieved_at=retrieved_at,
                    cache_status=status,
                )

            fields = regional_cache_fields(parameter, box, start_year, end_year)
            return await self.cached(self._cache, fields, url, parse, regional=True)

        by_cell = await collect_tiles(indices, load)
        return [by_cell[index] for index in indices]

    async def cached[T](
        self,
        cache: FileCache,
        fields: dict[str, JsonValue],
        url: str,
        parse: Callable[[bytes, dt.datetime, CacheStatus], T],
        *,
        regional: bool = False,
    ) -> T:
        """Frischer Cache-Eintrag oder Abruf; Rohantwort erst nach erfolgreichem parse cachen.

        Pro Schlüssel koordiniert: gleichzeitige Abrufe desselben Schlüssels laden nur einmal
        (bei Kacheln auch über Bundesländer/States hinweg).
        """
        key = cache_key(fields)
        async with self._key_locks[key]:
            entry = cache.read(key, fields)
            if entry is not None and entry.is_fresh(self._clock()):
                try:
                    return parse(entry.raw, entry.fetched_at, "fresh")
                except ApiError as error:
                    logger.warning(
                        "cached POWER response no longer valid, refetching: %s", error.log_detail
                    )

            raw = await self._download(url, regional=regional)
            retrieved_at = self._clock()
            result = parse(raw, retrieved_at, "miss")
            try:
                cache.write(
                    key,
                    fields,
                    raw,
                    source_url=url,
                    content_type=POWER_CONTENT_TYPE,
                    fetched_at=retrieved_at,
                )
            except OSError:
                logger.warning("could not write POWER cache entry", exc_info=True)
            return result

    def _regional_series(
        self,
        raw: bytes,
        wanted: Sequence[Index],
        variable: Variable,
        start_year: int,
        end_year: int,
        url: str,
        *,
        retrieved_at: dt.datetime,
        cache_status: CacheStatus,
    ) -> dict[Index, MonthlySeries]:
        doc = _parse(raw)
        raw_sha256 = hashlib.sha256(raw).hexdigest()
        result: dict[Index, MonthlySeries] = {}
        for index, feature in pick_cells(doc, wanted).items():
            # Zelle als Punkt-Dokument: gleiche Normalisierung wie monthly/point.
            cell_doc = {
                "header": doc.get("header"),
                "parameters": feature.get("parameters", doc.get("parameters")),
                "properties": feature.get("properties"),
                "geometry": feature.get("geometry"),
            }
            normalized = normalize_power_doc(
                cell_doc,
                parameter=variable.provider_parameter,
                expected_unit=provider_unit(variable),
                start_year=start_year,
                end_year=end_year,
            )
            latitude, longitude = cell_centre(index)
            result[index] = MonthlySeries(
                observations=normalized.observations,
                provenance=Provenance(
                    provider=POWER_PROVIDER,
                    dataset=normalized.dataset or POWER_DATASET_FALLBACK,
                    parameter=variable.provider_parameter,
                    community=POWER_COMMUNITY,
                    requested_coordinates=Coordinates(latitude=latitude, longitude=longitude),
                    returned_coordinates=normalized.returned_coordinates,
                    retrieved_at=retrieved_at,
                    source_url=url,
                    raw_sha256=raw_sha256,
                    provider_version=normalized.provider_version,
                ),
                cache_status=cache_status,
            )
        return result

    def _series(
        self,
        raw: bytes,
        location: Location,
        variable: Variable,
        start_year: int,
        end_year: int,
        url: str,
        *,
        retrieved_at: dt.datetime,
        cache_status: CacheStatus,
    ) -> MonthlySeries:
        normalized: PowerMonthly = normalize_power(
            raw,
            parameter=variable.provider_parameter,
            expected_unit=provider_unit(variable),
            start_year=start_year,
            end_year=end_year,
        )
        return MonthlySeries(
            observations=normalized.observations,
            provenance=Provenance(
                provider=POWER_PROVIDER,
                dataset=normalized.dataset or POWER_DATASET_FALLBACK,
                parameter=variable.provider_parameter,
                community=POWER_COMMUNITY,
                requested_coordinates=Coordinates(
                    latitude=location.latitude, longitude=location.longitude
                ),
                returned_coordinates=normalized.returned_coordinates,
                retrieved_at=retrieved_at,
                source_url=url,
                raw_sha256=hashlib.sha256(raw).hexdigest(),
                provider_version=normalized.provider_version,
            ),
            cache_status=cache_status,
        )

    async def download(self, url: str, *, regional: bool = False) -> bytes:
        """Roher Abruf mit derselben Begrenzung, Retry und Gesamtzeit wie fetch_monthly.

        Für andere POWER-Endpunkte (daily/point); URL baut der Aufrufer aus festen Werten.
        regional=True: größere Antworten erlaubt, 429 ohne Retry.
        """
        return await self._download(url, regional=regional)

    async def _download(self, url: str, *, regional: bool = False) -> bytes:
        # Erst den Slot holen, dann läuft die Gesamtzeit: Bei vielen Zellen (Texas rund 250)
        # würde sie sonst schon in der Warteschlange ablaufen. Den Slot über Retry und Backoff
        # halten, damit bei 429/503 nicht andere Abrufe nachdrängen.
        async with self._semaphore:
            # Nach einem 429 keine weiteren Abrufe starten, auch keine schon wartenden.
            now = self._clock()
            if self._blocked_until is not None and now < self._blocked_until:
                raise _rate_limited((self._blocked_until - now).total_seconds())
            started = time.monotonic()
            try:
                async with asyncio.timeout(self._total_timeout):
                    return await self._download_with_retries(url, regional=regional)
            except TimeoutError as exc:
                raise provider_timeout("NASA POWER did not respond in time") from exc
            finally:
                logger.info(
                    "POWER request finished", extra={"duration_s": time.monotonic() - started}
                )

    async def _download_with_retries(self, url: str, *, regional: bool) -> bytes:
        max_bytes = REGIONAL_MAX_RESPONSE_BYTES if regional else MAX_RESPONSE_BYTES
        for attempt in range(MAX_RETRIES + 1):
            last = attempt == MAX_RETRIES
            delay = BACKOFF_BASE_SECONDS * 2**attempt + self._jitter()
            try:
                response = await self._client.get(url)
            except httpx.TimeoutException as exc:
                if last:
                    raise provider_timeout("NASA POWER did not respond in time") from exc
            except (httpx.NetworkError, httpx.RemoteProtocolError) as exc:
                if last:
                    raise provider_unavailable("NASA POWER is not reachable") from exc
            except httpx.HTTPError as exc:
                raise provider_unavailable("NASA POWER request failed") from exc
            else:
                status = response.status_code
                logger.info("POWER response", extra={"status": status, "attempt": attempt})
                if status == 200:
                    if len(response.content) > max_bytes:
                        raise provider_schema_error("NASA POWER response is too large")
                    return response.content
                if regional and status == RATE_LIMIT_STATUS:
                    now = self._clock()
                    retry_after = parse_retry_after(response.headers.get("Retry-After"), now)
                    cooldown = RATE_LIMIT_COOLDOWN_SECONDS if retry_after is None else retry_after
                    self._blocked_until = now + dt.timedelta(seconds=cooldown)
                    raise _rate_limited(retry_after)
                if status not in RETRY_STATUS:
                    raise ApiError(
                        502,
                        ErrorCode.PROVIDER_UNAVAILABLE,
                        UPSTREAM_DATA_UNAVAILABLE,
                        details={"provider_status": status},
                        log_detail=f"NASA POWER rejected the request (HTTP {status})",
                    )
                if last:
                    raise ApiError(
                        503,
                        ErrorCode.PROVIDER_UNAVAILABLE,
                        f"NASA POWER is temporarily unavailable (HTTP {status})",
                        retryable=True,
                        details={"provider_status": status},
                    )
                retry_after = parse_retry_after(response.headers.get("Retry-After"), self._clock())
                if retry_after is not None:
                    if retry_after > self._total_timeout:
                        raise ApiError(
                            503,
                            ErrorCode.PROVIDER_UNAVAILABLE,
                            "NASA POWER asked to retry later",
                            retryable=True,
                            details={"provider_status": status, "retry_after_s": retry_after},
                        )
                    delay = retry_after
            await self._sleep(delay)
        raise AssertionError("unreachable")
