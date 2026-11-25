"""The beat-the-AI loop (design doc: NRL Round Tips, Slice 2): anonymous,
device-first tipping against the model, graded once each round finishes.

A separate router from app.api.nrl_tips -- that file is the model's OWN round
tipsheet (read-only, no player rows); this one is the human side. Same
identity convention as app.api.activity: device_id is the durable key
(TipPlayer, one row per device, mirrors DailyActivity), an account is an
optional upgrade attached later via /claim, never required to play. Once
signed in, a request resolves the ACCOUNT's player first, from any device
(_player_for_read / _player_for_submit); anonymous requests stay
device-only.

INTEGRITY: a tip is rejected once its match's kickoff_utc has passed, by the
server clock only (never the client's) -- enforced in submit_tip, mirroring
the frozen-prediction guard in pipeline.sports.nrl_predict._write_prediction.
Until then a device may change its pick freely (upsert on (match_id, player)).

Grading (points/round_margin/graded_at on UserTip) is a SEPARATE pass, owned
by a different builder and hooked into nrl-refresh after the match finishes --
nothing in this file ever writes those three columns. Scoring rule those
columns encode (comp-standard, apples-to-apples with the model): 1 point for
a correct winner pick, or any pick at all if the match drew -- see
_scores_point, which this file uses to compute the MODEL's side of the
comparison live (the model's own graded ledger, SportPredictionResult.
winner_correct, does NOT apply the draw rule, so it can't be reused here).

Slice 2.5 adds three read surfaces on top of the same graded columns, no
schema change: a season-long leaderboard (tips_leaderboard_season, alongside
the weekly tips_leaderboard), personal streak/best-round stats folded into
tips_summary, and a PUBLIC handle-addressed share endpoint (tips_share) for
the share-card page -- graded results only, never a pre-kickoff pick.
"""
from __future__ import annotations

import random
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func, inspect, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased, load_only

from app import schemas
from app.api.auth import _email_action_rate_limited
from app.api.nrl_tips import _current_round, _kickoff_locked_prediction, _model_pick
from app.api.sports import _latest_season
from app.auth import get_current_user, get_current_user_optional
from app.db import get_db
from app.models import (
    AppUser,
    EmailActionAttempt,
    LeagueScorePrediction,
    SportMatch,
    SportPrediction,
    SportTeam,
    TipPlayer,
    UfcPick,
    UserTip,
)
from app.security import client_ip, hash_ip, require_same_origin, to_aware_utc

router = APIRouter(prefix="/api/nrl", tags=["nrl"])

_DISCLAIMER = "For analytics and entertainment only. Not betting advice."

# Same strict UUID v4 shape as app.api.activity's _DEVICE_ID_RE (\A/\Z, not
# ^/$, so a trailing newline can't slip a 37-char id past the check).
_DEVICE_ID_RE = re.compile(
    r"\A[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\Z",
    re.IGNORECASE,
)

# A round is ~8 matches and a tip can be revised freely until kickoff, so the
# cap is generous (well above activity.py's once-a-day ping) -- this exists to
# stop a scripted flood, not to limit normal round-by-round play.
_SUBMIT_MAX = 120
_SUBMIT_WINDOW_MIN = 60

# Human entries are revealed from the first participant. This was 10, which
# meant no NRL board ever rendered a row (3 season players live, UX rebuild
# plan 2026-11 §1.2); with the model always a ranked row, one tipper already
# has someone to beat ("You #1 of 2").
_LEADERBOARD_MIN_PARTICIPANTS = 1

# The model's ranked row on both boards. Not a TipPlayer: it never counts
# toward participant_count, and `is_model` -- not this string -- is what marks
# the row. Generated handles never contain a space, so it can't collide with
# one. Same name as league_score_predictions._MODEL_HANDLE.
_MODEL_HANDLE = "FinalWhistle model"

# Every SportMatch column the model's row reads (_gradeable,
# _kickoff_locked_prediction, the season board's round): the boards load
# only these.
_MODEL_ROW_MATCH_COLUMNS = (
    SportMatch.round, SportMatch.status, SportMatch.kickoff_utc, SportMatch.score_home, SportMatch.score_away,
)

_HANDLE_ADJECTIVES = (
    "Swift", "Brave", "Clutch", "Steady", "Fearless", "Rugged", "Sharp",
    "Bold", "Lightning", "Iron", "Golden", "Silent",
)
_HANDLE_NOUNS = (
    "Halfback", "Fullback", "Winger", "Hooker", "Prop", "Playmaker",
    "Enforcer", "Sprinter", "Tackler", "Kicker",
)


def _generate_handle() -> str:
    """A readable display name for a freshly-seen device -- never the raw
    device_id. Not guaranteed unique; collisions are cosmetic only, since
    nothing (grading, the leaderboard) keys on the handle."""
    return f"{random.choice(_HANDLE_ADJECTIVES)}{random.choice(_HANDLE_NOUNS)}{random.randint(1, 999)}"


def _actual_outcome(m: SportMatch) -> str | None:
    """home/draw/away for a match with a final score, else None (not finished
    yet) -- the same three-way outcome nrl_predict.grade() derives, kept local
    since app/api must not import the pipeline layer."""
    if m.score_home is None or m.score_away is None:
        return None
    if m.score_home > m.score_away:
        return "home"
    if m.score_home < m.score_away:
        return "away"
    return "draw"


