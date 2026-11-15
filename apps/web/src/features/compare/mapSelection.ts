import type { MapPick, PolygonGeometry } from "../../components/globeLevels";
import type { CatalogResponse, PointRef } from "./contract";

/** The chosen location: a catalog entry (area mean where the API has one) or a free point. */
export type Place =
  | { kind: "catalog"; id: string }
  | { kind: "point"; lat: number; lon: number; label: string };

/** Catalog ids of Austrian states follow "<iso2>-<German name>" with umlauts spelled out. */
function stateCatalogId(iso: string, name: string): string {
  const country = iso.split("-")[0]?.toLowerCase() ?? "";
  const slug = name
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${country}-${slug}`;
}

/** Shoelace centroid of the largest outer ring, in [lon, lat]; only where no centroid exists. */
function geometryCentre(geometry: PolygonGeometry): [number, number] | null {
  const polygons =
    geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  let best: { area: number; x: number; y: number } | null = null;
  for (const polygon of polygons) {
    const ring = polygon[0] ?? [];
    let area = 0;
    let x = 0;
    let y = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0 = 0, y0 = 0] = ring[i] ?? [];
      const [x1 = 0, y1 = 0] = ring[(i + 1) % ring.length] ?? [];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      x += (x0 + x1) * cross;
      y += (y0 + y1) * cross;
    }
    if (area !== 0 && (best === null || Math.abs(area) > Math.abs(best.area))) {
      best = { area, x: x / (3 * area), y: y / (3 * area) };
    }
  }
  return best === null ? null : [best.x, best.y];
}

function point(lonLat: readonly number[] | null, label: string): Place | null {
  const [lon, lat] = lonLat ?? [];
  // GeoJSON order is [lon, lat]; the request wants lat and lon by name.
  if (lon === undefined || lat === undefined) return null;
  return { kind: "point", lat, lon, label };
}

/**
 * Maps a picked map element to a location. A catalog entry wins (countries by catalog label,
 * states by the catalog id convention), otherwise the element's centroid becomes a free point.
 */
export function placeFromPick(
  catalog: CatalogResponse,
  pick: MapPick,
): Place | null {
  const known = (id: string | undefined): Place | null =>
    id === undefined ? null : { kind: "catalog", id };
  switch (pick.kind) {
    case "country": {
      const match = catalog.locations.find((location) =>
        countryNameMatches(location.label, pick.name),
      );
      return (
        known(match?.id) ?? point(geometryCentre(pick.geometry), pick.name)
      );
    }
    case "state": {
      const id = catalogIdForState(catalog, pick.iso, pick.name);
      return (
        known(id) ??
        point(
          pick.geometry === null ? null : geometryCentre(pick.geometry),
          pick.name,
        )
      );
    }
    case "area":
      return point(pick.centroid, pick.name);
  }
}

/**
 * Resolves a picked state to a catalog id. Prefer the ISO 3166-2 code in
 * lowercase (us-tx), then the Austrian slug convention (at-kaernten).
 */
function catalogIdForState(
  catalog: CatalogResponse,
  iso: string,
  name: string,
): string | undefined {
  const isoId = iso.toLowerCase();
  if (catalog.locations.some((location) => location.id === isoId)) {
    return isoId;
  }
  const slugId = stateCatalogId(iso, name);
  if (catalog.locations.some((location) => location.id === slugId)) {
    return slugId;
  }
  return undefined;
}

/** True when a Natural Earth country name refers to the same place as a catalog label. */
function countryNameMatches(label: string, name: string): boolean {
  if (label === name) return true;
  return name.startsWith(`${label} `) || label.startsWith(`${name} `);
}

/** Request form of a free point (contract PointRef). */
export function pointRef(place: Extract<Place, { kind: "point" }>): PointRef {
  return { kind: "point", lat: place.lat, lon: place.lon, label: place.label };
}

export function samePlace(a: Place, b: Place): boolean {
  if (a.kind === "catalog") return b.kind === "catalog" && a.id === b.id;
  return b.kind === "point" && a.lat === b.lat && a.lon === b.lon;
}
