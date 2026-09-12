"""
engine/inactivity.py
====================
Inactivity calculation helpers.

Responsibility
--------------
* ``validate_last_active`` – parse/validate a raw value into a safe
  ``datetime.date`` or ``None``.
* ``days_inactive`` – compute calendar days elapsed since ``last_active``.

The module is stateless and side-effect free.  ``today`` is always
injectable for deterministic testing.
"""

from __future__ import annotations

import datetime
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def validate_last_active(
    raw: object,
    *,
    today: Optional[datetime.date] = None,
) -> Optional[datetime.date]:
    """
    Parse and validate a raw ``last_active`` value.

    Accepted types
    --------------
    - ``datetime.datetime`` → converted to ``.date()``
    - ``datetime.date``     → used directly
    - ``str``               → parsed with ``date.fromisoformat`` (YYYY-MM-DD)
    - ``None`` / anything else → returns ``None``

    Rules enforced
    --------------
    - Invalid / unparseable values → ``None`` (Rule 6).
    - Future dates                 → ``None`` (Rule 7).
    - ``None`` input               → ``None`` (Rule 5 – missing ≠ inactive).

    Parameters
    ----------
    raw:   Raw value to validate.
    today: Reference date (defaults to ``datetime.date.today()``).
    """
    if today is None:
        today = datetime.date.today()

    if raw is None:
        return None

    if isinstance(raw, datetime.datetime):
        raw = raw.date()

    if isinstance(raw, datetime.date):
        if raw > today:
            logger.warning(
                "last_active %s is in the future; treating as unknown", raw
            )
            return None
        return raw

    if isinstance(raw, str):
        try:
            parsed = datetime.date.fromisoformat(raw)
        except ValueError:
            logger.warning(
                "Cannot parse last_active %r; treating as unknown", raw
            )
            return None
        if parsed > today:
            logger.warning(
                "last_active %s is in the future; treating as unknown", parsed
            )
            return None
        return parsed

    logger.warning(
        "Unexpected last_active type %s; treating as unknown",
        type(raw).__name__,
    )
    return None


def days_inactive(
    last_active: Optional[datetime.date],
    *,
    today: Optional[datetime.date] = None,
) -> Optional[int]:
    """
    Return calendar days since ``last_active`` relative to ``today``.

    Returns ``None`` when ``last_active`` is ``None`` (missing data must not
    be treated as inactive – Rule 5).

    Parameters
    ----------
    last_active: A pre-validated date, or ``None``.
    today:       Reference date (defaults to ``datetime.date.today()``).
    """
    if last_active is None:
        return None
    if today is None:
        today = datetime.date.today()
    return max((today - last_active).days, 0)
