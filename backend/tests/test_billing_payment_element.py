# backend/tests/test_billing_payment_element.py
"""The in-page signup endpoints (setup-intent, subscribe) are retired: 410
premium_retired in every state, and stripe is never touched."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import billing as billing_api
from app.config import settings
from app.db import Base, get_db
from app.main import app

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
    c.sessionmaker = TestingSession  # let tests seed/read rows
    yield c
    app.dependency_overrides.clear()


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")


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


def _register(client, email="element@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


_CASES = [("/api/billing/setup-intent", None),
          ("/api/billing/subscribe", {"plan": "monthly", "setup_intent_id": "seti_1"})]


@pytest.mark.parametrize("path,payload", _CASES)
def test_retired_when_billing_on_and_signed_in(client, billing_on, stripe_untouched,
                                               path, payload):
    _register(client)
    _assert_retired(client.post(path, json=payload))


@pytest.mark.parametrize("path,payload", _CASES)
def test_retired_when_billing_off(client, stripe_untouched, path, payload):
    _register(client)
    _assert_retired(client.post(path, json=payload))


@pytest.mark.parametrize("path,payload", _CASES)
def test_retired_when_signed_out(client, billing_on, stripe_untouched, path, payload):
    _assert_retired(client.post(path, json=payload))
