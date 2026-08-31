from datetime import datetime, timezone

from app.models import FixtureFeedStatus
from pipeline.ingest.fixture_feed_status import (
    record_attempt,
    record_failure,
    record_success,
)
from pipeline.ingest.provider_errors import ProviderQuotaError


NOW = datetime(2026, 8, 29, 1, 2, 3, tzinfo=timezone.utc)
UPSTREAM = datetime(2026, 8, 29, 0, 30, tzinfo=timezone.utc)


def _utc(value):
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def test_attempt_is_committed_with_provider_capabilities(db_session):
    record_attempt(
        db_session,
        "epl",
        "Premier League 2026-27",
        "football_data",
        now=NOW,
    )
    assert not db_session.in_transaction()

    row = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="epl"
    ).one()
    assert _utc(row.last_attempt_at) == NOW
    assert row.provider == "football_data"
    assert row.capabilities == {
        "mode": "delayed_results",
        "odds": False,
        "injuries": False,
        "lineups": False,
        "events": False,
        "live_minute": False,
    }


def test_success_clears_current_error_and_stores_feed_freshness(db_session):
    record_attempt(
        db_session, "epl", "Premier League 2026-27", "football_data",
        now=NOW,
    )
    record_failure(
        db_session, "epl", "Premier League 2026-27", "football_data",
        RuntimeError("temporary failure"), now=NOW,
    )

    record_success(
        db_session,
        "epl",
        "Premier League 2026-27",
        "football_data",
        fixture_count=380,
        latest_upstream_updated_at=UPSTREAM,
        now=NOW,
    )

    row = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="epl"
    ).one()
    assert _utc(row.last_success_at) == NOW
    assert row.fixture_count == 380
    assert _utc(row.latest_upstream_updated_at) == UPSTREAM
    assert row.last_error_at is None
    assert row.last_error_kind is None
    assert row.last_error is None
    assert row.capabilities["mode"] == "delayed_results"


def test_failure_preserves_prior_success_and_truncates_typed_error(db_session):
    record_success(
        db_session,
        "ucl",
        "UEFA Champions League 2026-27",
        "football_data",
        fixture_count=189,
        latest_upstream_updated_at=UPSTREAM,
        now=NOW,
    )
    later = datetime(2026, 8, 29, 2, 0, tzinfo=timezone.utc)

    record_failure(
        db_session,
        "ucl",
        "UEFA Champions League 2026-27",
        "football_data",
        ProviderQuotaError("x" * 700, endpoint="/competitions/CL/matches"),
        now=later,
    )

    row = db_session.query(FixtureFeedStatus).filter_by(
        competition_code="ucl"
    ).one()
    assert _utc(row.last_success_at) == NOW
    assert row.fixture_count == 189
    assert _utc(row.last_error_at) == later
    assert row.last_error_kind == "quota"
    assert row.last_error == "x" * 500
    assert row.capabilities["mode"] == "delayed_results"
