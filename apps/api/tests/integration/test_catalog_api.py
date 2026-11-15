from fastapi.testclient import TestClient

from trend_detective.main import app


def test_catalog_lists_variables_locations_and_mode() -> None:
    response = TestClient(app).get("/api/v1/catalog")
    assert response.status_code == 200
    body = response.json()
    assert body["data_mode"] in {"demo", "live"}
    variables = {v["id"]: v for v in body["variables"]}
    assert variables["temperature_2m"]["enabled"] is True
    assert variables["temperature_2m"]["unit"] == "degC"
    assert variables["precipitation"]["enabled"] is True
    assert variables["precipitation"]["unit"] == "mm/year"
    assert variables["precipitation"]["aggregation"] == "calendar_day_sum"
    assert variables["relative_humidity_2m"]["unit"] == "%"
    assert variables["wind_speed_2m"]["unit"] == "m/s"
    ids = {loc["id"] for loc in body["locations"]}
    assert {"vienna", "madrid", "at", "at-wien"} <= ids
    assert next(loc for loc in body["locations"] if loc["id"] == "at")["spatial_kind"] == "region"
    assert body["year_bounds"] == {"min_year": 1981, "max_year": 2025, "max_years_per_request": 50}
    assert body["default_baseline"] == {"start_year": 1991, "end_year": 2020}
    assert body["method"]["hac_maxlags"] == 3
    assert body["method"]["min_years"] == 3
    for variable in body["variables"]:
        assert variable["available_from_year"] == 1981
        assert variable["available_to_year"] == body["year_bounds"]["max_year"]
