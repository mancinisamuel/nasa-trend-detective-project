"""Build the static globe data in apps/web/public/geo/ from Natural Earth (public domain).

Python standard library only. Run once from the repository root:

    python3 apps/web/scripts/split_admin1.py

The raw downloads go to /tmp/td-natural-earth/ and never into the repository. Output:

- public/geo/countries.json: Admin-0 countries 1:50m, properties NAME, ADM0_A3, CONTINENT.
  Features with CONTINENT "Seven seas (open ocean)" are dropped, as are parts smaller than
  MIN_COUNTRY_PART_AREA (except each country's largest part).
- public/geo/admin1/<ADM0_A3>.json: Admin-1 1:10m, one file per country, properties
  name, adm0_a3, iso_3166_2.

Files are keyed by ADM0_A3, not ISO_A3: ISO_A3 is "-99" for Kosovo, Northern Cyprus,
Somaliland and Siachen, and admin_1 carries the same code as adm0_a3, so the join is 1:1.
Coordinates are rounded and simplified (Douglas-Peucker) to keep the repository small.
"""

from __future__ import annotations

import json
import shutil
import sys
import urllib.request
from pathlib import Path

NE_COMMIT = "ca96624a56bd078437bca8184e78163e5039ad19"
NE_BASE = f"https://raw.githubusercontent.com/nvkelso/natural-earth-vector/{NE_COMMIT}/geojson"
COUNTRIES_FILE = "ne_50m_admin_0_countries.geojson"
ADMIN1_FILE = "ne_10m_admin_1_states_provinces.geojson"

RAW_DIR = Path("/tmp/td-natural-earth")
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "geo"

DROPPED_CONTINENTS = {"Seven seas (open ocean)"}
DECIMALS = 3
COUNTRY_TOLERANCE = 0.02  # degrees, Douglas-Peucker
ADMIN1_TOLERANCE = 0.01
# Globe performance: every part of a MultiPolygon becomes its own mesh (cap, side, stroke) in
# three-globe. Country parts smaller than this (square degrees) are dropped, except each country's
# largest part, so small islands disappear from the globe but every country stays clickable.
MIN_COUNTRY_PART_AREA = 0.1

Point = list[float]
Ring = list[Point]


def download(name: str) -> Path:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    target = RAW_DIR / name
    if not target.exists():
        print(f"downloading {name}", file=sys.stderr)
        with urllib.request.urlopen(f"{NE_BASE}/{name}") as response, target.open("wb") as out:
            shutil.copyfileobj(response, out)
    return target


def _perpendicular_distance(p: Point, a: Point, b: Point) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    if dx == 0 and dy == 0:
        return ((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2) ** 0.5
    return abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / (dx * dx + dy * dy) ** 0.5


def simplify_line(points: Ring, tolerance: float) -> Ring:
    """Iterative Douglas-Peucker; keeps the first and last point."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        best, index = 0.0, -1
        for i in range(start + 1, end):
            distance = _perpendicular_distance(points[i], points[start], points[end])
            if distance > best:
                best, index = distance, i
        if index != -1 and best > tolerance:
            keep[index] = True
            stack.append((start, index))
            stack.append((index, end))
    return [p for p, k in zip(points, keep) if k]


def simplify_ring(ring: Ring, tolerance: float) -> Ring | None:
    rounded: Ring = []
    for lng, lat in ((p[0], p[1]) for p in ring):
        point = [round(lng, DECIMALS), round(lat, DECIMALS)]
        if not rounded or rounded[-1] != point:
            rounded.append(point)
    simplified = simplify_line(rounded, tolerance)
    if simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    # A ring needs at least 3 distinct points; tiny islands below the tolerance keep their rounded shape.
    if len(simplified) < 4:
        simplified = rounded if len(rounded) >= 4 else []
    return simplified or None


def ring_area(ring: Ring) -> float:
    total = 0.0
    for i, point in enumerate(ring):
        nxt = ring[(i + 1) % len(ring)]
        total += point[0] * nxt[1] - nxt[0] * point[1]
    return abs(total) / 2


def drop_small_parts(geometry: dict, min_area: float) -> dict:
    if geometry["type"] != "MultiPolygon":
        return geometry
    parts = geometry["coordinates"]
    largest = max(parts, key=lambda polygon: ring_area(polygon[0]))
    kept = [polygon for polygon in parts if polygon is largest or ring_area(polygon[0]) >= min_area]
    return {"type": "MultiPolygon", "coordinates": kept}


def simplify_geometry(geometry: dict, tolerance: float) -> dict | None:
    polygons = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    result = []
    for polygon in polygons:
        rings = [simplify_ring(ring, tolerance) for ring in polygon]
        if rings[0] is None:
            continue
        result.append([ring for ring in rings if ring is not None])
    if not result:
        return None
    if len(result) == 1:
        return {"type": "Polygon", "coordinates": result[0]}
    return {"type": "MultiPolygon", "coordinates": result}


def write_json(path: Path, features: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    collection = {"type": "FeatureCollection", "features": features}
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


def build_countries() -> None:
    raw = json.loads(download(COUNTRIES_FILE).read_text(encoding="utf-8"))
    features = []
    for feature in raw["features"]:
        props = feature["properties"]
        if props["CONTINENT"] in DROPPED_CONTINENTS:
            continue
        geometry = simplify_geometry(
            drop_small_parts(feature["geometry"], MIN_COUNTRY_PART_AREA), COUNTRY_TOLERANCE
        )
        if geometry is None:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "NAME": props["NAME"],
                    "ADM0_A3": props["ADM0_A3"],
                    "CONTINENT": props["CONTINENT"],
                },
                "geometry": geometry,
            }
        )
    write_json(OUT_DIR / "countries.json", features)
    print(f"countries.json: {len(features)} features", file=sys.stderr)


def build_admin1() -> None:
    raw = json.loads(download(ADMIN1_FILE).read_text(encoding="utf-8"))
    by_country: dict[str, list[dict]] = {}
    for feature in raw["features"]:
        props = feature["properties"]
        geometry = simplify_geometry(feature["geometry"], ADMIN1_TOLERANCE)
        if geometry is None:
            continue
        by_country.setdefault(props["adm0_a3"], []).append(
            {
                "type": "Feature",
                "properties": {
                    "name": props["name"],
                    "adm0_a3": props["adm0_a3"],
                    "iso_3166_2": props["iso_3166_2"],
                },
                "geometry": geometry,
            }
        )
    out = OUT_DIR / "admin1"
    if out.exists():
        shutil.rmtree(out)
    for code, features in sorted(by_country.items()):
        write_json(out / f"{code}.json", features)
    print(f"admin1/: {len(by_country)} files", file=sys.stderr)
    austria = len(by_country.get("AUT", []))
    if austria != 9:
        raise SystemExit(f"expected 9 Austrian states, got {austria}")


if __name__ == "__main__":
    build_countries()
    build_admin1()