def _scores_point(pick: str, outcome: str) -> bool:
    """Standard AU tipping-comp rule (design doc, Slice 2): a correct winner
    pick scores; a draw scores EVERY tipper regardless of pick. Used here to
    compute the model's own points for the you-vs-AI comparison -- the
    graded ledger's `winner_correct` is a strict pick match and does not
    apply the draw rule, so it isn't the same number."""
    return outcome == "draw" or pick == outcome


def _gradeable(m: SportMatch) -> bool:
    """Whether the (pipeline-owned) grading pass can score tips on `m`:
    finished, with a kickoff to lock against and a final score -- the same
    conditions pipeline.sports.nrl_user_tips.grade() applies. Whether that
    pass has actually RUN on the match yet is _awaiting_grading's question."""
    return m.status == "finished" and m.kickoff_utc is not None and _actual_outcome(m) is not None


def _awaiting_grading(db: Session, match_ids: list[int]) -> set[int]:
    """The matches among `match_ids` with at least one grade-eligible tip --
    stamped at or before kickoff, the grading pass's own filter -- not
    graded yet. The live poller (pipeline.sports.nrl_live_poll) marks a
    match finished at full time, but tips are graded only by nrl-refresh,
    hours later; until then the model's row must not count the match either,
    or it banks a point the tippers who called it don't have yet (review H1,
    which the NRL side shares). A tip stamped after kickoff is never graded,
    so it never holds the model back."""
    if not match_ids:
        return set()
    return {
        match_id
        for (match_id,) in (
            db.query(UserTip.match_id)
            .join(SportMatch, UserTip.match_id == SportMatch.id)
            .filter(
                UserTip.match_id.in_(match_ids),
                UserTip.graded_at.is_(None),
                SportMatch.kickoff_utc.isnot(None),
                UserTip.updated_at <= SportMatch.kickoff_utc,
            )
            .distinct()
            .all()
        )
    }


def _model_predictions_by_match(db: Session, match_ids: list[int]) -> dict[int, list[SportPrediction]]:
    """The kickoff-locked SportPrediction of each of `match_ids`, as the
    one-row list per match nrl_tips._kickoff_locked_prediction takes. Picked
    in SQL with row_number() -- per match, created_at desc, id desc, over
    exactly the rows that function would consider (created_at <=
    kickoff_utc when there is a kickoff) -- so a season leaderboard never
    materialises every run's row for every match to pick one in Python
    (review M3). load_only then fetches just what the pick and its margin
    need, never preview_text."""
    if not match_ids:
        return {}
    ranked = (
        select(
            SportPrediction.id.label("prediction_id"),
            func.row_number()
            .over(partition_by=SportPrediction.match_id,
                  order_by=(SportPrediction.created_at.desc(), SportPrediction.id.desc()))
            .label("row_number"),
        )
        .join(SportMatch, SportPrediction.match_id == SportMatch.id)
        .where(
            SportPrediction.match_id.in_(match_ids),
            or_(SportMatch.kickoff_utc.is_(None), SportPrediction.created_at <= SportMatch.kickoff_utc),
        )
        .subquery()
    )
    preds = (
        db.query(SportPrediction)
        .options(load_only(SportPrediction.match_id, SportPrediction.created_at, SportPrediction.p_home,
                           SportPrediction.p_draw, SportPrediction.p_away, SportPrediction.expected_margin))
        .join(ranked, SportPrediction.id == ranked.c.prediction_id)
        .filter(ranked.c.row_number == 1)
        .all()
    )
    return {p.match_id: [p] for p in preds}


def _model_scores(preds_by_match: dict[int, list[SportPrediction]],
                  matches: list[SportMatch]) -> list[tuple[SportMatch, int]]:
    """(match, points) for each of `matches` the model's kickoff-locked pick
    can be scored on, under the same _scores_point draw rule a tipper's row is
    graded under. The one computation behind the model's side of /summary,
    /share and both leaderboards. A match with no eligible prediction or no
    final score is skipped, not scored zero."""
    scores = []
    for m in matches:
        pred = _kickoff_locked_prediction(preds_by_match, m)
        outcome = _actual_outcome(m)
        if pred is None or outcome is None:
            continue
        pick, _ = _model_pick(pred)
        scores.append((m, 1 if _scores_point(pick, outcome) else 0))
    return scores


def _model_leaderboard_scores(db: Session, matches: list[SportMatch]) -> list[tuple[SportMatch, int]]:
    """_model_scores over a leaderboard's SETTLED matches: gradeable, with no
    eligible tip still awaiting the grading pass. The model tips every
    fixture, so its row is scored on each settled one whether or not anyone
    else tipped it -- but never on a match before the tippers on it have
    their points, so the two sides can't disagree."""
    gradeable = [m for m in matches if _gradeable(m)]
    waiting = _awaiting_grading(db, [m.id for m in gradeable])
    settled = [m for m in gradeable if m.id not in waiting]
    return _model_scores(_model_predictions_by_match(db, [m.id for m in settled]), settled)


def _leaderboard_rank(margin_key: str):
    """Sort key for either board: points desc, then the margin tiebreak asc
    (`round_margin` weekly, `total_margin` season; a missing one sorts last),
    then tippers ahead of the model on a full tie, then handle asc -- the
    football boards' order, so tied tippers can't swap between requests."""
    def key(entry: dict) -> tuple:
        margin = entry[margin_key]
        return (-entry["points"], margin if margin is not None else float("inf"),
                entry["is_model"], entry["handle"])
    return key


