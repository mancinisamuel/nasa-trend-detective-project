# Provenance

Purpose: describe where the data comes from, which provenance fields each result carries and how the local file cache works.

Status: Draft – wird in Phase E6 gefüllt.

## To be covered (from the architecture brief v1.0)

- Data sources (brief §06, §10): NASA POWER monthly point endpoint as the first, replaceable adapter; synthetic demo data (`provider="synthetic"`, `dataset="demo_temperature_v1"`) generated with a fixed seed.
- Request construction: fixed HTTPS host and validated parameters only; no user-defined URL, no generic proxy; same community for all comparisons; whole years only.
- Spatial meaning: a point query stands for provider grid data, not a station or a regional mean; requested and returned coordinates stored separately; resolution only from verified metadata, otherwise marked unknown.
- Normalisation rules: expected structure `properties.parameter.T2M`; `YYYYMM` keys; month 13 ignored; fill value -> `null` (never 0); sorting and duplicate detection; units only converted after confirmed metadata; unknown units or schema changes -> `PROVIDER_SCHEMA_ERROR`.
- Provenance fields (brief §07): `provider`, `dataset`, `parameter`, `community`, `requested_coordinates`, `returned_coordinates`, `retrieved_at` (UTC), `source_url`, `raw_sha256` (of the stored raw bytes), `provider_version`.
- Cache (brief §10): key = SHA-256 of canonical JSON (provider, endpoint version, parameter, community, exact coordinates, start/end year, normalisation schema version); layout `data/cache/power/<key>/response.json` and `metadata.json`; atomic writes; TTL 24 h by default, configurable; stale data only after a provider error and with configured permission, marked `cache_status="stale"`; damaged cache files discarded; baseline period cached separately; cache contents never committed.
- Request behaviour: one shared `httpx.AsyncClient`, at most two concurrent provider requests, limited retries, total duration limited, never a silent switch to synthetic data.
- Citation and attribution for NASA POWER and map tiles: open, to be added before publication.
