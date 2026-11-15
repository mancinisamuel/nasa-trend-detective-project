# ADR 0001: Stack

Purpose: record why Trend Detective uses this stack and which alternatives were left out.

Status: Draft – wird in Phase F9 gefüllt.

## To be covered (from the architecture brief v1.0)

- Decision: React + TypeScript + Vite for `apps/web`; Python + FastAPI for `apps/api`; pnpm and uv; one repository with two applications (D-01).
- Reasons (brief §02): Vite fits an interactive client app, server-side rendering adds little for one comparison screen; Python keeps scientific processing next to established libraries; FastAPI provides typed schemas and OpenAPI; a second runtime costs setup but reduces friction for scientific extensions.
- Local file cache instead of a database server (D-07); no auth, no cloud dependency, no LLM in the analysis path.
- Further decisions D-02 to D-08: demo mode on by default, T2M first, points as grid points, at least 30 common complete years, OLS/HAC as versioned baseline, no AI in the computation path.
  - Superseded 2026-11-15 (D-02): the default is live mode (NASA POWER); demo mode is selected with `TD_DATA_MODE=demo`. Decision by Samuel (E-66).
- Version strategy (brief §05): checked stable versions, no pre-releases, pins in `packageManager`, `.node-version`, `apps/api/.python-version` and lockfiles; record the installed versions and any deliberate deviation from the latest release with its reason.
- Things explicitly not built (auth, database server, queues, LLM, deployment, region mode).

## Dependencies / decisions

These decisions are already made (architect, 30 Oct 2026) and recorded here ahead of the full ADR.

- **`eslint` pinned to `10.13.0`, not `10.14.0`.** `apps/web/package.json` pins `eslint` exactly to `10.13.0`. Reason: pnpm 12 applies a minimum waiting time to newly published releases. With `10.14.0`, `pnpm install` would have added an exception to the root file `pnpm-workspace.yaml`. With `10.13.0` the root files stay unchanged.
- **Accepted deviation from the brief's file tree: `apps/web/src/i18n/index.ts`.** The brief lists only `i18n/en.ts` and `i18n/de.ts`. `index.ts` adds a small `t()` function that reads from `en.ts` only; German is prepared but not selectable yet. `en.ts` and `de.ts` are placeholders for now: every value equals its key, and the only key so far is `app.title`. The real texts follow after Gate B (task F5).
