"""Tests for the EPL 2026-27 structure loader (league pivot D1/D2)."""
from dataclasses import replace
from datetime import datetime, timezone

import pytest
from sqlalchemy.exc import IntegrityError

from app.cache import cache
from app.models import Group, GroupTeam, Match, Prediction, Team, Tournament
from pipeline.ingest import league_structure as ls_mod
from pipeline.ingest.fixture_contract import NormalizedFixture
from pipeline.ingest.league_structure import load_league_structure
from pipeline.ingest.wc26_structure import load_structure as load_wc26_structure


def _fixture(fid, home, away, *, status="NS", gh=None, ga=None,
             kickoff="2026-08-21T19:00:00+00:00", round_=None, venue=None):
    fx = {
        "fixture": {
            "id": fid,
            "date": kickoff,
            "status": {"short": status},
            **({"venue": venue} if venue is not None else {}),
        },
        "teams": {"home": {"name": home}, "away": {"name": away}},
        "goals": {"home": gh, "away": ga},
    }
    if round_ is not None:
        fx["league"] = {"round": round_}
    return fx


def _normalized_fixture(
    fid,
    home,
    away,
    *,
    kickoff="2026-08-21T19:00:00+00:00",
    status="scheduled",
    updated="2026-08-20T12:34:56+00:00",
    home_id=57,
    away_id=61,
    round_label="REGULAR_SEASON",
):
    return NormalizedFixture(
        provider="football_data",
        fixture_id=fid,
        home_name=home,
        away_name=away,
        kickoff_utc=datetime.fromisoformat(kickoff),
        status=status,
        score_home=None,
        score_away=None,
        matchweek=1,
        score_home_90=None,
        score_away_90=None,
        venue_name=None,
        venue_city=None,
        round_label=round_label,
        upstream_updated_at=datetime.fromisoformat(updated),
        home_provider_id=home_id,
        away_provider_id=away_id,
    )


def test_seeds_teams_group_and_tournament_mode(db_session, monkeypatch):
    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: [])
    load_league_structure(db_session, api_key="x")

    assert db_session.query(Team).count() == 20
    tournament = db_session.query(Tournament).filter_by(name="Premier League 2026-27").one()
    assert tournament.year == 2026
    assert tournament.home_advantage_mode == "home"

    group = db_session.query(Group).filter_by(tournament_id=tournament.id).one()
    assert group.name == "Premier League"
    assert db_session.query(GroupTeam).filter_by(group_id=group.id).count() == 20


def test_upserts_fixtures_idempotently(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(1001, "Arsenal", "Chelsea", status="NS")],
    )
    summary = load_league_structure(db_session, api_key="x")
    assert summary["fixtures_created"] == 1
    assert summary["fixtures_updated"] == 0

    match = db_session.query(Match).filter_by(provider_fixture_id=1001).one()
    assert match.status == "scheduled"
    assert match.stage == "group"
    assert match.is_neutral is False
    arsenal = db_session.query(Team).filter_by(name="Arsenal").one()
    assert match.team_home_id == arsenal.id

    # Re-run with an updated status/score for the same fixture id: update, not duplicate.
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(1001, "Arsenal", "Chelsea", status="FT", gh=2, ga=1)],
    )
    second = load_league_structure(db_session, api_key="x")
    assert second["fixtures_created"] == 0
    assert second["fixtures_updated"] == 1
    assert db_session.query(Match).filter_by(provider_fixture_id=1001).count() == 1

    match = db_session.query(Match).filter_by(provider_fixture_id=1001).one()
    assert match.status == "finished"
    assert match.score_home == 2
    assert match.score_away == 1


def test_abandoned_fixture_uses_the_same_suspended_state_as_live_ingestion(
    db_session, monkeypatch,
):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(1002, "Arsenal", "Chelsea", status="ABD")],
    )

    load_league_structure(db_session, api_key="x")

    match = db_session.query(Match).filter_by(provider_fixture_id=1002).one()
    assert match.status == "suspended"


def test_rollout_gate_keeps_stopped_status_legacy_safe(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(1003, "Arsenal", "Chelsea", status="PST")],
    )

    load_league_structure(
        db_session,
        api_key="x",
        preserve_stopped_statuses=False,
    )

    match = db_session.query(Match).filter_by(provider_fixture_id=1003).one()
    assert match.status == "scheduled"


