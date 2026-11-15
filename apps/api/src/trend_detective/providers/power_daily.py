"""PowerDailyProvider: NASA POWER daily/point für die Extremwerte (B-EXTREMES).

Ein Request mit allen sechs Parametern (community=AG, units=metric, time-standard=LST).
Abruf über PowerProvider.download (gleicher Client, Retry, Begrenzung, Gesamtzeit 15 s).
Fill-Werte (header.fill_value, sonst -999) werden None, nie 0. Tatsächliches Datenende aus
header.end; Tage danach fehlen einfach. Rohantwort erst nach erfolgreicher Normalisierung
in den Dateicache.
"""

import datetime as dt
import hashlib
import logging
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Final

import httpx
from pydantic import JsonValue

from trend_detective.api.errors import ApiError, provider_schema_error
from trend_detective.providers.normalize_power import (
    _finite_number,
    _header,
    _object,
    _parse,
    _returned_coordinates,
)
from trend_detective.providers.power import (
    POWER_COMMUNITY,
    POWER_CONTENT_TYPE,
    POWER_HOST,
    POWER_PROVIDER,
    PowerProvider,
)
from trend_detective.schemas.responses import CacheStatus, Coordinates, Provenance
from trend_detective.storage.file_cache import FileCache, cache_key

logger = logging.getLogger(__name__)

DAILY_ENDPOINT: Final = "/api/temporal/daily/point"
DAILY_BASE_URL: Final = f"https://{POWER_HOST}{DAILY_ENDPOINT}"
DAILY_DATASET_FALLBACK: Final = "NASA/POWER Daily"
DAILY_UNITS: Final = "metric"
DAILY_TIME_STANDARD: Final = "LST"
DAILY_SCHEMA_VERSION: Final = "power-daily-v1"

T2M_MAX: Final = "T2M_MAX"
T2M_MIN: Final = "T2M_MIN"
PRECTOTCORR: Final = "PRECTOTCORR"
WS10M: Final = "WS10M"
WS10M_MAX: Final = "WS10M_MAX"
ALLSKY_SFC_SW_DWN: Final = "ALLSKY_SFC_SW_DWN"
# Parameter -> erwartete POWER-Einheit (units=metric). Abweichung -> PROVIDER_SCHEMA_ERROR.
DAILY_PARAMETERS: Final[Mapping[str, str]] = {
    T2M_MAX: "C",
    T2M_MIN: "C",
    PRECTOTCORR: "mm/day",
    WS10M: "m/s",
    WS10M_MAX: "m/s",
    ALLSKY_SFC_SW_DWN: "MJ/m^2/day",
}
_DAY_KEY = re.compile(r"^(\d{4})(\d{2})(\d{2})$")

DailyValues = Mapping[dt.date, float | None]


@dataclass(frozen=True)
class DailySeries:
    """Tageswerte je POWER-Parameter; None = Fill oder null. Nicht gelieferte Tage fehlen."""

    values: Mapping[str, DailyValues]
    units: Mapping[str, str]
    data_end: dt.date | None
    provenance: Provenance
    cache_status: CacheStatus = "miss"


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def build_daily_url(latitude: float, longitude: float, start_year: int, end_year: int) -> str:
    params = [
        ("parameters", ",".join(DAILY_PARAMETERS)),
        ("community", POWER_COMMUNITY),
        ("longitude", repr(longitude)),
        ("latitude", repr(latitude)),
        ("start", f"{start_year}0101"),
        ("end", f"{end_year}1231"),
        ("format", "JSON"),
        ("units", DAILY_UNITS),
        ("time-standard", DAILY_TIME_STANDARD),
    ]
    return str(httpx.URL(DAILY_BASE_URL, params=params))


def daily_cache_fields(
    latitude: float, longitude: float, start_year: int, end_year: int
) -> dict[str, JsonValue]:
    return {
        "provider": POWER_PROVIDER,
        "endpoint": DAILY_ENDPOINT,
        "parameters": ",".join(DAILY_PARAMETERS),
        "community": POWER_COMMUNITY,
        "units": DAILY_UNITS,
        "time_standard": DAILY_TIME_STANDARD,
        "latitude": latitude,
        "longitude": longitude,
        "start_year": start_year,
        "end_year": end_year,
        "normalization_schema_version": DAILY_SCHEMA_VERSION,
    }


def _day(key: str) -> dt.date:
    match = _DAY_KEY.fullmatch(key)
    if match is None:
        raise provider_schema_error(f"Unexpected day key in provider response: {key}")
    try:
        return dt.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError as exc:
        raise provider_schema_error(f"Invalid day in provider response: {key}") from exc


