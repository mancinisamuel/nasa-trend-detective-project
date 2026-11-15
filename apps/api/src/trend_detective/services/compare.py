"""CompareService: Provider-Abruf, Domain-Analyse und Antwort (Brief §02, §09).

Trend (OLS/HAC, Brief §09.3-5) je Standort über die längste gemeinsame Folge vollständiger
Jahre; unter 3 Jahren trend=null und insufficient_data, unter 10 Jahren Flag short_period
(D-05). Bei nur einem Standort (V-1) ist die gemeinsame Folge die längste zusammenhängende
Folge vollständiger Jahre dieser Serie.
"""

import asyncio
import datetime as dt
import hashlib
import json
from collections.abc import Callable, Sequence
from typing import Protocol

from trend_detective.api.cancel import gather_or_cancel
from trend_detective.api.errors import provider_schema_error
from trend_detective.domain import geometry as geo
from trend_detective.domain.annualize import annual_means, annual_sums, complete_years
from trend_detective.domain.anomalies import anomalies, baseline_mean
from trend_detective.domain.austria import (
    AUSTRIA_ID,
    AUSTRIA_STATE_ADM1,
    AUSTRIA_STATE_AREAS_KM2,
    area_weighted_monthly,
)
from trend_detective.domain.models import AnnualValue, MonthlyValue
from trend_detective.domain.power_grid import GridCell, grid_cells
from trend_detective.domain.quality import (
    MIN_TREND_YEARS,
    coverage_fraction,
    longest_common_run,
    missing_months,
)
from trend_detective.domain.trend import METHOD, METHOD_VERSION, Trend, fit_trend
from trend_detective.domain.usa import US_STATE_ADM1, US_STATE_AREAS_KM2, USA_ID
from trend_detective.providers.base import ClimateProvider, MonthlySeries
from trend_detective.providers.power import PowerProvider
from trend_detective.schemas.catalog import (
    ANALYSIS_VERSION,
    LOCATIONS,
    Aggregation,
    DataMode,
    Location,
    Variable,
)
from trend_detective.schemas.regions import RegionResponse
from trend_detective.schemas.requests import CompareRequest, point_location_id
from trend_detective.schemas.responses import (
    AnnualAnomaly,
    AnnualObservation,
    CacheStatus,
    CompareResponse,
    Comparison,
    Coordinates,
    MonthlyObservation,
    Provenance,
    QualityReport,
    QualityStatus,
    SeriesResult,
    SpatialMethod,
    TrendPoint,
    TrendResult,
)

WARNING_MISSING_MONTHS = "missing_months"
WARNING_MISSING_BASELINE = "missing_baseline"
WARNING_INSUFFICIENT_DATA = "insufficient_data"

# Katalog-Id -> (Land ISO3, adm1_id): Orte, die live als Zellmittel gerechnet werden.
STATE_BOUNDARY: dict[str, tuple[str, str]] = {
    **{k: ("AUT", v) for k, v in AUSTRIA_STATE_ADM1.items()},
    **{k: ("USA", v) for k, v in US_STATE_ADM1.items()},
}
# Region-Id -> Fläche (km²) je Mitglied; Region = flächengewichtetes Mittel der Mitglieder.
REGION_MEMBER_AREAS: dict[str, dict[str, float]] = {
    AUSTRIA_ID: AUSTRIA_STATE_AREAS_KM2,
    USA_ID: US_STATE_AREAS_KM2,
}


class StateBoundaries(Protocol):
    """Bundesland-Polygon (RegionService: geoBoundaries + FileCache)."""

    async def get_region(self, country_iso3: str, adm1_id: str) -> RegionResponse: ...


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.UTC)


