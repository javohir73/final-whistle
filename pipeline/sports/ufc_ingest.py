"""Turn provider fight cards into ufc_* rows (task-4-brief.md).

The ingest talks only to `UfcProvider`, so recorded and live feeds behave the
same. Bout identity is (provider, provider_bout_id, revision): when the feed
swaps a fighter on a scheduled bout we keep the old row (status "changed",
`replaced_by_id` set) and insert revision + 1, so picks and predictions made
against the old pairing stay explainable. Bouts that vanish from a card become
"cancelled", never deleted. Live and finished bouts are never rewritten here;
results, stats and odds belong to the live poller. A bout the results run
cancelled because the feed reported it cancelled carries
`method_detail == FEED_CANCELLED`; `upsert_event` leaves such a row cancelled
even though the card still lists it (a bout dropped from the card by this
module is a different case and is reinstated when it returns). A postponed
bout is not cancelled by the feed at all. `reinstate_feed_cancelled` is the way
back for a feed-cancelled bout: when it is still unlocked, has the same
fighters and a future start, and the provider now says its state is "pre", it
returns to "scheduled" with the card's current fields. `ingest_window` calls
it per event; `upsert_event` stays database-only.

A lock never reopens: when the ingest's clock reaches a scheduled bout's stored
start, `upsert_event` stamps `locked_at = scheduled_utc` and stops moving that
bout's time. A time moved before the start still moves. A bout the sweep cancelled
(it merely vanished from a snapshot) is stamped the same way when its start passed
while it was away; when it returns after that start it comes back "scheduled" and
LOCKED, with its stored `scheduled_utc` and `locked_at` untouched and none of the
card's fields applied: picks stay closed, and the results step can finish it. A bout
the FEED cancelled (`method_detail == FEED_CANCELLED`) stays cancelled when locked,
and an unlocked cancelled bout with a future start is reinstated with the card's
fields. When
the opponent changes, the old row becomes "changed" and a new row is created with the
card's time and no lock, even if the old start had passed: it is a different fight with
a new id, picks on the old row are void, and a start already in the past locks the new
row by its own time.

Feed text is clipped (`_clip`) to the model's column lengths where it is
assigned: SQLite ignores String(n) but Postgres rejects an over-long value.

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
FEED_CANCELLED = "cancelled by feed"  # method_detail marker set by ufc_results.apply_outcome
PROFILE_RETRY = timedelta(hours=24)  # a fighter profile fetched within this is not asked for again
# Fields refreshed from a feed while a bout is still an unlocked "scheduled" one.
_PROFILE_LIMITS = {"stance": 20, "country": 60, "gender": 10}
_BOUT_LIMITS = {"segment": 20, "segment_label": 40, "weight_class": 60}
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
    bouts_reinstated: int = 0
    fighters_named: int = 0
    failed: int = 0

    def add(self, other: "IngestSummary") -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))


def slugify(text: str) -> str:
    """ASCII, lower-case, hyphen-separated; an empty result becomes "x"."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-") or "x"


def _clip(value: str | None, limit: int) -> str | None:
    """Truncate feed text to a column's length (None stays None)."""
    return value[:limit] if value is not None else None


def _utc(dt: datetime | None) -> datetime | None:
    """SQLite hands timezone-aware columns back naive; treat those as UTC."""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _fighter_slug(db: Session, name: str, provider_fighter_id: str, own_id: int | None) -> str:
    slug = _clip(slugify(name), 140)
    taken = db.scalar(
        select(UfcFighter.id).where(UfcFighter.slug == slug, UfcFighter.id != (own_id or -1))
    )
    if taken is None:
        return slug
    suffix = f"-{provider_fighter_id}"
    return _clip(slugify(name), 140 - len(suffix)) + suffix


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
    name = _clip((profile.name if profile else None) or ref.name, 120)
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
            if attr in _PROFILE_LIMITS:
                value = _clip(value, _PROFILE_LIMITS[attr])
            if value is not None:
                setattr(fighter, attr, value)
    db.flush()
    return fighter


def _event_slug(db: Session, card: EventCard, own_id: int | None, now: datetime) -> str:
    when = _utc(card.first_bout_utc) or _utc(now) or datetime.now(timezone.utc)
    day = when.date().isoformat()
    base = _clip(slugify(card.name), 200 - len(day) - 1)  # keep the room the date needs
    slug = f"{base}-{day}"
    taken = db.scalar(
        select(UfcEvent.id).where(UfcEvent.slug == slug, UfcEvent.id != (own_id or -1))
    )
    if taken is None:
        return slug
    suffix = f"-{card.provider_id}"
    return _clip(slug, 220 - len(suffix)) + suffix


