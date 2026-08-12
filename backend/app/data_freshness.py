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
    }
