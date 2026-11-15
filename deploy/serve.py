"""Production entry point: serves the API and the built web app from one process,
with a simple per-IP rate limit on /api."""

import os
import time
from collections import defaultdict, deque
from collections.abc import Awaitable, Callable
from pathlib import Path

from fastapi import Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException
from starlette.types import Scope

from trend_detective.main import app

LIMIT = int(os.environ.get("TD_RATE_LIMIT_PER_MINUTE", "60"))
WINDOW_SECONDS = 60.0
_hits: dict[str, deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    # Cloud Run sets X-Forwarded-For; the first entry is the real visitor.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@app.middleware("http")
async def rate_limit(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    if not request.url.path.startswith("/api/"):
        return await call_next(request)
    now = time.monotonic()
    hits = _hits[_client_ip(request)]
    while hits and now - hits[0] > WINDOW_SECONDS:
        hits.popleft()
    if len(hits) >= LIMIT:
        retry = int(WINDOW_SECONDS - (now - hits[0])) + 1
        return JSONResponse(
            {"detail": "Too many requests, please wait a moment."},
            status_code=429,
            headers={"Retry-After": str(retry)},
        )
    hits.append(now)
    return await call_next(request)


class SpaStaticFiles(StaticFiles):
    """StaticFiles with an SPA fallback: unknown non-API paths get index.html with status 404,
    so the React NotFoundPage renders. /api paths keep the API's JSON 404."""

    async def get_response(self, path: str, scope: Scope) -> Response:
        try:
            return await super().get_response(path, scope)
        except HTTPException as exc:
            request_path: str = scope["path"]
            is_api = request_path == "/api" or request_path.startswith("/api/")
            if exc.status_code != 404 or is_api:
                raise
            return FileResponse(Path(str(self.directory)) / "index.html", status_code=404)


app.mount(
    "/",
    SpaStaticFiles(directory=Path(os.environ.get("TD_WEB_DIST", "/app/web")), html=True),
    name="web",
)
