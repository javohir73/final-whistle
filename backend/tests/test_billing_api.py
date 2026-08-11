# backend/tests/test_billing_api.py
"""Checkout/portal sessions: env-gate 503, auth 401, mocked Stripe 200s,
plan->price selection, no double-subscribe, portal needs a customer."""
from datetime import datetime, timedelta, timezone

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Subscription

ALLOWED_ORIGIN = "http://localhost:3000"


@pytest.fixture
def client():
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
    c.sessionmaker = TestingSession  # let tests seed rows
    yield c
    app.dependency_overrides.clear()


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")


def _register(client, email="buyer@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def test_checkout_503_when_billing_disabled(client):
    _register(client)
    r = client.post("/api/billing/checkout-session", json={"plan": "monthly"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_disabled"


def test_checkout_requires_auth(client, billing_on):
    r = client.post("/api/billing/checkout-session", json={"plan": "monthly"})
    assert r.status_code == 401


def test_checkout_creates_session_with_selected_price(client, billing_on, monkeypatch):
    _register(client)
    captured = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        return type("S", (), {"url": "https://checkout.stripe.test/sess_123"})()

    monkeypatch.setattr(stripe.checkout.Session, "create", staticmethod(fake_create))
    r = client.post("/api/billing/checkout-session", json={"plan": "annual"})
    assert r.status_code == 200
    assert r.json() == {"url": "https://checkout.stripe.test/sess_123"}
    assert captured["line_items"] == [{"price": "price_a", "quantity": 1}]
    assert captured["mode"] == "subscription"
    assert captured["subscription_data"]["trial_period_days"] == 7
    assert captured["client_reference_id"]  # binds the session to our user id


def test_checkout_409_when_already_premium(client, billing_on):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        current_period_end=datetime.now(timezone.utc) + timedelta(days=20)))
    db.commit(); db.close()
    r = client.post("/api/billing/checkout-session", json={"plan": "monthly"})
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_subscribed"


def test_portal_404_without_customer(client, billing_on):
    _register(client)
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_subscription"


def test_portal_returns_url(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        stripe_customer_id="cus_9"))
    db.commit(); db.close()

    def fake_create(**kwargs):
        assert kwargs["customer"] == "cus_9"
        return type("S", (), {"url": "https://portal.stripe.test/p_1"})()

    monkeypatch.setattr(stripe.billing_portal.Session, "create", staticmethod(fake_create))
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 200
    assert r.json() == {"url": "https://portal.stripe.test/p_1"}