def _tip_streaks(items: list[tuple[UserTip, SportMatch]]) -> tuple[int, int]:
    """(current_streak, best_streak) of consecutive correct picks across a
    player's graded tips -- "correct" means UserTip.points > 0, which already
    bakes in the draw rule (grade() wrote it via _score_tip/_scores_point), so
    this doesn't re-derive scoring. Ordered by kickoff, ties broken by match
    id -- the same chronological convention app.api.sports._ledger_record
    uses for the model's own best_streak. current_streak is the run still
    standing at the most recently kicked-off graded tip; best_streak is the
    longest run anywhere in the history. Season-scoping is the CALLER's job
    (tips_summary pre-filters `items` to the current season) -- this function
    just runs the streak over whatever it's handed."""
    ordered = sorted(items, key=lambda tm: (tm[1].kickoff_utc is None, tm[1].kickoff_utc, tm[1].id))
    best = streak = 0
    for t, _ in ordered:
        streak = streak + 1 if (t.points or 0) > 0 else 0
        best = max(best, streak)
    return streak, best


def _featured_match_id(db: Session, season: int, round: int) -> int | None:
    """The round's featured match: earliest kickoff, ties broken by match_no
    -- same ordering nrl_tips.py uses for its fixture list. Only this match
    accepts a margin guess."""
    row = (
        db.query(SportMatch.id)
        .filter(SportMatch.sport == "nrl", SportMatch.season == season, SportMatch.round == round)
        .order_by(SportMatch.kickoff_utc.is_(None), SportMatch.kickoff_utc.asc(), SportMatch.match_no.asc())
        .first()
    )
    return row[0] if row else None


def _find_player(db: Session, device_id: str) -> TipPlayer | None:
    """Split out from _get_or_create_player so the check-then-insert race (two
    concurrent requests both passing this check) is easy to force in tests --
    mirrors app.api.activity's _find_ping."""
    return db.query(TipPlayer).filter_by(device_id=device_id).one_or_none()


def _get_or_create_player(db: Session, device_id: str) -> TipPlayer:
    player = _find_player(db, device_id)
    if player is None:
        player = TipPlayer(device_id=device_id, handle=_generate_handle())
        db.add(player)
        try:
            db.flush()  # need player.id before it can own a UserTip row
        except IntegrityError:
            # Lost a race with a concurrent first-play from the same brand-new
            # device (both passed the check above before either flushed) --
            # the row exists either way, so re-read it instead of 500ing
            # (mirrors app.api.activity's ping()). Queried directly rather
            # than via _find_player so a test forcing that check to miss
            # doesn't also poison this re-read.
            db.rollback()
            player = db.query(TipPlayer).filter_by(device_id=device_id).one()
    return player


def _find_account_player(db: Session, user_id: int) -> TipPlayer | None:
    return db.query(TipPlayer).filter_by(user_id=user_id).one_or_none()


def _player_for_read(db: Session, device_id: str, user: AppUser | None) -> TipPlayer | None:
    """The TipPlayer a device-scoped read (/mine, /summary) shows. Signed out:
    this device's own row, exactly as before. Signed in: the account's row,
    whichever device asks -- claim_device_tips merges a second device's row
    into the account and deletes it, so a device-only lookup there found
    nothing (review H3). With no account row yet, this device's row only
    while no account owns it: a shared device must never show one account's
    tips to another. Mirrors league_score_predictions._player_for_read."""
    if user is None:
        return _find_player(db, device_id)
    account_player = _find_account_player(db, user.id)
    if account_player is not None:
        return account_player
    device_player = _find_player(db, device_id)
    return device_player if device_player is not None and device_player.user_id is None else None


def _player_for_submit(db: Session, device_id: str, user: AppUser | None, *, retry: bool = True) -> TipPlayer:
    """The TipPlayer a submit writes to. Signed out: this device's own row,
    created on first play, exactly as before. Signed in: the account's row,
    so a tip from any device updates the account's pick instead of starting
    a device row the next claim throws away (review H3). With no account row
    yet, this device's unclaimed row is linked to the account (what /claim
    does on the next page load); otherwise the account gets a new row, keyed
    by this device's id, or -- when another account already owns that id, a
    shared device -- by an account-scoped key no real device sends. Never
    written into another account's row. Mirrors
    league_score_predictions._player_for_submit."""
    if user is None:
        return _get_or_create_player(db, device_id)
    player = _find_account_player(db, user.id)
    if player is not None:
        return player
    device_player = _find_player(db, device_id)
    if device_player is not None and device_player.user_id is None:
        device_player.user_id = user.id
        player = device_player
    else:
        key = device_id if device_player is None else f"account:{user.id}"
        player = TipPlayer(device_id=key, handle=_generate_handle(), user_id=user.id)
        db.add(player)
    try:
        db.flush()
    except IntegrityError:
        # A concurrent request linked or created the account's row first
        # (user_id and device_id are both unique): resolve again, once.
        db.rollback()
        if not retry:
            raise
        return _player_for_submit(db, device_id, user, retry=False)
    return player


def _find_tip(db: Session, match_id: int, player_id: int) -> UserTip | None:
    """Mirrors _find_player -- split out so a concurrent first-submit race on
    the same (match, player) is easy to force in tests."""
    return db.query(UserTip).filter_by(match_id=match_id, player_id=player_id).one_or_none()


