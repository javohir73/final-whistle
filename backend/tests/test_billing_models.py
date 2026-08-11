"""Subscription/BillingEvent rows: one subscription per user, unique Stripe ids,
unique webhook event ids (the idempotency backstop)."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import AppUser, BillingEvent, Subscription


def _user(db, email="sub@example.com"):
    u = AppUser(email=email, password_hash="x")
    db.add(u); db.commit()
    return u


def test_subscription_round_trip(db_session):
    u = _user(db_session)
    s = Subscription(user_id=u.id, stripe_customer_id="cus_1",
                     stripe_subscription_id="sub_1", status="active", plan="monthly",
                     current_period_end=datetime(2026, 9, 11, tzinfo=timezone.utc))
    db_session.add(s); db_session.commit()
    got = db_session.query(Subscription).filter_by(user_id=u.id).one()
    assert got.status == "active"
    assert got.plan == "monthly"
    assert got.created_at is not None


def test_one_subscription_per_user(db_session):
    u = _user(db_session)
    db_session.add(Subscription(user_id=u.id, status="active", plan="monthly"))
    db_session.commit()
    db_session.add(Subscription(user_id=u.id, status="active", plan="annual"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_billing_event_id_unique(db_session):
    db_session.add(BillingEvent(event_id="evt_1")); db_session.commit()
    db_session.add(BillingEvent(event_id="evt_1"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
