"""Is the data we're serving actually current?

The refresh going green is not the same as the data being fresh, and the
pre-season incident proved it: the api-sports allowance ran out, nothing was
ingested for weeks, and every dashboard stayed green because nothing *errored*
— there was simply no new data. Liveness monitoring can't see that. This module
is the detector that can.

Both checks key off one fact the database already knows: **a match has an
expected end.** Football's longest plausible fixture is 90' + ~15' half-time +
stoppage, or ~120' + a shootout in a knockout — call it three hours, and give
it a further hour of slack. Past that bound:

* a row still ``in_play`` is impossible — nobody is still playing, so the feed
  that should have finished it has stopped reaching us (the finality check);
* a row still ``scheduled`` is equally impossible — it kicked off and we never
  heard (the freshness check).

Neither needs a schema change, a provider call, or a new column to write, so
this runs safely inside /api/health on a request path. Deliberately imports
only app.models, matching app/chain_status.py's note about staying importable
without pulling the pipeline in.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.models import Match, Tournament

#: Hours after kickoff past which a match cannot still be running. 90' + HT +
#: stoppage is ~2h; extra time and penalties push a knockout to ~3h. The extra
#: hour is slack for a late kickoff the provider never corrected, so this fires
#: on a stuck feed rather than on a long match.
MATCH_MAX_DURATION_HOURS = 4.0

#: Statuses that must not outlive MATCH_MAX_DURATION_HOURS past kickoff.
_UNFINISHED = ("in_play", "scheduled")


def _horizon(now: datetime | None, grace_hours: float) -> tuple[datetime, datetime]:
    now = now or datetime.now(timezone.utc)
    return now, now - timedelta(hours=grace_hours)


def stuck_matches(
    db: Session,
    *,
    now: datetime | None = None,
    grace_hours: float = MATCH_MAX_DURATION_HOURS,
    limit: int = 20,
) -> list[dict]:
    """Matches whose kickoff is far enough in the past that their current
    status is impossible.

    Returns one dict per offending row — id, competition, status, kickoff and
    how many hours overdue — so an alert can name the league that broke rather
    than just asserting that something did.
    """
    _now, cutoff = _horizon(now, grace_hours)
    rows = (
        db.query(Match, Tournament.name)
        .join(Tournament, Match.tournament_id == Tournament.id, isouter=True)
        .filter(
            Match.status.in_(_UNFINISHED),
            Match.kickoff_utc.isnot(None),
            Match.kickoff_utc < cutoff,
        )
        .order_by(Match.kickoff_utc.asc())
        .limit(limit)
        .all()
    )
    out: list[dict] = []
    for match, competition in rows:
        kickoff = match.kickoff_utc
        # SQLite hands back naive datetimes; Postgres returns aware ones.
        if kickoff is not None and kickoff.tzinfo is None:
            kickoff = kickoff.replace(tzinfo=timezone.utc)
        out.append({
            "match_id": match.id,
            "competition": competition,
            "status": match.status,
            "kickoff_utc": kickoff.isoformat() if kickoff else None,
            "hours_overdue": round((_now - kickoff).total_seconds() / 3600, 1)
            if kickoff else None,
        })
    return out


#: How far ahead a fixture counts as "imminent" for coverage reporting. Matches
#: the odds/injuries ingest window, so a gap here means an enrichment pass that
#: should already have run has not.
COVERAGE_WINDOW_HOURS = 48.0


def coverage_gaps(
    db: Session,
    *,
    now: datetime | None = None,
    window_hours: float = COVERAGE_WINDOW_HOURS,
) -> dict:
    """Enrichment we expected to have by now and don't, for imminent fixtures.

    Distinct from ``stuck_matches``, which reports an OUTAGE. These are quality
    gaps: a null venue or a missing odds row is legitimately unknown sometimes,
    so they must not flip the whole API to degraded — but they must not be
    silently absent either. A fixture two days out with no venue used to render
    a collapsed line and produce no signal anywhere; the only way to notice was
    for someone to open the page.

    Counts, not rows: this is a gauge to alert on a trend, not a work queue.
    """
    _now = now or datetime.now(timezone.utc)
    horizon = _now + timedelta(hours=window_hours)
    imminent = (
        db.query(Match)
        .filter(
            Match.status == "scheduled",
            Match.kickoff_utc.isnot(None),
            Match.kickoff_utc >= _now,
            Match.kickoff_utc <= horizon,
        )
    )
    total = imminent.count()
    # A venue is a fact the fixture feed carries; missing means the ingest
    # dropped it or the provider never had it. Either way it is not "fine".
    without_venue = imminent.filter(
        (Match.venue.is_(None)) | (Match.venue == "")
    ).count()

    # Market intelligence = a consensus odds row. Counted separately because
    # odds ingest is best-effort and its silence was the least visible of all
    # the failure modes: refresh_odds never raises, so an empty table looked
    # exactly like a quiet day.
    without_market = 0
    if total:
        from app.models import Odds

        priced = {
            row[0]
            for row in db.query(Odds.match_id)
            .filter(Odds.match_id.in_([m.id for m in imminent.all()]))
            .distinct()
            .all()
        }
        without_market = total - len(priced)

    return {
        "window_hours": window_hours,
        "upcoming_matches": total,
        "without_venue": without_venue,
        "without_market_intel": without_market,
    }


def data_status(
    db: Session,
    *,
    now: datetime | None = None,
    grace_hours: float = MATCH_MAX_DURATION_HOURS,
) -> dict:
    """The explicit degraded signal for /api/health.

    Kept separate from health's top-level ``status``, which means "this process
    is alive and answering" and is what the frontend homepage probes for
    connectivity. Conflating the two would make a stale feed look like an API
    outage to the page while making an API outage unreportable here. Monitors
    assert on ``data_status``; the browser keeps using ``status``.
    """
    stuck = stuck_matches(db, now=now, grace_hours=grace_hours)
    degradations: list[dict] = []
    if stuck:
        # Split the two causes: a stuck in_play row is a live-feed fault, a
        # stuck scheduled row means the daily ingest never ran or ingested
        # nothing. They page different people.
        in_play = [m for m in stuck if m["status"] == "in_play"]
        scheduled = [m for m in stuck if m["status"] == "scheduled"]
        if in_play:
            degradations.append({
                "kind": "stale_live_match",
                "detail": f"{len(in_play)} match(es) still in_play more than "
                          f"{grace_hours:g}h after kickoff",
                "matches": in_play,
            })
        if scheduled:
            degradations.append({
                "kind": "stale_fixture",
                "detail": f"{len(scheduled)} match(es) still scheduled more than "
                          f"{grace_hours:g}h after kickoff — results ingest is behind",
                "matches": scheduled,
            })
    return {
        "status": "degraded" if degradations else "ok",
        "degradations": degradations,
        # Reported alongside, never folded into `status`: a null venue is a
        # quality gap, not an outage, and conflating the two would make the
        # degraded signal fire so often that nobody reads it.
        "coverage": coverage_gaps(db, now=now),
    }
