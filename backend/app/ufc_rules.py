"""UFC rules shared by the API and the picks game. Plain module: no imports from the API layer."""
from __future__ import annotations

import math
import re
from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import and_, case

from app.models import UfcBout, UfcEvent

# Same rule as the frontend's `isTba` (frontend/lib/ufcDisplay.ts), applied to the trimmed name.
_PLACEHOLDER = re.compile(r"^(opponent\s+)?tba$", re.IGNORECASE)


def is_placeholder_name(name: str | None) -> bool:
    """True for a missing or blank name, "TBA" and "Opponent TBA" (any case, any inner spacing)."""
    if name is None or not name.strip():
        return True
    return _PLACEHOLDER.match(name.strip()) is not None


RECONCILE_DAYS = 30  # a settled bout's result and picks are re-read for this long after its start

PICK_METHODS: tuple[str, ...] = ("ko_tko", "submission", "decision")
METHOD_TIE_ORDER: tuple[str, ...] = ("decision", "ko_tko", "submission")  # == ml.sports.ufc.methods._TIE_ORDER
VOID_METHODS: tuple[str, ...] = ("draw", "no_contest")

_LOCKED = (422, "fight_locked", "Picks for this fight have closed.")


def utc(dt: datetime | None) -> datetime | None:
    """Naive values (SQLite) are taken as UTC; aware ones (Postgres) are converted to UTC."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def lock_time(bout: UfcBout) -> datetime | None:
    """The earlier of `locked_at` and `scheduled_utc`; whichever is set; else None."""
    times = [t for t in (utc(bout.locked_at), utc(bout.scheduled_utc)) if t is not None]
    return min(times) if times else None


def lock_expr():
    """SQL form of `lock_time` over `UfcBout`: the earlier of `locked_at` and
    `scheduled_utc`, whichever is set; NULL when neither is."""
    return case(
        (and_(UfcBout.locked_at.is_not(None), UfcBout.scheduled_utc.is_not(None),
              UfcBout.locked_at < UfcBout.scheduled_utc), UfcBout.locked_at),
        (UfcBout.scheduled_utc.is_not(None), UfcBout.scheduled_utc),
        else_=UfcBout.locked_at,
    )


def pick_block(
    bout: UfcBout, event: UfcEvent, name_a: str | None, name_b: str | None, now: datetime
) -> tuple[int, str, str] | None:
    """None when a first pick may be accepted now; else (http status, code, message)."""
    if bout.status == "changed":
        return (422, "fight_changed", "This fight has changed. Pick the new one on the card.")
    if bout.status == "cancelled" or event.status == "cancelled":
        return (422, "fight_cancelled", "This fight was cancelled.")
    lock = lock_time(bout)
    if bout.status != "scheduled" or bout.winner is not None or lock is None or utc(now) >= lock:
        return _LOCKED
    if is_placeholder_name(name_a) or is_placeholder_name(name_b):
        return (422, "opponent_tba", "Picks open once both fighters are confirmed.")
    return None


def call_is_public(bout: UfcBout, name_a: str | None, name_b: str | None, now: datetime) -> bool:
    """Whether the model's call on this bout may be shown to everyone."""
    if is_placeholder_name(name_a) or is_placeholder_name(name_b):
        return False
    if bout.status in ("cancelled", "changed"):
        return False
    if bout.status in ("live", "finished"):
        return True
    if bout.status == "scheduled":
        lock = lock_time(bout)
        return lock is not None and utc(now) >= lock
    return False


@dataclass(frozen=True)
class PickScore:
    points: int | None
    winner_correct: bool | None
    method_correct: bool | None
    void: bool


_VOID = PickScore(None, None, None, True)


def score_pick(winner: str, method: str | None, bout: UfcBout) -> PickScore | None:
    """The one scoring rule: 5 for winner and method, 2 for the winner, 0 otherwise.
    A void bout voids the pick; None while the bout has no result yet."""
    if bout.status in ("cancelled", "changed"):
        return _VOID
    if bout.status != "finished":
        return None
    if bout.winner not in ("a", "b") or bout.method in VOID_METHODS:
        return _VOID
    if winner != bout.winner:
        return PickScore(0, False, False, False)
    if method is not None and bout.method == method and method in PICK_METHODS:
        return PickScore(5, True, True, False)
    return PickScore(2, True, False, False)


def model_pick(p_a: float, method_probs: dict | None) -> tuple[str | None, str | None]:
    """The model's pick as (winner side, method). At exactly 50% it sits the fight out;
    the method is the likeliest of the three, ties broken by METHOD_TIE_ORDER."""
    if p_a > 0.5:
        side = "a"
    elif p_a < 0.5:
        side = "b"
    else:
        return None, None
    best: str | None = None
    for key in METHOD_TIE_ORDER:
        value = method_probs.get(key) if method_probs else None
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            continue  # a malformed stored value is skipped, never raised on
        if best is None or value > method_probs[best]:
            best = key
    return side, best
