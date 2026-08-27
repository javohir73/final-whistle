"""Contract tests for normalized league fixture providers."""
from __future__ import annotations

from dataclasses import asdict

import pytest
import requests

from pipeline.ingest.api_football import normalize_league_fixture
from pipeline.ingest.fixture_contract import capabilities_for
from pipeline.ingest.football_data_org import (
    fetch_football_data_fixtures,
    normalize_fixture,
)
from pipeline.ingest.provider_errors import (
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
)


class _Response:
    def __init__(self, status_code: int, payload: object, headers: dict | None = None):
        self.status_code = status_code
        self._payload = payload
        self.headers = headers or {}

    def json(self):
        if isinstance(self._payload, Exception):
            raise self._payload
        return self._payload


class _SequenceGet:
    def __init__(self, *results):
        self.results = list(results)
        self.calls = []

    def __call__(self, url, *, headers, params, timeout):
        self.calls.append({
            "url": url,
            "headers": headers,
            "params": params,
            "timeout": timeout,
        })
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


def test_football_data_fixture_normalizes_current_result():
    raw = {
        "id": 991,
        "utcDate": "2026-08-28T18:30:00Z",
        "status": "FINISHED",
        "matchday": 1,
        "stage": "REGULAR_SEASON",
        "lastUpdated": "2026-08-28T21:02:03Z",
        "homeTeam": {"id": 5, "name": "Borussia Dortmund"},
        "awayTeam": {"id": 11, "name": "FC Bayern München"},
        "score": {
            "duration": "REGULAR",
            "fullTime": {"home": 2, "away": 1},
            "regularTime": {"home": 2, "away": 1},
        },
    }
    got = normalize_fixture(raw, preserve_stopped_statuses=True)
    assert got.provider == "football_data"
    assert got.fixture_id == 991
    assert (got.status, got.score_home, got.score_away) == ("finished", 2, 1)
    assert got.matchweek == 1
    assert got.round_label == "REGULAR_SEASON"
    assert got.upstream_updated_at.isoformat() == "2026-08-28T21:02:03+00:00"


def test_api_football_fixture_has_contract_parity():
    raw = {
        "fixture": {
            "id": 991,
            "date": "2026-08-28T18:30:00+00:00",
            "updated": "2026-08-28T21:02:03Z",
            "status": {"long": "Match Finished", "short": "FT", "elapsed": 90},
            "venue": {"id": 80, "name": "Signal Iduna Park", "city": "Dortmund"},
        },
        "league": {
            "id": 78,
            "name": "Bundesliga",
            "country": "Germany",
            "logo": "https://media.example/league.png",
            "flag": "https://media.example/flag.svg",
            "season": 2026,
            "round": "Regular Season - 1",
        },
        "teams": {
            "home": {"id": 165, "name": "Borussia Dortmund", "logo": "https://media.example/165.png", "winner": True},
            "away": {"id": 157, "name": "Bayern Munich", "logo": "https://media.example/157.png", "winner": False},
        },
        "goals": {"home": 2, "away": 1},
        "score": {
            "halftime": {"home": 1, "away": 0},
            "fulltime": {"home": 2, "away": 1},
            "extratime": {"home": None, "away": None},
            "penalty": {"home": None, "away": None},
        },
    }
    got = normalize_league_fixture(raw, preserve_stopped_statuses=True)
    assert asdict(got) == {
        "provider": "api_football",
        "fixture_id": 991,
        "home_name": "Borussia Dortmund",
        "away_name": "Bayern Munich",
        "kickoff_utc": got.kickoff_utc,
        "status": "finished",
        "score_home": 2,
        "score_away": 1,
        "matchweek": 1,
        "score_home_90": None,
        "score_away_90": None,
        "venue_name": "Signal Iduna Park",
        "venue_city": "Dortmund",
        "round_label": "Regular Season - 1",
        "upstream_updated_at": got.upstream_updated_at,
        "home_provider_id": 165,
        "away_provider_id": 157,
    }
    assert got.kickoff_utc.isoformat() == "2026-08-28T18:30:00+00:00"
    assert got.upstream_updated_at.isoformat() == "2026-08-28T21:02:03+00:00"


