"""False-green regression tests for the daily refresh.

The incident these pin: the api-sports allowance was exhausted for EPL, La
Liga, Bundesliga and UCL, and refresh-data still reported success every night.
Two independent paths produced that, and each gets a test here:

  1. Core ingest got an error payload and read it as "no fixtures" -> steps
     completed over an empty upsert.
  2. Enrichment steps (odds, injuries) never raise by contract, so their
     failure was invisible to the run's exit code.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.config import settings
from pipeline import leagues as leagues_mod
from pipeline.ingest import api_football as api_football_mod
from pipeline.ingest import injuries as injuries_mod
from pipeline.ingest import league_structure as ls_mod
from pipeline.ingest import provider_errors
from pipeline.ingest.provider_errors import ProviderError, ProviderQuotaError
from pipeline.run_pipeline import ProviderDegraded, run_pipeline


@pytest.fixture(autouse=True)
def _single_league_no_network(monkeypatch):
    from pipeline import compute_club_elo as club_elo_mod
    from pipeline import league_activation as activation_mod

    monkeypatch.setattr(settings, "pipeline_target", "league")
    monkeypatch.setattr(leagues_mod, "ACTIVE_LEAGUES", ["epl"])
    monkeypatch.setattr(
        activation_mod, "ensure_club_history",
        lambda _db, cfg: {"competition": cfg["club_competition"], "matches": 0,
                          "downloaded": False, "minimum": cfg["history_min_matches"]},
    )
    monkeypatch.setattr(club_elo_mod, "unrated_roster_teams", lambda *_a: [])
    provider_errors.reset()
    yield
    provider_errors.reset()


def _fixture(fid, home, away, status="NS", gh=None, ga=None, date=None):
    return {
        "fixture": {"id": fid, "date": date or "2026-08-21T19:00:00+00:00",
                    "status": {"short": status}},
        "teams": {"home": {"name": home}, "away": {"name": away}},
        "goals": {"home": gh, "away": ga},
    }


def _healthy_fixtures(*_a, **_k):
    """One finished fixture (feeds results sync / Elo) plus one kicking off
    inside refresh_injuries' 48h window, so the enrichment steps actually have
    a match to work on — without it they no-op and the tests below can't
    observe the swallow-a-provider-failure path at all."""
    soon = (datetime.now(timezone.utc) + timedelta(hours=6)).isoformat()
    return [
        _fixture(1, "Arsenal", "Chelsea", status="FT", gh=2, ga=1),
        _fixture(2, "Liverpool", "Everton", status="NS", date=soon),
    ]


def test_quota_on_core_ingest_fails_the_run(db_session, monkeypatch):
    """Path 1. Before the fix this returned a summary with league_structure
    reporting 0 fixtures upserted, and the Action went green."""
    def _out_of_quota(*_a, **_k):
        raise ProviderQuotaError(
            "/fixtures: provider returned errors "
            "{'requests': 'You have reached the request limit for the day'}",
            endpoint="/fixtures",
        )

    monkeypatch.setattr(ls_mod, "fetch_fixtures", _out_of_quota)
    monkeypatch.setattr(settings, "api_football_api_key", "")

    with pytest.raises(ProviderQuotaError):
        run_pipeline(db_session, n_sims=10)


def test_quota_swallowed_by_best_effort_injuries_still_fails_the_run(db_session, monkeypatch):
    """Path 2 — the subtle one.

    refresh_injuries NEVER raises by contract, so an exhausted allowance used
    to cost the run nothing: every step reported done and the job exited 0.
    The incident ledger makes the run fail at the end anyway, while still
    letting the earlier steps keep the real rows they wrote.
    """
    monkeypatch.setattr(ls_mod, "fetch_fixtures", _healthy_fixtures)
    monkeypatch.setattr(settings, "api_football_api_key", "present")

    def _out_of_quota(*_a, **_k):
        raise ProviderQuotaError("/injuries: out of quota", endpoint="/injuries")

    monkeypatch.setattr(injuries_mod, "fetch_injuries", _out_of_quota)

    with pytest.raises(ProviderDegraded) as excinfo:
        run_pipeline(db_session, n_sims=10)
    assert "quota" in str(excinfo.value)
    assert "/injuries" in str(excinfo.value)


class _HttpResp:
    """requests.Response stand-in for the raw-HTTP path through _get."""

    def __init__(self, status_code, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {"errors": [], "response": []}

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


@pytest.mark.parametrize("status", [401, 403])
def test_http_auth_failure_in_best_effort_injuries_fails_the_run(db_session, monkeypatch, status):
    """The whole chain, from a real HTTP status.

    An expired or revoked key answers 401/403 rather than an HTTP-200 errors
    payload. That used to reach raise_for_status as a plain HTTPError, which
    refresh_injuries swallows by contract WITHOUT recording an incident — so a
    dead key produced a green refresh-data run every night. Exercised through
    requests.get (not a pre-raised ProviderAuthError) so the test covers
    read_payload's classification, the best-effort swallow, the incident
    ledger, and _finalize together.
    """
    monkeypatch.setattr(ls_mod, "fetch_fixtures", _healthy_fixtures)
    monkeypatch.setattr(settings, "api_football_api_key", "expired-key")
    monkeypatch.setattr(
        api_football_mod.requests, "get", lambda *a, **k: _HttpResp(status)
    )

    with pytest.raises(ProviderDegraded) as excinfo:
        run_pipeline(db_session, n_sims=10)
    assert "auth" in str(excinfo.value)


def test_http_auth_failure_in_odds_records_a_blocking_incident(db_session, monkeypatch):
    """refresh_odds is not called by the league branch (the hourly phased pass
    owns it), so its contract is asserted directly: NEVER raises, but a 401 must
    still leave an incident that fails whatever run invoked it."""
    from datetime import datetime, timedelta, timezone

    from app.models import Match, Tournament
    from pipeline.ingest.odds import refresh_odds

    t = Tournament(name="Premier League 2026-27", year=2026)
    db_session.add(t)
    db_session.commit()
    db_session.add(Match(
        tournament_id=t.id, stage="group", status="scheduled",
        team_home_id=1, team_away_id=2, provider_fixture_id=99,
        kickoff_utc=datetime.now(timezone.utc) + timedelta(hours=6),
    ))
    db_session.commit()

    monkeypatch.setattr(
        api_football_mod.requests, "get", lambda *a, **k: _HttpResp(401)
    )

    out = refresh_odds(db_session, "expired-key")

    assert out["provider_error"] == "auth"        # never raised...
    assert [i["kind"] for i in provider_errors.blocking()] == ["auth"]  # ...but fatal


def test_a_single_transient_provider_blip_does_not_fail_the_run(db_session, monkeypatch):
    """The other half of the contract: failing the nightly refresh on one flaky
    response is how alert fatigue starts. Only systemic quota/auth blocks."""
    monkeypatch.setattr(ls_mod, "fetch_fixtures", _healthy_fixtures)
    monkeypatch.setattr(settings, "api_football_api_key", "present")

    def _blip(*_a, **_k):
        raise ProviderError("/injuries: upstream hiccup", endpoint="/injuries")

    monkeypatch.setattr(injuries_mod, "fetch_injuries", _blip)

    summary = run_pipeline(db_session, n_sims=10)
    # Recorded and visible...
    assert summary["provider"]["incidents"][0]["endpoint"] == "/injuries"
    # ...but not fatal.
    assert "league_structure" in summary


def test_summary_reports_provider_request_counts(db_session, monkeypatch):
    """Request accounting: which endpoint burned the allowance is otherwise a
    guess. Reduces the next round of "why did we run out?" to a lookup."""
    monkeypatch.setattr(ls_mod, "fetch_fixtures", _healthy_fixtures)
    monkeypatch.setattr(settings, "api_football_api_key", "")

    summary = run_pipeline(db_session, n_sims=10)
    assert "requests" in summary["provider"]
    assert summary["provider"]["incidents"] == []


def test_healthy_run_is_still_green(db_session, monkeypatch):
    """Guard against over-correcting into a refresh that can never pass."""
    monkeypatch.setattr(ls_mod, "fetch_fixtures", _healthy_fixtures)
    monkeypatch.setattr(settings, "api_football_api_key", "")

    summary = run_pipeline(db_session, n_sims=10)
    assert summary["league_structure"]["teams"] == 20
    assert summary["provider"]["incidents"] == []
