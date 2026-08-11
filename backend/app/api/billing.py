"""Billing endpoints — FinalWhistle Premium (Stripe hosted Checkout + Portal).

Card data never touches this server: checkout and management both redirect to
Stripe-hosted pages. Everything here is env-gated (503 when billing is off) so
an unconfigured deploy behaves exactly like today's site.
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