def test_malformed_fixture_rows_are_rejected():
    assert normalize_fixture({
        "id": 991,
        "utcDate": "not-a-date",
        "status": "FINISHED",
        "matchday": 1,
        "stage": "REGULAR_SEASON",
        "lastUpdated": "2026-08-28T21:02:03Z",
        "homeTeam": {"id": 5, "name": "Borussia Dortmund"},
        "awayTeam": {"id": 11, "name": "FC Bayern München"},
        "score": {"duration": "REGULAR", "fullTime": {"home": 2, "away": 1}},
    }) is None
    assert normalize_league_fixture({
        "fixture": {
            "id": 991,
            "date": "not-a-date",
            "status": {"long": "Match Finished", "short": "FT", "elapsed": 90},
            "venue": {"id": 80, "name": "Signal Iduna Park", "city": "Dortmund"},
        },
        "league": {"id": 78, "name": "Bundesliga", "country": "Germany", "season": 2026, "round": "Regular Season - 1"},
        "teams": {"home": {"id": 165, "name": "Borussia Dortmund", "winner": True}, "away": {"id": 157, "name": "Bayern Munich", "winner": False}},
        "goals": {"home": 2, "away": 1},
        "score": {"halftime": {"home": 1, "away": 0}, "fulltime": {"home": 2, "away": 1}, "extratime": {"home": None, "away": None}, "penalty": {"home": None, "away": None}},
    }) is None


def test_football_data_null_score_stays_unknown():
    got = normalize_fixture({
        "id": 441,
        "utcDate": "2026-09-01T19:00:00Z",
        "status": "TIMED",
        "matchday": 2,
        "stage": "REGULAR_SEASON",
        "lastUpdated": "2026-08-25T10:00:00Z",
        "homeTeam": {"id": 62, "name": "Everton FC"},
        "awayTeam": {"id": 61, "name": "Chelsea FC"},
        "score": {"duration": "REGULAR", "fullTime": {"home": None, "away": None}, "regularTime": {"home": None, "away": None}},
    })
    assert (got.status, got.score_home, got.score_away) == ("scheduled", None, None)


def test_football_data_extra_time_preserves_regulation_score():
    got = normalize_fixture({
        "id": 7001,
        "utcDate": "2027-05-05T19:00:00Z",
        "status": "FINISHED",
        "matchday": None,
        "stage": "SEMI_FINALS",
        "lastUpdated": "2027-05-05T21:48:00Z",
        "homeTeam": {"id": 64, "name": "Liverpool FC"},
        "awayTeam": {"id": 81, "name": "FC Barcelona"},
        "score": {"duration": "EXTRA_TIME", "fullTime": {"home": 3, "away": 2}, "regularTime": {"home": 1, "away": 1}},
    })
    assert (got.score_home, got.score_away) == (3, 2)
    assert (got.score_home_90, got.score_away_90) == (1, 1)


def test_api_football_aet_preserves_regulation_score_and_venue():
    got = normalize_league_fixture({
        "fixture": {
            "id": 7001,
            "date": "2027-05-05T19:00:00Z",
            "status": {"long": "Match Finished", "short": "AET", "elapsed": 120},
            "venue": {"id": 9, "name": "Anfield", "city": "Liverpool"},
        },
        "league": {"id": 2, "name": "UEFA Champions League", "country": "World", "season": 2026, "round": "Semi-finals"},
        "teams": {"home": {"id": 40, "name": "Liverpool", "winner": True}, "away": {"id": 529, "name": "Barcelona", "winner": False}},
        "goals": {"home": 3, "away": 2},
        "score": {"halftime": {"home": 0, "away": 1}, "fulltime": {"home": 1, "away": 1}, "extratime": {"home": 3, "away": 2}, "penalty": {"home": None, "away": None}},
    })
    assert (got.score_home, got.score_away) == (3, 2)
    assert (got.score_home_90, got.score_away_90) == (1, 1)
    assert (got.venue_name, got.venue_city) == ("Anfield", "Liverpool")


@pytest.mark.parametrize(
    ("provider_status", "expected"),
    [("POSTPONED", "postponed"), ("CANCELLED", "cancelled"), ("SUSPENDED", "suspended")],
)
def test_football_data_deliberate_stops_are_configurable(provider_status, expected):
    raw = {
        "id": 300,
        "utcDate": "2026-10-03T14:00:00Z",
        "status": provider_status,
        "matchday": 7,
        "stage": "REGULAR_SEASON",
        "lastUpdated": "2026-10-03T13:00:00Z",
        "homeTeam": {"id": 57, "name": "Arsenal FC"},
        "awayTeam": {"id": 66, "name": "Manchester United FC"},
        "score": {"duration": "REGULAR", "fullTime": {"home": None, "away": None}, "regularTime": {"home": None, "away": None}},
    }
    assert normalize_fixture(raw, preserve_stopped_statuses=True).status == expected
    assert normalize_fixture(raw, preserve_stopped_statuses=False).status == "scheduled"


