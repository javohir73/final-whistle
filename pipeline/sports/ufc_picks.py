"""Grade players' UFC picks once a bout is settled, and again if its result changes.

Scoring is decided by `app.ufc_rules.score_pick`; this module only decides which
picks to look at and writes the outcome. A pick is graded when its bout is settled
(finished, cancelled or changed) and the pick was last changed at or before the lock;
a pick stamped after the lock, or for a bout with no lock, is never graded (counted
as late, never scored zero). A void grade is stored as `graded_at` set with NULL
points and NULL correctness.

Picks are re-read for `RECONCILE_DAYS` after the bout so an overturned result (a new
winner, or a no contest) re-grades them, and a reinstated bout resets its grade.
Never-graded picks on a settled bout are graded at any age. A run that finds
nothing changed writes nothing; `updated_at` is never touched (it tracks only the
player's own change).

Logging is counts only: the repository is public.
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from itertools import groupby

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcPick
from app.ufc_rules import lock_time, score_pick, utc
from pipeline.sports.ufc_predict import RECONCILE_DAYS

log = logging.getLogger(__name__)

SETTLED = ("finished", "cancelled", "changed")


@dataclass
class PickGradeSummary:
    written: int = 0      # rows given a new or changed grade
    voided: int = 0       # of those, void
    reset: int = 0        # grades removed because the bout is no longer settled
    late: int = 0         # picks never graded: stamped after the lock, or no lock
    failed: int = 0       # bouts whose picks could not be graded this run


def _grade_bout(picks: list[UfcPick], bout: UfcBout, now: datetime, in_window: bool) -> PickGradeSummary:
    out = PickGradeSummary()
    lock = lock_time(bout)
    settled = bout.status in SETTLED
    for pick in picks:
        if pick.graded_at is None:
            if not settled:
                continue
            updated = utc(pick.updated_at)
            if lock is None or updated is None or updated > lock:
                out.late += 1
                continue
        elif not in_window:
            continue
        score = score_pick(pick.winner, pick.method, bout) if settled else None
        if score is None:
            if pick.graded_at is not None:
                pick.points = pick.winner_correct = pick.method_correct = pick.graded_at = None
                out.reset += 1
            continue
        new = (score.points, score.winner_correct, score.method_correct)
        if pick.graded_at is not None and new == (pick.points, pick.winner_correct, pick.method_correct):
            continue
        pick.points, pick.winner_correct, pick.method_correct = new
        pick.graded_at = now
        out.written += 1
        out.voided += int(score.void)
    return out


def grade_picks(db: Session, now: datetime | None = None) -> PickGradeSummary:
    now = utc(now) if now else datetime.now(timezone.utc)
    cutoff = now - timedelta(days=RECONCILE_DAYS)
    summary = PickGradeSummary()
    try:
        # Coarse selector (a naive/aware-safe time bound); the exact window is checked in Python.
        rows = db.execute(
            select(UfcPick, UfcBout)
            .join(UfcBout, UfcBout.id == UfcPick.bout_id)
            .where(or_(
                and_(UfcPick.graded_at.is_(None), UfcBout.status.in_(SETTLED)),
                and_(UfcPick.graded_at.is_not(None), UfcBout.scheduled_utc >= cutoff - timedelta(days=1)),
            ))
            .order_by(UfcBout.id, UfcPick.id)
        ).all()
        for _, group in groupby(rows, key=lambda r: r[1].id):
            items = list(group)
            bout = items[0][1]
            when = utc(bout.scheduled_utc)
            in_window = when is not None and when >= cutoff
            try:
                with db.begin_nested():
                    part = _grade_bout([p for p, _ in items], bout, now, in_window)
            except Exception as exc:  # noqa: BLE001 - one bout must not stop the rest
                summary.failed += 1
                log.warning("ufc picks: a bout failed (%s)", type(exc).__name__)
                continue
            summary.written += part.written
            summary.voided += part.voided
            summary.reset += part.reset
            summary.late += part.late
        db.commit()
    except Exception:
        db.rollback()
        raise
    log.info("ufc picks: %d graded, %d void, %d reset, %d late, %d failed",
             summary.written, summary.voided, summary.reset, summary.late, summary.failed)
    return summary


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--grade", action="store_true", help="grade picks on settled bouts")
    args = ap.parse_args(argv)
    if not args.grade:
        ap.error("pass --grade")

    from app.db import SessionLocal

    db = SessionLocal()
    code = 0
    try:
        grade_picks(db)
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.error("ufc picks: grading failed (%s)", type(exc).__name__)
        code = 1
    finally:
        db.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
