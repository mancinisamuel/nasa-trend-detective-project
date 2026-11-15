/**
 * Pure logic of the 3D globe (task G1): navigation levels, which polygons each level shows,
 * and the fixed camera per level. No React, no three.js, so it is testable in jsdom.
 */

import { hasRegionView } from "../features/region/regionApi";

export type Position = readonly number[];
export type Ring = readonly Position[];

export type PolygonGeometry =
  | { type: "Polygon"; coordinates: readonly Ring[] }
  | { type: "MultiPolygon"; coordinates: readonly (readonly Ring[])[] };

/** Natural Earth Admin-0 1:50m, reduced by apps/web/scripts/split_admin1.py. */
export type CountryFeature = {
  type: "Feature";
  properties: { NAME: string; ADM0_A3: string; CONTINENT: string };
  geometry: PolygonGeometry;
};

/** Natural Earth Admin-1 1:10m, one file per ADM0_A3 under public/geo/admin1/. */
export type RegionFeature = {
  type: "Feature";
  properties: { name: string; adm0_a3: string; iso_3166_2: string };
  geometry: PolygonGeometry;
};

/**
 * An element the user picked on the globe, the country map, the state map or the sidebar (UI-SEL).
 * Geo data only; the compare feature turns it into a location. Positions are GeoJSON [lon, lat].
 */
export type MapPick =
  | { kind: "country"; name: string; geometry: PolygonGeometry }
  | {
      kind: "state";
      /** ISO 3166-2 code from Natural Earth, e.g. "AT-2". */
      iso: string;
      name: string;
      geometry: PolygonGeometry | null;
    }
  /** District, municipality or county from the region API, with its centroid [lon, lat]. */
  | { kind: "area"; id: string; name: string; centroid: readonly number[] };

export type GlobeLevel =
  | { kind: "continents" }
  | { kind: "countries"; continent: string }
  | {
      kind: "regions";
      continent: string;
      country: string;
      /** The country shown directly before a neighbour switch; highlighted on the map (E-28). */
      previous?: string;
    }
  /**
   * Level 4 (E-43): one state (admin-1) of a country with a state view, as a flat map of its
   * districts and municipalities. `adm1` is the ISO 3166-2 code, `name` the Natural Earth name.
   */
  | {
      kind: "state";
      continent: string;
      country: string;
      adm1: string;
      name: string;
    };

export type GlobeAction =
  | { type: "selectContinent"; continent: string }
  | { type: "selectCountry"; country: string }
  /** From the 2D map straight to a neighbour's 2D map; Back still leads to the globe. */
  | { type: "switchCountry"; continent: string; country: string }
  /** From the 2D country map into one of its states; only for SUPPORTED_REGION_COUNTRIES (E-43, E-49). */
  | { type: "selectState"; adm1: string; name: string }
  | { type: "back" }
  /** Path segment click (E-35): jump to the level at this depth of levelPath(); 0 is the globe. */
  | { type: "goTo"; depth: number }
  | { type: "reset" };

export type Camera = { lat: number; lng: number; altitude: number };

export const INITIAL_LEVEL: GlobeLevel = { kind: "continents" };

/** Drawn on the continent level but not selectable (architect decision G1). */
export const NON_SELECTABLE_CONTINENTS: ReadonlySet<string> = new Set([
  "Antarctica",
]);

/**
 * Left out of the continent camera only (architect decision G1b): Natural Earth counts all of
 * Russia as Europe, which would pull the Europe view to Siberia. Russia is still drawn and clickable.
 */
/** ADM0_A3 of the USA: its states and counties use their own texts (T-REGION-3). */
export const US = "USA";

export const CAMERA_EXCLUDED_COUNTRIES: ReadonlySet<string> = new Set(["RUS"]);

/**
 * Start and continent-level view (E-32): NASA Headquarters, Washington DC. The altitude lets the
 * earth fill most of the stage height (E-57). Going back to the continents returns here too.
 */
export const NASA_HQ_START_VIEW: Camera = {
  lat: 38.883,
  lng: -77.016,
  altitude: 1.6,
};
const MIN_ALTITUDE = 0.12;
const MAX_ALTITUDE = 2.5;
/** globe.gl's default camera: vertical field of view 50 degrees. */
const HALF_FOV_RAD = (25 * Math.PI) / 180;

