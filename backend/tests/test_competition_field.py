"""`competition` on the match summary (GET /api/matches/{id}/summary and
/api/matches/upcoming) and the team profile (GET /api/teams/{id}) -- UX
rebuild plan 2026-11, Phase 0. The frontend resolves a bare /match/:id or
/team/:id link to its /football/{competition}/... page from this field, so
it is the reverse of app.competition_scope.COMPETITION_TOURNAMENT_NAMES: a
tournament with no public code (or no tournament at all) is None, never an
error."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.cache import cache
from app.competition_scope import COMPETITION_TOURNAMENT_NAMES, competition_for_tournament
from app.db import Base, get_db
from app.main import app
from app.models import Group, GroupTeam, Match, Team, Tournament
from pipeline.leagues import LEAGUES

WC26_NAME = "FIFA World Cup 2026"
EPL_NAME = LEAGUES["epl"]["tournament_name"]
LALIGA_NAME = LEAGUES["laliga"]["tournament_name"]
BUNDESLIGA_NAME = LEAGUES["bundesliga"]["tournament_name"]
UCL_NAME = LEAGUES["ucl"]["tournament_name"]


@pytest.fixture
def client():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    cache.clear()
    yield TestClient(app), TestingSession
    app.dependency_overrides.clear()
    cache.clear()


def _tournament(db, name, year=2026):
    t = Tournament(name=name, year=year)
    db.add(t)
    db.flush()
    return t


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.flush()
    return t


def _match(db, tournament, home, away, **kw):
    m = Match(
        tournament_id=tournament.id, team_home_id=home.id, team_away_id=away.id,
        stage=kw.pop("stage", "group"),
        kickoff_utc=kw.pop("kickoff_utc", datetime.now(timezone.utc) + timedelta(days=1)),
        status=kw.pop("status", "scheduled"), **kw,
    )
    db.add(m)
    db.flush()
    return m


def _member(db, tournament, team, group_name):
    group = db.query(Group).filter_by(tournament_id=tournament.id, name=group_name).one_or_none()
    if group is None:
        group = Group(tournament_id=tournament.id, name=group_name)
        db.add(group)
        db.flush()
    db.add(GroupTeam(group_id=group.id, team_id=team.id))
    db.flush()


# ---------------------------------------------------------------------------
# competition_for_tournament -- the reverse map
# ---------------------------------------------------------------------------

def test_competition_for_tournament_reverse_maps_every_public_code():
    assert COMPETITION_TOURNAMENT_NAMES["wc26"] == WC26_NAME
    for code, name in COMPETITION_TOURNAMENT_NAMES.items():
        assert competition_for_tournament(name) == code
        assert competition_for_tournament(Tournament(name=name, year=2026)) == code


def test_competition_for_tournament_is_none_for_anything_unmapped():
    assert competition_for_tournament("Premier League 2025-26") is None  # last season: no public code
    assert competition_for_tournament(Tournament(name="Club Friendlies 2026", year=2026)) is None
    assert competition_for_tournament("") is None
    assert competition_for_tournament(None) is None


# ---------------------------------------------------------------------------
# match summary
# ---------------------------------------------------------------------------

def test_match_summary_names_the_wc26_competition(client):
    c, TestingSession = client
    db = TestingSession()
    wc = _tournament(db, WC26_NAME)
    m = _match(db, wc, _team(db, "Mexico"), _team(db, "South Africa"),
               status="finished", score_home=2, score_away=0)
    db.commit()

    r = c.get(f"/api/matches/{m.id}/summary")

    assert r.status_code == 200, r.text
    assert r.json()["competition"] == "wc26"


def test_match_summary_and_upcoming_name_the_epl_competition(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _tournament(db, EPL_NAME)
    m = _match(db, epl, _team(db, "Arsenal"), _team(db, "Chelsea"))
    db.commit()

    summary = c.get(f"/api/matches/{m.id}/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["competition"] == "epl"

    for params in ({}, {"competition": "epl"}):
        upcoming = c.get("/api/matches/upcoming", params=params)
        assert upcoming.status_code == 200, upcoming.text
        assert [(row["match_id"], row["competition"]) for row in upcoming.json()] == [(m.id, "epl")]


def test_match_summary_competition_is_null_for_an_unmapped_tournament(client):
    c, TestingSession = client
    db = TestingSession()
    friendlies = _tournament(db, "Club Friendlies 2026")
    m = _match(db, friendlies, _team(db, "Home FC"), _team(db, "Away FC"))
    db.commit()

    r = c.get(f"/api/matches/{m.id}/summary")

    assert r.status_code == 200, r.text
    assert r.json()["competition"] is None


# ---------------------------------------------------------------------------
# team profile
# ---------------------------------------------------------------------------

def test_team_profile_names_the_competition_from_group_membership(client):
    c, TestingSession = client
    db = TestingSession()
    wc = _tournament(db, WC26_NAME)
    mexico = _team(db, "Mexico")
    _member(db, wc, mexico, "Group A")
    db.commit()

    r = c.get(f"/api/teams/{mexico.id}")

    assert r.status_code == 200, r.text
    assert r.json()["competition"] == "wc26"


def test_team_profile_names_the_competition_from_fixtures_alone(client):
    """Same membership rule as /api/teams?competition=...: a team with
    fixtures in a tournament belongs to it even with no GroupTeam row (cup
    qualifiers never enter the table)."""
    c, TestingSession = client
    db = TestingSession()
    epl = _tournament(db, EPL_NAME)
    arsenal = _team(db, "Arsenal")
    _match(db, epl, arsenal, _team(db, "Chelsea"))
    db.commit()

    r = c.get(f"/api/teams/{arsenal.id}")

    assert r.status_code == 200, r.text
    assert r.json()["competition"] == "epl"


def test_team_profile_prefers_the_domestic_league_over_a_cross_border_cup(client):
    """A club in its league and the Champions League resolves to the league,
    even though the cup's tournament row is newer and its next fixture is the
    cup's: the cup shares the league's Team rows (owns_served_rating=False).
    An explicit ?competition= is echoed back as asked."""
    c, TestingSession = client
    db = TestingSession()
    epl = _tournament(db, EPL_NAME)
    ucl = _tournament(db, UCL_NAME)  # created later: the higher id
    arsenal = _team(db, "Arsenal")
    _member(db, epl, arsenal, "Premier League")
    _member(db, ucl, arsenal, "Champions League")
    _match(db, ucl, arsenal, _team(db, "Inter"), kickoff_utc=datetime.now(timezone.utc) + timedelta(hours=6))
    _match(db, epl, arsenal, _team(db, "Chelsea"), kickoff_utc=datetime.now(timezone.utc) + timedelta(days=4))
    db.commit()

    assert c.get(f"/api/teams/{arsenal.id}").json()["competition"] == "epl"
    assert c.get(f"/api/teams/{arsenal.id}", params={"competition": "ucl"}).json()["competition"] == "ucl"


def test_team_profile_cup_only_club_resolves_to_the_cup(client):
    c, TestingSession = client
    db = TestingSession()
    ucl = _tournament(db, UCL_NAME)
    sparta = _team(db, "Sparta Praha")
    _match(db, ucl, sparta, _team(db, "Lyon"), stage="qualifying")
    db.commit()

    assert c.get(f"/api/teams/{sparta.id}").json()["competition"] == "ucl"


def test_team_profile_latest_tournament_wins_between_two_of_a_kind(client):
    """Not a real-world case today (one season per code is mapped), but the
    rule must be deterministic: the later tournament year wins, ahead of row
    age."""
    c, TestingSession = client
    db = TestingSession()
    later = _tournament(db, LALIGA_NAME, year=2027)
    earlier = _tournament(db, BUNDESLIGA_NAME, year=2026)  # higher id, earlier year
    club = _team(db, "Wandering FC")
    _member(db, later, club, "La Liga")
    _member(db, earlier, club, "Bundesliga")
    db.commit()

    assert c.get(f"/api/teams/{club.id}").json()["competition"] == "laliga"


def test_team_profile_competition_is_null_without_a_mapped_tournament(client):
    c, TestingSession = client
    db = TestingSession()
    friendlies = _tournament(db, "Club Friendlies 2026")
    lonely = _team(db, "Lonely FC")  # in no tournament at all
    guest = _team(db, "Guest FC")
    _match(db, friendlies, guest, _team(db, "Host FC"))
    _member(db, friendlies, guest, "Friendlies")
    db.commit()

    for team in (lonely, guest):
        r = c.get(f"/api/teams/{team.id}")
        assert r.status_code == 200, r.text
        assert r.json()["competition"] is None