def test_stores_provider_venue_name_and_city(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture(
                1010,
                "Arsenal",
                "Chelsea",
                venue={"name": "Emirates Stadium", "city": "London"},
            )
        ],
    )

    load_league_structure(db_session, api_key="x")

    match = db_session.query(Match).filter_by(provider_fixture_id=1010).one()
    assert match.venue == "Emirates Stadium"
    assert match.venue_city == "London"


def test_missing_provider_venue_does_not_erase_a_known_value(db_session, monkeypatch):
    with_venue = _fixture(
        1011,
        "Arsenal",
        "Chelsea",
        venue={"name": "Emirates Stadium", "city": "London"},
    )
    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: [with_venue])
    load_league_structure(db_session, api_key="x")

    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [_fixture(1011, "Arsenal", "Chelsea")],
    )
    load_league_structure(db_session, api_key="x")

    match = db_session.query(Match).filter_by(provider_fixture_id=1011).one()
    assert match.venue == "Emirates Stadium"
    assert match.venue_city == "London"


def test_normalizes_football_data_style_aliases(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(2002, "Man United", "Nott'm Forest")],
    )
    load_league_structure(db_session, api_key="x")
    match = db_session.query(Match).filter_by(provider_fixture_id=2002).one()
    home = db_session.get(Team, match.team_home_id)
    away = db_session.get(Team, match.team_away_id)
    assert home.name == "Manchester United"
    assert away.name == "Nottingham Forest"


def test_never_touches_wc26_rows(db_session, monkeypatch):
    load_wc26_structure(db_session)
    wc26_matches = db_session.query(Match).count()
    wc26_tournament = db_session.query(Tournament).filter_by(
        name="FIFA World Cup 2026"
    ).one()

    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(3003, "Everton", "Fulham")],
    )
    load_league_structure(db_session, api_key="x")

    assert db_session.query(Match).filter_by(tournament_id=wc26_tournament.id).count() == wc26_matches
    epl_tournament = db_session.query(Tournament).filter_by(
        name="Premier League 2026-27"
    ).one()
    assert epl_tournament.id != wc26_tournament.id
    assert db_session.query(Match).filter_by(tournament_id=epl_tournament.id).count() == 1


def test_load_invalidates_the_tournaments_active_cache(db_session, monkeypatch):
    """Opus review of PR #171, item 2: a stale "tournaments:active" cached
    answer (e.g. WC26/knockout, from before this load ran) must not survive
    a structure load in the SAME process. (In the real deployed topology the
    daily pipeline runs in a separate process from the web server, where this
    is a no-op — GET /api/tournaments/active's short ttl_seconds is what
    bounds staleness there; this test covers the in-process case directly.)"""
    cache.set("tournaments:active", {"name": "FIFA World Cup 2026", "format": "knockout"})
    assert cache.get("tournaments:active") is not None

    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: [])
    load_league_structure(db_session, api_key="x")

    assert cache.get("tournaments:active") is None
    cache.clear()


def test_skips_fixture_with_unknown_team(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(4004, "Arsenal", "Some Nonexistent FC")],
    )
    summary = load_league_structure(db_session, api_key="x")
    assert summary["fixtures_skipped"] == 1
    assert db_session.query(Match).filter_by(provider_fixture_id=4004).count() == 0


# ---------------------------------------------------------------------------
# matchweek write-side (League Score Predictions design doc, matches.
# matchweek migration c8d9e0f1a2b3): parsing API-Football's fixture.league.
# round into Match.matchweek.
# ---------------------------------------------------------------------------

def test_stores_matchweek_parsed_from_league_round(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(5005, "Arsenal", "Chelsea", round_="Regular Season - 5")],
    )
    load_league_structure(db_session, api_key="x")
    match = db_session.query(Match).filter_by(provider_fixture_id=5005).one()
    assert match.matchweek == 5


