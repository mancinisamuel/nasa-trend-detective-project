"""Response-Schemas für GET /api/v1/regions/{country_iso3}/{adm1_id} (E-42).

Nur Orientierungsgeometrie (Brief §14): Grenzen von Bundesland, Bezirken und Gemeinden,
keine Analysefläche. Koordinaten in GeoJSON-Reihenfolge [lon, lat], CRS84.
"""

import datetime as dt
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Position = Annotated[
    list[float], Field(min_length=2, max_length=2, description="[longitude, latitude] in degrees")
]


class RegionModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PolygonGeometry(RegionModel):
    type: Literal["Polygon"]
    coordinates: list[list[Position]]


class MultiPolygonGeometry(RegionModel):
    type: Literal["MultiPolygon"]
    coordinates: list[list[list[Position]]]


RegionGeometry = PolygonGeometry | MultiPolygonGeometry


class District(RegionModel):
    """ADM2 (Bezirk bzw. Statutarstadt, US-County)."""

    id: str = Field(description="geoBoundaries shapeID (ADM2)")
    name: str
    centroid: Position = Field(description="Point inside the district, [lon, lat]")
    geometry: RegionGeometry


class Municipality(RegionModel):
    """ADM3 (Gemeinde)."""

    id: str = Field(description="geoBoundaries shapeID (ADM3)")
    name: str
    district_id: str = Field(description="id of the containing district")
    centroid: Position = Field(description="Point inside the municipality, [lon, lat]")
    geometry: RegionGeometry


class BoundaryLayer(RegionModel):
    """Wortgetreue Metadaten einer geoBoundaries-Ebene."""

    level: Literal["ADM1", "ADM2", "ADM3"]
    boundary_id: str
    boundary_source: str
    boundary_year_represented: str
    build_date: str
    license: str
    license_source: str
    metadata_url: str
    download_url: str


class RegionSource(RegionModel):
    provider: Literal["geoBoundaries"]
    release_type: Literal["gbOpen"]
    attribution: str
    license: str
    url: str
    layers: list[BoundaryLayer] = Field(
        description="One entry per geoBoundaries level used: ADM1-ADM3 for AUT, ADM1-ADM2 for USA"
    )
    retrieved_at: dt.datetime = Field(description="UTC time of the geoBoundaries download")
    simplification: str = Field(description="How geometries were simplified for display")


class RegionResponse(RegionModel):
    country_iso3: Literal["AUT", "USA"]
    adm1_id: str = Field(
        description="ISO 3166-2 code, e.g. AT-2 or US-TX (matches Natural Earth iso_3166_2)"
    )
    name: str
    boundary: RegionGeometry
    districts: list[District] = Field(description="ADM2 units: Bezirke (AUT), counties (USA)")
    municipalities: list[Municipality] = Field(
        description="ADM3 units; always empty for USA (geoBoundaries has no ADM3 there)"
    )
    metadata: RegionSource


# --- GET /api/v1/regions/search (E-52a) ---

SearchHitType = Literal["municipality", "district", "state"]
Continent = Literal["Europe", "North America"]
"""Schreibweise wie CONTINENT in apps/web/public/geo/countries.json (Natural Earth)."""


class RegionSearchHit(RegionModel):
    type: SearchHitType = Field(
        description="municipality (ADM3), district (ADM2: Bezirk or US county) or state (ADM1)"
    )
    id: str = Field(
        description="geoBoundaries shapeID for municipality/district; ISO 3166-2 code for state"
    )
    name: str
    country_iso3: Literal["AUT", "USA"]
    adm1_id: str = Field(description="ISO 3166-2 code of the containing state, e.g. AT-2")
    adm1_name: str
    continent: Continent = Field(description="Natural Earth CONTINENT of the country")
    centroid: Position = Field(description="Point inside the unit, [lon, lat]")


class RegionSearchResponse(RegionModel):
    query: str = Field(description="The query as received")
    results: list[RegionSearchHit] = Field(
        description="Prefix matches before substring matches, then by name; at most `limit`"
    )
