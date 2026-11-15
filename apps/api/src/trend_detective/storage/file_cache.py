"""FileCache: Rohantworten und Metadaten je Schlüssel, atomar geschrieben (Brief §10).

Layout: <root>/<key>/response.json (unveränderte Rohbytes) und <root>/<key>/metadata.json.
Schlüssel = SHA-256 eines kanonischen JSON-Objekts (Provider, Endpunktversion, Parameter,
Community, exakte Koordinaten, Start-/Endjahr, Normalisierungs-Schemaversion).
Beschädigte oder nicht passende Einträge gelten als Miss und werden beim nächsten Schreiben
ersetzt; sie bringen die Anwendung nie zum Absturz.
"""

import datetime as dt
import hashlib
import json
import logging
import os
import re
import tempfile
from collections.abc import Mapping
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, JsonValue, ValidationError

logger = logging.getLogger(__name__)

CACHE_SCHEMA_VERSION = 1
RESPONSE_FILE = "response.json"
METADATA_FILE = "metadata.json"
_KEY_PATTERN = re.compile(r"^[0-9a-f]{64}$")


def cache_key(fields: Mapping[str, JsonValue]) -> str:
    """SHA-256 über kanonisches JSON (sortierte Schlüssel, keine Leerzeichen)."""
    canonical = json.dumps(dict(fields), sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True)
class CacheEntry:
    raw: bytes
    raw_sha256: str
    fetched_at: dt.datetime
    expires_at: dt.datetime
    source_url: str
    content_type: str

    def is_fresh(self, now: dt.datetime) -> bool:
        return now < self.expires_at


class _Metadata(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    cache_schema_version: Literal[1]
    key: str
    key_fields: dict[str, JsonValue]
    fetched_at: AwareDatetime
    expires_at: AwareDatetime
    raw_sha256: str
    content_type: str
    source_url: str


class FileCache:
    def __init__(self, root: Path, ttl_seconds: int) -> None:
        if ttl_seconds < 0:
            raise ValueError("ttl_seconds must not be negative")
        self._root = root
        self._ttl = dt.timedelta(seconds=ttl_seconds)

    @property
    def root(self) -> Path:
        return self._root

    def entry_dir(self, key: str) -> Path:
        if not _KEY_PATTERN.fullmatch(key):
            raise ValueError("cache key must be a SHA-256 hex digest")
        return self._root / key

    def read(self, key: str, key_fields: Mapping[str, JsonValue]) -> CacheEntry | None:
        """Eintrag oder None (fehlend, beschädigt, Hash/Schlüssel passt nicht). Frische prüft
        der Aufrufer mit CacheEntry.is_fresh."""
        directory = self.entry_dir(key)
        metadata_path = directory / METADATA_FILE
        if not metadata_path.exists():
            return None
        try:
            metadata = _Metadata.model_validate_json(metadata_path.read_bytes())
            raw = (directory / RESPONSE_FILE).read_bytes()
        except (OSError, ValidationError):
            logger.warning("discarding unreadable cache entry", extra={"cache_key": key})
            return None
        if (
            metadata.key != key
            or metadata.key_fields != dict(key_fields)
            or hashlib.sha256(raw).hexdigest() != metadata.raw_sha256
        ):
            logger.warning("discarding mismatching cache entry", extra={"cache_key": key})
            return None
        return CacheEntry(
            raw=raw,
            raw_sha256=metadata.raw_sha256,
            fetched_at=metadata.fetched_at,
            expires_at=metadata.expires_at,
            source_url=metadata.source_url,
            content_type=metadata.content_type,
        )

    def write(
        self,
        key: str,
        key_fields: Mapping[str, JsonValue],
        raw: bytes,
        *,
        source_url: str,
        content_type: str,
        fetched_at: dt.datetime,
    ) -> CacheEntry:
        """Rohbytes zuerst, Metadaten zuletzt: erst die Metadaten machen den Eintrag gültig."""
        directory = self.entry_dir(key)
        directory.mkdir(parents=True, exist_ok=True)
        raw_sha256 = hashlib.sha256(raw).hexdigest()
        metadata = _Metadata(
            cache_schema_version=CACHE_SCHEMA_VERSION,
            key=key,
            key_fields=dict(key_fields),
            fetched_at=fetched_at,
            expires_at=fetched_at + self._ttl,
            raw_sha256=raw_sha256,
            content_type=content_type,
            source_url=source_url,
        )
        atomic_write(directory / RESPONSE_FILE, raw)
        atomic_write(directory / METADATA_FILE, metadata.model_dump_json(indent=2).encode())
        return CacheEntry(
            raw=raw,
            raw_sha256=raw_sha256,
            fetched_at=metadata.fetched_at,
            expires_at=metadata.expires_at,
            source_url=source_url,
            content_type=content_type,
        )


def atomic_write(path: Path, data: bytes) -> None:
    """Temp-Datei im Zielordner schreiben, fsync, dann os.replace (atomar auf einem Dateisystem)."""
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp_name)
        raise