def test_matchweek_stays_null_when_round_missing_or_unparseable(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [
            _fixture(6006, "Arsenal", "Chelsea"),  # no round key at all
            _fixture(6007, "Man United", "Nott'm Forest", round_="Quarter-finals"),  # no trailing number
        ],
    )
    load_league_structure(db_session, api_key="x")
    assert db_session.query(Match).filter_by(provider_fixture_id=6006).one().matchweek is None
    assert db_session.query(Match).filter_by(provider_fixture_id=6007).one().matchweek is None


def test_matchweek_updates_on_re_ingestion_after_reschedule(db_session, monkeypatch):
    """Set unconditionally on every upsert, like kickoff_utc/status/score_* --
    a fixture moved to a different matchweek (broadcaster reshuffle) must
    correct on the next ingestion, not just the first time the row is
    created."""
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(7007, "Arsenal", "Chelsea", round_="Regular Season - 5")],
    )
    load_league_structure(db_session, api_key="x")
    assert db_session.query(Match).filter_by(provider_fixture_id=7007).one().matchweek == 5

    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture(7007, "Arsenal", "Chelsea", round_="Regular Season - 6")],
    )
    load_league_structure(db_session, api_key="x")
    assert db_session.query(Match).filter_by(provider_fixture_id=7007).one().matchweek == 6


# ---------------------------------------------------------------------------
# teams_file=None: derive teams from the fixtures payload (League Score
# Predictions Phase 2 -- La Liga/Bundesliga have no curated teams JSON).
# ---------------------------------------------------------------------------

def _fixture_with_ids(fid, home_name, home_id, away_name, away_id, *,
                       status="NS", kickoff="2026-08-21T19:00:00+00:00",
                       round_=None):
    """Like _fixture() above but also carries teams.home/away.id -- the real
    api-sports v3 payload always includes this (_fixture_fields discards it;
    a teams_file=None league needs it to derive Team rows without a second
    /teams HTTP call)."""
    fixture = {
        "fixture": {"id": fid, "date": kickoff, "status": {"short": status}},
        "teams": {
            "home": {"id": home_id, "name": home_name},
            "away": {"id": away_id, "name": away_name},
        },
        "goals": {"home": None, "away": None},
    }
    if round_ is not None:
        fixture["league"] = {"round": round_}
    return fixture


def test_ucl_qualifiers_are_fixtures_not_league_phase_table_rows(db_session, monkeypatch):
    """Before the league-phase draw, qualifiers render and can be predicted,
    but cannot create standings members or tips matchweeks."""
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(
                8801, "Lyon", 80, "Sparta Praha", 628,
                round_="3rd Qualifying Round",
            ),
            _fixture_with_ids(
                8802, "Arsenal", 42, "Real Madrid", 541,
                round_="League Stage - 1",
            ),
            _fixture_with_ids(
                8803, "Arsenal", 42, "Real Madrid", 541,
                round_="Round of 16",
            ),
        ],
    )

    load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        tournament_name="UEFA Champions League 2026-27",
        group_name="Champions League",
        league_id=2,
        season=2026,
        group_round_prefixes=("League Stage",),
    )

    group = db_session.query(Group).filter_by(name="Champions League").one()
    member_names = {
        gt.team.name for gt in db_session.query(GroupTeam).filter_by(group_id=group.id).all()
    }
    assert member_names == {"Arsenal", "Real Madrid"}

    qualifier = db_session.query(Match).filter_by(provider_fixture_id=8801).one()
    assert qualifier.group_id is None
    assert qualifier.stage == "qualifying"
    assert qualifier.matchweek is None

    league_phase = db_session.query(Match).filter_by(provider_fixture_id=8802).one()
    assert league_phase.group_id == group.id
    assert league_phase.stage == "group"
    assert league_phase.matchweek == 1

    knockout = db_session.query(Match).filter_by(provider_fixture_id=8803).one()
    assert knockout.group_id is None
    assert knockout.stage == "knockout"
    assert knockout.matchweek is None


