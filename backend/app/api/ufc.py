"""Public UFC card API: GET /api/ufc/events, /events/next, /events/{slug}.

Read-only and public. No model fields (probabilities, odds, ratings, picks)
are exposed until phase 4. Times are always sent with the UTC zone attached
(in-memory SQLite returns timezone-aware columns naive; Postgres does not).

A fighter's record is derived from stored finished card bouts in ONE grouped
statement over a union of the a-side and b-side rows, so a card response costs
a fixed number of queries however many bouts it has (event, bouts, fighters,
records) instead of one query per fighter.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from typing import Iterable, Literal

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import and_, case, func, or_, select, union_all
from sqlalchemy.orm import Session

from app.db import get_db
from app.ufc_rules import is_placeholder_name
from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter
from app.schemas import (
    UfcBoutDetailOut,
    UfcBoutSummaryOut,
    UfcEventRefOut,
    UfcEventDetailOut,
    UfcEventsOut,
    UfcEventSummaryOut,
    UfcFighterBoutOut,
    UfcFighterDetailOut,
    UfcFighterEventOut,
    UfcFighterMiniOut,
    UfcJudgesOut,
    UfcMainEventOut,
    UfcRecordOut,
    UfcOpponentOut,
    UfcResultOut,
    UfcSegmentOut,
    UfcSegmentRefOut,
    UfcStatLineOut,
    UfcStatsOut,
    UfcTapeOut,
    UfcTapeSideOut,
)

router = APIRouter(prefix="/api/ufc", tags=["ufc"])

FEED_CANCELLED = "cancelled by feed"  # must equal pipeline.sports.ufc_ingest.FEED_CANCELLED
UPCOMING_GRACE = timedelta(hours=24)
# What pipeline.sports.ufc_ingest.slugify emits; anything else never reaches the database.
SLUG_PATTERN = r"^[a-z0-9-]+$"


def _utc(dt: datetime | None) -> datetime | None:
    """Attach UTC to SQLite's naive values; normalise aware ones."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def records_for(db: Session, fighter_ids: Iterable[int]) -> dict[int, UfcRecordOut]:
    ids = list(set(fighter_ids))
    if not ids:
        return {}

    def side(fighter_col, me, them):
        return (
            select(
                fighter_col.label("fighter_id"),
                case((UfcBout.winner == me, 1), else_=0).label("w"),
                case((UfcBout.winner == them, 1), else_=0).label("l"),
                case((UfcBout.method == "draw", 1), else_=0).label("d"),
                case((UfcBout.method == "no_contest", 1), else_=0).label("nc"),
            )
            .join(UfcEvent, UfcEvent.id == UfcBout.event_id)
            .where(UfcBout.status == "finished", UfcEvent.is_card.is_(True), fighter_col.in_(ids))
        )

    u = union_all(
        side(UfcBout.fighter_a_id, "a", "b"), side(UfcBout.fighter_b_id, "b", "a")
    ).subquery()
    rows = db.execute(
        select(
            u.c.fighter_id,
            func.sum(u.c.w), func.sum(u.c.l), func.sum(u.c.d), func.sum(u.c.nc),
        ).group_by(u.c.fighter_id)
    )
    return {
        fid: UfcRecordOut(wins=int(w), losses=int(l), draws=int(d), no_contests=int(nc))
        for fid, w, l, d, nc in rows
    }


def fighter_minis(db: Session, fighter_ids: Iterable[int]) -> dict[int, UfcFighterMiniOut]:
    ids = list(set(fighter_ids))
    if not ids:
        return {}
    fighters = db.execute(select(UfcFighter).where(UfcFighter.id.in_(ids))).scalars().all()
    records = records_for(db, ids)
    return {
        f.id: UfcFighterMiniOut(
            slug=f.slug, name=f.name, country=f.country, record=records.get(f.id)
        )
        for f in fighters
    }


def bout_summary(bout: UfcBout, minis: dict[int, UfcFighterMiniOut]) -> UfcBoutSummaryOut:
    result = None
    if bout.status == "finished":
        detail = bout.method_detail
        result = UfcResultOut(
            winner=bout.winner if bout.winner in ("a", "b") else None,
            method=bout.method,
            method_detail=None if detail == FEED_CANCELLED else detail,
            end_round=bout.end_round,
            end_clock=bout.end_clock,
        )
    return UfcBoutSummaryOut(
        id=bout.id,
        card_order=bout.card_order,
        weight_class=bout.weight_class,
        scheduled_rounds=bout.scheduled_rounds,
        is_title=bout.is_title,
        scheduled_utc=_utc(bout.scheduled_utc),
        status=bout.status,
        fighter_a=minis[bout.fighter_a_id],
        fighter_b=minis[bout.fighter_b_id],
        result=result,
    )