export function globeReducer(
  level: GlobeLevel,
  action: GlobeAction,
): GlobeLevel {
  switch (action.type) {
    case "selectContinent":
      if (
        level.kind !== "continents" ||
        NON_SELECTABLE_CONTINENTS.has(action.continent)
      ) {
        return level;
      }
      return { kind: "countries", continent: action.continent };
    case "selectCountry":
      if (level.kind !== "countries") return level;
      return {
        kind: "regions",
        continent: level.continent,
        country: action.country,
      };
    case "switchCountry":
      if (
        level.kind !== "regions" ||
        NON_SELECTABLE_CONTINENTS.has(action.continent)
      ) {
        return level;
      }
      return {
        kind: "regions",
        continent: action.continent,
        country: action.country,
        previous: level.country,
      };
    case "selectState":
      if (level.kind !== "regions" || !hasRegionView(level.country)) {
        return level;
      }
      return {
        kind: "state",
        continent: level.continent,
        country: level.country,
        adm1: action.adm1,
        name: action.name,
      };
    case "back":
      if (level.kind === "state") {
        return {
          kind: "regions",
          continent: level.continent,
          country: level.country,
        };
      }
      if (level.kind === "regions") {
        return { kind: "countries", continent: level.continent };
      }
      return INITIAL_LEVEL;
    case "goTo": {
      const path = levelPath(level);
      // Only levels above the current one; the current segment is not a link.
      if (action.depth < 0 || action.depth >= path.length - 1) return level;
      return path[action.depth] ?? level;
    }
    case "reset":
      return INITIAL_LEVEL;
  }
}

/**
 * The levels from the globe down to `level`, one per path segment (E-35), e.g.
 * Globe / EUROPE / Austria / Kärnten for a state (E-43).
 */
export function levelPath(level: GlobeLevel): GlobeLevel[] {
  switch (level.kind) {
    case "continents":
      return [INITIAL_LEVEL];
    case "countries":
      return [INITIAL_LEVEL, level];
    case "regions":
      return [
        INITIAL_LEVEL,
        { kind: "countries", continent: level.continent },
        level,
      ];
    case "state":
      return [
        INITIAL_LEVEL,
        { kind: "countries", continent: level.continent },
        { kind: "regions", continent: level.continent, country: level.country },
        level,
      ];
  }
}

/** Path depth of the continent level (Globe / CONTINENT / …); goTo target of the search icon (E-48). */
export const CONTINENT_DEPTH = 1;
const COUNTRY_DEPTH = 2;

/** A state view to open from anywhere, e.g. for a search hit (E-52b). */
export type StateTarget = {
  continent: string;
  country: string;
  /** ISO 3166-2 code, e.g. "AT-2". */
  adm1: string;
  name: string;
};

/**
 * The reducer steps from any level to `target`'s state view (E-52b): the same steps as clicking
 * continent, country and state, so a search hit has no navigation of its own.
 */
export function openStateActions(target: StateTarget): GlobeAction[] {
  return [
    { type: "reset" },
    { type: "selectContinent", continent: target.continent },
    { type: "selectCountry", country: target.country },
    { type: "selectState", adm1: target.adm1, name: target.name },
  ];
}

/**
 * True on the country level and every level below it (states once they exist). There the search
 * bar collapses to an icon that leads back to the continent (E-48).
 */
export function isCountryOrDeeper(level: GlobeLevel): boolean {
  return levelPath(level).length - 1 >= COUNTRY_DEPTH;
}

/**
 * Development-only start level from a query like `?globe=Europe/AUT` (used for screenshots).
 * Unknown values are not validated here; they simply select no polygons.
 */
export function levelFromQuery(search: string): GlobeLevel {
  const value = new URLSearchParams(search).get("globe");
  if (!value) return INITIAL_LEVEL;
  const [continent, country] = value.split("/");
  if (!continent || NON_SELECTABLE_CONTINENTS.has(continent)) {
    return INITIAL_LEVEL;
  }
  return country
    ? { kind: "regions", continent, country }
    : { kind: "countries", continent };
}

/** Level 3 shows only the chosen country's admin-1 regions (on the 2D map). */
export function regionsForCountry(
  country: string,
  regions: readonly RegionFeature[],
): RegionFeature[] {
  return regions.filter((feature) => feature.properties.adm0_a3 === country);
}

function outerRings(geometry: PolygonGeometry): Ring[] {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.flatMap((polygon) => (polygon[0] ? [polygon[0]] : []));
}

/**
 * Country borders for the globe's path layer (outer rings only). Polygon strokes sit only 1e-4
 * above their caps and vanish in z-fighting; a separate line layer can be lifted clearly above.
 */
export function borderRings(countries: readonly CountryFeature[]): Ring[] {
  return countries.flatMap((feature) => outerRings(feature.geometry));
}

/** Planar area of a ring in square degrees, longitudes unwrapped across the antimeridian. */
function ringArea(ring: Ring): number {
  const points = unwrapRing(ring);
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i] ?? [0, 0];
    const [x2, y2] = points[(i + 1) % points.length] ?? [0, 0];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function unwrapRing(ring: Ring): [number, number][] {
  const result: [number, number][] = [];
  let previous: number | null = null;
  for (const [lng = 0, lat = 0] of ring) {
    let x = lng;
    if (previous !== null) {
      while (x - previous > 180) x -= 360;
      while (x - previous < -180) x += 360;
    }
    result.push([x, lat]);
    previous = x;
  }
  return result;
}

