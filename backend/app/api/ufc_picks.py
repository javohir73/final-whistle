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

import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import and_, case, func, not_, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import Query

from app import schemas
from app.api.auth import _email_action_rate_limited
from app.api.league_score_predictions import _DEVICE_ID_RE, _player_for_submit
from app.auth import get_current_user_optional
from app.db import get_db
from app.models import AppUser, EmailActionAttempt, TipPlayer, UfcBout, UfcEvent, UfcFighter, UfcPick
from app.security import client_ip, hash_ip, require_same_origin
from app.ufc_model import calls_for, counting_predictions
from app.ufc_rules import PICK_METHODS, VOID_METHODS, lock_expr, model_pick, pick_block, score_pick, utc
from app.api.league_score_predictions import _player_for_read
from app.api.ufc import SLUG_PATTERN, public_card
from app.ufc_model import public_version
from app.ufc_rules import call_is_public, is_placeholder_name, lock_time

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


# ---- reads: my picks on a card, and across cards -------------------------------------

_SLUG_RE = re.compile(SLUG_PATTERN)
_NO_CARD = {"code": "not_found", "message": "No UFC card with that name"}
_MAX_CHAIN_HOPS = 5


def _read_pick_out(pick: UfcPick, bout: UfcBout) -> schemas.UfcPickOut:
    """`pick_out`, plus one more void: a pick the grading pass voided after the fact
    (graded_at set, points NULL) on a fight that has a normal result, e.g. one made
    after the real lock. No reason field exists in the schema; the client gets
    state "void" with no points and no correctness flags."""
    out = pick_out(pick, bout)
    if out.state != "void" and pick.graded_at is not None and pick.points is None:
        return out.model_copy(update={"state": "void", "points": None,
                                      "winner_correct": None, "method_correct": None})
    return out


def _totals(outs: list[schemas.UfcPickOut]) -> schemas.UfcPicksTotalsOut:
    graded = [o for o in outs if o.state == "graded"]
    return schemas.UfcPicksTotalsOut(
        picked=len(outs), graded=len(graded),
        points=sum(o.points or 0 for o in graded),
        winner_method=sum(1 for o in graded if o.points == 5))


def _check_device(device_id: str) -> None:
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})


def _lock_order(bout: UfcBout) -> tuple:
    lock = lock_time(bout)
    return (lock is None, lock or datetime.min.replace(tzinfo=timezone.utc),
            bout.card_order is None, bout.card_order or 0, bout.id)


def _successors(db: Session, firsts: dict[int, int | None]) -> dict[int, int | None]:
    """For each changed bout id, the newest revision reached by following
    `replaced_by_id` (at most 5 hops, one query per hop for all bouts together;
    a missing link ends the walk at the last bout that exists)."""
    result: dict[int, int | None] = {k: None for k in firsts}
    cursor = {k: v for k, v in firsts.items() if v is not None}
    for _ in range(_MAX_CHAIN_HOPS):
        if not cursor:
            break
        rows = {r.id: r for r in db.query(UfcBout.id, UfcBout.status, UfcBout.replaced_by_id)
                .filter(UfcBout.id.in_(set(cursor.values()))).all()}
        nxt: dict[int, int] = {}
        for start, at in cursor.items():
            row = rows.get(at)
            if row is None:
                continue
            result[start] = row.id
            if row.status == "changed" and row.replaced_by_id is not None:
                nxt[start] = row.replaced_by_id
        cursor = nxt
    return result


