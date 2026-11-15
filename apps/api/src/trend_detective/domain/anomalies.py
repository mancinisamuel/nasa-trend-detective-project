"""Basisperiode und Anomalien (Brief §09.2)."""

from collections.abc import Iterable, Sequence

from trend_detective.domain.models import AnnualValue


def baseline_mean(
    baseline_annual: Iterable[AnnualValue], start_year: int, end_year: int
) -> float | None:
    """Mittel der Jahreswerte der Basisperiode; None, wenn nicht alle Jahre vollständig sind."""
    by_year = {a.year: a.value for a in baseline_annual}
    values = [by_year.get(year) for year in range(start_year, end_year + 1)]
    complete = [v for v in values if v is not None]
    if len(complete) != len(values):
        return None
    return sum(complete) / len(complete)


def anomalies(annual: Sequence[AnnualValue], reference: float) -> list[tuple[int, float | None]]:
    """Anomalie = Jahreswert minus Basismittel; unvollständige Jahre bleiben None."""
    return [(a.year, None if a.value is None else a.value - reference) for a in annual]
