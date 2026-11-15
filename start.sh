#!/usr/bin/env bash
# Trend Detective: check prerequisites, install dependencies, build the web app,
# start the API (live mode) and the web app (production build via vite preview).
# Ports: API_PORT (default 8000), WEB_PORT (default 4173, vite preview).
# Ctrl+C / SIGTERM stops both processes. Also runs with macOS /bin/bash 3.2.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

API_PORT="${API_PORT:-8000}"
WEB_PORT="${WEB_PORT:-4173}"
HOST_API="127.0.0.1"
HOST_WEB="localhost"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nERROR: %s\n' "$1" >&2; [ -n "${2:-}" ] && printf 'Hint: %s\n' "$2" >&2; exit 1; }

# a >= b for versions of the form X.Y.Z (missing parts = 0).
version_ge() {
  local IFS=.
  local -a a b
  read -r -a a <<<"$1"
  read -r -a b <<<"$2"
  local i
  for i in 0 1 2; do
    local x="${a[$i]:-0}" y="${b[$i]:-0}"
    if [ "$((10#$x))" -gt "$((10#$y))" ]; then return 0; fi
    if [ "$((10#$x))" -lt "$((10#$y))" ]; then return 1; fi
  done
  return 0
}

port_busy() { (exec 3<>"/dev/tcp/$1/$2") 2>/dev/null; }

# ---------------------------------------------------------------- 1) Prerequisites
say "Checking prerequisites"

command -v node >/dev/null 2>&1 ||
  die "Node.js not found." "Install Node.js $(cat .node-version 2>/dev/null || echo 24) (https://nodejs.org, e.g. 'brew install node' or fnm/nvm with .node-version)."
pkg() { node -e 'const p=require("./package.json");const v=process.argv[1].split(".").reduce((o,k)=>o&&o[k],p);process.stdout.write(v?String(v):"")' "$1"; }
NODE_RANGE="$(pkg engines.node)"   # package.json engines.node, e.g. ">=24.0.0"
NODE_HAVE="$(node --version | sed 's/^v//')"
case "$NODE_RANGE" in
  ">="*)
    NODE_MIN="${NODE_RANGE#>=}"
    version_ge "$NODE_HAVE" "$NODE_MIN" ||
      die "Node.js $NODE_HAVE is too old; package.json requires engines.node $NODE_RANGE." "Install Node.js $(cat .node-version 2>/dev/null || echo "$NODE_MIN") (version from .node-version)."
    ;;
  "") ;;
  *) echo "Note: engines.node '$NODE_RANGE' is not checked (only '>=' is supported)." ;;
esac
if [ -f .node-version ] && [ "$(cat .node-version)" != "$NODE_HAVE" ]; then
  echo "Note: Node.js $NODE_HAVE satisfies $NODE_RANGE; the repo pins $(cat .node-version) (.node-version)."
fi
echo "Node.js $NODE_HAVE ok ($NODE_RANGE)"

PNPM_WANT="$(pkg packageManager)"   # e.g. pnpm@12.16.1
PNPM_WANT="${PNPM_WANT#pnpm@}"
PNPM_WANT="${PNPM_WANT%%+*}"
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0
PNPM_VIA_COREPACK=0
if command -v pnpm >/dev/null 2>&1 && [ "$(pnpm --version 2>/dev/null)" = "$PNPM_WANT" ]; then
  :
elif command -v corepack >/dev/null 2>&1 && [ "$(corepack pnpm --version 2>/dev/null)" = "$PNPM_WANT" ]; then
  PNPM_VIA_COREPACK=1
else
  die "pnpm $PNPM_WANT (packageManager in package.json) is not available." "Use Corepack (ships with Node.js): 'corepack enable' or 'corepack prepare pnpm@$PNPM_WANT --activate'."
fi
run_pnpm() { if [ "$PNPM_VIA_COREPACK" = 1 ]; then corepack pnpm "$@"; else pnpm "$@"; fi; }
echo "pnpm $PNPM_WANT ok$([ "$PNPM_VIA_COREPACK" = 1 ] && echo ' (via corepack)')"