def test_ucl_final_is_neutral_on_create_and_update(db_session, monkeypatch):
    payload = [_fixture_with_ids(8810, "Arsenal", 42, "Real Madrid", 541, round_="Final")]
    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: payload)

    kwargs = {
        "teams_file": None,
        "api_key": "x",
        "tournament_name": "UEFA Champions League 2026-27",
        "group_name": "Champions League",
        "league_id": 2,
        "season": 2026,
        "group_round_prefixes": ("League Stage",),
    }
    load_league_structure(db_session, **kwargs)
    final = db_session.query(Match).filter_by(provider_fixture_id=8810).one()
    assert final.stage == "knockout"
    assert final.is_neutral is True

    final.is_neutral = False
    db_session.commit()
    load_league_structure(db_session, **kwargs)
    assert final.is_neutral is True


def test_derives_teams_from_fixtures_payload_when_no_teams_file(db_session, monkeypatch):
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(9001, "Real Madrid", 541, "Barcelona", 529),
            _fixture_with_ids(9002, "Barcelona", 529, "Atletico Madrid", 530),
        ],
    )
    summary = load_league_structure(
        db_session, teams_file=None, api_key="x",
        tournament_name="La Liga 2026-27", group_name="La Liga",
        league_id=140, season=2026,
    )

    # 3 distinct provider ids across the two fixtures -- no hand-curated list.
    assert summary["teams"] == 3
    assert summary["fixtures_created"] == 2

    real_madrid = db_session.query(Team).filter_by(name="Real Madrid").one()
    assert real_madrid.provider_team_id == 541
    assert real_madrid.country_code is None  # no 3-letter code from a fixtures-only payload

    tournament = db_session.query(Tournament).filter_by(name="La Liga 2026-27").one()
    group = db_session.query(Group).filter_by(tournament_id=tournament.id).one()
    assert group.name == "La Liga"
    assert db_session.query(GroupTeam).filter_by(group_id=group.id).count() == 3

    match = db_session.query(Match).filter_by(provider_fixture_id=9001).one()
    barcelona = db_session.query(Team).filter_by(name="Barcelona").one()
    assert match.team_home_id == real_madrid.id
    assert match.team_away_id == barcelona.id


def test_derived_teams_skip_fixtures_missing_team_id_or_name(db_session, monkeypatch):
    """A malformed team entry (missing id or name) is never guessed -- it's
    simply not one of the derived teams, same posture as _fixture_fields
    skipping a whole malformed fixture."""
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [
            {
                "fixture": {"id": 9101, "date": "2026-08-21T19:00:00+00:00", "status": {"short": "NS"}},
                "teams": {"home": {"id": None, "name": "Mystery FC"}, "away": {"id": 700, "name": "Girona"}},
                "goals": {"home": None, "away": None},
            },
        ],
    )
    summary = load_league_structure(
        db_session, teams_file=None, api_key="x",
        tournament_name="La Liga 2026-27", group_name="La Liga",
        league_id=140, season=2026,
    )
    assert summary["teams"] == 1  # only Girona (id=700) is usable
    assert db_session.query(Team).filter_by(name="Mystery FC").count() == 0
    # The fixture itself is skipped too -- its home side never resolves to a team.
    assert summary["fixtures_skipped"] == 1


def test_upsert_team_reconciles_a_provider_alias_by_id_not_name(db_session, monkeypatch):
    """A provider alias must resolve to the existing provider-team row rather
    than attempting a second insert or replacing its canonical display name."""
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture_with_ids(9301, "Bayern München", 157, "Borussia Dortmund", 165)],
    )
    load_league_structure(
        db_session, teams_file=None, api_key="x",
        tournament_name="Bundesliga 2026-27", group_name="Bundesliga",
        league_id=78, season=2026,
    )
    assert db_session.query(Team).filter_by(provider_team_id=157).one().name == "Bayern München"

    # The provider relabels id 157 on the next ingestion. The alias must land
    # on the same canonical row, not raise or create a duplicate.
    monkeypatch.setattr(
        ls_mod, "fetch_fixtures",
        lambda *a, **k: [_fixture_with_ids(9301, "FC Bayern München", 157, "Borussia Dortmund", 165)],
    )
    load_league_structure(
        db_session, teams_file=None, api_key="x",
        tournament_name="Bundesliga 2026-27", group_name="Bundesliga",
        league_id=78, season=2026,
    )
    renamed = db_session.query(Team).filter_by(provider_team_id=157).one()
    assert renamed.name == "Bayern München"
    assert db_session.query(Team).filter_by(provider_team_id=157).count() == 1


