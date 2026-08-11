# backend/tests/test_billing_webhook.py
"""Webhook: signature gate, the four handled event types, idempotent replays.
stripe.Webhook.construct_event is monkeypatched — no network, no real crypto —
plus one real-signature-failure case."""
import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import BillingEvent, Subscription

ALLOWED_ORIGIN = "http://localhost:3000"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    c = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    c.sessionmaker = TestingSession
    yield c
    app.dependency_overrides.clear()


def _register(client, email="hook@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def _post_event(client, monkeypatch, event):
    monkeypatch.setattr(stripe.Webhook, "construct_event",
                        staticmethod(lambda payload, sig, secret: event))
    return client.post("/api/billing/webhook", content=b"{}",
                       headers={"stripe-signature": "t=1,v1=x"})


def _sub_event(event_id, etype, user_id, status="active", price="price_a",
               period_end=1789999999, sub_id="sub_1"):
    return {"id": event_id, "type": etype, "data": {"object": {
        "id": sub_id, "customer": "cus_1", "status": status,
        "current_period_end": period_end,
        "metadata": {"user_id": str(user_id)},
        "items": {"data": [{"price": {"id": price},
                            "current_period_end": period_end}]},
    }}}


def test_bad_signature_is_400(client):
    r = client.post("/api/billing/webhook", content=b"{}",
                    headers={"stripe-signature": "t=1,v1=bogus"})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "invalid_signature"


def test_checkout_completed_binds_ids(client, monkeypatch):
    user = _register(client)
    event = {"id": "evt_c1", "type": "checkout.session.completed",
             "data": {"object": {"client_reference_id": str(user["id"]),
                                  "customer": "cus_1", "subscription": "sub_1"}}}
    assert _post_event(client, monkeypatch, event).status_code == 200
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.stripe_customer_id == "cus_1"
    assert sub.stripe_subscription_id == "sub_1"
    db.close()


def test_subscription_updated_sets_status_plan_period(client, monkeypatch):
    user = _register(client)
    ev = _sub_event("evt_u1", "customer.subscription.updated", user["id"],
                    status="trialing", price="price_a")
    assert _post_event(client, monkeypatch, ev).status_code == 200
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.status == "trialing"
    assert sub.plan == "annual"
    assert sub.current_period_end is not None
    db.close()
    me = client.get("/api/auth/me")
    assert me.json()["premium"] is True


def test_subscription_updated_monthly_plan(client, monkeypatch):
    user = _register(client)
    ev = _sub_event("evt_u1m", "customer.subscription.updated", user["id"],
                    price="price_m")
    assert _post_event(client, monkeypatch, ev).status_code == 200
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.plan == "monthly"
    db.close()


def test_period_end_falls_back_to_item_when_top_level_missing(client, monkeypatch):
    """Stripe's 2025-03 'basil' API reports current_period_end only on the
    subscription item, not the top-level object — apply_subscription_object
    must still populate it from items.data[0]."""
    user = _register(client)
    ev = {"id": "evt_basil1", "type": "customer.subscription.updated", "data": {
        "object": {
            "id": "sub_1", "customer": "cus_1", "status": "active",
            # no top-level current_period_end
            "metadata": {"user_id": str(user["id"])},
            "items": {"data": [{"price": {"id": "price_a"},
                                "current_period_end": 1789999999}]},
        }}}
    assert _post_event(client, monkeypatch, ev).status_code == 200
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.current_period_end is not None
    db.close()


def test_missing_price_keeps_current_plan(client, monkeypatch):
    """A subsequent update with no item price (e.g. a status-only nudge) must
    not clobber the plan a prior event already established."""
    user = _register(client)
    first = _sub_event("evt_p1", "customer.subscription.updated", user["id"],
                       price="price_a")
    assert _post_event(client, monkeypatch, first).status_code == 200
    second = {"id": "evt_p2", "type": "customer.subscription.updated", "data": {
        "object": {
            "id": "sub_1", "customer": "cus_1", "status": "active",
            "current_period_end": 1789999999,
            "metadata": {"user_id": str(user["id"])},
            "items": {"data": []},  # no price on this delivery
        }}}
    assert _post_event(client, monkeypatch, second).status_code == 200
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.plan == "annual"  # unchanged from the first event
    db.close()


def test_subscription_deleted_marks_canceled(client, monkeypatch):
    user = _register(client)
    _post_event(client, monkeypatch,
                _sub_event("evt_u2", "customer.subscription.updated", user["id"]))
    _post_event(client, monkeypatch,
                _sub_event("evt_d1", "customer.subscription.deleted", user["id"]))
    db = client.sessionmaker()
    sub = db.query(Subscription).filter_by(user_id=user["id"]).one()
    assert sub.status == "canceled"
    db.close()


def test_payment_failed_marks_past_due(client, monkeypatch):
    user = _register(client)
    _post_event(client, monkeypatch,
                _sub_event("evt_u3", "customer.subscription.updated", user["id"]))
    ev = {"id": "evt_f1", "type": "invoice.payment_failed",
          "data": {"object": {"subscription": "sub_1"}}}
    assert _post_event(client, monkeypatch, ev).status_code == 200
    db = client.sessionmaker()
    assert db.query(Subscription).one().status == "past_due"
    db.close()


def test_replayed_event_is_acknowledged_not_reapplied(client, monkeypatch):
    user = _register(client)
    ev = _sub_event("evt_r1", "customer.subscription.updated", user["id"])
    assert _post_event(client, monkeypatch, ev).status_code == 200
    ev_replay = _sub_event("evt_r1", "customer.subscription.updated", user["id"],
                           status="canceled")  # same id, different body
    r = _post_event(client, monkeypatch, ev_replay)
    assert r.status_code == 200
    assert r.json().get("duplicate") is True
    db = client.sessionmaker()
    assert db.query(Subscription).one().status == "active"  # replay NOT applied
    assert db.query(BillingEvent).filter_by(event_id="evt_r1").count() == 1
    db.close()


def test_unknown_event_type_acknowledged(client, monkeypatch):
    ev = {"id": "evt_x1", "type": "customer.created", "data": {"object": {}}}
    assert _post_event(client, monkeypatch, ev).status_code == 200