@router.get("/mine", response_model=schemas.UfcMyPicksOut)
def my_picks(
    device_id: str = Query(""), event: str = Query(""),
    db: Session = Depends(get_db),
    user: AppUser | None = Depends(get_current_user_optional),
):
    """This player's picks on one card. The model's call is decided per fight here:
    shown only when it is public for everyone, or when this player has picked that
    fight (and it is not cancelled, changed or a placeholder). A call that is not
    shown is never loaded, so nothing derived from it can reach the answer."""
    _check_device(device_id)
    card = public_card(db, event) if len(event) <= 220 and _SLUG_RE.match(event) else None
    if card is None:
        raise HTTPException(status_code=404, detail=_NO_CARD)
    now = _now()
    bouts = db.query(UfcBout).filter_by(event_id=card.id).all()
    fighter_ids = {i for b in bouts for i in (b.fighter_a_id, b.fighter_b_id)}
    names = dict(db.query(UfcFighter.id, UfcFighter.name).filter(UfcFighter.id.in_(fighter_ids)).all()) \
        if fighter_ids else {}
    player = _player_for_read(db, device_id, user)
    picks: dict[int, UfcPick] = {}
    if player is not None and bouts:
        picks = {p.bout_id: p for p in db.query(UfcPick).filter(
            UfcPick.player_id == player.id, UfcPick.bout_id.in_([b.id for b in bouts])).all()}

    live = sorted((b for b in bouts if b.status != "changed"), key=_lock_order)
    shown = []
    for b in live:
        na, nb = names.get(b.fighter_a_id), names.get(b.fighter_b_id)
        if call_is_public(b, na, nb, now):
            shown.append(b)
        elif (b.id in picks and b.status not in ("cancelled", "changed")
              and not is_placeholder_name(na) and not is_placeholder_name(nb)):
            shown.append(b)
    calls = calls_for(db, shown) if public_version() is not None else {}

    out_bouts = []
    for b in live:
        na, nb = names.get(b.fighter_a_id), names.get(b.fighter_b_id)
        pick = picks.get(b.id)
        out_bouts.append(schemas.UfcMyBoutOut(
            bout_id=b.id, status=b.status, fighter_a=na or "", fighter_b=nb or "",
            locks_at=lock_time(b),
            picks_open=pick_block(b, card, na, nb, now) is None,
            pick=_read_pick_out(pick, b) if pick is not None else None,
            model=calls.get(b.id)))

    changed = [b for b in bouts if b.status == "changed" and b.id in picks]
    replaced = _successors(db, {b.id: b.replaced_by_id for b in changed}) if changed else {}
    changed_out = [schemas.UfcChangedPickOut(
        bout_id=b.id, fighter_a=names.get(b.fighter_a_id) or "", fighter_b=names.get(b.fighter_b_id) or "",
        pick=_read_pick_out(picks[b.id], b), replaced_by_id=replaced.get(b.id))
        for b in sorted(changed, key=_lock_order)]

    totals = _totals([_read_pick_out(picks[b.id], b) for b in bouts if b.id in picks])
    return schemas.UfcMyPicksOut(
        event=schemas.UfcEventRefOut(slug=card.slug, name=card.name, first_bout_utc=utc(card.first_bout_utc)),
        handle=player.handle if player is not None else None,
        bouts=out_bouts, changed_picks=changed_out, totals=totals, disclaimer=DISCLAIMER)


@router.get("/summary", response_model=schemas.UfcPicksSummaryOut)
def picks_summary(
    device_id: str = Query(""),
    db: Session = Depends(get_db),
    user: AppUser | None = Depends(get_current_user_optional),
):
    """Per card and overall: how many fights this player picked and how they scored."""
    _check_device(device_id)
    player = _player_for_read(db, device_id, user)
    if player is None:
        return schemas.UfcPicksSummaryOut(handle=None, cards=[], totals=_totals([]))
    rows = (db.query(UfcPick, UfcBout, UfcEvent)
            .join(UfcBout, UfcBout.id == UfcPick.bout_id)
            .join(UfcEvent, UfcEvent.id == UfcBout.event_id)
            .filter(UfcPick.player_id == player.id, UfcEvent.is_card.is_(True)).all())
    per_card: dict[int, tuple[UfcEvent, list[schemas.UfcPickOut]]] = {}
    for pick, bout, ev in rows:
        per_card.setdefault(ev.id, (ev, []))[1].append(_read_pick_out(pick, bout))
    ordered = sorted(per_card.values(), key=lambda t: (
        t[0].first_bout_utc is None,
        -(utc(t[0].first_bout_utc).timestamp() if t[0].first_bout_utc is not None else 0), t[0].slug))
    cards = []
    for ev, outs in ordered:
        t = _totals(outs)
        cards.append(schemas.UfcPicksCardOut(slug=ev.slug, name=ev.name, first_bout_utc=utc(ev.first_bout_utc),
                                             picked=t.picked, graded=t.graded, points=t.points,
                                             winner_method=t.winner_method))
    return schemas.UfcPicksSummaryOut(
        handle=player.handle, cards=cards, totals=_totals([o for _, outs in per_card.values() for o in outs]))


# ---- the leaderboard: per card or per year, public ------------------------------------

MODEL_HANDLE = "FinalWhistle model"        # football's _MODEL_HANDLE
_FALLBACK_HANDLE = "Anonymous"             # football's bracket board name for a player with none
_BAD_SCOPE = {"code": "bad_scope", "message": "Ask for one card or one year."}
_YEAR_RE = re.compile(r"[0-9]{4}")
_MIN_YEAR, _MAX_YEAR = 2020, 2100


def _counts_expr():
    """SQL form of "this bout can score a pick": not void by its state, the
    same cases `score_pick` calls void (cancelled, changed, draw, no contest,
    a finished bout with no winner)."""
    void = or_(
        UfcBout.status.in_(("cancelled", "changed")),
        and_(UfcBout.status == "finished",
             or_(UfcBout.winner.is_(None), UfcBout.winner.not_in(("a", "b")),
                 and_(UfcBout.method.is_not(None), UfcBout.method.in_(VOID_METHODS)))))
    return not_(void)