def test_ucl_league_stage_keeps_stage_and_matchday():
    got = normalize_fixture({
        "id": 8001,
        "utcDate": "2026-09-16T19:00:00Z",
        "status": "TIMED",
        "matchday": 1,
        "stage": "LEAGUE_STAGE",
        "lastUpdated": "2026-08-27T08:00:00Z",
        "homeTeam": {"id": 64, "name": "Liverpool FC"},
        "awayTeam": {"id": 81, "name": "FC Barcelona"},
        "score": {"duration": "REGULAR", "fullTime": {"home": None, "away": None}, "regularTime": {"home": None, "away": None}},
    })
    assert (got.round_label, got.matchweek) == ("LEAGUE_STAGE", 1)


def test_provider_capabilities_distinguish_delayed_and_live_data():
    assert capabilities_for("football_data") == {
        "mode": "delayed_results",
        "odds": False,
        "injuries": False,
        "lineups": False,
        "events": False,
        "live_minute": False,
    }
    assert capabilities_for("api_football") == {
        "mode": "live",
        "odds": True,
        "injuries": True,
        "lineups": True,
        "events": True,
        "live_minute": True,
    }


def _success_payload():
    return {
        "filters": {"season": "2026"},
        "resultSet": {"count": 1, "first": "2026-08-28", "last": "2026-08-28", "played": 1},
        "competition": {"id": 2002, "name": "Bundesliga", "code": "BL1", "type": "LEAGUE", "emblem": "https://media.example/bl1.png"},
        "matches": [{
            "id": 991,
            "utcDate": "2026-08-28T18:30:00Z",
            "status": "FINISHED",
            "matchday": 1,
            "stage": "REGULAR_SEASON",
            "lastUpdated": "2026-08-28T21:02:03Z",
            "homeTeam": {"id": 5, "name": "Borussia Dortmund"},
            "awayTeam": {"id": 11, "name": "FC Bayern München"},
            "score": {"duration": "REGULAR", "fullTime": {"home": 2, "away": 1}, "regularTime": {"home": 2, "away": 1}},
        }],
    }


@pytest.mark.parametrize(
    "first_result",
    [
        requests.Timeout("timed out"),
        _Response(429, {"message": "too many requests"}),
        _Response(503, {"message": "temporarily unavailable"}),
    ],
)
def test_football_data_retries_one_transient_failure(first_result):
    request_get = _SequenceGet(first_result, _Response(200, _success_payload()))
    sleeps = []
    got = fetch_football_data_fixtures(
        "token", "BL1", 2026, request_get=request_get, sleeper=sleeps.append,
    )
    assert [(row.fixture_id, row.status) for row in got] == [(991, "finished")]
    assert len(request_get.calls) == 2
    assert len(sleeps) == 1


def test_football_data_honors_retry_after_seconds():
    request_get = _SequenceGet(
        _Response(429, {"message": "too many requests"}, {"Retry-After": "9"}),
        _Response(200, _success_payload()),
    )
    sleeps = []
    fetch_football_data_fixtures(
        "token", "BL1", 2026, request_get=request_get, sleeper=sleeps.append,
    )
    assert sleeps == [9.0]


@pytest.mark.parametrize("status_code", [401, 403])
def test_football_data_auth_failures_do_not_retry(status_code):
    request_get = _SequenceGet(_Response(status_code, {"message": "forbidden"}))
    with pytest.raises(ProviderAuthError):
        fetch_football_data_fixtures(
            "token", "BL1", 2026, request_get=request_get, sleeper=lambda _: None,
        )
    assert len(request_get.calls) == 1


@pytest.mark.parametrize(
    "payload",
    [
        ["not", "an", "object"],
        {"competition": {"code": "BL1"}, "matches": []},
        {"competition": {"code": "PL"}, "matches": _success_payload()["matches"]},
        {"competition": {"code": "BL1"}, "matches": [{"id": 991}]},
    ],
)
def test_football_data_invalid_payloads_do_not_retry(payload):
    request_get = _SequenceGet(_Response(200, payload))
    with pytest.raises(ProviderError):
        fetch_football_data_fixtures(
            "token", "BL1", 2026, request_get=request_get, sleeper=lambda _: None,
        )
    assert len(request_get.calls) == 1


def test_football_data_exhausted_rate_limit_is_typed():
    request_get = _SequenceGet(
        _Response(429, {"message": "too many requests"}),
        _Response(429, {"message": "too many requests"}),
    )
    with pytest.raises(ProviderQuotaError):
        fetch_football_data_fixtures(
            "token", "BL1", 2026, request_get=request_get, sleeper=lambda _: None,
        )
    assert len(request_get.calls) == 2
