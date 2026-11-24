"""Turn provider fight cards into ufc_* rows (task-4-brief.md).

The ingest talks only to `UfcProvider`, so recorded and live feeds behave the
same. Bout identity is (provider, provider_bout_id, revision): when the feed
swaps a fighter on a scheduled bout we keep the old row (status "changed",
`replaced_by_id` set) and insert revision + 1, so picks and predictions made
against the old pairing stay explainable. Bouts that vanish from a card become
"cancelled", never deleted. Live and finished bouts are never rewritten here;
results, stats and odds belong to the live poller.

ESPN's event feed carries no fighter names, so `upsert_event` (database only)
leaves new fighters named "TBA" and `ingest_window` names them from profile
fetches, capped per run. `upsert_event` may raise; `ingest_window` rolls back
and skips the one event so a bad card cannot stop the rest.
"""
from __future__ import annotations

import argparse
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcEvent, UfcFighter
from pipeline.sports.ufc_provider import (
    BoutCard,
    EventCard,
    FighterProfile,
    FighterRef,
    UfcProvider,
)

log = logging.getLogger(__name__)

TBA = "TBA"
# Fields refreshed from a feed while a bout is still an unlocked "scheduled" one.
_BOUT_FIELDS = (
    "card_order", "segment", "segment_label", "weight_class", "scheduled_rounds",
    "scheduled_utc",
)


@dataclass
class IngestSummary:
    events: int = 0
    bouts_new: int = 0
    bouts_changed: int = 0
    bouts_cancelled: int = 0
    fighters_named: int = 0
    failed: int = 0

    def add(self, other: "IngestSummary") -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))


def slugify(text: str) -> str:
    """ASCII, lower-case, hyphen-separated; an empty result becomes "x"."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "x"


def _utc(dt: datetime | None) -> datetime | None:
    """SQLite hands timezone-aware columns back naive; treat those as UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _fighter_slug(db: Session, name: str, provider_fighter_id: str, own_id: int | None) -> str:
    slug = slugify(name)
    taken = db.scalar(
        select(UfcFighter.id).where(UfcFighter.slug == slug, UfcFighter.id != (own_id or -1))
    )
    return slug if taken is None else f"{slug}-{provider_fighter_id}"


def upsert_fighter(
    db: Session, provider: str, ref: FighterRef, profile: FighterProfile | None = None
) -> UfcFighter:
    """Create or refresh a fighter. A "TBA" fighter is named (and its slug
    recomputed) the first time a name arrives; a named fighter keeps its name
    and slug. Profile attributes overwrite when the profile carries them."""
    fighter = db.scalar(
        select(UfcFighter).where(
            UfcFighter.provider == provider, UfcFighter.provider_fighter_id == ref.provider_id
        )
    )
    name = (profile.name if profile else None) or ref.name
    if fighter is None:
        fighter = UfcFighter(
            provider=provider,
            provider_fighter_id=ref.provider_id,
            name=name or TBA,
            slug=_fighter_slug(db, name or TBA, ref.provider_id, None),
        )
        db.add(fighter)
    elif fighter.name == TBA and name and name != TBA:
        fighter.name = name
        fighter.slug = _fighter_slug(db, name, ref.provider_id, fighter.id)
    if profile is not None:
        for attr in ("date_of_birth", "height_in", "reach_in", "weight_lb", "stance", "country", "gender"):
            value = getattr(profile, attr)
            if value is not None:
                setattr(fighter, attr, value)
    db.flush()
    return fighter


def _event_slug(db: Session, card: EventCard, own_id: int | None, now: datetime) -> str:
    when = _utc(card.first_bout_utc) or _utc(now) or datetime.now(timezone.utc)
    slug = f"{slugify(card.name)}-{when.date().isoformat()}"
    taken = db.scalar(
        select(UfcEvent.id).where(UfcEvent.slug == slug, UfcEvent.id != (own_id or -1))
    )
    return slug if taken is None else f"{slug}-{card.provider_id}"


def current_bout(db: Session, provider: str, provider_bout_id: str) -> UfcBout | None:
    """The highest revision of a bout."""
    return db.scalar(
        select(UfcBout)
        .where(UfcBout.provider == provider, UfcBout.provider_bout_id == provider_bout_id)
        .order_by(UfcBout.revision.desc())
        .limit(1)
    )


def _apply_bout(
    db: Session, provider: str, event: UfcEvent, card: BoutCard, summary: IngestSummary
) -> None:
    a = upsert_fighter(db, provider, card.fighter_a)
    b = upsert_fighter(db, provider, card.fighter_b)
    current = current_bout(db, provider, card.provider_id)

    def new_row(revision: int) -> UfcBout:
        row = UfcBout(
            event_id=event.id, provider=provider, provider_bout_id=card.provider_id,
            revision=revision, fighter_a_id=a.id, fighter_b_id=b.id, status="scheduled",
            **{f: getattr(card, f) for f in _BOUT_FIELDS},
        )
        db.add(row)
        db.flush()
        return row

    if current is None:
        new_row(0)
        summary.bouts_new += 1
    elif (current.fighter_a_id, current.fighter_b_id) == (a.id, b.id):
        if current.locked_at is None and current.status == "scheduled":
            for f in _BOUT_FIELDS:
                setattr(current, f, getattr(card, f))
    elif current.status == "scheduled":
        current.status = "changed"
        successor = new_row(current.revision + 1)
        current.replaced_by_id = successor.id
        summary.bouts_changed += 1
    else:
        log.warning(
            "bout %s is %s; ignoring changed fighters in the feed", card.provider_id, current.status
        )


