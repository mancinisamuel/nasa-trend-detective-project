import json
import logging
import uuid
from collections.abc import Iterator

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from trend_detective.api.errors import (
    REQUEST_ID_HEADER,
    ApiError,
    ErrorCode,
    install_error_handling,
    provider_schema_error,
    provider_timeout,
    provider_unavailable,
)
from trend_detective.config import Settings
from trend_detective.dependencies import get_settings
from trend_detective.main import app

SECRET = "secret-upstream https://power.larc.nasa.gov/api/x?token=abc"


class Body(BaseModel):
    year: int


def _error_app() -> FastAPI:
    test_app = FastAPI()
    install_error_handling(test_app)

    @test_app.get("/fail/{kind}")
    def fail(kind: str) -> None:
        errors = {
            "disabled": ApiError(422, ErrorCode.VARIABLE_DISABLED, "disabled"),
            "schema": provider_schema_error("bad schema"),
            "unavailable": provider_unavailable("down"),
            "timeout": provider_timeout("slow"),
        }
        if kind in errors:
            raise errors[kind]
        if kind == "teapot":
            raise HTTPException(418, detail=SECRET)
        raise RuntimeError("secret traceback detail")

    @test_app.post("/body")
    def body(payload: Body) -> int:
        return payload.year

    return test_app


def _assert_error(response_json: object, code: str, retryable: bool) -> dict[str, object]:
    assert isinstance(response_json, dict)
    assert set(response_json) == {"error"}
    error = response_json["error"]
    assert isinstance(error, dict)
    assert set(error) == {"code", "message", "request_id", "retryable", "details"}
    assert error["code"] == code
    assert error["retryable"] is retryable
    uuid.UUID(error["request_id"])
    return error


@pytest.mark.parametrize(
    ("kind", "status", "code", "retryable"),
    [
        ("disabled", 422, "VARIABLE_DISABLED", False),
        ("schema", 502, "PROVIDER_SCHEMA_ERROR", False),
        ("unavailable", 503, "PROVIDER_UNAVAILABLE", True),
        ("timeout", 504, "PROVIDER_TIMEOUT", True),
    ],
)
def test_api_errors_use_error_format(kind: str, status: int, code: str, retryable: bool) -> None:
    response = TestClient(_error_app()).get(f"/fail/{kind}")
    assert response.status_code == status
    error = _assert_error(response.json(), code, retryable)
    assert response.headers[REQUEST_ID_HEADER] == error["request_id"]


def test_validation_error_uses_error_format() -> None:
    # Nicht-hexadezimaler Eingabewert: kann nicht zufällig in der request_id stehen.
    bad_value = "xyz-not-int"
    response = TestClient(_error_app()).post("/body", json={"year": bad_value})
    assert response.status_code == 422
    error = _assert_error(response.json(), "VALIDATION_ERROR", False)
    details = error["details"]
    assert isinstance(details, dict)
    assert details["errors"][0]["loc"] == ["body", "year"]
    # Der Eingabewert wird nicht zurückgespiegelt (weder in Details noch in der Meldung).
    echoed = json.dumps({k: v for k, v in error.items() if k != "request_id"})
    assert bad_value not in echoed


def test_unexpected_error_hides_traceback() -> None:
    client = TestClient(_error_app(), raise_server_exceptions=False)
    response = client.get("/fail/crash")
    assert response.status_code == 500
    error = _assert_error(response.json(), "INTERNAL_ERROR", False)
    assert error["message"] == "Internal server error"
    assert "secret" not in response.text
    assert "Traceback" not in response.text


@pytest.mark.parametrize("path", ["/api/v1/does-not-exist", "/nope", "/api/v1/regions/x/y/z"])
def test_unknown_route_uses_error_format(path: str) -> None:
    response = TestClient(app).get(path)
    assert response.status_code == 404
    error = _assert_error(response.json(), "NOT_FOUND", False)
    assert error["message"] == "Not found"
    assert error["details"] is None
    assert response.headers[REQUEST_ID_HEADER] == error["request_id"]


def test_wrong_method_uses_error_format_and_keeps_allow() -> None:
    response = TestClient(app).delete("/api/v1/health")
    assert response.status_code == 405
    error = _assert_error(response.json(), "METHOD_NOT_ALLOWED", False)
    assert error["message"] == "Method not allowed"
    assert "GET" in response.headers["allow"]


def test_other_http_error_hides_detail() -> None:
    response = TestClient(_error_app()).get("/fail/teapot")
    assert response.status_code == 418
    error = _assert_error(response.json(), "BAD_REQUEST", False)
    assert error["message"] == "I'm a Teapot"
    assert "secret" not in response.text


@pytest.fixture
def crashing_settings() -> Iterator[None]:
    def boom() -> Settings:
        raise RuntimeError(SECRET)

    app.dependency_overrides[get_settings] = boom
    try:
        yield
    finally:
        app.dependency_overrides.clear()


@pytest.mark.usefixtures("crashing_settings")
def test_unexpected_error_in_app_is_500_without_details(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client = TestClient(app, raise_server_exceptions=False)
    with caplog.at_level(logging.ERROR, logger="trend_detective.api.errors"):
        response = client.get("/api/v1/catalog")
    assert response.status_code == 500
    error = _assert_error(response.json(), "INTERNAL_ERROR", False)
    assert error == {**error, "message": "Internal server error", "details": None}
    assert response.headers[REQUEST_ID_HEADER] == error["request_id"]
    for leak in ("secret", "power.larc", "token", "RuntimeError", "Traceback", "boom", ".py"):
        assert leak not in response.text
    # Details nur im Server-Log: Text, Typ und Traceback.
    record = next(r for r in caplog.records if r.name == "trend_detective.api.errors")
    assert record.exc_info is not None
    assert "GET /api/v1/catalog" in record.getMessage()
    assert getattr(record, "request_id", None) == error["request_id"]
    assert SECRET in caplog.text
    assert "RuntimeError" in caplog.text
    assert "Traceback" in caplog.text


def test_success_carries_request_id_header() -> None:
    response = TestClient(app).get("/api/v1/health")
    uuid.UUID(response.headers[REQUEST_ID_HEADER])
