"""Einfache typisierte Daten für die Domain."""

import datetime as dt
from dataclasses import dataclass


@dataclass(frozen=True)
class MonthlyValue:
    date: dt.date
    value: float | None


@dataclass(frozen=True)
class AnnualValue:
    year: int
    value: float | None
    valid_months: int
