"""Match markets — GET /api/matches/{id}/markets.

The consumer twin of /v1/markets (same serializers, same frozen pre-kickoff
basis). Free for everyone since 2026-11-25: no sign-in or subscription is
needed. When the markets are shown is the frontend's reveal rule, not this
endpoint's.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import schemas, serializers
from app.db import get_db
from app.models import Match

router = APIRouter(prefix="/api/matches", tags=["premium-markets"])


@router.get("/{match_id}/markets", response_model=schemas.MarketsOut)
def match_markets(match_id: int, db: Session = Depends(get_db)):
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
