"""Konfiguration aus Umgebung und apps/api/.env, unabhängig vom Arbeitsverzeichnis."""

from pathlib import Path
from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

API_DIR = Path(__file__).resolve().parents[2]
REPO_ROOT = API_DIR.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="TD_",
        env_file=API_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Default live (NASA POWER, Entscheidung Samuel E-66); Demo über TD_DATA_MODE=demo.
    data_mode: Literal["demo", "live"] = "live"
    cache_dir: Path = Path("../../data/cache")
    cache_ttl_seconds: int = Field(default=86400, ge=0)
    power_timeout_seconds: float = Field(default=15, gt=0)
    # geoBoundaries-Download (ADM3 rund 6 MB) beim ersten Regionsabruf.
    regions_timeout_seconds: float = Field(default=60, gt=0)
    # Letztes abgefragtes POWER-Jahr im Live-Modus; leer -> letztes vollständiges Kalenderjahr.
    power_end_year: int | None = Field(default=None, ge=1981)
    allowed_origins: list[str] = ["http://localhost:5173"]

    @field_validator("cache_dir")
    @classmethod
    def _resolve_cache_dir(cls, value: Path) -> Path:
        """Relative Pfade gelten gegen apps/api, nie gegen das Arbeitsverzeichnis."""
        return value if value.is_absolute() else (API_DIR / value).resolve()
