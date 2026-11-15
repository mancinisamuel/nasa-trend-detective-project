import { useQuery } from "@tanstack/react-query";

import type { RegionResponse } from "./contract";
import { fetchRegion } from "./regionApi";

/**
 * A single district covering the whole state (Wien, US-DC) adds nothing: it is dropped, so the map
 * draws no inner border and the list shows region.empty (E-47).
 */
function withoutSoleDistrict(region: RegionResponse): RegionResponse {
  return region.districts.length === 1 ? { ...region, districts: [] } : region;
}

/**
 * One state's districts and municipalities (up to ~750 KB). Borders do not change while the app
 * runs, so the map and the sidebar share one cached response per state.
 */
export function useRegion(country: string, adm1: string) {
  return useQuery({
    queryKey: ["region", country, adm1],
    queryFn: ({ signal }) => fetchRegion(country, adm1, signal),
    staleTime: Infinity,
    select: withoutSoleDistrict,
  });
}
