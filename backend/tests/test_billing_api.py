# backend/tests/test_billing_api.py
"""Billing: checkout-session is retired (410), portal needs a customer and a\nsubscription row, Stripe errors stay inside the error contract."""
from datetime import datetime, timedelta, timezone

import pytest
import stripe
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import billing as billing_api
from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import Subscription

ALLOWED_ORIGIN = "http://localhost:3000"


RETIRED_BODY = {"code": "premium_retired",
                "message": "FinalWhistle Premium has been retired. Everything on the site is free."}


@pytest.fixture
def stripe_untouched(monkeypatch):
    """Arm the stripe module so any attribute access from a retired endpoint fails."""
    class _Tripwire:
        def __getattr__(self, name):
            raise AssertionError(f"retired endpoint touched stripe.{name}")

    monkeypatch.setattr(billing_api, "stripe", _Tripwire())


def _assert_retired(r):
    assert r.status_code == 410
    assert r.json()["error"] == RETIRED_BODY


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
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")


def _register(client, email="buyer@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def test_checkout_session_is_retired_when_billing_on_and_signed_in(
        client, billing_on, stripe_untouched):
    _register(client)
    _assert_retired(client.post("/api/billing/checkout-session", json={"plan": "monthly"}))


def test_checkout_session_is_retired_when_billing_off(client, stripe_untouched):
    _register(client)
    _assert_retired(client.post("/api/billing/checkout-session", json={"plan": "monthly"}))


def test_checkout_session_is_retired_when_signed_out(client, billing_on, stripe_untouched):
    _assert_retired(client.post("/api/billing/checkout-session", json={"plan": "monthly"}))


def test_portal_404_without_customer(client, billing_on):
    _register(client)
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_subscription"


def test_portal_503_when_stripe_errors(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        stripe_customer_id="cus_9"))
    db.commit(); db.close()

    def boom(**kwargs):
        raise stripe.StripeError("boom")

    monkeypatch.setattr(stripe.billing_portal.Session, "create", staticmethod(boom))
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_unavailable"


def test_portal_returns_url(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        stripe_customer_id="cus_9"))
    db.commit(); db.close()

    def fake_create(**kwargs):
        assert kwargs["customer"] == "cus_9"
        assert kwargs["return_url"] == f"{settings.public_base_url}/"
        return type("S", (), {"url": "https://portal.stripe.test/p_1"})()

    monkeypatch.setattr(stripe.billing_portal.Session, "create", staticmethod(fake_create))
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 200
    assert r.json() == {"url": "https://portal.stripe.test/p_1"}