@router.post("/tips/submit", dependencies=[Depends(require_same_origin)])
def submit_tip(payload: schemas.NrlTipSubmitIn, request: Request, db: Session = Depends(get_db),
               user: AppUser | None = Depends(get_current_user_optional)):
    """Upsert one player's pick for one match -- the device's own player, or
    the account's when signed in (see _player_for_submit). A pick may change
    freely until the match's kickoff_utc -- checked against the server clock,
    never the client's -- after which the tip is frozen."""
    device_id = payload.device_id
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})
    if payload.pick not in ("home", "draw", "away"):
        raise HTTPException(status_code=422, detail={"code": "bad_pick",
                                                     "message": f"Invalid pick {payload.pick!r}"})
    if payload.margin is not None and not (0 <= payload.margin <= 100):
        raise HTTPException(status_code=422, detail={"code": "bad_margin",
                                                     "message": "margin must be between 0 and 100."})

    ip_h = hash_ip(client_ip(request))
    if _email_action_rate_limited(db, "nrl_tip_submit", device_id, ip_h, _SUBMIT_MAX, _SUBMIT_WINDOW_MIN):
        raise HTTPException(status_code=429, detail={"code": "too_many_attempts",
                                                     "message": "Too many attempts. Try again later."})
    # Committed immediately (not batched with the tip write below) so every
    # attempt that clears the cheap payload checks counts toward the rate
    # limit even if a later check (kickoff lock, bad match) rejects it.
    db.add(EmailActionAttempt(action="nrl_tip_submit", email=device_id, ip_hash=ip_h))
    db.commit()

    m = db.query(SportMatch).filter_by(id=payload.match_id, sport="nrl").one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail={"code": "match_not_found",
                                                     "message": f"No NRL match {payload.match_id}"})

    now = datetime.now(timezone.utc)
    # Belt-and-braces on top of the kickoff comparison below: a match that's
    # already finished (or already has a final score) is locked even if its
    # kickoff_utc is somehow missing -- not reachable via today's NRL feed,
    # but the kickoff check alone would otherwise wave a null-kickoff match
    # through regardless of status.
    already_played = m.status == "finished" or (m.score_home is not None and m.score_away is not None)
    if already_played or (m.kickoff_utc is not None and now >= to_aware_utc(m.kickoff_utc)):
        raise HTTPException(status_code=422, detail={
            "code": "match_locked",
            "message": f"Match {m.id} has kicked off and is locked.",
        })

    # Computed once and reused for both the margin gate and the is_featured
    # snapshot stored on the tip below (see UserTip.is_featured).
    featured_id = _featured_match_id(db, m.season, m.round)
    if payload.margin is not None and m.id != featured_id:
        raise HTTPException(status_code=422, detail={
            "code": "margin_not_allowed",
            "message": "Margin guesses are only accepted for the round's featured match.",
        })
    is_featured_now = m.id == featured_id

    player = _player_for_submit(db, device_id, user)
    tip = _find_tip(db, m.id, player.id)
    if tip is None:
        tip = UserTip(match_id=m.id, player_id=player.id, pick=payload.pick,
                     margin=payload.margin, updated_at=now, is_featured=is_featured_now)
        db.add(tip)
        try:
            db.commit()
        except IntegrityError:
            # Lost a race with a concurrent first tip for this (match,
            # player) -- the row exists either way; re-read it (directly,
            # not via _find_tip -- see _get_or_create_player) and apply this
            # request's pick as the update, same idempotent-success idiom.
            db.rollback()
            tip = db.query(UserTip).filter_by(match_id=m.id, player_id=player.id).one()
            tip.pick = payload.pick
            tip.margin = payload.margin
            tip.updated_at = now
            tip.is_featured = is_featured_now
            db.commit()
    else:
        tip.pick = payload.pick
        tip.margin = payload.margin
        tip.updated_at = now
        tip.is_featured = is_featured_now
        db.commit()

    return {
        "ok": True,
        "handle": player.handle,
        "tip": {
            "match_id": m.id, "pick": tip.pick, "margin": tip.margin,
            "updated_at": tip.updated_at.isoformat() if tip.updated_at else None,
        },
    }