command -v uv >/dev/null 2>&1 ||
  die "uv not found (the repo does not pin a uv version)." "Install uv: https://docs.astral.sh/uv/getting-started/installation/ (e.g. 'brew install uv')."
echo "$(uv --version) ok"

PY_WANT="$(tr -d '[:space:]' < apps/api/.python-version)"   # apps/api/.python-version
PY_BIN="$(uv python find --no-python-downloads "$PY_WANT" 2>/dev/null)" ||
  die "Python $PY_WANT (apps/api/.python-version, requires-python in apps/api/pyproject.toml) not found." "Run 'uv python install $PY_WANT'."
echo "Python $("$PY_BIN" -c 'import platform;print(platform.python_version())') ok ($PY_WANT)"

for p in "$HOST_API:$API_PORT" "$HOST_WEB:$WEB_PORT"; do
  port_busy "${p%%:*}" "${p##*:}" &&
    die "Port ${p##*:} is already in use." "Choose other ports, e.g. 'API_PORT=8100 WEB_PORT=5273 ./start.sh'."
done

# ---------------------------------------------------------------- 2) Dependencies
say "Installing dependencies (uv sync --locked, pnpm install --frozen-lockfile)"
(cd apps/api && uv sync --locked --python "$PY_WANT")
run_pnpm install --frozen-lockfile

# ---------------------------------------------------------------- 3) Web build
say "Building the web app (production build)"
run_pnpm --filter @trend-detective/web run build

# ---------------------------------------------------------------- 4) Start
API_PID=""
WEB_PID=""
cleanup() {
  trap - INT TERM EXIT
  local pid
  for pid in $WEB_PID $API_PID; do
    kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    local alive=0
    for pid in $WEB_PID $API_PID; do kill -0 "$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.5
  done
  for pid in $WEB_PID $API_PID; do
    kill -KILL -- "-$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
}
on_signal() { echo; say "Stopping API and web"; cleanup; exit 130; }
trap on_signal INT TERM
trap cleanup EXIT

# Own process groups (set -m): cleanup also reaches grandchildren, no orphans.
set -m
say "Starting API (live mode) on http://$HOST_API:$API_PORT"
(
  export TD_DATA_MODE="${TD_DATA_MODE:-live}"
  export TD_ALLOWED_ORIGINS="[\"http://$HOST_WEB:$WEB_PORT\"]"
  exec apps/api/.venv/bin/uvicorn --app-dir apps/api/src trend_detective.main:app \
    --host "$HOST_API" --port "$API_PORT"
) &
API_PID=$!

say "Starting web (vite preview, production build) on http://$HOST_WEB:$WEB_PORT"
(
  cd apps/web
  export TD_API_TARGET="http://$HOST_API:$API_PORT"
  exec node_modules/.bin/vite preview --host "$HOST_WEB" --port "$WEB_PORT" --strictPort
) &
WEB_PID=$!
set +m

wait_http() { # url, pid, name
  local i
  for i in $(seq 1 120); do
    kill -0 "$2" 2>/dev/null || die "$3 exited during startup (see output above)."
    curl -fsS -o /dev/null --max-time 2 "$1" 2>/dev/null && return 0
    sleep 0.5
  done
  die "$3 did not answer at $1 within 60 s."
}
wait_http "http://$HOST_API:$API_PORT/api/v1/health" "$API_PID" "API"
wait_http "http://$HOST_WEB:$WEB_PORT/" "$WEB_PID" "Web"
wait_http "http://$HOST_WEB:$WEB_PORT/api/v1/health" "$WEB_PID" "API via the web proxy"

say "Ready: http://$HOST_WEB:$WEB_PORT/  (API: http://$HOST_API:$API_PORT/api/v1, data mode ${TD_DATA_MODE:-live})"
echo "Press Ctrl+C to stop."

while kill -0 "$API_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
die "API or web exited unexpectedly."
