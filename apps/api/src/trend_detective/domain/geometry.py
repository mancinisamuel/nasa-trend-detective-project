"""Reine Python-Geometrie für GeoJSON-Polygone in Grad (CRS84, [lon, lat]).

Nur Orientierungsgeometrie (Brief §14): planare Rechnung in Grad, keine Flächentreue.
Enthält Douglas-Peucker-Vereinfachung, Bounding-Box, Flächenschwerpunkt und Punkt-in-Polygon.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from itertools import pairwise
from typing import Any

Position = tuple[float, float]
Ring = list[Position]
Polygon = list[Ring]
"""Erster Ring außen, weitere Ringe Löcher."""
MultiPolygon = list[Polygon]


class GeometryError(ValueError):
    """Geometrie entspricht nicht GeoJSON Polygon/MultiPolygon."""


@dataclass(frozen=True)
class BBox:
    min_x: float
    min_y: float
    max_x: float
    max_y: float

    def contains(self, point: Position) -> bool:
        x, y = point
        return self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y


def _position(value: Any) -> Position:
    if (
        not isinstance(value, list | tuple)
        or len(value) < 2
        or not all(isinstance(c, int | float) and not isinstance(c, bool) for c in value[:2])
    ):
        raise GeometryError("position must be [lon, lat]")
    return (float(value[0]), float(value[1]))


def _ring(value: Any) -> Ring:
    if not isinstance(value, list) or len(value) < 4:
        raise GeometryError("linear ring needs at least 4 positions")
    ring = [_position(p) for p in value]
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _polygon(value: Any) -> Polygon:
    if not isinstance(value, list) or not value:
        raise GeometryError("polygon needs at least one ring")
    return [_ring(r) for r in value]


def parse_geometry(geometry: Any) -> MultiPolygon:
    """GeoJSON Polygon oder MultiPolygon -> Liste von Polygonen."""
    if not isinstance(geometry, dict):
        raise GeometryError("geometry must be an object")
    kind = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if kind == "Polygon":
        return [_polygon(coordinates)]
    if kind == "MultiPolygon":
        if not isinstance(coordinates, list) or not coordinates:
            raise GeometryError("multipolygon needs at least one polygon")
        return [_polygon(p) for p in coordinates]
    raise GeometryError(f"unsupported geometry type {kind!r}")


def bbox(polygons: MultiPolygon) -> BBox:
    xs = [x for polygon in polygons for x, _ in polygon[0]]
    ys = [y for polygon in polygons for _, y in polygon[0]]
    return BBox(min(xs), min(ys), max(xs), max(ys))


def ring_signed_area(ring: Sequence[Position]) -> float:
    return 0.5 * sum(x0 * y1 - x1 * y0 for (x0, y0), (x1, y1) in pairwise(ring))


def _ring_moments(ring: Sequence[Position]) -> tuple[float, float, float]:
    """(|Fläche|, Σx, Σy) für den Schwerpunkt; Vorzeichen unabhängig von der Umlaufrichtung."""
    area2 = 0.0
    cx = 0.0
    cy = 0.0
    for (x0, y0), (x1, y1) in pairwise(ring):
        cross = x0 * y1 - x1 * y0
        area2 += cross
        cx += (x0 + x1) * cross
        cy += (y0 + y1) * cross
    sign = 1.0 if area2 >= 0 else -1.0
    return abs(area2) / 2, sign * cx / 6, sign * cy / 6


def area(polygons: MultiPolygon) -> float:
    """Planare Fläche in Quadratgrad (Löcher abgezogen)."""
    total = 0.0
    for polygon in polygons:
        total += abs(ring_signed_area(polygon[0]))
        total -= sum(abs(ring_signed_area(hole)) for hole in polygon[1:])
    return total


def centroid(polygons: MultiPolygon) -> Position:
    """Flächenschwerpunkt (Löcher abgezogen); bei Fläche 0 Mittel der Außenring-Punkte."""
    total = 0.0
    sx = 0.0
    sy = 0.0
    for polygon in polygons:
        for index, ring in enumerate(polygon):
            a, mx, my = _ring_moments(ring)
            sign = 1.0 if index == 0 else -1.0
            total += sign * a
            sx += sign * mx
            sy += sign * my
    if total <= 0:
        points = [p for polygon in polygons for p in polygon[0][:-1]]
        return (sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points))
    return (sx / total, sy / total)


def point_in_ring(point: Position, ring: Sequence[Position]) -> bool:
    """Ray Casting (gerade/ungerade Regel)."""
    x, y = point
    inside = False
    for (x0, y0), (x1, y1) in pairwise(ring):
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            inside = not inside
    return inside


def point_in_polygons(point: Position, polygons: MultiPolygon) -> bool:
    return any(
        point_in_ring(point, polygon[0])
        and not any(point_in_ring(point, hole) for hole in polygon[1:])
        for polygon in polygons
    )


def representative_point(polygons: MultiPolygon) -> Position:
    """Ein Punkt sicher im Inneren: Schwerpunkt, falls innen; sonst Mitte des breitesten
    Innenabschnitts der Waagrechten durch den Schwerpunkt bzw. durch das größte Teilpolygon."""
    center = centroid(polygons)
    if point_in_polygons(center, polygons):
        return center
    largest = max(polygons, key=lambda p: abs(ring_signed_area(p[0])))
    box = bbox([largest])
    for y in (center[1], (box.min_y + box.max_y) / 2):
        best = _widest_inner_span(largest, y)
        if best is not None:
            return best
    return largest[0][0]


def _widest_inner_span(polygon: Polygon, y: float) -> Position | None:
    crossings: list[float] = []
    for ring in polygon:
        for (x0, y0), (x1, y1) in pairwise(ring):
            if (y0 > y) != (y1 > y):
                crossings.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    crossings.sort()
    spans = [(crossings[i], crossings[i + 1]) for i in range(0, len(crossings) - 1, 2)]
    if not spans:
        return None
    left, right = max(spans, key=lambda s: s[1] - s[0])
    return ((left + right) / 2, y)


def _perpendicular_distance(point: Position, start: Position, end: Position) -> float:
    (x, y), (x0, y0), (x1, y1) = point, start, end
    dx = x1 - x0
    dy = y1 - y0
    length2 = dx * dx + dy * dy
    if length2 == 0:
        return float(((x - x0) ** 2 + (y - y0) ** 2) ** 0.5)
    t = max(0.0, min(1.0, ((x - x0) * dx + (y - y0) * dy) / length2))
    return float(((x - x0 - t * dx) ** 2 + (y - y0 - t * dy) ** 2) ** 0.5)


def douglas_peucker(points: Sequence[Position], tolerance: float) -> list[Position]:
    """Iteratives Douglas-Peucker für eine offene Linie; Endpunkte bleiben erhalten."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        index = -1
        max_distance = tolerance
        for i in range(first + 1, last):
            distance = _perpendicular_distance(points[i], points[first], points[last])
            if distance > max_distance:
                index = i
                max_distance = distance
        if index != -1:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep, strict=True) if k]


