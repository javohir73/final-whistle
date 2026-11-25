"""Write shadow predictions for scheduled UFC bouts, refresh ratings, and grade them.

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

Grading scores, per bout and model version, the one row that counted: the latest
created at or before the lock. A later row is never graded. Draws, no contests and
every non-finished status are skipped, and a bout is graded once.

Logging is counts only: the repository is public and bout details stay out of logs.
"""
from __future__ import annotations

import argparse
import logging
import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcFighter, UfcPrediction, UfcPredictionResult
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
MIN_HISTORY_BOUTS = 1000  # below this the history is not loaded; every fighter would look like a debutant
RATING_EPS = 0.01
WINDOW = timedelta(days=round(365.25 * WINDOW_YEARS))


@dataclass
class GenerateSummary:
    candidates: int = 0
    written: int = 0
    locked_skipped: int = 0
    ratings_updated: int = 0
    failed: int = 0


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
    now = _utc(now) if now else datetime.now(timezone.utc)
    summary = GenerateSummary()
    if not params.elo_from_file:
        log.warning("ufc predict: Elo settings are the code fallback, not the fitted file; nothing written")
        return summary
    if params.elo.version != ELO_VERSION:
        # Rows would carry this code's label but come from other parameters.
        log.warning("ufc predict: Elo parameters are version %s, code expects %s; nothing written",
                    params.elo.version, ELO_VERSION)
        return summary
    try:
        _generate(db, params, now, summary)
    except Exception:
        db.rollback()
        raise
    return summary


def _generate(db: Session, params: UfcParams, now: datetime, summary: GenerateSummary) -> None:
    history = load_history(db)
    if len(history.bouts) < MIN_HISTORY_BOUTS:
        log.warning("ufc predict: history not loaded (%d finished bouts); nothing written", len(history.bouts))
        return

    # Ratings: only fighters with an applied bout change.
    ratings = final_ratings(history, params.elo, at=now)
    if ratings:
        for f in db.scalars(select(UfcFighter).where(UfcFighter.id.in_(list(ratings)))):
            if f.rating is None or abs(ratings[f.id] - f.rating) > RATING_EPS:
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
            try:
                with db.begin_nested():
                    wrote, skipped = _predict_bout(db, bout, form, snaps, fighters, tables, history, now)
            except Exception as exc:  # noqa: BLE001 - one bout must not stop the run
                summary.failed += 1
                log.warning("ufc predict: a bout failed (%s)", type(exc).__name__)
                continue
            summary.written += wrote
            skipped_form += skipped

    db.commit()
    log.info("ufc predict: %d candidates, %d rows written, %d locked, %d ratings updated, %d failed",
             summary.candidates, summary.written, summary.locked_skipped, summary.ratings_updated,
             summary.failed)


def _predict_bout(db, bout, form, snaps, fighters, tables, history, now) -> tuple[int, int]:
    """Write both models' rows for one bout; returns (rows written, form rows skipped)."""
    when = _utc(bout.scheduled_utc)
    if when not in tables:  # [when - 10y, when): own result and same-time bouts never feed it
        tables[when] = method_table(history.bouts, when - WINDOW, when)
    mp = tables[when].probs(bout.weight_class, bout.scheduled_rounds)
    snap = snaps[bout.id]
    name_a, name_b = fighters[bout.fighter_a_id].name, fighters[bout.fighter_b_id].name
    wrote = _write_prediction(
        db, bout, ELO_VERSION, snap.p_elo, mp, elo_reasons(name_a, name_b, snap, snap.p_elo), now
    )
    if form is None:
        return int(wrote), 0
    if not _usable(snap.x, form.features):
        log.warning("ufc predict: a feature is missing or non-finite; form row skipped")
        return int(wrote), 1
    p_a = predict_form(form, snap.x)
    reasons = form_reasons(name_a, name_b, snap, contributions(form, snap.x), p_a)
    return int(wrote) + int(_write_prediction(db, bout, FORM_VERSION, p_a, mp, reasons, now)), 0


LOG_LOSS_FLOOR = 1e-15
RECONCILE_DAYS = 30


@dataclass
class GradeSummary:
    written: int = 0
    regraded: int = 0
    removed: int = 0
    failed: int = 0


def _scores(bout: UfcBout, row: UfcPrediction) -> tuple[float, bool, float, float]:
    p = row.p_a if bout.winner == "a" else row.p_b
    return p, p > 0.5, -math.log(max(LOG_LOSS_FLOOR, p)), (1 - p) ** 2


def _qualifies(bout: UfcBout) -> bool:
    return bout.status == "finished" and bout.winner in ("a", "b")


