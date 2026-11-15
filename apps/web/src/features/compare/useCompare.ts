import { skipToken, useQuery } from "@tanstack/react-query";

import { fetchCatalog, postCompare } from "./compareApi";
import type { CompareRequest } from "./contract";

/** Catalog of variables, locations and year bounds; it does not change while the app runs. */
export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: ({ signal }) => fetchCatalog(signal),
    staleTime: Infinity,
  });
}

/** POST /api/v1/compare for the given request; idle while the request is null. */
export function useCompare(request: CompareRequest | null) {
  return useQuery({
    queryKey: ["compare", request],
    queryFn:
      request === null
        ? skipToken
        : ({ signal }) => postCompare(request, signal),
    // A nationwide USA request can take ~69 s; automatic retries would stack that wait.
    retry: false,
  });
}
