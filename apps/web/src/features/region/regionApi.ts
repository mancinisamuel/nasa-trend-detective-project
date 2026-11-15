import { requestJson } from "../../lib/apiClient";
import type { RegionResponse, RegionSearchResponse } from "./contract";

/**
 * The only list of countries the regions API serves (E-49): their states open a state view; every
 * other country's states stay not clickable and its map shows region.unsupported.
 */
export const SUPPORTED_REGION_COUNTRIES = ["AUT", "USA"] as const;

export function hasRegionView(country: string): boolean {
  return (SUPPORTED_REGION_COUNTRIES as readonly string[]).includes(country);
}

/** A country with its continent, as Natural Earth's countries.json describes it. */
type CountryOnContinent = {
  properties: { ADM0_A3: string; CONTINENT: string };
};

/**
 * True if any country of `continent` has a region view (E-49b); derived from the loaded country
 * features, so there is no second list of continents.
 */
export function continentHasRegionView(
  continent: string,
  countries: readonly CountryOnContinent[],
): boolean {
  return countries.some(
    ({ properties }) =>
      properties.CONTINENT === continent && hasRegionView(properties.ADM0_A3),
  );
}

/** GET /api/v1/regions/{country_iso3}/{adm1_id}: a state with its districts and municipalities. */
export function fetchRegion(
  country: string,
  adm1: string,
  signal?: AbortSignal,
): Promise<RegionResponse> {
  return requestJson<RegionResponse>(
    `/regions/${encodeURIComponent(country)}/${encodeURIComponent(adm1)}`,
    { headers: { Accept: "application/json" }, signal: signal ?? null },
  );
}

/** GET /api/v1/regions/search?q=: states, districts and municipalities whose name matches (E-52b). */
export function fetchRegionSearch(
  query: string,
  signal?: AbortSignal,
): Promise<RegionSearchResponse> {
  return requestJson<RegionSearchResponse>(
    `/regions/search?${new URLSearchParams({ q: query }).toString()}`,
    { headers: { Accept: "application/json" }, signal: signal ?? null },
  );
}
