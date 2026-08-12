"""Billing endpoints — FinalWhistle Premium (in-page Payment Element + Portal).

Signup is setup-intent -> subscribe: the card is confirmed first, then the
subscription is created, which reproduces hosted Checkout's semantics exactly
(no subscription exists until a card does, so nothing downstream changes). Card
data still never touches this server — Payment Element renders in Stripe's own
iframes, and management redirects to the hosted Portal. Everything here is
env-gated (503 when billing is off) so an unconfigured deploy behaves exactly
like today's site.
"""
from __future__ import annotations

from urllib.parse import urlencode

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app import billing, schemas
from app.auth import get_current_user
from app.config import settings
from app.db import get_db
from app.models import AppUser, Subscription
from app.security import require_same_origin

router = APIRouter(prefix="/api/billing", tags=["billing"])

_COMPETITION_BASE_PATHS = {
    "epl": "/football/epl",
    "laliga": "/football/laliga",
    "bundesliga": "/football/bundesliga",
    "ucl": "/football/ucl",
    "wc26": "/football/wc26",
    "nrl": "/nrl",
}


def _safe_return_path(value: str | None, competition: str | None) -> str | None:
    """Accept only ordinary paths inside the selected competition namespace.

    A leading slash check is insufficient in browsers: WHATWG treats
    ``/\\evil.example`` as a cross-origin network path. Restricting the
    alphabet and namespace also rejects encoded/double-encoded separator
    tricks, query strings, and fragments — none are needed by our callers.
    """
    if not value or not competition or len(value) > 512:
        return None
    if any(not (ch.isascii() and (ch.isalnum() or ch in "/_-")) for ch in value):
        return None
    base = _COMPETITION_BASE_PATHS[competition]
    if value != base and not value.startswith(base + "/"):
        return None
    return value


def _require_billing_enabled() -> None:
    if not settings.billing_enabled:
        raise HTTPException(status_code=503, detail={
            "code": "billing_disabled",
            "message": "Subscriptions aren't available right now."})


def _billing_unavailable() -> HTTPException:
    """Stripe said no (bad price id, expired key, outage). main.py registers no
    catch-all handler, so an escaping StripeError would be a bare Starlette 500
    outside the {"error":{code,message}} contract."""
    return HTTPException(status_code=503, detail={
        "code": "billing_unavailable",
        "message": "Billing is temporarily unavailable — please try again shortly."})


def _ensure_customer(db: Session, user: AppUser, sub: Subscription | None) -> str:
    """Reuse the stored Stripe customer, else create one and persist it.

    The row this may create holds nothing but the customer id: is_premium() is
    false for `incomplete` and billing.trial_eligible() ignores rows that never
    held a subscription, so it entitles nothing and burns no trial. Committed
    before the caller's SetupIntent call so a failure there leaves the customer
    reusable rather than orphaned at Stripe."""
    if sub is not None and sub.stripe_customer_id:
        return sub.stripe_customer_id
    try:
        customer = stripe.Customer.create(
            api_key=settings.stripe_secret_key,
            email=user.email,
            metadata={"user_id": str(user.id)},
        )
    except stripe.StripeError:
        raise _billing_unavailable()
    if sub is None:
        sub = Subscription(user_id=user.id, status="incomplete", plan="monthly")
        db.add(sub)
    sub.stripe_customer_id = customer.id
    db.commit()
    return customer.id


@router.post("/setup-intent", response_model=schemas.SetupIntentOut,
             dependencies=[Depends(require_same_origin)])
