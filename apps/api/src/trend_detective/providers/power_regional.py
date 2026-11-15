"""NASA POWER regional: Zellwerte der Flächenmittel kachelweise statt je Zelle (B-REGIONAL).

Kacheln liegen auf einem festen globalen Raster aus TILE_ROWS x TILE_COLS POWER-Zellen
(3,5° x 3,75° zwischen den Zellzentren, mit Rand unter 4°), damit benachbarte Bundesländer
und States dieselbe Kachel und denselben Cache-Eintrag nutzen. Abgefragt werden nur Kacheln mit
benötigten Zellen. Abfragebox = Zellzentren +- REQUEST_MARGIN_DEG, mindestens MIN_BOX_DEG je
Seite (kleinere Boxen lehnt POWER laut Drittquellen ab). Features werden über den gerundeten
Rasterindex ihrer Koordinate (power_grid: -90 + 0,5·i, -180 + 0,625·j) einer Zelle zugeordnet;
fremde Zellen werden ignoriert, eine fehlende benötigte Zelle ist ein Schemafehler.
HTTP 422 -> Kachel halbieren, solange die Box dadurch kleiner wird (Untergrenze: eine Zelle bzw.
Mindestbox). HTTP 429 bricht im PowerProvider ohne Retry ab; gather_or_cancel stoppt den Rest.
"""

import logging
from collections.abc import Awaitable, Callable, Iterable
from dataclasses import dataclass
from typing import Any, Final

from pydantic import JsonValue

from trend_detective.api.cancel import gather_or_cancel
from trend_detective.api.errors import ApiError, provider_schema_error
from trend_detective.domain.power_grid import LAT_STEP, LON_STEP
from trend_detective.providers.normalize_power import _finite_number, _object

logger = logging.getLogger(__name__)

TILE_ROWS: Final = 8
TILE_COLS: Final = 7
MAX_TILE_DEG: Final = 4.0
MIN_BOX_DEG: Final = 2.0
REQUEST_MARGIN_DEG: Final = 0.1
GRID_TOLERANCE_DEG: Final = 0.01

Index = tuple[int, int]


@dataclass(frozen=True)
class Box:
    latitude_min: float
    latitude_max: float
    longitude_min: float
    longitude_max: float


def box_fields(box: Box) -> dict[str, JsonValue]:
    return {
        "latitude_min": box.latitude_min,
        "latitude_max": box.latitude_max,
        "longitude_min": box.longitude_min,
        "longitude_max": box.longitude_max,
    }


def _span(low: float, high: float, floor: float, ceiling: float) -> tuple[float, float]:
    """Zellzentren low..high plus Rand, mindestens MIN_BOX_DEG, innerhalb floor..ceiling."""
    low, high = low - REQUEST_MARGIN_DEG, high + REQUEST_MARGIN_DEG
    if high - low < MIN_BOX_DEG:
        middle = (low + high) / 2
        low, high = middle - MIN_BOX_DEG / 2, middle + MIN_BOX_DEG / 2
    if low < floor:
        low, high = floor, high + (floor - low)
    if high > ceiling:
        low, high = low - (high - ceiling), ceiling
    return round(max(low, floor), 4), round(min(high, ceiling), 4)


@dataclass(frozen=True)
class Tile:
    """Rechteck aus Rasterindizes, Grenzen inklusive."""

    i_min: int
    i_max: int
    j_min: int
    j_max: int

    def contains(self, index: Index) -> bool:
        i, j = index
        return self.i_min <= i <= self.i_max and self.j_min <= j <= self.j_max

    def box(self) -> Box:
        lat_min, lat_max = _span(
            -90 + self.i_min * LAT_STEP, -90 + self.i_max * LAT_STEP, -90.0, 90.0
        )
        lon_min, lon_max = _span(
            -180 + self.j_min * LON_STEP, -180 + self.j_max * LON_STEP, -180.0, 180.0
        )
        return Box(lat_min, lat_max, lon_min, lon_max)


def cell_index(latitude: float, longitude: float) -> Index | None:
    """Rasterindex (i, j); None, wenn die Koordinate nicht auf einem Zellzentrum liegt."""
    i = round((latitude + 90) / LAT_STEP)
    j = round((longitude + 180) / LON_STEP)
    if (
        abs(-90 + i * LAT_STEP - latitude) > GRID_TOLERANCE_DEG
        or abs(-180 + j * LON_STEP - longitude) > GRID_TOLERANCE_DEG
    ):
        return None
    return i, j


def require_index(latitude: float, longitude: float) -> Index:
    index = cell_index(latitude, longitude)
    if index is None:
        raise ValueError(f"not a POWER grid cell centre: {latitude}, {longitude}")
    return index