def public_card(db: Session, slug: str) -> UfcEvent | None:
    return db.execute(
        select(UfcEvent).where(UfcEvent.slug == slug, UfcEvent.is_card.is_(True))
    ).scalar_one_or_none()


def _order_key(bout: UfcBout) -> tuple:
    return (bout.card_order is None, bout.card_order or 0, bout.id)


def _live_bouts(bouts: Iterable[UfcBout]) -> list[UfcBout]:
    return sorted((b for b in bouts if b.status not in ("cancelled", "changed")), key=_order_key)


def _summary(event: UfcEvent, bouts: list[UfcBout], minis: dict[int, UfcFighterMiniOut]):
    live = _live_bouts(bouts)
    main = None
    if live:
        m = live[0]
        main = UfcMainEventOut(fighter_a=minis[m.fighter_a_id], fighter_b=minis[m.fighter_b_id])
    return dict(
        slug=event.slug,
        name=event.name,
        status=event.status,
        first_bout_utc=_utc(event.first_bout_utc),
        last_bout_utc=_utc(event.last_bout_utc),
        venue=event.venue,
        bout_count=len(live),
        main_event=main,
    )


def _upcoming_where(now: datetime):
    end = func.coalesce(UfcEvent.last_bout_utc, UfcEvent.first_bout_utc)
    return and_(
        UfcEvent.is_card.is_(True),
        UfcEvent.status.in_(("scheduled", "live")),
        or_(end.is_(None), end >= now - UPCOMING_GRACE),
    )


def _past_where(now: datetime):
    end = func.coalesce(UfcEvent.last_bout_utc, UfcEvent.first_bout_utc)
    return and_(
        UfcEvent.is_card.is_(True),
        or_(
            UfcEvent.status == "finished",
            and_(UfcEvent.status.in_(("scheduled", "live")), end < now - UPCOMING_GRACE),
        ),
    )


def _upcoming_order():
    return (
        case((UfcEvent.first_bout_utc.is_(None), 1), else_=0),
        UfcEvent.first_bout_utc.asc(),
        UfcEvent.id.asc(),
    )


def _past_order():
    """Newest first, undated cards last (NULL placement differs between
    SQLite and Postgres, so it is explicit)."""
    return (
        case((UfcEvent.first_bout_utc.is_(None), 1), else_=0),
        UfcEvent.first_bout_utc.desc(),
        UfcEvent.id.desc(),
    )


def _detail(db: Session, event: UfcEvent) -> UfcEventDetailOut:
    bouts = (
        db.execute(
            select(UfcBout).where(UfcBout.event_id == event.id, UfcBout.status != "changed")
        )
        .scalars()
        .all()
    )
    bouts = sorted(bouts, key=_order_key)
    minis = fighter_minis(db, [i for b in bouts for i in (b.fighter_a_id, b.fighter_b_id)])

    groups: dict[str, list[UfcBout]] = {}
    for b in bouts:
        groups.setdefault(b.segment or "other", []).append(b)
    segments = []
    for key, members in groups.items():
        label = next((b.segment_label for b in members if b.segment_label), None)
        times = [_utc(b.scheduled_utc) for b in members if b.scheduled_utc is not None]
        segments.append(
            UfcSegmentOut(
                key=key,
                label=label or ("Fights" if key == "other" else key),
                scheduled_utc=min(times) if times else None,
                bouts=[bout_summary(b, minis) for b in members],
            )
        )
    segments.sort(
        key=lambda s: (
            s.key != "main",
            s.scheduled_utc is None,
            -s.scheduled_utc.timestamp() if s.scheduled_utc else 0,
            s.key,
        )
    )
    return UfcEventDetailOut(**_summary(event, bouts, minis), segments=segments)


