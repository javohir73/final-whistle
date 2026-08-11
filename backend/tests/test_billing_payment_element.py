# backend/tests/test_billing_payment_element.py
"""In-page Payment Element signup: setup-intent + subscribe.

The two cases that carry weight are the ownership checks on /subscribe (a
SetupIntent id is guessable-ish and belongs to *someone* — attaching a stranger's
card must be impossible) and the trial guard, which now reads
`had_subscription` because setup-intent writes a row before any subscription
exists. Stripe is monkeypatched throughout — no network.
"""
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
    c.sessionmaker = TestingSession  # let tests seed/read rows
    yield c
    app.dependency_overrides.clear()


@pytest.fixture
def billing_on(monkeypatch):
    monkeypatch.setattr(settings, "stripe_secret_key", "sk_test_x")
    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_x")
    monkeypatch.setattr(settings, "stripe_price_monthly", "price_m")
    monkeypatch.setattr(settings, "stripe_price_annual", "price_a")


def _register(client, email="element@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def _row(client, user_id):
    db = client.sessionmaker()
    try:
        return db.query(Subscription).filter_by(user_id=user_id).one_or_none()
    finally:
        db.close()


def _mock_customer(monkeypatch, customer_id="cus_new", captured=None):
    def fake_create(**kwargs):
        if captured is not None:
            captured.update(kwargs)
        return type("C", (), {"id": customer_id})()

    monkeypatch.setattr(stripe.Customer, "create", staticmethod(fake_create))


def _mock_setup_intent(monkeypatch, client_secret="seti_1_secret_x", captured=None):
    def fake_create(**kwargs):
        if captured is not None:
            captured.update(kwargs)
        return type("SI", (), {"id": "seti_1", "client_secret": client_secret})()

    monkeypatch.setattr(stripe.SetupIntent, "create", staticmethod(fake_create))


def _mock_retrieve_intent(monkeypatch, customer="cus_new", status="succeeded",
                          payment_method="pm_1"):
    def fake_retrieve(intent_id, **kwargs):
        return {"id": intent_id, "customer": customer, "status": status,
                "payment_method": payment_method}

    monkeypatch.setattr(stripe.SetupIntent, "retrieve", staticmethod(fake_retrieve))


def _stripe_subscription(user_id, sub_id="sub_new", customer="cus_new",
                         status="trialing", price="price_m", days=7):
    """The shape apply_subscription_object consumes (2025-03 'basil' item form)."""
    end = int((datetime.now(timezone.utc) + timedelta(days=days)).timestamp())
    return {"id": sub_id, "customer": customer, "status": status,
            "metadata": {"user_id": str(user_id)},
            "items": {"data": [{"price": {"id": price},
                                "current_period_end": end}]}}


def _mock_subscription_create(monkeypatch, obj, captured=None):
    def fake_create(**kwargs):
        if captured is not None:
            captured.update(kwargs)
        return obj

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(fake_create))


# ---- setup-intent ----

def test_setup_intent_503_when_billing_disabled(client):
    _register(client)
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_disabled"


def test_setup_intent_requires_auth(client, billing_on):
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 401


def test_setup_intent_409_when_already_premium(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        current_period_end=datetime.now(timezone.utc) + timedelta(days=20)))
    db.commit(); db.close()

    def boom(**kwargs):
        # Armed so moving the guard below the Stripe call fails here, rather
        # than by reaching api.stripe.com for real from an otherwise hermetic
        # suite (slow, and flaky in CI).
        raise AssertionError("must not reach Stripe")

    monkeypatch.setattr(stripe.Customer, "create", staticmethod(boom))
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "already_subscribed"


