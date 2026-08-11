# FinalWhistle Premium (Phase A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the fan premium subscription tier — Stripe billing rails, server-side entitlements, a `/premium` pricing page, a premium advanced-markets panel on the football match page, and a supporter badge — per `docs/superpowers/specs/2026-08-11-premium-subscriptions-design.md`.

**Architecture:** Stripe hosted Checkout + Customer Portal; a `subscriptions` table keyed one-per-user, updated only by signature-verified webhooks (idempotent via a `billing_events` ledger) plus a bounded self-heal on `/api/auth/me`. Entitlement is a pure function over the subscription row, enforced server-side on premium endpoints. The frontend consumes a single `premium` flag on the session user.

**Tech Stack:** FastAPI + SQLAlchemy 2 (Mapped) + Alembic, `stripe` Python SDK, Next.js App Router + first-party session auth (`lib/session.ts`), pytest + Jest/RTL.

## Global Constraints

- Pricing: **$4.99/month**, **$39.99/year**, **7-day free trial** — prices live in Stripe; the app references them ONLY via env-configured price IDs (`STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL`). Never hardcode amounts in backend code; the `/premium` page shows the amounts in copy only.
- Billing is env-gated OFF by default: with `STRIPE_SECRET_KEY` unset, no billing endpoint works (503), no billing UI renders, and the site behaves byte-identically to today.
- Nothing free today becomes paid. Do not touch `/v1/markets`, the tips loop, GoalMarkets, ModelVsMarket, or NRL surfaces.
- Every premium check is server-side. Frontend gating is presentation only.
- Error detail shape is always `{"code": ..., "message": ...}` (house style).
- All state-changing billing endpoints require `Depends(require_same_origin)` EXCEPT `POST /api/billing/webhook` (Stripe posts cross-origin with no Origin header; its auth is the signature).
- Premium UI always carries the "Not betting advice" line, same as GoalMarkets.
- The repo is public: no keys, no live URLs with tokens, nothing secret in code, tests, or docs. Env names only.
- Python venv lives in the MAIN checkout, not the worktree: use `"/Users/macbookpro/Projects/FIFA WC26 Prediction/.venv/bin/python"` (aliased below as `$PY`). Run backend tests from the worktree repo root.
- Frontend commands run from `frontend/` (`npx jest <file>`, `npm run typecheck`).
- Production rollout (live keys, `refresh.yml` migration dispatch, deploy) is stop-gated — NOT part of this plan. The plan ends at green suites on the branch.

---

### Task 1: Stripe dependency + billing settings

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/app/config.py` (append to `Settings`)
- Modify: `backend/tests/conftest.py` (pin billing env off for hermetic tests)
- Test: `backend/tests/test_billing_config.py`

**Interfaces:**
- Produces: `settings.stripe_secret_key`, `settings.stripe_webhook_secret`, `settings.stripe_price_monthly`, `settings.stripe_price_annual`, `settings.billing_enabled` (property, bool). Every later task reads these.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_billing_config.py
"""Billing config: env-gated OFF by default (spec: billing disabled => site
behaves exactly as today)."""
from app.config import Settings, settings


def test_billing_disabled_by_default():
    fresh = Settings(_env_file=None)
    assert fresh.stripe_secret_key == ""
    assert fresh.stripe_webhook_secret == ""
    assert fresh.stripe_price_monthly == ""
    assert fresh.stripe_price_annual == ""
    assert fresh.billing_enabled is False


def test_billing_enabled_requires_key_and_both_prices():
    on = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                  stripe_price_monthly="price_m", stripe_price_annual="price_a")
    assert on.billing_enabled is True
    missing_price = Settings(_env_file=None, stripe_secret_key="sk_test_x",
                             stripe_price_monthly="price_m")
    assert missing_price.billing_enabled is False


def test_test_run_is_hermetic():
    # conftest pins the live settings object off, whatever the local .env says.
    assert settings.billing_enabled is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/macbookpro/Projects/FIFA WC26 Prediction/.claude/worktrees/final-whistle-expansion-9a1761" && $PY -m pytest backend/tests/test_billing_config.py -v`
Expected: FAIL — `Settings` has no attribute `stripe_secret_key`.

- [ ] **Step 3: Implement**

In `backend/requirements.txt`, after the `argon2-cffi` auth block, add:

```
# Billing — Stripe hosted Checkout + Customer Portal (env-gated; off by default)
stripe==12.4.0
```

(If `pip install stripe==12.4.0` reports the version doesn't exist, pin the newest 12.x that `pip index versions stripe` lists, and use that exact pin everywhere.) Then install it into the shared venv:

`"/Users/macbookpro/Projects/FIFA WC26 Prediction/.venv/bin/pip" install -r backend/requirements.txt`

In `backend/app/config.py`, inside `Settings` (after the `api_keys_allowed` block, before the `allowed_api_keys` property), add:

```python
    # Billing (FinalWhistle Premium — docs/superpowers/specs/2026-08-11-premium-
    # subscriptions-design.md). All empty by default => billing is OFF: endpoints
    # 503, no UI renders, site behaves exactly as before. Prices are Stripe Price
    # IDs — amounts live in Stripe, never in code.
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_price_monthly: str = ""
    stripe_price_annual: str = ""

    @property
    def billing_enabled(self) -> bool:
        """Billing needs the secret key AND both prices; anything less is OFF."""
        return bool(self.stripe_secret_key
                    and self.stripe_price_monthly and self.stripe_price_annual)
```

In `backend/tests/conftest.py`, append to the existing env pins:

```python
settings.stripe_secret_key = ""  # billing OFF by default in tests
settings.stripe_webhook_secret = ""
settings.stripe_price_monthly = ""
settings.stripe_price_annual = ""
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_billing_config.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/app/config.py backend/tests/conftest.py backend/tests/test_billing_config.py
git commit -m "feat: stripe dependency + env-gated billing settings"
```

---

### Task 2: Subscription + BillingEvent models and migration

**Files:**
- Modify: `backend/app/models/__init__.py` (append after `EmailVerificationToken`, before `Bracket`)
- Create: `backend/alembic/versions/e0fe02d971ed_premium_subscriptions.py`
- Test: `backend/tests/test_billing_models.py`

**Interfaces:**
- Produces: `Subscription(user_id [unique], stripe_customer_id, stripe_subscription_id [unique], status: str, plan: str, current_period_end: datetime|None, created_at, updated_at)` and `BillingEvent(event_id [unique], created_at)`. Later tasks import both from `app.models`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_billing_models.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_billing_models.py -v`
Expected: FAIL — cannot import `Subscription`.

- [ ] **Step 3: Implement the models**

In `backend/app/models/__init__.py`, directly after the `EmailVerificationToken` class, add:

```python
class Subscription(Base):
    """FinalWhistle Premium subscription state — one row per user, written by
    Stripe webhooks (plus a bounded /me self-heal). `status` uses Stripe's own
    vocabulary (trialing/active/past_due/canceled/incomplete/...); entitlement
    is derived in app.billing.is_premium, never stored."""

    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("app_users.id"), unique=True, index=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255), index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(
        String(255), unique=True, index=True
    )
    status: Mapped[str] = mapped_column(String(40))
    plan: Mapped[str] = mapped_column(String(10))  # "monthly" | "annual"
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    user: Mapped[AppUser] = relationship()


class BillingEvent(Base):
    """Processed Stripe webhook event ids — the idempotency ledger. A replayed
    delivery finds its id here and is acknowledged without being re-applied."""

    __tablename__ = "billing_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_billing_models.py -v`
Expected: 3 PASS.

- [ ] **Step 5: Write the migration**

First confirm the head is still `e2f3a4b5c6d7`:

`cd backend && PYTHONPATH=. "/Users/macbookpro/Projects/FIFA WC26 Prediction/.venv/bin/alembic" heads`

If it moved, use the printed head as `down_revision` instead. Create `backend/alembic/versions/e0fe02d971ed_premium_subscriptions.py`:

