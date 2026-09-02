"""Freshness / finality detection.

A match cannot still be in_play four hours after kickoff, and it cannot still
be scheduled either. Both mean the feed stopped reaching us — the failure mode
that stayed invisible through the pre-season quota incident because nothing
errored, there was simply no new data.
"""
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy.exc import SQLAlchemyError

from app.data_freshness import (
    coverage_gaps,
    data_status,
    fixture_feed_health,
    stuck_matches,
)
from app.models import FixtureFeedStatus, Match, Tournament
from pipeline.ingest.fixture_contract import capabilities_for
from pipeline.ingest.fixture_feed_status import record_attempt, record_failure
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
    out = data_status(db_session, now=NOW)
    assert out["status"] == "ok"
    assert out["degradations"] == []
    # `coverage` rides alongside and is asserted by its own tests below; it is
    # a quality gauge, not part of the outage verdict.
    assert "coverage" in out


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


# --- coverage gaps: unavailable, not silently fine -------------------------


def test_null_venue_on_an_imminent_fixture_is_reported(db_session, epl):
    """A fixture two days out with no venue rendered a collapsed line and
    produced no signal anywhere — the only way to notice was to open the page."""
    m = _match(db_session, epl, status="scheduled", hours_ago=-6)
    m.venue = None
    db_session.commit()

    cov = coverage_gaps(db_session, now=NOW)
    assert cov["upcoming_matches"] == 1
    assert cov["without_venue"] == 1


def test_a_venue_we_have_is_not_counted(db_session, epl):
    m = _match(db_session, epl, status="scheduled", hours_ago=-6)
    m.venue = "Emirates Stadium"
    db_session.commit()
    assert coverage_gaps(db_session, now=NOW)["without_venue"] == 0


def test_empty_string_venue_counts_as_missing(db_session, epl):
    # An empty string is the ingest writing "nothing" without writing NULL.
    m = _match(db_session, epl, status="scheduled", hours_ago=-6)
    m.venue = ""
    db_session.commit()
    assert coverage_gaps(db_session, now=NOW)["without_venue"] == 1


def test_missing_market_intel_is_reported(db_session, epl):
    """refresh_odds never raises, so an empty odds table looked exactly like a
    quiet day. This is the gauge that tells them apart."""
    _match(db_session, epl, status="scheduled", hours_ago=-6)
    assert coverage_gaps(db_session, now=NOW)["without_market_intel"] == 1


def test_a_priced_match_is_not_counted_as_missing_intel(db_session, epl):
    from app.models import Odds

    m = _match(db_session, epl, status="scheduled", hours_ago=-6)
    db_session.add(Odds(match_id=m.id))
    db_session.commit()
    assert coverage_gaps(db_session, now=NOW)["without_market_intel"] == 0


def test_coverage_gaps_do_not_flip_the_api_to_degraded(db_session, epl):
    """The severity line. A null venue is legitimately unknown sometimes; if it
    escalated to degraded the signal would fire constantly and stop being read.
    Only an impossible match status is an outage."""
    m = _match(db_session, epl, status="scheduled", hours_ago=-6)
    m.venue = None
    db_session.commit()

    out = data_status(db_session, now=NOW)
    assert out["status"] == "ok"
    assert out["degradations"] == []
    assert out["coverage"]["without_venue"] == 1


def test_matches_beyond_the_window_are_not_counted(db_session, epl):
    # A fixture three weeks out has no venue yet for ordinary reasons.
    _match(db_session, epl, status="scheduled", hours_ago=-24 * 21)
    assert coverage_gaps(db_session, now=NOW)["upcoming_matches"] == 0


def test_fixture_feed_health_reports_all_codes_and_delayed_capabilities(db_session):
    rows = {
        row["competition_code"]: row
        for row in fixture_feed_health(db_session, now=NOW)
    }
    assert set(rows) == {"epl", "laliga", "bundesliga", "ucl"}
    assert rows["epl"]["status"] == "ok"
    assert rows["epl"]["provider"] == "football_data"
    assert rows["epl"]["mode"] == "delayed_results"
    assert rows["epl"]["capabilities"]["lineups"] is False


