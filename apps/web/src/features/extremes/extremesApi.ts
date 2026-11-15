import { requestJson } from "../../lib/apiClient";
import type { ExtremesResponse } from "../compare/contract";

/** No shorter than 300 s: a regional extremes request can take about 40 s. */
export const EXTREMES_TIMEOUT_MS = 300_000;

export type ExtremesQuery = {
  start_year: number;
  end_year: number;
} & ({ location_id: string } | { lat: number; lon: number });

/** GET /api/v1/extremes for one location (catalog region or point) and period. */
export function fetchExtremes(
  query: ExtremesQuery,
  signal?: AbortSignal,
): Promise<ExtremesResponse> {
  const params = new URLSearchParams({
    start_year: String(query.start_year),
    end_year: String(query.end_year),
  });
  if ("location_id" in query) {
    params.set("location_id", query.location_id);
  } else {
    params.set("lat", String(query.lat));
    params.set("lon", String(query.lon));
  }
  const timeout = AbortSignal.timeout(EXTREMES_TIMEOUT_MS);
  const combined =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  return requestJson<ExtremesResponse>(`/extremes?${params.toString()}`, {
    headers: { Accept: "application/json" },
    signal: combined,
  });
}