def _round_ring(ring: Iterable[Position], digits: int) -> Ring:
    out: Ring = []
    for x, y in ring:
        point = (round(x, digits), round(y, digits))
        if not out or out[-1] != point:
            out.append(point)
    return out


def simplify_ring(ring: Ring, tolerance: float, digits: int) -> Ring | None:
    """Geschlossenen Ring vereinfachen und runden; None, wenn er zu weniger als 4 Punkten
    zerfällt. Der Ring wird am vom Startpunkt entferntesten Punkt geteilt, damit die
    Vereinfachung nicht an einer Strecke der Länge 0 hängt."""
    start = ring[0]
    far = max(
        range(len(ring)), key=lambda i: (ring[i][0] - start[0]) ** 2 + (ring[i][1] - start[1]) ** 2
    )
    if far == 0:
        return None
    head = douglas_peucker(ring[: far + 1], tolerance)
    tail = douglas_peucker(ring[far:], tolerance)
    rounded = _round_ring(head[:-1] + tail, digits)
    if rounded[0] != rounded[-1]:
        rounded.append(rounded[0])
    if len(rounded) < 4 or ring_signed_area(rounded) == 0:
        return None
    return rounded


def simplify(polygons: MultiPolygon, tolerance: float, digits: int) -> MultiPolygon:
    """Jedes Polygon vereinfachen. Zerfällt ein Außenring, wird die Toleranz schrittweise
    halbiert (kleine Gemeinden bleiben sichtbar); zerfallene Löcher fallen weg."""
    result: MultiPolygon = []
    for polygon in polygons:
        outer: Ring | None = None
        current = tolerance
        for _ in range(8):
            outer = simplify_ring(polygon[0], current, digits)
            if outer is not None:
                break
            current /= 2
        if outer is None:
            outer = simplify_ring(polygon[0], 0.0, digits)
        if outer is None:
            continue
        holes = [h for h in (simplify_ring(r, tolerance, digits) for r in polygon[1:]) if h]
        result.append([outer, *holes])
    if not result:
        raise GeometryError("geometry collapsed during simplification")
    return result


