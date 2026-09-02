"""Tests for the health endpoint (task 1.10)."""
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from ml.models.params import load_params

client = TestClient(app)


def test_health_returns_200_and_payload():
    res = client.get("/api/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert body["app"] == "FinalWhistle"
    assert "model_version" in body


def test_health_model_version_matches_load_params():
    """Health must report whatever ml/models/model_params.json actually says
    (via app.model_meta.current_model_version()), not the app/config.py
    settings default or a stale env pin — regression test for the v0.1/v0.4/
    v0.5 label-drift fix. Asserted against load_params() itself (not a
    hardcoded string) so a future version bump can't silently break this."""
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json()["model_version"] == load_params().version


def _client_with_db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
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


def _seed_healthy_fixture_feeds(session_factory):
    from datetime import datetime, timezone

    from app.models import FixtureFeedStatus
    from pipeline.ingest.fixture_contract import capabilities_for
    from pipeline.leagues import LEAGUES

    s = session_factory()
    now = datetime.now(timezone.utc)
    for code, cfg in LEAGUES.items():
        s.add(FixtureFeedStatus(
            competition_code=code,
            tournament_name=cfg["tournament_name"],
            provider="football_data",
            last_attempt_at=now,
            last_success_at=now,
            last_error_at=None,
            last_error_kind=None,
            last_error=None,
            fixture_count=10,
            latest_upstream_updated_at=now,
            capabilities=capabilities_for("football_data"),
        ))
    s.commit()
    s.close()


def test_health_reports_learning_chain_heartbeat():
    """Silent chain deaths are invisible in responses by design — /api/health
    must surface the last attempt/success/error and whether work is owed."""
    from app.models import Match

    c, session_factory = _client_with_db()
    try:
        chain = c.get("/api/health").json()["learning_chain"]
        assert chain["pending"] is False  # empty DB: nothing owed
        assert chain["last_success_at"] is None

        # A finished match no chain has covered => pending flips true.
        s = session_factory()
        s.add(Match(tournament_id=1, stage="R32", status="finished",
                    score_home=1, score_away=0, team_home_id=1, team_away_id=2))
        s.commit()

        chain = c.get("/api/health").json()["learning_chain"]
        assert chain["pending"] is True

        # A completed chain covers it and stamps success.
        from app.chain_status import record_success
        record_success(s, covered_finished=1, trigger="test")
        s.close()

        chain = c.get("/api/health").json()["learning_chain"]
        assert chain["pending"] is False
        assert chain["last_success_at"] is not None
        assert chain["last_trigger"] == "test"
    finally:
        app.dependency_overrides.clear()


def test_health_clears_the_error_fields_once_the_chain_recovers():
    """last_error means "failures since the last success". A resolved incident
    must stop reading as a live fault: the 2026-08-02 IndexError was still on
    display in /api/health two days after #225 fixed it, and monitoring could
    never assert on the field because it never went quiet."""
    from app.chain_status import record_failure, record_success

    c, session_factory = _client_with_db()
    try:
        s = session_factory()
        record_failure(s, IndexError("list index out of range"))

        chain = c.get("/api/health").json()["learning_chain"]
        assert chain["last_error"] == "IndexError: list index out of range"
        assert chain["last_error_at"] is not None

        record_success(s, covered_finished=0, trigger="test")
        s.close()

        chain = c.get("/api/health").json()["learning_chain"]
        assert chain["last_error"] is None
        assert chain["last_error_at"] is None
        assert chain["last_success_at"] is not None
    finally:
        app.dependency_overrides.clear()


def test_health_reports_prediction_coverage():
    """FR-1.3: a scheduled match with teams, kicking off within 48h, and no
    frozen prediction row must surface as prediction_coverage.missing so
    external monitors can alert before it becomes a guaranteed zero."""
    from datetime import datetime, timedelta, timezone

    from app.models import Match, Prediction

    c, session_factory = _client_with_db()
    try:
        cov = c.get("/api/health").json()["prediction_coverage"]
        assert cov["missing"] == 0  # empty DB: nothing due

        s = session_factory()
        m = Match(tournament_id=1, stage="R32", status="scheduled",
                  team_home_id=1, team_away_id=2,
                  kickoff_utc=datetime.now(timezone.utc) + timedelta(hours=12))
        s.add(m)
        s.commit()

        cov = c.get("/api/health").json()["prediction_coverage"]
        assert cov["missing"] == 1

        s.add(Prediction(match_id=m.id, model_version="poisson-elo-test",
                         prob_home_win=0.5, prob_draw=0.3, prob_away_win=0.2))
        s.commit()
        s.close()

        cov = c.get("/api/health").json()["prediction_coverage"]
        assert cov["missing"] == 0
    finally:
        app.dependency_overrides.clear()


def test_health_reports_shadow_progress_without_accuracy():
    """Task 4.9: monitors need to SEE the shadow sample growing without the
    comparison numbers going public (those stay behind /api/internal/shadow-record's
    token per FR-4.6). Health exposes the pair count only."""
    from app.models import PredictionResult

    c, session_factory = _client_with_db()
    try:
        sp = c.get("/api/health").json()["shadow_progress"]
        assert sp["pairs"] == 0

        s = session_factory()
        s.add(PredictionResult(match_id=1, prediction_id=1, model_version="poisson-elo-v0.2",
                               actual_score_home=1, actual_score_away=0, outcome="home",
                               winner_correct=True, exact_score_correct=False,
                               prob_assigned=0.5, brier=0.5, log_loss=0.7, goal_error=1,
                               is_shadow=False))
        s.add(PredictionResult(match_id=1, prediction_id=2, model_version="poisson-elo-v0.3-shadow",
                               actual_score_home=1, actual_score_away=0, outcome="home",
                               winner_correct=True, exact_score_correct=False,
                               prob_assigned=0.5, brier=0.5, log_loss=0.7, goal_error=1,
                               is_shadow=True))
        s.commit(); s.close()

        sp = c.get("/api/health").json()["shadow_progress"]
        assert sp["pairs"] == 1
        assert "exact_hits" not in sp and "winner_acc" not in sp  # numbers stay internal
    finally:
        app.dependency_overrides.clear()


def test_live_ping_is_tiny_and_triggers_refresh(monkeypatch):
    """The every-minute cron hits this instead of the large /matches/upcoming
    payload: it must return a minuscule body (so response-size-limited cron
    services never fail on it) while scheduling the same live refresh."""
    calls = []
    monkeypatch.setattr("app.main.maybe_refresh_live", lambda *a, **k: calls.append(1))

    r = client.get("/api/live/ping")

    assert r.status_code == 200
    assert r.json() == {"ok": True}
    assert len(r.content) < 40  # a handful of bytes — never "output too large"
    # FastAPI runs the scheduled BackgroundTask after the response is sent;
    # TestClient executes it synchronously, so the refresh was triggered.
    assert calls == [1]


def test_health_reports_data_status_ok_on_clean_data():
    """`status` is liveness; `data_status` is whether what we serve is current.
    Kept separate on purpose — see the health() docstring."""
    c, session_factory = _client_with_db()
    try:
        _seed_healthy_fixture_feeds(session_factory)
        body = c.get("/api/health").json()
        assert body["status"] == "ok"
        assert body["data_status"] == "ok"
        assert body["degradations"] == []
        assert {
            row["competition_code"] for row in body["fixture_feeds"]
        } == {"epl", "laliga", "bundesliga", "ucl"}
        assert all(row["status"] == "ok" for row in body["fixture_feeds"])
    finally:
        app.dependency_overrides.clear()


def test_health_keeps_liveness_but_marks_feed_status_unavailable_before_migration():
    from app.models import FixtureFeedStatus

    c, session_factory = _client_with_db()
    try:
        s = session_factory()
        FixtureFeedStatus.__table__.drop(bind=s.get_bind())
        s.close()

        body = c.get("/api/health").json()

        assert body["status"] == "ok"
        assert body["data_status"] == "unknown"
        assert body["fixture_feeds"] == {"status": "unavailable"}
    finally:
        app.dependency_overrides.clear()


def test_health_goes_degraded_on_a_match_stuck_in_play():
    """The pre-season incident in miniature: nothing errors, the API is up, and
    the data is weeks stale. Liveness alone cannot see that; this is the field
    monitoring can actually assert on."""
    from datetime import datetime, timedelta, timezone

    from app.models import Match

    c, session_factory = _client_with_db()
    try:
        s = session_factory()
        s.add(Match(tournament_id=1, stage="group", status="in_play",
                    kickoff_utc=datetime.now(timezone.utc) - timedelta(hours=9)))
        s.commit()
        s.close()

        body = c.get("/api/health").json()
        assert body["status"] == "ok"             # the process is fine...
        assert body["data_status"] == "degraded"  # ...the data is not
        assert body["degradations"][0]["kind"] == "stale_live_match"
    finally:
        app.dependency_overrides.clear()
