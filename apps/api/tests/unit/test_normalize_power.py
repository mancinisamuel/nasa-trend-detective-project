"""E1: Normalisierung der POWER-Monatsantwort (Brief §06, §12 Normalisierung)."""

import datetime as dt
import json
from pathlib import Path
from typing import Any

import pytest

from trend_detective.api.errors import UPSTREAM_DATA_UNAVAILABLE, ApiError, ErrorCode
from trend_detective.providers.normalize_power import PowerMonthly, normalize_power
from trend_detective.schemas.responses import Coordinates

SAMPLE = Path(__file__).resolve().parents[1] / "fixtures" / "power_sample.json"


def _sample() -> dict[str, Any]:
    doc: dict[str, Any] = json.loads(SAMPLE.read_text(encoding="utf-8"))
    return doc


def _normalize(doc: dict[str, Any] | bytes, start: int = 2000, end: int = 2001) -> PowerMonthly:
    raw = doc if isinstance(doc, bytes) else json.dumps(doc).encode()
    return normalize_power(
        raw, parameter="T2M", expected_unit="degC", start_year=start, end_year=end
    )


def _values(result: PowerMonthly) -> dict[dt.date, float | None]:
    return {o.date: o.value for o in result.observations}


def _assert_schema_error(doc: dict[str, Any] | bytes, match: str = "") -> None:
    with pytest.raises(ApiError) as info:
        _normalize(doc)
    assert (info.value.status_code, info.value.code) == (502, ErrorCode.PROVIDER_SCHEMA_ERROR)
    # Antwort: fester Text; das Detail steht nur in log_detail (Server-Log).
    assert info.value.message == UPSTREAM_DATA_UNAVAILABLE
    assert match in (info.value.log_detail or "")


def test_sample_gives_24_sorted_months_and_ignores_month_13() -> None:
    result = _normalize(_sample())
    dates = [o.date for o in result.observations]
    assert len(dates) == 24
    assert dates == sorted(dates)
    assert dates[0] == dt.date(2000, 1, 1)
    assert dates[-1] == dt.date(2001, 12, 1)
    assert all(d.day == 1 and 1 <= d.month <= 12 for d in dates)


def test_fill_value_becomes_none_and_zero_stays_zero() -> None:
    values = _values(_normalize(_sample()))
    assert values[dt.date(2001, 1, 1)] is None
    assert values[dt.date(2000, 2, 1)] == 0.0
    assert values[dt.date(2000, 1, 1)] == -1.5


def test_metadata_unit_coordinates_version() -> None:
    result = _normalize(_sample())
    assert result.unit == "degC"
    assert result.fill_value == -999.0
    assert result.returned_coordinates == Coordinates(latitude=48.21, longitude=16.37)
    assert result.provider_version == "v2.10.0"
    assert result.dataset == "NASA/POWER Source Native Resolution Monthly and Annual"


def test_fill_value_from_header_is_used() -> None:
    doc = _sample()
    doc["header"]["fill_value"] = -99.0
    doc["properties"]["parameter"]["T2M"]["200003"] = -99.0
    values = _values(_normalize(doc))
    assert values[dt.date(2000, 3, 1)] is None
    assert values[dt.date(2001, 1, 1)] == -999.0  # nicht mehr der Fill-Wert dieser Antwort


def test_missing_header_fill_value_defaults_to_minus_999() -> None:
    doc = _sample()
    del doc["header"]["fill_value"]
    assert _values(_normalize(doc))[dt.date(2001, 1, 1)] is None


def test_json_null_becomes_none() -> None:
    doc = _sample()
    doc["properties"]["parameter"]["T2M"]["200005"] = None
    assert _values(_normalize(doc))[dt.date(2000, 5, 1)] is None


def test_unsorted_input_is_sorted() -> None:
    doc = _sample()
    items = list(doc["properties"]["parameter"]["T2M"].items())
    doc["properties"]["parameter"]["T2M"] = dict(reversed(items))
    dates = [o.date for o in _normalize(doc).observations]
    assert dates == sorted(dates)


@pytest.mark.parametrize("units", ["K", "F", "degC", "", "°C"])
def test_unknown_unit_is_schema_error(units: str) -> None:
    doc = _sample()
    doc["parameters"]["T2M"]["units"] = units
    _assert_schema_error(doc, "unit")


def test_unit_must_match_catalog_unit() -> None:
    with pytest.raises(ApiError) as info:
        normalize_power(
            SAMPLE.read_bytes(),
            parameter="T2M",
            expected_unit="mm/day",
            start_year=2000,
            end_year=2001,
        )
    assert info.value.code == ErrorCode.PROVIDER_SCHEMA_ERROR


def test_duplicate_month_key_is_detected() -> None:
    raw = SAMPLE.read_text(encoding="utf-8").replace(
        '"200002": 0,', '"200002": 0,\n        "200002": 1.0,'
    )
    assert raw.count('"200002"') == 2
    _assert_schema_error(raw.encode(), "Duplicate")


@pytest.mark.parametrize(
    ("mutate", "match"),
    [
        (lambda d: d.pop("parameters"), "parameters"),
        (lambda d: d["parameters"]["T2M"].pop("units"), "unit"),
        (lambda d: d["properties"]["parameter"].pop("T2M"), "T2M"),
        (lambda d: d.pop("properties"), "properties"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"2000-01": 1.0}), "month key"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"200014": 1.0}), "Invalid month"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"200000": 1.0}), "Invalid month"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"199912": 1.0}), "outside"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"200001": "1.0"}), "number"),
        (lambda d: d["properties"]["parameter"]["T2M"].update({"200001": True}), "number"),
        (lambda d: d["geometry"].update({"coordinates": [16.37]}), "geometry"),
        (lambda d: d["geometry"].update({"coordinates": [200.0, 48.21]}), "range"),
    ],
)
def test_schema_changes_are_schema_errors(mutate: Any, match: str) -> None:
    doc = _sample()
    mutate(doc)
    _assert_schema_error(doc, match)


@pytest.mark.parametrize("raw", [b"not json", b"[]", b'{"properties": NaN}', b"\xff\xfe"])
def test_invalid_json_or_non_finite_is_schema_error(raw: bytes) -> None:
    _assert_schema_error(raw)


def test_missing_geometry_means_unknown_returned_coordinates() -> None:
    doc = _sample()
    del doc["geometry"]
    assert _normalize(doc).returned_coordinates is None


def test_extreme_values_are_not_clipped() -> None:
    doc = _sample()
    doc["properties"]["parameter"]["T2M"]["200007"] = 61.5
    assert _values(_normalize(doc))[dt.date(2000, 7, 1)] == 61.5
