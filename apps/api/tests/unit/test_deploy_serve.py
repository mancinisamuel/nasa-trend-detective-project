"""deploy/serve.py: SPA fallback for unknown paths, JSON 404 for /api (E-88).

serve.py mounts onto `trend_detective.main.app` at import time. The test loads it against a
fresh app from create_app() so the shared app of the other tests stays untouched.
"""

import importlib.util
import sys
import types
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from trend_detective.main import create_app

SERVE_PY = Path(__file__).resolve().parents[4] / "deploy" / "serve.py"
INDEX_HTML = "<!doctype html><title>Trend Detective</title>"


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    (tmp_path / "assets").mkdir()
    (tmp_path / "assets" / "x.js").write_text("console.log(1);")
    (tmp_path / "demo").mkdir()
    (tmp_path / "demo" / "index.html").write_text(INDEX_HTML)
    (tmp_path / "index.html").write_text(INDEX_HTML)
    monkeypatch.setenv("TD_WEB_DIST", str(tmp_path))

    fake_main = types.ModuleType("trend_detective.main")
    fake_main.app = create_app()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "trend_detective.main", fake_main)

    spec = importlib.util.spec_from_file_location("td_deploy_serve", SERVE_PY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return TestClient(module.app, follow_redirects=False)


def test_root_serves_index(client: TestClient) -> None:
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")
    assert response.text == INDEX_HTML


@pytest.mark.parametrize("path", ["/xyz", "/some/deep/path"])
def test_unknown_path_serves_index_with_404(client: TestClient, path: str) -> None:
    response = client.get(path)
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("text/html")
    assert response.text == INDEX_HTML


def test_unknown_api_path_keeps_json_404(client: TestClient) -> None:
    response = client.get("/api/v1/doesnotexist")
    assert response.status_code == 404
    assert response.headers["content-type"].startswith("application/json")


def test_demo_redirects_to_trailing_slash(client: TestClient) -> None:
    response = client.get("/demo")
    assert response.status_code == 307
    assert response.headers["location"].endswith("/demo/")


def test_demo_slash_serves_index(client: TestClient) -> None:
    response = client.get("/demo/")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/html")


def test_real_asset_is_served(client: TestClient) -> None:
    response = client.get("/assets/x.js")
    assert response.status_code == 200
    assert response.text == "console.log(1);"
