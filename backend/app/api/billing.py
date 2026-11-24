"""Billing endpoints — FinalWhistle Premium has been retired (everything is free).

The three sign-up endpoints (setup-intent, subscribe, checkout-session) answer
410 and never touch Stripe. What remains serves people who already subscribed:
the Portal redirect for managing or cancelling, and the webhook that keeps their
subscription rows current. Everything else here is env-gated (503 when billing
is off) so an unconfigured deploy behaves exactly like today's site.
"""
from __future__ import annotations

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


def _premium_retired() -> HTTPException:
    return HTTPException(status_code=410, detail={
        "code": "premium_retired",
        "message": "FinalWhistle Premium has been retired. Everything on the site is free."})


@router.post("/setup-intent")
def create_setup_intent():
    """Retired: no new subscriptions. Answers 410 whatever the caller's state."""
    raise _premium_retired()


@router.post("/subscribe")
def create_subscription():
    """Retired: no new subscriptions. Answers 410 whatever the caller's state."""
    raise _premium_retired()


@router.post("/checkout-session")
def create_checkout_session():
    """Retired: no new subscriptions. Answers 410 whatever the caller's state."""
    raise _premium_retired()


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
            return_url=f"{settings.public_base_url}/",
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
