"""Record UFC results, fight stats, judges' scores and odds (task-5-brief.md).

Cards come from `ufc_ingest`; this module keeps them current. Each run asks the
provider about bouts that should have started (and recently finished bouts whose
stats ESPN posts late), applies the outcome, then stores stats and odds. A
finished result is never reopened or blanked: only another final outcome that
carries a method may change it. A provider answer of None means "not trustworthy
yet" and is simply skipped. One bout failing is counted and rolled back; the
rest carry on, committing per bout.
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter, UfcOddsSnapshot
from pipeline.sports.ufc_ingest import _utc, upsert_fighter
from pipeline.sports.ufc_provider import (
    BoutCard,
    BoutOutcome,
    FighterBoutStats,
    FighterRef,
    OddsLine,
    UfcProvider,
)

log = logging.getLogger(__name__)

STATS_GRACE = timedelta(days=3)
ODDS_HORIZON = timedelta(days=7)
_STAT_FIELDS = (
    "knockdowns", "sig_strikes_landed", "sig_strikes_attempted", "total_strikes_landed",
    "total_strikes_attempted", "takedowns_landed", "takedowns_attempted",
    "submission_attempts", "reversals", "control_seconds",
)
_RESULT_FIELDS = ("winner", "method", "method_detail", "end_round", "end_clock")
_UNTOUCHABLE = ("cancelled", "changed")


@dataclass
class ResultsSummary:
    checked: int = 0
    finished: int = 0
    stats: int = 0
    odds: int = 0
    profiles: int = 0
    failed: int = 0


def apply_outcome(
    db: Session, bout: UfcBout, outcome: BoutOutcome, now: datetime | None = None
) -> bool:
    """Apply a provider outcome to a bout row; True if the row changed."""
    if bout.status in _UNTOUCHABLE or outcome.state == "pre":
        return False
    now = now or datetime.now(timezone.utc)
    changed = False

    def lock() -> bool:
        if bout.locked_at is None:
            bout.locked_at = now
            return True
        return False

    if outcome.state == "live":
        if bout.status == "finished":
            return False
        if bout.status != "live":
            bout.status = "live"
            changed = True
        return lock() or changed

    if outcome.state != "final":
        return False
    if bout.status == "finished" and not outcome.method:
        return False
    new = {
        "winner": outcome.winner, "method": outcome.method,
        "method_detail": outcome.method_detail, "end_round": outcome.round,
        "end_clock": outcome.clock,
    }
    if bout.status != "finished":
        bout.status = "finished"
        changed = True
    for field, value in new.items():
        if getattr(bout, field) != value:
            setattr(bout, field, value)
            changed = True
    return lock() or changed


def record_stats(db: Session, bout: UfcBout, stats: dict[str, FighterBoutStats]) -> int:
    """Upsert one stats row per fighter, keyed by (bout, fighter)."""
    written = 0
    for key, fighter_id in (("a", bout.fighter_a_id), ("b", bout.fighter_b_id)):
        stat = stats.get(key)
        if stat is None:
            continue
        row = db.scalar(
            select(UfcBoutStat).where(
                UfcBoutStat.bout_id == bout.id, UfcBoutStat.fighter_id == fighter_id
            )
        )
        if row is None:
            row = UfcBoutStat(bout_id=bout.id, fighter_id=fighter_id)
            db.add(row)
        for field in _STAT_FIELDS:
            setattr(row, field, getattr(stat, field))
        row.extra = dict(stat.extra) if stat.extra else None
        row.judges = list(stat.judges) if stat.judges else None
        written += 1
    db.flush()
    return written


def record_odds(db: Session, bout: UfcBout, lines: list[OddsLine]) -> int:
    """Store a line when it differs from the latest one for that source, so a
    price moving A, B, A is kept three times; returns the new snapshots."""
    stored = 0
    for line in lines:
        latest = db.scalar(
            select(UfcOddsSnapshot)
            .where(UfcOddsSnapshot.bout_id == bout.id, UfcOddsSnapshot.source == line.source)
            .order_by(UfcOddsSnapshot.taken_at.desc(), UfcOddsSnapshot.id.desc())
            .limit(1)
        )
        if latest is not None and (latest.moneyline_a, latest.moneyline_b) == (
            line.moneyline_a, line.moneyline_b
        ):
            continue
        db.add(UfcOddsSnapshot(
            bout_id=bout.id, source=line.source,
            moneyline_a=line.moneyline_a, moneyline_b=line.moneyline_b,
        ))
        db.flush()
        stored += 1
    return stored


def bout_card(db: Session, bout: UfcBout) -> BoutCard:
    """Rebuild the provider-facing BoutCard from a stored bout row."""
    a, b = db.get(UfcFighter, bout.fighter_a_id), db.get(UfcFighter, bout.fighter_b_id)
    return BoutCard(
        provider_id=bout.provider_bout_id, card_order=bout.card_order, segment=bout.segment,
        segment_label=bout.segment_label, weight_class=bout.weight_class,
        scheduled_rounds=bout.scheduled_rounds, scheduled_utc=_utc(bout.scheduled_utc),
        fighter_a=FighterRef(a.provider_fighter_id, a.name),
        fighter_b=FighterRef(b.provider_fighter_id, b.name),
    )


def ensure_profiles(db: Session, provider: UfcProvider, limit: int = 40) -> int:
    """Fetch profiles for fighters with no date of birth, those with the
    soonest bout first; returns the fighters updated."""
    now = datetime.now(timezone.utc)
    rows = db.execute(
        select(UfcFighter, func.min(UfcBout.scheduled_utc))
        .outerjoin(
            UfcBout,
            ((UfcBout.fighter_a_id == UfcFighter.id) | (UfcBout.fighter_b_id == UfcFighter.id))
            & UfcBout.status.notin_(_UNTOUCHABLE),
        )
        .where(UfcFighter.provider == provider.name, UfcFighter.date_of_birth.is_(None))
        .group_by(UfcFighter.id)
    ).all()

    def soonest(row) -> tuple:
        when = _utc(row[1])
        if when is None:
            return (2, 0.0)
        gap = (when - now).total_seconds()
        return (0, gap) if gap >= 0 else (1, -gap)

    updated = 0
    for fighter, _ in sorted(rows, key=soonest)[:limit]:
        profile = provider.fetch_fighter(fighter.provider_fighter_id)
        if profile is None:
            continue
        upsert_fighter(db, provider.name, FighterRef(fighter.provider_fighter_id, None), profile)
        updated += 1
    db.flush()
    return updated


def roll_up_event(db: Session, event: UfcEvent) -> None:
    statuses = [
        s for s in db.scalars(select(UfcBout.status).where(UfcBout.event_id == event.id))
        if s not in _UNTOUCHABLE
    ]
    done = statuses.count("finished")
    if statuses and done == len(statuses):
        event.status = "finished"
    elif "live" in statuses or done:
        event.status = "live"


def _process_bout(
    db: Session, provider: UfcProvider, event: UfcEvent, bout: UfcBout,
    now: datetime, summary: ResultsSummary,
) -> None:
    card = bout_card(db, bout)
    was_finished = bout.status == "finished"
    outcome = provider.fetch_outcome(event.provider_event_id, card)
    if outcome is not None and apply_outcome(db, bout, outcome, now=now):
        if bout.status == "finished" and not was_finished:
            summary.finished += 1
    if bout.status == "finished":
        summary.stats += record_stats(db, bout, provider.fetch_stats(event.provider_event_id, card))
        summary.odds += record_odds(db, bout, provider.fetch_odds(event.provider_event_id, card))


def _has_stats(db: Session, bout: UfcBout) -> bool:
    return db.scalar(select(UfcBoutStat.id).where(UfcBoutStat.bout_id == bout.id).limit(1)) is not None


def refresh_results(
    db: Session, provider: UfcProvider, now: datetime | None = None
) -> ResultsSummary:
    now = _utc(now) or datetime.now(timezone.utc)
    summary = ResultsSummary()
    due: list[int] = []
    upcoming: list[int] = []
    for bout in db.scalars(select(UfcBout).where(UfcBout.status.in_(("scheduled", "live", "finished")))):
        when = _utc(bout.scheduled_utc)
        if when is None:
            continue
        if bout.status == "finished":
            if now - STATS_GRACE <= when <= now and not _has_stats(db, bout):
                due.append(bout.id)
        elif when <= now:
            due.append(bout.id)
        elif bout.status == "scheduled" and when <= now + ODDS_HORIZON:
            upcoming.append(bout.id)

    touched: set[int] = set()
    for bout_id, results in [(i, True) for i in due] + [(i, False) for i in upcoming]:
        bout = db.get(UfcBout, bout_id)
        event = db.get(UfcEvent, bout.event_id)
        try:
            if results:
                summary.checked += 1
                _process_bout(db, provider, event, bout, now, summary)
            else:
                summary.odds += record_odds(
                    db, bout, provider.fetch_odds(event.provider_event_id, bout_card(db, bout))
                )
            db.commit()
            touched.add(event.id)
        except Exception as exc:  # noqa: BLE001 - one bad bout must never stop the rest
            db.rollback()
            log.warning("bout %s: results failed, skipping: %s", bout_id, exc)
            summary.failed += 1

    try:
        summary.profiles = ensure_profiles(db, provider)
        for event_id in touched:
            roll_up_event(db, db.get(UfcEvent, event_id))
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("profiles / roll-up failed: %s", exc)
        summary.failed += 1
    return summary


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--provider", default=None, help="provider name (default: settings.ufc_provider)")
    args = ap.parse_args()

    from app.db import SessionLocal
    from pipeline.sports.ufc_provider import get_provider

    db = SessionLocal()
    try:
        summary = refresh_results(db, get_provider(args.provider))
    finally:
        db.close()
    log.info(
        "ufc results: checked=%d finished=%d stats=%d odds=%d profiles=%d failed=%d",
        summary.checked, summary.finished, summary.stats, summary.odds, summary.profiles,
        summary.failed,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
