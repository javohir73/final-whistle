"""Deliberate stops must not read as a stale feed.

Both ingest paths used to flatten the provider's POSTPONED / CANCELLED /
SUSPENDED into ``scheduled``. A postponed fixture keeps its ORIGINAL kickoff, so
four hours later app/data_freshness correctly judged that state impossible and
/api/health went degraded — permanently, because nothing would ever move the
row. One ordinary weather postponement would have pinned smoke red until
someone deleted it by hand.

The detector was right; the status model was lying to it. These tests pin the
distinction from both ends: a deliberate stop stays quiet, a genuinely stale
fixture still degrades.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.data_freshness import data_status, stuck_matches
from app.match_status import (
    CANCELLED,
    IN_PLAY,
    POSTPONED,
    SCHEDULED,
    SUSPENDED,
    is_deliberate_stop,
    is_locked,
)
from app.models import FixtureFeedStatus, Match, Tournament
from pipeline.ingest.fixture_contract import capabilities_for
from pipeline.leagues import LEAGUES

NOW = datetime(2026, 8, 12, 18, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def healthy_fixture_feeds(db_session):
    for code, cfg in LEAGUES.items():
        db_session.add(FixtureFeedStatus(
            competition_code=code,
            tournament_name=cfg["tournament_name"],
            provider="football_data",
            last_attempt_at=NOW,
            last_success_at=NOW,
            last_error_at=None,
            last_error_kind=None,
            last_error=None,
            fixture_count=10,
            latest_upstream_updated_at=NOW,
            capabilities=capabilities_for("football_data"),
        ))
    db_session.commit()


@pytest.fixture
def epl(db_session):
    t = Tournament(name="Premier League 2026-27", year=2026)
    db_session.add(t)
    db_session.commit()
    return t


def _match(db, tournament, *, status, hours_ago):
    m = Match(tournament_id=tournament.id, stage="group", status=status,
              kickoff_utc=NOW - timedelta(hours=hours_ago))
    db.add(m)
    db.commit()
    return m


# --- the false alarm this fixes -------------------------------------------

@pytest.mark.parametrize("status", [POSTPONED, CANCELLED, SUSPENDED])
def test_a_deliberate_stop_long_past_its_kickoff_is_not_degraded(db_session, epl, status):
    """A postponement is ingested FACT, not a feed that went quiet. Weeks after
    the original kickoff this must still be quiet — otherwise smoke is red
    forever and nothing can clear it."""
    _match(db_session, epl, status=status, hours_ago=24 * 21)

    out = data_status(db_session, now=NOW)
    assert out["status"] == "ok"
    assert out["degradations"] == []
    assert stuck_matches(db_session, now=NOW) == []


def test_a_genuinely_stale_scheduled_fixture_still_degrades(db_session, epl):
    """The other side of the line — the detector must not be blunted."""
    _match(db_session, epl, status=SCHEDULED, hours_ago=26)

    out = data_status(db_session, now=NOW)
    assert out["status"] == "degraded"
    assert [d["kind"] for d in out["degradations"]] == ["stale_fixture"]


def test_a_stuck_in_play_fixture_still_degrades(db_session, epl):
    _match(db_session, epl, status=IN_PLAY, hours_ago=9)
    assert data_status(db_session, now=NOW)["status"] == "degraded"


def test_a_postponed_fixture_does_not_mask_a_real_stale_one(db_session, epl):
    # Both present: the postponement is ignored, the stale row still fires.
    _match(db_session, epl, status=POSTPONED, hours_ago=24 * 21)
    _match(db_session, epl, status=SCHEDULED, hours_ago=26)

    stuck = stuck_matches(db_session, now=NOW)
    assert [m["status"] for m in stuck] == [SCHEDULED]


def test_deliberate_stops_are_excluded_from_coverage_gaps(db_session, epl):
    """A cancelled fixture inside the 48h window must not be counted as
    "missing a venue" or "missing odds" — nobody is going to price it."""
    from app.data_freshness import coverage_gaps

    m = _match(db_session, epl, status=CANCELLED, hours_ago=-6)
    m.venue = None
    db_session.commit()

    assert coverage_gaps(db_session, now=NOW)["upcoming_matches"] == 0


# --- semantics ------------------------------------------------------------

def test_is_deliberate_stop_covers_exactly_the_three():
    assert all(is_deliberate_stop(s) for s in (POSTPONED, CANCELLED, SUSPENDED))
    assert not any(is_deliberate_stop(s) for s in (SCHEDULED, IN_PLAY, "finished"))


def test_postponed_keeps_picks_open_exactly_as_before():
    """Behaviour preservation: postponed used to read as "scheduled", so picks
    were open. The fixture has not kicked off, so a pick on it is still
    meaningful once it is rescheduled."""
    assert is_locked(POSTPONED) is False
    assert is_locked(SCHEDULED) is False


@pytest.mark.parametrize("status", [CANCELLED, SUSPENDED, "finished", IN_PLAY])
def test_everything_else_locks(status):
    """Deliberate CHANGE for cancelled and suspended, and a bug fix in both
    cases: a cancelled match will never be played, and a suspended one has
    already kicked off — leaving picks open let someone submit against a match
    in progress. Locking can never let a result be gamed."""
    assert is_locked(status) is True
