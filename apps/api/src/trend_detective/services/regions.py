"""RegionService: Bundesland/State mit Bezirken bzw. Counties und Gemeinden aus geoBoundaries.

E-42 (AUT) und E-46 (USA). Erster Abruf je Land: ADM-Ebenen herunterladen, Gemeinden per
innerem Punkt den Bezirken und Bezirke den Bundesländern zuordnen, je Bundesland zuschneiden,
vereinfachen und alle Bundesländer des Landes in den FileCache schreiben. Danach kommt jede
Antwort nur aus dem Cache, ohne Netz. Grenzen veralten nicht im Tagesrhythmus: ein gültiger
Eintrag wird unabhängig vom TTL gelesen; neu laden heißt den Ordner <cache>/regions löschen.
"""

import asyncio
import datetime as dt
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx
from pydantic import JsonValue, ValidationError

from trend_detective.api.errors import ApiError, ErrorCode, provider_schema_error
from trend_detective.domain import geometry as geo
from trend_detective.providers.geoboundaries import (
    GeometryFormat,
    Layer,
    LayerMetadata,
    fetch_layer,
)
from trend_detective.schemas.regions import RegionResponse
from trend_detective.storage.file_cache import FileCache, cache_key

REGION_SCHEMA_VERSION = 2
DISTRICT_TOLERANCE_DEG = 0.002
MUNICIPALITY_TOLERANCE_DEG = 0.001
COORDINATE_DIGITS = 4
SIMPLIFICATION = (
    f"geoBoundaries simplified GeoJSON, then Douglas-Peucker {DISTRICT_TOLERANCE_DEG} deg "
    f"(state, districts) and {MUNICIPALITY_TOLERANCE_DEG} deg (municipalities), "
    f"coordinates rounded to {COORDINATE_DIGITS} decimals"
)
ALASKA_TOLERANCE_DEG = 0.01
SOURCE_URL = "https://www.geoboundaries.org"

CountryIso3 = Literal["AUT", "USA"]


@dataclass(frozen=True)
class CountryConfig:
    iso3: CountryIso3
    levels: tuple[str, ...]
    geometry_format: GeometryFormat
    attribution: str
    simplification: str
    # Öffentliche adm1_id = ISO 3166-2 wie iso_3166_2 in apps/web/public/geo/admin1/<ISO3>.json.
    states: Mapping[str, str]
    # Abweichende geoBoundaries-shapeISO -> öffentliche adm1_id.
    iso_aliases: Mapping[str, str] = field(default_factory=dict)
    # Gröbere Toleranz für Grenze und Bezirke einzelner Bundesländer.
    tolerance_overrides: Mapping[str, float] = field(default_factory=dict)


AUT = CountryConfig(
    iso3="AUT",
    levels=("ADM1", "ADM2", "ADM3"),
    geometry_format="geojson",
    attribution=(
        "Boundaries: geoBoundaries (gbOpen), www.geoboundaries.org; "
        "source data: Federal Office for Metrology and Survey, Austria (BEV)"
    ),
    simplification=SIMPLIFICATION,
    states={
        "AT-1": "Burgenland",
        "AT-2": "Kärnten",
        "AT-3": "Niederösterreich",
        "AT-4": "Oberösterreich",
        "AT-5": "Salzburg",
        "AT-6": "Steiermark",
        "AT-7": "Tirol",
        "AT-8": "Vorarlberg",
        "AT-9": "Wien",
    },
)

