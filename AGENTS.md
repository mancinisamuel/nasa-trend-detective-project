# AGENTS.md

Working rules for coding agents in this repository. Keep this file short. Layer boundaries are also in `.cursor/rules/architecture.mdc`; do not add rules here that contradict it.

## Source of truth

- The architecture brief "Trend Detective Architektur & Cursor-Briefing", v1.0, 30 Oct 2026, is binding. If code, docs or a task conflict with it, stop and report the conflict instead of choosing silently. TODO: the brief is not in this repository yet.
- Build only what the brief lists under "build now". No auth, database server, queues, LLM, deployment or region mode.

## Data and claims

- Live mode (NASA POWER) is the default; demo mode is selected with `TD_DATA_MODE=demo`. Demo results are always labelled as demo: UI banner, `data_mode="demo"` in the API, and in exports. Demo provenance is `provider="synthetic"`, `dataset="demo_temperature_v1"`. Never name NASA as the source of synthetic numbers.
- Never replace a live failure with synthetic data. Show an error or an explicitly marked stale cache entry.
- Never invent NASA measurements, confidence intervals, source versions or test results.
- A location is a grid point query, not a region and not a station. Make no statements about regions.
- Make no causal statements. A trend says nothing about causes.
- Make no claim of NASA conformity. The full challenge requirements are not verified.

## Architecture

- Pydantic models in `apps/api` and the OpenAPI schema they produce are the contract. TypeScript types in `packages/contracts` are generated with `pnpm contracts`. Never edit `packages/contracts/src/generated.ts` by hand.
- The frontend does no statistics. Trends, intervals, anomalies and quality checks are computed in the API domain.
- The frontend never calls NASA directly. Only the backend provider talks to NASA POWER.
- No LLM in the analysis path.
- All UI text comes from `apps/web/src/i18n/`. `en.ts` is the default; `de.ts` has the same keys. No string literals for UI text in components.

## Git

- Never push to `main` or `master`. Do not push at all without an explicit yes from Samuel.
- Do not merge pull requests.
- No force push, no deleting branches, no rewriting pushed history.
- Commit only the files you changed, with explicit paths.

## Secrets

- Never commit secrets or `.env` files. Only `.env.example` files are versioned.
- No credentials in `VITE_` variables; they are visible in the browser.

## Docs

- `README.md`: start, data mode, commands, limits
- `docs/architecture.md`: building blocks, dependency direction, data flow
- `docs/data-contract.md`: API requests, responses, error format, exports
- `docs/methodology.md`: aggregation, model, parameters, limits
- `docs/provenance.md`: data sources and cache
- `docs/ai-usage.md`: AI help by task and scope
- `docs/challenge-alignment.md`: challenge goals mapped to screens and tests
- `docs/adr/0001-stack.md`: stack decision

## Checks

These commands exist today (run from the repository root). If `pnpm` is not on the PATH, use `corepack pnpm`.

```bash
uv sync --project apps/api
corepack pnpm install

uv --directory apps/api run ruff check .
uv --directory apps/api run ruff format --check .
uv --directory apps/api run mypy
uv --directory apps/api run pytest

pnpm --filter @trend-detective/web run lint
pnpm --filter @trend-detective/web run typecheck
pnpm --filter @trend-detective/web run test
pnpm --filter @trend-detective/web run build
```

`pnpm check` runs all of the above checks (`check:api`, then `check` in each workspace package). `pnpm test:e2e` runs Playwright in `apps/web`. `pnpm contracts` depends on `scripts/export_openapi.py` and `packages/contracts`, which do not exist yet.

Report the commands you ran and their real results. If something is blocked (missing package, network, browser), report the blocker and do not report the check as passed.
