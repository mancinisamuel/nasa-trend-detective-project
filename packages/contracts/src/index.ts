// Öffentliche Typen des API-Vertrags. Quelle: src/generated.ts (pnpm contracts, nie manuell ändern).
import type { components, operations, paths } from "./generated";

export type { components, operations, paths };

type Schemas = components["schemas"];

export type CatalogResponse = Schemas["CatalogResponse"];
export type CompareRequest = Schemas["CompareRequest"];
export type CompareResponse = Schemas["CompareResponse"];
export type SeriesResult = Schemas["SeriesResult"];
export type TrendResult = Schemas["TrendResult"];
export type QualityReport = Schemas["QualityReport"];
export type Provenance = Schemas["Provenance"];
export type Location = Schemas["Location"];
export type Variable = Schemas["Variable"];
export type ErrorResponse = Schemas["ErrorResponse"];
export type ErrorCode = Schemas["ErrorCode"];
