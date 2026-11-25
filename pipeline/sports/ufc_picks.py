"""Grade players' UFC picks once a bout is settled, and again if its result changes.

Scoring is decided by `app.ufc_rules.score_pick`; this module only decides which
picks to look at and writes the outcome. A pick is graded when its bout is settled
(finished, cancelled or changed). A pick created after the lock (the ingest may move
an unlocked bout's start earlier), or for a bout with no lock, is voided, never scored. A void grade is stored as `graded_at` set with NULL
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
from app.ufc_rules import PickScore, lock_time, score_pick, utc
from pipeline.sports.ufc_predict import RECONCILE_DAYS

log = logging.getLogger(__name__)

_VOID = PickScore(None, None, None, True)
SETTLED = ("finished", "cancelled", "changed")


@dataclass
class PickGradeSummary:
    written: int = 0      # rows given a new or changed grade
    voided: int = 0       # of those, void
    reset: int = 0        # grades removed because the bout is no longer settled
    late: int = 0         # of the voided, picks created after the lock (or with no lock)
    failed: int = 0       # bouts whose picks could not be graded this run


def _grade_bout(picks: list[UfcPick], bout: UfcBout, now: datetime, in_window: bool) -> PickGradeSummary:
    out = PickGradeSummary()
    lock = lock_time(bout)
    settled = bout.status in SETTLED
    for pick in picks:
        if pick.graded_at is not None and not in_window:
            continue
        if pick.graded_at is None and not settled:
            continue
        score = score_pick(pick.winner, pick.method, bout) if settled else None
        late = False
        if score is not None and not score.void:
            # The submit rule refuses a pick at `now >= lock`, so a stored pick never has
            # created_at == lock: `>` lock is late, `<=` lock is on time. The ingest can move an
            # unlocked bout's start earlier, so a good-faith pick may land after the real lock;
            # it is voided (never scored: the fight may have started), not left ungraded.
            created = utc(pick.created_at)
            late = lock is None or created is None or created > lock
            if late:
                score = _VOID
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
        out.late += int(late)
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
        summary = grade_picks(db)
        if summary.failed:  # everything that succeeded is already committed
            code = 1
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.error("ufc picks: grading failed (%s)", type(exc).__name__)
        code = 1
    finally:
        db.close()
    return code


if __name__ == "__main__":
    raise SystemExit(main())
