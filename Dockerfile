FROM node:24-slim AS web
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @trend-detective/web run build

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app/apps/api
COPY apps/api/ ./
RUN uv sync --locked --no-dev
COPY deploy/serve.py /app/deploy/serve.py
COPY --from=web /repo/apps/web/dist /app/web
ENV TD_DATA_MODE=live \
    TD_CACHE_DIR=/tmp/td-cache \
    TD_WEB_DIST=/app/web
CMD ["sh", "-c", "exec .venv/bin/uvicorn serve:app --app-dir /app/deploy --host 0.0.0.0 --port ${PORT:-8080}"]
