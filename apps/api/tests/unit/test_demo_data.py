"""C1: synthetische Demo-Daten und Fehler-Fixtures (scripts/generate_demo.py).

Referenzwerte (NASA POWER T2M, Klimatologie 1991-2020, Gitterpunkte Wien/Madrid) stehen als
Konstanten hier und nicht aus dem Generator gelesen, damit der Test unabhängig bleibt.
Toleranzen: Trend ±0.25 °C/Dekade (etwa 3 Standardfehler der OLS-Steigung bei 45 Jahren und
Residuen-SD 0.5-0.7), Baseline-Mittel ±0.5 °C. Seeds sind fest, die Daten also deterministisch.
"""

import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from trend_detective.config import REPO_ROOT
from trend_detective.schemas.catalog import LOCATIONS

SCRIPT = REPO_ROOT / "scripts" / "generate_demo.py"
SERIES = Path("data/demo/temperature_monthly.json")
MANIFEST = Path("apps/api/tests/fixtures/demo_manifest.json")
FIXTURES = Path("apps/api/tests/fixtures/demo")
FIXTURE_NAMES = (
    "series_gap.json",
    "series_fill_values.json",
    "series_incomplete_year.json",
    "series_20_years.json",
    "series_no_baseline.json",
)
GENERATED = (SERIES, MANIFEST, *(FIXTURES / n for n in FIXTURE_NAMES))

# location_id -> (Ziel-Trend °C/Dekade, Referenz-Baseline-Mittel °C, Jan, Jul)
REFERENCE = {
    "vienna": (0.45, 9.404, -1.776, 20.598),
    "madrid": (0.35, 13.239, 3.537, 25.012),
}
TREND_TOL = 0.25
BASELINE_TOL = 0.5
FILL_VALUE = -999.0


def _load(rel: Path) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((REPO_ROOT / rel).read_text(encoding="utf-8"))
    return data


def _obs(doc: dict[str, Any], location_id: str = "vienna") -> list[dict[str, Any]]:
    entry = next(s for s in doc["series"] if s["location_id"] == location_id)
    observations: list[dict[str, Any]] = entry["observations_monthly"]
    return observations


def _annual_means(observations: list[dict[str, Any]]) -> dict[int, float]:
    by_year: dict[int, list[float]] = {}
    for o in observations:
        if o["value"] is not None:
            by_year.setdefault(int(o["date"][:4]), []).append(float(o["value"]))
    return {y: sum(v) / 12 for y, v in by_year.items() if len(v) == 12}


def _ols_per_decade(means: dict[int, float]) -> float:
    xs = list(means)
    x_mean = sum(xs) / len(xs)
    y_mean = sum(means.values()) / len(xs)
    sxy = sum((x - x_mean) * (means[x] - y_mean) for x in xs)
    sxx = sum((x - x_mean) ** 2 for x in xs)
    return 10 * sxy / sxx


def _generate(root: Path) -> None:
    subprocess.run(
        [sys.executable, str(SCRIPT), "--root", str(root)],
        check=True,
        capture_output=True,
    )


def test_generator_is_byte_identical_and_matches_repo(tmp_path: Path) -> None:
    first, second = tmp_path / "a", tmp_path / "b"
    _generate(first)
    _generate(second)
    for rel in GENERATED:
        fresh = (first / rel).read_bytes()
        assert fresh == (second / rel).read_bytes(), rel
        assert fresh == (REPO_ROOT / rel).read_bytes(), f"{rel} veraltet: generate_demo.py laufen"
        assert fresh.endswith(b"\n")


def test_demo_series_is_complete_and_labelled_synthetic() -> None:
    doc = _load(SERIES)
    assert doc["dataset"] == "demo_temperature_v1"
    assert doc["provider"] == "synthetic"
    assert doc["synthetic"] is True
    assert doc["variable_id"] == "temperature_2m"
    assert doc["unit"] == "degC"
    catalog = {loc.id: (loc.latitude, loc.longitude) for loc in LOCATIONS}
    assert [s["location_id"] for s in doc["series"]] == ["vienna", "madrid"]
    expected_dates = [f"{y:04d}-{m:02d}-01" for y in range(1981, 2026) for m in range(1, 13)]
    for entry in doc["series"]:
        assert (entry["latitude"], entry["longitude"]) == catalog[entry["location_id"]]
        observations = entry["observations_monthly"]
        assert len(observations) == 540
        assert [o["date"] for o in observations] == expected_dates
        for o in observations:
            assert isinstance(o["value"], float)
            assert math.isfinite(o["value"])
            assert -30.0 < o["value"] < 45.0