def test_setup_intent_creates_and_persists_customer(client, billing_on, monkeypatch):
    user = _register(client)
    cust, intent = {}, {}
    _mock_customer(monkeypatch, "cus_new", cust)
    _mock_setup_intent(monkeypatch, "seti_1_secret_x", intent)
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 200
    assert r.json() == {"client_secret": "seti_1_secret_x"}  # and nothing else
    assert cust["email"] == "element@example.com"
    assert cust["metadata"] == {"user_id": str(user["id"])}
    assert intent["customer"] == "cus_new"
    assert intent["usage"] == "off_session"
    assert intent["automatic_payment_methods"] == {"enabled": True}
    row = _row(client, user["id"])
    assert row is not None and row.stripe_customer_id == "cus_new"
    assert row.status == "incomplete"  # holds the customer id, entitles nothing
    assert row.had_subscription is False


def test_setup_intent_response_is_never_shared_cached(client, billing_on, monkeypatch):
    """The body is a Stripe client secret and it reaches the browser through
    Vercel's /backend-api/* rewrite. A shared cache wouldn't store a POST
    response uninvited, but every other per-user surface in main.py says
    `no-store` explicitly rather than relying on that."""
    _register(client)
    _mock_customer(monkeypatch)
    _mock_setup_intent(monkeypatch)
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


def test_setup_intent_reuses_existing_customer(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="canceled", plan="monthly",
                        stripe_customer_id="cus_9"))
    db.commit(); db.close()

    def boom(**kwargs):
        raise AssertionError("must not create a duplicate Stripe customer")

    monkeypatch.setattr(stripe.Customer, "create", staticmethod(boom))
    intent = {}
    _mock_setup_intent(monkeypatch, captured=intent)
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 200
    assert intent["customer"] == "cus_9"


def test_setup_intent_503_when_stripe_errors(client, billing_on, monkeypatch):
    _register(client)
    _mock_customer(monkeypatch)

    def boom(**kwargs):
        raise stripe.StripeError("boom")

    monkeypatch.setattr(stripe.SetupIntent, "create", staticmethod(boom))
    r = client.post("/api/billing/setup-intent")
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_unavailable"


# ---- subscribe: the security cases ----

def test_subscribe_rejects_another_users_setup_intent(client, billing_on, monkeypatch):
    """The attack this check exists for: pass a SetupIntent belonging to someone
    else's customer and get their card attached to your subscription."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_mine"))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch, customer="cus_SOMEONE_ELSE", status="succeeded")

    def boom(**kwargs):
        raise AssertionError("must not create a subscription")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(boom))
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_theirs"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "setup_intent_invalid"


def test_subscribe_rejects_unconfirmed_setup_intent(client, billing_on, monkeypatch):
    """Own customer, but the card was never confirmed — subscribing here would
    create a subscription with no usable payment method."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_mine"))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch, customer="cus_mine",
                          status="requires_payment_method")

    def boom(**kwargs):
        raise AssertionError("must not create a subscription")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(boom))
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "setup_intent_invalid"


def test_subscribe_rejects_when_user_has_no_customer(client, billing_on, monkeypatch):
    """No stored customer id => nothing to match against. Must not fall through
    to a None == None comparison."""
    _register(client)
    _mock_retrieve_intent(monkeypatch, customer=None, status="succeeded")
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "setup_intent_invalid"


def test_subscribe_rejects_a_setup_intent_with_no_payment_method(client, billing_on,
                                                                 monkeypatch):
    """stripe-python drops None params, so a null payment_method would quietly
    turn the create call into "subscribe with no card" — 7 days of Premium with
    nothing to charge afterwards. The design rule is: no subscription without a
    confirmed card."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_mine"))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch, customer="cus_mine", status="succeeded",
                          payment_method=None)

    def boom(**kwargs):
        raise AssertionError("must not create a subscription")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(boom))
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "setup_intent_invalid"


def test_subscribe_rejects_a_foreign_origin(client, billing_on):
    """CSRF guard, asserted at the route rather than on the function: a
    cookie-authenticated POST that buys a subscription must not be drivable from
    another site, so the Depends(require_same_origin) wiring has to be pinned."""
    _register(client)
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"},
                    headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_origin"


def test_setup_intent_rejects_a_foreign_origin(client, billing_on):
    """Same wiring check for step 1 — it creates a Stripe customer and returns a
    client secret."""
    _register(client)
    r = client.post("/api/billing/setup-intent",
                    headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_origin"


# ---- subscribe: the happy paths ----

def test_subscribe_grants_trial_to_customer_only_row(client, billing_on, monkeypatch):
    """THE REGRESSION had_subscription exists to prevent: setup-intent leaves a
    row holding only stripe_customer_id, and the old "no row => trial" guard
    would read that as a returning subscriber and silently deny every trial."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_new"))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch)
    captured = {}
    _mock_subscription_create(
        monkeypatch, _stripe_subscription(user["id"]), captured)
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 200
    assert captured["trial_period_days"] == 7
    assert captured["customer"] == "cus_new"
    assert captured["items"] == [{"price": "price_m"}]
    assert captured["default_payment_method"] == "pm_1"
    assert captured["metadata"] == {"user_id": str(user["id"])}
    assert r.json() == {"status": "trialing", "premium": True}