```python
"""Premium subscriptions: subscriptions + billing_events.

One subscription row per user (FinalWhistle Premium), written by Stripe
webhooks; billing_events is the processed-webhook idempotency ledger.

Revision ID: e0fe02d971ed
Revises: e2f3a4b5c6d7
Create Date: 2026-08-11
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e0fe02d971ed"
down_revision: Union[str, None] = "e2f3a4b5c6d7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "subscriptions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("app_users.id"),
                  nullable=False, unique=True, index=True),
        sa.Column("stripe_customer_id", sa.String(length=255), nullable=True, index=True),
        sa.Column("stripe_subscription_id", sa.String(length=255), nullable=True,
                  unique=True, index=True),
        sa.Column("status", sa.String(length=40), nullable=False),
        sa.Column("plan", sa.String(length=10), nullable=False),
        sa.Column("current_period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )
    op.create_table(
        "billing_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("event_id", sa.String(length=255), nullable=False,
                  unique=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True),
                  server_default=sa.func.now(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("billing_events")
    op.drop_table("subscriptions")
```

- [ ] **Step 6: Verify the migration against local Postgres**

Run: `docker compose up -d && cd backend && PYTHONPATH=. "/Users/macbookpro/Projects/FIFA WC26 Prediction/.venv/bin/alembic" upgrade head && PYTHONPATH=. "/Users/macbookpro/Projects/FIFA WC26 Prediction/.venv/bin/alembic" current`
Expected: `e0fe02d971ed (head)`. (If Docker isn't available locally, note it in the task report — CI/prod apply is stop-gated anyway — but do not skip silently.)

- [ ] **Step 7: Commit**

```bash
git add backend/app/models/__init__.py backend/alembic/versions/e0fe02d971ed_premium_subscriptions.py backend/tests/test_billing_models.py
git commit -m "feat: subscription + billing-event models and migration"
```

---

### Task 3: Entitlement resolver + `premium` on the session user

**Files:**
- Create: `backend/app/billing.py`
- Modify: `backend/app/schemas/__init__.py` (`UserOut`)
- Modify: `backend/app/api/auth.py` (`_user_out` signature + its call sites)
- Test: `backend/tests/test_billing_entitlement.py`

**Interfaces:**
- Consumes: `Subscription` (Task 2).
- Produces: `app.billing.is_premium(sub: Subscription | None, now: datetime | None = None) -> bool`; `schemas.UserOut.premium: bool = False` and `schemas.UserOut.premium_status: str | None = None` (the raw Stripe status, so the frontend can show the past-due banner); `_user_out(db: Session, u: AppUser) -> schemas.UserOut`. Tasks 4-8 import `is_premium`; frontend Task 9 reads `premium`/`premium_status` off `/api/auth/me`.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_billing_entitlement.py -v`
Expected: FAIL — no module `app.billing`.

- [ ] **Step 3: Implement**

Create `backend/app/billing.py`:

```python
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
```

In `backend/app/schemas/__init__.py`, add to `UserOut` (after `email_verified`):

```python
    # FinalWhistle Premium entitlement. Defaults False so older cached clients
    # ignore it harmlessly. premium_status is the raw Stripe status (None when
    # no subscription) — the frontend uses it for the past-due payment banner.
    premium: bool = False
    premium_status: str | None = None
```

In `backend/app/api/auth.py`, change `_user_out` to take the db session and look up the subscription:

```python
def _user_out(db: Session, u: AppUser) -> schemas.UserOut:
    sub = db.query(Subscription).filter_by(user_id=u.id).one_or_none()
    return schemas.UserOut(id=u.id, email=u.email, display_name=u.display_name,
                           avatar_url=u.avatar_url,
                           email_verified=u.email_verified_at is not None,
                           premium=billing.is_premium(sub),
                           premium_status=sub.status if sub else None)
```

Add the imports at the top of the file: `from app import billing` and extend the existing `app.models` import with `Subscription`. Then update EVERY call site: run `grep -n "_user_out(" backend/app/api/auth.py` and change each `_user_out(user)` to `_user_out(db, user)` — including `me()`, which becomes:

```python
@router.get("/me", response_model=schemas.UserOut)
def me(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    return _user_out(db, user)
```

(Every other call site — register, login, change-password — already has `db` in scope.)

- [ ] **Step 4: Run the new test AND the existing auth suite**

Run: `$PY -m pytest backend/tests/test_billing_entitlement.py backend/tests/test_auth_api.py backend/tests/test_email_verification_api.py -v`
Expected: all PASS (the auth suite proves the `_user_out` signature change broke nothing).

- [ ] **Step 5: Commit**

```bash
git add backend/app/billing.py backend/app/schemas/__init__.py backend/app/api/auth.py backend/tests/test_billing_entitlement.py
git commit -m "feat: premium entitlement resolver + premium flag on session user"
```

---

### Task 4: Billing router — checkout + portal sessions

**Files:**
- Create: `backend/app/api/billing.py`
- Modify: `backend/app/schemas/__init__.py` (append `CheckoutSessionIn`, `BillingUrlOut`)
- Modify: `backend/app/main.py` (import + register router)
- Test: `backend/tests/test_billing_api.py`

**Interfaces:**
- Consumes: `settings.billing_enabled` + price settings (Task 1), `Subscription` (Task 2), `is_premium` (Task 3), `get_current_user`, `require_same_origin`.
- Produces: `POST /api/billing/checkout-session` body `{"plan": "monthly"|"annual"}` → `{"url": str}`; `POST /api/billing/portal-session` → `{"url": str}`. Frontend Task 9 calls both. The router module is `app.api.billing`; import it in `main.py` as `billing as billing_api` to avoid clashing with `app.billing`.

- [ ] **Step 1: Write the failing test**

```python
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
    assert r.json()["detail"]["code"] == "billing_disabled"


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
    assert r.json()["detail"]["code"] == "already_subscribed"


def test_portal_404_without_customer(client, billing_on):
    _register(client)
    r = client.post("/api/billing/portal-session")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "no_subscription"


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_billing_api.py -v`
Expected: FAIL — 404s (router not registered).

- [ ] **Step 3: Implement**

Append to `backend/app/schemas/__init__.py`:

```python
# ---- Billing (FinalWhistle Premium) ----
class CheckoutSessionIn(BaseModel):
    plan: Literal["monthly", "annual"]


class BillingUrlOut(BaseModel):
    url: str
```

(Add `Literal` to the existing `typing` import if not already there.)

Create `backend/app/api/billing.py`:

```python
"""Billing endpoints — FinalWhistle Premium (Stripe hosted Checkout + Portal).

Card data never touches this server: checkout and management both redirect to
Stripe-hosted pages. Everything here is env-gated (503 when billing is off) so
an unconfigured deploy behaves exactly like today's site.
"""
from __future__ import annotations

import stripe
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import billing, schemas
from app.auth import get_current_user
from app.config import settings
from app.db import get_db
from app.models import AppUser, Subscription
from app.security import require_same_origin

router = APIRouter(prefix="/api/billing", tags=["billing"])


def _require_billing_enabled() -> None:
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail={
            "code": "billing_disabled",
            "message": "Subscriptions aren't available right now."})


@router.post("/checkout-session", response_model=schemas.BillingUrlOut,
             dependencies=[Depends(require_same_origin)])
def create_checkout_session(payload: schemas.CheckoutSessionIn,
                            user: AppUser = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    _require_billing_enabled()
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if billing.is_premium(sub):
        raise HTTPException(status_code=409, detail={
            "code": "already_subscribed",
            "message": "You already have FinalWhistle Premium."})
    price = (settings.stripe_price_annual if payload.plan == "annual"
             else settings.stripe_price_monthly)
    subscription_data: dict = {"metadata": {"user_id": str(user.id)}}
    # The 7-day trial is first-subscription only: a returning subscriber (any
    # prior row) pays from day one rather than farming repeat trials.
    if sub is None:
        subscription_data["trial_period_days"] = 7
    kwargs: dict = dict(
        api_key=settings.stripe_secret_key,
        mode="subscription",
        line_items=[{"price": price, "quantity": 1}],
        subscription_data=subscription_data,
        client_reference_id=str(user.id),
        success_url=f"{settings.public_base_url}/premium?checkout=success",
        cancel_url=f"{settings.public_base_url}/premium?checkout=cancelled",
    )
    if sub is not None and sub.stripe_customer_id:
        kwargs["customer"] = sub.stripe_customer_id
    else:
        kwargs["customer_email"] = user.email
    session = stripe.checkout.Session.create(**kwargs)
    return schemas.BillingUrlOut(url=session.url)


@router.post("/portal-session", response_model=schemas.BillingUrlOut,
             dependencies=[Depends(require_same_origin)])
def create_portal_session(user: AppUser = Depends(get_current_user),
                          db: Session = Depends(get_db)):
    _require_billing_enabled()
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if sub is None or not sub.stripe_customer_id:
        raise HTTPException(status_code=404, detail={
            "code": "no_subscription",
            "message": "No subscription to manage yet."})
    session = stripe.billing_portal.Session.create(
        api_key=settings.stripe_secret_key,
        customer=sub.stripe_customer_id,
        return_url=f"{settings.public_base_url}/premium",
    )
    return schemas.BillingUrlOut(url=session.url)
```

In `backend/app/main.py`: add `billing as billing_api` to the existing `from app.api import ...` import list, and register it next to the other routers:

```python
app.include_router(billing_api.router)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_billing_api.py -v`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/billing.py backend/app/schemas/__init__.py backend/app/main.py backend/tests/test_billing_api.py
git commit -m "feat: stripe checkout + customer portal endpoints"
```

---

### Task 5: Stripe webhook — apply events idempotently

**Files:**
- Modify: `backend/app/billing.py` (append event application)
- Modify: `backend/app/api/billing.py` (append webhook endpoint)
- Test: `backend/tests/test_billing_webhook.py`

**Interfaces:**
- Consumes: models (Task 2), router (Task 4).
- Produces: `POST /api/billing/webhook`; `billing.record_event_once(db, event_id) -> bool`; `billing.apply_event(db, event: dict) -> None`; `billing.apply_subscription_object(db, obj: dict, deleted: bool = False) -> None`. Task 6 reuses `apply_subscription_object` for reconciliation.

- [ ] **Step 1: Write the failing test**

```python
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
    assert r.json()["detail"]["code"] == "invalid_signature"


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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_billing_webhook.py -v`
Expected: FAIL — 404 (no webhook route).

- [ ] **Step 3: Implement**

Append to `backend/app/billing.py`:

```python
def record_event_once(db, event_id: str) -> bool:
    """Record a webhook event id; False when already processed. The read-then-
    insert is enough under our single web worker; the UNIQUE constraint is the
    backstop for a race (the loser 500s and Stripe redelivers into the
    duplicate path)."""
    from app.models import BillingEvent  # local import avoids a cycle at startup

    if db.query(BillingEvent).filter_by(event_id=event_id).one_or_none() is not None:
        return False
    db.add(BillingEvent(event_id=event_id))
    db.flush()
    return True


def _plan_for_price(price_id: str | None, current: str) -> str:
    from app.config import settings

    if not price_id:
        return current
    return "annual" if price_id == settings.stripe_price_annual else "monthly"


def apply_subscription_object(db, obj: dict, deleted: bool = False) -> None:
    """Upsert our row from a Stripe subscription object (webhook or a /me
    reconcile fetch). Matches by stripe_subscription_id first, then falls back
    to the user id we stamped into subscription metadata at checkout."""
    sub = (db.query(Subscription)
           .filter_by(stripe_subscription_id=obj.get("id")).one_or_none())
    if sub is None:
        meta_user = (obj.get("metadata") or {}).get("user_id")
        if not meta_user:
            return  # not one of ours — acknowledge and move on
        sub = db.query(Subscription).filter_by(user_id=int(meta_user)).one_or_none()
        if sub is None:
            sub = Subscription(user_id=int(meta_user), status="incomplete",
                               plan="monthly")
            db.add(sub)
        sub.stripe_subscription_id = obj.get("id")
    if obj.get("customer"):
        sub.stripe_customer_id = obj["customer"]
    sub.status = "canceled" if deleted else obj.get("status", sub.status)
    items = (obj.get("items") or {}).get("data") or []
    first_item = items[0] if items else {}
    # Stripe's 2025-03 "basil" API moved current_period_end onto the items;
    # accept either location so the account's API version doesn't matter.
    period_end = obj.get("current_period_end") or first_item.get("current_period_end")
    if period_end:
        sub.current_period_end = datetime.fromtimestamp(period_end, tz=timezone.utc)
    price = (first_item.get("price") or {}).get("id")
    sub.plan = _plan_for_price(price, sub.plan)


def apply_event(db, event: dict) -> None:
    """Route one verified webhook event to the subscription row. Unknown types
    are deliberately ignored (acknowledged) — additive by design."""
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        ref = obj.get("client_reference_id")
        if not ref:
            return
        sub = db.query(Subscription).filter_by(user_id=int(ref)).one_or_none()
        if sub is None:
            sub = Subscription(user_id=int(ref), status="incomplete", plan="monthly")
            db.add(sub)
        if obj.get("customer"):
            sub.stripe_customer_id = obj["customer"]
        if obj.get("subscription"):
            sub.stripe_subscription_id = obj["subscription"]
    elif etype in ("customer.subscription.created", "customer.subscription.updated",
                   "customer.subscription.deleted"):
        apply_subscription_object(db, obj, deleted=etype.endswith("deleted"))
    elif etype == "invoice.payment_failed":
        sub_id = obj.get("subscription")
        if sub_id:
            sub = (db.query(Subscription)
                   .filter_by(stripe_subscription_id=sub_id).one_or_none())
            if sub is not None:
                sub.status = "past_due"
```

Append to `backend/app/api/billing.py` (module already imports `stripe`, `settings`, `billing`):

```python
@router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    """Stripe server-to-server delivery. Auth is the signature (no session, no
    Origin check). 2xx only after the row change is committed — anything else
    makes Stripe retry, which the billing_events ledger makes safe."""
    _require_billing_enabled()
    payload = await request.body()
    sig = request.headers.get("stripe-signature", "")
    try:
        event = stripe.Webhook.construct_event(
            payload, sig, settings.stripe_webhook_secret)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail={
            "code": "invalid_signature",
            "message": "Webhook signature verification failed."})
    if not billing.record_event_once(db, event["id"]):
        return {"ok": True, "duplicate": True}
    billing.apply_event(db, event)
    db.commit()
    return {"ok": True}
```

Add `Request` to the `fastapi` import in that file. If `stripe.error` raises an
`AttributeError` under the pinned SDK (newer majors moved it), use
`from stripe import SignatureVerificationError` and catch
`(ValueError, SignatureVerificationError)` instead.

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_billing_webhook.py backend/tests/test_billing_api.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/billing.py backend/app/api/billing.py backend/tests/test_billing_webhook.py
git commit -m "feat: idempotent stripe webhook wired to subscription state"
```

---

### Task 6: `/me` self-heal reconciliation

**Files:**
- Modify: `backend/app/billing.py` (append `reconcile_if_stale`)
- Modify: `backend/app/api/auth.py` (`me()` calls it)
- Test: `backend/tests/test_billing_reconcile.py`

**Interfaces:**
- Consumes: `apply_subscription_object` (Task 5).
- Produces: `billing.reconcile_if_stale(db, sub: Subscription | None) -> None` — safe no-op unless billing is on AND the row looks active-ish but expired AND wasn't touched in the last hour.

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_billing_reconcile.py -v`
Expected: FAIL — `reconcile_if_stale` doesn't exist.

- [ ] **Step 3: Implement**

Append to `backend/app/billing.py`:

```python
RECONCILE_MIN_INTERVAL = timedelta(hours=1)


def reconcile_if_stale(db, sub: Subscription | None) -> None:
    """Self-heal for missed webhooks (spec: bounded, cached, never on the hot
    path). Only fires when the row claims an entitled-ish status whose period
    already ended, at most once per hour, and NEVER raises — /me must succeed
    with the stored row when Stripe is unreachable."""
    import stripe

    from app.config import settings

    if sub is None or not settings.billing_enabled:
        return
    if sub.status not in ("trialing", "active", "past_due"):
        return
    if not sub.stripe_subscription_id or sub.current_period_end is None:
        return
    now = datetime.now(timezone.utc)
    if to_aware_utc(sub.current_period_end) >= now:
        return  # not stale — the common case, zero Stripe calls
    if sub.updated_at is not None and \
            now - to_aware_utc(sub.updated_at) < RECONCILE_MIN_INTERVAL:
        return  # recently refreshed — throttle
    try:
        remote = stripe.Subscription.retrieve(
            sub.stripe_subscription_id, api_key=settings.stripe_secret_key)
        apply_subscription_object(db, dict(remote))
        sub.updated_at = now  # explicit: throttle even when nothing changed
        db.commit()
    except Exception:
        db.rollback()  # keep the stored row authoritative; never break /me
```

In `backend/app/api/auth.py`, update `me()`:

```python
@router.get("/me", response_model=schemas.UserOut)
def me(user: AppUser = Depends(get_current_user), db: Session = Depends(get_db)):
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    billing.reconcile_if_stale(db, sub)
    return _user_out(db, user)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_billing_reconcile.py backend/tests/test_auth_api.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/billing.py backend/app/api/auth.py backend/tests/test_billing_reconcile.py
git commit -m "feat: bounded stripe reconcile on /me for missed webhooks"
```

---

### Task 7: Premium markets endpoint

**Files:**
- Create: `backend/app/api/premium_markets.py`
- Modify: `backend/app/main.py` (import + register)
- Test: `backend/tests/test_premium_markets_api.py`

**Interfaces:**
- Consumes: `is_premium` (Task 3), `serializers.latest_prediction(db, match_id)` and `serializers.prediction_to_markets_out(db, match, pred)` (existing — same internals as `/v1/markets`), `schemas.MarketsOut` (existing).
- Produces: `GET /api/matches/{match_id}/markets` → `schemas.MarketsOut`; 401 anonymous, 403 `premium_required` for free users. Frontend Task 12 calls it.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_premium_markets_api.py
"""Consumer premium markets: server-side entitlement (401/403), and the payload
is the same MarketsOut the B2B /v1 surface serves (frozen basis)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import Match, Prediction, Subscription, Team

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
    c.sessionmaker = TestingSession
    yield c
    app.dependency_overrides.clear()


def _seed_match(db):
    h, a = Team(name="Argentina"), Team(name="Cape Verde")
    db.add_all([h, a]); db.commit()
    m = Match(tournament_id=1, stage="group", is_neutral=True,
              team_home_id=h.id, team_away_id=a.id)
    db.add(m); db.commit()
    p = Prediction(match_id=m.id, model_version="v",
                   prob_home_win=0.7, prob_draw=0.2, prob_away_win=0.1,
                   lambda_home=2.5, lambda_away=0.4, rho=-0.1)
    db.add(p); db.commit()
    return m.id


def _register(client, email="fan@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def test_anonymous_gets_401(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    assert client.get(f"/api/matches/{match_id}/markets").status_code == 401


def test_free_user_gets_403(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    _register(client)
    r = client.get(f"/api/matches/{match_id}/markets")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "premium_required"


def test_premium_user_gets_full_markets(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly"))
    db.commit(); db.close()
    r = client.get(f"/api/matches/{match_id}/markets")
    assert r.status_code == 200
    body = r.json()
    assert body["match_id"] == match_id
    assert set(body["markets"]) >= {"one_x_two", "totals", "btts",
                                    "correct_score", "asian_handicap"}
    assert body["markets"]["correct_score"]  # non-empty grid
    assert "disclaimer" in body


def test_404_when_no_prediction(client):
    db = client.sessionmaker()
    h, a = Team(name="X"), Team(name="Y")
    db.add_all([h, a]); db.commit()
    m = Match(tournament_id=1, stage="group", is_neutral=True,
              team_home_id=h.id, team_away_id=a.id)
    db.add(m); db.commit()
    match_id = m.id
    db.close()
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly"))
    db.commit(); db.close()
    assert client.get(f"/api/matches/{match_id}/markets").status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_premium_markets_api.py -v`
Expected: FAIL — 404s (route missing) where 401/403/200 expected.

- [ ] **Step 3: Implement**

Create `backend/app/api/premium_markets.py`:

```python
"""Fan-facing premium markets — GET /api/matches/{id}/markets.

The consumer twin of /v1/markets (same serializers, same frozen pre-kickoff
basis), gated by the FinalWhistle Premium entitlement instead of an API key.
Server-side enforcement: the frontend gate is presentation only.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import billing, schemas, serializers
from app.auth import get_current_user
from app.db import get_db
from app.models import AppUser, Match, Subscription

router = APIRouter(prefix="/api/matches", tags=["premium-markets"])


@router.get("/{match_id}/markets", response_model=schemas.MarketsOut)
def premium_markets(match_id: int, db: Session = Depends(get_db),
                    user: AppUser = Depends(get_current_user)):
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if not billing.is_premium(sub):
        raise HTTPException(status_code=403, detail={
            "code": "premium_required",
            "message": "FinalWhistle Premium unlocks the full match markets."})
    match = db.get(Match, match_id)
    if match is None:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": f"No match {match_id}"})
    pred = serializers.latest_prediction(db, match_id)
    if pred is None:
        raise HTTPException(status_code=404, detail={
            "code": "no_prediction", "message": "No prediction for this match yet"})
    if pred.lambda_home is None or pred.lambda_away is None:
        raise HTTPException(status_code=404, detail={
            "code": "markets_unavailable",
            "message": "No scoreline model for this match"})
    return serializers.prediction_to_markets_out(db, match, pred)
```

In `backend/app/main.py`: add `premium_markets` to the `from app.api import ...` list and register `app.include_router(premium_markets.router)` next to the other match routers.

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_premium_markets_api.py -v`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/premium_markets.py backend/app/main.py backend/tests/test_premium_markets_api.py
git commit -m "feat: premium-gated consumer markets endpoint"
```

---

### Task 8: Supporter badge on the leaderboard (backend)

**Files:**
- Modify: `backend/app/schemas/__init__.py` (`LeaderboardRowOut`)
- Modify: `backend/app/api/leaderboard.py`
- Test: extend `backend/tests/test_leaderboard_api.py` (append one test; follow the file's existing fixtures)

**Interfaces:**
- Produces: `LeaderboardRowOut.premium: bool = False`. Frontend Task 13 renders it.

- [ ] **Step 1: Write the failing test**

Open `backend/tests/test_leaderboard_api.py`, reuse its existing client/seeding fixtures (do not invent new ones — mirror how its current tests create a public bracket with a score), and append:

```python
def test_leaderboard_marks_premium_supporters(client):
    # Arrange exactly like the existing "appears on leaderboard" test in this
    # file (register user, save bracket, join leaderboard as public), then:
    from app.models import Subscription
    db = client.sessionmaker()  # or this file's equivalent session handle
    user_id = db.query(AppUser).filter_by(email="leader@example.com").one().id
    db.add(Subscription(user_id=user_id, status="active", plan="monthly"))
    db.commit(); db.close()

    rows = client.get("/api/leaderboard").json()
    assert rows and rows[0]["premium"] is True
```

(Adapt the arrange block to this file's real fixture names — the assertion contract is the part that must not change: a subscribed public user's row has `premium: true`, everyone else defaults `false`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `$PY -m pytest backend/tests/test_leaderboard_api.py -v`
Expected: the new test FAILS with `KeyError: 'premium'`; existing tests PASS.

- [ ] **Step 3: Implement**

In `backend/app/schemas/__init__.py`, add to `LeaderboardRowOut` after `updated_at`:

```python
    # FinalWhistle Premium supporter badge (defaults False for older clients).
    premium: bool = False
```

In `backend/app/api/leaderboard.py`: add `Subscription` to the `app.models` import and `from app import billing`. In `leaderboard()`, after `rows` are fetched, resolve subscriptions in ONE query (no N+1):

```python
    user_ids = [bracket.user_id for bracket, _, _ in rows]
    subs = {s.user_id: s for s in
            db.query(Subscription).filter(Subscription.user_id.in_(user_ids)).all()
            } if user_ids else {}
```

and extend the row constructor:

```python
                premium=billing.is_premium(subs.get(bracket.user_id)),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `$PY -m pytest backend/tests/test_leaderboard_api.py -v`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/schemas/__init__.py backend/app/api/leaderboard.py backend/tests/test_leaderboard_api.py
git commit -m "feat: premium supporter flag on leaderboard rows"
```

---

### Task 9: Frontend billing client + types + flag

**Files:**
- Modify: `frontend/lib/session.ts`
- Modify: `frontend/lib/types.ts` (`LeaderboardRow`)
- Modify: `frontend/lib/constants.ts`
- Test: extend `frontend/lib/session.test.ts`

**Interfaces:**
- Produces: `SessionUser.premium?: boolean`; `BILLING_ENABLED: boolean` (from `NEXT_PUBLIC_BILLING_ENABLED === "true"`); `createCheckoutSession(plan: "monthly" | "annual"): Promise<{url: string}>`; `createPortalSession(): Promise<{url: string}>`; `getPremiumMarkets(matchId: number | string): Promise<PremiumMarkets>` with

```ts
export interface PremiumMarkets {
  match_id: number;
  model_version: string;
  markets: {
    one_x_two: { home_win: number; draw: number; away_win: number };
    totals: { line: number; over: number; under: number }[];
    btts: { yes: number; no: number };
    correct_score: { home: number; away: number; prob: number }[];
    asian_handicap: { line: number; home: number; push: number; away: number }[];
  };
  disclaimer: string;
}
```

Tasks 10-13 import all of these.

- [ ] **Step 1: Write the failing test**

Open `frontend/lib/session.test.ts`, follow its existing fetch-mocking pattern exactly (same helpers it uses for `register`/`login`), and append a describe block:

```ts
describe("billing client", () => {
  it("posts the plan to /api/billing/checkout-session", async () => {
    // mock fetch the same way this file's register/login tests do,
    // resolving { url: "https://checkout.stripe.test/x" }
    const out = await createCheckoutSession("annual");
    expect(out.url).toBe("https://checkout.stripe.test/x");
    // assert the mocked fetch was called with path containing
    // "/api/billing/checkout-session", method POST, body {"plan":"annual"}
  });

  it("posts to /api/billing/portal-session", async () => {
    const out = await createPortalSession();
    expect(out.url).toBeDefined();
  });

  it("fetches premium markets for a match", async () => {
    const out = await getPremiumMarkets(42);
    expect(out.match_id).toBe(42);
  });
});
```

(Concrete mock wiring comes from the file's existing tests — reuse it verbatim; the contract is path + method + body per the Interfaces block above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest lib/session.test.ts`
Expected: FAIL — `createCheckoutSession` is not exported.

- [ ] **Step 3: Implement**

In `frontend/lib/session.ts`:
- Extend `SessionUser` after `email_verified`:

```ts
  // FinalWhistle Premium entitlement. Optional: a cached hint from before this
  // field existed won't have it (undefined = unknown, treat as not premium).
  premium?: boolean;
  // Raw Stripe subscription status (null when no subscription) — drives the
  // past-due "payment issue" banner on /premium.
  premium_status?: string | null;
```

- Append, following the file's `request<T>` helper style (mirror `register`'s shape exactly, including how it sets method/body):

```ts
// ---- Billing (FinalWhistle Premium) ----
export interface PremiumMarkets {
  match_id: number;
  model_version: string;
  markets: {
    one_x_two: { home_win: number; draw: number; away_win: number };
    totals: { line: number; over: number; under: number }[];
    btts: { yes: number; no: number };
    correct_score: { home: number; away: number; prob: number }[];
    asian_handicap: { line: number; home: number; push: number; away: number }[];
  };
  disclaimer: string;
}

export const createCheckoutSession = (plan: "monthly" | "annual") =>
  request<{ url: string }>("/api/billing/checkout-session", {
    method: "POST",
    body: JSON.stringify({ plan }),
  });

export const createPortalSession = () =>
  request<{ url: string }>("/api/billing/portal-session", { method: "POST" });

export const getPremiumMarkets = (matchId: number | string) =>
  request<PremiumMarkets>(`/api/matches/${matchId}/markets`);
```

In `frontend/lib/types.ts`, add to `LeaderboardRow`: `premium?: boolean;`

In `frontend/lib/constants.ts`, append:

```ts
/** FinalWhistle Premium — billing UI gate. Mirrors the backend's env gate:
 *  unset/false => no premium surface renders anywhere. */
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
```

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx jest lib/session.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/session.ts frontend/lib/types.ts frontend/lib/constants.ts frontend/lib/session.test.ts
git commit -m "feat: frontend billing client, premium flag and env gate"
```

---

### Task 10: PremiumGate component

**Files:**
- Create: `frontend/components/PremiumGate.tsx`
- Test: `frontend/components/PremiumGate.test.tsx`

**Interfaces:**
- Consumes: `useAuth()` from `@/components/AuthProvider`, `BILLING_ENABLED`.
- Produces: `<PremiumGate teaser={ReactNode}>{children}</PremiumGate>` — renders `children` for premium users; the `teaser` plus an upgrade CTA (link to `/premium`, or sign-in first for anonymous users) otherwise; `null` when `BILLING_ENABLED` is false. Tasks 12 uses it.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/PremiumGate.test.tsx
/** PremiumGate: premium sees children; free/anon see the teaser + CTA;
 *  billing off renders nothing at all. */
import { render, screen } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => mockUseAuth(),
}));

// BILLING_ENABLED is read at import time — evaluate per-test via isolateModules.
function renderGate(billingEnabled: boolean) {
  let Gate: React.ComponentType<{ teaser: React.ReactNode; children: React.ReactNode }> =
    () => null;
  jest.isolateModules(() => {
    jest.doMock("@/lib/constants", () => ({
      ...jest.requireActual("@/lib/constants"),
      BILLING_ENABLED: billingEnabled,
    }));
    Gate = require("./PremiumGate").PremiumGate;
  });
  return render(
    <Gate teaser={<div>teaser here</div>}>
      <div>secret markets</div>
    </Gate>,
  );
}

describe("PremiumGate", () => {
  it("renders children for a premium user", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    renderGate(true);
    expect(screen.getByText("secret markets")).toBeInTheDocument();
    expect(screen.queryByText("teaser here")).not.toBeInTheDocument();
  });

  it("renders teaser + upgrade CTA for a free user", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn() });
    renderGate(true);
    expect(screen.getByText("teaser here")).toBeInTheDocument();
    expect(screen.queryByText("secret markets")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /premium/i }))
      .toHaveAttribute("href", "/premium");
  });

  it("renders teaser with sign-in CTA for anonymous", () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn });
    renderGate(true);
    expect(screen.getByText("teaser here")).toBeInTheDocument();
  });

  it("renders nothing when billing is disabled", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn: jest.fn() });
    const { container } = renderGate(false);
    expect(container).toBeEmptyDOMElement();
  });
});
```

(If `Gate!` non-null syntax bothers the linter, hoist with `let Gate: any` — match the codebase's test lint rules.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest components/PremiumGate.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/components/PremiumGate.tsx
"use client";

/** Gates a premium surface. Presentation only — the backend enforces the real
 *  entitlement (403 premium_required) — so this can stay optimistic and simple.
 *  Billing off (BILLING_ENABLED=false) renders nothing: the site must look
 *  exactly as it did before Premium existed. */
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";

export function PremiumGate({ teaser, children }: {
  teaser: React.ReactNode;
  children: React.ReactNode;
}) {
  const { user, openSignIn } = useAuth();
  if (!BILLING_ENABLED) return null;
  if (user?.premium) return <>{children}</>;
  return (
    <section className="glass rounded-2xl p-6">
      <div aria-hidden className="pointer-events-none select-none blur-[3px] opacity-60">
        {teaser}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <span className="text-sm text-[var(--muted)]">
          Full scoreline grid, totals, BTTS and handicaps — for members.
        </span>
        {user ? (
          <Link href="/premium"
                className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold">
            Go Premium
          </Link>
        ) : (
          <button type="button"
                  onClick={() => openSignIn({ mode: "signup" })}
                  className="rounded-full bg-[var(--accent)] px-4 py-1.5 text-sm font-semibold">
            Create a free account
          </button>
        )}
        {!user && (
          <Link href="/premium" className="text-sm underline">
            About Premium
          </Link>
        )}
      </div>
    </section>
  );
}
```

Before finalizing, open one existing glass-card component (e.g. `components/GoalMarkets.tsx`) and match its exact class/CSS-variable idioms — the classes above are directional, the house tokens are authoritative.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx jest components/PremiumGate.test.tsx`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/PremiumGate.tsx frontend/components/PremiumGate.test.tsx
git commit -m "feat: PremiumGate component"
```

---

### Task 11: /premium pricing page

**Files:**
- Create: `frontend/app/premium/page.tsx`
- Create: `frontend/app/premium/PremiumClient.tsx`
- Test: `frontend/app/premium/page.test.tsx`

**Interfaces:**
- Consumes: `createCheckoutSession`, `createPortalSession`, `friendlyAuthError` (from `@/lib/session`), `useAuth`, `BILLING_ENABLED`.
- Produces: the `/premium` route. Task 12's CTA links land here.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/app/premium/page.test.tsx
/** /premium: shows both prices + trial copy + disclaimer; CTA branches by
 *  auth state; checkout redirect uses the session URL. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));

const mockCheckout = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  createCheckoutSession: (...a: unknown[]) => mockCheckout(...a),
  createPortalSession: jest.fn(),
}));
jest.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import { PremiumClient } from "./PremiumClient";

describe("PremiumClient", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows pricing, trial and the disclaimer", () => {
    mockUseAuth.mockReturnValue({ user: null, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    render(<PremiumClient />);
    expect(screen.getByText(/\$4\.99/)).toBeInTheDocument();
    expect(screen.getByText(/\$39\.99/)).toBeInTheDocument();
    expect(screen.getByText(/7-day free trial/i)).toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/i)).toBeInTheDocument();
  });

  it("signed-in free user goes straight to checkout", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    mockCheckout.mockResolvedValue({ url: "https://checkout.stripe.test/x" });
    const assignSpy = jest.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: assignSpy }, writable: true,
    });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    await waitFor(() => expect(mockCheckout).toHaveBeenCalledWith("monthly"));
    await waitFor(() =>
      expect(assignSpy).toHaveBeenCalledWith("https://checkout.stripe.test/x"));
  });

  it("anonymous user is sent to sign-in first", () => {
    const openSignIn = jest.fn();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn,
                                  refresh: jest.fn() });
    render(<PremiumClient />);
    fireEvent.click(screen.getByRole("button", { name: /start free trial/i }));
    expect(openSignIn).toHaveBeenCalled();
    expect(mockCheckout).not.toHaveBeenCalled();
  });

  it("premium user sees manage instead of buy", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn(), refresh: jest.fn() });
    render(<PremiumClient />);
    expect(screen.getByRole("button", { name: /manage subscription/i }))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start free trial/i }))
      .not.toBeInTheDocument();
  });

  it("past-due user sees the payment-issue banner", () => {
    mockUseAuth.mockReturnValue({
      user: { id: 1, premium: true, premium_status: "past_due" },
      loading: false, openSignIn: jest.fn(), refresh: jest.fn(),
    });
    render(<PremiumClient />);
    expect(screen.getByText(/payment issue/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest app/premium/page.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`frontend/app/premium/page.tsx` (server component — mirror the metadata style of `app/leaderboard/page.tsx`):

```tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BILLING_ENABLED } from "@/lib/constants";
import { PremiumClient } from "./PremiumClient";

export const metadata: Metadata = {
  title: "FinalWhistle Premium",
  description:
    "The analyst tier: full scoreline grids, totals, BTTS and Asian handicap probabilities for every match, from the same audited model.",
};

export default function PremiumPage() {
  if (!BILLING_ENABLED) notFound();
  return <PremiumClient />;
}
```

`frontend/app/premium/PremiumClient.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createCheckoutSession,
  createPortalSession,
  friendlyAuthError,
} from "@/lib/session";