# 50 States und DC wie USA.json im Frontend. Puerto Rico und die Territorien sind dort eigene
# Länder (PRI, GUM, ...) und liefern hier 404 UNKNOWN_REGION. geoBoundaries hat für die USA kein
# ADM3: municipalities bleibt leer.
USA = CountryConfig(
    iso3="USA",
    levels=("ADM1", "ADM2"),
    geometry_format="topojson",
    attribution=(
        "Boundaries: geoBoundaries (gbOpen), www.geoboundaries.org; "
        "source data: United States Census Bureau, MAF/TIGER Database"
    ),
    simplification=(
        "geoBoundaries TopoJSON, then Douglas-Peucker "
        f"{DISTRICT_TOLERANCE_DEG} deg (state, counties; Alaska {ALASKA_TOLERANCE_DEG} deg), "
        f"coordinates rounded to {COORDINATE_DIGITS} decimals"
    ),
    states={
        "US-AK": "Alaska",
        "US-AL": "Alabama",
        "US-AR": "Arkansas",
        "US-AZ": "Arizona",
        "US-CA": "California",
        "US-CO": "Colorado",
        "US-CT": "Connecticut",
        "US-DC": "District of Columbia",
        "US-DE": "Delaware",
        "US-FL": "Florida",
        "US-GA": "Georgia",
        "US-HI": "Hawaii",
        "US-IA": "Iowa",
        "US-ID": "Idaho",
        "US-IL": "Illinois",
        "US-IN": "Indiana",
        "US-KS": "Kansas",
        "US-KY": "Kentucky",
        "US-LA": "Louisiana",
        "US-MA": "Massachusetts",
        "US-MD": "Maryland",
        "US-ME": "Maine",
        "US-MI": "Michigan",
        "US-MN": "Minnesota",
        "US-MO": "Missouri",
        "US-MS": "Mississippi",
        "US-MT": "Montana",
        "US-NC": "North Carolina",
        "US-ND": "North Dakota",
        "US-NE": "Nebraska",
        "US-NH": "New Hampshire",
        "US-NJ": "New Jersey",
        "US-NM": "New Mexico",
        "US-NV": "Nevada",
        "US-NY": "New York",
        "US-OH": "Ohio",
        "US-OK": "Oklahoma",
        "US-OR": "Oregon",
        "US-PA": "Pennsylvania",
        "US-RI": "Rhode Island",
        "US-SC": "South Carolina",
        "US-SD": "South Dakota",
        "US-TN": "Tennessee",
        "US-TX": "Texas",
        "US-UT": "Utah",
        "US-VA": "Virginia",
        "US-VT": "Vermont",
        "US-WA": "Washington",
        "US-WI": "Wisconsin",
        "US-WV": "West Virginia",
        "US-WY": "Wyoming",
    },
    # Datenfehler in geoBoundaries USA-ADM1-66186276: South Dakota trägt shapeISO "SU-SD".
    iso_aliases={"SU-SD": "US-SD"},
    tolerance_overrides={"US-AK": ALASKA_TOLERANCE_DEG},
)

COUNTRIES: Mapping[str, CountryConfig] = {c.iso3: c for c in (AUT, USA)}

ClientFactory = Callable[[], httpx.AsyncClient]


def region_key_fields(
    country: CountryConfig, adm1_id: str, *, schema_version: int = REGION_SCHEMA_VERSION
) -> dict[str, JsonValue]:
    """Cache-Schlüssel je Bundesland. Version 2 ergänzt District.centroid; v1-Einträge
    werden beim Lesen migriert und unter der aktuellen Version neu geschrieben."""
    return {
        "provider": "geoboundaries",
        "release_type": "gbOpen",
        "country_iso3": country.iso3,
        "adm1_id": adm1_id,
        "region_schema_version": schema_version,
        "simplification": country.simplification,
    }


def validate_region_path(country_iso3: str, adm1_id: str) -> tuple[CountryConfig, str]:
    """Land und normalisierte adm1_id oder 404 (UNSUPPORTED_COUNTRY vor UNKNOWN_REGION)."""
    country = COUNTRIES.get(country_iso3.upper())
    if country is None:
        raise ApiError(
            404,
            ErrorCode.UNSUPPORTED_COUNTRY,
            f"Regions are only available for {', '.join(COUNTRIES)}",
            details={"country_iso3": country_iso3, "supported": list(COUNTRIES)},
        )
    normalized = adm1_id.upper()
    if normalized not in country.states:
        raise ApiError(
            404,
            ErrorCode.UNKNOWN_REGION,
            f"Unknown region for {country.iso3}",
            details={"adm1_id": adm1_id, "supported": list(country.states)},
        )
    return country, normalized


