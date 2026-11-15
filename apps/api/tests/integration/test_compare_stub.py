import copy
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from trend_detective.config import Settings
from trend_detective.dependencies import get_settings
from trend_detective.main import app
from trend_detective.schemas.responses import CompareResponse

VALID: dict[str, Any] = {
    "variable_id": "temperature_2m",
    "locations": [
        {"id": "vienna", "latitude": 48.21, "longitude": 16.37},
        {"id": "madrid", "latitude": 40.42, "longitude": -3.70},
    ],
    "start_year": 1981,
    "end_year": 2025,
    "baseline": {"start_year": 1991, "end_year": 2020},
}


@pytest.fixture
def client() -> Iterator[TestClient]:
    app.dependency_overrides[get_settings] = lambda: Settings(data_mode="demo")
    yield TestClient(app)
    app.dependency_overrides.clear()


def _post(client: TestClient, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    response = client.post("/api/v1/compare", json=payload)
    return response.status_code, response.json()


def test_returns_valid_demo_response(client: TestClient) -> None:
    status, body = _post(client, VALID)
    assert status == 200
    result = CompareResponse.model_validate(body)
    assert result.data_mode == "demo"
    assert result.schema_version == "1.0"
    assert [s.location.id for s in result.series] == ["vienna", "madrid"]
    for series in result.series:
        assert series.trend is not None
        assert series.observations_monthly != []
        assert series.provenance.provider == "synthetic"
        assert series.provenance.dataset == "demo_temperature_v1"
        assert series.quality.warnings == []


def test_baseline_1991_2020_is_accepted(client: TestClient) -> None:
    status, body = _post(client, VALID)
    assert status == 200
    assert body["request"]["baseline"] == {"start_year": 1991, "end_year": 2020}
    without_baseline = {k: v for k, v in VALID.items() if k != "baseline"}
    status, body = _post(client, without_baseline)
    assert status == 200
    assert body["request"]["baseline"] == {"start_year": 1991, "end_year": 2020}


@pytest.mark.parametrize(
    "baseline",
    [
        {"start_year": 1981, "end_year": 2010},
        {"start_year": 1991, "end_year": 2019},
        {"start_year": 1992, "end_year": 2020},
        {"start_year": 1981},
    ],
)
def test_other_baseline_is_rejected(client: TestClient, baseline: dict[str, int]) -> None:
    status, body = _post(client, _variant(["baseline"], baseline))
    assert status == 422
    assert set(body["error"]) == {"code", "message", "request_id", "retryable", "details"}
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert body["error"]["retryable"] is False
    assert body["error"]["details"]["errors"][0]["loc"][:2] == ["body", "baseline"]


def test_result_id_is_stable_and_request_id_differs(client: TestClient) -> None:
    _, first = _post(client, VALID)
    _, second = _post(client, VALID)
    assert first["result_id"] == second["result_id"]
    assert first["request_id"] != second["request_id"]


def _variant(path: list[Any], value: Any) -> dict[str, Any]:
    payload = copy.deepcopy(VALID)
    target: Any = payload
    for key in path[:-1]:
        target = target[key]
    target[path[-1]] = value
    return payload


@pytest.mark.parametrize(
    ("payload", "code"),
    [
        (_variant(["variable_id"], "foobar"), "UNKNOWN_VARIABLE"),
        (_variant(["variable_id"], "precipitation"), "UNKNOWN_VARIABLE"),
        (_variant(["locations", 1, "id"], "paris"), "UNKNOWN_LOCATION"),
        (_variant(["locations", 1, "latitude"], 41.0), "LOCATION_MISMATCH"),
        (_variant(["locations", 1], VALID["locations"][0]), "VALIDATION_ERROR"),
        (_variant(["locations"], []), "VALIDATION_ERROR"),
        (
            _variant(["locations"], [*VALID["locations"], VALID["locations"][0]]),
            "VALIDATION_ERROR",
        ),
        (_variant(["start_year"], 1980), "VALIDATION_ERROR"),
        (_variant(["end_year"], 2026), "VALIDATION_ERROR"),
        (_variant(["start_year"], 2010) | {"end_year": 2000}, "VALIDATION_ERROR"),
        (_variant(["locations", 0, "longitude"], 181), "VALIDATION_ERROR"),
        (_variant(["baseline"], {"start_year": 2020, "end_year": 1991}), "VALIDATION_ERROR"),
        (_variant(["extra"], 1), "VALIDATION_ERROR"),
    ],
)
def test_invalid_input_returns_422(client: TestClient, payload: dict[str, Any], code: str) -> None:
    status, body = _post(client, payload)
    assert status == 422
    assert body["error"]["code"] == code
    assert body["error"]["retryable"] is False


def test_live_mode_is_not_silently_replaced_by_demo() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(data_mode="live")
    try:
        response = TestClient(app).post("/api/v1/compare", json=VALID)
    finally:
        app.dependency_overrides.clear()
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "PROVIDER_UNAVAILABLE"