def test_derives_teams_uses_the_same_fetch_fixtures_call_for_teams_and_matches(db_session, monkeypatch):
    """teams_file=None must not need a second HTTP call: one fetch_fixtures
    invocation feeds both team derivation and the fixture upsert."""
    calls = []

    def _fake_fetch(api_key, league, season):
        calls.append((league, season))
        return [_fixture_with_ids(9201, "Villarreal", 533, "Sevilla", 536)]

    monkeypatch.setattr(ls_mod, "fetch_fixtures", _fake_fetch)
    load_league_structure(
        db_session, teams_file=None, api_key="x",
        tournament_name="La Liga 2026-27", group_name="La Liga",
        league_id=140, season=2026,
    )
    assert calls == [(140, 2026)]


def test_football_data_persists_provenance_without_replacing_api_team_ids(
    db_session, monkeypatch,
):
    arsenal = Team(name="Arsenal", provider_team_id=42, is_host=False)
    chelsea = Team(name="Chelsea", provider_team_id=49, is_host=False)
    db_session.add_all([arsenal, chelsea])
    db_session.commit()
    fixture = _normalized_fixture(991, "Arsenal", "Chelsea")
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [fixture],
        raising=False,
    )

    load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    match = db_session.query(Match).one()
    assert match.fixture_provider == "football_data"
    assert match.provider_fixture_id == 991
    stored_updated = match.provider_last_updated
    if stored_updated.tzinfo is None:
        stored_updated = stored_updated.replace(tzinfo=timezone.utc)
    assert stored_updated == datetime(2026, 8, 20, 12, 34, 56, tzinfo=timezone.utc)
    assert db_session.query(Team).filter_by(name="Arsenal").one().provider_team_id == 42
    assert db_session.query(Team).filter_by(name="Chelsea").one().provider_team_id == 49


def test_realistic_football_data_names_switch_the_curated_roster_without_duplicates(
    db_session, monkeypatch,
):
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(1235, "Aston Villa", 66, "Chelsea", 49)
        ],
    )
    load_league_structure(db_session, api_key="x")
    original = db_session.query(Match).one()

    replacement = _normalized_fixture(
        992,
        "Aston Villa FC",
        "Chelsea FC",
        home_id=58,
        away_id=61,
    )
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [replacement],
    )
    summary = load_league_structure(
        db_session,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    assert summary["fixtures_created"] == 0
    assert summary["fixtures_updated"] == 1
    assert db_session.query(Match).count() == 1
    assert db_session.query(Match).one().id == original.id
    assert db_session.query(Team).count() == 20
    assert db_session.query(Team).filter_by(name="Aston Villa").one().provider_team_id == 66
    assert db_session.query(Team).filter_by(name="Chelsea").one().provider_team_id == 49
    assert db_session.query(Team).filter_by(name="Aston Villa FC").count() == 0
    assert db_session.query(Team).filter_by(name="Chelsea FC").count() == 0


def test_promoted_club_names_update_existing_domestic_fixtures(
    db_session, monkeypatch,
):
    kickoff = "2026-08-24T19:30:00+00:00"
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(
                2001,
                "Malaga",
                1200,
                "Deportivo La Coruna",
                1201,
                kickoff=kickoff,
            )
        ],
    )
    load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        tournament_name="La Liga 2026-27",
        group_name="La Liga",
    )

    finished = replace(
        _normalized_fixture(
            564640,
            "Málaga CF",
            "RC Deportivo La Coruña",
            kickoff=kickoff,
            status="finished",
        ),
        score_home=1,
        score_away=1,
        score_home_90=1,
        score_away_90=1,
    )
    monkeypatch.setattr(
        ls_mod, "fetch_league_fixtures", lambda *a, **k: [finished]
    )
    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        tournament_name="La Liga 2026-27",
        group_name="La Liga",
        fixture_source="football_data",
        competition_code="PD",
    )

    assert result["fixtures_created"] == 0
    assert result["fixtures_updated"] == 1
    assert db_session.query(Match).count() == 1
    match = db_session.query(Match).one()
    assert match.status == "finished"
    assert (match.score_home, match.score_away) == (1, 1)
    assert {team.name for team in db_session.query(Team).all()} == {
        "Malaga",
        "Deportivo La Coruna",
    }


