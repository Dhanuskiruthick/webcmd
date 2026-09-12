"""
engine/savings.py
=================
Potential savings calculation and top-level engine API.

DISCLAIMER
----------
Savings figures are *potential* estimates based on the nominal monthly seat
cost.  They do NOT represent guaranteed billing reductions.  Actual savings
depend on vendor licensing terms, minimum seat commitments, and whether the
orchestrator acts on the recommendation (Rule 12).

Business rules enforced
-----------------------
Rule 3:  Free seats (paid_seat=False) → $0 savings.
Rule 4:  Exempt users                 → $0 savings.
Rule 8:  REVIEW + paid seat → monthly savings = monthly_cost.
Rule 9:  Annual savings = monthly × 12.
Rule 10: $0 monthly cost → $0 savings.
"""

from __future__ import annotations

import datetime
from typing import Optional

from .inactivity import days_inactive as _calc_days_inactive
from .models import EngineResult, LicenseRecord, Recommendation
from .policy import recommend
from .risk import classify_risk


def potential_monthly_savings(
    record: LicenseRecord,
    recommendation: Recommendation,
) -> float:
    """
    Return the potential monthly saving (USD) for one ``LicenseRecord``.

    Returns 0.0 unless the record is REVIEW-recommended, paid, and non-exempt.
    """
    if recommendation is not Recommendation.REVIEW:
        return 0.0
    if not record.paid_seat or record.exempt:  # defensive guard
        return 0.0
    return record.monthly_cost


def potential_annual_savings(monthly: float) -> float:
    """Return annual savings given a monthly figure (monthly × 12)."""
    return monthly * 12


def evaluate(
    record: LicenseRecord,
    *,
    today: Optional[datetime.date] = None,
) -> EngineResult:
    """
    Run the full engine pipeline for a single ``LicenseRecord``.

    Pipeline
    --------
    1. Compute days_inactive (None when last_active is unknown).
    2. Classify risk (independent of policy).
    3. Determine policy recommendation.
    4. Compute potential savings (0 for KEEP / free / exempt).
    5. Return structured ``EngineResult``.

    Parameters
    ----------
    record: A ``LicenseRecord`` with a pre-validated ``last_active``.
    today:  Reference date (inject a fixed date in tests for determinism).
    """
    if today is None:
        today = datetime.date.today()

    inactive  = _calc_days_inactive(record.last_active, today=today)
    risk      = classify_risk(inactive)
    rec       = recommend(record, inactive)
    monthly   = potential_monthly_savings(record, rec)
    annual    = potential_annual_savings(monthly)

    notes: list[str] = []
    if record.exempt:
        notes.append("User is exempt from deprovisioning consideration.")
    if not record.paid_seat:
        notes.append("Free seat: no cost savings applicable.")
    if record.last_active is None:
        notes.append("last_active unavailable: not treated as inactive.")
    if rec is Recommendation.REVIEW:
        notes.append(
            "Potential savings are candidates only; actual billing reduction "
            "depends on contract terms and orchestrator action."
        )

    return EngineResult(
        record=record,
        days_inactive=inactive,
        risk_level=risk,
        recommendation=rec,
        potential_monthly_savings=monthly,
        potential_annual_savings=annual,
        notes=notes,
    )


def evaluate_many(
    records: list[LicenseRecord],
    *,
    today: Optional[datetime.date] = None,
) -> list[EngineResult]:
    """Evaluate a list of records; return one EngineResult per record."""
    if today is None:
        today = datetime.date.today()
    return [evaluate(r, today=today) for r in records]


def aggregate_savings(results: list[EngineResult]) -> dict[str, float]:
    """
    Aggregate potential savings across a list of ``EngineResult`` objects.

    Returns
    -------
    dict with keys:
        ``total_monthly``: sum of potential monthly savings.
        ``total_annual``:  sum of potential annual savings.
    """
    return {
        "total_monthly": sum(r.potential_monthly_savings for r in results),
        "total_annual":  sum(r.potential_annual_savings  for r in results),
    }