/** Outer ring of the largest part, so overseas parts (French Guiana in France) do not skew the view. */
export function largestRing(geometry: PolygonGeometry): Ring {
  let best: Ring = [];
  let bestArea = -1;
  for (const ring of outerRings(geometry)) {
    const area = ringArea(ring);
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  return best;
}

function normalizeLng(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/**
 * Smallest longitude interval covering all values: the complement of the largest gap on the circle.
 * Handles sets that cross the antimeridian (Fiji, Chukotka, Oceania).
 */
export function longitudeSpan(lngs: readonly number[]): {
  west: number;
  east: number;
  width: number;
} {
  const sorted = lngs.map(normalizeLng).sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (first === undefined || last === undefined) {
    return { west: 0, east: 0, width: 0 };
  }
  let gap = first + 360 - last;
  let west = first;
  for (let i = 1; i < sorted.length; i += 1) {
    const a = sorted[i - 1] ?? 0;
    const b = sorted[i] ?? 0;
    if (b - a > gap) {
      gap = b - a;
      west = b;
    }
  }
  const width = 360 - gap;
  return { west, east: normalizeLng(west + width), width };
}

export type Box = {
  west: number;
  south: number;
  width: number;
  height: number;
};

export function boundingBox(points: readonly Position[]): Box {
  const lats = points.map(([, lat = 0]) => lat);
  const span = longitudeSpan(points.map(([lng = 0]) => lng));
  const south = lats.length ? Math.min(...lats) : 0;
  const north = lats.length ? Math.max(...lats) : 0;
  return { west: span.west, south, width: span.width, height: north - south };
}

/**
 * Altitude (in globe radii) at which an arc of `extentDeg` on the sphere, centred under the camera,
 * fits into the vertical field of view.
 */
export function altitudeForExtent(extentDeg: number): number {
  const half = (Math.min(extentDeg / 2, 85) * Math.PI) / 180;
  const distance = Math.cos(half) + Math.sin(half) / Math.tan(HALF_FOV_RAD);
  return Math.min(MAX_ALTITUDE, Math.max(MIN_ALTITUDE, distance - 1));
}

/** Fixed camera for a box: centre of the box, altitude from its angular size. */
export function cameraForBox(box: Box, padding = 1.3): Camera {
  const lat = box.south + box.height / 2;
  const lng = normalizeLng(box.west + box.width / 2);
  const extent =
    Math.max(box.width * Math.cos((lat * Math.PI) / 180), box.height) * padding;
  const altitude = altitudeForExtent(extent);
  return {
    lat: round(lat),
    lng: round(lng),
    altitude: round(altitude),
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function ringCentroid(ring: Ring): [number, number] {
  const points = unwrapRing(ring);
  const n = points.length || 1;
  const lng = points.reduce((sum, [x]) => sum + x, 0) / n;
  const lat = points.reduce((sum, [, y]) => sum + y, 0) / n;
  return [normalizeLng(lng), lat];
}

const CONTINENT_PADDING = 0.9;

/**
 * Continent (level 2): box over the centres of each country's largest part ("main mass"), padded,
 * so neither overseas territories nor the full outline of very large countries dominate.
 */
export function cameraForContinent(
  countries: readonly CountryFeature[],
): Camera {
  const framed = countries.filter(
    (feature) => !CAMERA_EXCLUDED_COUNTRIES.has(feature.properties.ADM0_A3),
  );
  const centres = (framed.length ? framed : countries).map((feature) =>
    ringCentroid(largestRing(feature.geometry)),
  );
  // E-56: closer framing, the continent fills the view about as a country fills the 2D map.
  return cameraForBox(boundingBox(centres), CONTINENT_PADDING);
}

/**
 * Camera of the globe. On level 3 the 2D country map covers the globe, which stays on the
 * continent behind it, so going back needs no camera move.
 */
export function cameraForLevel(
  level: GlobeLevel,
  countries: readonly CountryFeature[],
): Camera {
  if (level.kind === "continents") return NASA_HQ_START_VIEW;
  const members = countries.filter(
    (feature) => feature.properties.CONTINENT === level.continent,
  );
  return members.length ? cameraForContinent(members) : NASA_HQ_START_VIEW;
}

/**
 * Polygons drawn on the globe: all countries on level 1, the continent's countries on level 2 and,
 * behind the 2D map, also on level 3 (pass the level's continent, or null on level 1).
 */
export function globePolygons(
  continent: string | null,
  countries: readonly CountryFeature[],
): CountryFeature[] {
  return continent === null
    ? [...countries]
    : countries.filter((feature) => feature.properties.CONTINENT === continent);
}
