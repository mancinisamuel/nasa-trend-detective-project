"""Jahreswerte: nach Kalendertagen gewichtete Monatsmittel (Brief §09.1)."""

import calendar
import datetime as dt
from collections.abc import Iterable

from trend_detective.domain.models import AnnualValue, MonthlyValue

MONTHS_PER_YEAR = 12


def month_dates(start_year: int, end_year: int) -> list[dt.date]:
    return [
        dt.date(year, month, 1)
        for year in range(start_year, end_year + 1)
        for month in range(1, MONTHS_PER_YEAR + 1)
    ]


def valid_values(monthly: Iterable[MonthlyValue]) -> dict[dt.date, float]:
    return {m.date: m.value for m in monthly if m.value is not None}


def annual_means(
    monthly: Iterable[MonthlyValue], start_year: int, end_year: int
) -> list[AnnualValue]:
    """Ein Eintrag je Jahr im Fenster; Wert nur bei 12 gültigen Monaten, sonst None.

    Gewicht je Monat = Anzahl Kalendertage (Schaltjahr: Februar 29).
    """
    values = valid_values(monthly)
    result: list[AnnualValue] = []
    for year in range(start_year, end_year + 1):
        present = [
            (calendar.monthrange(year, month)[1], values[dt.date(year, month, 1)])
            for month in range(1, MONTHS_PER_YEAR + 1)
            if dt.date(year, month, 1) in values
        ]
        mean: float | None = None
        if len(present) == MONTHS_PER_YEAR:
            days = sum(d for d, _ in present)
            mean = sum(d * v for d, v in present) / days
        result.append(AnnualValue(year=year, value=mean, valid_months=len(present)))
    return result


def annual_sums(
    monthly: Iterable[MonthlyValue], start_year: int, end_year: int
) -> list[AnnualValue]:
    """Jahressumme aus mittleren Tagesraten: Summe(Wert * Kalendertage), nur bei 12 Monaten.

    Für PRECTOTCORR (mm/Tag) ergibt das die Jahressumme in mm/Jahr. Schaltjahr: Februar 29.
    """
    values = valid_values(monthly)
    result: list[AnnualValue] = []
    for year in range(start_year, end_year + 1):
        present = [
            (calendar.monthrange(year, month)[1], values[dt.date(year, month, 1)])
            for month in range(1, MONTHS_PER_YEAR + 1)
            if dt.date(year, month, 1) in values
        ]
        total: float | None = None
        if len(present) == MONTHS_PER_YEAR:
            total = sum(days * value for days, value in present)
        result.append(AnnualValue(year=year, value=total, valid_months=len(present)))
    return result


def complete_years(annual: Iterable[AnnualValue]) -> list[int]:
    return [a.year for a in annual if a.value is not None]