def test_subscribe_withholds_trial_from_returning_subscriber(client, billing_on,
                                                             monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="canceled", plan="monthly",
                        stripe_customer_id="cus_new", had_subscription=True,
                        current_period_end=datetime.now(timezone.utc) - timedelta(days=30)))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch)
    captured = {}
    _mock_subscription_create(
        monkeypatch,
        _stripe_subscription(user["id"], sub_id="sub_2", status="active"), captured)
    r = client.post("/api/billing/subscribe",
                    json={"plan": "annual", "setup_intent_id": "seti_1"})
    assert r.status_code == 200
    assert "trial_period_days" not in captured
    assert captured["items"] == [{"price": "price_a"}]


def test_subscribe_withholds_trial_when_only_the_subscription_id_says_returning(
        client, billing_on, monkeypatch):
    """The other half of the trial guard. A row can hold a subscription id with
    had_subscription still false — the migration's backfill runs from refresh.yml
    *after* the code deploys, so there is a real window for it. Reading only the
    flag would hand that subscriber a second free trial."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="canceled", plan="monthly",
                        stripe_customer_id="cus_new", stripe_subscription_id="sub_old",
                        had_subscription=False,
                        current_period_end=datetime.now(timezone.utc) - timedelta(days=30)))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch)
    captured = {}
    _mock_subscription_create(
        monkeypatch,
        _stripe_subscription(user["id"], sub_id="sub_2", status="active"), captured)
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 200
    assert "trial_period_days" not in captured


def test_subscribe_keys_creation_to_the_setup_intent(client, billing_on, monkeypatch):
    """A created subscription does not always entitle: a returning subscriber is
    charged on day one, and a card that needs a bank challenge leaves it
    `incomplete`. is_premium() is false for that, so the guard above lets a retry
    (lost response, page reload, "Finish activation") straight through to a
    SECOND Subscription.create on the same customer — billed monthly, invisible
    to us because apply_subscription_object keeps the first binding. Stripe's
    idempotency key, derived from the SetupIntent, is what collapses those
    retries into one subscription; it also makes the succeeded intent
    non-replayable for the 24h Stripe honours the key."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_new", had_subscription=True))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch)
    keys = []

    def fake_create(**kwargs):
        keys.append(kwargs.get("idempotency_key"))
        return _stripe_subscription(user["id"], status="incomplete")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(fake_create))
    for _ in range(2):
        r = client.post("/api/billing/subscribe",
                        json={"plan": "monthly", "setup_intent_id": "seti_1"})
        assert r.status_code == 200
        assert r.json() == {"status": "incomplete", "premium": False}
    assert keys[0], "Subscription.create must carry an idempotency_key"
    assert keys[0] == keys[1]  # same intent, same key => Stripe replays the first
    assert "seti_1" in keys[0] and str(user["id"]) in keys[0]