def upsert_event(
    db: Session,
    provider: str,
    card: EventCard,
    now: datetime | None = None,
    summary: IngestSummary | None = None,
) -> UfcEvent:
    """Write one card (event, fighters, bouts) without committing. `now` only
    dates the slug of an event whose feed has no bout times."""
    summary = summary if summary is not None else IngestSummary()
    now = now or datetime.now(timezone.utc)
    event = db.scalar(
        select(UfcEvent).where(
            UfcEvent.provider == provider, UfcEvent.provider_event_id == card.provider_id
        )
    )
    if event is None:
        event = UfcEvent(
            provider=provider, provider_event_id=card.provider_id, name=card.name,
            slug=_event_slug(db, card, None, now), status="scheduled",
        )
        db.add(event)
    event.name = card.name
    event.first_bout_utc = card.first_bout_utc
    event.last_bout_utc = card.last_bout_utc
    event.venue = card.venue
    event.is_card = card.is_card
    db.flush()

    for bout in card.bouts:
        _apply_bout(db, provider, event, bout, summary)

    on_card = {b.provider_id for b in card.bouts}
    for row in db.scalars(
        select(UfcBout).where(UfcBout.event_id == event.id, UfcBout.status == "scheduled")
    ):
        if row.provider_bout_id not in on_card:
            row.status = "cancelled"
            summary.bouts_cancelled += 1
    db.flush()
    return event


def _name_fighters(
    db: Session, provider: UfcProvider, card: EventCard, budget: int, summary: IngestSummary
) -> int:
    """Fetch profiles for TBA fighters on the card; return the fetches spent."""
    spent = 0
    seen: set[str] = set()
    for bout in card.bouts:
        for ref in (bout.fighter_a, bout.fighter_b):
            if ref.provider_id in seen:
                continue
            seen.add(ref.provider_id)
            fighter = db.scalar(
                select(UfcFighter).where(
                    UfcFighter.provider == provider.name,
                    UfcFighter.provider_fighter_id == ref.provider_id,
                )
            )
            if fighter is None or fighter.name != TBA:
                continue
            if spent >= budget:
                return spent
            spent += 1
            profile = provider.fetch_fighter(ref.provider_id)
            if profile is None:
                continue
            if upsert_fighter(db, provider.name, ref, profile).name != TBA:
                summary.fighters_named += 1
    return spent


def ingest_window(
    db: Session,
    provider: UfcProvider,
    start: date,
    end: date,
    now: datetime | None = None,
    max_profiles: int = 60,
) -> IngestSummary:
    """Ingest every event the provider lists in [start, end], committing per
    event. A missing or failing event counts in `failed` and is skipped."""
    total = IngestSummary()
    budget = max_profiles
    for event_id in provider.list_event_ids(start, end):
        mine = IngestSummary()
        try:
            card = provider.fetch_event(event_id)
            if card is None:
                log.warning("event %s: not available, skipping", event_id)
                total.failed += 1
                continue
            upsert_event(db, provider.name, card, now=now, summary=mine)
            budget -= _name_fighters(db, provider, card, budget, mine)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - one bad event must never stop the rest
            db.rollback()
            log.warning("event %s: ingest failed, skipping: %s", event_id, exc)
            total.failed += 1
            continue
        mine.events = 1
        total.add(mine)
    return total


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days-back", type=int, default=2)
    ap.add_argument("--days-ahead", type=int, default=60)
    ap.add_argument("--max-profiles", type=int, default=60)
    ap.add_argument("--provider", default=None, help="provider name (default: settings.ufc_provider)")
    args = ap.parse_args()

    from app.db import SessionLocal
    from pipeline.sports.ufc_provider import get_provider

    now = datetime.now(timezone.utc)
    today = now.date()
    db = SessionLocal()
    try:
        summary = ingest_window(
            db,
            get_provider(args.provider),
            today - timedelta(days=args.days_back),
            today + timedelta(days=args.days_ahead),
            now=now,
            max_profiles=args.max_profiles,
        )
    finally:
        db.close()
    log.info(
        "ufc ingest: events=%d bouts_new=%d bouts_changed=%d bouts_cancelled=%d "
        "fighters_named=%d failed=%d",
        summary.events, summary.bouts_new, summary.bouts_changed, summary.bouts_cancelled,
        summary.fighters_named, summary.failed,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
