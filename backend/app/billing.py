"""FinalWhistle Premium entitlement + Stripe webhook application logic.

Entitlement is DERIVED, never stored: is_premium() reads the subscription row
that webhooks maintain. Server-side checks call this; the frontend only ever
sees the boolean on /api/auth/me.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.models import Subscription
from app.security import to_aware_utc

# Statuses Stripe reports that mean "paid up" (trial included by design).
PREMIUM_STATUSES = ("trialing", "active")
# A failed renewal keeps premium for 7 days past period end (spec: grace).
PAST_DUE_GRACE = timedelta(days=7)


def is_premium(sub: Subscription | None, now: datetime | None = None) -> bool:
    """The single entitlement rule (spec status matrix). Pure — callers pass the
    row (or None); `now` is injectable for tests."""
    if sub is None:
        return False
    now = now or datetime.now(timezone.utc)
    if sub.status in PREMIUM_STATUSES:
        return True
    period_end = to_aware_utc(sub.current_period_end) if sub.current_period_end else None
    if sub.status == "past_due" and period_end is not None:
        return now <= period_end + PAST_DUE_GRACE
    if sub.status == "canceled" and period_end is not None:
        return now <= period_end
    return False