@router.get("/tips/mine")
def my_tips(device_id: str, season: int | None = None, round: int | None = None,
           db: Session = Depends(get_db), user: AppUser | None = Depends(get_current_user_optional)):
    """One player's tips for a round -- the device's, or the account's when
    signed in (see _player_for_read) -- with grading once graded, alongside
    the model's own kickoff-locked pick per match for the same round."""
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})
    if season is None:
        season = _latest_season(db)
        if season is None:
            raise HTTPException(status_code=404, detail={
                "code": "no_nrl_data", "message": "No NRL matches are loaded yet",
            })
    if round is None:
        round = _current_round(db, season)
        if round is None:
            raise HTTPException(status_code=404, detail={
                "code": "no_nrl_data", "message": "No NRL matches are loaded yet",
            })

    home_team, away_team = aliased(SportTeam), aliased(SportTeam)
    rows = (
        db.query(SportMatch, home_team.name, away_team.name)
        .outerjoin(home_team, SportMatch.home_team_id == home_team.id)
        .outerjoin(away_team, SportMatch.away_team_id == away_team.id)
        .filter(SportMatch.sport == "nrl", SportMatch.season == season, SportMatch.round == round)
        .order_by(SportMatch.kickoff_utc.is_(None), SportMatch.kickoff_utc.asc(),
                  SportMatch.match_no.asc())
        .all()
    )
    if not rows:
        raise HTTPException(status_code=404, detail={
            "code": "round_not_found",
            "message": f"No matches for round {round} in season {season}",
        })
    featured_id = rows[0][0].id  # same ordering as _featured_match_id, no extra query

    match_ids = [m.id for m, _, _ in rows]
    preds_by_match = _model_predictions_by_match(db, match_ids)

    player = _player_for_read(db, device_id, user)
    tips_by_match: dict[int, UserTip] = {}
    if player is not None:
        for t in db.query(UserTip).filter(UserTip.player_id == player.id, UserTip.match_id.in_(match_ids)).all():
            tips_by_match[t.match_id] = t

    matches_out = []
    for m, home_name, away_name in rows:
        pred = _kickoff_locked_prediction(preds_by_match, m)
        model_out = None
        if pred is not None:
            pick, confidence = _model_pick(pred)
            model_out = {"pick": pick, "pick_confidence": confidence, "expected_margin": pred.expected_margin}
        tip = tips_by_match.get(m.id)
        your_out = None
        if tip is not None:
            your_out = {
                "pick": tip.pick,
                "margin": tip.margin,
                "points": tip.points,
                "round_margin": tip.round_margin,
                "graded_at": tip.graded_at.isoformat() if tip.graded_at else None,
                "updated_at": tip.updated_at.isoformat() if tip.updated_at else None,
            }
        matches_out.append({
            "id": m.id,
            "home": home_name,
            "away": away_name,
            "kickoff_utc": m.kickoff_utc.isoformat() if m.kickoff_utc else None,
            "status": m.status,
            "score_home": m.score_home,
            "score_away": m.score_away,
            "is_featured": m.id == featured_id,
            "model": model_out,
            "your_tip": your_out,
        })

    return {
        "season": season,
        "round": round,
        "handle": player.handle if player else None,
        "matches": matches_out,
        "disclaimer": _DISCLAIMER,
    }


@router.get("/tips/summary")
def tips_summary(device_id: str, db: Session = Depends(get_db),
                 user: AppUser | None = Depends(get_current_user_optional)):
    """Season-long you-vs-AI record: per graded round, the device's points vs
    the model's -- the model's side scored under the identical draw rule
    (_scores_point), so the two numbers are directly comparable. Also
    surfaces personal streak/best-round stats (Slice 2.5), scoped to the
    CURRENT season only (unlike `rounds`/`totals`, which span every season
    the device has ever played) -- null-safe zeroes/None when nothing is
    graded yet, same shape as zero_totals."""
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})

    zero_totals = {"your_points": 0, "model_points": 0, "rounds_played": 0}
    zero_streaks = {"current_streak": 0, "best_streak": 0, "best_round": None}
    player = _player_for_read(db, device_id, user)
    if player is None:
        return {"handle": None, "rounds": [], "totals": zero_totals, **zero_streaks, "disclaimer": _DISCLAIMER}

    rows = (
        db.query(UserTip, SportMatch)
        .join(SportMatch, UserTip.match_id == SportMatch.id)
        .filter(UserTip.player_id == player.id, UserTip.graded_at.isnot(None))
        .all()
    )
    if not rows:
        return {"handle": player.handle, "rounds": [], "totals": zero_totals, **zero_streaks, "disclaimer": _DISCLAIMER}

    # Streaks and best_round are personal SEASON-scoped stats (design doc,
    # Slice 2.5) -- unlike `rounds`/`totals` below, which stay season-long
    # across the device's whole graded history. Without this filter a win in
    # the last graded match of one season and a win in the first graded match
    # of the next would join into one streak across the off-season, and
    # best_round could point at a round from a season the player isn't even
    # looking at. Scoped to the latest season with any NRL match loaded, the
    # same "current season" convention _current_round/my_tips already use.
    current_season = _latest_season(db)
    season_rows = [tm for tm in rows if tm[1].season == current_season]
    current_streak, best_streak = _tip_streaks(season_rows)

    by_round: dict[tuple[int, int], list[tuple[UserTip, SportMatch]]] = {}
    for t, m in rows:
        by_round.setdefault((m.season, m.round), []).append((t, m))

    preds_by_match = _model_predictions_by_match(db, [m.id for _, m in rows])

    rounds_out = []
    total_your = total_model = 0
    for (season, rnd), items in sorted(by_round.items()):
        your_points = sum(t.points or 0 for t, _ in items)
        model_points = sum(points for _, points in _model_scores(preds_by_match, [m for _, m in items]))
        rounds_out.append({
            "season": season, "round": rnd,
            "your_points": your_points, "model_points": model_points,
            "matches_played": len(items),
        })
        total_your += your_points
        total_model += model_points

    # Same season scope as the streaks above -- a round from a season the
    # player isn't currently playing in must not surface as "best round".
    # Max your_points wins; ties broken toward the later round -- season_rounds
    # is already ascending on (season, round) (rounds_out's own sort), so
    # including round in the max() key naturally picks the latest tied round
    # within the (single) season left after filtering. Zero points -- every
    # graded round scored nothing -- isn't a "best round" worth bragging
    # about, so that's null too, same as the streak chips suppress at zero.
    season_rounds = [r for r in rounds_out if r["season"] == current_season]
    best_round = None
    if season_rounds:
        best = max(season_rounds, key=lambda r: (r["your_points"], r["round"]))
        if best["your_points"] > 0:
            best_round = {"round": best["round"], "points": best["your_points"]}

    return {
        "handle": player.handle,
        "rounds": rounds_out,
        "totals": {"your_points": total_your, "model_points": total_model, "rounds_played": len(rounds_out)},
        "current_streak": current_streak,
        "best_streak": best_streak,
        "best_round": best_round,
        "disclaimer": _DISCLAIMER,
    }


