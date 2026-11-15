"""POWER-Rasterzellen eines Polygons mit Flächengewicht (B-STATEAREA).

Annahme: Die freigeschalteten Variablen (T2M, PRECTOTCORR, RH2M, WS2M) kommen aus MERRA-2,
Raster 0,5° Breite mal 0,625° Länge, Rasterpunkte bei -90 + 0,5·i bzw. -180 + 0,625·j; die
Zelle liegt symmetrisch um den Rasterpunkt. Gewicht = Fläche(Zelle ∩ Polygon) in Quadratgrad
mal cos(Breite), normiert auf Summe 1. Splitter unter MIN_WEIGHT (Grenzrauschen der vereinfachten
Polygone, je ein POWER-Abruf) fallen weg; danach erneut auf 1 normiert.
"""

import math
from dataclasses import dataclass

from trend_detective.domain import geometry as geo

LAT_STEP = 0.5
LON_STEP = 0.625
MIN_WEIGHT = 0.001


@dataclass(frozen=True)
class GridCell:
    latitude: float
    longitude: float
    weight: float


def grid_cells(polygons: geo.MultiPolygon) -> list[GridCell]:
    """Alle Rasterzellen mit positiver Schnittfläche, Gewichte summieren auf 1."""
    box = geo.bbox(polygons)
    i_min = math.floor((box.min_y + 90) / LAT_STEP - 0.5)
    i_max = math.ceil((box.max_y + 90) / LAT_STEP + 0.5)
    j_min = math.floor((box.min_x + 180) / LON_STEP - 0.5)
    j_max = math.ceil((box.max_x + 180) / LON_STEP + 0.5)
    raw: list[tuple[float, float, float]] = []
    for i in range(i_min, i_max + 1):
        lat = round(-90 + i * LAT_STEP, 4)
        for j in range(j_min, j_max + 1):
            lon = round(-180 + j * LON_STEP, 4)
            cell = geo.BBox(
                lon - LON_STEP / 2, lat - LAT_STEP / 2, lon + LON_STEP / 2, lat + LAT_STEP / 2
            )
            share = geo.clipped_area(polygons, cell) * math.cos(math.radians(lat))
            if share > 0:
                raw.append((lat, lon, share))
    total = sum(share for _, _, share in raw)
    if total <= 0:
        raise ValueError("polygon does not intersect any grid cell")
    raw = [item for item in raw if item[2] / total >= MIN_WEIGHT]
    total = sum(share for _, _, share in raw)
    return [GridCell(latitude=lat, longitude=lon, weight=s / total) for lat, lon, s in raw]
