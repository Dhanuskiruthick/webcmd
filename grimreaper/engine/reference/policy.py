"""
engine/policy.py
================
Inactivity policy rules.

IMPORTANT: Policy (KEEP / REVIEW) and risk level (LOW / MEDIUM / HIGH)
are separate, orthogonal concepts and must not be conflated.

Policy rule
-----------
A record is recommended for REVIEW iff ALL three conditions hold:
    1. days_inactive >= INACTIVITY_THRESHOLD_DAYS (60)
    2. paid_seat is True
    3. exempt is False

All other records receive KEEP.

Boundary behaviour (documented)
---------------------------------
    days_inactive = 59  → KEEP   (one day short of threshold)
    days_inactive = 60  → REVIEW (at the boundary, inclusive)
    days_inactive = 61  → REVIEW
"""

from __future__ import annotations

from typing import Optional

from .models import LicenseRecord, Recommendation

INACTIVITY_THRESHOLD_DAYS: int = 60
"""
Minimum consecutive inactive calendar days before a paid seat is
flagged for review.  Boundary is inclusive: exactly 60 days qualifies.
"""


def recommend(
    record: LicenseRecord,
    days_inactive: Optional[int],
) -> Recommendation:
    """
    Determine the policy recommendation for a single ``LicenseRecord``.

    Parameters
    ----------
    record:        The license record to evaluate.
    days_inactive: Output of ``engine.inactivity.days_inactive``.
                   ``None`` → missing data → never REVIEW (Rule 5).

    Returns
    -------
    ``Recommendation.REVIEW``
        iff days_inactive >= 60 AND paid_seat AND NOT exempt.

    ``Recommendation.KEEP``
        in all other cases (None / free / exempt / < 60 days).
    """
    if days_inactive is None:
        return Recommendation.KEEP
    if record.exempt:
        return Recommendation.KEEP
    if not record.paid_seat:
        return Recommendation.KEEP
    if days_inactive >= INACTIVITY_THRESHOLD_DAYS:
        return Recommendation.REVIEW
    return Recommendation.KEEP
