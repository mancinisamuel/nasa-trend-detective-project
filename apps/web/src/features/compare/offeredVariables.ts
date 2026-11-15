import { ApiRequestError } from "../../lib/apiClient";
import type { CatalogResponse } from "./contract";

/**
 * Variables offered in the results dropdown. The catalog lists precipitation as
 * enabled in demo mode, but POST /compare returns 422 UNKNOWN_VARIABLE for it.
 */
export function isOfferedVariable(
  variable: { id: string; enabled: boolean },
  dataMode: CatalogResponse["data_mode"],
  unknownIds: ReadonlySet<string> = new Set(),
): boolean {
  if (!variable.enabled) return false;
  if (dataMode === "demo" && variable.id === "precipitation") return false;
  return !unknownIds.has(variable.id);
}

export function isUnknownVariableError(error: Error): boolean {
  return (
    error instanceof ApiRequestError &&
    error.body?.error.code === "UNKNOWN_VARIABLE"
  );
}
