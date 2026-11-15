/**
 * Flat projection for the 2D country map (level 3): equirectangular, longitudes compressed by
 * cos(mid latitude of the country), longitudes unwrapped around the country's centre so countries
 * across the antimeridian (Russia, Fiji) stay in one piece. No dependency, no curvature.
 */

import {
  boundingBox,
  largestRing,
  type CountryFeature,
  type PolygonGeometry,
  type Position,
} from "./globeLevels";

export type Projection = {
  /** Centre longitude every longitude is unwrapped around. */
  centerLng: number;
  /** Latitude the cos() correction is taken at. */
  midLat: number;
  /** cos(midLat): horizontal scale. */
  kx: number;
};

export type ViewBox = { x: number; y: number; width: number; height: number };

const PADDING = 0.06;

/** Projection and frame from the country's largest part, so overseas parts do not set the frame. */
export function projectionForCountry(country: CountryFeature): {
  projection: Projection;
  viewBox: ViewBox;
} {
  return projectionForGeometry(country.geometry);
}

/** Projection and frame from a geometry's largest part (country map, state map E-43). */
export function projectionForGeometry(geometry: PolygonGeometry): {
  projection: Projection;
  viewBox: ViewBox;
} {
  const ring = largestRing(geometry);
  const box = boundingBox(ring);
  const midLat = box.south + box.height / 2;
  const projection: Projection = {
    centerLng: box.west + box.width / 2,
    midLat,
    kx: Math.cos((midLat * Math.PI) / 180),
  };
  const points = ring.map((position) => project(projection, position));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = Math.max(maxX - minX, maxY - minY) * PADDING;
  return {
    projection,
    viewBox: {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + 2 * pad,
      height: maxY - minY + 2 * pad,
    },
  };
}

/** [lng, lat] -> [x, y] in SVG units (degrees of latitude); y grows downwards. */
export function project(
  projection: Projection,
  [lng = 0, lat = 0]: Position,
): [number, number] {
  let delta = lng - projection.centerLng;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return [delta * projection.kx, -lat];
}

/**
 * Projects a ring and keeps it continuous: each longitude is unwrapped relative to the previous
 * point, so a neighbouring country that crosses the seam opposite the centre does not jump.
 */
export function projectRing(
  projection: Projection,
  ring: readonly Position[],
): [number, number][] {
  const points: [number, number][] = [];
  let previousLng: number | null = null;
  let previousX = 0;
  for (const position of ring) {
    const [lng = 0, lat = 0] = position;
    if (previousLng === null) {
      previousX = project(projection, position)[0];
    } else {
      let step = lng - previousLng;
      while (step > 180) step -= 360;
      while (step < -180) step += 360;
      previousX += step * projection.kx;
    }
    previousLng = lng;
    points.push([previousX, -lat]);
  }
  return points;
}

function rings(geometry: PolygonGeometry): readonly (readonly Position[])[] {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flat();
}

function intersects(
  points: readonly [number, number][],
  { x, y, width, height }: ViewBox,
): boolean {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [px, py] of points) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  return minX <= x + width && maxX >= x && minY <= y + height && maxY >= y;
}

/**
 * Other countries whose projected extent overlaps the frame, in the chosen country's projection.
 * The SVG viewBox crops them to the frame.
 */
export function countriesInView(
  projection: Projection,
  viewBox: ViewBox,
  countries: readonly CountryFeature[],
  except: string,
): CountryFeature[] {
  return countries.filter(
    (feature) =>
      feature.properties.ADM0_A3 !== except &&
      rings(feature.geometry).some((ring) =>
        intersects(projectRing(projection, ring), viewBox),
      ),
  );
}

