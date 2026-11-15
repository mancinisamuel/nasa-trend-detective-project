"""ExtremesService: POWER-Tageswerte -> Jahreskennzahlen -> Trend wie bei Compare.

Bundesländer/States (B-EXTCAP, Entscheidung Potter): genau ein daily/point-Abruf an der
Hauptstadt statt Flächenmittel; at gesamt = Wien. provenance.spatial_method "capital_point" und
provenance.capital_name machen das sichtbar. Grund: Flächenmittel bräuchte einen Tagesabruf je
Zelle (Texas 235, Alaska 552), daily/regional lehnt 1981-2025 mit HTTP 422 ab.
"""

import datetime as dt
from collections.abc import Callable, Sequence
from dataclasses import dataclass, replace

from trend_detective.domain import extremes as ext
from trend_detective.domain.austria import AUSTRIA_ID
from trend_detective.domain.capitals import AUSTRIA_CAPITAL_NAMES, US_CAPITALS, Capital
from trend_detective.domain.quality import longest_common_run
from trend_detective.domain.trend import fit_trend
from trend_detective.providers.power_daily import PowerDailyProvider
from trend_detective.schemas.catalog import LOCATIONS, DataMode, Location
from trend_detective.schemas.extremes import (
    ExtremeMetric,
    ExtremeMetrics,
    ExtremesResponse,
    ExtremeThresholds,
    ExtremeYearValue,
)
from trend_detective.schemas.responses import CacheStatus, Coordinates, Provenance, TrendResult
from trend_detective.services.compare import trend_result

EXTREMES_ANALYSIS_VERSION = "extremes-annual-ols-hac-v1"
AUSTRIA_CAPITAL_STATE = "at-wien"

THRESHOLDS = ExtremeThresholds(
    hot_day_tmax_c=ext.HOT_DAY_TMAX_C,
    tropical_night_tmin_c=ext.TROPICAL_NIGHT_TMIN_C,
    frost_day_tmin_c=ext.FROST_DAY_TMIN_C,
    ice_day_tmax_c=ext.ICE_DAY_TMAX_C,
    wet_day_mm=ext.WET_DAY_MM,
    heavy_rain_mm=ext.HEAVY_RAIN_MM,
    dry_day_below_mm=ext.DRY_DAY_BELOW_MM,
    radiation_from_year=ext.RADIATION_FROM_YEAR,
)


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def capital_of(location: Location) -> Capital | None:
    """Hauptstadt eines Bundeslands/States (at = Wien), sonst None (Punkt-Orte)."""
    if location.id in US_CAPITALS:
        return US_CAPITALS[location.id]
    state_id = AUSTRIA_CAPITAL_STATE if location.id == AUSTRIA_ID else location.id
    name = AUSTRIA_CAPITAL_NAMES.get(state_id)
    if name is None:
        return None
    state = next(loc for loc in LOCATIONS if loc.id == state_id)
    return Capital(name, state.latitude, state.longitude)


def metric_trend(series: Sequence[ext.YearValue]) -> TrendResult | None:
    """Gleiche Regel wie Compare: längste zusammenhängende Folge gültiger Jahre, ab 3 Jahren."""
    by_year = {item.year: item.value for item in series if item.value is not None}
    run = longest_common_run(by_year)
    trend = fit_trend([(year, by_year[year]) for year in run])
    return None if trend is None else trend_result(trend)


@dataclass(frozen=True)
class _Part:
    annual: dict[ext.MetricId, list[ext.YearValue]]
    data_end: dt.date | None
    cache_status: CacheStatus
    provenance: Provenance


class ExtremesService:
    def __init__(
        self,
        provider: PowerDailyProvider,
        *,
        clock: Callable[[], dt.datetime] = _utc_now,
    ) -> None:
        self._provider = provider
        self._clock = clock

    async def extremes(
        self,
        latitude: float,
        longitude: float,
        start_year: int,
        end_year: int,
        request_id: str,
        data_mode: DataMode,
    ) -> ExtremesResponse:
        part = await self._point(latitude, longitude, start_year, end_year)
        coordinates = Coordinates(latitude=latitude, longitude=longitude)
        return self._response(part, coordinates, start_year, end_year, request_id, data_mode)

    async def extremes_for_location(
        self,
        location: Location,
        start_year: int,
        end_year: int,
        request_id: str,
        data_mode: DataMode,
    ) -> ExtremesResponse:
        """Katalogort: Bundesland/State/at an der Hauptstadt, sonst der Ort selbst."""
        capital = capital_of(location)
        if capital is None:
            return await self.extremes(
                location.latitude, location.longitude, start_year, end_year, request_id, data_mode
            )
        part = await self._point(capital.latitude, capital.longitude, start_year, end_year)
        provenance = part.provenance.model_copy(
            update={"spatial_method": "capital_point", "capital_name": capital.name}
        )
        coordinates = Coordinates(latitude=capital.latitude, longitude=capital.longitude)
        return self._response(
            replace(part, provenance=provenance),
            coordinates,
            start_year,
            end_year,
            request_id,
            data_mode,
        )

    async def _point(self, latitude: float, longitude: float, start: int, end: int) -> _Part:
        daily = await self._provider.fetch_daily(latitude, longitude, start, end)
        return _Part(
            annual=ext.annual_extremes(daily.values, start, end),
            data_end=daily.data_end,
            cache_status=daily.cache_status,
            provenance=daily.provenance,
        )

    def _response(
        self,
        part: _Part,
        coordinates: Coordinates,
        start_year: int,
        end_year: int,
        request_id: str,
        data_mode: DataMode,
    ) -> ExtremesResponse:
        annual = part.annual
        metrics = {
            spec.id: ExtremeMetric(
                parameter=spec.parameter,
                unit=spec.unit,
                series=[
                    ExtremeYearValue(year=item.year, value=item.value, date=item.date)
                    for item in annual[spec.id]
                ],
                trend=metric_trend(annual[spec.id]),
            )
            for spec in ext.METRICS
        }
        return ExtremesResponse(
            analysis_version=EXTREMES_ANALYSIS_VERSION,
            request_id=request_id,
            data_mode=data_mode,
            cache_status=part.cache_status,
            generated_at=self._clock(),
            coordinates=coordinates,
            start_year=start_year,
            end_year=end_year,
            data_end=part.data_end,
            thresholds=THRESHOLDS,
            metrics=ExtremeMetrics(**metrics),
            provenance=part.provenance,
        )
