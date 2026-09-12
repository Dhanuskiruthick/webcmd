"""
engine/risk.py
==============
Deterministic risk classification.

Risk level is computed from ``days_inactive`` alone and is independent
of the policy recommendation (KEEP / REVIEW).

Risk tiers (inclusive-lower / exclusive-upper)
-----------------------------------------------
    0  ≤ days < 60  → LOW
    60 ≤ days < 90  → MEDIUM
    90 ≤ days       → HIGH

Boundary examples (documented)
--------------------------------
    days_inactive =  0  → LOW
    days_inactive = 59  → LOW    (last day of LOW tier)
    days_inactive = 60  → MEDIUM (first day of MEDIUM tier)
    days_inactive = 89  → MEDIUM (last day of MEDIUM tier)
    days_inactive = 90  → HIGH   (first day of HIGH tier)

When ``days_inactive`` is ``None`` (unknown last_active) the risk
defaults to LOW because there is no evidence of a problem.
"""

from __future__ import annotations

from typing import Optional

from .models import RiskLevel

MEDIUM_THRESHOLD: int = 60
"""Days at-or-beyond which risk escalates to MEDIUM."""

HIGH_THRESHOLD: int = 90
"""Days at-or-beyond which risk escalates to HIGH."""


def classify_risk(days_inactive: Optional[int]) -> RiskLevel:
    """
    Return the deterministic risk level for ``days_inactive``.

    Parameters
    ----------
    days_inactive: Non-negative int, or ``None`` when last_active is unknown.

    Returns
    -------
    ``RiskLevel`` enum member.
    """
    if days_inactive is None:
        return RiskLevel.LOW
    if days_inactive >= HIGH_THRESHOLD:
        return RiskLevel.HIGH
    if days_inactive >= MEDIUM_THRESHOLD:
        return RiskLevel.MEDIUM
    return RiskLevel.LOW