@router.get("/events", response_model=UfcEventsOut)
def list_events(
    when: Literal["upcoming", "past"],
    limit: int = Query(20, ge=1, le=50),
    offset: int = Query(0, ge=0, le=10_000),
    db: Session = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    if when == "upcoming":
        stmt = select(UfcEvent).where(_upcoming_where(now)).order_by(*_upcoming_order())
    else:
        stmt = (
            select(UfcEvent)
            .where(_past_where(now))
            .order_by(*_past_order())
        )
    events = db.execute(stmt.limit(limit).offset(offset)).scalars().all()
    if not events:
        return UfcEventsOut(events=[])
    bouts = (
        db.execute(
            select(UfcBout).where(
                UfcBout.event_id.in_([e.id for e in events]), UfcBout.status != "changed"
            )
        )
        .scalars()
        .all()
    )
    by_event: dict[int, list[UfcBout]] = {}
    for b in bouts:
        by_event.setdefault(b.event_id, []).append(b)
    # Only each card's headline bout needs fighters on the list page.
    mains = {e.id: (_live_bouts(by_event.get(e.id, [])) or [None])[0] for e in events}
    minis = fighter_minis(
        db, [i for m in mains.values() if m for i in (m.fighter_a_id, m.fighter_b_id)]
    )
    return UfcEventsOut(
        events=[UfcEventSummaryOut(**_summary(e, by_event.get(e.id, []), minis)) for e in events]
    )


@router.get("/events/next", response_model=UfcEventDetailOut)
def next_event(db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc)
    event = db.execute(
        select(UfcEvent).where(_upcoming_where(now)).order_by(*_upcoming_order()).limit(1)
    ).scalar_one_or_none()
    if event is None:
        event = db.execute(
            select(UfcEvent)
            .where(UfcEvent.is_card.is_(True), UfcEvent.status == "finished")
            .order_by(*_past_order())
            .limit(1)
        ).scalar_one_or_none()
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "no_events", "message": "No UFC cards are loaded yet"},
        )
    return _detail(db, event)


@router.get("/events/{slug}", response_model=UfcEventDetailOut)
def event_detail(
    slug: str = Path(..., max_length=220, pattern=SLUG_PATTERN),
    db: Session = Depends(get_db),
):
    event = public_card(db, slug)
    if event is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "No UFC card with that name"},
        )
    return _detail(db, event)


_STAT_FIELDS = tuple(UfcStatLineOut.model_fields)
INT32_MAX = 2**31 - 1


def age_on(born: date | None, when: datetime) -> int | None:
    """Whole years on the given day."""
    if born is None:
        return None
    day = _utc(when).date()
    return day.year - born.year - ((day.month, day.day) < (born.month, born.day))


def _measure(value: float | None) -> float | None:
    """Stored zeros (older rows) mean unknown."""
    return value if value is not None and value > 0 else None


def _stance(value: str | None) -> str | None:
    """A stance with no letter ("--") means unknown."""
    if value is None or not any(ch.isalpha() for ch in value):
        return None
    return value.strip()


def _tape_side(f: UfcFighter, when: datetime) -> UfcTapeSideOut:
    return UfcTapeSideOut(
        age=age_on(f.date_of_birth, when),
        height_in=_measure(f.height_in),
        reach_in=_measure(f.reach_in),
        stance=_stance(f.stance),
    )


@router.get("/bouts/{bout_id}", response_model=UfcBoutDetailOut)
def bout_detail(bout_id: int, db: Session = Depends(get_db)):
    """One fight. A bout that is still `scheduled` long after its start time is
    served as is (the fight page shows it as scheduled); only fighter histories
    hide such rows. Missing, `changed` and non-card bouts are 404."""
    missing = HTTPException(
        status_code=404, detail={"code": "not_found", "message": "No UFC fight with that id"}
    )
    if not 0 < bout_id <= INT32_MAX:
        raise missing
    bout = db.get(UfcBout, bout_id)
    if bout is None or bout.status == "changed":
        raise missing
    event = db.get(UfcEvent, bout.event_id)
    if event is None or not event.is_card:
        raise missing

    fighters = {
        f.id: f
        for f in db.execute(
            select(UfcFighter).where(UfcFighter.id.in_([bout.fighter_a_id, bout.fighter_b_id]))
        ).scalars()
    }
    records = records_for(db, fighters)
    minis = {
        i: UfcFighterMiniOut(slug=f.slug, name=f.name, country=f.country, record=records.get(i))
        for i, f in fighters.items()
    }
    now = datetime.now(timezone.utc)
    when = _utc(bout.scheduled_utc) or now

    stats = judges = None
    rows = {
        r.fighter_id: r
        for r in db.execute(select(UfcBoutStat).where(UfcBoutStat.bout_id == bout.id)).scalars()
    }
    ra, rb = rows.get(bout.fighter_a_id), rows.get(bout.fighter_b_id)
    if bout.status == "finished" and ra is not None and rb is not None:
        line = lambda r: UfcStatLineOut(**{k: getattr(r, k) for k in _STAT_FIELDS})  # noqa: E731
        stats = UfcStatsOut(a=line(ra), b=line(rb))
    ja = ra.judges if ra is not None else None
    jb = rb.judges if rb is not None else None
    if isinstance(ja, list) and isinstance(jb, list) and ja and jb:
        judges = UfcJudgesOut(a=ja, b=jb)

    key = bout.segment or "other"
    summary = bout_summary(bout, minis)
    return UfcBoutDetailOut(
        **summary.model_dump(),
        event=UfcEventRefOut(
            slug=event.slug, name=event.name, first_bout_utc=_utc(event.first_bout_utc)
        ),
        segment=UfcSegmentRefOut(
            key=key, label=bout.segment_label or ("Fights" if key == "other" else key)
        ),
        tape=UfcTapeOut(
            a=_tape_side(fighters[bout.fighter_a_id], when),
            b=_tape_side(fighters[bout.fighter_b_id], when),
        ),
        stats=stats,
        judges=judges,
    )


