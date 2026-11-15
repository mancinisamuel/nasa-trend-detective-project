"""Gemeinsame Test-Helfer: synthetische POWER-Antworten in der Form von API v2.10.0."""

import json
import math
import os
from collections.abc import Callable
from typing import Any

import pytest

# Der Settings-Default ist live. Tests laufen deterministisch und ohne Netz im Demo-Modus,
# auch die beim Import gebaute App in trend_detective.main; Live-Tests setzen es selbst.
os.environ["TD_DATA_MODE"] = "demo"

PowerPayload = Callable[..., bytes]


def _seasonal(year: int, month: int) -> float:
    """Wien-ähnlicher Jahresgang plus 0.03 °C/Jahr Trend (bekannte Steigung)."""
    return round(10.0 + 10.0 * math.sin((month - 4) / 12 * 2 * math.pi) + 0.03 * (year - 1981), 2)


def build_power_payload(
    start_year: int,
    end_year: int,
    *,
    unit: str = "C",
    fill_value: float | None = -999.0,
    latitude: float = 48.21,
    longitude: float = 16.37,
    value: Callable[[int, int], float | None] = _seasonal,
    parameter: str = "T2M",
) -> bytes:
    values: dict[str, Any] = {}
    for year in range(start_year, end_year + 1):
        months = [value(year, m) for m in range(1, 13)]
        for month, v in enumerate(months, start=1):
            values[f"{year}{month:02d}"] = v
        numbers = [v for v in months if v is not None]
        values[f"{year}13"] = round(sum(numbers) / len(numbers), 2) if numbers else fill_value
    header: dict[str, Any] = {
        "title": "NASA/POWER Source Native Resolution Monthly and Annual",
        "api": {"version": "v2.10.0", "name": "POWER Monthly and Annual API"},
        "sources": ["MERRA2"],
    }
    if fill_value is not None:
        header["fill_value"] = fill_value
    doc = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [longitude, latitude, 372.75]},
        "properties": {"parameter": {parameter: values}},
        "header": header,
        "messages": [],
        "parameters": {parameter: {"units": unit, "longname": "Temperature at 2 Meters"}},
    }
    return json.dumps(doc).encode()


@pytest.fixture
def power_payload() -> PowerPayload:
    return build_power_payload
