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
