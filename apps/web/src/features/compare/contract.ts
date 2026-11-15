// Single entry point for the API contract types in apps/web.
// Source: packages/contracts/src/index.ts -> generated.ts (openapi-typescript, never edited by hand).
//
// apps/web does not declare @trend-detective/contracts as a dependency: adding "workspace:*" would
// change package.json and pnpm-lock.yaml. The import is therefore type-only and relative;
// `import type` is erased at build time, so Vite never resolves this path at runtime.
// Once the dependency is added, only this file changes to `from "@trend-detective/contracts"`.
export type {
  CatalogResponse,
  CompareRequest,
  CompareResponse,
  ErrorResponse,
  Location,
  SeriesResult,
  TrendResult,
  Variable,
} from "../../../../../packages/contracts/src/index";

import type { components } from "../../../../../packages/contracts/src/index";

/** Entries of CompareRequest.locations (B-PT): a catalog location or a free point. */
export type LocationRef = components["schemas"]["LocationRef"];
export type PointRef = components["schemas"]["PointRef"];
export type ExtremesResponse = components["schemas"]["ExtremesResponse"];
export type ExtremeMetric = components["schemas"]["ExtremeMetric"];
export type ExtremeMetrics = components["schemas"]["ExtremeMetrics"];
export type ExtremeThresholds = components["schemas"]["ExtremeThresholds"];
export type ExtremeYearValue = components["schemas"]["ExtremeYearValue"];
export type Provenance = components["schemas"]["Provenance"];
