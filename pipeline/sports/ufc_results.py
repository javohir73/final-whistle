"""Record UFC results, fight stats, judges' scores and odds (task-5-brief.md).

Cards come from `ufc_ingest`; this module keeps them current. Each run asks the
provider about bouts that should have started (and recently finished bouts whose
stats ESPN posts late), applies the outcome, then stores stats and odds. A
finished result is never reopened or blanked: only another final outcome that
carries a method may change it. A provider answer of None means "not trustworthy
yet" and is simply skipped. A "cancelled" outcome (the feed's cancelled
bout; a postponed bout reads as "pre" and is left scheduled) cancels a
scheduled or live row and marks it with `method_detail = FEED_CANCELLED`, which
card ingest reads so it does not reinstate the bout just because the card still
lists it; ingest returns it to "scheduled" only when the feed itself says "pre"
again. One bout failing is counted and rolled back; the rest carry on,
committing per bout. `bouts_failed` counts failures of due (results) bouts
only and drives the exit code, so a quiet day with a failed odds or profile
step stays green.
"""
from __future__ import annotations

import argparse
import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter, UfcOddsSnapshot
from pipeline.sports.ufc_ingest import FEED_CANCELLED, _clip, _utc, lock_if_started, upsert_fighter
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
_NO_WINNER_METHODS = ("draw", "no_contest")
PROFILE_RECHECK = timedelta(days=30)
PROFILE_HORIZON = timedelta(days=60)  # refresh_results only profiles fighters with a bout this soon
# A scheduled or live bout older than this that the feed never finalised is
# left alone rather than fetched twice a day for ever.
RESULTS_LOOKBACK = timedelta(days=14)


@dataclass
class ResultsSummary:
    checked: int = 0
    finished: int = 0
    stats: int = 0
    odds: int = 0
    profiles: int = 0
    failed: int = 0
    bouts_failed: int = 0  # failures of due (results) bouts only


def apply_outcome(
    db: Session, bout: UfcBout, outcome: BoutOutcome, now: datetime | None = None
) -> bool:
    """Apply a provider outcome to a bout row; True if the row changed. A
    cancelled outcome sets a scheduled or live row to "cancelled" with
    `method_detail = FEED_CANCELLED` (stamping `locked_at` first when the start
    has passed); finished, cancelled and changed rows are never touched by it.
    Text is clipped to the column lengths."""
    if bout.status in _UNTOUCHABLE or outcome.state == "pre":
        return False
    now = now or datetime.now(timezone.utc)
    if outcome.state == "cancelled":
        if bout.status not in ("scheduled", "live"):
            return False
        lock_if_started(bout, now)  # a fight cancelled after its start stays locked if it returns
        bout.status = "cancelled"
        bout.method_detail = FEED_CANCELLED
        return True
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
    new = {
        "winner": outcome.winner, "method": _clip(outcome.method, 20),
        "method_detail": _clip(outcome.method_detail, 120), "end_round": outcome.round,
        "end_clock": _clip(outcome.clock, 8),
    }
    if bout.status == "finished":
        if not outcome.method:
            return False
        if outcome.winner is None and outcome.method not in _NO_WINNER_METHODS:
            log.warning(
                "bout %s: refusing a later final with no winner (method %s) over %s/%s",
                bout.provider_bout_id, outcome.method, bout.winner, bout.method,
            )
            return False
        for field in ("end_round", "end_clock", "method_detail"):
            if new[field] is None:
                new[field] = getattr(bout, field)
        if (new["winner"], new["method"]) != (bout.winner, bout.method):
            log.warning(
                "bout %s: later final changes result %s/%s -> %s/%s",
                bout.provider_bout_id, bout.winner, bout.method, new["winner"], new["method"],
            )
    else:
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


