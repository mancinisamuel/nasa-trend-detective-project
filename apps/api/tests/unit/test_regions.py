"""District-Centroide liegen im Polygon; alte Cache-Einträge ohne das Feld crashen nicht."""

import datetime as dt
import json
from pathlib import Path

import httpx

from trend_detective.domain import geometry as geo
from trend_detective.providers.geoboundaries import Layer, LayerMetadata
from trend_detective.schemas.regions import RegionResponse
from trend_detective.services.regions import (
    COORDINATE_DIGITS,
    CountryConfig,
    RegionService,
    build_regions,
    parse_cached_region,
    region_key_fields,
)
from trend_detective.storage.file_cache import FileCache, cache_key

# C-Form: der Flächenschwerpunkt liegt in der Öffnung, also außerhalb des Polygons.
C_RING = [
    [0.0, 0.0],
    [3.0, 0.0],
    [3.0, 1.0],
    [1.0, 1.0],
    [1.0, 2.0],
    [3.0, 2.0],
    [3.0, 3.0],
    [0.0, 3.0],
    [0.0, 0.0],
]
STATE_RING = [
    [-0.5, -0.5],
    [3.5, -0.5],
    [3.5, 3.5],
    [-0.5, 3.5],
    [-0.5, -0.5],
]
RETRIEVED_AT = dt.datetime(2020, 1, 1, tzinfo=dt.UTC)


def _country() -> CountryConfig:
    return CountryConfig(
        iso3="USA",
        levels=("ADM1", "ADM2"),
        geometry_format="topojson",
        attribution="test",
        simplification="test",
        states={"US-TX": "Texas"},
    )


def _meta(level: str) -> LayerMetadata:
    return LayerMetadata(
        level=level,
        boundary_id=f"TEST-{level}",
        boundary_source="test",
        boundary_year_represented="2020",
        build_date="2020-01-01",
        license="CC0",
        license_source="https://www.geoboundaries.org",
        metadata_url=f"https://www.geoboundaries.org/api/current/gbOpen/USA/{level}/",
        download_url="https://github.com/example/test.json",
    )


def _feature(
    shape_id: str, name: str, ring: list[list[float]], *, iso: str | None = None
) -> dict[str, object]:
    properties: dict[str, str] = {"shapeID": shape_id, "shapeName": name}
    if iso is not None:
        properties["shapeISO"] = iso
    return {
        "type": "Feature",
        "properties": properties,
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }


def _texas() -> dict[str, RegionResponse]:
    layers = [
        Layer(
            metadata=_meta("ADM1"),
            features=[_feature("state-tx", "Texas", STATE_RING, iso="US-TX")],
        ),
        Layer(
            metadata=_meta("ADM2"),
            features=[_feature("county-c", "C County", C_RING)],
        ),
    ]
    return build_regions(_country(), layers, RETRIEVED_AT)


def _unused_client() -> httpx.AsyncClient:
    raise AssertionError("network should not be used")


def test_district_centroid_lies_inside_the_polygon() -> None:
    source = geo.parse_geometry({"type": "Polygon", "coordinates": [C_RING]})
    assert not geo.point_in_polygons(geo.centroid(source), source)

    district = _texas()["US-TX"].districts[0]
    expected = [round(c, COORDINATE_DIGITS) for c in geo.representative_point(source)]
    assert district.centroid == expected
    polygons = geo.parse_geometry(district.geometry.model_dump())
    assert geo.point_in_polygons((district.centroid[0], district.centroid[1]), polygons)


def test_stale_cache_without_district_centroid_is_upgraded(tmp_path: Path) -> None:
    country = _country()
    region = _texas()["US-TX"]
    stale = json.loads(region.model_dump_json())
    for district in stale["districts"]:
        del district["centroid"]
    assert parse_cached_region(json.dumps(stale).encode()) is not None

    cache = FileCache(tmp_path, ttl_seconds=86400)
    old_fields = region_key_fields(country, "US-TX", schema_version=1)
    cache.write(
        cache_key(old_fields),
        old_fields,
        json.dumps(stale).encode(),
        source_url="https://www.geoboundaries.org",
        content_type="application/json",
        fetched_at=RETRIEVED_AT,
    )
    got = RegionService(cache, _unused_client)._read(country, "US-TX")
    assert got is not None
    assert len(got.districts) == 1
    point = (got.districts[0].centroid[0], got.districts[0].centroid[1])
    polygons = geo.parse_geometry(got.districts[0].geometry.model_dump())
    assert geo.point_in_polygons(point, polygons)
    # Migrierter Eintrag liegt unter der aktuellen Schema-Version.
    current = region_key_fields(country, "US-TX")
    assert cache.read(cache_key(current), current) is not None