@dataclass(frozen=True)
class NormalizedDaily:
    values: dict[str, dict[dt.date, float | None]]
    units: dict[str, str]
    data_end: dt.date | None
    returned_coordinates: Coordinates | None
    provider_version: str | None
    dataset: str | None


def normalize_power_daily(raw: bytes, *, start_year: int, end_year: int) -> NormalizedDaily:
    doc = _parse(raw)
    fill_value, provider_version, dataset = _header(doc)
    header = doc.get("header")
    end = header.get("end") if isinstance(header, dict) else None
    data_end = _day(end) if isinstance(end, str) else None
    meta = _object(doc.get("parameters"), "parameters")
    parameter_values = _object(
        _object(doc.get("properties"), "properties").get("parameter"), "properties.parameter"
    )
    values: dict[str, dict[dt.date, float | None]] = {}
    units: dict[str, str] = {}
    for parameter, expected_unit in DAILY_PARAMETERS.items():
        unit = _object(meta.get(parameter), f"parameters.{parameter}").get("units")
        if unit != expected_unit:
            raise provider_schema_error(f"Unexpected provider unit for {parameter}: {unit}")
        units[parameter] = unit
        raw_values: dict[str, Any] = _object(
            parameter_values.get(parameter), f"properties.parameter.{parameter}"
        )
        by_day: dict[dt.date, float | None] = {}
        for key, value in raw_values.items():
            day = _day(key)
            if not start_year <= day.year <= end_year:
                raise provider_schema_error(f"Provider returned a day outside the request: {key}")
            if value is None:
                by_day[day] = None
                continue
            number = _finite_number(value, key)
            by_day[day] = None if number == fill_value else number
        values[parameter] = by_day
    return NormalizedDaily(
        values=values,
        units=units,
        data_end=data_end,
        returned_coordinates=_returned_coordinates(doc),
        provider_version=provider_version,
        dataset=dataset,
    )


class PowerDailyProvider:
    def __init__(
        self,
        power: PowerProvider,
        cache: FileCache,
        *,
        clock: Callable[[], dt.datetime] = _utc_now,
    ) -> None:
        self._power = power
        self._cache = cache
        self._clock = clock

    async def fetch_daily(
        self, latitude: float, longitude: float, start_year: int, end_year: int
    ) -> DailySeries:
        url = build_daily_url(latitude, longitude, start_year, end_year)
        fields = daily_cache_fields(latitude, longitude, start_year, end_year)
        key = cache_key(fields)
        entry = self._cache.read(key, fields)
        if entry is not None and entry.is_fresh(self._clock()):
            try:
                return self._series(
                    entry.raw,
                    latitude,
                    longitude,
                    start_year,
                    end_year,
                    url,
                    retrieved_at=entry.fetched_at,
                    cache_status="fresh",
                )
            except ApiError as error:
                logger.warning(
                    "cached POWER daily response no longer valid, refetching: %s",
                    error.log_detail,
                )
        raw = await self._power.download(url)
        retrieved_at = self._clock()
        series = self._series(
            raw,
            latitude,
            longitude,
            start_year,
            end_year,
            url,
            retrieved_at=retrieved_at,
            cache_status="miss",
        )
        try:
            self._cache.write(
                key,
                fields,
                raw,
                source_url=url,
                content_type=POWER_CONTENT_TYPE,
                fetched_at=retrieved_at,
            )
        except OSError:
            logger.warning("could not write POWER daily cache entry", exc_info=True)
        return series

    def _series(
        self,
        raw: bytes,
        latitude: float,
        longitude: float,
        start_year: int,
        end_year: int,
        url: str,
        *,
        retrieved_at: dt.datetime,
        cache_status: CacheStatus,
    ) -> DailySeries:
        normalized = normalize_power_daily(raw, start_year=start_year, end_year=end_year)
        return DailySeries(
            values=normalized.values,
            units=normalized.units,
            data_end=normalized.data_end,
            provenance=Provenance(
                provider=POWER_PROVIDER,
                dataset=normalized.dataset or DAILY_DATASET_FALLBACK,
                parameter=",".join(DAILY_PARAMETERS),
                community=POWER_COMMUNITY,
                requested_coordinates=Coordinates(latitude=latitude, longitude=longitude),
                returned_coordinates=normalized.returned_coordinates,
                retrieved_at=retrieved_at,
                source_url=url,
                raw_sha256=hashlib.sha256(raw).hexdigest(),
                provider_version=normalized.provider_version,
            ),
            cache_status=cache_status,
        )
