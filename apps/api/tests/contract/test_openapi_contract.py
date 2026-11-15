"""Vertragstest (B5): committetes packages/contracts/openapi.json ist der Vertrag.

- openapi.json entspricht dem frisch aus der App erzeugten Schema.
- Echte Antworten (Katalog, Compare, Fehler) erfüllen die Schemas aus openapi.json.
- Die TS-Typen prüft `openapi-typescript --check` in packages/contracts (pnpm check).

Ohne Zusatzabhängigkeit: kleiner Validator für die Teilmenge von JSON Schema, die
Pydantic/FastAPI hier erzeugt. Unbekannte Schlüsselwörter lassen den Test scheitern.
"""

import json
import math
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from trend_detective.api.errors import ErrorCode
from trend_detective.config import Settings
from trend_detective.dependencies import get_settings
from trend_detective.main import app, create_app

REPO_ROOT = Path(__file__).resolve().parents[4]
OPENAPI_PATH = REPO_ROOT / "packages" / "contracts" / "openapi.json"
GENERATED_TS = REPO_ROOT / "packages" / "contracts" / "src" / "generated.ts"

COMPARE_REQUEST: dict[str, Any] = {
    "variable_id": "temperature_2m",
    "locations": [
        {"id": "vienna", "latitude": 48.21, "longitude": 16.37},
        {"id": "madrid", "latitude": 40.42, "longitude": -3.70},
    ],
    "start_year": 1981,
    "end_year": 2025,
    "baseline": {"start_year": 1991, "end_year": 2020},
}

# Schlüsselwörter ohne Einfluss auf die Gültigkeit einer Instanz.
ANNOTATIONS = {"title", "description", "default", "examples", "format"}
SUPPORTED = ANNOTATIONS | {
    "$ref",
    "anyOf",
    "const",
    "enum",
    "type",
    "properties",
    "required",
    "additionalProperties",
    "items",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
}


@pytest.fixture(scope="module")
def spec() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(OPENAPI_PATH.read_text(encoding="utf-8"))
    return loaded


@pytest.fixture
def demo_client() -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: Settings(data_mode="demo")
    yield TestClient(app)
    app.dependency_overrides.clear()


def _type_ok(value: Any, expected: str) -> bool:
    match expected:
        case "object":
            return isinstance(value, dict)
        case "array":
            return isinstance(value, list)
        case "string":
            return isinstance(value, str)
        case "boolean":
            return isinstance(value, bool)
        case "integer":
            return isinstance(value, int) and not isinstance(value, bool)
        case "number":
            return (
                isinstance(value, int | float)
                and not isinstance(value, bool)
                and math.isfinite(value)
            )
        case "null":
            return value is None
    raise AssertionError(f"unsupported type {expected!r}")


def _errors(value: Any, schema: dict[str, Any], spec: dict[str, Any], path: str) -> list[str]:
    unknown = set(schema) - SUPPORTED
    assert not unknown, f"{path}: unsupported schema keywords {sorted(unknown)}"
    if "$ref" in schema:
        name = schema["$ref"].removeprefix("#/components/schemas/")
        return _errors(value, spec["components"]["schemas"][name], spec, path)
    if "anyOf" in schema:
        branches = [_errors(value, branch, spec, path) for branch in schema["anyOf"]]
        if any(not branch for branch in branches):
            return []
        return [f"{path}: matches no anyOf branch: {branches}"]
    if "const" in schema and value != schema["const"]:
        return [f"{path}: {value!r} != const {schema['const']!r}"]
    if "enum" in schema and value not in schema["enum"]:
        return [f"{path}: {value!r} not in enum"]
    if "type" in schema and not _type_ok(value, schema["type"]):
        return [f"{path}: expected {schema['type']}, got {type(value).__name__}"]
    found: list[str] = []
    if isinstance(value, dict):
        properties: dict[str, Any] = schema.get("properties", {})
        found += [
            f"{path}: missing {key}" for key in schema.get("required", []) if key not in value
        ]
        extra = schema.get("additionalProperties", True)
        for key, item in value.items():
            if key in properties:
                found += _errors(item, properties[key], spec, f"{path}.{key}")
            elif extra is False:
                found.append(f"{path}: unexpected property {key}")
            elif isinstance(extra, dict):
                found += _errors(item, extra, spec, f"{path}.{key}")
    if isinstance(value, list):
        if "items" in schema:
            for index, item in enumerate(value):
                found += _errors(item, schema["items"], spec, f"{path}[{index}]")
        if len(value) < schema.get("minItems", 0) or len(value) > schema.get("maxItems", math.inf):
            found.append(f"{path}: array length {len(value)} out of bounds")
    if isinstance(value, str) and not (
        schema.get("minLength", 0) <= len(value) <= schema.get("maxLength", math.inf)
    ):
        found.append(f"{path}: string length out of bounds")
    if _type_ok(value, "number") and not (
        schema.get("minimum", -math.inf) <= value <= schema.get("maximum", math.inf)
    ):
        found.append(f"{path}: {value} out of range")
    return found