def _outcome(bout: UfcBout, me: str) -> str | None:
    """Same rule as records_for; only finished rows have an outcome."""
    if bout.status != "finished":
        return None
    if bout.winner == me:
        return "win"
    if bout.winner in ("a", "b"):
        return "loss"
    if bout.method in ("draw", "no_contest"):
        return bout.method
    return None


@router.get("/fighters/{slug}", response_model=UfcFighterDetailOut)
def fighter_detail(
    slug: str = Path(..., max_length=140, pattern=SLUG_PATTERN),
    db: Session = Depends(get_db),
):
    """One fighter and the card bouts they are on, upcoming first then newest.

    History lists card bouts only (Contender Series excluded), without `changed`
    rows, and without a bout that is still `scheduled` or `live` more than 24
    hours after its start time: the feed never resolved it, and showing it as
    an upcoming fight with a past date would be wrong. Bouts with no start time
    sort first, then newest start time, then newest id (no database-specific
    NULL ordering)."""
    fighter = db.execute(select(UfcFighter).where(UfcFighter.slug == slug)).scalar_one_or_none()
    if fighter is None or is_placeholder_name(fighter.name):
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "No UFC fighter with that name"},
        )
    now = datetime.now(timezone.utc)
    bouts = (
        db.execute(
            select(UfcBout)
            .join(UfcEvent, UfcEvent.id == UfcBout.event_id)
            .where(
                or_(UfcBout.fighter_a_id == fighter.id, UfcBout.fighter_b_id == fighter.id),
                UfcEvent.is_card.is_(True),
                UfcBout.status != "changed",
                or_(
                    UfcBout.status.not_in(("scheduled", "live")),
                    UfcBout.scheduled_utc.is_(None),
                    UfcBout.scheduled_utc >= now - UPCOMING_GRACE,
                ),
            )
            .order_by(
                case((UfcBout.scheduled_utc.is_(None), 0), else_=1),
                UfcBout.scheduled_utc.desc(),
                UfcBout.id.desc(),
            )
        )
        .scalars()
        .all()
    )
    opp_ids = {b.fighter_b_id if b.fighter_a_id == fighter.id else b.fighter_a_id for b in bouts}
    opponents = (
        {f.id: f for f in db.execute(select(UfcFighter).where(UfcFighter.id.in_(opp_ids))).scalars()}
        if opp_ids
        else {}
    )
    event_ids = {b.event_id for b in bouts}
    events = (
        {e.id: e for e in db.execute(select(UfcEvent).where(UfcEvent.id.in_(event_ids))).scalars()}
        if event_ids
        else {}
    )
    out = []
    for b in bouts:
        mine = "a" if b.fighter_a_id == fighter.id else "b"
        opp = opponents[b.fighter_b_id if mine == "a" else b.fighter_a_id]
        ev = events[b.event_id]
        out.append(
            UfcFighterBoutOut(
                id=b.id,
                event=UfcFighterEventOut(
                    slug=ev.slug, name=ev.name, date=_utc(ev.first_bout_utc)
                ),
                opponent=UfcOpponentOut(slug=opp.slug, name=opp.name, country=opp.country),
                outcome=_outcome(b, mine),
                method=b.method if b.status == "finished" else None,
                end_round=b.end_round if b.status == "finished" else None,
                end_clock=b.end_clock if b.status == "finished" else None,
                weight_class=b.weight_class,
                status=b.status,
                scheduled_utc=_utc(b.scheduled_utc),
            )
        )
    return UfcFighterDetailOut(
        slug=fighter.slug,
        name=fighter.name,
        country=fighter.country,
        date_of_birth=fighter.date_of_birth,
        age=age_on(fighter.date_of_birth, now),
        height_in=_measure(fighter.height_in),
        reach_in=_measure(fighter.reach_in),
        stance=_stance(fighter.stance),
        record=records_for(db, [fighter.id]).get(fighter.id),
        bouts=out,
    )