def to_geojson(polygons: MultiPolygon) -> dict[str, Any]:
    """Ein Teil -> Polygon, mehrere Teile -> MultiPolygon (Koordinaten als Listen)."""
    as_lists = [[[[x, y] for x, y in ring] for ring in polygon] for polygon in polygons]
    if len(as_lists) == 1:
        return {"type": "Polygon", "coordinates": as_lists[0]}
    return {"type": "MultiPolygon", "coordinates": as_lists}


def clip_ring_to_box(ring: Sequence[Position], box: BBox) -> Ring:
    """Sutherland-Hodgman: Ring an einem achsenparallelen Rechteck zuschneiden.

    Für konkave Ringe entstehen ggf. entartete Kanten auf dem Rand; die Fläche bleibt korrekt.
    Ergebnis geschlossen oder leer.
    """
    points = list(ring[:-1]) if ring and ring[0] == ring[-1] else list(ring)
    # (Achse 0=x/1=y, Grenze, innen ist >= Grenze)
    edges = (
        (0, box.min_x, True),
        (0, box.max_x, False),
        (1, box.min_y, True),
        (1, box.max_y, False),
    )
    for axis, bound, keep_above in edges:
        if not points:
            break
        source, points = points, []
        previous = source[-1]
        for current in source:
            current_in = (current[axis] >= bound) if keep_above else (current[axis] <= bound)
            previous_in = (previous[axis] >= bound) if keep_above else (previous[axis] <= bound)
            if current_in != previous_in:
                points.append(_cut(previous, current, axis, bound))
            if current_in:
                points.append(current)
            previous = current
    if len(points) < 3:
        return []
    return [*points, points[0]]


def _cut(a: Position, b: Position, axis: int, bound: float) -> Position:
    """Schnittpunkt der Strecke a-b mit der Geraden x=bound (axis 0) bzw. y=bound (axis 1)."""
    t = (bound - a[axis]) / (b[axis] - a[axis])
    if axis == 0:
        return (bound, a[1] + t * (b[1] - a[1]))
    return (a[0] + t * (b[0] - a[0]), bound)


def clipped_area(polygons: MultiPolygon, box: BBox) -> float:
    """Planare Fläche von (polygons ∩ box) in Quadratgrad, Löcher abgezogen."""
    total = 0.0
    for polygon in polygons:
        part = abs(ring_signed_area(clip_ring_to_box(polygon[0], box)))
        if part == 0:
            continue
        part -= sum(abs(ring_signed_area(clip_ring_to_box(h, box))) for h in polygon[1:])
        total += part
    return max(total, 0.0)