@router.get("/tips/leaderboard")
def tips_leaderboard(season: int, round: int, db: Session = Depends(get_db)):
    """Weekly (per-round) leaderboard. Tipper entries show from
    _LEADERBOARD_MIN_PARTICIPANTS (1) and the model is ALWAYS a ranked row
    (`is_model: true`, scored on every graded match of the round -- see
    _model_leaderboard_scores), so even a lone tipper has a rank against it.
    The model never enters a margin guess, so its round_margin is None and
    sorts last among equal points, like a tipper who skipped the margin; on a
    full tie the tipper ranks above it. participant_count counts tippers
    only, never the model. Never returns a device_id."""
    matches = (
        db.query(SportMatch)
        .options(load_only(*_MODEL_ROW_MATCH_COLUMNS))
        .filter(SportMatch.sport == "nrl", SportMatch.season == season, SportMatch.round == round)
        .all()
    )
    if not matches:
        raise HTTPException(status_code=404, detail={
            "code": "round_not_found",
            "message": f"No matches for round {round} in season {season}",
        })
    match_ids = [m.id for m in matches]

    rows = (
        db.query(UserTip, TipPlayer)
        .join(TipPlayer, UserTip.player_id == TipPlayer.id)
        .filter(UserTip.match_id.in_(match_ids))
        .all()
    )
    by_player: dict[int, list[UserTip]] = {}
    handles: dict[int, str] = {}
    for t, p in rows:
        by_player.setdefault(p.id, []).append(t)
        handles[p.id] = p.handle

    participant_count = len(by_player)
    entries = []
    if participant_count >= _LEADERBOARD_MIN_PARTICIPANTS:
        for player_id, tips in by_player.items():
            points = sum(t.points or 0 for t in tips)
            round_margin = next((t.round_margin for t in tips if t.round_margin is not None), None)
            entries.append({"handle": handles[player_id], "points": points, "round_margin": round_margin,
                            "is_model": False})
    entries.append({
        "handle": _MODEL_HANDLE,
        "points": sum(points for _, points in _model_leaderboard_scores(db, matches)),
        "round_margin": None,
        "is_model": True,
    })
    entries.sort(key=_leaderboard_rank("round_margin"))

    return {
        "season": season, "round": round,
        "participant_count": participant_count,
        "entries": entries,
    }


@router.get("/tips/leaderboard/season")
def tips_leaderboard_season(season: int, db: Session = Depends(get_db)):
    """Season-long leaderboard (Slice 2.5): per-player totals across every
    graded round in the season, not just one round's featured match. Same
    reveal rule, model row and no-device_id rule as the weekly board
    (tips_leaderboard) -- only the ranking key and the time window differ.
    The model's row covers every graded match of the season, its
    rounds_played counts the rounds it was scored in, and its total_margin is
    None (it never enters a margin guess). Unlike the weekly
    board (which counts anyone who's SUBMITTED a tip in the round, graded or
    not, since "N players so far" is meaningful pre-grade), the population
    here is players with at least one GRADED tip this season -- a running
    season total only means something once something's been graded."""
    season_exists = (
        db.query(SportMatch.id)
        .filter(SportMatch.sport == "nrl", SportMatch.season == season)
        .first()
    )
    if season_exists is None:
        raise HTTPException(status_code=404, detail={
            "code": "season_not_found",
            "message": f"No NRL matches for season {season}",
        })

    rows = (
        db.query(UserTip, SportMatch.round, TipPlayer)
        .join(TipPlayer, UserTip.player_id == TipPlayer.id)
        .join(SportMatch, UserTip.match_id == SportMatch.id)
        .filter(UserTip.graded_at.isnot(None), SportMatch.season == season)
        .all()
    )
    by_player: dict[int, list[tuple[UserTip, int]]] = {}
    handles: dict[int, str] = {}
    for t, rnd, p in rows:
        by_player.setdefault(p.id, []).append((t, rnd))
        handles[p.id] = p.handle

    participant_count = len(by_player)
    entries = []
    if participant_count >= _LEADERBOARD_MIN_PARTICIPANTS:
        for player_id, tips in by_player.items():
            points = sum(t.points or 0 for t, _ in tips)
            by_round: dict[int, list[UserTip]] = {}
            for t, rnd in tips:
                by_round.setdefault(rnd, []).append(t)
            rounds_played = len(by_round)
            # Cumulative version of the weekly board's round_margin tiebreak:
            # sum, across the season's rounds, of each round's featured-match
            # margin score (the same "first non-null tip in the round" pick
            # tips_leaderboard uses, since only the featured match ever
            # carries one). A player who never entered a single margin guess
            # all season has nothing to sum -- None sorts last below, same as
            # a missing round_margin does on the weekly board, rather than a
            # false "0" beating every real attempt.
            round_margins = [
                next((t.round_margin for t in round_tips if t.round_margin is not None), None)
                for round_tips in by_round.values()
            ]
            recorded = [m for m in round_margins if m is not None]
            total_margin = sum(recorded) if recorded else None
            entries.append({
                "handle": handles[player_id], "points": points,
                "total_margin": total_margin, "rounds_played": rounds_played,
                "is_model": False,
            })
    finished = (
        db.query(SportMatch)
        .options(load_only(*_MODEL_ROW_MATCH_COLUMNS))
        .filter(SportMatch.sport == "nrl", SportMatch.season == season, SportMatch.status == "finished")
        .all()
    )
    model_scores = _model_leaderboard_scores(db, finished)
    entries.append({
        "handle": _MODEL_HANDLE,
        "points": sum(points for _, points in model_scores),
        "total_margin": None,
        "rounds_played": len({m.round for m, _ in model_scores}),
        "is_model": True,
    })
    entries.sort(key=_leaderboard_rank("total_margin"))

    return {
        "season": season,
        "participant_count": participant_count,
        "entries": entries,
    }