@dataclass(frozen=True)
class _Unit:
    properties: Mapping[str, Any]
    polygons: geo.MultiPolygon
    box: geo.BBox
    point: geo.Position


def _units(layer: Layer) -> list[_Unit]:
    units: list[_Unit] = []
    for feature in layer.features:
        try:
            polygons = geo.parse_geometry(feature.get("geometry"))
        except geo.GeometryError as exc:
            raise provider_schema_error(f"geoBoundaries {layer.metadata.level}: {exc}") from exc
        units.append(
            _Unit(
                properties=feature["properties"],
                polygons=polygons,
                box=geo.bbox(polygons),
                point=geo.representative_point(polygons),
            )
        )
    return units


def assign_parents(children: list[_Unit], parents: list[_Unit]) -> list[int]:
    """Index des Elternteils je Kind: innerer Punkt des Kinds im Elternpolygon; fällt er in
    eine Lücke zwischen vereinfachten Grenzen, gilt der nächstgelegene Elternschwerpunkt."""
    centers = [geo.centroid(p.polygons) for p in parents]
    result: list[int] = []
    for child in children:
        x, y = child.point
        hit = next(
            (
                i
                for i, parent in enumerate(parents)
                if parent.box.contains(child.point)
                and geo.point_in_polygons(child.point, parent.polygons)
            ),
            None,
        )
        if hit is None:
            hit = min(
                range(len(parents)),
                key=lambda i: (centers[i][0] - x) ** 2 + (centers[i][1] - y) ** 2,
            )
        result.append(hit)
    return result


def _geometry(polygons: geo.MultiPolygon, tolerance: float) -> dict[str, Any]:
    return geo.to_geojson(geo.simplify(polygons, tolerance, COORDINATE_DIGITS))


def _layer_json(meta: LayerMetadata) -> dict[str, JsonValue]:
    return {
        "level": meta.level,
        "boundary_id": meta.boundary_id,
        "boundary_source": meta.boundary_source,
        "boundary_year_represented": meta.boundary_year_represented,
        "build_date": meta.build_date,
        "license": meta.license,
        "license_source": meta.license_source,
        "metadata_url": meta.metadata_url,
        "download_url": meta.download_url,
    }


def build_regions(
    country: CountryConfig, layers: list[Layer], retrieved_at: dt.datetime
) -> dict[str, RegionResponse]:
    """Alle Bundesländer eines Landes; Schlüssel = öffentliche adm1_id (ISO 3166-2).

    Bezirke werden allen ADM1-Einheiten zugeordnet (auch nicht ausgelieferten wie Puerto Rico),
    damit kein Bezirk in ein Nachbarland rutscht.
    """
    adm1, adm2 = layers[0], layers[1]
    adm3 = layers[2] if len(layers) > 2 else None
    states, districts = _units(adm1), _units(adm2)
    municipalities = _units(adm3) if adm3 is not None else []
    district_state = assign_parents(districts, states)
    municipality_district = assign_parents(municipalities, districts) if municipalities else []
    licenses = sorted({layer.metadata.license for layer in layers})
    metadata: dict[str, Any] = {
        "provider": "geoBoundaries",
        "release_type": "gbOpen",
        "attribution": country.attribution,
        "license": "; ".join(licenses),
        "url": SOURCE_URL,
        "layers": [_layer_json(layer.metadata) for layer in layers],
        "retrieved_at": retrieved_at.isoformat(),
        "simplification": country.simplification,
    }
    result: dict[str, RegionResponse] = {}
    for state_index, state in enumerate(states):
        raw_iso = state.properties.get("shapeISO")
        if not isinstance(raw_iso, str):
            continue
        iso = country.iso_aliases.get(raw_iso, raw_iso)
        if iso not in country.states:
            continue
        tolerance = country.tolerance_overrides.get(iso, DISTRICT_TOLERANCE_DEG)
        member_districts = [i for i, s in enumerate(district_state) if s == state_index]
        member_set = set(member_districts)
        doc = {
            "country_iso3": country.iso3,
            "adm1_id": iso,
            "name": state.properties["shapeName"],
            "boundary": _geometry(state.polygons, tolerance),
            "districts": [
                {
                    "id": districts[i].properties["shapeID"],
                    "name": districts[i].properties["shapeName"],
                    "centroid": [round(c, COORDINATE_DIGITS) for c in districts[i].point],
                    "geometry": _geometry(districts[i].polygons, tolerance),
                }
                for i in member_districts
            ],
            "municipalities": [
                {
                    "id": unit.properties["shapeID"],
                    "name": unit.properties["shapeName"],
                    "district_id": districts[municipality_district[j]].properties["shapeID"],
                    "centroid": [round(c, COORDINATE_DIGITS) for c in unit.point],
                    "geometry": _geometry(unit.polygons, MUNICIPALITY_TOLERANCE_DEG),
                }
                for j, unit in enumerate(municipalities)
                if municipality_district[j] in member_set
            ],
            "metadata": metadata,
        }
        result[iso] = RegionResponse.model_validate(doc)
    missing = sorted(set(country.states) - set(result))
    if missing:
        raise provider_schema_error(f"geoBoundaries ADM1 lacks states {', '.join(missing)}")
    return result


