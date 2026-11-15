import { requestJson } from "../../lib/apiClient";
import type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
} from "./contract";

/** No shorter than 300 s: a nationwide USA compare can take about 69 s. */
export const COMPARE_TIMEOUT_MS = 300_000;

export function fetchCatalog(signal?: AbortSignal): Promise<CatalogResponse> {
  return requestJson<CatalogResponse>("/catalog", {
    headers: { Accept: "application/json" },
    signal: signal ?? null,
  });
}

export function postCompare(
  request: CompareRequest,
  signal?: AbortSignal,
): Promise<CompareResponse> {
  const timeout = AbortSignal.timeout(COMPARE_TIMEOUT_MS);
  const combined =
    signal === undefined ? timeout : AbortSignal.any([signal, timeout]);
  return requestJson<CompareResponse>("/compare", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: combined,
  });
}
