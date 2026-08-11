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
        try:
            user_id = int(meta_user)
        except (TypeError, ValueError):
            return  # metadata we didn't stamp — acknowledge and move on
        # NOTE: a numeric-but-unknown user_id still violates the app_users FK on
        # commit (IntegrityError => 500 => Stripe redelivers for days). SQLite
        # doesn't enforce FKs by default so it isn't unit-testable here; the
        # metadata is ours (stamped at checkout) so it stays an accepted risk.
        sub = db.query(Subscription).filter_by(user_id=user_id).one_or_none()
        if sub is None:
            sub = Subscription(user_id=user_id, status="incomplete",
                               plan="monthly")
            db.add(sub)
        elif (sub.stripe_subscription_id
              and sub.stripe_subscription_id != obj.get("id")
              and (deleted or obj.get("status") not in PREMIUM_STATUSES)):
            # The row is bound to a DIFFERENT subscription, so the id lookup above
            # missed for a reason: this event belongs to a subscription the user
            # already replaced. Only an ENTITLING status may take the binding away
            # from another id — a `deleted`/`canceled` redelivered from a backlog,
            # or the weeks of past_due/unpaid dunning Stripe keeps firing on an
            # abandoned subscription, would otherwise rebind backwards and revoke
            # someone who just paid, with no self-correction until the next event
            # for the live subscription. Ignore them.
            # A LIVE object still rebinds: a resubscriber's row is always bound to
            # the dead id, so sub_NEW's created/updated events land here too.
            return
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
        try:
            # A failed attempt must still consume the hourly throttle budget —
            # otherwise a Stripe outage turns every /me into a retry storm.
            # Wrapped separately so the never-raises guarantee holds even if
            # this stamp-commit itself fails.
            sub.updated_at = now
            db.commit()
        except Exception:
            db.rollback()


def apply_event(db, event: dict) -> None:
    """Route one verified webhook event to the subscription row. Unknown types
    are deliberately ignored (acknowledged) — additive by design."""
    etype = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}
    if etype == "checkout.session.completed":
        ref = obj.get("client_reference_id")
        if not ref:
            return
        # This type fires for EVERY Checkout Session on the account and a Payment
        # Link lets anyone set client_reference_id, so the value is untrusted. A
        # raise here would escape before the endpoint's commit, discarding the
        # BillingEvent row too — Stripe would then redeliver into the same crash
        # for up to 3 days. Acknowledge and move on instead.
        try:
            user_id = int(ref)
        except (TypeError, ValueError):
            return
        sub = db.query(Subscription).filter_by(user_id=user_id).one_or_none()
        if sub is None:
            sub = Subscription(user_id=user_id, status="incomplete", plan="monthly")
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
