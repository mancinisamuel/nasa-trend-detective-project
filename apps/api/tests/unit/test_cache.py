"""E1: FileCache (Brief §10, §12 Provider/Cache): Hit/Miss, TTL, atomar, beschädigt, Schlüssel."""

import datetime as dt
import hashlib
import json
import os
from pathlib import Path

import pytest
from pydantic import JsonValue

from trend_detective.providers.power import power_cache_fields
from trend_detective.storage.file_cache import METADATA_FILE, RESPONSE_FILE, FileCache, cache_key

NOW = dt.datetime(2026, 11, 14, 12, 0, tzinfo=dt.UTC)
RAW = b'{"hello": "power"}'
URL = "https://power.larc.nasa.gov/api/temporal/monthly/point?parameters=T2M"


def _fields(lat: float = 48.21, lon: float = 16.37) -> dict[str, JsonValue]:
    return power_cache_fields("T2M", lat, lon, 1981, 2025)


def _write(cache: FileCache, fields: dict[str, JsonValue], raw: bytes = RAW) -> str:
    key = cache_key(fields)
    cache.write(key, fields, raw, source_url=URL, content_type="application/json", fetched_at=NOW)
    return key


def test_miss_then_hit_with_unchanged_raw_bytes(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    fields = _fields()
    key = cache_key(fields)
    assert cache.read(key, fields) is None
    _write(cache, fields)
    entry = cache.read(key, fields)
    assert entry is not None
    assert entry.raw == RAW
    assert entry.raw_sha256 == hashlib.sha256(RAW).hexdigest()
    assert (entry.fetched_at, entry.source_url) == (NOW, URL)
    assert (tmp_path / key / RESPONSE_FILE).read_bytes() == RAW
    metadata = json.loads((tmp_path / key / METADATA_FILE).read_text())
    assert metadata["expires_at"].startswith("2026-11-15T12:00:00")
    assert metadata["key_fields"] == fields


def test_ttl_expiry(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=3600)
    fields = _fields()
    key = _write(cache, fields)
    entry = cache.read(key, fields)
    assert entry is not None
    assert entry.is_fresh(NOW + dt.timedelta(minutes=59))
    assert not entry.is_fresh(NOW + dt.timedelta(hours=1))


def test_key_is_canonical_and_separates_coordinates_and_years() -> None:
    base = _fields()
    assert cache_key(base) == cache_key(dict(reversed(list(base.items()))))
    assert len(cache_key(base)) == 64
    keys = {
        cache_key(base),
        cache_key(_fields(lat=48.2100001)),
        cache_key(_fields(lon=16.38)),
        cache_key(power_cache_fields("T2M", 48.21, 16.37, 1991, 2020)),
        cache_key({**base, "normalization_schema_version": "power-monthly-v2"}),
        cache_key({**base, "community": "RE"}),
    }
    assert len(keys) == 6


def test_corrupt_metadata_is_discarded_without_crash(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    fields = _fields()
    key = _write(cache, fields)
    (tmp_path / key / METADATA_FILE).write_text("{broken")
    assert cache.read(key, fields) is None
    _write(cache, fields)  # Überschreiben repariert den Eintrag.
    assert cache.read(key, fields) is not None


def test_tampered_response_is_discarded(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    fields = _fields()
    key = _write(cache, fields)
    (tmp_path / key / RESPONSE_FILE).write_bytes(b'{"hello": "other"}')
    assert cache.read(key, fields) is None


def test_missing_response_file_is_discarded(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    fields = _fields()
    key = _write(cache, fields)
    (tmp_path / key / RESPONSE_FILE).unlink()
    assert cache.read(key, fields) is None


def test_entry_for_other_fields_is_not_used(tmp_path: Path) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    key = _write(cache, _fields())
    assert cache.read(key, _fields(lat=40.42)) is None


def test_atomic_write_keeps_old_file_when_replace_fails(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    cache = FileCache(tmp_path, ttl_seconds=86400)
    fields = _fields()
    key = _write(cache, fields)

    def _fail(_src: object, _dst: object) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", _fail)
    with pytest.raises(OSError, match="disk full"):
        _write(cache, fields, raw=b'{"new": true}')
    monkeypatch.undo()
    entry = cache.read(key, fields)
    assert entry is not None and entry.raw == RAW
    leftovers = [p.name for p in (tmp_path / key).iterdir()]
    assert sorted(leftovers) == [METADATA_FILE, RESPONSE_FILE]  # keine Temp-Dateien


def test_atomic_write_uses_replace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str]] = []
    real_replace = os.replace

    def _spy(src: str, dst: str) -> None:
        calls.append((Path(src).name, Path(dst).name))
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", _spy)
    _write(FileCache(tmp_path, ttl_seconds=10), _fields())
    assert [dst for _, dst in calls] == [RESPONSE_FILE, METADATA_FILE]
    assert all(src.endswith(".tmp") and src.startswith(".") for src, _ in calls)


def test_invalid_key_and_negative_ttl_are_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError):
        FileCache(tmp_path, ttl_seconds=86400).entry_dir("../escape")
    with pytest.raises(ValueError):
        FileCache(tmp_path, ttl_seconds=-1)