def result_id(request: CompareRequest, raw_hashes: Sequence[str]) -> str:
    """Hash aus kanonischem Request, Rohdaten-Hashes und Analyseversion (ohne Zeit/request_id)."""
    canonical = json.dumps(
        {
            "request": request.model_dump(mode="json"),
            "raw_sha256": list(raw_hashes),
            "analysis_version": ANALYSIS_VERSION,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def combined_cache_status(statuses: Sequence[CacheStatus]) -> CacheStatus:
    """stale, sobald ein Teil alt ist; fresh nur, wenn alles frisch aus dem Cache kam."""
    if "stale" in statuses:
        return "stale"
    if statuses and all(s == "fresh" for s in statuses):
        return "fresh"
    return "miss"


def _domain_monthly(series: MonthlySeries) -> list[MonthlyValue]:
    return [MonthlyValue(date=o.date, value=o.value) for o in series.observations]


class CompareService:
    def __init__(
        self,
        provider: ClimateProvider,
        *,
        boundaries: StateBoundaries | None = None,
        clock: Callable[[], dt.datetime] = _utc_now,
    ) -> None:
        """boundaries=None (Demo): Bundesländer als Hauptstadt-Punkt wie im Demo-Datensatz.
        Live: Bundesländer als flächengewichtetes Zellmittel (B-STATEAREA)."""
        self._provider = provider
        self._boundaries = boundaries
        self._clock = clock

    async def compare(
        self,
        request: CompareRequest,
        locations: Sequence[Location],
        variable: Variable,
        request_id: str,
        data_mode: DataMode,
    ) -> CompareResponse:
        start, end = request.start_year, request.end_year
        base_start, base_end = request.baseline.start_year, request.baseline.end_year
        fetched: list[tuple[Location, MonthlySeries, MonthlySeries]] = []
        for location in locations:
            window, base = await self._fetch_windows(
                location, variable, start, end, base_start, base_end
            )
            fetched.append((location, window, base))

        communities = {s.provenance.community for _, w, b in fetched for s in (w, b)}
        if len(communities) != 1:
            raise provider_schema_error("Community differs within one comparison")

        annual = {
            loc.id: _annualize(_domain_monthly(window), start, end, variable.aggregation)
            for loc, window, _ in fetched
        }
        common = longest_common_run(*(complete_years(a) for a in annual.values()))
        enough_years = len(common) >= MIN_TREND_YEARS

        series = [
            self._series(location, window, base, annual[location.id], common, request, variable)
            for location, window, base in fetched
        ]
        comparison_warnings = [] if enough_years else [WARNING_INSUFFICIENT_DATA]
        raw_hashes = [s.provenance.raw_sha256 for _, w, b in fetched for s in (w, b)]
        return CompareResponse(
            analysis_version=ANALYSIS_VERSION,
            result_id=result_id(request, raw_hashes),
            request_id=request_id,
            data_mode=data_mode,
            cache_status=combined_cache_status(
                [s.cache_status for _, w, b in fetched for s in (w, b)]
            ),
            generated_at=self._clock(),
            request=request,
            series=series,
            comparison=Comparison(common_years=common, warnings=comparison_warnings),
        )

    async def _fetch_windows(
        self,
        location: Location,
        variable: Variable,
        start: int,
        end: int,
        base_start: int,
        base_end: int,
    ) -> tuple[MonthlySeries, MonthlySeries]:
        if location.id in REGION_MEMBER_AREAS:
            members, areas = region_members(location)
            boundaries = self._boundaries
            if (
                isinstance(self._provider, PowerProvider)
                and boundaries is not None
                and all(member.id in STATE_BOUNDARY for member in members)
            ):
                parts = await _fetch_states_together(
                    self._provider, boundaries, members, variable, start, end, base_start, base_end
                )
            else:
                parts = await gather_or_cancel(
                    self._fetch_member(member, variable, start, end, base_start, base_end)
                    for member in members
                )
            return (
                _composite_series(
                    location, [w for w, _ in parts], areas, "area_weighted_states", None
                ),
                _composite_series(
                    location, [b for _, b in parts], areas, "area_weighted_states", None
                ),
            )
        return await self._fetch_member(location, variable, start, end, base_start, base_end)

    async def _fetch_member(
        self,
        location: Location,
        variable: Variable,
        start: int,
        end: int,
        base_start: int,
        base_end: int,
    ) -> tuple[MonthlySeries, MonthlySeries]:
        boundary = STATE_BOUNDARY.get(location.id)
        if boundary is None or self._boundaries is None:
            return await _fetch_point(
                self._provider, location, variable, start, end, base_start, base_end
            )
        cells = await state_cells(self._boundaries, location.id, *boundary)
        # Über die Hülle von Fenster und Basis laden, dann aufteilen. Live: POWER-regional-Kacheln
        # (B-REGIONAL); andere Provider (Tests) weiter ein Punktabruf je Zelle.
        first, last = min(start, base_start), max(end, base_end)
        if isinstance(self._provider, PowerProvider):
            full = await self._provider.fetch_cells_monthly(cells, variable, first, last)
        else:
            full = await gather_or_cancel(
                self._provider.fetch_monthly(_cell_location(cell), variable, first, last)
                for cell in cells
            )
        return _cell_windows(location, cells, full, start, end, base_start, base_end)

    def _series(
        self,
        location: Location,
        window: MonthlySeries,
        base: MonthlySeries,
        annual: list[AnnualValue],
        common: Sequence[int],
        request: CompareRequest,
        variable: Variable,
    ) -> SeriesResult:
        start, end = request.start_year, request.end_year
        base_start, base_end = request.baseline.start_year, request.baseline.end_year
        missing = missing_months(_domain_monthly(window), start, end)
        reference = baseline_mean(
            _annualize(_domain_monthly(base), base_start, base_end, variable.aggregation),
            base_start,
            base_end,
        )

        warnings: list[str] = []
        if missing:
            warnings.append(WARNING_MISSING_MONTHS)
        if reference is None:
            warnings.append(WARNING_MISSING_BASELINE)
        trend = _trend(annual, common)
        if trend is None:
            warnings.append(WARNING_INSUFFICIENT_DATA)

        status: QualityStatus
        if trend is None:
            status = "insufficient_data"
        elif missing:
            status = "partial"
        else:
            status = "complete"

        return SeriesResult(
            location=location,
            observations_monthly=list(window.observations),
            observations_annual=[
                AnnualObservation(year=a.year, value=a.value, valid_months=a.valid_months)
                for a in annual
            ],
            anomalies_annual=(
                []
                if reference is None
                else [AnnualAnomaly(year=y, value=v) for y, v in anomalies(annual, reference)]
            ),
            trend=None if trend is None else trend_result(trend),
            quality=QualityReport(
                status=status,
                missing_months=missing,
                complete_years=complete_years(annual),
                coverage_fraction=coverage_fraction(missing, start, end),
                warnings=warnings,
                baseline_status="missing_baseline" if reference is None else "complete",
            ),
            provenance=window.provenance,
            cache_status=combined_cache_status([window.cache_status, base.cache_status]),
        )


async def _fetch_point(
    provider: ClimateProvider,
    location: Location,
    variable: Variable,
    start: int,
    end: int,
    base_start: int,
    base_end: int,
) -> tuple[MonthlySeries, MonthlySeries]:
    # Basis unabhängig vom Anzeigefenster laden (Brief §09.2).
    window = await provider.fetch_monthly(location, variable, start, end)
    base = await provider.fetch_monthly(location, variable, base_start, base_end)
    return window, base


# Prozess-Cache: Zellen und Gewichte je (Land, adm1). Die Grenzen ändern sich nicht; das Clipping
# kostet bei usa warm den Großteil der Laufzeit (Alaska allein mehrere Sekunden).
STATE_CELL_CACHE: dict[tuple[str, str], tuple[GridCell, ...]] = {}


async def state_cells(
    boundaries: StateBoundaries, location_id: str, country_iso3: str, adm1_id: str
) -> list[GridCell]:
    """POWER-Rasterzellen eines Bundeslands/States mit Flächengewicht (auch für /extremes)."""
    key = (country_iso3, adm1_id)
    cached = STATE_CELL_CACHE.get(key)
    if cached is None:
        region = await boundaries.get_region(country_iso3, adm1_id)
        try:
            # CPU-Arbeit (Alaska mehrere Sekunden) nicht im Event-Loop.
            polygons = geo.parse_geometry(region.boundary.model_dump(mode="json"))
            cells = await asyncio.to_thread(grid_cells, polygons)
        except (geo.GeometryError, ValueError) as exc:
            raise provider_schema_error(f"Boundary of {location_id} unusable: {exc}") from exc
        cached = STATE_CELL_CACHE[key] = tuple(cells)
    return list(cached)


async def _fetch_states_together(
    provider: PowerProvider,
    boundaries: StateBoundaries,
    members: Sequence[Location],
    variable: Variable,
    start: int,
    end: int,
    base_start: int,
    base_end: int,
) -> list[tuple[MonthlySeries, MonthlySeries]]:
    """Region (at, usa): Zellen aller Staaten in einem Kachelabruf, jede Kachel einmal geparst."""
    cell_lists = await gather_or_cancel(
        state_cells(boundaries, member.id, *STATE_BOUNDARY[member.id]) for member in members
    )
    unique = list({(c.latitude, c.longitude): c for cells in cell_lists for c in cells}.values())
    first, last = min(start, base_start), max(end, base_end)
    series = await provider.fetch_cells_monthly(unique, variable, first, last)
    by_cell = {(c.latitude, c.longitude): s for c, s in zip(unique, series, strict=True)}
    return [
        _cell_windows(
            member,
            cells,
            [by_cell[(c.latitude, c.longitude)] for c in cells],
            start,
            end,
            base_start,
            base_end,
        )
        for member, cells in zip(members, cell_lists, strict=True)
    ]


def _cell_windows(
    location: Location,
    cells: Sequence[GridCell],
    full: Sequence[MonthlySeries],
    start: int,
    end: int,
    base_start: int,
    base_end: int,
) -> tuple[MonthlySeries, MonthlySeries]:
    """Zellreihen (Hülle von Fenster und Basis) -> gewichtetes Fenster- und Basismittel."""
    weights = [cell.weight for cell in cells]
    windows = [_slice_years(part, start, end) for part in full]
    bases = [_slice_years(part, base_start, base_end) for part in full]
    return (
        _composite_series(location, windows, weights, "area_weighted_grid", len(cells)),
        _composite_series(location, bases, weights, "area_weighted_grid", len(cells)),
    )


def composite_provenance(
    location: Location,
    parts: Sequence[Provenance],
    method: SpatialMethod,
    cell_count: int | None,
) -> Provenance:
    """Provenance eines Flächenmittels: erste Quelle, Hash über alle Rohdaten-Hashes."""
    first = parts[0]
    digest = hashlib.sha256("\n".join(part.raw_sha256 for part in parts).encode())
    return Provenance(
        provider=first.provider,
        dataset=first.dataset,
        parameter=first.parameter,
        community=first.community,
        requested_coordinates=Coordinates(latitude=location.latitude, longitude=location.longitude),
        returned_coordinates=None,
        retrieved_at=max(part.retrieved_at for part in parts),
        source_url=None,
        raw_sha256=digest.hexdigest(),
        provider_version=first.provider_version,
        spatial_method=method,
        cell_count=cell_count,
    )


def region_members(location: Location) -> tuple[list[Location], list[float]]:
    """Mitglieder einer Region (at, usa) und ihre Flächen in km²."""
    areas = REGION_MEMBER_AREAS.get(location.id)
    if areas is None or location.spatial_kind != "region":
        raise ValueError(f"unsupported region location: {location.id}")
    by_id = {loc.id: loc for loc in LOCATIONS}
    return [by_id[member_id] for member_id in areas], list(areas.values())


def _cell_location(cell: GridCell) -> Location:
    cell_id = point_location_id(cell.latitude, cell.longitude)
    return Location(id=cell_id, label=cell_id, latitude=cell.latitude, longitude=cell.longitude)


def _slice_years(series: MonthlySeries, start: int, end: int) -> MonthlySeries:
    return MonthlySeries(
        observations=tuple(o for o in series.observations if start <= o.date.year <= end),
        provenance=series.provenance,
        cache_status=series.cache_status,
    )


def _composite_series(
    location: Location,
    parts: Sequence[MonthlySeries],
    weights: Sequence[float],
    method: SpatialMethod,
    cell_count: int | None,
) -> MonthlySeries:
    """Gewichtetes Monatsmittel; ein Monat ist nur gültig, wenn alle Teile gültig sind."""
    monthly = area_weighted_monthly([_domain_monthly(part) for part in parts], weights)
    return MonthlySeries(
        observations=tuple(
            MonthlyObservation(date=item.date, value=item.value, quality_flags=[])
            for item in monthly
        ),
        provenance=composite_provenance(
            location, [part.provenance for part in parts], method, cell_count
        ),
        cache_status=combined_cache_status([part.cache_status for part in parts]),
    )


def _annualize(
    monthly: Sequence[MonthlyValue], start_year: int, end_year: int, aggregation: Aggregation
) -> list[AnnualValue]:
    if aggregation == "calendar_day_sum":
        return annual_sums(monthly, start_year, end_year)
    return annual_means(monthly, start_year, end_year)


def _trend(annual: Sequence[AnnualValue], common: Sequence[int]) -> Trend | None:
    """Trend über die gemeinsame Folge; die Jahreswerte dort sind per Definition vollständig."""
    if len(common) < MIN_TREND_YEARS:
        return None
    by_year = {a.year: a.value for a in annual}
    points: list[tuple[int, float]] = []
    for year in common:
        value = by_year.get(year)
        if value is None:
            raise ValueError(f"common year {year} has no complete annual value")
        points.append((year, value))
    return fit_trend(points)


def trend_result(trend: Trend) -> TrendResult:
    return TrendResult(
        method=METHOD,
        method_version=METHOD_VERSION,
        n_years=trend.n_years,
        start_year=trend.start_year,
        end_year=trend.end_year,
        slope_per_decade=trend.slope_per_decade,
        ci95_low=trend.ci95_low,
        ci95_high=trend.ci95_high,
        p_value=trend.p_value,
        significance_status=trend.significance_status,
        diagnostic_flags=list(trend.diagnostic_flags),
        trend_line=[TrendPoint(year=year, value=value) for year, value in trend.trend_line],
    )