@router.get("/tips/share/{season}/{round}/{handle}")
def tips_share(season: int, round: int, handle: str, db: Session = Depends(get_db)):
    """Public, handle-addressed data for the share card / OG image (Slice
    2.5) -- UNFAKEABLE by construction: every number here is read straight
    off the graded UserTip/SportMatch rows the leaderboard already trusts,
    never a client-supplied score, which is the whole point of routing by
    handle instead of accepting numbers in the URL/query.

    Exposes GRADED results only: a handle with no graded tip in this round --
    because the handle doesn't exist, that player never tipped this round,
    or the round just isn't graded yet -- 404s with the SAME code/message in
    every case, so probing the handle namespace (handles collide by design,
    see _generate_handle, and the combinatorial space is small) can't
    distinguish "unknown handle" from "hasn't played this round" from
    "round not graded yet".

    round_complete tells the page whether player_of/model_of are the WHOLE
    round or just what's graded so far: grading runs per finished match
    (pipeline.sports.nrl_user_tips), not per whole round, and an NRL round
    spans Thu-Sun, so a round can sit partially graded for days. Without this
    flag the card would frame a 1/1 scored off the Thursday opener as "beat
    the AI this round" while seven fixtures are still unplayed."""
    candidates = db.query(TipPlayer).filter(TipPlayer.handle == handle).order_by(TipPlayer.id.asc()).all()
    player_ids = [p.id for p in candidates]
    rows = []
    if player_ids:
        rows = (
            db.query(UserTip, SportMatch)
            .join(SportMatch, UserTip.match_id == SportMatch.id)
            .filter(UserTip.player_id.in_(player_ids), UserTip.graded_at.isnot(None),
                    SportMatch.season == season, SportMatch.round == round)
            .all()
        )
    if not rows:
        raise HTTPException(status_code=404, detail={
            "code": "share_not_found",
            "message": f"No graded result for {handle!r} in season {season} round {round}.",
        })

    # handle has no uniqueness constraint (collisions are cosmetic-only by
    # design elsewhere) -- if more than one TipPlayer ever landed on this
    # exact string AND both played this round, resolve deterministically to
    # the oldest registrant rather than whichever the join happened to
    # return first.
    by_player: dict[int, list[tuple[UserTip, SportMatch]]] = {}
    for t, m in rows:
        by_player.setdefault(t.player_id, []).append((t, m))
    chosen_id = min(by_player)
    items = by_player[chosen_id]
    handle_display = next(p.handle for p in candidates if p.id == chosen_id)

    preds_by_match = _model_predictions_by_match(db, [m.id for _, m in items])

    # Same live-scoring pattern as tips_summary, over the SAME per-round tip
    # set, so this number never disagrees with what /summary shows this
    # player for this round.
    player_points = sum(t.points or 0 for t, _ in items)
    model_points = sum(points for _, points in _model_scores(preds_by_match, [m for _, m in items]))

    featured_tip = next((t for t, _ in items if t.round_margin is not None), None)
    margin_note = (
        f"Featured-match margin tiebreak score: {featured_tip.round_margin}"
        if featured_tip is not None else None
    )

    # Whole-round completeness, independent of what THIS player tipped --
    # every match in (season, round) must be finished. Same belt-and-braces
    # "status OR both scores present" check submit_tip's already_played uses.
    round_matches = (
        db.query(SportMatch)
        .filter(SportMatch.sport == "nrl", SportMatch.season == season, SportMatch.round == round)
        .all()
    )
    round_complete = bool(round_matches) and all(
        m.status == "finished" or (m.score_home is not None and m.score_away is not None)
        for m in round_matches
    )

    return {
        "handle_display": handle_display,
        "season": season,
        "round": round,
        "player_points": player_points,
        "player_of": len(items),
        "model_points": model_points,
        "model_of": len(items),
        "round_complete": round_complete,
        "margin_note": margin_note,
        "disclaimer": _DISCLAIMER,
    }


def _has_table(db: Session, table_name: str) -> bool:
    """Cheap catalog check (SELECT against the DB's own metadata, never the
    table itself) so a caller can skip a query against a relation that might
    not exist yet -- see claim_device_tips's league_score_predictions guard.
    Deliberately NOT a try/except around the real query: on Postgres, letting
    a query against a missing relation fail marks the whole transaction
    aborted, so any later statement in the same request (including the
    caller's own commit) would be silently discarded rather than raising."""
    return inspect(db.bind).has_table(table_name)