def current_bout(db: Session, provider: str, provider_bout_id: str) -> UfcBout | None:
    """The highest revision of a bout."""
    return db.scalar(
        select(UfcBout)
        .where(UfcBout.provider == provider, UfcBout.provider_bout_id == provider_bout_id)
        .order_by(UfcBout.revision.desc())
        .limit(1)
    )


def _bout_values(card: BoutCard) -> dict:
    """The card fields of a bout, text clipped to the column lengths."""
    return {
        f: _clip(getattr(card, f), _BOUT_LIMITS[f]) if f in _BOUT_LIMITS else getattr(card, f)
        for f in _BOUT_FIELDS
    }


def lock_if_started(row: UfcBout, now: datetime) -> None:
    """Stamp `locked_at = scheduled_utc` when `now` has reached the stored start and the
    row is not locked yet, so a bout cancelled after its start can never come back
    open. A row with no stored start gets no stamp."""
    start = _utc(row.scheduled_utc)
    if row.locked_at is None and start is not None and _utc(now) >= start:
        row.locked_at = row.scheduled_utc


def _apply_bout(
    db: Session, provider: str, event: UfcEvent, card: BoutCard, summary: IngestSummary, now: datetime
) -> None:
    """Write one bout of a card. `now` is the ingest's own clock: once it has reached
    a scheduled bout's stored start, the bout is locked for good (`locked_at` is
    stamped with that start) and the card's fields, its time included, are not
    applied, so a later time can never reopen picks. A time moved before the start
    still moves."""
    a = upsert_fighter(db, provider, card.fighter_a)
    b = upsert_fighter(db, provider, card.fighter_b)
    current = current_bout(db, provider, card.provider_id)

    def new_row(revision: int) -> UfcBout:
        row = UfcBout(
            event_id=event.id, provider=provider, provider_bout_id=card.provider_id,
            revision=revision, fighter_a_id=a.id, fighter_b_id=b.id, status="scheduled",
            **_bout_values(card),
        )
        db.add(row)
        db.flush()
        return row

    if current is None:
        new_row(0)
        summary.bouts_new += 1
        return
    # The pair is unordered and the stored a/b order never changes: picks and
    # probabilities are stored as "a" / "b" for the life of the row.
    same_pair = {current.fighter_a_id, current.fighter_b_id} == {a.id, b.id}
    values = _bout_values(card)
    if same_pair and current.status == "scheduled" and current.locked_at is None:
        start = _utc(current.scheduled_utc)
        if start is not None and _utc(now) >= start:
            current.locked_at = current.scheduled_utc  # sticky: the start has passed
        else:
            for f, v in values.items():
                setattr(current, f, v)
    elif same_pair and current.status == "cancelled" and current.method_detail == FEED_CANCELLED:
        log.info("bout %s was cancelled by the feed; not reinstating", card.provider_id)
    elif same_pair and current.status == "cancelled":
        lock_if_started(current, now)  # its old start passed while it was away: stays locked
        if current.locked_at is None:
            for f, v in values.items():
                setattr(current, f, v)
            current.status = "scheduled"
            summary.bouts_reinstated += 1
        elif (start := _utc(current.scheduled_utc)) is not None and start <= _utc(now):
            # Dropped from a snapshot (not cancelled by the feed) and back after its start: the
            # fight happened, so it returns locked with its stored time and no card fields, and
            # the results step can finish it.
            current.status = "scheduled"
            summary.bouts_reinstated += 1
        else:
            log.warning("bout %s is cancelled and locked; not reinstating", card.provider_id)
    elif not same_pair and current.status in ("scheduled", "cancelled"):
        if current.status == "scheduled":
            current.status = "changed"
        successor = new_row(current.revision + 1)
        current.replaced_by_id = successor.id
        pairs = [
            {r.fighter_a_id, r.fighter_b_id}
            for r in db.scalars(
                select(UfcBout).where(
                    UfcBout.provider == provider, UfcBout.provider_bout_id == card.provider_id
                )
            )
        ]
        if pairs.count({a.id, b.id}) > 1:  # the feed flipped back to an earlier pairing
            log.warning(
                "bout %s: a new revision repeats an earlier fighter pairing (%d revisions)",
                card.provider_id, len(pairs),
            )
        summary.bouts_changed += 1
    elif not same_pair:
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
    """Write one card (event, fighters, bouts) without committing. `now` (the
    ingest's clock) dates the slug of an event whose feed has no bout times and
    decides when a scheduled bout locks: at or after its stored start it gets
    `locked_at = scheduled_utc` and the card's fields are not applied.

    Once a bout is locked or no longer "scheduled", none of its card fields
    are updated (a cancelled, unlocked bout back on the card is reinstated,
    unless a results run cancelled it for the feed: `method_detail ==
    FEED_CANCELLED`).
    A card with no bouts is treated as a bad snapshot: nothing is cancelled."""
    summary = summary if summary is not None else IngestSummary()
    now = now or datetime.now(timezone.utc)
    event = db.scalar(
        select(UfcEvent).where(
            UfcEvent.provider == provider, UfcEvent.provider_event_id == card.provider_id
        )
    )
    if event is None:
        event = UfcEvent(
            provider=provider, provider_event_id=card.provider_id, name=_clip(card.name, 200),
            slug=_event_slug(db, card, None, now), status="scheduled",
        )
        db.add(event)
    event.name = _clip(card.name, 200)
    event.first_bout_utc = card.first_bout_utc
    event.last_bout_utc = card.last_bout_utc
    event.venue = _clip(card.venue, 160)
    event.is_card = card.is_card
    db.flush()

    for bout in card.bouts:
        _apply_bout(db, provider, event, bout, summary, now)

    if not card.bouts:
        log.warning("event %s (%s): card has no bouts; skipping cancellation sweep", card.provider_id, card.name)
        db.flush()
        return event
    on_card = {b.provider_id for b in card.bouts}
    for row in db.scalars(
        select(UfcBout).where(UfcBout.event_id == event.id, UfcBout.status == "scheduled")
    ):
        if row.provider_bout_id not in on_card:
            lock_if_started(row, now)
            row.status = "cancelled"
            summary.bouts_cancelled += 1
    db.flush()
    return event


