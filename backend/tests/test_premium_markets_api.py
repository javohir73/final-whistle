"""Consumer premium markets: server-side entitlement (401/403), and the payload
is the same MarketsOut the B2B /v1 surface serves (frozen basis)."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import Match, Prediction, Subscription, Team

ALLOWED_ORIGIN = "http://localhost:3000"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(engine)
    TestingSession = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    c = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    c.sessionmaker = TestingSession
    yield c
    app.dependency_overrides.clear()


def _seed_match(db):
    h, a = Team(name="Argentina"), Team(name="Cape Verde")
    db.add_all([h, a]); db.commit()
    m = Match(tournament_id=1, stage="group", is_neutral=True,
              team_home_id=h.id, team_away_id=a.id)
    db.add(m); db.commit()
    p = Prediction(match_id=m.id, model_version="v",
                   prob_home_win=0.7, prob_draw=0.2, prob_away_win=0.1,
                   lambda_home=2.5, lambda_away=0.4, rho=-0.1)
    db.add(p); db.commit()
    return m.id


def _register(client, email="fan@example.com"):
    r = client.post("/api/auth/register",
                    json={"email": email, "password": "supersecret"})
    assert r.status_code == 200
    return r.json()


def test_anonymous_gets_401(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    assert client.get(f"/api/matches/{match_id}/markets").status_code == 401


def test_free_user_gets_403(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    _register(client)
    r = client.get(f"/api/matches/{match_id}/markets")
    assert r.status_code == 403
    # The global exception handler wraps HTTPException details as
    # {"error": {code, message}} on the wire (see test_billing_api.py).
    assert r.json()["error"]["code"] == "premium_required"


def test_premium_user_gets_full_markets(client):
    db = client.sessionmaker(); match_id = _seed_match(db); db.close()
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly"))
    db.commit(); db.close()
    r = client.get(f"/api/matches/{match_id}/markets")
    assert r.status_code == 200
    body = r.json()
    assert body["match_id"] == match_id
    assert set(body["markets"]) >= {"one_x_two", "totals", "btts",
                                    "correct_score", "asian_handicap"}
    assert body["markets"]["correct_score"]  # non-empty grid
    assert "disclaimer" in body


def test_404_when_no_prediction(client):
    db = client.sessionmaker()
    h, a = Team(name="X"), Team(name="Y")
    db.add_all([h, a]); db.commit()
    m = Match(tournament_id=1, stage="group", is_neutral=True,
              team_home_id=h.id, team_away_id=a.id)
    db.add(m); db.commit()
    match_id = m.id
    db.close()
    user = _register(client)
    db = client.sessionmaker()
    db.add(Subscription(user_id=user["id"], status="active", plan="monthly"))
    db.commit(); db.close()
    assert client.get(f"/api/matches/{match_id}/markets").status_code == 404
