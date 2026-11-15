import { skipToken, useQuery } from "@tanstack/react-query";

import { fetchExtremes, type ExtremesQuery } from "./extremesApi";

/** GET /api/v1/extremes for the given query; idle while the query is null. */
export function useExtremes(query: ExtremesQuery | null) {
  return useQuery({
    queryKey: ["extremes", query],
    queryFn:
      query === null ? skipToken : ({ signal }) => fetchExtremes(query, signal),
    // A regional request can take ~40 s; automatic retries would stack that wait.
    retry: false,
  });
}
