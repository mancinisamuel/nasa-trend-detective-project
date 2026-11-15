import type { YearRange } from "../compare/compareRequest";
import type { CatalogResponse } from "../compare/contract";
import type { Place } from "../compare/mapSelection";
import type { ExtremesQuery } from "./extremesApi";

/**
 * Catalog regions that have no extremes (the API returns 422). Nationwide USA
 * is too large; the user should pick a state (us-*). Easy to extend later.
 */
export const EXTREMES_UNSUPPORTED_LOCATION_IDS: readonly string[] = ["usa"];

/** True when the catalog place should not request GET /extremes. */
export function isExtremesUnsupported(
  catalog: CatalogResponse,
  place: Place,
): boolean {
  if (place.kind !== "catalog") return false;
  const location = catalog.locations.find((entry) => entry.id === place.id);
  return (
    location !== undefined &&
    EXTREMES_UNSUPPORTED_LOCATION_IDS.includes(location.id)
  );
}

/**
 * Builds the extremes query for the same place and period as Compare.
 * Catalog regions (spatial_kind "region") are requested by location_id;
 * catalog grid points and free points use lat/lon. Returns null when the
 * catalog has no such place or extremes are not offered for it (e.g. usa).
 */
export function buildExtremesQuery(
  catalog: CatalogResponse,
  place: Place,
  range: YearRange,
): ExtremesQuery | null {
  if (place.kind === "point") {
    return {
      lat: place.lat,
      lon: place.lon,
      start_year: range.start,
      end_year: range.end,
    };
  }
  if (isExtremesUnsupported(catalog, place)) return null;
  const location = catalog.locations.find((entry) => entry.id === place.id);
  if (location === undefined) return null;
  if (location.spatial_kind === "region") {
    return {
      location_id: location.id,
      start_year: range.start,
      end_year: range.end,
    };
  }
  return {
    lat: location.latitude,
    lon: location.longitude,
    start_year: range.start,
    end_year: range.end,
  };
}