def test_killed_first_attempt_after_provider_switch_is_never_healthy(db_session):
    row = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="epl"
    ).one()
    row.provider = "api_football"
    row.last_attempt_at = NOW - timedelta(hours=2)
    row.last_success_at = NOW - timedelta(hours=2)
    row.fixture_count = 380
    row.latest_upstream_updated_at = NOW - timedelta(hours=3)
    row.capabilities = capabilities_for("api_football")
    db_session.commit()

    # Simulate a cutover process that committed its attempt, then was killed
    # before it could record either success or failure.
    record_attempt(
        db_session,
        "epl",
        "Premier League 2026-27",
        "football_data",
        now=NOW,
    )

    feed = next(
        item for item in fixture_feed_health(db_session, now=NOW)
        if item["competition_code"] == "epl"
    )
    assert feed["provider"] == "football_data"
    assert feed["status"] == "never_run"
    assert feed["last_success_at"] is None
    assert feed["fixture_count"] == 0
    assert feed["latest_upstream_updated_at"] is None


def test_fixture_feed_health_never_exposes_private_failure_details(
    db_session, caplog,
):
    private_detail = (
        "SELECT * FROM accounts WHERE password='hunter2'; "
        "/private/secrets/provider-token.txt token=super-secret"
    )
    record_failure(
        db_session,
        "ucl",
        "UEFA Champions League 2026-27",
        "football_data",
        SQLAlchemyError(private_detail),
        now=NOW + timedelta(minutes=1),
    )

    feed = next(
        item for item in fixture_feed_health(db_session, now=NOW + timedelta(minutes=1))
        if item["competition_code"] == "ucl"
    )
    assert feed["error_kind"] == "storage"
    assert feed["error"] == "fixture feed storage failed"
    assert private_detail not in repr(feed)
    assert private_detail in caplog.text


def test_fixture_feed_health_counts_stale_scheduled_matches_per_competition(
    db_session, epl,
):
    _match(db_session, epl, status="scheduled", hours_ago=9)
    _match(db_session, epl, status="scheduled", hours_ago=3)
    _match(db_session, epl, status="in_play", hours_ago=9)
    _match(db_session, epl, status="finished", hours_ago=9)

    rows = {
        item["competition_code"]: item
        for item in fixture_feed_health(db_session, now=NOW)
    }
    assert rows["epl"]["stale_scheduled_match_count"] == 1
    assert rows["laliga"]["stale_scheduled_match_count"] == 0


def test_fixture_feed_health_classifies_never_run_empty_failed_and_stale(db_session):
    db_session.query(FixtureFeedStatus).filter_by(
        competition_code="epl"
    ).delete()
    laliga = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="laliga"
    ).one()
    laliga.fixture_count = 0
    bundesliga = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="bundesliga"
    ).one()
    bundesliga.last_success_at = NOW - timedelta(hours=37)
    ucl = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="ucl"
    ).one()
    ucl.last_success_at = NOW - timedelta(hours=1)
    ucl.last_error_at = NOW
    ucl.last_error_kind = "error"
    ucl.last_error = "upstream unavailable"
    db_session.commit()

    rows = {
        row["competition_code"]: row
        for row in fixture_feed_health(db_session, now=NOW)
    }
    assert rows["epl"]["status"] == "never_run"
    assert rows["laliga"]["status"] == "empty"
    assert rows["bundesliga"]["status"] == "stale"
    assert rows["ucl"]["status"] == "failed"
    assert rows["ucl"]["error"] == "fixture refresh failed"


def test_non_ok_fixture_feeds_add_one_data_status_degradation(db_session):
    row = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="laliga"
    ).one()
    row.fixture_count = 0
    db_session.commit()

    out = data_status(db_session, now=NOW)

    assert out["status"] == "degraded"
    feed_degradations = [
        item for item in out["degradations"]
        if item["kind"] == "fixture_feed"
    ]
    assert len(feed_degradations) == 1
    assert feed_degradations[0]["competitions"] == ["laliga"]