def cell_centre(index: Index) -> tuple[float, float]:
    """Zellzentrum, gerundet wie power_grid.grid_cells."""
    i, j = index
    return round(-90 + i * LAT_STEP, 4), round(-180 + j * LON_STEP, 4)


def plan_tiles(needed: Iterable[Index]) -> list[Tile]:
    """Feste globale Kacheln, die mindestens eine benötigte Zelle enthalten."""
    keys = sorted({(i // TILE_ROWS, j // TILE_COLS) for i, j in needed})
    return [
        Tile(a * TILE_ROWS, (a + 1) * TILE_ROWS - 1, b * TILE_COLS, (b + 1) * TILE_COLS - 1)
        for a, b in keys
    ]


def split_tile(tile: Tile, needed: Iterable[Index]) -> list[Tile] | None:
    """Halbiert die längere Seite; None, wenn die Abfragebox dadurch nicht kleiner würde."""
    box = tile.box()
    lat_extent = box.latitude_max - box.latitude_min
    lon_extent = box.longitude_max - box.longitude_min
    rows = tile.i_max - tile.i_min + 1
    cols = tile.j_max - tile.j_min + 1
    can_rows = rows > 1 and lat_extent > MIN_BOX_DEG
    can_cols = cols > 1 and lon_extent > MIN_BOX_DEG
    if can_cols and (lon_extent >= lat_extent or not can_rows):
        mid = tile.j_min + cols // 2
        halves = [
            Tile(tile.i_min, tile.i_max, tile.j_min, mid - 1),
            Tile(tile.i_min, tile.i_max, mid, tile.j_max),
        ]
    elif can_rows:
        mid = tile.i_min + rows // 2
        halves = [
            Tile(tile.i_min, mid - 1, tile.j_min, tile.j_max),
            Tile(mid, tile.i_max, tile.j_min, tile.j_max),
        ]
    else:
        return None
    wanted = list(needed)
    return [half for half in halves if any(half.contains(cell) for cell in wanted)]


def features_by_cell(doc: dict[str, Any]) -> dict[Index, dict[str, Any]]:
    features = doc.get("features")
    if not isinstance(features, list):
        raise provider_schema_error("Provider response has no features list")
    result: dict[Index, dict[str, Any]] = {}
    for position, item in enumerate(features):
        where = f"features[{position}]"
        feature = _object(item, where)
        coordinates = _object(feature.get("geometry"), f"{where}.geometry").get("coordinates")
        if not isinstance(coordinates, list) or len(coordinates) < 2:
            raise provider_schema_error("Provider feature has no [longitude, latitude]")
        longitude = _finite_number(coordinates[0], f"{where}.geometry.coordinates[0]")
        latitude = _finite_number(coordinates[1], f"{where}.geometry.coordinates[1]")
        index = cell_index(latitude, longitude)
        if index is None:
            continue
        if index in result:
            raise provider_schema_error(
                f"Duplicate grid cell in provider response: {latitude}, {longitude}"
            )
        result[index] = feature
    return result


def pick_cells(doc: dict[str, Any], wanted: Iterable[Index]) -> dict[Index, dict[str, Any]]:
    """Features der benötigten Zellen; fehlt eine, Schemafehler (nie still auffüllen)."""
    features = features_by_cell(doc)
    wanted = list(wanted)
    missing = [index for index in wanted if index not in features]
    if missing:
        latitude, longitude = cell_centre(missing[0])
        raise provider_schema_error(
            f"Provider response lacks {len(missing)} grid cell(s), e.g. {latitude}, {longitude}"
        )
    return {index: features[index] for index in wanted}


def _rejected(error: ApiError) -> bool:
    return error.details is not None and error.details.get("provider_status") == 422


async def collect_tiles[T](
    needed: Iterable[Index],
    load: Callable[[Tile, list[Index]], Awaitable[dict[Index, T]]],
) -> dict[Index, T]:
    """Alle benötigten Zellen über Kacheln laden; 422 -> Kachel halbieren und erneut."""
    wanted = set(needed)

    async def fetch(tile: Tile) -> dict[Index, T]:
        cells = sorted(cell for cell in wanted if tile.contains(cell))
        try:
            return await load(tile, cells)
        except ApiError as error:
            halves = split_tile(tile, cells) if _rejected(error) else None
            if halves is None:
                raise
            logger.info("POWER rejected regional tile %s (HTTP 422), splitting", tile)
            parts = await gather_or_cancel(fetch(half) for half in halves)
            return {index: value for part in parts for index, value in part.items()}

    parts = await gather_or_cancel(fetch(tile) for tile in plan_tiles(wanted))
    return {index: value for part in parts for index, value in part.items()}