def test_ucl_cross_provider_names_reuse_existing_api_teams(db_session, monkeypatch):
    existing = [
        Team(name="Paris Saint Germain", provider_team_id=85),
        Team(name="Inter", provider_team_id=505),
        Team(name="Bodo/Glimt", provider_team_id=327),
        Team(name="Fenerbahce", provider_team_id=611),
        Team(name="FC Copenhagen", provider_team_id=400),
        Team(name="FK Crvena Zvezda", provider_team_id=598),
        Team(name="Ludogorets", provider_team_id=651),
    ]
    db_session.add_all(existing)
    db_session.commit()
    fixtures = [
        _normalized_fixture(
            3001,
            "Paris Saint-Germain FC",
            "FC Internazionale Milano",
            round_label="LEAGUE_STAGE",
        ),
        _normalized_fixture(
            3002,
            "FK Bodø/Glimt",
            "Fenerbahçe SK",
            round_label="LEAGUE_STAGE",
        ),
        _normalized_fixture(
            3003,
            "FC København",
            "Red Star Belgrade",
            round_label="LEAGUE_STAGE",
        ),
        _normalized_fixture(
            3004,
            "PFC Ludogorets 1945",
            "Paris Saint-Germain FC",
            round_label="LEAGUE_STAGE",
        ),
    ]
    monkeypatch.setattr(
        ls_mod, "fetch_league_fixtures", lambda *a, **k: fixtures
    )

    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        tournament_name="UEFA Champions League 2026-27",
        group_name="Champions League",
        fixture_source="football_data",
        competition_code="CL",
        group_round_prefixes=("League Stage",),
    )

    assert result["fixtures_created"] == 4
    assert db_session.query(Team).count() == 7
    assert {
        team.name: team.provider_team_id for team in db_session.query(Team).all()
    } == {
        "Paris Saint Germain": 85,
        "Inter": 505,
        "Bodo/Glimt": 327,
        "Fenerbahce": 611,
        "FC Copenhagen": 400,
        "FK Crvena Zvezda": 598,
        "Ludogorets": 651,
    }
    assert {
        db_session.get(Team, match.team_home_id).name
        for match in db_session.query(Match).all()
    } == {
        "Paris Saint Germain",
        "Bodo/Glimt",
        "FC Copenhagen",
        "Ludogorets",
    }


def test_ambiguous_club_identity_remains_ambiguous_after_new_team_insert(
    db_session,
):
    db_session.add_all([Team(name="FC Example"), Team(name="Example FC")])
    db_session.flush()
    identity_index = ls_mod._club_identity_index(db_session)

    first = ls_mod._upsert_team(
        db_session, "Example CF", None, None, identity_index
    )
    second = ls_mod._upsert_team(
        db_session, "Example AFC", None, None, identity_index
    )

    assert first.id != second.id
    assert db_session.query(Team).count() == 4


def test_stale_or_unversioned_fixture_cannot_regress_finished_match(
    db_session, monkeypatch,
):
    fresh = replace(
        _normalized_fixture(
            993,
            "Arsenal",
            "Chelsea",
            status="finished",
            updated="2026-08-21T21:00:00+00:00",
        ),
        score_home=2,
        score_away=1,
        score_home_90=2,
        score_away_90=1,
    )
    monkeypatch.setattr(ls_mod, "fetch_league_fixtures", lambda *a, **k: [fresh])
    load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    for stale in (
        _normalized_fixture(
            993,
            "Arsenal",
            "Chelsea",
            updated="2026-08-21T20:00:00+00:00",
        ),
        replace(
            _normalized_fixture(993, "Arsenal", "Chelsea"),
            upstream_updated_at=None,
        ),
    ):
        monkeypatch.setattr(
            ls_mod,
            "fetch_league_fixtures",
            lambda *a, _stale=stale, **k: [_stale],
        )
        result = load_league_structure(
            db_session,
            teams_file=None,
            api_key="x",
            fixture_source="football_data",
            competition_code="PL",
        )
        assert result["fixtures_skipped"] == 1

    match = db_session.query(Match).one()
    assert (match.status, match.score_home, match.score_away) == ("finished", 2, 1)
    stored_updated = match.provider_last_updated
    if stored_updated.tzinfo is None:
        stored_updated = stored_updated.replace(tzinfo=timezone.utc)
    assert stored_updated == datetime(2026, 8, 21, 21, 0, tzinfo=timezone.utc)