def create_setup_intent(user: AppUser = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Step 1 of in-page signup: a SetupIntent whose client secret mounts
    Payment Element. Collects and confirms the card WITHOUT creating a
    subscription — nothing here grants entitlement."""
    _require_billing_enabled()
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if billing.is_premium(sub):
        raise HTTPException(status_code=409, detail={
            "code": "already_subscribed",
            "message": "You already have FinalWhistle Premium."})
    customer_id = _ensure_customer(db, user, sub)
    try:
        intent = stripe.SetupIntent.create(
            api_key=settings.stripe_secret_key,
            customer=customer_id,
            usage="off_session",
            # This is what surfaces Apple Pay / Google Pay in the element.
            automatic_payment_methods={"enabled": True},
            metadata={"user_id": str(user.id)},
        )
    except stripe.StripeError:
        raise _billing_unavailable()
    return schemas.SetupIntentOut(client_secret=intent.client_secret)


@router.post("/subscribe", response_model=schemas.SubscribeOut,
             dependencies=[Depends(require_same_origin)])
def create_subscription(payload: schemas.SubscribeIn,
                        user: AppUser = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    """Step 2 of in-page signup: turn a confirmed SetupIntent into the
    subscription. The row is applied eagerly so the UI flips to Premium without
    polling; the webhook re-applies the same object moments later."""
    _require_billing_enabled()
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if billing.is_premium(sub):
        # Idempotent: a retry after a dropped connection describes what exists
        # rather than creating (and charging for) a second subscription.
        return schemas.SubscribeOut(status=sub.status, premium=True)
    try:
        intent = dict(stripe.SetupIntent.retrieve(
            payload.setup_intent_id, api_key=settings.stripe_secret_key))
    except stripe.StripeError:
        raise _billing_unavailable()
    # SECURITY: the id arrives from the client, so it may be anyone's. Without
    # both halves of this check a caller could pass a stranger's SetupIntent and
    # attach that person's card to their own subscription. The payment_method
    # arm is the "no subscription without a confirmed card" rule made explicit:
    # stripe-python drops None params, so passing a null one below would create a
    # trialing subscription with nothing to charge when the trial ends.
    customer_id = sub.stripe_customer_id if sub is not None else None
    if (not customer_id or intent.get("customer") != customer_id
            or intent.get("status") != "succeeded"
            or not intent.get("payment_method")):
        raise HTTPException(status_code=403, detail={
            "code": "setup_intent_invalid",
            "message": "That payment setup can't be used. Please try again."})
    price = (settings.stripe_price_annual if payload.plan == "annual"
             else settings.stripe_price_monthly)
    kwargs: dict = dict(
        api_key=settings.stripe_secret_key,
        customer=customer_id,
        items=[{"price": price}],
        default_payment_method=intent.get("payment_method"),
        metadata={"user_id": str(user.id)},
        # The is_premium() guard above only covers retries once the subscription
        # entitles. A created-but-not-entitling one (`incomplete` after a soft
        # decline, or past_due beyond the grace window) falls through it, so a
        # lost response, a page reload or "Finish activation" would buy a second
        # subscription on the same customer — and apply_subscription_object keeps
        # the first binding, so we'd never see the second one to cancel it. Keyed
        # on the SetupIntent (NOT the plan: a key that varied per plan would let
        # exactly that duplicate through), which Stripe honours for 24h — longer
        # than the ~23h after which it auto-cancels an incomplete subscription.
        idempotency_key=f"sub:{user.id}:{payload.setup_intent_id}",
    )
    if billing.trial_eligible(sub):
        kwargs["trial_period_days"] = 7
    try:
        subscription = stripe.Subscription.create(**kwargs)
    except stripe.StripeError:
        raise _billing_unavailable()
    billing.apply_subscription_object(db, dict(subscription))
    db.commit()
    sub = db.query(Subscription).filter_by(user_id=user.id).one()
    return schemas.SubscribeOut(status=sub.status, premium=billing.is_premium(sub))


@router.post("/checkout-session", response_model=schemas.BillingUrlOut,
             dependencies=[Depends(require_same_origin)])
def create_checkout_session(payload: schemas.CheckoutSessionIn,
                            user: AppUser = Depends(get_current_user),
                            db: Session = Depends(get_db)):
    """DEPRECATED — the hosted-Checkout redirect, superseded by setup-intent +
    subscribe. Kept working for one release as the rollback path: if Payment
    Element misbehaves in production, reverting is a frontend change rather than
    a redeploy of billing logic."""
    _require_billing_enabled()
    sub = db.query(Subscription).filter_by(user_id=user.id).one_or_none()
    if billing.is_premium(sub):
        raise HTTPException(status_code=409, detail={
            "code": "already_subscribed",
            "message": "You already have FinalWhistle Premium."})
    price = (settings.stripe_price_annual if payload.plan == "annual"
             else settings.stripe_price_monthly)
    subscription_data: dict = {"metadata": {"user_id": str(user.id)}}
    # Same guard as /subscribe, read from the same place so the two can't
    # diverge — a user who opened the in-page form (which writes a row) and then
    # fell back to here must not lose their trial.
    if billing.trial_eligible(sub):
        subscription_data["trial_period_days"] = 7
    context: dict[str, str] = {}
    if payload.competition is not None:
        context["competition"] = payload.competition
    # This value returns only as an encoded link on our own Premium page, but
    # validate it at both boundaries anyway so it can never become an open
    # redirect if the page behavior changes later.
    safe_return_to = _safe_return_path(payload.return_to, payload.competition)
    if safe_return_to:
        context["returnTo"] = safe_return_to
    success_query = urlencode({"checkout": "success", **context})
    cancel_query = urlencode({"checkout": "cancelled", **context})
    kwargs: dict = dict(
        api_key=settings.stripe_secret_key,
        mode="subscription",
        line_items=[{"price": price, "quantity": 1}],
        subscription_data=subscription_data,
        client_reference_id=str(user.id),
        success_url=f"{settings.public_base_url}/premium?{success_query}",
        cancel_url=f"{settings.public_base_url}/premium?{cancel_query}",
    )
    if sub is not None and sub.stripe_customer_id:
        kwargs["customer"] = sub.stripe_customer_id
    else:
        kwargs["customer_email"] = user.email
    try:
        session = stripe.checkout.Session.create(**kwargs)
    except stripe.StripeError:
        raise _billing_unavailable()
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
    try:
        session = stripe.billing_portal.Session.create(
            api_key=settings.stripe_secret_key,
            customer=sub.stripe_customer_id,
            return_url=f"{settings.public_base_url}/premium",
        )
    except stripe.StripeError:
        raise _billing_unavailable()
    return schemas.BillingUrlOut(url=session.url)


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