def parse_cached_region(raw: bytes) -> RegionResponse | None:
    """Gültige Region oder, bei älteren Einträgen, District-Centroide aus der Geometrie."""
    try:
        return RegionResponse.model_validate_json(raw)
    except ValidationError:
        pass
    try:
        data = json.loads(raw)
        for district in data["districts"]:
            if "centroid" in district:
                continue
            polygons = geo.parse_geometry(district["geometry"])
            district["centroid"] = [
                round(c, COORDINATE_DIGITS) for c in geo.representative_point(polygons)
            ]
        return RegionResponse.model_validate(data)
    except (ValidationError, KeyError, TypeError, ValueError, geo.GeometryError):
        return None


class RegionService:
    def __init__(self, cache: FileCache, client_factory: ClientFactory) -> None:
        self._cache = cache
        self._client_factory = client_factory
        self._locks = {iso3: asyncio.Lock() for iso3 in COUNTRIES}

    def _read(self, country: CountryConfig, adm1_id: str) -> RegionResponse | None:
        for version in range(REGION_SCHEMA_VERSION, 0, -1):
            fields = region_key_fields(country, adm1_id, schema_version=version)
            entry = self._cache.read(cache_key(fields), fields)
            if entry is None:
                continue
            region = parse_cached_region(entry.raw)
            if region is None:
                continue
            if version != REGION_SCHEMA_VERSION:
                self._write_all(country, {adm1_id: region})
            return region
        return None

    async def get_region(self, country_iso3: str, adm1_id: str) -> RegionResponse:
        country, normalized = validate_region_path(country_iso3, adm1_id)
        cached = self._read(country, normalized)
        if cached is not None:
            return cached
        async with self._locks[country.iso3]:
            cached = self._read(country, normalized)
            if cached is not None:
                return cached
            regions = await self._download_and_build(country)
            self._write_all(country, regions)
            return regions[normalized]

    async def _download_and_build(self, country: CountryConfig) -> dict[str, RegionResponse]:
        async with self._client_factory() as client:
            layers = [
                await fetch_layer(client, country.iso3, level, country.geometry_format)
                for level in country.levels
            ]
        retrieved_at = dt.datetime.now(dt.UTC)
        # CPU-Arbeit (AUT rund 1 s, USA rund 4 s) nicht im Event-Loop.
        return await asyncio.to_thread(build_regions, country, layers, retrieved_at)

    def _write_all(self, country: CountryConfig, regions: Mapping[str, RegionResponse]) -> None:
        for adm1_id, region in regions.items():
            fields = region_key_fields(country, adm1_id)
            self._cache.write(
                cache_key(fields),
                fields,
                region.model_dump_json().encode(),
                source_url=region.metadata.layers[0].metadata_url,
                content_type="application/json",
                fetched_at=region.metadata.retrieved_at,
            )