def test_unversioned_provider_reactivation_adopts_identity_without_regressing_state(
    db_session, monkeypatch,
):
    fallback = replace(
        _normalized_fixture(
            996,
            "Arsenal",
            "Chelsea",
            status="finished",
            updated="2026-08-21T21:00:00+00:00",
        ),
        score_home=2,
        score_away=1,
    )
    monkeypatch.setattr(
        ls_mod, "fetch_league_fixtures", lambda *a, **k: [fallback]
    )
    load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    api_fixture = replace(
        fallback,
        provider="api_football",
        fixture_id=1996,
        status="scheduled",
        score_home=None,
        score_away=None,
        upstream_updated_at=None,
        home_provider_id=42,
        away_provider_id=49,
    )
    monkeypatch.setattr(
        ls_mod, "fetch_league_fixtures", lambda *a, **k: [api_fixture]
    )
    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="api_football",
    )

    match = db_session.query(Match).one()
    assert result["fixtures_updated"] == 1
    assert match.fixture_provider == "api_football"
    assert match.provider_fixture_id == 1996
    assert (match.status, match.score_home, match.score_away) == ("finished", 2, 1)
    assert match.provider_last_updated is None

    # Clearing the old provider's watermark must not make a later unversioned
    # scheduled snapshot able to un-finish the match.
    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="api_football",
    )
    match = db_session.query(Match).one()
    assert result["fixtures_skipped"] == 1
    assert (match.status, match.score_home, match.score_away) == ("finished", 2, 1)

    refreshed_api_fixture = replace(
        api_fixture,
        status="finished",
        score_home=3,
        score_away=0,
        score_home_90=3,
        score_away_90=0,
    )
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [refreshed_api_fixture],
    )
    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="api_football",
    )

    match = db_session.query(Match).one()
    assert result["fixtures_updated"] == 1
    assert result["fixtures_skipped"] == 0
    assert (match.status, match.score_home, match.score_away) == ("finished", 3, 0)


def test_duplicate_fixture_in_one_payload_reconciles_to_one_match(
    db_session, monkeypatch,
):
    fixture = _normalized_fixture(994, "Arsenal", "Chelsea")
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [fixture, fixture],
    )

    result = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    assert result["fixtures_created"] == 1
    assert result["fixtures_updated"] == 1
    assert db_session.query(Match).count() == 1


def test_database_rejects_duplicate_provider_fixture_identity(db_session):
    tournament = Tournament(name="Identity constraint", year=2026)
    db_session.add(tournament)
    db_session.flush()
    attrs = {
        "tournament_id": tournament.id,
        "stage": "group",
        "status": "scheduled",
        "fixture_provider": "football_data",
        "provider_fixture_id": 995,
    }
    db_session.add_all([Match(**attrs), Match(**attrs)])

    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()


def test_provider_switch_updates_one_match_and_preserves_prediction(
    db_session, monkeypatch,
):
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(1234, "Arsenal", 42, "Chelsea", 49)
        ],
    )
    load_league_structure(db_session, teams_file=None, api_key="x")
    original = db_session.query(Match).one()
    prediction = Prediction(
        match_id=original.id,
        model_version="poisson-elo-v0.5",
        prob_home_win=0.55,
        prob_draw=0.25,
        prob_away_win=0.20,
        predicted_score_home=2,
        predicted_score_away=1,
        is_shadow=False,
    )
    db_session.add(prediction)
    db_session.commit()
    prediction_id = prediction.id

    replacement = _normalized_fixture(991, "Arsenal", "Chelsea")
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [replacement],
        raising=False,
    )
    summary = load_league_structure(
        db_session,
        teams_file=None,
        api_key="x",
        fixture_source="football_data",
        competition_code="PL",
    )

    assert summary["fixtures_created"] == 0
    assert summary["fixtures_updated"] == 1
    assert db_session.query(Match).count() == 1
    switched = db_session.query(Match).one()
    assert switched.id == original.id
    assert switched.fixture_provider == "football_data"
    assert switched.provider_fixture_id == 991
    persisted_prediction = db_session.get(Prediction, prediction_id)
    assert persisted_prediction.match_id == switched.id
    assert persisted_prediction.model_version == "poisson-elo-v0.5"
    assert (
        persisted_prediction.prob_home_win,
        persisted_prediction.prob_draw,
        persisted_prediction.prob_away_win,
    ) == (0.55, 0.25, 0.20)
    assert db_session.query(Prediction).count() == 1


