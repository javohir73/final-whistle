# backend/tests/test_billing_entitlement.py
"""is_premium: the spec's status matrix — trialing/active => premium; past_due
gets a 7-day grace after period end; canceled keeps premium until period end."""
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.billing import is_premium
from app.db import Base, get_db
from app.main import app
from app.models import Subscription

NOW = datetime(2026, 8, 11, 12, 0, tzinfo=timezone.utc)
ALLOWED_ORIGIN = "http://localhost:3000"


def _sub(status, period_end=None):
    return Subscription(user_id=1, status=status, plan="monthly",
                        current_period_end=period_end)


def test_no_subscription_is_free():
    assert is_premium(None, now=NOW) is False


def test_trialing_and_active_are_premium():
    assert is_premium(_sub("trialing"), now=NOW) is True
    assert is_premium(_sub("active"), now=NOW) is True


def test_past_due_grace_window():
    ended = NOW - timedelta(days=1)
    assert is_premium(_sub("past_due", ended), now=NOW) is True          # day 1 of 7
    long_gone = NOW - timedelta(days=8)
    assert is_premium(_sub("past_due", long_gone), now=NOW) is False     # grace over


def test_canceled_keeps_premium_until_period_end():
    assert is_premium(_sub("canceled", NOW + timedelta(days=3)), now=NOW) is True
    assert is_premium(_sub("canceled", NOW - timedelta(minutes=1)), now=NOW) is False


def test_incomplete_is_free():
    assert is_premium(_sub("incomplete"), now=NOW) is False


def _client():
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
    return TestClient(app, headers={"Origin": ALLOWED_ORIGIN}), TestingSession


def test_me_reports_premium_flag():
    client, TestingSession = _client()
    try:
        r = client.post("/api/auth/register",
                        json={"email": "p@example.com", "password": "supersecret"})
        assert r.status_code == 200
        assert r.json()["premium"] is False  # register payload carries the flag

        db = TestingSession()
        db.add(Subscription(user_id=r.json()["id"], status="active", plan="annual"))
        db.commit(); db.close()

        me = client.get("/api/auth/me")
        assert me.status_code == 200
        assert me.json()["premium"] is True
    finally:
        app.dependency_overrides.clear()