def record_odds(
    db: Session, bout: UfcBout, lines: list[OddsLine], taken_at: datetime | None = None
) -> int:
    """Store a line when it differs from the latest one for that source, so a
    price moving A, B, A is kept three times; returns the new snapshots.
    `taken_at` defaults to the database's now. For backfilled history the
    caller passes the bout's scheduled start, an approximation of the closing
    line, so an old fight is not stamped with the load date."""
    stored = 0
    for line in lines:
        latest = db.scalar(
            select(UfcOddsSnapshot)
            .where(UfcOddsSnapshot.bout_id == bout.id, UfcOddsSnapshot.source == _clip(line.source, 40))
            .order_by(UfcOddsSnapshot.taken_at.desc(), UfcOddsSnapshot.id.desc())
            .limit(1)
        )
        if latest is not None and (latest.moneyline_a, latest.moneyline_b) == (
            line.moneyline_a, line.moneyline_b
        ):
            continue
        snapshot = UfcOddsSnapshot(
            bout_id=bout.id, source=_clip(line.source, 40),
            moneyline_a=line.moneyline_a, moneyline_b=line.moneyline_b,
        )
        if taken_at is not None:
            snapshot.taken_at = taken_at
        db.add(snapshot)
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


_PROFILE_FIELDS = (
    "name", "date_of_birth", "height_in", "reach_in", "weight_lb", "stance", "country", "gender"
)


def ensure_profiles(
    db: Session, provider: UfcProvider, limit: int = 40, now: datetime | None = None
) -> int:
    """Returns the fighters updated; see `fill_profiles`."""
    return fill_profiles(db, provider, limit, now)[0]


def fill_profiles(
    db: Session,
    provider: UfcProvider,
    limit: int = 40,
    now: datetime | None = None,
    fighter_ids: set[int] | None = None,
) -> tuple[int, int]:
    """Fetch profiles for fighters with no date of birth that were not checked
    in the last 30 days, soonest bout (relative to `now`) first. Every attempt,
    even one that returns nothing, stamps `profile_checked_at`. Commits per
    fighter; a failing fighter is rolled back and skipped. Returns (fighters
    whose data really changed, failures). `fighter_ids` restricts the
    candidates to those fighters (the history backfill passes one event's)."""
    now = _utc(now) or datetime.now(timezone.utc)
    query = (
        select(UfcFighter, func.min(UfcBout.scheduled_utc))
        .outerjoin(
            UfcBout,
            ((UfcBout.fighter_a_id == UfcFighter.id) | (UfcBout.fighter_b_id == UfcFighter.id))
            & UfcBout.status.notin_(_UNTOUCHABLE),
        )
        .where(UfcFighter.provider == provider.name, UfcFighter.date_of_birth.is_(None))
        .group_by(UfcFighter.id)
    )
    if fighter_ids is not None:
        query = query.where(UfcFighter.id.in_(fighter_ids))  # filtered in SQL
    rows = db.execute(query).all()

    def soonest(row) -> tuple:
        when = _utc(row[1])
        if when is None:
            return (2, 0.0)
        gap = (when - now).total_seconds()
        return (0, gap) if gap >= 0 else (1, -gap)

    candidates = [
        (f, w) for f, w in rows
        if (f.profile_checked_at is None or _utc(f.profile_checked_at) <= now - PROFILE_RECHECK)
    ]
    updated = failed = 0
    for fighter, _ in sorted(candidates, key=soonest)[:limit]:
        fighter_id, provider_id = fighter.id, fighter.provider_fighter_id
        try:
            profile = provider.fetch_fighter(provider_id)
            before = {f: getattr(fighter, f) for f in _PROFILE_FIELDS}
            if profile is not None:
                upsert_fighter(db, provider.name, FighterRef(provider_id, None), profile)
            fighter.profile_checked_at = now
            changed = any(getattr(fighter, f) != v for f, v in before.items())
            db.commit()
        except Exception as exc:  # noqa: BLE001 - one bad fighter must never stop the rest
            db.rollback()
            log.warning("fighter %s: profile failed, skipping: %s", fighter_id, type(exc).__name__)
            log.debug("fighter %s: profile failure detail: %s", fighter_id, exc)
            failed += 1
            continue
        updated += changed
    return updated, failed


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