type Plan = "monthly" | "annual";

const FEATURES = [
  "Full correct-score probability grid for every match",
  "Over/under lines, BTTS and Asian handicap probabilities",
  "Supporter badge on the leaderboard",
  "Early access to new competitions and features",
];

export function PremiumClient() {
  const { user, loading, openSignIn, refresh } = useAuth();
  const [plan, setPlan] = useState<Plan>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const justPaid = params.get("checkout") === "success";

  // After the Stripe redirect the webhook may land a beat later than the user:
  // poll /me a few times until the premium flag flips.
  useEffect(() => {
    if (!justPaid || user?.premium) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      refresh();
      if (tries >= 5) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [justPaid, user?.premium, refresh]);

  const startCheckout = useCallback(async (p: Plan) => {
    setBusy(true); setError(null);
    try {
      const { url } = await createCheckoutSession(p);
      window.location.assign(url);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  }, []);

  const onBuy = () => {
    if (!user) {
      openSignIn({ mode: "signup", onSuccess: () => startCheckout(plan) });
      return;
    }
    void startCheckout(plan);
  };

  const onManage = async () => {
    setBusy(true); setError(null);
    try {
      const { url } = await createPortalSession();
      window.location.assign(url);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <h1 className="text-3xl font-bold">FinalWhistle Premium</h1>
      <p className="mt-2 text-[var(--muted)]">
        The analyst tier — every market our model prices, on every match.
        Everything free today stays free.
      </p>

      {justPaid && (
        <div className="mt-4 rounded-xl border border-[var(--accent)] p-4 text-sm">
          {user?.premium
            ? "You're Premium. Enjoy the full markets."
            : "Payment received — activating your membership…"}
        </div>
      )}

      {user?.premium_status === "past_due" && (
        <div className="mt-4 rounded-xl border border-amber-500 p-4 text-sm">
          There's a payment issue with your subscription — your membership stays
          active for a few days while you update your card.
          <button type="button" onClick={onManage} className="ml-2 underline">
            Update payment method
          </button>
        </div>
      )}

      <ul className="mt-6 space-y-2">
        {FEATURES.map((f) => <li key={f} className="text-sm">✓ {f}</li>)}
      </ul>

      {!user?.premium && (
        <div className="mt-8 flex gap-3" role="radiogroup" aria-label="Billing period">
          <button type="button" role="radio" aria-checked={plan === "monthly"}
                  onClick={() => setPlan("monthly")}
                  className={`rounded-xl border px-4 py-3 text-left ${plan === "monthly" ? "border-[var(--accent)]" : "border-[var(--border)]"}`}>
            <div className="font-semibold">$4.99<span className="text-sm font-normal">/month</span></div>
          </button>
          <button type="button" role="radio" aria-checked={plan === "annual"}
                  onClick={() => setPlan("annual")}
                  className={`rounded-xl border px-4 py-3 text-left ${plan === "annual" ? "border-[var(--accent)]" : "border-[var(--border)]"}`}>
            <div className="font-semibold">$39.99<span className="text-sm font-normal">/year</span></div>
            <div className="text-xs text-[var(--muted)]">2 months free</div>
          </button>
        </div>
      )}

      <div className="mt-6">
        {user?.premium ? (
          <button type="button" onClick={onManage} disabled={busy}
                  className="rounded-full bg-[var(--accent)] px-6 py-2 font-semibold">
            Manage subscription
          </button>
        ) : (
          <button type="button" onClick={onBuy} disabled={busy || loading}
                  className="rounded-full bg-[var(--accent)] px-6 py-2 font-semibold">
            Start free trial
          </button>
        )}
        <p className="mt-2 text-xs text-[var(--muted)]">
          7-day free trial, cancel anytime. Payments handled by Stripe.
        </p>
      </div>

      {error && <p className="mt-3 text-sm text-red-500">{error}</p>}

      <p className="mt-10 text-xs text-[var(--muted)]">
        Model probabilities for analytics and entertainment. Not betting advice.
      </p>
    </main>
  );
}
```

Match surrounding pages' class idioms (check `app/leaderboard/LeaderboardClient.tsx` for the house button/border tokens) before finalizing.

- [ ] **Step 4: Run test + typecheck**

Run: `cd frontend && npx jest app/premium/page.test.tsx && npm run typecheck`
Expected: 4 PASS, clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/app/premium
git commit -m "feat: /premium pricing page with checkout + portal flows"
```

---

### Task 12: PremiumMarkets panel on the match page

**Files:**
- Create: `frontend/components/PremiumMarkets.tsx`
- Modify: `frontend/app/match/[id]/MatchPageContent.tsx` (insert after the `<GoalMarkets .../>` block, around line 194)
- Test: `frontend/components/PremiumMarkets.test.tsx`

**Interfaces:**
- Consumes: `PremiumGate` (Task 10), `getPremiumMarkets` + `PremiumMarkets` type (Task 9), `useAuth`.
- Produces: `<PremiumMarkets matchId={number} home={string} away={string} />`.

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/components/PremiumMarkets.test.tsx
/** PremiumMarkets: premium fetches + renders the four market blocks; free
 *  users get the gated teaser; billing off renders nothing; fetch errors
 *  collapse quietly (no crash, no broken card). */
import { render, screen, waitFor } from "@testing-library/react";

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));
const mockGet = jest.fn();
jest.mock("@/lib/session", () => ({
  ...jest.requireActual("@/lib/session"),
  getPremiumMarkets: (...a: unknown[]) => mockGet(...a),
}));

import { PremiumMarkets } from "./PremiumMarkets";

const PAYLOAD = {
  match_id: 7,
  model_version: "poisson-elo-v0.6",
  markets: {
    one_x_two: { home_win: 0.7, draw: 0.2, away_win: 0.1 },
    totals: [{ line: 2.5, over: 0.61, under: 0.39 }],
    btts: { yes: 0.44, no: 0.56 },
    correct_score: [{ home: 2, away: 0, prob: 0.14 },
                    { home: 1, away: 0, prob: 0.13 }],
    asian_handicap: [{ line: -1.0, home: 0.41, push: 0.18, away: 0.41 }],
  },
  disclaimer: "Not betting advice.",
};

describe("PremiumMarkets", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the market blocks for a premium user", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    mockGet.mockResolvedValue(PAYLOAD);
    render(<PremiumMarkets matchId={7} home="Argentina" away="Cape Verde" />);
    await waitFor(() => expect(screen.getByText(/correct score/i)).toBeInTheDocument());
    expect(screen.getByText(/over\/under/i)).toBeInTheDocument();
    expect(screen.getByText(/both teams to score/i)).toBeInTheDocument();
    expect(screen.getByText(/asian handicap/i)).toBeInTheDocument();
    expect(screen.getByText(/2–0/)).toBeInTheDocument();
    expect(screen.getByText(/Not betting advice/i)).toBeInTheDocument();
  });

  it("shows the gate for a free user and never fetches", () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: false }, loading: false,
                                  openSignIn: jest.fn() });
    render(<PremiumMarkets matchId={7} home="Argentina" away="Cape Verde" />);
    expect(mockGet).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /premium/i })).toBeInTheDocument();
  });

  it("collapses quietly when the fetch fails", async () => {
    mockUseAuth.mockReturnValue({ user: { id: 1, premium: true }, loading: false,
                                  openSignIn: jest.fn() });
    mockGet.mockRejectedValue(new Error("boom"));
    const { container } = render(
      <PremiumMarkets matchId={7} home="A" away="B" />);
    await waitFor(() => expect(mockGet).toHaveBeenCalled());
    expect(container.querySelector("table")).toBeNull(); // no half-rendered card
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx jest components/PremiumMarkets.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```tsx
// frontend/components/PremiumMarkets.tsx
"use client";

/** The premium advanced-markets panel (Phase A of the premium spec): correct-
 *  score grid, totals, BTTS, Asian handicap — the same frozen numbers the B2B
 *  /v1/markets surface serves. Free users see a blurred teaser via PremiumGate;
 *  the backend independently enforces the entitlement (403). */
import { useEffect, useState } from "react";
import { useAuth } from "@/components/AuthProvider";
import { PremiumGate } from "@/components/PremiumGate";
import { getPremiumMarkets, type PremiumMarkets as Payload } from "@/lib/session";
import { pct } from "@/lib/format";

const TEASER: Payload["markets"] = {
  one_x_two: { home_win: 0.52, draw: 0.26, away_win: 0.22 },
  totals: [{ line: 2.5, over: 0.57, under: 0.43 }],
  btts: { yes: 0.48, no: 0.52 },
  correct_score: [{ home: 2, away: 1, prob: 0.11 }, { home: 1, away: 1, prob: 0.1 },
                  { home: 1, away: 0, prob: 0.1 }],
  asian_handicap: [{ line: -0.5, home: 0.52, push: 0, away: 0.48 }],
};

function MarketsBody({ home, away, markets, disclaimer }: {
  home: string; away: string; markets: Payload["markets"]; disclaimer: string;
}) {
  const top = [...markets.correct_score].sort((a, b) => b.prob - a.prob).slice(0, 6);
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Correct score</h3>
        <ul className="mt-2 grid grid-cols-3 gap-2">
          {top.map((cs) => (
            <li key={`${cs.home}-${cs.away}`}
                className="rounded-lg border border-[var(--border)] p-2 text-center">
              <div className="font-semibold">{cs.home}–{cs.away}</div>
              <div className="text-xs text-[var(--muted)]">{pct(cs.prob)}</div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Over/under</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {markets.totals.map((t) => (
            <li key={t.line} className="flex justify-between">
              <span>{t.line} goals</span>
              <span>Over {pct(t.over)} · Under {pct(t.under)}</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Both teams to score</h3>
        <p className="mt-1 text-sm">Yes {pct(markets.btts.yes)} · No {pct(markets.btts.no)}</p>
      </div>
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide">Asian handicap</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {markets.asian_handicap.map((h) => (
            <li key={h.line} className="flex justify-between">
              <span>{home} {h.line > 0 ? `+${h.line}` : h.line}</span>
              <span>{pct(h.home)} · push {pct(h.push)} · {away} {pct(h.away)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-[var(--muted)]">{disclaimer}</p>
    </div>
  );
}

export function PremiumMarkets({ matchId, home, away }: {
  matchId: number; home: string; away: string;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user?.premium) return;
    let alive = true;
    getPremiumMarkets(matchId)
      .then((d) => { if (alive) setData(d); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [matchId, user?.premium]);

  if (user?.premium) {
    if (failed || !data) return null; // loading or unavailable: collapse quietly
    return (
      <section className="glass rounded-2xl p-6">
        <h2 className="mb-4 font-semibold">Full match markets</h2>
        <MarketsBody home={home} away={away}
                     markets={data.markets} disclaimer={data.disclaimer} />
      </section>
    );
  }
  return (
    <PremiumGate teaser={
      <MarketsBody home={home} away={away} markets={TEASER}
                   disclaimer="Not betting advice." />
    }>
      {null}
    </PremiumGate>
  );
}
```

In `frontend/app/match/[id]/MatchPageContent.tsx`: import `PremiumMarkets` alongside the other component imports, and directly after the `<GoalMarkets home={home} away={away} markets={p.goal_markets} />` line (~194) add:

```tsx
            <PremiumMarkets matchId={m.id} home={home} away={away} />
```

(Use the same match-object variable the surrounding JSX uses for the id — check whether it's `m.id` or `match.id` in that scope and match it.)

- [ ] **Step 4: Run tests + typecheck**

Run: `cd frontend && npx jest components/PremiumMarkets.test.tsx app/match && npm run typecheck`
Expected: PASS (including the match page's existing tests), clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/PremiumMarkets.tsx frontend/components/PremiumMarkets.test.tsx "frontend/app/match/[id]/MatchPageContent.tsx"
git commit -m "feat: premium advanced-markets panel on the match page"
```

---

### Task 13: Supporter badge (frontend) + Manage subscription in the account menu

**Files:**
- Modify: `frontend/app/leaderboard/LeaderboardClient.tsx` (badge chip next to `display_name`)
- Modify: `frontend/components/AccountMenu.tsx` ("Manage subscription" item)
- Test: extend the leaderboard test file if one exists (`frontend/app/leaderboard/*.test.tsx` — check first); create `frontend/components/AccountMenu.premium.test.tsx` for the menu item

**Interfaces:**
- Consumes: `LeaderboardRow.premium` (Task 9), `createPortalSession` (Task 9), `useAuth`, `BILLING_ENABLED`.

- [ ] **Step 1: Write the failing tests**

For the badge, find where `LeaderboardClient` renders `row.display_name` and assert the chip. If no leaderboard component test exists, create `frontend/app/leaderboard/LeaderboardClient.premium.test.tsx` mocking the rows prop:

```tsx
import { render, screen } from "@testing-library/react";
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));
import { LeaderboardClient } from "./LeaderboardClient";

it("shows a supporter badge on premium rows only", () => {
  render(<LeaderboardClient initialRows={[
    { rank: 1, display_name: "Ada", champion: null, total_points: 12,
      percentile: null, updated_at: null, premium: true },
    { rank: 2, display_name: "Grace", champion: null, total_points: 9,
      percentile: null, updated_at: null, premium: false },
  ] as never} />);
  expect(screen.getByLabelText("Premium supporter")).toBeInTheDocument();
  expect(screen.getAllByLabelText("Premium supporter")).toHaveLength(1);
});
```

(`LeaderboardClient` may need more mocked context — mirror whatever its existing tests or sibling component tests mock; keep the assertion contract.)

For the menu, `frontend/components/AccountMenu.premium.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/lib/constants", () => ({
  ...jest.requireActual("@/lib/constants"),
  BILLING_ENABLED: true,
}));
import { AccountMenu } from "./AccountMenu";

it("shows Manage subscription for premium users only", () => {
  mockUseAuth.mockReturnValue({ user: { id: 1, email: "a@b.c", premium: true },
                                loading: false, logout: jest.fn(),
                                deleteAccount: jest.fn(), openSignIn: jest.fn(),
                                registerLogoutFlush: () => () => {} });
  render(<AccountMenu />);
  // open the menu first if it renders collapsed — mirror the existing
  // AccountMenu tests' open interaction
  expect(screen.getByText(/manage subscription/i)).toBeInTheDocument();
});
```

(Read `AccountMenu.tsx` and any existing AccountMenu test before writing — its props and open/close mechanics are authoritative; the contract is: premium + billing on ⇒ a "Manage subscription" item that calls `createPortalSession` and navigates to the returned URL; otherwise the item is absent.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx jest LeaderboardClient.premium AccountMenu.premium`
Expected: FAIL on the missing badge/menu item.

- [ ] **Step 3: Implement**

In `LeaderboardClient.tsx`, where the row's `display_name` renders, append:

```tsx
{row.premium && (
  <span aria-label="Premium supporter" title="Premium supporter"
        className="ml-1.5 inline-block align-middle text-[var(--accent)]">★</span>
)}
```

In `AccountMenu.tsx`, next to the existing menu items (match their exact markup), add — gated by `BILLING_ENABLED && user?.premium`:

```tsx
<button type="button" onClick={onManageSubscription} className={/* same classes as siblings */}>
  Manage subscription
</button>
```

with:

```tsx
const onManageSubscription = async () => {
  try {
    const { url } = await createPortalSession();
    window.location.assign(url);
  } catch {
    /* menu stays open; nothing to break */
  }
};
```

- [ ] **Step 4: Run the full frontend suite**

Run: `cd frontend && npm run typecheck && npx jest`
Expected: everything PASSES (these two files touch shared components — run the whole suite, not just the new tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/app/leaderboard frontend/components/AccountMenu.tsx frontend/components/AccountMenu.premium.test.tsx
git commit -m "feat: supporter badge + manage-subscription menu item"
```

---

### Task 14: Docs, env references, full-suite gate

**Files:**
- Modify: `DEPLOYMENT.md` (env-var reference)
- Modify: `.env.example` (if present at repo root — check; else skip with a note)
- Modify: `README.md` (roadmap line)
- Test: the full suites

- [ ] **Step 1: Document the env vars**

In `DEPLOYMENT.md`'s env-var reference, add a Billing section:

```markdown
### Billing (FinalWhistle Premium — optional, OFF by default)

| Variable | Where | Meaning |
|---|---|---|
| `STRIPE_SECRET_KEY` | Render (backend) | Stripe secret key. Unset ⇒ billing fully disabled. |
| `STRIPE_WEBHOOK_SECRET` | Render (backend) | Signing secret for the `/api/billing/webhook` endpoint. |
| `STRIPE_PRICE_MONTHLY` | Render (backend) | Price ID for the $4.99/month plan. |
| `STRIPE_PRICE_ANNUAL` | Render (backend) | Price ID for the $39.99/year plan. |
| `NEXT_PUBLIC_BILLING_ENABLED` | Vercel (frontend) | `"true"` to render premium surfaces. Keep in lockstep with the backend gate. |

All five stay unset until the stop-gated production rollout (spec:
docs/superpowers/specs/2026-08-11-premium-subscriptions-design.md). The
webhook endpoint to register in the Stripe dashboard is
`<backend origin>/api/billing/webhook` with events: checkout.session.completed,
customer.subscription.created, customer.subscription.updated,
customer.subscription.deleted, invoice.payment_failed.
```

In `.env.example` (if it exists), append the four backend vars with empty values and a "billing off by default" comment. In `README.md`'s roadmap section, add: `- **FinalWhistle Premium** (fan subscription: advanced markets panel; simulators and model intel to follow)`.

- [ ] **Step 2: Run everything**

Run: `cd "/Users/macbookpro/Projects/FIFA WC26 Prediction/.claude/worktrees/final-whistle-expansion-9a1761" && make test`
Expected: full Python + frontend suites green. Paste the tail of the output into the task report — no green, no done.

- [ ] **Step 3: Commit**

```bash
git add DEPLOYMENT.md README.md .env.example
git commit -m "docs: billing env reference + roadmap note for premium"
```

---

## Out of scope for this plan (stop-gated or later phases)

- Creating the Stripe account/products/prices and setting live env vars — founder action, then stop-gated rollout.
- The Stripe **test-mode end-to-end run** (checkout → webhook → premium flips on a deployed preview) — part of the stop-gated rollout checklist, after this branch is green.
- Dispatching `refresh.yml` (prod migration) and flipping `NEXT_PUBLIC_BILLING_ENABLED` — stop gate.
- Terms/privacy/refund-policy copy — drafted separately, founder reviews.
- Phase B (model intel) and Phase C (simulators) — separate plans.
