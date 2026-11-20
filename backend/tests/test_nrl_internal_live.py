from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings
from app.db import Base, get_db
from app.main import app
from app.models import SportMatch, SportTeam, TipPlayer, UserTip
from pipeline.sports.nrl_fixture_provider import RecordedFixtureStatsProvider
from pipeline.sports.nrl_stats import LivePayload


def _client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app)


def test_nrl_refresh_live_fails_closed_without_token(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "")
    client = _client()
    try:
        assert client.post("/api/internal/nrl-refresh-live").status_code == 503
    finally:
        app.dependency_overrides.clear()


def test_nrl_refresh_live_rejects_bad_token(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "secret")
    client = _client()
    try:
        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "wrong"})
        assert r.status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_nrl_refresh_live_ok_with_token(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "secret")
    client = _client()
    try:
        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "secret"})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "ok"
        assert body["live"] == {"candidates": 0, "polled": 0, "finished": 0, "next_kickoff_in_seconds": None}
    finally:
        app.dependency_overrides.clear()


def _client_and_session():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        s = TestingSession()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    return TestClient(app), TestingSession


def _seed_match_with_a_tip(TestingSession):
    """An NRL match 90 minutes in (inside the poller's window), still
    `scheduled` as ingest leaves it, with one pre-kickoff tip on the home
    side."""
    db = TestingSession()
    storm, eels = SportTeam(sport="nrl", name="Storm"), SportTeam(sport="nrl", name="Eels")
    db.add_all([storm, eels])
    db.flush()
    kickoff = datetime.now(timezone.utc) - timedelta(minutes=90)
    match = SportMatch(sport="nrl", season=2026, round=9, match_no=1, kickoff_utc=kickoff,
                       home_team_id=storm.id, away_team_id=eels.id, status="scheduled")
    player = TipPlayer(device_id="3fa85f64-5717-4562-b3fc-2c963f66afa6", handle="FullTimeTipper")
    db.add_all([match, player])
    db.flush()
    db.add(UserTip(match_id=match.id, player_id=player.id, pick="home",
                   updated_at=kickoff - timedelta(days=1)))
    db.commit()
    ids = match.id, player.id
    db.close()
    return ids


def _full_time_feed(monkeypatch):
    """The endpoint builds NrlComStatsProvider at call time; swap in a
    recorded feed where round 9's match has just gone full time, 22-10."""
    import pipeline.sports.nrl_stats as nrl_stats

    feed = RecordedFixtureStatsProvider(live={
        (2026, 9, 1): LivePayload(status="final", minute=80, score_home=22, score_away=10),
    })
    monkeypatch.setattr(nrl_stats, "NrlComStatsProvider", lambda team_names=None: feed)


def test_a_poll_that_finishes_a_match_grades_its_tips_in_the_same_request(monkeypatch):
    """The poll that takes a match to full time also grades the tips on it,
    so tippers get their point now -- not hours later from nrl-refresh,
    while the beat-the-model boards hold the match back until they do."""
    monkeypatch.setattr(settings, "recompute_token", "secret")
    _full_time_feed(monkeypatch)
    client, TestingSession = _client_and_session()
    try:
        match_id, player_id = _seed_match_with_a_tip(TestingSession)

        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "secret"})

        assert r.status_code == 200, r.text
        assert r.json()["live"] == {"candidates": 1, "polled": 1, "finished": 1,
                                    "tips_graded": {"graded": 1}, "next_kickoff_in_seconds": None}
        db = TestingSession()
        match = db.get(SportMatch, match_id)
        assert (match.status, match.score_home, match.score_away) == ("finished", 22, 10)
        tip = db.query(UserTip).filter_by(match_id=match_id, player_id=player_id).one()
        assert tip.points == 1 and tip.graded_at is not None
        db.close()
    finally:
        app.dependency_overrides.clear()


def test_a_tips_grading_failure_never_fails_the_poll(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "secret")
    _full_time_feed(monkeypatch)

    def boom(db, sport="nrl"):
        raise RuntimeError("grading blew up")

    monkeypatch.setattr("pipeline.sports.nrl_user_tips.grade", boom)
    client, TestingSession = _client_and_session()
    try:
        match_id, player_id = _seed_match_with_a_tip(TestingSession)

        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "secret"})

        assert r.status_code == 200, r.text
        live = r.json()["live"]
        assert live["finished"] == 1
        assert live["tips_graded"] == {"graded": 0, "error": True}
        db = TestingSession()
        assert db.get(SportMatch, match_id).status == "finished"  # the poll's own write stands
        assert db.query(UserTip).filter_by(match_id=match_id).one().graded_at is None
        db.close()
    finally:
        app.dependency_overrides.clear()


def test_nrl_refresh_live_does_not_clear_cache_when_nothing_polled(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "secret")

    import pipeline.sports.nrl_live_poll as nrl_live_poll_module

    monkeypatch.setattr(
        nrl_live_poll_module, "poll_live_matches",
        lambda db, provider: {"candidates": 1, "polled": 0},
    )

    from app.api import internal as internal_module

    cleared = []
    monkeypatch.setattr(internal_module.cache, "clear", lambda: cleared.append(True))

    client = _client()
    try:
        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "secret"})
        assert r.status_code == 200
        assert r.json()["live"] == {"candidates": 1, "polled": 0}
        assert cleared == []
    finally:
        app.dependency_overrides.clear()


def test_nrl_refresh_live_clears_cache_when_something_polled(monkeypatch):
    monkeypatch.setattr(settings, "recompute_token", "secret")

    import pipeline.sports.nrl_live_poll as nrl_live_poll_module

    monkeypatch.setattr(
        nrl_live_poll_module, "poll_live_matches",
        lambda db, provider: {"candidates": 1, "polled": 1},
    )

    from app.api import internal as internal_module

    cleared = []
    monkeypatch.setattr(internal_module.cache, "clear", lambda: cleared.append(True))

    client = _client()
    try:
        r = client.post("/api/internal/nrl-refresh-live", headers={"X-Recompute-Token": "secret"})
        assert r.status_code == 200
        assert r.json()["live"] == {"candidates": 1, "polled": 1}
        assert cleared == [True]
    finally:
        app.dependency_overrides.clear()
