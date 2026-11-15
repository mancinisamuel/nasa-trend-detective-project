"""geoBoundaries-Adapter (gbOpen, ohne API-Key): Ebenen-Metadaten und vereinfachtes GeoJSON.

https://www.geoboundaries.org/api/current/gbOpen/<ISO3>/<ADM>/ liefert JSON-Metadaten; das
GeoJSON liegt auf GitHub (Weiterleitung auf media.githubusercontent.com). Weiterleitungen
werden nur innerhalb der erlaubten Hosts verfolgt.
"""

import json
from dataclasses import dataclass
from typing import Any, Literal
from urllib.parse import urlsplit

import httpx

from trend_detective.api.errors import (
    provider_schema_error,
    provider_timeout,
    provider_unavailable,
)

API_BASE = "https://www.geoboundaries.org/api/current/gbOpen"
ALLOWED_HOSTS = frozenset(
    {
        "www.geoboundaries.org",
        "github.com",
        "raw.githubusercontent.com",
        "media.githubusercontent.com",
    }
)
MAX_BYTES = 50 * 1024 * 1024
GeometryFormat = Literal["geojson", "topojson"]
_REQUIRED_META = (
    "boundaryID",
    "boundaryType",
    "boundarySource",
    "boundaryYearRepresented",
    "buildDate",
    "boundaryLicense",
    "licenseSource",
)


@dataclass(frozen=True)
class LayerMetadata:
    level: str
    boundary_id: str
    boundary_source: str
    boundary_year_represented: str
    build_date: str
    license: str
    license_source: str
    metadata_url: str
    download_url: str


@dataclass(frozen=True)
class Layer:
    metadata: LayerMetadata
    features: list[dict[str, Any]]


def metadata_url(country_iso3: str, level: str) -> str:
    return f"{API_BASE}/{country_iso3}/{level}/"


def _check_host(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
        raise provider_schema_error("geoBoundaries returned a download URL on an unexpected host")


async def _get(client: httpx.AsyncClient, url: str) -> bytes:
    _check_host(url)
    try:
        response = await client.get(url, follow_redirects=True)
    except httpx.TimeoutException as exc:
        raise provider_timeout("geoBoundaries did not answer in time") from exc
    except httpx.HTTPError as exc:
        raise provider_unavailable("geoBoundaries is not reachable") from exc
    _check_host(str(response.url))
    if response.status_code != 200:
        raise provider_unavailable(f"geoBoundaries answered HTTP {response.status_code}")
    if len(response.content) > MAX_BYTES:
        raise provider_schema_error("geoBoundaries response is unexpectedly large")
    return response.content


def _json(raw: bytes) -> Any:
    try:
        return json.loads(raw)
    except ValueError as exc:
        raise provider_schema_error("geoBoundaries returned invalid JSON") from exc


def parse_metadata(
    raw: bytes, *, level: str, url: str, fmt: GeometryFormat = "geojson"
) -> LayerMetadata:
    data = _json(raw)
    if not isinstance(data, dict) or not all(isinstance(data.get(k), str) for k in _REQUIRED_META):
        raise provider_schema_error("geoBoundaries metadata is missing required fields")
    # TopoJSON (USA): volle Auflösung, aber kleiner als das vereinfachte GeoJSON (< 5 MB).
    download = (
        data.get("tjDownloadURL")
        if fmt == "topojson"
        else data.get("simplifiedGeometryGeoJSON") or data.get("gjDownloadURL")
    )
    if not isinstance(download, str) or data["boundaryType"] != level:
        raise provider_schema_error("geoBoundaries metadata has no usable GeoJSON link")
    return LayerMetadata(
        level=level,
        boundary_id=data["boundaryID"],
        boundary_source=data["boundarySource"],
        boundary_year_represented=data["boundaryYearRepresented"],
        build_date=data["buildDate"],
        license=data["boundaryLicense"],
        license_source=data["licenseSource"],
        metadata_url=url,
        download_url=download,
    )


def _check_features(features: Any) -> list[dict[str, Any]]:
    if not isinstance(features, list) or not features:
        raise provider_schema_error("geoBoundaries GeoJSON has no features")
    for feature in features:
        properties = feature.get("properties") if isinstance(feature, dict) else None
        if not isinstance(properties, dict) or not all(
            isinstance(properties.get(k), str) for k in ("shapeID", "shapeName")
        ):
            raise provider_schema_error("geoBoundaries feature lacks shapeID or shapeName")
    return features


def parse_features(raw: bytes) -> list[dict[str, Any]]:
    data = _json(raw)
    return _check_features(data.get("features") if isinstance(data, dict) else None)


def decode_topojson(raw: bytes) -> list[dict[str, Any]]:
    """TopoJSON (quantisiert, delta-kodierte Bögen) -> GeoJSON-Features, reines Python.

    Unterstützt das eine GeometryCollection-Objekt, das geoBoundaries liefert, mit Polygon- und
    MultiPolygon-Geometrien. Negativer Bogenindex i heißt Bogen ~i rückwärts.
    """
    data = _json(raw)
    try:
        scale_x, scale_y = data["transform"]["scale"]
        shift_x, shift_y = data["transform"]["translate"]
        arcs: list[list[list[float]]] = []
        for arc in data["arcs"]:
            x = y = 0
            points: list[list[float]] = []
            for dx, dy in arc:
                x += dx
                y += dy
                points.append([x * scale_x + shift_x, y * scale_y + shift_y])
            arcs.append(points)
        (collection,) = data["objects"].values()
        geometries = collection["geometries"]

        def ring(indices: list[int]) -> list[list[float]]:
            out: list[list[float]] = []
            for index in indices:
                points = arcs[index] if index >= 0 else arcs[~index][::-1]
                out.extend(points if not out else points[1:])
            return out

        features: list[dict[str, Any]] = []
        for geometry in geometries:
            kind = geometry["type"]
            if kind == "Polygon":
                coordinates: Any = [ring(r) for r in geometry["arcs"]]
            elif kind == "MultiPolygon":
                coordinates = [[ring(r) for r in polygon] for polygon in geometry["arcs"]]
            else:
                raise provider_schema_error(f"unsupported TopoJSON geometry {kind!r}")
            features.append(
                {
                    "type": "Feature",
                    "properties": geometry.get("properties"),
                    "geometry": {"type": kind, "coordinates": coordinates},
                }
            )
    except (KeyError, TypeError, ValueError, IndexError) as exc:
        raise provider_schema_error("geoBoundaries returned invalid TopoJSON") from exc
    return _check_features(features)


async def fetch_layer(
    client: httpx.AsyncClient, country_iso3: str, level: str, fmt: GeometryFormat = "geojson"
) -> Layer:
    url = metadata_url(country_iso3, level)
    meta = parse_metadata(await _get(client, url), level=level, url=url, fmt=fmt)
    raw = await _get(client, meta.download_url)
    features = decode_topojson(raw) if fmt == "topojson" else parse_features(raw)
    return Layer(metadata=meta, features=features)
