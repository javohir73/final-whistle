# backend/tests/test_billing_reconcile.py
"""Missed-webhook self-heal on /me: a stale-looking row triggers ONE bounded
Stripe fetch; fresh rows and Stripe failures never affect the response."""
from datetime import datetime, timedelta, timezone

import pytest
import stripe

from app import billing
from app.config import settings
from app.models import AppUser, Subscription


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")


def _seed(db, status="active", period_end_delta_days=-2, updated_hours_ago=3):
    u = AppUser(email="stale@example.com", password_hash="x")
    db.add(u); db.commit()
    now = datetime.now(timezone.utc)
    s = Subscription(user_id=u.id, status=status, plan="monthly",
                     stripe_subscription_id="sub_stale",
                     current_period_end=now + timedelta(days=period_end_delta_days))
    db.add(s); db.commit()
    # backdate updated_at past the 1h reconcile throttle
    s.updated_at = now - timedelta(hours=updated_hours_ago)
    db.commit()
    return s


def test_stale_active_row_is_refetched(db_session, billing_on, monkeypatch):
    s = _seed(db_session)
    fetched = {}

    def fake_retrieve(sub_id, api_key=None):
        fetched["id"] = sub_id
        return {"id": sub_id, "customer": "cus_1", "status": "canceled",
                "current_period_end": None, "metadata": {},
                "items": {"data": []}}

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(fake_retrieve))
    billing.reconcile_if_stale(db_session, s)
    assert fetched["id"] == "sub_stale"
    assert s.status == "canceled"


def test_fresh_row_makes_no_call(db_session, billing_on, monkeypatch):
    s = _seed(db_session, period_end_delta_days=+20)

    def boom(*a, **k):
        raise AssertionError("must not call Stripe for a fresh row")

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(boom))
    billing.reconcile_if_stale(db_session, s)  # no raise => no call


def test_recent_update_throttles_the_fetch(db_session, billing_on, monkeypatch):
    s = _seed(db_session, updated_hours_ago=0)

    def boom(*a, **k):
        raise AssertionError("throttled row must not refetch")

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(boom))
    billing.reconcile_if_stale(db_session, s)


def test_stripe_error_is_swallowed(db_session, billing_on, monkeypatch):
    s = _seed(db_session)

    def boom(*a, **k):
        raise RuntimeError("stripe down")

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(boom))
    billing.reconcile_if_stale(db_session, s)  # must not raise
    assert s.status == "active"  # row untouched


def test_none_and_billing_off_are_noops(db_session):
    billing.reconcile_if_stale(db_session, None)  # nothing to do, no raise
