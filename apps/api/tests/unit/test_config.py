from pathlib import Path

import pytest

from trend_detective.config import API_DIR, REPO_ROOT, Settings


def test_relative_cache_dir_resolves_against_api_dir(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TD_CACHE_DIR", raising=False)
    monkeypatch.chdir("/")
    assert Settings().cache_dir == REPO_ROOT / "data" / "cache"


def test_absolute_cache_dir_is_kept(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setenv("TD_CACHE_DIR", str(tmp_path))
    assert Settings().cache_dir == tmp_path
    assert API_DIR.name == "api"