def _scope_filter(card: UfcEvent | None, year: int | None):
    """Conditions on `UfcBout` joined to `UfcEvent`: one card, or every card
    whose first bout falls in the UTC calendar year."""
    if card is not None:
        return [UfcBout.event_id == card.id]
    start = datetime(year, 1, 1, tzinfo=timezone.utc)
    end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    return [UfcEvent.is_card.is_(True), UfcEvent.first_bout_utc.is_not(None),
            UfcEvent.first_bout_utc >= start, UfcEvent.first_bout_utc < end]


def _model_entry(db: Session, version: str, conditions: list) -> dict | None:
    """The model's row: every finished, scorable bout in scope with a counting
    call, a winner pick, and no eligible player pick still awaiting the grading
    pass (football's rule: eligible = stamped at or before the lock). None when
    it scored nothing."""
    bouts = (db.query(UfcBout).join(UfcEvent, UfcEvent.id == UfcBout.event_id)
             .filter(UfcBout.status == "finished", *conditions).all())
    if not bouts:
        return None
    ids = [b.id for b in bouts]
    waiting = {bid for (bid,) in (
        db.query(UfcPick.bout_id).join(UfcBout, UfcBout.id == UfcPick.bout_id)
        .filter(UfcPick.bout_id.in_(ids), UfcPick.graded_at.is_(None),
                UfcPick.updated_at <= lock_expr())
        .distinct().all())}
    calls = counting_predictions(db, [i for i in ids if i not in waiting], version)
    points = five = played = 0
    for bout in bouts:
        pred = calls.get(bout.id)
        if pred is None:
            continue
        winner, method = model_pick(pred.p_a, pred.method_probs)
        if winner is None:
            continue
        score = score_pick(winner, method, bout)
        if score is None or score.void or score.points is None:
            continue
        points += score.points
        five += score.points == 5
        played += 1
    if played == 0:
        return None
    return {"handle": MODEL_HANDLE, "points": points, "winner_method": five, "graded": played,
            "is_model": True, "id": 0}


@router.get("/leaderboard", response_model=schemas.UfcLeaderboardOut)
def leaderboard(
    event: str | None = Query(None), year: str | None = Query(None),
    db: Session = Depends(get_db),
):
    """Ranked players for one card or one UTC year, with the model as one marked
    row when a model is public and has scored a fight. Public and identical for
    every visitor (so cacheable); shows names and totals only, never an id or a
    single pick. Only graded, non-void picks count; an ungraded pick on a
    finished fight counts for nobody, and holds the model's row back too."""
    if (event is None) == (year is None):
        raise HTTPException(status_code=422, detail=_BAD_SCOPE)
    card: UfcEvent | None = None
    year_n: int | None = None
    if event is not None:
        card = public_card(db, event) if len(event) <= 220 and _SLUG_RE.match(event) else None
        if card is None:
            raise HTTPException(status_code=404, detail=_NO_CARD)
    else:
        if not _YEAR_RE.fullmatch(year) or not _MIN_YEAR <= int(year) <= _MAX_YEAR:
            raise HTTPException(status_code=422, detail=_BAD_SCOPE)
        year_n = int(year)
    conditions = _scope_filter(card, year_n)

    rows = (db.query(TipPlayer.id, TipPlayer.handle, func.count(UfcPick.id),
                     func.coalesce(func.sum(UfcPick.points), 0),
                     func.coalesce(func.sum(case((UfcPick.points == 5, 1), else_=0)), 0))
            .join(UfcPick, UfcPick.player_id == TipPlayer.id)
            .join(UfcBout, UfcBout.id == UfcPick.bout_id)
            .join(UfcEvent, UfcEvent.id == UfcBout.event_id)
            .filter(UfcPick.graded_at.is_not(None), UfcPick.points.is_not(None), _counts_expr(), *conditions)
            .group_by(TipPlayer.id, TipPlayer.handle).all())
    entries = [{"id": pid, "handle": (handle or "").strip() or _FALLBACK_HANDLE, "points": int(points),
                "winner_method": int(five), "graded": int(played), "is_model": False}
               for pid, handle, played, points, five in rows]
    participant_count = len(entries)
    version = public_version()
    if version is not None:
        model = _model_entry(db, version, conditions)
        if model is not None:
            entries.append(model)
    # Total order, nothing left to the database: points, winner-and-method
    # count, players before the model, handle, then the player's id.
    entries.sort(key=lambda e: (-e["points"], -e["winner_method"], e["is_model"], e["handle"], e["id"]))
    return schemas.UfcLeaderboardOut(
        scope="card" if card is not None else "year",
        event=schemas.UfcEventRefOut(slug=card.slug, name=card.name, first_bout_utc=utc(card.first_bout_utc))
        if card is not None else None,
        year=year_n, participant_count=participant_count,
        entries=[schemas.UfcLeaderboardEntryOut(rank=i + 1, **{k: v for k, v in e.items() if k != "id"})
                 for i, e in enumerate(entries)])
