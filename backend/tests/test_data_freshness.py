"""Freshness / finality detection.

A match cannot still be in_play four hours after kickoff, and it cannot still
be scheduled either. Both mean the feed stopped reaching us — the failure mode
that stayed invisible through the pre-season quota incident because nothing
errored, there was simply no new data.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.data_freshness import data_status, stuck_matches
from app.models import Match, Tournament

NOW = datetime(2026, 8, 12, 18, 0, tzinfo=timezone.utc)


@pytest.fixture
def epl(db_session):
    t = Tournament(name="Premier League 2026-27", year=2026)
    db_session.add(t)
    db_session.commit()
    return t


def _match(db, tournament, *, status, hours_ago):
    m = Match(
        tournament_id=tournament.id, stage="group", status=status,
        kickoff_utc=NOW - timedelta(hours=hours_ago),
    )
    db.add(m)
    db.commit()
    return m


def test_clean_data_is_not_degraded(db_session, epl):
    _match(db_session, epl, status="finished", hours_ago=30)
    _match(db_session, epl, status="scheduled", hours_ago=-24)  # kicks off tomorrow
    assert data_status(db_session, now=NOW) == {"status": "ok", "degradations": []}


def test_match_still_in_play_hours_after_kickoff_is_degraded(db_session, epl):
    """The finality check the brief asks for."""
    _match(db_session, epl, status="in_play", hours_ago=9)

    out = data_status(db_session, now=NOW)
    assert out["status"] == "degraded"
    kinds = [d["kind"] for d in out["degradations"]]
    assert kinds == ["stale_live_match"]
    assert out["degradations"][0]["matches"][0]["hours_overdue"] == 9.0


def test_a_match_in_play_within_the_grace_window_is_fine(db_session, epl):
    """Extra time plus a shootout is a real ~3h match; it must not alert."""
    _match(db_session, epl, status="in_play", hours_ago=3)
    assert data_status(db_session, now=NOW)["status"] == "ok"


def test_fixture_never_kicked_off_flags_a_stale_ingest(db_session, epl):
    """The freshness check: still 'scheduled' long after kickoff means the
    daily results ingest is behind — exactly what an exhausted quota produces,
    and exactly what used to read as a healthy quiet day."""
    _match(db_session, epl, status="scheduled", hours_ago=26)

    out = data_status(db_session, now=NOW)
    assert out["status"] == "degraded"
    assert [d["kind"] for d in out["degradations"]] == ["stale_fixture"]


def test_both_causes_are_reported_separately(db_session, epl):
    # They page different people: a stuck live feed vs. a dead daily refresh.
    _match(db_session, epl, status="in_play", hours_ago=9)
    _match(db_session, epl, status="scheduled", hours_ago=26)

    kinds = {d["kind"] for d in data_status(db_session, now=NOW)["degradations"]}
    assert kinds == {"stale_live_match", "stale_fixture"}


def test_offending_rows_name_their_competition(db_session, epl):
    """An alert that says "something is stale" costs a human the triage. One
    that says "Premier League 2026-27" does not."""
    _match(db_session, epl, status="in_play", hours_ago=9)

    row = stuck_matches(db_session, now=NOW)[0]
    assert row["competition"] == "Premier League 2026-27"
    assert row["status"] == "in_play"


def test_matches_without_a_kickoff_are_ignored(db_session, epl):
    # WC26 knockout placeholders have no kickoff until the bracket resolves.
    db_session.add(Match(tournament_id=epl.id, stage="SF", status="scheduled"))
    db_session.commit()
    assert data_status(db_session, now=NOW)["status"] == "ok"