def _response_schema(spec: dict[str, Any], path: str, method: str, status: int) -> dict[str, Any]:
    response = spec["paths"][path][method]["responses"][str(status)]
    schema: dict[str, Any] = response["content"]["application/json"]["schema"]
    return schema


def _assert_matches(value: Any, schema: dict[str, Any], spec: dict[str, Any]) -> None:
    assert _errors(value, schema, spec, "$") == []


def test_committed_openapi_matches_app(spec: dict[str, Any]) -> None:
    assert spec == create_app().openapi(), "packages/contracts veraltet: pnpm contracts ausführen"


def test_generated_ts_names_every_path_and_schema(spec: dict[str, Any]) -> None:
    generated = GENERATED_TS.read_text(encoding="utf-8")
    for path in spec["paths"]:
        assert f'"{path}": {{' in generated
    for name in spec["components"]["schemas"]:
        assert f"        {name}: " in generated
    for code in ErrorCode:
        assert f'"{code.value}"' in generated


def test_error_codes_match_enum(spec: dict[str, Any]) -> None:
    assert spec["components"]["schemas"]["ErrorCode"]["enum"] == [code.value for code in ErrorCode]


def test_compare_documents_error_format(spec: dict[str, Any]) -> None:
    responses = spec["paths"]["/api/v1/compare"]["post"]["responses"]
    assert set(responses) == {"200", "422", "500", "502", "503", "504"}
    for status in (422, 500, 502, 503, 504):
        assert _response_schema(spec, "/api/v1/compare", "post", status) == {
            "$ref": "#/components/schemas/ErrorResponse"
        }


def test_validator_detects_violations(spec: dict[str, Any]) -> None:
    error_schema = {"$ref": "#/components/schemas/ErrorResponse"}
    valid = {
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "m",
            "request_id": "r",
            "retryable": False,
            "details": None,
        }
    }
    _assert_matches(valid, error_schema, spec)
    broken = [
        {"error": {**valid["error"], "code": "NEW_CODE"}},
        {"error": {**valid["error"], "retryable": "no"}},
        {"error": {key: v for key, v in valid["error"].items() if key != "details"}},
        {**valid, "traceback": "x"},
    ]
    for payload in broken:
        assert _errors(payload, error_schema, spec, "$") != []


def test_health_matches_contract(spec: dict[str, Any]) -> None:
    response = TestClient(app).get("/api/v1/health")
    assert response.status_code == 200
    _assert_matches(response.json(), _response_schema(spec, "/api/v1/health", "get", 200), spec)


def test_catalog_matches_contract(spec: dict[str, Any], demo_client: TestClient) -> None:
    response = demo_client.get("/api/v1/catalog")
    assert response.status_code == 200
    _assert_matches(response.json(), _response_schema(spec, "/api/v1/catalog", "get", 200), spec)


def test_compare_success_matches_contract(spec: dict[str, Any], demo_client: TestClient) -> None:
    request_schema = spec["paths"]["/api/v1/compare"]["post"]["requestBody"]["content"][
        "application/json"
    ]["schema"]
    _assert_matches(COMPARE_REQUEST, request_schema, spec)
    response = demo_client.post("/api/v1/compare", json=COMPARE_REQUEST)
    assert response.status_code == 200
    _assert_matches(response.json(), _response_schema(spec, "/api/v1/compare", "post", 200), spec)


@pytest.mark.parametrize(
    ("patch", "status", "code"),
    [
        ({"baseline": {"start_year": 1981, "end_year": 2010}}, 422, "VALIDATION_ERROR"),
        ({"start_year": 1980}, 422, "VALIDATION_ERROR"),
        ({"variable_id": "precipitation"}, 422, "UNKNOWN_VARIABLE"),
        ({"variable_id": "foobar"}, 422, "UNKNOWN_VARIABLE"),
    ],
)
def test_compare_errors_match_contract(
    spec: dict[str, Any], demo_client: TestClient, patch: dict[str, Any], status: int, code: str
) -> None:
    response = demo_client.post("/api/v1/compare", json={**COMPARE_REQUEST, **patch})
    assert response.status_code == status
    body = response.json()
    _assert_matches(body, _response_schema(spec, "/api/v1/compare", "post", status), spec)
    assert body["error"]["code"] == code


def test_live_unavailable_error_matches_contract(spec: dict[str, Any]) -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(data_mode="live")
    try:
        response = TestClient(app).post("/api/v1/compare", json=COMPARE_REQUEST)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 503
    _assert_matches(response.json(), _response_schema(spec, "/api/v1/compare", "post", 503), spec)


def test_unknown_route_error_matches_contract(spec: dict[str, Any]) -> None:
    response = TestClient(app).get("/api/v1/does-not-exist")
    assert response.status_code == 404
    _assert_matches(response.json(), {"$ref": "#/components/schemas/ErrorResponse"}, spec)
