"""`matchweek` on the match summary (GET /api/matches/{id}/summary and
/api/matches/upcoming) and the prediction payload (GET /api/matches/{id},
GET /api/predictions/{id}) -- UX rebuild plan 2026-11, Phase 0: the match page
finds the device's scoreline tip for this match by its matchweek instead of
walking matchweeks. Match.matchweek is a DEFERRED column, so the polled
upcoming list must load it inside its own query, never once per row."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.cache import cache
from app.db import Base, get_db
from app.main import app
from app.models import Match, Prediction, Team, Tournament
from pipeline.leagues import LEAGUES

EPL_NAME = LEAGUES["epl"]["tournament_name"]


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
    yield TestClient(app), TestingSession, engine
    app.dependency_overrides.clear()
    cache.clear()


def _seed_match(db, tournament, matchweek, kickoff, home, away):
    m = Match(
        tournament_id=tournament.id, team_home_id=home.id, team_away_id=away.id,
        stage="group", matchweek=matchweek, kickoff_utc=kickoff, status="scheduled",
    )
    db.add(m)
    db.flush()
    db.add(Prediction(
        match_id=m.id, model_version="poisson-elo-club-v0.1",
        created_at=kickoff - timedelta(days=1),
        prob_home_win=0.5, prob_draw=0.25, prob_away_win=0.25,
        predicted_score_home=1, predicted_score_away=0, predicted_score_prob=0.12,
    ))
    db.flush()
    return m


def _teams(db, *names):
    teams = [Team(name=n) for n in names]
    db.add_all(teams)
    db.flush()
    return teams


def test_summary_and_prediction_payloads_carry_the_matchweek(client):
    c, TestingSession, _ = client
    db = TestingSession()
    epl = Tournament(name=EPL_NAME, year=2026)
    db.add(epl)
    db.flush()
    ars, che = _teams(db, "Arsenal", "Chelsea")
    m = _seed_match(db, epl, 11, datetime.now(timezone.utc) + timedelta(days=2), ars, che)
    db.commit()

    summary = c.get(f"/api/matches/{m.id}/summary")
    assert summary.status_code == 200, summary.text
    assert summary.json()["matchweek"] == 11

    detail = c.get(f"/api/matches/{m.id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["matchweek"] == 11

    prediction = c.get(f"/api/predictions/{m.id}")
    assert prediction.status_code == 200, prediction.text
    assert prediction.json()["current"]["matchweek"] == 11


def test_matchweek_is_null_for_a_match_without_one(client):
    """World Cup fixtures have no matchweek (the column is league-only)."""
    c, TestingSession, _ = client
    db = TestingSession()
    wc = Tournament(name="FIFA World Cup 2026", year=2026)
    db.add(wc)
    db.flush()
    mex, rsa = _teams(db, "Mexico", "South Africa")
    m = _seed_match(db, wc, None, datetime.now(timezone.utc) + timedelta(days=2), mex, rsa)
    db.commit()

    assert c.get(f"/api/matches/{m.id}/summary").json()["matchweek"] is None
    assert c.get(f"/api/matches/{m.id}").json()["matchweek"] is None


def test_upcoming_carries_each_rows_matchweek_without_a_query_per_row(client):
    c, TestingSession, engine = client
    db = TestingSession()
    epl = Tournament(name=EPL_NAME, year=2026)
    db.add(epl)
    db.flush()
    teams = _teams(db, *(f"Club {i}" for i in range(20)))
    start = datetime.now(timezone.utc) + timedelta(days=1)

    def seed(first, count):
        for i in range(first, first + count):
            _seed_match(db, epl, i // 10 + 1, start + timedelta(hours=i),
                        teams[i % 20], teams[(i + 1) % 20])
        db.commit()

    statements = []
    event.listen(engine, "before_cursor_execute", lambda *args, **kw: statements.append(args[2]))

    def upcoming():
        cache.clear()
        statements.clear()
        r = c.get("/api/matches/upcoming")
        assert r.status_code == 200, r.text
        return r.json(), len(statements)

    seed(0, 3)
    rows, few_matches_sql = upcoming()
    assert [row["matchweek"] for row in rows] == [1, 1, 1]

    seed(3, 27)
    rows, many_matches_sql = upcoming()
    assert [row["matchweek"] for row in rows] == [i // 10 + 1 for i in range(30)]
    assert many_matches_sql == few_matches_sql  # 10x the rows, not 10x the queries