@pytest.mark.parametrize("location_id", ["vienna", "madrid"])
def test_trend_and_baseline_match_reference(location_id: str) -> None:
    trend, baseline_mean, jan, jul = REFERENCE[location_id]
    observations = _obs(_load(SERIES), location_id)
    means = _annual_means(observations)
    assert len(means) == 45
    assert abs(_ols_per_decade(means) - trend) <= TREND_TOL
    baseline = [v for y, v in means.items() if 1991 <= y <= 2020]
    assert abs(sum(baseline) / len(baseline) - baseline_mean) <= BASELINE_TOL
    # Saisonzyklus: Januar kältester, Juli wärmster Monat der Klimatologie 1991-2020.
    clim = {
        m: sum(
            o["value"]
            for o in observations
            if int(o["date"][5:7]) == m and 1991 <= int(o["date"][:4]) <= 2020
        )
        / 30
        for m in range(1, 13)
    }
    assert min(clim, key=lambda m: clim[m]) == 1
    assert max(clim, key=lambda m: clim[m]) == 7
    assert abs(clim[1] - jan) <= 1.5
    assert abs(clim[7] - jul) <= 1.5


def test_manifest_documents_dataset_and_trends() -> None:
    manifest = _load(MANIFEST)
    assert manifest["dataset"] == "demo_temperature_v1"
    assert manifest["provider"] == "synthetic"
    assert manifest["synthetic"] is True
    assert "Not measurements and not NASA data" in manifest["notice"]
    assert manifest["generator"]["path"] == "scripts/generate_demo.py"
    for loc in manifest["locations"]:
        assert isinstance(loc["seed"], int)
        trend, *_ = REFERENCE[loc["location_id"]]
        assert loc["parameters"]["trend_per_decade_degC"] == trend
        realised = loc["realised"]["ols_trend_per_decade_degC_1981_2025"]
        assert abs(realised - trend) <= TREND_TOL
    digest = hashlib.sha256((REPO_ROOT / SERIES).read_bytes()).hexdigest()
    assert manifest["files"][str(SERIES)]["sha256"] == digest


def _fixture(name: str) -> list[dict[str, Any]]:
    doc = _load(FIXTURES / name)
    assert doc["synthetic"] is True
    assert doc["provider"] == "synthetic"
    return _obs(doc)


def test_fixture_gap_has_null_months() -> None:
    observations = _fixture("series_gap.json")
    missing = [o["date"] for o in observations if o["value"] is None]
    assert missing == ["2003-06-01", "2003-07-01", "2003-08-01", "2010-01-01"]
    assert len(observations) == 540
    assert 2003 not in _annual_means(observations)


def test_fixture_fill_values_are_raw_minus_999() -> None:
    observations = _fixture("series_fill_values.json")
    filled = [o["date"] for o in observations if o["value"] == FILL_VALUE]
    assert filled == ["1995-02-01", "2012-11-01", "2018-07-01"]
    assert all(o["value"] is not None for o in observations)


def test_fixture_incomplete_year_has_six_months_in_2025() -> None:
    observations = _fixture("series_incomplete_year.json")
    months_2025 = [o["date"] for o in observations if o["date"].startswith("2025-")]
    assert months_2025 == [f"2025-{m:02d}-01" for m in range(1, 7)]
    assert max(_annual_means(observations)) == 2024


def test_fixture_short_series_has_twenty_years() -> None:
    means = _annual_means(_fixture("series_20_years.json"))
    assert sorted(means) == list(range(2006, 2026))


def test_fixture_without_baseline_has_no_1991_2020_values() -> None:
    observations = _fixture("series_no_baseline.json")
    in_baseline = [o for o in observations if 1991 <= int(o["date"][:4]) <= 2020]
    assert len(in_baseline) == 360
    assert all(o["value"] is None for o in in_baseline)
    assert sorted(_annual_means(observations)) == [*range(1981, 1991), *range(2021, 2026)]
