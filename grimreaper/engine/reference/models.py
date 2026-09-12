"""
engine/models.py
================
Core data contracts for the Python GrimReaper Engine Reference.
"""

from __future__ import annotations

import datetime
from enum import Enum
from typing import Optional
from dataclasses import dataclass


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


class Recommendation(str, Enum):
    KEEP = "KEEP"
    REVIEW = "REVIEW"


@dataclass(frozen=True)
class LicenseRecord:
    user_id: str
    display_name: str
    email: Optional[str]
    role: str
    last_active: Optional[datetime.date]
    paid_seat: bool
    monthly_cost: float
    exempt: bool = False


@dataclass(frozen=True)
class EngineResult:
    record: LicenseRecord
    days_inactive: Optional[int]
    risk_level: RiskLevel
    recommendation: Recommendation
    potential_monthly_savings: float
    potential_annual_savings: float
    notes: list[str]
