"""Load UFC history from a provider in one resumable pass (task-6-brief.md).

Meant for the recorded layout (`--raw <dir>`, about 900 events and 9,500 bouts
since 1993) but it only talks to `UfcProvider`. Cards are fetched first and
sorted oldest first by us (never trusting provider order). Per event the card
goes in through `upsert_event`, each bout is handled by
`ufc_results.process_bout` (outcome, stats, odds; the odds of a finished bout
are stamped with its scheduled start, an approximation of the closing line),
the event is rolled up and the transaction commits. Profiles for the event's
fighters are then filled per fighter by `ufc_results.fill_profiles`, so a bad
profile never rolls back results, and a fighter with no usable profile is not
asked again for 30 days. Re-running writes nothing new, so an interrupted run
is simply started again. One event failing (a missing or odd file, a bad row)
is logged without row contents, counted, rolled back and skipped.
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from pipeline.sports.ufc_ingest import IngestSummary, _utc, current_bout, upsert_event
from pipeline.sports.ufc_provider import EventCard, UfcProvider
from pipeline.sports.ufc_recorded import RecordedUfcProvider
from pipeline.sports.ufc_results import fill_profiles, process_bout, roll_up_event

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


def _fetch_cards(
    provider: UfcProvider, start: date, end: date, out: BackfillSummary
) -> list[EventCard]:
    """Every card in the window, oldest first. The order is decided here, not
    by the provider: when two names collide the slug goes to the row created
    first, so a re-run against an empty database must create them in the same
    order."""
    cards: list[EventCard] = []
    for event_id in provider.list_event_ids(start, end):
        try:
            card = provider.fetch_event(event_id)
        except Exception as exc:  # noqa: BLE001 - one bad event must never stop the run
            log.warning("event %s: fetch failed, skipping: %s", event_id, type(exc).__name__)
            log.debug("event %s: fetch failure detail: %s", event_id, exc)
            card = None
        if card is None:
            log.warning("event %s: not available, skipping", event_id)
            out.failed += 1
            continue
        cards.append(card)
    far = datetime.max.replace(tzinfo=timezone.utc)
    cards.sort(key=lambda c: (c.first_bout_utc is None, _utc(c.first_bout_utc) or far, c.provider_id))
    return cards


def _load_event(
    db: Session, provider: UfcProvider, card: EventCard, now: datetime, out: BackfillSummary
) -> set[int]:
    """Write one card and its results in one transaction; returns the fighter
    ids on it. The bout work is `ufc_results.process_bout`, the same code the
    daily job runs."""
    event = upsert_event(db, provider.name, card, now=now, summary=IngestSummary())
    mine = BackfillSummary()
    fighter_ids: set[int] = set()
    for card_bout in card.bouts:
        bout = current_bout(db, provider.name, card_bout.provider_id)
        if bout is None:
            continue
        mine.bouts += 1
        fighter_ids.update((bout.fighter_a_id, bout.fighter_b_id))
        process_bout(
            db, provider, bout, mine, now,
            odds_always=True, odds_taken_at=_utc(bout.scheduled_utc),
        )
    roll_up_event(db, event)
    db.commit()
    out.events += 1
    for name in ("bouts", "finished", "stats", "odds"):
        setattr(out, name, getattr(out, name) + getattr(mine, name))
    return fighter_ids


def backfill(
    db: Session, provider: UfcProvider, start: date, end: date, now: datetime | None = None
) -> BackfillSummary:
    now = now or datetime.now(timezone.utc)
    out = BackfillSummary()
    for card in _fetch_cards(provider, start, end, out):
        out_event = BackfillSummary()
        try:
            fighter_ids = _load_event(db, provider, card, now, out_event)
        except Exception as exc:  # noqa: BLE001 - one bad event must never stop the run
            db.rollback()
            log.warning("event %s: backfill failed, skipping: %s", card.provider_id, type(exc).__name__)
            log.debug("event %s: backfill failure detail: %s", card.provider_id, exc)
            out.failed += 1
            continue
        for name in ("events", "bouts", "finished", "stats", "odds"):
            setattr(out, name, getattr(out, name) + getattr(out_event, name))
        # After the commit and per fighter, so a bad profile never undoes results.
        changed, failed = fill_profiles(
            db, provider, limit=max(len(fighter_ids), 1), now=now, fighter_ids=fighter_ids
        )
        out.fighters += changed
        out.failed += failed
    return out


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw", default=None, help="recorded ESPN directory (default: the configured provider)")
    ap.add_argument("--from", dest="start", type=date.fromisoformat, default=None,
                    help="first event date (default 1993-01-01 with --raw; required without it)")
    ap.add_argument("--to", dest="end", type=date.fromisoformat, default=None)
    args = ap.parse_args(argv)
    if not args.raw and args.start is None:
        ap.error(
            "without --raw a run reads the live feed; a full-history run is about "
            "70,000 requests, so use --raw <dir> or pass --from"
        )
    start = args.start or FIRST_UFC_DATE

    from app.db import SessionLocal
    from pipeline.sports.ufc_provider import get_provider

    now = datetime.now(timezone.utc)
    provider = RecordedUfcProvider(args.raw) if args.raw else get_provider()
    end = args.end or now.date()
    if not args.raw:
        log.warning("ufc backfill: reading the live feed for %s to %s", start, end)
    db = SessionLocal()
    try:
        summary = backfill(db, provider, start, end, now=now)
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
