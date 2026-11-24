"""Load UFC history from a provider in one resumable pass (task-6-brief.md).

Meant for the recorded layout (`--raw <dir>`, about 900 events and 9,500 bouts
since 1993) but it only talks to `UfcProvider`. Per event, oldest first: the
card goes in through `upsert_event`, then each bout's outcome, stats and odds
are applied with the same functions the live poller uses, fighters still
missing a date of birth get one profile fetch, the event is rolled up and the
transaction commits. Re-running writes nothing new, so an interrupted run is
simply started again. One event failing (a missing or odd file, a bad row) is
logged without row contents, counted, rolled back and skipped.
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcEvent, UfcFighter
from pipeline.sports.ufc_ingest import IngestSummary, current_bout, upsert_event, upsert_fighter
from pipeline.sports.ufc_provider import FighterRef, UfcProvider
from pipeline.sports.ufc_recorded import RecordedUfcProvider
from pipeline.sports.ufc_results import (
    apply_outcome,
    bout_card,
    record_odds,
    record_stats,
    roll_up_event,
)

log = logging.getLogger(__name__)

FIRST_UFC_DATE = date(1993, 1, 1)


@dataclass
class BackfillSummary:
    events: int = 0
    bouts: int = 0
    finished: int = 0  # bouts newly finished by this run
    stats: int = 0
    odds: int = 0
    fighters: int = 0  # profiles applied
    failed: int = 0


def _fill_profiles(
    db: Session, provider: UfcProvider, event: UfcEvent, tried: set[str]
) -> int:
    """One profile fetch per fighter on this event that has no date of birth.
    `tried` spans the run so a fighter with no usable profile is asked once."""
    ids = set()
    for bout in db.scalars(select(UfcBout).where(UfcBout.event_id == event.id)):
        ids.update((bout.fighter_a_id, bout.fighter_b_id))
    updated = 0
    for fighter in db.scalars(
        select(UfcFighter).where(UfcFighter.id.in_(ids), UfcFighter.date_of_birth.is_(None))
    ).all():
        if fighter.provider_fighter_id in tried:
            continue
        tried.add(fighter.provider_fighter_id)
        profile = provider.fetch_fighter(fighter.provider_fighter_id)
        if profile is None:
            continue
        upsert_fighter(
            db, provider.name, FighterRef(fighter.provider_fighter_id, None), profile
        )
        updated += 1
    return updated


def _backfill_event(
    db: Session, provider: UfcProvider, event_id: str, now: datetime, tried: set[str],
    out: BackfillSummary,
) -> bool:
    card = provider.fetch_event(event_id)
    if card is None:
        log.warning("event %s: not available, skipping", event_id)
        return False
    event = upsert_event(db, provider.name, card, now=now, summary=IngestSummary())
    mine = BackfillSummary()
    for card_bout in card.bouts:
        bout = current_bout(db, provider.name, card_bout.provider_id)
        if bout is None:
            continue
        mine.bouts += 1
        # Rebuilt from the stored row so "a" / "b" follow the stored order.
        rebuilt = bout_card(db, bout)
        was_finished = bout.status == "finished"
        outcome = provider.fetch_outcome(event_id, rebuilt)
        if outcome is not None:
            apply_outcome(db, bout, outcome, now=now)
        if bout.status == "finished" and not was_finished:
            mine.finished += 1
        if bout.status == "finished":
            mine.stats += record_stats(db, bout, provider.fetch_stats(event_id, rebuilt))
        mine.odds += record_odds(db, bout, provider.fetch_odds(event_id, rebuilt))
    mine.fighters = _fill_profiles(db, provider, event, tried)
    roll_up_event(db, event)
    db.commit()
    out.events += 1
    for name in ("bouts", "finished", "stats", "odds", "fighters"):
        setattr(out, name, getattr(out, name) + getattr(mine, name))
    return True


def backfill(
    db: Session, provider: UfcProvider, start: date, end: date, now: datetime | None = None
) -> BackfillSummary:
    now = now or datetime.now(timezone.utc)
    out = BackfillSummary()
    tried: set[str] = set()
    for event_id in provider.list_event_ids(start, end):
        try:
            if not _backfill_event(db, provider, event_id, now, tried, out):
                out.failed += 1
        except Exception as exc:  # noqa: BLE001 - one bad event must never stop the run
            db.rollback()
            log.warning("event %s: backfill failed, skipping: %s", event_id, type(exc).__name__)
            out.failed += 1
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", default=None, help="recorded ESPN directory (default: the configured provider)")
    ap.add_argument("--from", dest="start", type=date.fromisoformat, default=FIRST_UFC_DATE)
    ap.add_argument("--to", dest="end", type=date.fromisoformat, default=None)
    args = ap.parse_args()

    from app.db import SessionLocal
    from pipeline.sports.ufc_provider import get_provider

    now = datetime.now(timezone.utc)
    provider = RecordedUfcProvider(args.raw) if args.raw else get_provider()
    db = SessionLocal()
    try:
        summary = backfill(db, provider, args.start, args.end or now.date(), now=now)
    finally:
        db.close()
    log.info(
        "ufc backfill: events=%d bouts=%d finished=%d stats=%d odds=%d fighters=%d failed=%d",
        summary.events, summary.bouts, summary.finished, summary.stats, summary.odds,
        summary.fighters, summary.failed,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
