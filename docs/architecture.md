# Architecture

Purpose: describe the building blocks of Trend Detective, their dependency direction and the data flow of a comparison.

Status: Draft – wird in Phase F9 gefüllt.

## To be covered (from the architecture brief v1.0)

- Building blocks and their limits (brief §02): web app, API router, CompareService, provider port (`PowerProvider`, `DemoProvider`), analysis domain, FileCache, contract package.
- Dependency direction: router -> service -> domain, provider, cache; provider knows no router and no UI; domain knows only simple typed data.
- Dependency injection at app start; tests replace provider and cache; no global HTTP clients without a managed lifecycle; no generic framework layer.
- Data flow of a comparison: `POST /api/v1/compare` -> canonical provider queries -> cache or provider -> normalisation -> domain (coverage, annual values, trend) -> full result with provenance; export uses this result without a new fetch.
- Repository layout and file responsibilities (brief §03, §04): UI primitives without data logic, no access to private internals of other features, no catch-all helper file, TanStack Query for server state.
- Contract generation: Pydantic -> OpenAPI -> `openapi-typescript` -> `packages/contracts/src/generated.ts` (never edited by hand).
- Demo and live mode: `TD_DATA_MODE` set on the server and exposed via the catalog; no outgoing NASA calls in demo mode.
- Planned extension to regions as a separate milestone (brief §14): `SpatialSelection` as a discriminated union (`grid_point` / `region`); a point endpoint is never silently turned into a region endpoint.
