"""Schmaler Provider-Port: genau der Abruf, den CompareService braucht (Brief §02)."""

from dataclasses import dataclass
from typing import Protocol

from trend_detective.schemas.catalog import Location, Variable
from trend_detective.schemas.responses import CacheStatus, MonthlyObservation, Provenance


@dataclass(frozen=True)
class MonthlySeries:
    """Normalisierte Monatswerte eines Standorts samt Provenienz.

    Fehlwerte und Provider-Fill-Werte sind None (nie 0). Monate, die der Provider nicht liefert,
    fehlen in der Liste; Kalenderlücken macht erst die Domain sichtbar. cache_status sagt, ob
    die Rohdaten frisch aus dem Dateicache kamen ("fresh") oder neu geladen wurden ("miss").
    """

    observations: tuple[MonthlyObservation, ...]
    provenance: Provenance
    cache_status: CacheStatus = "miss"


class ClimateProvider(Protocol):
    async def fetch_monthly(
        self, location: Location, variable: Variable, start_year: int, end_year: int
    ) -> MonthlySeries:
        """Monatswerte für ganze Jahre start_year..end_year (inklusive), aufsteigend sortiert.

        Fehler: ApiError mit UNKNOWN_LOCATION/UNKNOWN_VARIABLE (422) oder PROVIDER_* (502-504).
        """
        ...