@router.post("/tips/claim", dependencies=[Depends(require_same_origin)])
def claim_device_tips(
    payload: schemas.NrlTipClaimIn,
    user: AppUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Attach a device's tip history to the signed-in account (merge-on-
    signup). Idempotent: a device with no history, an already-linked device,
    or a device already merged into this account all return success with no
    further change. When the account already owns a different player row,
    the device's tips are merged into it -- conflict rule: the account's own
    tip wins wherever both exist for the same match (mirrors match_picks.py's
    "existing row is never silently overwritten" idiom).

    device_id is a bare, unauthenticated body param (no proof of possession),
    so it must never be trusted to REASSIGN or MERGE-AND-DELETE a player row
    that's already claimed by a *different* account -- a shared/kiosk device,
    or a device_id read off an access log, would otherwise let anyone steal
    another account's tip history out from under it.

    tip_players is a shared cross-sport identity row -- league_score_
    predictions (football's Beat-the-AI's-scoreline loop) FKs to it exactly
    like user_tips does, so the merge-conflict branch below carries a SECOND
    reassign/dedupe loop over that table too. Without it, deleting
    device_player at the end of that branch would either 500 (IntegrityError,
    no ON DELETE CASCADE) or silently drop the device's league predictions
    the moment a device has played both sports and hits the two-existing-
    players merge path -- not folded into `claimed_tips`, whose count is
    NRL-tips-only and asserted exactly by existing tests.

    That second loop is itself guarded by a table-existence check (see
    _has_table below): league_score_predictions ships in migration
    b7c8d9e0f1a2, which -- same Render deploy-before-migrate window as
    matches.matchweek -- reaches prod via a separate refresh.yml dispatch
    AFTER this code is already live. Without the guard, a real user hitting
    this already-shipped merge branch during that window would 500
    (UndefinedTable) on a query, not a missing column, so deferral can't help
    here; checking existence first (rather than try/except around the query)
    also avoids leaving the session's Postgres transaction aborted, which
    would silently roll back the NRL-only merge this function must still
    complete."""
    device_id = payload.device_id
    if not _DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail={"code": "invalid_device_id",
                                                     "message": "device_id must be a UUID v4."})

    existing = db.query(TipPlayer).filter_by(user_id=user.id).one_or_none()
    device_player = db.query(TipPlayer).filter_by(device_id=device_id).one_or_none()

    if device_player is None:
        # Nothing to claim -- a friendly no-op rather than an error, since the
        # frontend calls this on every sign-in without knowing in advance
        # whether the device ever tipped.
        return {"ok": True, "handle": existing.handle if existing else None, "claimed_tips": 0}

    if device_player.user_id is not None and device_player.user_id != user.id:
        # Device is already claimed by a DIFFERENT account -- never reassign,
        # merge, or delete another account's player row. Same no-op shape as
        # "nothing to claim" so this doesn't leak whether the device is
        # claimed, or by whom.
        return {"ok": True, "handle": existing.handle if existing else None, "claimed_tips": 0}

    if existing is None:
        device_player.user_id = user.id
        db.commit()
        claimed = db.query(UserTip).filter_by(player_id=device_player.id).count()
        return {"ok": True, "handle": device_player.handle, "claimed_tips": claimed}

    if existing.id == device_player.id:
        claimed = db.query(UserTip).filter_by(player_id=existing.id).count()
        return {"ok": True, "handle": existing.handle, "claimed_tips": claimed}

    existing_match_ids = {
        mid for (mid,) in db.query(UserTip.match_id).filter_by(player_id=existing.id).all()
    }
    moved = 0
    for tip in db.query(UserTip).filter_by(player_id=device_player.id).all():
        if tip.match_id in existing_match_ids:
            db.delete(tip)
        else:
            tip.player_id = existing.id
            moved += 1

    # Same reassign/dedupe shape for league_score_predictions -- see the
    # docstring above. device_player is deleted below; any row of this OTHER
    # table still pointing at it would otherwise 500 (FK violation) or, if a
    # cascade existed, vanish silently. Not counted into `moved`/claimed_tips,
    # whose meaning (NRL tips moved) existing tests assert exactly. Skipped
    # entirely (rather than attempted-and-caught) when the table itself
    # doesn't exist yet -- see _has_table and claim_device_tips's docstring.
    if _has_table(db, "league_score_predictions"):
        existing_pred_match_ids = {
            mid for (mid,) in db.query(LeagueScorePrediction.match_id).filter_by(player_id=existing.id).all()
        }
        for pred in db.query(LeagueScorePrediction).filter_by(player_id=device_player.id).all():
            if pred.match_id in existing_pred_match_ids:
                db.delete(pred)
            else:
                pred.player_id = existing.id

    # And for ufc_picks, keyed by bout: the account's own pick wins, the
    # device's duplicate is deleted. No table-existence guard -- ufc_picks has
    # been in production since UFC phase 1. Not counted into claimed_tips.
    existing_pick_bout_ids = {
        bid for (bid,) in db.query(UfcPick.bout_id).filter_by(player_id=existing.id).all()
    }
    for pick in db.query(UfcPick).filter_by(player_id=device_player.id).all():
        if pick.bout_id in existing_pick_bout_ids:
            db.delete(pick)
        else:
            pick.player_id = existing.id

    db.delete(device_player)
    db.commit()
    return {"ok": True, "handle": existing.handle, "claimed_tips": moved}
