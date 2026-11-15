// API contract types for the state view (E-43), taken from the generated schema; never hand-written.
// Imported type-only and relative, like features/compare/contract.ts.
import type { components } from "../../../../../packages/contracts/src/index";

type Schemas = components["schemas"];

export type RegionResponse = Schemas["RegionResponse"];
export type District = Schemas["District"];
export type Municipality = Schemas["Municipality"];
export type RegionSearchResponse = Schemas["RegionSearchResponse"];
export type RegionSearchHit = Schemas["RegionSearchHit"];
