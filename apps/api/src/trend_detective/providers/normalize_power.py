"""Normalisierung der NASA-POWER-Monatsantwort (Brief §06).

Erwartete Struktur (geprüft gegen POWER API v2.10.0, monthly/point, T2M):
properties.parameter.<PARAM>.{YYYYMM: Zahl}, parameters.<PARAM>.units, header.fill_value,
geometry.coordinates = [lon, lat, höhe]. Monat 13 ist das Jahresmittel und wird ignoriert.
Fill-Werte werden None (nie 0). Unbekannte Einheiten oder Strukturänderungen ergeben
PROVIDER_SCHEMA_ERROR. Keine Beschneidung extremer Werte.
"""

import datetime as dt
import json
import math
import re
from dataclasses import dataclass
from typing import Any, NoReturn

from pydantic import ValidationError

from trend_detective.api.errors import provider_schema_error
from trend_detective.schemas.responses import Coordinates, MonthlyObservation

NORMALIZATION_SCHEMA_VERSION = "power-monthly-v1"
DEFAULT_FILL_VALUE = -999.0
ANNUAL_MONTH = 13
# POWER-Einheit -> Katalogeinheit. Nur bestätigte Zuordnungen; alles andere ist ein Schemafehler.
UNIT_MAP: dict[str, str] = {"C": "degC", "mm/day": "mm/day", "%": "%", "m/s": "m/s"}
_MONTH_KEY = re.compile(r"^(\d{4})(\d{2})$")


@dataclass(frozen=True)
class PowerMonthly:
    observations: tuple[MonthlyObservation, ...]
    unit: str
    fill_value: float
    returned_coordinates: Coordinates | None
    provider_version: str | None
    dataset: str | None


def _reject_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise provider_schema_error(f"Duplicate key in provider response: {key}")
        result[key] = value
    return result


def _reject_constant(name: str) -> NoReturn:
    raise provider_schema_error(f"Non-finite number in provider response: {name}")


def _object(value: object, what: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise provider_schema_error(f"Provider response has no object at {what}")
    return value


def _finite_number(value: object, what: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise provider_schema_error(f"Provider value at {what} is not a number")
    number = float(value)
    if not math.isfinite(number):
        raise provider_schema_error(f"Provider value at {what} is not finite")
    return number


def _parse(raw: bytes) -> dict[str, Any]:
    try:
        doc = json.loads(raw, object_pairs_hook=_reject_duplicates, parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError) as exc:
        raise provider_schema_error("Provider response is not valid JSON") from exc
    return _object(doc, "top level")


def _unit(doc: dict[str, Any], parameter: str, expected_unit: str) -> str:
    meta = _object(_object(doc.get("parameters"), "parameters").get(parameter), "parameters")
    units = meta.get("units")
    if not isinstance(units, str):
        raise provider_schema_error(f"Provider response has no unit for {parameter}")
    unit = UNIT_MAP.get(units)
    if unit is None:
        raise provider_schema_error(f"Unknown provider unit for {parameter}: {units}")
    if unit != expected_unit:
        raise provider_schema_error(
            f"Provider unit {unit} does not match catalog unit {expected_unit} for {parameter}"
        )
    return unit


def _header(doc: dict[str, Any]) -> tuple[float, str | None, str | None]:
    header = doc.get("header")
    if header is None:
        return DEFAULT_FILL_VALUE, None, None
    header = _object(header, "header")
    fill = header.get("fill_value")
    fill_value = DEFAULT_FILL_VALUE if fill is None else _finite_number(fill, "header.fill_value")
    api = header.get("api")
    version = api.get("version") if isinstance(api, dict) else None
    title = header.get("title")
    return (
        fill_value,
        version if isinstance(version, str) else None,
        title if isinstance(title, str) else None,
    )


def _returned_coordinates(doc: dict[str, Any]) -> Coordinates | None:
    geometry = doc.get("geometry")
    if geometry is None:
        return None
    coordinates = _object(geometry, "geometry").get("coordinates")
    if not isinstance(coordinates, list) or len(coordinates) < 2:
        raise provider_schema_error("Provider geometry has no [longitude, latitude]")
    longitude = _finite_number(coordinates[0], "geometry.coordinates[0]")
    latitude = _finite_number(coordinates[1], "geometry.coordinates[1]")
    try:
        return Coordinates(latitude=latitude, longitude=longitude)
    except ValidationError as exc:
        raise provider_schema_error("Provider coordinates are out of range") from exc


def normalize_power(
    raw: bytes, *, parameter: str, expected_unit: str, start_year: int, end_year: int
) -> PowerMonthly:
    """Rohbytes -> sortierte Monatswerte start_year..end_year samt Metadaten."""
    return normalize_power_doc(
        _parse(raw),
        parameter=parameter,
        expected_unit=expected_unit,
        start_year=start_year,
        end_year=end_year,
    )


def normalize_power_doc(
    doc: dict[str, Any], *, parameter: str, expected_unit: str, start_year: int, end_year: int
) -> PowerMonthly:
    """Wie normalize_power für ein geparstes Dokument (auch eine Zelle aus monthly/regional)."""
    unit = _unit(doc, parameter, expected_unit)
    fill_value, provider_version, dataset = _header(doc)
    properties = _object(doc.get("properties"), "properties")
    values = _object(
        _object(properties.get("parameter"), "properties.parameter").get(parameter),
        f"properties.parameter.{parameter}",
    )

    by_date: dict[dt.date, float | None] = {}
    for key, value in values.items():
        match = _MONTH_KEY.fullmatch(key)
        if match is None:
            raise provider_schema_error(f"Unexpected month key in provider response: {key}")
        year, month = int(match.group(1)), int(match.group(2))
        if month == ANNUAL_MONTH:
            continue  # Jahreswert des Providers, keine Monatsmessung.
        if not 1 <= month <= 12:
            raise provider_schema_error(f"Invalid month in provider response: {key}")
        if not start_year <= year <= end_year:
            raise provider_schema_error(f"Provider returned a year outside the request: {key}")
        date = dt.date(year, month, 1)
        if date in by_date:
            raise provider_schema_error(f"Duplicate month in provider response: {key}")
        if value is None:
            by_date[date] = None
            continue
        number = _finite_number(value, key)
        by_date[date] = None if number == fill_value else number

    return PowerMonthly(
        observations=tuple(
            MonthlyObservation(date=date, value=value, quality_flags=[])
            for date, value in sorted(by_date.items())
        ),
        unit=unit,
        fill_value=fill_value,
        returned_coordinates=_returned_coordinates(doc),
        provider_version=provider_version,
        dataset=dataset,
    )
