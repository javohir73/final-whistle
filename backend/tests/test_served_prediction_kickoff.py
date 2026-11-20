"""Served predictions are pre-match prices (audit 2026-11-20).

A fixture stuck "scheduled" after kickoff used to be re-predicted on every run,
and every read that presents "the match's prediction" served the newest row --
so 1,942 post-whistle rows were shown as the forecast. Each of those reads now
applies serializers.created_by_kickoff, the rule grading already uses
(learning_loop._frozen_prediction). An upcoming match, or one with no kickoff,
is unchanged; a started match with only post-kickoff rows has no prediction.
"""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.cache import cache
from app.db import Base, get_db
from app.main import app
from app.models import Match, Prediction, Team, Tournament
from app.serializers import latest_prediction

KICKOFF = datetime(2026, 9, 12, 14, 0)  # naive UTC, as SQLite returns it
FUTURE = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=30)


def _pred(match_id: int, created_at: datetime, p_home: float, *, shadow=False) -> Prediction:
    return Prediction(
        match_id=match_id, model_version="poisson-elo-club-v0.3", created_at=created_at,
        prob_home_win=p_home, prob_draw=0.25, prob_away_win=0.75 - p_home,
        predicted_score_home=1, predicted_score_away=0, predicted_score_prob=0.1,
        confidence="Medium", reasons=["r"], top_features=[], is_shadow=shadow,
    )


@pytest.fixture
def seeded():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)
    db = Session()
    t = Tournament(name="La Liga 2026-27", year=2026, host_countries="",
                   home_advantage_mode="home")
    db.add(t)
    db.flush()
    teams = [Team(name=n, is_host=False) for n in ("Getafe", "Racing Santander", "Elche", "Valencia")]
    db.add_all(teams)
    db.flush()

    def match(kickoff, status="scheduled", **kw):
        m = Match(tournament_id=t.id, stage="group", status=status, kickoff_utc=kickoff,
                  team_home_id=teams[0].id, team_away_id=teams[1].id, **kw)
        db.add(m)
        db.flush()
        return m

    stuck = match(KICKOFF)                      # still "scheduled" after kickoff
    finished = match(KICKOFF, status="finished", score_home=2, score_away=0)
    only_post = match(KICKOFF, status="finished", score_home=1, score_away=1)
    upcoming = match(FUTURE)
    no_kickoff = match(None)
    db.add_all([
        _pred(stuck.id, KICKOFF - timedelta(days=2), 0.40),
        _pred(stuck.id, KICKOFF - timedelta(hours=3), 0.45),   # the frozen row
        _pred(stuck.id, KICKOFF + timedelta(days=1), 0.60),    # after the whistle
        _pred(stuck.id, KICKOFF + timedelta(days=5), 0.65),
        _pred(stuck.id, KICKOFF - timedelta(hours=1), 0.99, shadow=True),
        _pred(finished.id, KICKOFF - timedelta(hours=6), 0.50),
        _pred(finished.id, KICKOFF + timedelta(hours=1), 0.70),
        _pred(only_post.id, KICKOFF + timedelta(days=1), 0.55),
        _pred(upcoming.id, FUTURE - timedelta(days=9), 0.30),
        _pred(upcoming.id, FUTURE - timedelta(days=8), 0.35),
        _pred(no_kickoff.id, KICKOFF, 0.20),
        _pred(no_kickoff.id, KICKOFF + timedelta(days=3), 0.22),
    ])
    db.commit()
    ids = {"stuck": stuck.id, "finished": finished.id, "only_post": only_post.id,
           "upcoming": upcoming.id, "no_kickoff": no_kickoff.id}

    def override_get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    cache.clear()
    yield TestClient(app), db, ids
    app.dependency_overrides.clear()
    cache.clear()
    db.close()


def test_latest_prediction_is_the_last_row_written_by_kickoff(seeded):
    _client, db, ids = seeded
    assert latest_prediction(db, ids["stuck"]).prob_home_win == 0.45
    assert latest_prediction(db, ids["finished"]).prob_home_win == 0.50
    # Unchanged where kickoff has not passed or is unknown.
    assert latest_prediction(db, ids["upcoming"]).prob_home_win == 0.35
    assert latest_prediction(db, ids["no_kickoff"]).prob_home_win == 0.22
    # Only post-kickoff rows: nothing to present, as grading has nothing to score.
    assert latest_prediction(db, ids["only_post"]) is None


def test_match_board_serves_the_pre_kickoff_row(seeded):
    client, _db, ids = seeded
    rows = {r["match_id"]: r for r in client.get("/api/matches/upcoming").json()}
    assert rows[ids["stuck"]]["probabilities"]["home_win"] == 0.45
    assert rows[ids["finished"]]["probabilities"]["home_win"] == 0.50
    assert rows[ids["upcoming"]]["probabilities"]["home_win"] == 0.35
    assert rows[ids["no_kickoff"]]["probabilities"]["home_win"] == 0.22
    only_post = rows[ids["only_post"]]
    assert only_post["probabilities"] is None and only_post["predicted_score"] is None
    # The finished result is still on the board.
    assert (only_post["score_home"], only_post["score_away"]) == (1, 1)


def test_match_detail_and_summary_serve_the_pre_kickoff_row(seeded):
    client, _db, ids = seeded
    detail = client.get(f"/api/matches/{ids['stuck']}").json()
    assert detail["probabilities"]["home_win"] == 0.45
    summary = client.get(f"/api/matches/{ids['finished']}/summary").json()
    assert summary["probabilities"]["home_win"] == 0.50
    missing = client.get(f"/api/matches/{ids['only_post']}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "no_prediction"
    assert client.get(f"/api/matches/{ids['only_post']}/summary").json()["probabilities"] is None


def test_prediction_history_stops_at_kickoff(seeded):
    client, _db, ids = seeded
    body = client.get(f"/api/predictions/{ids['stuck']}").json()
    assert body["current"]["probabilities"]["home_win"] == 0.45
    assert [p["home_win"] for p in body["history"]] == [0.40, 0.45]
    upcoming = client.get(f"/api/predictions/{ids['upcoming']}").json()
    assert [p["home_win"] for p in upcoming["history"]] == [0.30, 0.35]
    assert client.get(f"/api/predictions/{ids['only_post']}").status_code == 404


def test_prob_history_draws_no_post_kickoff_point(seeded):
    client, _db, ids = seeded
    points = client.get(f"/api/matches/{ids['stuck']}/prob-history").json()["points"]
    assert [p["p_home"] for p in points] == [0.40, 0.45]
    assert all(p["date"] <= KICKOFF.isoformat() for p in points)
    assert client.get(f"/api/matches/{ids['only_post']}/prob-history").json()["points"] == []
    future = client.get(f"/api/matches/{ids['upcoming']}/prob-history").json()["points"]
    assert [p["p_home"] for p in future] == [0.30, 0.35]