function round(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** SVG path data for a (Multi)Polygon; rings are closed, holes use the even-odd rule. */
export function pathData(
  projection: Projection,
  geometry: PolygonGeometry,
): string {
  return rings(geometry)
    .map((ring) => {
      const points = projectRing(projection, ring);
      return `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join("L")}Z`;
    })
    .join("");
}

export function viewBoxAttribute({ x, y, width, height }: ViewBox): string {
  return [x, y, width, height].map(round).join(" ");
}

type Point = [number, number];

/** Sutherland-Hodgman: the part of a ring inside an axis-aligned frame. */
function clipToFrame(points: readonly Point[], frame: ViewBox): Point[] {
  const edges: [(p: Point) => boolean, (a: Point, b: Point) => Point][] = [
    [
      ([x]) => x >= frame.x,
      (a, b) => along(a, b, (frame.x - a[0]) / (b[0] - a[0])),
    ],
    [
      ([x]) => x <= frame.x + frame.width,
      (a, b) => along(a, b, (frame.x + frame.width - a[0]) / (b[0] - a[0])),
    ],
    [
      ([, y]) => y >= frame.y,
      (a, b) => along(a, b, (frame.y - a[1]) / (b[1] - a[1])),
    ],
    [
      ([, y]) => y <= frame.y + frame.height,
      (a, b) => along(a, b, (frame.y + frame.height - a[1]) / (b[1] - a[1])),
    ],
  ];
  let output: Point[] = [...points];
  for (const [inside, cut] of edges) {
    const input = output;
    output = [];
    input.forEach((current, index) => {
      const previous = input[(index + input.length - 1) % input.length];
      if (previous === undefined) return;
      if (inside(current)) {
        if (!inside(previous)) output.push(cut(previous, current));
        output.push(current);
      } else if (inside(previous)) {
        output.push(cut(previous, current));
      }
    });
  }
  return output;
}

function along(a: Point, b: Point, share: number): Point {
  return [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share];
}

/** Area centroid of a closed polygon; the mean of its points if it has no area. */
function centroid(points: readonly Point[]): Point | null {
  if (points.length === 0) return null;
  let area = 0;
  let cx = 0;
  let cy = 0;
  points.forEach(([x0, y0], index) => {
    const [x1, y1] = points[(index + 1) % points.length] ?? [x0, y0];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  });
  if (Math.abs(area) < 1e-12) {
    const sum = points.reduce<Point>(
      ([sx, sy], [x, y]) => [sx + x, sy + y],
      [0, 0],
    );
    return [sum[0] / points.length, sum[1] / points.length];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

function inside([px, py]: Point, polygon: readonly Point[]): boolean {
  let result = false;
  polygon.forEach(([x0, y0], index) => {
    const [x1, y1] = polygon[(index + 1) % polygon.length] ?? [x0, y0];
    if (y0 > py !== y1 > py && px < ((x1 - x0) * (py - y0)) / (y1 - y0) + x0) {
      result = !result;
    }
  });
  return result;
}

function distanceToEdges([px, py]: Point, polygon: readonly Point[]): number {
  let best = Infinity;
  polygon.forEach(([x0, y0], index) => {
    const [x1, y1] = polygon[(index + 1) % polygon.length] ?? [x0, y0];
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = dx * dx + dy * dy;
    const share =
      length === 0
        ? 0
        : Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / length));
    best = Math.min(
      best,
      Math.hypot(px - (x0 + share * dx), py - (y0 + share * dy)),
    );
  });
  return best;
}

const LABEL_GRID = 24;

/**
 * Anchor for a text label on a country (E-32): the point deepest inside the part of its largest
 * polygon that lies in the frame (coarse grid search), so a neighbour cut by the frame or with a
 * narrow arm gets its label on the visible bulk. Falls back to the centroid.
 */
export function labelPoint(
  projection: Projection,
  geometry: PolygonGeometry,
  frame: ViewBox,
): Point {
  const ring = projectRing(projection, largestRing(geometry));
  const visible = clipToFrame(ring, frame);
  let best: Point | null = null;
  let bestDistance = 0;
  if (visible.length >= 3) {
    const xs = visible.map(([x]) => x);
    const ys = visible.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const stepX = (Math.max(...xs) - minX) / LABEL_GRID;
    const stepY = (Math.max(...ys) - minY) / LABEL_GRID;
    for (let i = 0; i <= LABEL_GRID; i += 1) {
      for (let j = 0; j <= LABEL_GRID; j += 1) {
        const point: Point = [minX + i * stepX, minY + j * stepY];
        if (!inside(point, visible)) continue;
        const distance = distanceToEdges(point, visible);
        if (distance > bestDistance) {
          best = point;
          bestDistance = distance;
        }
      }
    }
  }
  return (
    best ??
    centroid(visible) ??
    centroid(ring) ?? [frame.x + frame.width / 2, frame.y + frame.height / 2]
  );
}