def reinstate_feed_cancelled(
    db: Session, provider: UfcProvider, card: EventCard, now: datetime, summary: IngestSummary
) -> int:
    """Return feed-cancelled bouts the feed now reports as "pre" to "scheduled";
    the number of rows returned. Only an unlocked row with the same fighter
    pair and a card start later than `now` is asked about. Does not commit."""
    now = _utc(now)
    returned = 0
    for bout in card.bouts:
        current = current_bout(db, provider.name, bout.provider_id)
        if (
            current is None
            or current.status != "cancelled"
            or current.method_detail != FEED_CANCELLED
            or current.locked_at is not None
        ):
            continue
        lock_if_started(current, now)  # its old start passed while it was away: stays locked
        if current.locked_at is not None:
            continue
        fighters = {
            f.provider_fighter_id
            for f in (db.get(UfcFighter, current.fighter_a_id), db.get(UfcFighter, current.fighter_b_id))
        }
        if fighters != {bout.fighter_a.provider_id, bout.fighter_b.provider_id}:
            continue
        start = _utc(bout.scheduled_utc)
        if start is None or start <= now:
            continue
        outcome = provider.fetch_outcome(card.provider_id, bout)
        if outcome is None or outcome.state != "pre":
            continue
        for f, v in _bout_values(bout).items():
            setattr(current, f, v)
        current.status = "scheduled"
        current.method_detail = None
        summary.bouts_reinstated += 1
        returned += 1
    db.flush()
    return returned


def _name_fighters(
    db: Session,
    provider: UfcProvider,
    card: EventCard,
    budget: int,
    summary: IngestSummary,
    now: datetime | None = None,
) -> int:
    """Fetch profiles for TBA fighters on the card; return the fetches spent.
    Every attempt, even one that returns nothing, stamps `profile_checked_at`,
    and a fighter stamped within the last 24 hours is not asked for again."""
    now = _utc(now) or datetime.now(timezone.utc)
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
            checked = _utc(fighter.profile_checked_at)
            if checked is not None and checked > now - PROFILE_RETRY:
                continue
            if spent >= budget:
                return spent
            spent += 1
            profile = provider.fetch_fighter(ref.provider_id)
            fighter.profile_checked_at = now
            if profile is not None and upsert_fighter(db, provider.name, ref, profile).name != TBA:
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
            reinstate_feed_cancelled(
                db, provider, card, _utc(now) or datetime.now(timezone.utc), mine
            )
            budget -= _name_fighters(db, provider, card, budget, mine, now)
            db.commit()
        except Exception as exc:  # noqa: BLE001 - one bad event must never stop the rest
            db.rollback()
            log.warning("event %s: ingest failed, skipping: %s", event_id, type(exc).__name__)
            log.debug("event %s: ingest failure detail: %s", event_id, exc)
            total.failed += 1
            continue
        mine.events = 1
        total.add(mine)
    return total


def main(argv: list[str] | None = None) -> int:
    """Exit 1 when every event failed (some failed and none were ingested)."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--days-back", type=int, default=2)
    ap.add_argument("--days-ahead", type=int, default=60)
    ap.add_argument("--max-profiles", type=int, default=60)
    ap.add_argument("--provider", default=None, help="provider name (default: settings.ufc_provider)")
    args = ap.parse_args(argv)

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
    return 1 if summary.failed > 0 and summary.events == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
