# Trend Detective

Trend Detective shows how the climate of a place has changed, using data from NASA POWER. Pick a place in Austria or the USA on a 3D globe, a map or by search, and see the trend per decade for temperature, precipitation, humidity and wind, with its uncertainty and a set of extremes from daily data. Built for the NASA Space Apps Challenge 2026.

## Quickstart

```bash
mkdir trend-detective && cd trend-detective
git clone https://github.com/mancinisamuel/nasa-trend-detective.git
cd nasa-trend-detective
./start.sh
```

The script installs the dependencies, builds the app, starts it and prints the link. The web app runs on http://localhost:4173, the API on port 8000. Stop both with Ctrl+C.

Other ports: `API_PORT=8100 WEB_PORT=5273 ./start.sh`

## Requirements

- Node.js 24 or newer (pinned: 24.22.2 in `.node-version`)
- pnpm 12.16.1, via Corepack, which ships with Node.js (`corepack enable`)
- uv
- Python 3.12 (`uv python install 3.12` if it is missing)

`start.sh` checks these first and stops with a hint if something is missing. It does not install them for you. No `.env` file is needed.

## Development

```bash
pnpm dev:web   # frontend with hot reload on http://localhost:5173
pnpm dev:api   # API on http://127.0.0.1:8000
pnpm check     # lint, type checks, tests and build for API and web
```

## Data and credits

- Climate data: [NASA POWER](https://power.larc.nasa.gov/). Values are for grid cells of about 50 km, not weather stations.
- Borders: [Natural Earth](https://www.naturalearthdata.com/) (public domain) and [geoBoundaries](https://www.geoboundaries.org/) gbOpen. Austrian districts and municipalities are CC BY-SA 2.0 (source data: BEV), US states and counties are public domain (source data: US Census Bureau). Details in [apps/web/public/geo/README.md](apps/web/public/geo/README.md).
- Earth image: Blue Marble, NASA Earth Observatory.

## Documentation

- [Method](docs/methodology.md): averaging, trend model, extremes, limits
- [Data sources](docs/provenance.md)
- [Architecture](docs/architecture.md) and [API contract](docs/data-contract.md)
- [Challenge alignment](docs/challenge-alignment.md)
- [AI use](docs/ai-usage.md)

## AI use

AI coding assistants helped write code and texts in this repository, including this README. The team reviews the results. No AI is used in any calculation shown in the app.

## License

Not decided yet.
