"""Write shadow predictions for scheduled UFC bouts and refresh fighter ratings.

Predictions are the record visitors' picks are later compared against, so this
step is append-only and frozen at lock. A row is written only while
`now < lock_time(bout)` and the bout is still `scheduled`; the guard lives in
`_write_prediction` itself so no caller can bypass it. `locked_at` is stamped by
the results job when it first sees a bout live, which is after the start, so the
lock is the earlier of `locked_at` and `scheduled_utc`. A new row is appended
only when a model's output for the bout actually changed (a result arrived, a
parameter changed); earlier rows are never edited. Every row carries the model's
version constant from the code, never a value read from a file, and the form
model runs only when the loaded parameters carry that same version.

Logging is counts only: the repository is public and bout details stay out of logs.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcFighter, UfcPrediction
from ml.sports.ufc.elo import EloParams, final_ratings
from ml.sports.ufc.features import snapshots
from ml.sports.ufc.history import FighterInfo, History
from ml.sports.ufc.methods import WINDOW_YEARS, MethodTable, method_table
from ml.sports.ufc.model import FORM_VERSION, contributions, predict_form
from ml.sports.ufc.params import UfcParams, load_params
from ml.sports.ufc.reasons import elo_reasons, form_reasons
from pipeline.sports.ufc_history import load_history, to_record
from pipeline.sports.ufc_ingest import _utc

log = logging.getLogger(__name__)

ELO_VERSION = EloParams().version
EPS = 1e-9
WINDOW = timedelta(days=round(365.25 * WINDOW_YEARS))


@dataclass
class GenerateSummary:
    candidates: int = 0
    written: int = 0
    locked_skipped: int = 0
    ratings_updated: int = 0


def lock_time(bout: UfcBout) -> datetime | None:
    """The earlier of `locked_at` and `scheduled_utc`; whichever is set; else None."""
    times = [t for t in (_utc(bout.locked_at), _utc(bout.scheduled_utc)) if t is not None]
    return min(times) if times else None


def _is_open(bout: UfcBout, now: datetime) -> bool:
    lock = lock_time(bout)
    return bout.status == "scheduled" and lock is not None and now < lock


def _differs(latest: UfcPrediction, p_a: float, method_probs: dict[str, float], reasons: list[str]) -> bool:
    old = latest.method_probs or {}
    return (
        abs(p_a - latest.p_a) > EPS
        or set(old) != set(method_probs)
        or any(abs(method_probs[k] - old[k]) > EPS for k in method_probs)
        or list(latest.reasons or []) != list(reasons)
    )


def _write_prediction(
    db: Session, bout: UfcBout, version: str, p_a: float,
    method_probs: dict[str, float], reasons: list[str], now: datetime,
) -> bool:
    """Append a row when the bout is open and the output changed; True when written."""
    if not _is_open(bout, now):
        return False
    existing = db.scalars(
        select(UfcPrediction).where(
            UfcPrediction.bout_id == bout.id, UfcPrediction.model_version == version
        )
    ).all()
    if existing:
        latest = max(existing, key=lambda r: (_utc(r.created_at), r.id))
        if not _differs(latest, p_a, method_probs, reasons):
            return False
    db.add(UfcPrediction(
        bout_id=bout.id, model_version=version, p_a=p_a, p_b=1.0 - p_a,
        method_probs=dict(method_probs), reasons=list(reasons), is_shadow=True, created_at=now,
    ))
    return True


def _usable(x, names) -> bool:
    return all(n in x and x[n] is not None and math.isfinite(x[n]) for n in names)


def generate(db: Session, params: UfcParams | None = None, now: datetime | None = None) -> GenerateSummary:
    params = params or load_params()
    now = now or datetime.now(timezone.utc)
    summary = GenerateSummary()
    history = load_history(db)

    # Ratings: only fighters with an applied bout change.
    ratings = final_ratings(history, params.elo, at=now)
    if ratings:
        for f in db.scalars(select(UfcFighter).where(UfcFighter.id.in_(list(ratings)))):
            if abs(ratings[f.id] - (f.rating if f.rating is not None else 0.0)) > EPS:
                f.rating = ratings[f.id]
                summary.ratings_updated += 1

    scheduled = db.scalars(
        select(UfcBout).where(UfcBout.status == "scheduled", UfcBout.scheduled_utc.is_not(None))
        .order_by(UfcBout.id)
    ).all()
    candidates = [b for b in scheduled if _is_open(b, now)]
    summary.candidates = len(candidates)
    summary.locked_skipped = len(scheduled) - len(candidates)

    form = params.form
    if form is not None and form.version != FORM_VERSION:
        log.warning("ufc predict: form parameters are version %s, code expects %s; writing Elo rows only",
                    form.version, FORM_VERSION)
        form = None

    if candidates:
        fighter_ids = {i for b in candidates for i in (b.fighter_a_id, b.fighter_b_id)}
        fighters = {f.id: f for f in db.scalars(select(UfcFighter).where(UfcFighter.id.in_(fighter_ids)))}
        # load_history only carries fighters with a finished bout; debutants need their profile too.
        infos = dict(history.fighters)
        for f in fighters.values():
            infos.setdefault(f.id, FighterInfo(f.id, f.name, f.date_of_birth, f.height_in, f.reach_in))
        snaps = snapshots(History(history.bouts, infos), params.elo, targets=[to_record(b) for b in candidates])
        tables: dict[datetime, MethodTable] = {}
        skipped_form = 0
        for bout in candidates:
            when = _utc(bout.scheduled_utc)
            if when not in tables:  # [when - 10y, when): own result and same-time bouts never feed it
                tables[when] = method_table(history.bouts, when - WINDOW, when)
            mp = tables[when].probs(bout.weight_class, bout.scheduled_rounds)
            snap = snaps[bout.id]
            name_a, name_b = fighters[bout.fighter_a_id].name, fighters[bout.fighter_b_id].name
            summary.written += _write_prediction(
                db, bout, ELO_VERSION, snap.p_elo, mp, elo_reasons(name_a, name_b, snap, snap.p_elo), now
            )
            if form is None:
                continue
            if not _usable(snap.x, form.features):
                skipped_form += 1
                log.warning("ufc predict: a feature is missing or non-finite; form row skipped")
                continue
            p_a = predict_form(form, snap.x)
            reasons = form_reasons(name_a, name_b, snap, contributions(form, snap.x), p_a)
            summary.written += _write_prediction(db, bout, FORM_VERSION, p_a, mp, reasons, now)

    db.commit()
    log.info("ufc predict: %d candidates, %d rows written, %d locked, %d ratings updated",
             summary.candidates, summary.written, summary.locked_skipped, summary.ratings_updated)
    return summary