def _reconcile(db: Session, now: datetime, summary: GradeSummary) -> None:
    """Re-score recent result rows against the bout's current winner (results can be overturned)."""
    cutoff = now - timedelta(days=RECONCILE_DAYS)
    rows = db.execute(
        select(UfcPredictionResult, UfcBout, UfcPrediction)
        .join(UfcBout, UfcBout.id == UfcPredictionResult.bout_id)
        .join(UfcPrediction, UfcPrediction.id == UfcPredictionResult.prediction_id)
        .where(UfcBout.scheduled_utc >= cutoff - timedelta(days=1))  # coarse; exact check below
        .order_by(UfcPredictionResult.id)
    ).all()
    for result, bout, pred in rows:
        when = _utc(bout.scheduled_utc)
        if when is None or when < cutoff:
            continue
        try:
            with db.begin_nested():
                if not _qualifies(bout):
                    db.delete(result)
                    summary.removed += 1
                    continue
                p, correct, loss, brier = _scores(bout, pred)
                if (result.winner_correct != correct or abs(result.prob_assigned - p) > 1e-12
                        or abs(result.log_loss - loss) > 1e-12 or abs(result.brier - brier) > 1e-12):
                    result.prob_assigned, result.winner_correct = p, correct
                    result.log_loss, result.brier, result.evaluated_at = loss, brier, now
                    summary.regraded += 1
        except Exception as exc:  # noqa: BLE001 - one row must not stop the rest
            summary.failed += 1
            log.warning("ufc predict: a result failed to reconcile (%s)", type(exc).__name__)


def grade_summary(db: Session, now: datetime | None = None) -> GradeSummary:
    """Reconcile recent result rows, then grade bouts whose counting prediction has no result."""
    now = _utc(now) if now else datetime.now(timezone.utc)
    summary = GradeSummary()
    _reconcile(db, now, summary)
    db.flush()

    # Only a selector: a prediction counts as ungraded when it was made at or before the
    # lock (the earlier of locked_at and scheduled_utc), so bouts that can never be graded
    # are not re-read on every run. `_grade_bout` stays the authority for the counting row.
    lock = case(
        (and_(UfcBout.locked_at.is_not(None), UfcBout.scheduled_utc.is_not(None),
              UfcBout.locked_at < UfcBout.scheduled_utc), UfcBout.locked_at),
        (UfcBout.scheduled_utc.is_not(None), UfcBout.scheduled_utc),
        else_=UfcBout.locked_at,
    )
    ungraded = (
        select(UfcPrediction.id).where(
            UfcPrediction.bout_id == UfcBout.id,
            lock.is_not(None),
            UfcPrediction.created_at <= lock,
            ~select(UfcPredictionResult.id).where(
                UfcPredictionResult.bout_id == UfcPrediction.bout_id,
                UfcPredictionResult.model_version == UfcPrediction.model_version,
            ).exists(),
        ).exists()
    )
    bouts = db.scalars(
        select(UfcBout).where(UfcBout.status == "finished", UfcBout.winner.in_(("a", "b")), ungraded)
        .order_by(UfcBout.id)
    ).all()
    if bouts:
        ids = [b.id for b in bouts]
        preds: dict[int, list[UfcPrediction]] = {}
        for row in db.scalars(select(UfcPrediction).where(UfcPrediction.bout_id.in_(ids))):
            preds.setdefault(row.bout_id, []).append(row)
        done: dict[int, set[str]] = {}
        for bout_id, version in db.execute(
            select(UfcPredictionResult.bout_id, UfcPredictionResult.model_version)
            .where(UfcPredictionResult.bout_id.in_(ids))
        ):
            done.setdefault(bout_id, set()).add(version)
        for bout in bouts:
            try:
                with db.begin_nested():
                    summary.written += _grade_bout(db, bout, preds.get(bout.id, []), done.get(bout.id, set()))
            except Exception as exc:  # noqa: BLE001 - one bout must not stop the rest
                summary.failed += 1
                log.warning("ufc predict: a bout failed (%s)", type(exc).__name__)
    db.commit()
    log.info("ufc predict: %d result rows written, %d regraded, %d removed, %d failed",
             summary.written, summary.regraded, summary.removed, summary.failed)
    return summary


def grade(db: Session) -> int:
    """Run `grade_summary`; returns the number of result rows written."""
    return grade_summary(db).written


def _grade_bout(db: Session, bout: UfcBout, rows: list[UfcPrediction], graded: set[str]) -> int:
    lock = lock_time(bout)
    if lock is None:
        return 0
    counting: dict[str, UfcPrediction] = {}
    for row in rows:
        if row.model_version in graded or _utc(row.created_at) > lock:
            continue
        best = counting.get(row.model_version)
        if best is None or (_utc(row.created_at), row.id) > (_utc(best.created_at), best.id):
            counting[row.model_version] = row
    for version, row in counting.items():
        p, correct, loss, brier = _scores(bout, row)
        db.add(UfcPredictionResult(
            prediction_id=row.id, bout_id=bout.id, model_version=version,
            winner_correct=correct, prob_assigned=p, log_loss=loss, brier=brier,
        ))
    return len(counting)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--generate", action="store_true", help="write predictions for scheduled bouts")
    ap.add_argument("--grade", action="store_true", help="grade finished bouts with predictions")
    args = ap.parse_args(argv)
    if not args.generate and not args.grade:
        ap.error("pass --generate, --grade, or both")

    from app.db import SessionLocal

    db = SessionLocal()
    code = 0
    try:
        for flag, step in ((args.generate, generate), (args.grade, grade)):
            if not flag:
                continue
            try:
                step(db)
            except Exception as exc:  # noqa: BLE001 - one step failing must not stop the next
                db.rollback()
                log.error("ufc predict: %s failed (%s)", step.__name__, type(exc).__name__)
                code = 1
    finally:
        db.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