def test_repeated_pair_reconciles_only_unique_fixture_within_48_hours(
    db_session, monkeypatch,
):
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(
                7001,
                "Arsenal",
                42,
                "Real Madrid",
                541,
                kickoff="2026-09-01T19:00:00+00:00",
                round_="League Stage - 1",
            ),
            _fixture_with_ids(
                7002,
                "Arsenal",
                42,
                "Real Madrid",
                541,
                kickoff="2027-03-10T19:00:00+00:00",
                round_="Round of 16",
            ),
        ],
    )
    kwargs = {
        "teams_file": None,
        "api_key": "x",
        "tournament_name": "UEFA Champions League 2026-27",
        "group_name": "Champions League",
        "league_id": 2,
        "season": 2026,
        "group_round_prefixes": ("League Stage",),
    }
    load_league_structure(db_session, **kwargs)
    first_match_id = (
        db_session.query(Match).filter_by(provider_fixture_id=7001).one().id
    )

    replacement = _normalized_fixture(
        9901,
        "Arsenal",
        "Real Madrid",
        kickoff="2026-09-02T19:00:00+00:00",
        round_label="LEAGUE_STAGE",
    )
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [replacement],
        raising=False,
    )
    summary = load_league_structure(
        db_session,
        **kwargs,
        fixture_source="football_data",
        competition_code="CL",
    )

    assert summary["fixtures_created"] == 0
    assert summary["fixtures_updated"] == 1
    assert db_session.query(Match).count() == 2
    reconciled = db_session.query(Match).filter_by(provider_fixture_id=9901).one()
    assert reconciled.id == first_match_id
    assert reconciled.fixture_provider == "football_data"


def test_repeated_ucl_pair_with_two_near_kickoffs_is_rejected(
    db_session, monkeypatch,
):
    monkeypatch.setattr(
        ls_mod,
        "fetch_fixtures",
        lambda *a, **k: [
            _fixture_with_ids(
                7101,
                "Arsenal",
                42,
                "Real Madrid",
                541,
                kickoff="2026-09-01T19:00:00+00:00",
                round_="League Stage - 1",
            ),
            _fixture_with_ids(
                7102,
                "Arsenal",
                42,
                "Real Madrid",
                541,
                kickoff="2026-09-03T19:00:00+00:00",
                round_="League Stage - 2",
            ),
        ],
    )
    kwargs = {
        "teams_file": None,
        "api_key": "x",
        "tournament_name": "UEFA Champions League 2026-27",
        "group_name": "Champions League",
        "league_id": 2,
        "season": 2026,
        "group_round_prefixes": ("League Stage",),
    }
    load_league_structure(db_session, **kwargs)
    original_ids = {
        row.id: row.provider_fixture_id for row in db_session.query(Match).all()
    }

    replacement = _normalized_fixture(
        9902,
        "Arsenal",
        "Real Madrid",
        kickoff="2026-09-02T19:00:00+00:00",
        round_label="LEAGUE_STAGE",
    )
    monkeypatch.setattr(
        ls_mod,
        "fetch_league_fixtures",
        lambda *a, **k: [replacement],
        raising=False,
    )

    with pytest.raises(
        ls_mod.FixtureReconciliationError,
        match="ambiguous fixture reconciliation",
    ):
        load_league_structure(
            db_session,
            **kwargs,
            fixture_source="football_data",
            competition_code="CL",
        )
    db_session.rollback()
    assert {
        row.id: row.provider_fixture_id for row in db_session.query(Match).all()
    } == original_ids
