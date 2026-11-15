"""Ortssuche über alle unterstützten Länder (E-52a).

Der Index entsteht lazy aus dem RegionService (jedes Bundesland bzw. jeder State einmal, also
aus dem Regions-Cache oder beim allerersten Mal von geoBoundaries), liegt danach im Speicher und
zusätzlich als eine Datei im FileCache (<cache_dir>/region-search). Ein Neustart liest nur diese
Datei. Ein asyncio.Lock verhindert doppelten Aufbau bei gleichzeitigen ersten Aufrufen.

Matching: NFKD, Kombinationszeichen entfernen, casefold (ß -> ss); ein abschließendes Wort
county/parish/borough in der Anfrage wird ignoriert. Score 0 = exakt,
1 = Präfix des Namens, 2 = Präfix eines Wortes, 3 = Teilstring; danach Name, Typ, id.
"""

import asyncio
import datetime as dt
import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

from pydantic import JsonValue, TypeAdapter, ValidationError

from trend_detective.api.errors import ApiError, ErrorCode
from trend_detective.domain import geometry as geo
from trend_detective.schemas.regions import (
    Continent,
    RegionResponse,
    RegionSearchHit,
    RegionSearchResponse,
)
from trend_detective.services.regions import (
    COUNTRIES,
    REGION_SCHEMA_VERSION,
    RegionService,
)
from trend_detective.storage.file_cache import FileCache, cache_key

SEARCH_INDEX_VERSION = 1
MIN_QUERY_LENGTH = 2
# Schreibweise wie CONTINENT in apps/web/public/geo/countries.json.
CONTINENTS: Mapping[str, Continent] = {"AUT": "Europe", "USA": "North America"}
# US-Counties heißen in geoBoundaries ohne Zusatz ("Harris"); ein abschließendes
# " county"/" parish"/" borough" in der Anfrage wird daher ignoriert.
_DISTRICT_SUFFIX = re.compile(r" (?:county|parish|borough)$")
_TYPE_ORDER = {"state": 0, "district": 1, "municipality": 2}
_HITS = TypeAdapter(list[RegionSearchHit])


def normalize(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(stripped.casefold().split())


def search_key(query: str) -> str:
    """Normalisierte Anfrage ohne abschließendes Bezirkswort. Bliebe danach weniger als
    MIN_QUERY_LENGTH übrig ("x county"), gilt die unveränderte normalisierte Anfrage."""
    normalized = normalize(query)
    stripped = _DISTRICT_SUFFIX.sub("", normalized)
    return stripped if len(stripped) >= MIN_QUERY_LENGTH else normalized


def _words(text: str) -> list[str]:
    return "".join(ch if ch.isalnum() else " " for ch in text).split()


@dataclass(frozen=True)
class _Entry:
    hit: RegionSearchHit
    key: str
    words: tuple[str, ...]


def _entry(hit: RegionSearchHit) -> _Entry:
    key = normalize(hit.name)
    return _Entry(hit=hit, key=key, words=tuple(_words(key)))


def _score(entry: _Entry, query: str) -> int | None:
    if entry.key == query:
        return 0
    if entry.key.startswith(query):
        return 1
    if any(word.startswith(query) for word in entry.words):
        return 2
    if query in entry.key:
        return 3
    return None


def index_key_fields() -> dict[str, JsonValue]:
    countries: list[JsonValue] = [*sorted(COUNTRIES)]
    return {
        "kind": "region_search_index",
        "search_index_version": SEARCH_INDEX_VERSION,
        "region_schema_version": REGION_SCHEMA_VERSION,
        "countries": countries,
    }


def hits_from_region(region: RegionResponse) -> list[RegionSearchHit]:
    common = {
        "country_iso3": region.country_iso3,
        "adm1_id": region.adm1_id,
        "adm1_name": region.name,
        "continent": CONTINENTS[region.country_iso3],
    }
    state_point = _state_centroid(region)
    hits = [
        RegionSearchHit(
            type="state", id=region.adm1_id, name=region.name, centroid=state_point, **common
        )
    ]
    hits += [
        RegionSearchHit(type="district", id=d.id, name=d.name, centroid=d.centroid, **common)
        for d in region.districts
    ]
    hits += [
        RegionSearchHit(type="municipality", id=m.id, name=m.name, centroid=m.centroid, **common)
        for m in region.municipalities
    ]
    return hits


def _state_centroid(region: RegionResponse) -> list[float]:
    polygons = geo.parse_geometry(region.boundary.model_dump())
    return [round(c, 4) for c in geo.representative_point(polygons)]


class RegionSearch:
    def __init__(self, regions: RegionService, cache: FileCache) -> None:
        self._regions = regions
        self._cache = cache
        self._entries: list[_Entry] | None = None
        self._lock = asyncio.Lock()

    async def search(self, query: str, limit: int) -> RegionSearchResponse:
        normalized = search_key(query)
        if len(normalized) < MIN_QUERY_LENGTH:
            raise ApiError(
                422,
                ErrorCode.VALIDATION_ERROR,
                "Request validation failed",
                details={
                    "errors": [
                        {
                            "loc": ["query", "q"],
                            "msg": f"Query needs at least {MIN_QUERY_LENGTH} letters or digits",
                            "type": "string_too_short",
                        }
                    ]
                },
            )
        entries = await self._index()
        scored = [
            (score, entry) for entry in entries if (score := _score(entry, normalized)) is not None
        ]
        scored.sort(
            key=lambda item: (
                item[0],
                item[1].key,
                _TYPE_ORDER[item[1].hit.type],
                item[1].hit.id,
            )
        )
        return RegionSearchResponse(query=query, results=[e.hit for _, e in scored[:limit]])

    async def _index(self) -> list[_Entry]:
        if self._entries is not None:
            return self._entries
        async with self._lock:
            if self._entries is None:
                hits = self._read_cache()
                if hits is None:
                    hits = await self._build()
                    self._write_cache(hits)
                self._entries = [_entry(hit) for hit in hits]
            return self._entries

    def _read_cache(self) -> list[RegionSearchHit] | None:
        fields = index_key_fields()
        entry = self._cache.read(cache_key(fields), fields)
        if entry is None:
            return None
        try:
            return _HITS.validate_json(entry.raw)
        except ValidationError:
            return None

    async def _build(self) -> list[RegionSearchHit]:
        hits: list[RegionSearchHit] = []
        for country in COUNTRIES.values():
            for adm1_id in country.states:
                region = await self._regions.get_region(country.iso3, adm1_id)
                hits += hits_from_region(region)
        return hits

    def _write_cache(self, hits: list[RegionSearchHit]) -> None:
        fields = index_key_fields()
        self._cache.write(
            cache_key(fields),
            fields,
            _HITS.dump_json(hits),
            source_url="regions-cache",
            content_type="application/json",
            fetched_at=dt.datetime.now(dt.UTC),
        )
