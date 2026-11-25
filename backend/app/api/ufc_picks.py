"""UFC picks game: a player picks a fight's winner and method before it locks.

Mirrors football's score predictions (app/api/league_score_predictions.py): the
device and an optional account identify the player through the shared
`tip_players` row (the helpers are imported from there, not copied), the first
pick is final, and the server clock alone decides the lock. The lock and
pick-allowed rules live in app/ufc_rules.py (`pick_block`); the model's call is
built only by app/ufc_model.py. Every response here is per-player, so main.py
serves this router `Cache-Control: no-store`.

Privacy: no device id, account id or other player's data is returned or logged;
error messages are fixed strings."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import schemas
from app.api.auth import _email_action_rate_limited
from app.api.league_score_predictions import _DEVICE_ID_RE, _player_for_submit
from app.auth import get_current_user_optional
from app.db import get_db
from app.models import AppUser, EmailActionAttempt, UfcBout, UfcEvent, UfcFighter, UfcPick
from app.security import client_ip, hash_ip, require_same_origin
from app.ufc_model import calls_for
from app.ufc_rules import PICK_METHODS, pick_block, score_pick, utc

router = APIRouter(prefix="/api/ufc/picks", tags=["ufc-picks"])

DISCLAIMER = "For analytics and entertainment only. Not betting advice."
SUBMIT_ACTION = "ufc_pick_submit"
SUBMIT_MAX = 120
SUBMIT_WINDOW_MIN = 60

_FINALIZED = {"code": "pick_finalized", "message": "Your pick for this fight is already locked in."}


def _now() -> datetime:
    """The server clock; the tests' seam. Nothing the client sends is a time."""
    return datetime.now(timezone.utc)


def pick_out(pick: UfcPick, bout: UfcBout) -> schemas.UfcPickOut:
    """A stored pick as served. "void" is derived live from the bout (whether or
    not the grader has run); "graded" needs graded_at and points."""
    score = score_pick(pick.winner, pick.method, bout)
    if score is not None and score.void:
        state = "void"
    elif pick.graded_at is not None and pick.points is not None:
        state = "graded"
    else:
        state = "pending"
    graded = state == "graded"
    return schemas.UfcPickOut(
        winner=pick.winner,
        method=pick.method,
        created_at=utc(pick.created_at),
        state=state,
        points=pick.points if graded else None,
        winner_correct=pick.winner_correct if graded else None,
        method_correct=pick.method_correct if graded else None,
    )


def _find_pick(db: Session, bout_id: int, player_id: int) -> UfcPick | None:
    """Split out (as football's _find_prediction) so a racing first pick is easy to force in tests."""
    return db.query(UfcPick).filter_by(bout_id=bout_id, player_id=player_id).one_or_none()


def _refuse(block: tuple[int, str, str]) -> HTTPException:
    status, code, message = block
    return HTTPException(status_code=status, detail={"code": code, "message": message})


@router.post("/submit", response_model=schemas.UfcPickSubmitOut, dependencies=[Depends(require_same_origin)])
def submit_pick(
    payload: schemas.UfcPickSubmitIn, request: Request,
    db: Session = Depends(get_db),
    user: AppUser | None = Depends(get_current_user_optional),
):
    """Save one player's final pick for one fight: the device's own player, or
    the account's when signed in. The lock is decided here by the server clock,
    in the same transaction as the insert; the first pick is final."""
    device_id = payload.device_id
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})
    if payload.winner not in ("a", "b") or payload.method not in PICK_METHODS:
        raise HTTPException(status_code=422, detail={
            "code": "bad_pick",
            "message": "Pick a winner and how they win: KO/TKO, submission or decision."})

    ip_h = hash_ip(client_ip(request))
    if _email_action_rate_limited(db, SUBMIT_ACTION, device_id, ip_h, SUBMIT_MAX, SUBMIT_WINDOW_MIN):
        raise HTTPException(status_code=429, detail={"code": "too_many_attempts",
                                                     "message": "Too many attempts. Try again later."})
    # Committed at once so every attempt past the cheap payload checks counts,
    # even when a later check refuses it (as football's submit does).
    db.add(EmailActionAttempt(action=SUBMIT_ACTION, email=device_id, ip_hash=ip_h))
    db.commit()

    bout = db.get(UfcBout, payload.bout_id)
    event = db.get(UfcEvent, bout.event_id) if bout is not None else None
    if bout is None or event is None or not event.is_card:
        raise HTTPException(status_code=404, detail={"code": "bout_not_found",
                                                     "message": "No UFC fight with that id"})
    name_a = db.query(UfcFighter.name).filter_by(id=bout.fighter_a_id).scalar()
    name_b = db.query(UfcFighter.name).filter_by(id=bout.fighter_b_id).scalar()
    block = pick_block(bout, event, name_a, name_b, _now())
    if block is not None:
        raise _refuse(block)

    player = _player_for_submit(db, device_id, user)
    if _find_pick(db, bout.id, player.id) is not None:
        raise HTTPException(status_code=409, detail=_FINALIZED)

    # Read the clock again, right before the write: finding the player is
    # database work, and a pick must never land at or after the lock.
    now = _now()
    block = pick_block(bout, event, name_a, name_b, now)
    if block is not None:
        raise _refuse(block)
    pick = UfcPick(bout_id=bout.id, player_id=player.id, winner=payload.winner, method=payload.method,
                   created_at=now, updated_at=now)
    db.add(pick)
    try:
        db.commit()
    except IntegrityError:
        # Lost a race with a concurrent first pick for this (bout, player): the
        # other request's pick stays; this one never overwrites it.
        db.rollback()
        raise HTTPException(status_code=409, detail=_FINALIZED)

    return schemas.UfcPickSubmitOut(
        ok=True,
        handle=player.handle,
        bout_id=bout.id,
        pick=pick_out(pick, bout),
        model=calls_for(db, [bout]).get(bout.id),
        disclaimer=DISCLAIMER,
    )