def process_bout(
    db: Session,
    provider: UfcProvider,
    bout: UfcBout,
    summary,
    now: datetime,
    odds_always: bool = False,
    odds_taken_at: datetime | None = None,
) -> None:
    """Fetch and apply one bout's outcome, then (once it is finished) its stats
    and odds. `summary` is anything with finished / stats / odds counters.
    `odds_always` also records odds for a bout that has not finished;
    `odds_taken_at` stamps the snapshot of a finished bout (history loads).
    Does not commit."""
    event = db.get(UfcEvent, bout.event_id)
    card = bout_card(db, bout)
    was_finished = bout.status == "finished"
    outcome = provider.fetch_outcome(event.provider_event_id, card)
    if outcome is not None and apply_outcome(db, bout, outcome, now=now):
        if bout.status == "finished" and not was_finished:
            summary.finished += 1
    finished = bout.status == "finished"
    if finished:
        summary.stats += record_stats(db, bout, provider.fetch_stats(event.provider_event_id, card))
    if finished or odds_always:
        summary.odds += record_odds(
            db, bout, provider.fetch_odds(event.provider_event_id, card),
            taken_at=odds_taken_at if finished else None,
        )


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
        elif now - RESULTS_LOOKBACK <= when <= now:
            due.append(bout.id)
        elif bout.status == "scheduled" and now < when <= now + ODDS_HORIZON:
            upcoming.append(bout.id)

    touched: set[int] = set()
    for bout_id, results in [(i, True) for i in due] + [(i, False) for i in upcoming]:
        bout = db.get(UfcBout, bout_id)
        event = db.get(UfcEvent, bout.event_id)
        try:
            if results:
                summary.checked += 1
                process_bout(db, provider, bout, summary, now)
            else:
                summary.odds += record_odds(
                    db, bout, provider.fetch_odds(event.provider_event_id, bout_card(db, bout))
                )
            db.commit()
            touched.add(event.id)
        except Exception as exc:  # noqa: BLE001 - one bad bout must never stop the rest
            db.rollback()
            log.warning("bout %s: results failed, skipping: %s", bout_id, type(exc).__name__)
            log.debug("bout %s: results failure detail: %s", bout_id, exc)
            summary.failed += 1
            if results:
                summary.bouts_failed += 1

    try:
        stale = db.scalars(
            select(UfcEvent).where(
                UfcEvent.status != "finished",
                (UfcEvent.first_bout_utc >= now - RESULTS_LOOKBACK) | UfcEvent.id.in_(touched),
                UfcEvent.id.in_(
                    select(UfcBout.event_id).where(
                        UfcBout.scheduled_utc.is_not(None),
                        UfcBout.status.notin_(_UNTOUCHABLE),
                    )
                ),
            )
        ).all()
        started = {
            e for e in db.scalars(select(UfcBout.event_id).where(UfcBout.scheduled_utc <= now))
        }
        for event in stale:
            if event.id in touched or event.id in started:
                roll_up_event(db, event)
        db.commit()
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        log.warning("event roll-up failed: %s", type(exc).__name__)
        log.debug("event roll-up failure detail: %s", exc)
        summary.failed += 1

    # Only fighters with a live bout nearby: a retired fighter with no birth date
    # would otherwise be re-fetched every 30 days for ever.
    lo, hi = now - RESULTS_LOOKBACK, now + PROFILE_HORIZON
    in_window = (
        UfcBout.status.notin_(_UNTOUCHABLE),
        UfcBout.scheduled_utc >= lo,
        UfcBout.scheduled_utc <= hi,
    )
    near = set(db.scalars(select(UfcBout.fighter_a_id).where(*in_window))) | set(
        db.scalars(select(UfcBout.fighter_b_id).where(*in_window))
    )
    summary.profiles, profile_failures = fill_profiles(db, provider, 40, now, fighter_ids=near)
    summary.failed += profile_failures
    return summary


def main(argv: list[str] | None = None) -> int:
    """Exit 1 only when a due bout failed and none succeeded (`bouts_failed > 0`
    and `bouts_failed >= checked`). Odds, roll-up and profile failures never
    turn a quiet day red; they show in the `failed` count of the log line."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--provider", default=None, help="provider name (default: settings.ufc_provider)")
    args = ap.parse_args(argv)

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
    return 1 if summary.bouts_failed > 0 and summary.bouts_failed >= summary.checked else 0


if __name__ == "__main__":
    raise SystemExit(main())