def test_subscribe_applies_row_eagerly_matching_the_webhook(client, billing_on,
                                                            monkeypatch):
    """The row must be written before the response so the UI flips without
    polling — and must be exactly what the webhook writes moments later."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_new"))
    db.commit(); db.close()
    obj = _stripe_subscription(user["id"], price="price_a")
    _mock_retrieve_intent(monkeypatch)
    _mock_subscription_create(monkeypatch, obj)
    assert client.post("/api/billing/subscribe",
                       json={"plan": "annual",
                             "setup_intent_id": "seti_1"}).status_code == 200
    eager = _row(client, user["id"])
    assert eager.stripe_subscription_id == "sub_new"
    assert eager.status == "trialing"
    assert eager.plan == "annual"
    assert eager.had_subscription is True
    before = (eager.status, eager.plan, eager.stripe_subscription_id,
              eager.stripe_customer_id, eager.current_period_end)

    # Knock the row off the expected values first: comparing after == before on
    # an untouched row can't tell "the webhook re-applied the same object" from
    # "the webhook ignored it entirely", which is the half of the parity claim
    # that carries the risk.
    db = client.sessionmaker()
    db.query(Subscription).filter_by(user_id=user["id"]).one().status = "past_due"
    db.commit(); db.close()

    monkeypatch.setattr(stripe.Webhook, "construct_event", staticmethod(
        lambda payload, sig, secret: {
            "id": "evt_1", "type": "customer.subscription.created",
            "data": {"object": obj}}))
    assert client.post("/api/billing/webhook", content=b"{}",
                       headers={"stripe-signature": "t=1,v1=x"}).status_code == 200
    after_row = _row(client, user["id"])
    after = (after_row.status, after_row.plan, after_row.stripe_subscription_id,
             after_row.stripe_customer_id, after_row.current_period_end)
    assert after == before


def test_subscribe_idempotent_when_already_premium(client, billing_on, monkeypatch):
    """Retry after a dropped connection must describe what exists, never create a
    second subscription."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly",
                        stripe_customer_id="cus_new", stripe_subscription_id="sub_1",
                        had_subscription=True,
                        current_period_end=datetime.now(timezone.utc) + timedelta(days=20)))
    db.commit(); db.close()

    def boom(**kwargs):
        raise AssertionError("must not create a second subscription")

    def no_retrieve(*args, **kwargs):
        # Same reason as the sentinel above: the guard must return before any
        # Stripe call, and this pins that without a live network round trip.
        raise AssertionError("must not retrieve the SetupIntent")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(boom))
    monkeypatch.setattr(stripe.SetupIntent, "retrieve", staticmethod(no_retrieve))
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 200
    assert r.json() == {"status": "active", "premium": True}


def test_subscribe_503_when_billing_disabled(client):
    _register(client)
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_disabled"


def test_subscribe_requires_auth(client, billing_on):
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 401


def test_subscribe_503_when_stripe_errors(client, billing_on, monkeypatch):
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_new"))
    db.commit(); db.close()
    _mock_retrieve_intent(monkeypatch)

    def boom(**kwargs):
        raise stripe.StripeError("boom")

    monkeypatch.setattr(stripe.Subscription, "create", staticmethod(boom))
    r = client.post("/api/billing/subscribe",
                    json={"plan": "monthly", "setup_intent_id": "seti_1"})
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "billing_unavailable"


# ---- the same guard on the (deprecated) checkout path ----

def test_checkout_grants_trial_to_customer_only_row(client, billing_on, monkeypatch):
    """Both endpoints must read the same guard, or a user who opened the in-page
    form and then fell back to hosted Checkout would lose their trial."""
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="incomplete", plan="monthly",
                        stripe_customer_id="cus_new"))
    db.commit(); db.close()
    captured = {}

    def fake_create(**kwargs):
        captured.update(kwargs)
        return type("S", (), {"url": "https://checkout.stripe.test/s_1"})()

    monkeypatch.setattr(stripe.checkout.Session, "create", staticmethod(fake_create))
    r = client.post("/api/billing/checkout-session", json={"plan": "monthly"})
    assert r.status_code == 200
    assert captured["subscription_data"]["trial_period_days"] == 7
