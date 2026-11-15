# Data contract

Purpose: document the API routes, request and response schemas, the error format and the export formats that the web app relies on.

Status: Draft – wird in Phase F9 gefüllt.

## To be covered (from the architecture brief v1.0)

- Routes (brief §08): `GET /api/v1/health`, `GET /api/v1/catalog`, `POST /api/v1/compare`, `GET /openapi.json`, `GET /docs`.
- Compare request: `variable_id`, two `locations` (`id`, `latitude`, `longitude`), `start_year`, `end_year`, `baseline`; exactly 2 different locations, 1 variable, at most 50 years; IDs and coordinates must not contradict each other.
- Validation errors: 422; unknown variable: 422 with error code; disabled parameter: 422 `VARIABLE_DISABLED`.
- Success response: `schema_version="1.0"`, `analysis_version`, `result_id`, `request_id`, `data_mode`, `generated_at`, `request`, `series`, `comparison` (`common_years`, `warnings`), `cache_status` per series.
- Models and required fields (brief §07): `Location`, `Variable`, `MonthlyObservation`, `AnnualObservation`, `Provenance`, `QualityReport`, `TrendResult`, `SeriesResult`.
- Partial missing values give 200 with a quality status; a provider failure for one location fails the whole comparison; no hidden partial response.
- Error format `{error: {code, message, request_id, retryable, details}}`; 502 invalid provider response, 503 provider temporarily unavailable, 504 timeout; FastAPI validation errors in the same format; `PROVIDER_SCHEMA_ERROR`.
- `result_id`: hash of canonical analysis request, raw data hashes and analysis version, without `generated_at` and `request_id`.
- Exports (brief §10): JSON with the full result; CSV in long format with columns `result_id, data_mode, location_id, latitude, longitude, year, value, anomaly, unit, valid_months, source_url, retrieved_at`; empty cells for missing values, decimal point, UTF-8, correct quoting, formula neutralisation; file names `trend-detective_<result-id-prefix>.csv` / `.json`; demo label in exports.
- Concrete JSON examples generated from the typed schemas (the brief's examples show structure only).
