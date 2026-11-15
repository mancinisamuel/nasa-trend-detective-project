"""Einheitliches Fehlerformat {error:{code,message,request_id,retryable,details}} (Brief §08)."""

import logging
import uuid
from collections.abc import Awaitable, Callable, Mapping
from enum import StrEnum
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, JsonValue
from starlette.exceptions import HTTPException as StarletteHTTPException

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"
# Fester Text für 502: keine Upstream-Schlüssel, Einheiten, Werte oder Exception-Texte.
UPSTREAM_DATA_UNAVAILABLE = "Upstream data unavailable"


class ErrorCode(StrEnum):
    VALIDATION_ERROR = "VALIDATION_ERROR"
    UNKNOWN_VARIABLE = "UNKNOWN_VARIABLE"
    VARIABLE_DISABLED = "VARIABLE_DISABLED"
    UNKNOWN_LOCATION = "UNKNOWN_LOCATION"
    UNSUPPORTED_COUNTRY = "UNSUPPORTED_COUNTRY"
    UNKNOWN_REGION = "UNKNOWN_REGION"
    LOCATION_MISMATCH = "LOCATION_MISMATCH"
    NOT_FOUND = "NOT_FOUND"
    METHOD_NOT_ALLOWED = "METHOD_NOT_ALLOWED"
    BAD_REQUEST = "BAD_REQUEST"
    PROVIDER_SCHEMA_ERROR = "PROVIDER_SCHEMA_ERROR"
    PROVIDER_UNAVAILABLE = "PROVIDER_UNAVAILABLE"
    PROVIDER_TIMEOUT = "PROVIDER_TIMEOUT"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class ErrorBody(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    code: ErrorCode
    message: str
    request_id: str
    retryable: bool
    details: dict[str, JsonValue] | None


class ErrorResponse(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    error: ErrorBody


class ApiError(Exception):
    """Fachlicher Fehler mit festem Code; wird vom Handler ins Fehlerformat übersetzt.

    log_detail geht nur ins Server-Log, nie in die Antwort.
    """

    def __init__(
        self,
        status_code: int,
        code: ErrorCode,
        message: str,
        *,
        retryable: bool = False,
        details: dict[str, JsonValue] | None = None,
        log_detail: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.retryable = retryable
        self.details = details
        self.log_detail = log_detail


def provider_schema_error(log_detail: str) -> ApiError:
    """502 mit festem Text; das Detail (Schlüssel, Einheit, Exception-Text) nur fürs Log."""
    return ApiError(
        502, ErrorCode.PROVIDER_SCHEMA_ERROR, UPSTREAM_DATA_UNAVAILABLE, log_detail=log_detail
    )


def provider_unavailable(message: str) -> ApiError:
    return ApiError(503, ErrorCode.PROVIDER_UNAVAILABLE, message, retryable=True)


def provider_timeout(message: str) -> ApiError:
    return ApiError(504, ErrorCode.PROVIDER_TIMEOUT, message, retryable=True)


# Für OpenAPI: Fehlerantworten je Route dokumentieren (ersetzt FastAPIs HTTPValidationError).
ERROR_RESPONSES: dict[int | str, dict[str, Any]] = {
    status: {"model": ErrorResponse, "description": description}
    for status, description in (
        (404, "Unknown or unsupported resource"),
        (422, "Invalid input"),
        (500, "Internal error"),
        (502, "Invalid provider response"),
        (503, "Provider temporarily unavailable"),
        (504, "Provider timeout"),
    )
}


def get_request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if not isinstance(request_id, str):
        request_id = str(uuid.uuid4())
        request.state.request_id = request_id
    return request_id


def _error_response(
    request: Request,
    status_code: int,
    code: ErrorCode,
    message: str,
    *,
    retryable: bool = False,
    details: dict[str, JsonValue] | None = None,
    headers: Mapping[str, str] | None = None,
) -> JSONResponse:
    request_id = get_request_id(request)
    body = ErrorResponse(
        error=ErrorBody(
            code=code,
            message=message,
            request_id=request_id,
            retryable=retryable,
            details=details,
        )
    )
    return JSONResponse(
        status_code=status_code,
        content=body.model_dump(mode="json"),
        headers={**(headers or {}), REQUEST_ID_HEADER: request_id},
    )


async def _handle_api_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ApiError)
    if exc.log_detail is not None:
        logger.warning(
            "%s on %s %s: %s",
            exc.code,
            request.method,
            request.url.path,
            exc.log_detail,
            exc_info=exc,
            extra={"request_id": get_request_id(request)},
        )
    return _error_response(
        request,
        exc.status_code,
        exc.code,
        exc.message,
        retryable=exc.retryable,
        details=exc.details,
    )


async def _handle_validation_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    # Nur loc/msg/type: keine Eingabewerte oder Python-Objekte zurückspiegeln.
    errors: list[JsonValue] = [
        {
            "loc": [str(part) for part in error.get("loc", ())],
            "msg": str(error.get("msg", "")),
            "type": str(error.get("type", "")),
        }
        for error in exc.errors()
    ]
    return _error_response(
        request,
        422,
        ErrorCode.VALIDATION_ERROR,
        "Request validation failed",
        details={"errors": errors},
    )


_HTTP_ERRORS: dict[int, tuple[ErrorCode, str]] = {
    404: (ErrorCode.NOT_FOUND, "Not found"),
    405: (ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed"),
}


def _http_error(status_code: int) -> tuple[ErrorCode, str]:
    """Framework-HTTP-Fehler (unbekannte Route, falsche Methode …): feste Meldung, kein detail."""
    if status_code in _HTTP_ERRORS:
        return _HTTP_ERRORS[status_code]
    try:
        phrase = HTTPStatus(status_code).phrase
    except ValueError:
        phrase = "HTTP error"
    if status_code >= 500:
        return ErrorCode.INTERNAL_ERROR, phrase
    return ErrorCode.BAD_REQUEST, phrase


async def _handle_http_error(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    code, message = _http_error(exc.status_code)
    # Header wie Allow (405) übernehmen; detail nie zurückgeben.
    return _error_response(request, exc.status_code, code, message, headers=exc.headers)


async def _handle_unexpected_error(request: Request, exc: Exception) -> Response:
    # Details (Typ, Text, Traceback) nur ins Server-Log, nie in die Antwort.
    logger.exception(
        "unhandled error on %s %s",
        request.method,
        request.url.path,
        extra={"request_id": get_request_id(request)},
    )
    return _error_response(request, 500, ErrorCode.INTERNAL_ERROR, "Internal server error")


async def _request_id_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    request_id = get_request_id(request)
    response = await call_next(request)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response


def install_error_handling(app: FastAPI) -> None:
    app.middleware("http")(_request_id_middleware)
    app.add_exception_handler(ApiError, _handle_api_error)
    app.add_exception_handler(RequestValidationError, _handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, _handle_http_error)
    app.add_exception_handler(Exception, _handle_unexpected_error)
