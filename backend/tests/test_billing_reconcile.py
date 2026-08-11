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
    """A spy that records calls, not a `boom` that raises: raising from inside
    `retrieve` would land in `reconcile_if_stale`'s own `except Exception` and
    get silently swallowed, so a broken staleness gate could call Stripe on
    every fresh row and this test would stay green regardless."""
    s = _seed(db_session, period_end_delta_days=+20)
    calls = []
    monkeypatch.setattr(stripe.Subscription, "retrieve",
                        staticmethod(lambda *a, **k: calls.append(a)))
    billing.reconcile_if_stale(db_session, s)
    assert calls == []


def test_recent_update_throttles_the_fetch(db_session, billing_on, monkeypatch):
    """Same spy-not-raise reasoning as test_fresh_row_makes_no_call — a raised
    AssertionError would be swallowed by the function's own error handling and
    the test would pass even with a broken throttle."""
    s = _seed(db_session, updated_hours_ago=0)
    calls = []
    monkeypatch.setattr(stripe.Subscription, "retrieve",
                        staticmethod(lambda *a, **k: calls.append(a)))
    billing.reconcile_if_stale(db_session, s)
    assert calls == []


def test_billing_off_with_stale_row_makes_no_call(db_session, monkeypatch):
    """No `billing_on` fixture here: settings.stripe_secret_key/prices stay
    blank (conftest.py forces billing OFF by default), so `billing_enabled` is
    False even though this row is genuinely stale. `sub is None or not
    settings.billing_enabled` short-circuits on `sub is None` for a None
    input, so that alone never exercises the `billing_enabled` half of the
    gate — this seeds a real stale row to close that gap."""
    s = _seed(db_session)
    calls = []
    monkeypatch.setattr(stripe.Subscription, "retrieve",
                        staticmethod(lambda *a, **k: calls.append(a)))
    billing.reconcile_if_stale(db_session, s)
    assert calls == []


def test_stripe_error_is_swallowed(db_session, billing_on, monkeypatch):
    s = _seed(db_session)

    def boom(*a, **k):
        raise RuntimeError("stripe down")

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(boom))
    billing.reconcile_if_stale(db_session, s)  # must not raise
    assert s.status == "active"  # row untouched


def test_success_then_second_call_is_throttled(db_session, billing_on, monkeypatch):
    """Two reconcile calls back-to-back on a row that stays entitled-ish after
    the fetch (status "active", period_end still stale because Stripe didn't
    report one) must only hit Stripe once — proving the post-success
    `updated_at` stamp is what throttles the second call, not a status
    flip out of the reconcile-eligible set."""
    s = _seed(db_session)
    calls = []

    def fake_retrieve(sub_id, api_key=None):
        calls.append(sub_id)
        return {"id": sub_id, "customer": "cus_1", "status": "active",
                "current_period_end": None, "metadata": {},
                "items": {"data": []}}

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(fake_retrieve))
    billing.reconcile_if_stale(db_session, s)
    billing.reconcile_if_stale(db_session, s)
    assert calls == ["sub_stale"]


def test_failed_fetch_throttles_the_next_call(db_session, billing_on, monkeypatch):
    """A failing fetch must still consume the hourly throttle budget — else a
    Stripe outage turns every /me into a per-request retry storm. Two calls in
    a row against a failing retrieve must only attempt the fetch once."""
    s = _seed(db_session)
    calls = []

    def boom(sub_id, api_key=None):
        calls.append(sub_id)
        raise RuntimeError("stripe down")

    monkeypatch.setattr(stripe.Subscription, "retrieve", staticmethod(boom))
    billing.reconcile_if_stale(db_session, s)
    billing.reconcile_if_stale(db_session, s)
    assert calls == ["sub_stale"]
    assert s.status == "active"  # row untouched by the failed fetch


def test_none_and_billing_off_are_noops(db_session):
    billing.reconcile_if_stale(db_session, None)  # nothing to do, no raise
