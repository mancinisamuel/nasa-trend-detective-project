"""DemoProvider: liest die synthetischen Demo-Daten (demo_temperature_v1), ohne Netz.

Die Datei erzeugt scripts/generate_demo.py. Provenienz nennt immer provider="synthetic" und
dataset="demo_temperature_v1", nie NASA. Ein in der Datei angegebener fill_value wird zu None.
"""

import datetime as dt
import hashlib
from collections.abc import Callable
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, ValidationError

from trend_detective.api.errors import ApiError, ErrorCode, provider_schema_error
from trend_detective.config import REPO_ROOT
from trend_detective.providers.base import MonthlySeries
from trend_detective.schemas.catalog import Location, Variable
from trend_detective.schemas.responses import Coordinates, MonthlyObservation, Provenance

DEMO_PROVIDER = "synthetic"
DEMO_DATASET = "demo_temperature_v1"
DEMO_UNIT = "degC"
DEMO_COMMUNITY = "synthetic"
DEFAULT_DEMO_FILE = REPO_ROOT / "data" / "demo" / "temperature_monthly.json"


class _FileModel(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True, allow_inf_nan=False)


class _DemoObservation(_FileModel):
    date: dt.date
    value: float | None


class _DemoSeries(_FileModel):
    location_id: str
    observations_monthly: list[_DemoObservation]


class _DemoFile(_FileModel):
    dataset: str
    provider: str
    synthetic: bool
    variable_id: str
    parameter: str
    unit: str
    fill_value: float | None = None
    generator_version: str | None = None
    series: Annotated[list[_DemoSeries], Field(min_length=1)]


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


class DemoProvider:
    def __init__(
        self, path: Path = DEFAULT_DEMO_FILE, *, clock: Callable[[], dt.datetime] = _utc_now
    ) -> None:
        self._path = path
        self._clock = clock
        self._loaded: tuple[_DemoFile, str] | None = None

    def _load(self) -> tuple[_DemoFile, str]:
        if self._loaded is None:
            try:
                raw = self._path.read_bytes()
            except OSError as exc:
                raise ApiError(
                    503, ErrorCode.PROVIDER_UNAVAILABLE, "Demo data file is not available"
                ) from exc
            try:
                doc = _DemoFile.model_validate_json(raw)
            except ValidationError as exc:
                raise provider_schema_error("Demo data file does not match the schema") from exc
            if doc.provider != DEMO_PROVIDER or doc.dataset != DEMO_DATASET or not doc.synthetic:
                raise provider_schema_error("Demo data file is not the synthetic demo dataset")
            if doc.unit != DEMO_UNIT:
                raise provider_schema_error(f"Unexpected demo unit: {doc.unit}")
            self._loaded = (doc, hashlib.sha256(raw).hexdigest())
        return self._loaded

    async def fetch_monthly(
        self, location: Location, variable: Variable, start_year: int, end_year: int
    ) -> MonthlySeries:
        doc, raw_sha256 = self._load()
        if variable.id != doc.variable_id or variable.provider_parameter != doc.parameter:
            raise ApiError(
                422,
                ErrorCode.UNKNOWN_VARIABLE,
                f"Variable not available in demo data: {variable.id}",
                details={"variable_id": variable.id},
            )
        entry = next((s for s in doc.series if s.location_id == location.id), None)
        if entry is None:
            raise ApiError(
                422,
                ErrorCode.UNKNOWN_LOCATION,
                f"Location not available in demo data: {location.id}",
                details={"location_id": location.id},
            )
        return MonthlySeries(
            observations=_normalise(
                entry.observations_monthly, doc.fill_value, start_year, end_year
            ),
            provenance=Provenance(
                provider=DEMO_PROVIDER,
                dataset=DEMO_DATASET,
                parameter=doc.parameter,
                community=DEMO_COMMUNITY,
                requested_coordinates=Coordinates(
                    latitude=location.latitude, longitude=location.longitude
                ),
                returned_coordinates=None,
                retrieved_at=self._clock(),
                source_url=None,
                raw_sha256=raw_sha256,
                provider_version=doc.generator_version,
            ),
        )


def _normalise(
    raw: list[_DemoObservation], fill_value: float | None, start_year: int, end_year: int
) -> tuple[MonthlyObservation, ...]:
    by_date: dict[dt.date, float | None] = {}
    for obs in raw:
        if obs.date.day != 1:
            raise provider_schema_error(f"Demo date is not the first of a month: {obs.date}")
        if obs.date in by_date:
            raise provider_schema_error(f"Duplicate demo month: {obs.date}")
        value = obs.value
        if fill_value is not None and value == fill_value:
            value = None
        by_date[obs.date] = value
    return tuple(
        MonthlyObservation(date=date, value=value, quality_flags=[])
        for date, value in sorted(by_date.items())
        if start_year <= date.year <= end_year
    )
