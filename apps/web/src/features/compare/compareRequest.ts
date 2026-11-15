import type { CatalogResponse, CompareRequest } from "./contract";
import { pointRef, type Place } from "./mapSelection";

import type { YearRange } from "../../components/ui/YearRangeSlider";

/** Requested period; the bounds come from the selected variable (UI-RANGE). */
export type { YearRange };

/** Last complete calendar year; used only when a catalog payload has no bounds. */
function lastFullYear(): number {
  return new Date().getFullYear() - 1;
}

/**
 * Selectable years for a variable (UI-RANGE). Prefers available_from_year / available_to_year,
 * read here only. If a payload omits them, year_bounds, then 1981..last full year.
 */
export function yearBoundsForVariable(
  catalog: CatalogResponse,
  variableId?: string,
): { min_year: number; max_year: number } {
  const variable =
    (variableId === undefined
      ? undefined
      : catalog.variables.find((entry) => entry.id === variableId)) ??
    catalog.variables.find((entry) => entry.enabled);
  const from = variable?.available_from_year;
  const to = variable?.available_to_year;
  if (typeof from === "number" && typeof to === "number" && from <= to) {
    return { min_year: from, max_year: to };
  }
  const bounds = catalog.year_bounds;
  if (
    typeof bounds.min_year === "number" &&
    typeof bounds.max_year === "number" &&
    bounds.min_year <= bounds.max_year
  ) {
    return { min_year: bounds.min_year, max_year: bounds.max_year };
  }
  return { min_year: 1981, max_year: lastFullYear() };
}

/** Full available period of the variable, capped at the API's maximum request length. */
export function defaultYearRange(
  catalog: CatalogResponse,
  variableId?: string,
): YearRange {
  const { min_year, max_year } = yearBoundsForVariable(catalog, variableId);
  const maxYears = catalog.year_bounds.max_years_per_request;
  return {
    start: Math.max(min_year, max_year - maxYears + 1),
    end: max_year,
  };
}

/**
 * Keeps a range inside the variable's available years and at most max_years_per_request
 * long. `changed` names the end the user just moved; the other end follows when the range
 * would get too long or inverted.
 */
export function clampYearRange(
  catalog: CatalogResponse,
  range: YearRange,
  changed: "start" | "end",
  variableId?: string,
): YearRange {
  const { min_year, max_year } = yearBoundsForVariable(catalog, variableId);
  const span = catalog.year_bounds.max_years_per_request - 1;
  const within = (year: number) => Math.min(max_year, Math.max(min_year, year));
  if (changed === "start") {
    const start = within(range.start);
    const end = Math.min(Math.max(range.end, start), start + span, max_year);
    return { start, end };
  }
  const end = within(range.end);
  const start = Math.max(Math.min(range.start, end), end - span, min_year);
  return { start, end };
}

/**
 * Builds the compare request for one variable and one place. A catalog place is sent as
 * LocationRef, a free point as PointRef. Returns null when the catalog does not know the
 * location or the variable is missing or disabled.
 */
export function buildCompareRequest(
  catalog: CatalogResponse,
  variableId: string,
  place: Place,
  range: YearRange,
): CompareRequest | null {
  const variable = catalog.variables.find(
    (v) => v.id === variableId && v.enabled,
  );
  if (variable === undefined) return null;
  let ref: CompareRequest["locations"][number];
  if (place.kind === "point") {
    ref = pointRef(place);
  } else {
    const location = catalog.locations.find((l) => l.id === place.id);
    if (location === undefined) return null;
    ref = {
      id: location.id,
      latitude: location.latitude,
      longitude: location.longitude,
    };
  }
  return {
    variable_id: variable.id,
    locations: [ref],
    start_year: range.start,
    end_year: range.end,
    baseline: catalog.default_baseline,
  };
}
