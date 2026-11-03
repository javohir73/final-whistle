"""POST /api/leagues/{league}/tips/submit, GET .../{mine,summary,leaderboard,
leaderboard/season,share/{matchweek}/{handle}}, and POST /api/nrl/tips/claim's
league-predictions passthrough -- League Score Predictions design doc
(2026-07-24). Mirrors test_nrl_user_tips_api.py's fixture style (direct-seed
Tournament/Team/Match/Prediction, per test_ledger_separation_api.py) plus its
Origin-header client for the device-keyed writes."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import league_score_predictions as lsp
from app.data_freshness import MATCH_MAX_DURATION_HOURS, stuck_matches
from app.db import Base, get_db
from app.main import app
from app.models import LeagueScorePrediction, Match, Prediction, SportMatch, SportTeam, Team, Tournament, TipPlayer, UserTip
from pipeline.league_score_predictions import grade as grade_score_predictions

ALLOWED_ORIGIN = "http://localhost:3000"
DEVICE_A = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
DEVICE_B = "4fa85f64-5717-4562-b3fc-2c963f66afa7"


def _make_session():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, future=True)


@pytest.fixture
def client():
    TestingSession = _make_session()

    def override_get_db():
        db = TestingSession()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app, headers={"Origin": ALLOWED_ORIGIN}), TestingSession
    app.dependency_overrides.clear()


def _epl(db):
    t = Tournament(name="Premier League 2026-27", year=2026, home_advantage_mode="home")
    db.add(t)
    db.flush()
    return t


def _tournament(db, name):
    """Generic version of _epl for Phase 2's other two leagues -- same shape,
    just a caller-supplied name, since _epl's 30+ existing callers shouldn't
    need to change."""
    t = Tournament(name=name, year=2026, home_advantage_mode="home")
    db.add(t)
    db.flush()
    return t


def _team(db, name):
    t = Team(name=name)
    db.add(t)
    db.flush()
    return t


def _match(db, tournament, home, away, matchweek, kickoff, **kw):
    m = Match(
        tournament_id=tournament.id, team_home_id=home.id, team_away_id=away.id,
        stage="group", matchweek=matchweek, kickoff_utc=kickoff,
        status=kw.pop("status", "scheduled"), **kw,
    )
    db.add(m)
    db.flush()
    return m


def _prediction(db, match, pred_home, pred_away, created_at=None, is_shadow=False, model_version="poisson-elo-club-v0.1"):
    p = Prediction(
        match_id=match.id, model_version=model_version,
        created_at=created_at or (match.kickoff_utc - timedelta(days=1)),
        prob_home_win=0.5, prob_draw=0.25, prob_away_win=0.25,
        predicted_score_home=pred_home, predicted_score_away=pred_away, is_shadow=is_shadow,
    )
    db.add(p)
    db.flush()
    return p


def _register(c, email):
    r = c.post("/api/auth/register", json={"email": email, "password": "supersecret1"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


# ---------------------------------------------------------------------------
# league resolution
# ---------------------------------------------------------------------------

def test_unknown_league_code_404s(client):
    c, _ = client
    r = c.get("/api/leagues/bogus/tips/leaderboard/season")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "league_not_found"


@pytest.mark.parametrize("league", ["epl", "laliga", "bundesliga"])
def test_registered_league_with_no_data_loaded_is_inactive_404(client, league):
    """All three Phase 2 codes are registered in _LEAGUE_TOURNAMENT_NAMES
    (derived from pipeline.leagues.LEAGUES) regardless of whether
    pipeline.leagues.ACTIVE_LEAGUES has actually ingested them yet -- a
    registered-but-not-yet-loaded league (no Tournament row in this DB) must
    404 league_inactive, never league_not_found (that code is reserved for a
    typo'd/unregistered code, see test_unknown_league_code_404s above)."""
    c, _ = client
    r = c.get(f"/api/leagues/{league}/tips/leaderboard/season")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "league_inactive"


# ---------------------------------------------------------------------------
# submit: first-pick finality + kickoff lock + bounds
# ---------------------------------------------------------------------------

def test_submit_before_kickoff_ok(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, epl, ars, che, 1, kick)
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 2, "predicted_away": 1,
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["prediction"]["predicted_home"] == 2
    assert body["prediction"]["predicted_away"] == 1
    assert body["handle"]

    db2 = TestingSession()
    pred = db2.query(LeagueScorePrediction).one()
    assert (pred.predicted_home, pred.predicted_away) == (2, 1)
    assert pred.points is None and pred.graded_at is None  # ungraded until the (pipeline-owned) pass runs
    db2.close()


def test_submit_at_or_after_kickoff_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) - timedelta(seconds=1)
    m = _match(db, epl, ars, che, 1, kick)
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 1, "predicted_away": 0,
    })
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "match_locked"

    db2 = TestingSession()
    assert db2.query(LeagueScorePrediction).count() == 0
    db2.close()


def test_postponed_match_stays_open_after_its_original_kickoff(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(
        db, epl, ars, che, 1,
        datetime.now(timezone.utc) - timedelta(days=1),
        status="postponed",
    )
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id,
        "predicted_home": 1, "predicted_away": 0,
    })

    assert r.status_code == 200, r.text


@pytest.mark.parametrize("status", ["cancelled", "suspended", "in_play", "finished", "future_status"])
def test_non_pickable_statuses_are_locked_even_before_kickoff(client, status):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(
        db, epl, ars, che, 1,
        datetime.now(timezone.utc) + timedelta(days=1),
        status=status,
    )
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id,
        "predicted_home": 1, "predicted_away": 0,
    })

    assert r.status_code == 422
    assert r.json()["error"]["code"] == "match_locked"


def test_edit_after_kickoff_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(seconds=2)
    m = _match(db, epl, ars, che, 1, kick)
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 1, "predicted_away": 1,
    })
    assert r.status_code == 200, r.text

    db2 = TestingSession()
    row = db2.query(Match).filter_by(id=m.id).one()
    row.kickoff_utc = datetime.now(timezone.utc) - timedelta(seconds=1)
    db2.commit()
    db2.close()

    r2 = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 3, "predicted_away": 0,
    })
    assert r2.status_code == 422
    assert r2.json()["error"]["code"] == "match_locked"

    db3 = TestingSession()
    pred = db3.query(LeagueScorePrediction).one()
    assert (pred.predicted_home, pred.predicted_away) == (1, 1)  # unchanged
    db3.close()


def test_first_prediction_is_final_once_model_is_revealed(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, epl, ars, che, 1, kick)
    db.commit()

    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 2, "predicted_away": 2,
    })
    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 3, "predicted_away": 1,
    })
    assert r.status_code == 409, r.text
    assert r.json()["error"]["code"] == "prediction_finalized"

    db2 = TestingSession()
    assert db2.query(LeagueScorePrediction).count() == 1
    pred = db2.query(LeagueScorePrediction).one()
    assert (pred.predicted_home, pred.predicted_away) == (2, 2)
    db2.close()


@pytest.mark.parametrize("home,away", [(-1, 0), (0, -1), (16, 0), (0, 16)])
def test_submit_bad_score_bounds_rejected(client, home, away):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": home, "predicted_away": away,
    })
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "bad_score"


def test_submit_score_bounds_0_and_15_are_valid(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 0, "predicted_away": 15,
    })
    assert r.status_code == 200, r.text


def test_submit_match_from_other_tournament_not_found(client):
    """Cross-league isolation at the write path: a match belonging to a
    DIFFERENT tournament than the one `epl` resolves to must 404, not silently
    accept a prediction against it."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    other = Tournament(name="La Liga 2026-27", year=2026, home_advantage_mode="home")
    db.add(other)
    db.flush()
    rma, bar = _team(db, "Real Madrid"), _team(db, "Barcelona")
    m = _match(db, other, rma, bar, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 1, "predicted_away": 0,
    })
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "match_not_found"


def test_submit_invalid_device_id_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    db.commit()

    r = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": "garbage", "match_id": 1, "predicted_home": 1, "predicted_away": 0,
    })
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_device_id"


# ---------------------------------------------------------------------------
# GET mine
# ---------------------------------------------------------------------------

def test_mine_hides_model_scoreline_until_the_device_submits(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, epl, ars, che, 3, kick)
    _prediction(db, m, 2, 0)
    db.commit()

    before = c.get(
        "/api/leagues/epl/tips/mine",
        params={"device_id": DEVICE_A, "matchweek": 3},
    ).json()["matches"][0]
    assert before["model"] is None

    submitted = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id,
        "predicted_home": 1, "predicted_away": 1,
    })
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["model"] == {
        "predicted_home": 2,
        "predicted_away": 0,
        "model_version": "poisson-elo-club-v0.1",
    }

    after = c.get(
        "/api/leagues/epl/tips/mine",
        params={"device_id": DEVICE_A, "matchweek": 3},
    ).json()["matches"][0]
    assert after["model"] == submitted.json()["model"]


def test_mine_reveals_model_after_the_fixture_locks_without_a_pick(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) - timedelta(minutes=1)
    m = _match(db, epl, ars, che, 3, kick)
    _prediction(db, m, 2, 0, created_at=kick - timedelta(days=1))
    db.commit()

    row = c.get(
        "/api/leagues/epl/tips/mine",
        params={"device_id": DEVICE_A, "matchweek": 3},
    ).json()["matches"][0]
    assert row["your_prediction"] is None
    assert row["model"]["predicted_home"] == 2

def test_mine_shows_model_scoreline_and_your_prediction(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, epl, ars, che, 3, kick)
    _prediction(db, m, 2, 0)
    db.commit()

    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 1, "predicted_away": 1,
    })

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A, "matchweek": 3})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["matchweek"] == 3
    row = body["matches"][0]
    assert row["model"] == {"predicted_home": 2, "predicted_away": 0, "model_version": "poisson-elo-club-v0.1"}
    assert row["your_prediction"]["predicted_home"] == 1
    assert row["your_prediction"]["predicted_away"] == 1
    assert row["your_prediction"]["points"] is None


def test_mine_ignores_shadow_prediction_twin(client):
    """Regression: generate_predictions writes ONE production row
    (is_shadow=False) plus shadow twins (odds/availability/offsets/rest) per
    match, all sharing created_at (same pipeline transaction) but the shadow
    twin lands with a HIGHER id, since it's written after production. Without
    filtering is_shadow, _kickoff_locked_prediction's created_at desc, id desc
    tiebreak would pick the shadow twin -- exactly what this proves doesn't
    happen, on a twin with a DIFFERENT scoreline so a wrong pick is visible."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, epl, ars, che, 3, kick)
    same_created_at = kick - timedelta(days=1)
    _prediction(db, m, 2, 0, created_at=same_created_at, is_shadow=False)
    _prediction(db, m, 3, 3, created_at=same_created_at, is_shadow=True,
                model_version="poisson-elo-club-v0.1-shadow")  # written after -- higher id, same created_at
    db.commit()

    # The scoreline is private before a device submits. Persist a real user
    # prediction so this test can keep exercising which model twin is revealed.
    submitted = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id,
        "predicted_home": 1, "predicted_away": 1,
    })
    assert submitted.status_code == 200, submitted.text

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A, "matchweek": 3})
    assert r.status_code == 200, r.text
    row = r.json()["matches"][0]
    assert row["model"] == {"predicted_home": 2, "predicted_away": 0, "model_version": "poisson-elo-club-v0.1"}


def test_mine_defaults_to_current_matchweek(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    _match(db, epl, ars, che, 1, now - timedelta(days=7), status="finished", score_home=2, score_away=1)
    upcoming = _match(db, epl, bha, whu, 2, now + timedelta(days=1))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 2
    assert r.json()["matches"][0]["id"] == upcoming.id


def test_cancelled_matchweek_does_not_pin_the_default_current_week(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    _match(db, epl, ars, che, 1, now - timedelta(days=2), status="cancelled")
    upcoming = _match(db, epl, bha, whu, 2, now + timedelta(days=1))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})

    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 2
    assert r.json()["matches"][0]["id"] == upcoming.id


def test_postponed_old_matchweek_does_not_pin_the_default_current_week(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    _match(db, epl, ars, che, 1, now - timedelta(days=2), status="postponed")
    upcoming = _match(db, epl, bha, whu, 2, now + timedelta(days=1))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})

    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 2
    assert r.json()["matches"][0]["id"] == upcoming.id


# _current_matchweek is stale-aware (UX rebuild plan 2026-11, Phase 0): a match
# is open iff it is in play, or scheduled and not yet kicked off. These pin the
# clock through the injectable `now` so the dates can be read literally.
_NOW = datetime(2026, 11, 3, 12, 0, tzinfo=timezone.utc)


def test_mine_default_skips_a_stale_scheduled_ghost_fixture(client):
    """The live bug, end to end: a duplicate-team ghost fixture from August
    still marked `scheduled` pinned La Liga's Play page to matchweek 2, and
    one stale `scheduled` row that kicked off yesterday pinned EPL to an
    all-played matchweek 9. Neither can be played, so the default must be
    the matchweek of the next fixture that can."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    _match(db, epl, ars, che, 2, now - timedelta(days=70))  # ghost, never updated
    _match(db, epl, bha, whu, 9, now - timedelta(days=1))  # played, status never flipped
    _match(db, epl, ars, bha, 9, now - timedelta(days=2), status="finished", score_home=1, score_away=0)
    upcoming = _match(db, epl, che, whu, 10, now + timedelta(days=3))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})

    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 10
    assert [row["id"] for row in r.json()["matches"]] == [upcoming.id]


def test_current_matchweek_skips_stale_scheduled_row_for_next_matchweek(client):
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    _match(db, epl, ars, che, 4, _NOW - timedelta(days=3))  # stale: kicked off, still "scheduled"
    _match(db, epl, bha, whu, 4, _NOW - timedelta(days=3), status="finished", score_home=0, score_away=0)
    _match(db, epl, ars, bha, 5, _NOW + timedelta(days=4))
    _match(db, epl, che, whu, 6, _NOW + timedelta(days=11))
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == 5
    # Same rows one week earlier: matchweek 4 hadn't kicked off yet, so it was open.
    assert lsp._current_matchweek(db, epl.id, now=_NOW - timedelta(days=7)) == 4


def test_current_matchweek_in_play_match_keeps_its_matchweek(client):
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    _match(db, epl, ars, che, 7, _NOW - timedelta(hours=3), status="finished", score_home=2, score_away=0)
    _match(db, epl, bha, whu, 7, _NOW - timedelta(minutes=40), status="in_play", score_home=0, score_away=1)
    _match(db, epl, ars, bha, 8, _NOW + timedelta(days=6))
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == 7


@pytest.mark.parametrize("age, still_open", [
    (timedelta(minutes=30), True),
    (timedelta(hours=MATCH_MAX_DURATION_HOURS), True),
    (timedelta(hours=MATCH_MAX_DURATION_HOURS, seconds=1), False),
    (timedelta(hours=6), False),
])
def test_current_matchweek_in_play_is_open_only_until_the_health_checks_impossible_line(client, age, still_open):
    """An in_play row is open only while a match could still be running.
    Past MATCH_MAX_DURATION_HOURS after kickoff /api/health already calls it
    impossible -- a feed that stopped reaching us, not a match -- so it must
    not pin Play either. Both draw the same line: a row is stuck there
    exactly when it is not open here."""
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    in_play = _match(db, epl, ars, che, 7, _NOW - age, status="in_play", score_home=1, score_away=0)
    _match(db, epl, bha, whu, 8, _NOW + timedelta(days=6))
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == (7 if still_open else 8)
    stuck_ids = {row["match_id"] for row in stuck_matches(db, now=_NOW)}
    assert (in_play.id in stuck_ids) is (not still_open)


def test_mine_default_skips_a_stuck_in_play_row_but_keeps_a_live_one(client):
    """End to end on the server clock: a row left in_play six hours after
    kickoff no longer pins Play, while a match thirty minutes in keeps its
    matchweek."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    _match(db, epl, ars, che, 9, now - timedelta(hours=6), status="in_play", score_home=2, score_away=2)
    _match(db, epl, bha, whu, 10, now + timedelta(days=3))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 10

    _match(db, epl, ars, bha, 9, now - timedelta(minutes=30), status="in_play", score_home=0, score_away=0)
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["matchweek"] == 9


def test_current_matchweek_nothing_open_falls_back_to_latest_matchweek(client):
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    _match(db, epl, ars, che, 1, _NOW - timedelta(days=21))  # stale scheduled row: not open
    _match(db, epl, bha, whu, 2, _NOW - timedelta(days=14), status="cancelled")
    _match(db, epl, ars, bha, 3, _NOW - timedelta(days=7), status="finished", score_home=1, score_away=1)
    _match(db, epl, che, whu, 38, _NOW - timedelta(days=1), status="finished", score_home=3, score_away=2)
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == 38


def test_current_matchweek_undated_fixture_never_picks_the_default(client):
    """An undated fixture (a ghost, or a rescheduled date still TBD) must
    never choose the default -- not even when nothing else is open (review
    L3). Played through matchweek 10 with an undated matchweek-3 row left
    over, the default is matchweek 10, not 3."""
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    _match(db, epl, ars, che, 3, None)  # undated scheduled ghost
    _match(db, epl, bha, whu, 3, None, status="in_play")  # undated in play: no clock to bound it either
    _match(db, epl, ars, bha, 10, _NOW - timedelta(days=2), status="finished", score_home=0, score_away=2)
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == 10

    _match(db, epl, che, whu, 11, _NOW + timedelta(days=5))
    db.commit()

    assert lsp._current_matchweek(db, epl.id, now=_NOW) == 11


def test_mine_matchweek_not_found_404(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A, "matchweek": 99})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "matchweek_not_found"


def test_mine_no_matchweek_data_404(client):
    """Tournament is loaded, but no matches have a matchweek stamped yet
    (ingestion write-side hasn't run) -- distinct from matchweek_not_found."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    _match(db, epl, ars, che, None, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "no_matchweek_data"


# ---------------------------------------------------------------------------
# GET summary -- zero-state, scoring, streaks, best matchweek, AI parity
# ---------------------------------------------------------------------------

def test_summary_zero_state_unknown_device(client):
    c, TestingSession = client
    db = TestingSession()
    _epl(db)
    db.commit()

    r = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handle"] is None
    assert body["matchweeks"] == []
    assert body["totals"] == {"your_points": 0, "model_points": 0, "matchweeks_played": 0}
    assert body["current_streak"] == 0 and body["best_streak"] == 0 and body["best_matchweek"] is None


@pytest.mark.parametrize(
    "pred_home,pred_away,actual_home,actual_away,expected_points,expected_exact",
    [
        (2, 1, 2, 1, 5, True),   # exact score
        (0, 0, 0, 0, 5, True),   # exact 0-0
        (2, 0, 3, 1, 2, False),  # correct result direction (home win), wrong score
        (1, 1, 0, 0, 2, False),  # correct result direction (draw), wrong score
        (1, 0, 0, 1, 0, False),  # wrong direction entirely
        (1, 1, 2, 1, 0, False),  # predicted draw, actual home win -- a miss
    ],
)
def test_score_prediction_matrix(pred_home, pred_away, actual_home, actual_away, expected_points, expected_exact):
    points, exact = lsp._score_prediction(pred_home, pred_away, actual_home, actual_away)
    assert (points, exact) == (expected_points, expected_exact)


def test_summary_points_streaks_and_best_matchweek(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)

    m1 = _match(db, epl, ars, che, 1, now - timedelta(days=14), status="finished", score_home=2, score_away=1)
    m2 = _match(db, epl, bha, whu, 2, now - timedelta(days=7), status="finished", score_home=0, score_away=0)
    db.flush()
    player = TipPlayer(device_id=DEVICE_A, handle="TestHandle1")
    db.add(player)
    db.flush()
    # Matchweek 1: exact score -> 5 points.
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m1.id, player_id=player.id,
        predicted_home=2, predicted_away=1, updated_at=now - timedelta(days=15),
        points=5, exact=True, graded_at=now,
    ))
    # Matchweek 2: wrong scoreline, wrong direction -> 0 points (streak reset).
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m2.id, player_id=player.id,
        predicted_home=1, predicted_away=0, updated_at=now - timedelta(days=8),
        points=0, exact=False, graded_at=now,
    ))
    db.commit()

    r = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handle"] == "TestHandle1"
    assert body["totals"] == {"your_points": 5, "model_points": 0, "matchweeks_played": 2}
    assert body["current_streak"] == 0  # the most recent graded matchweek scored 0
    assert body["best_streak"] == 1
    assert body["best_matchweek"] == {"matchweek": 1, "points": 5}


def test_summary_model_points_parity_with_score_prediction_rule(client):
    """AI scoring parity: when a player's prediction is IDENTICAL to the
    model's frozen scoreline, the two can only tie -- proving /summary's
    live model-points computation uses the exact same rule
    (_score_prediction) a grading pass would use for the player's row."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    m = _match(db, epl, ars, che, 5, now - timedelta(days=1), status="finished", score_home=2, score_away=1)
    _prediction(db, m, pred_home=2, pred_away=0, created_at=now - timedelta(days=2))
    db.flush()

    player = TipPlayer(device_id=DEVICE_A, handle="ParityTester")
    db.add(player)
    db.flush()

    # The player copies the AI's exact scoreline (2-0) -- both are wrong vs
    # the 2-1 actual result in the same way, so both must score identically.
    expected_points, expected_exact = lsp._score_prediction(2, 0, 2, 1)
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m.id, player_id=player.id,
        predicted_home=2, predicted_away=0, updated_at=now - timedelta(days=2),
        points=expected_points, exact=expected_exact, graded_at=now,
    ))
    db.commit()

    body = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_A}).json()
    week = body["matchweeks"][0]
    assert week["your_points"] == week["model_points"] == expected_points


# ---------------------------------------------------------------------------
# leaderboard: matchweek + season -- never hidden, exact-count tiebreak
# ---------------------------------------------------------------------------

MODEL_HANDLE = "FinalWhistle model"

def _seed_leaderboard_players(db, epl, match, n, points_and_exact):
    """n players with predictions on `match`; points_and_exact maps player
    index -> (points, exact) already-graded state."""
    players = []
    for i in range(n):
        p = TipPlayer(device_id=f"11111111-1111-4111-8111-11111111{i:04d}", handle=f"Player{i}")
        db.add(p)
        db.flush()
        points, exact = points_and_exact.get(i, (0, False))
        db.add(LeagueScorePrediction(
            tournament_id=epl.id, match_id=match.id, player_id=p.id,
            predicted_home=1, predicted_away=0, updated_at=datetime.now(timezone.utc),
            points=points, exact=exact, graded_at=datetime.now(timezone.utc) if points or exact else None,
        ))
        players.append(p)
    return players


def test_leaderboard_never_hides_entries_below_the_old_reveal_gate(client):
    """The old >=10 reveal gate meant no league board ever rendered a row (4/0/1
    players live in November 2026). Five players now see all five rows, plus
    the model's -- which never counts as a participant."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) - timedelta(days=1),
               status="finished", score_home=2, score_away=1)
    db.flush()
    _seed_leaderboard_players(db, epl, m, 5, {})
    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 5
    assert [e["handle"] for e in body["entries"]] == [f"Player{i}" for i in range(5)] + [MODEL_HANDLE]


def test_leaderboard_exact_count_tiebreak(client):
    """Two players tie on total points (10) across multiple matches but
    differ in exact-hit count: ZebraExactTwo reaches 10 via two exact scores
    (exact_count=2), AlphaResultFive reaches the SAME 10 via five
    result-only 2-pointers (exact_count=0). Handles are deliberately
    alphabetized the OPPOSITE way round from the correct ranking -- if the
    -exact_count term were dropped (sorting on points+handle alone, e.g.
    key=lambda e: (-e["points"], e["handle"])), AlphaResultFive would sort
    first on points+handle alone, so this fails loudly instead of passing
    by accident the way the single-match, single-tied-pair version of this
    test used to (both seeded players had equal points AND equal exact_count,
    so the assertion was satisfied by handle order alone)."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc) - timedelta(days=1)
    matches = [
        _match(db, epl, ars, che, 1, now, status="finished", score_home=2, score_away=1)
        for _ in range(5)
    ]
    db.flush()

    def _player(i, handle):
        p = TipPlayer(device_id=f"11111111-1111-4111-8111-11111111{i:04d}", handle=handle)
        db.add(p)
        db.flush()
        return p

    def _pred(player, match, points, exact):
        db.add(LeagueScorePrediction(
            tournament_id=epl.id, match_id=match.id, player_id=player.id,
            predicted_home=1, predicted_away=0, updated_at=now,
            points=points, exact=exact, graded_at=now,
        ))

    exact_player = _player(0, "ZebraExactTwo")
    _pred(exact_player, matches[0], 5, True)
    _pred(exact_player, matches[1], 5, True)

    result_player = _player(1, "AlphaResultFive")
    for m in matches:
        _pred(result_player, m, 2, False)

    # 8 more players with zero points -- they must rank below both and never
    # touch the comparison above. They're all fully tied on points+exact, so
    # their relative order still proves the handle-asc fallback for a genuine
    # full tie.
    for i in range(2, 10):
        p = _player(i, f"Filler{i}")
        _pred(p, matches[0], 0, False)

    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 10
    top_two = [(e["handle"], e["points"], e["exact_count"]) for e in body["entries"][:2]]
    assert top_two == [("ZebraExactTwo", 10, 2), ("AlphaResultFive", 10, 0)]
    next_two_handles = [e["handle"] for e in body["entries"][2:4]]
    assert next_two_handles == ["Filler2", "Filler3"]  # full tie on points+exact -> handle asc


def test_leaderboard_matchweek_not_found_404(client):
    c, TestingSession = client
    db = TestingSession()
    _epl(db)
    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 1})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "matchweek_not_found"


def test_leaderboard_season_only_counts_graded_players(client):
    """Season board population is GRADED-only (mirrors NRL's
    submitted-vs-graded distinction) -- a player who only ever submitted an
    ungraded prediction is not a season participant. The model's row is
    still there, at zero: nothing in the season has been graded yet."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.flush()
    # 10 players submit but NONE are graded yet (match hasn't kicked off).
    for i in range(10):
        p = TipPlayer(device_id=f"22222222-2222-4222-8222-22222222{i:04d}", handle=f"Ungraded{i}")
        db.add(p)
        db.flush()
        db.add(LeagueScorePrediction(
            tournament_id=epl.id, match_id=m.id, player_id=p.id,
            predicted_home=1, predicted_away=0, updated_at=datetime.now(timezone.utc),
        ))
    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard/season")
    assert r.status_code == 200, r.text
    assert r.json()["participant_count"] == 0
    assert r.json()["entries"] == [
        {"handle": MODEL_HANDLE, "points": 0, "exact_count": 0, "matchweeks_played": 0, "is_model": True},
    ]


def test_leaderboard_season_exact_count_tiebreak(client):
    """Same tiebreak proof as test_leaderboard_exact_count_tiebreak,
    for /leaderboard/season -- which had NO tiebreak coverage at all before
    (the design doc's "points desc, then exact-count desc" applies here too,
    scored across every graded matchweek in the tournament instead of one)."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc) - timedelta(days=1)
    matches = [
        _match(db, epl, ars, che, week, now, status="finished", score_home=2, score_away=1)
        for week in range(1, 6)
    ]
    db.flush()

    def _player(i, handle):
        p = TipPlayer(device_id=f"33333333-3333-4333-8333-33333333{i:04d}", handle=handle)
        db.add(p)
        db.flush()
        return p

    def _pred(player, match, points, exact):
        db.add(LeagueScorePrediction(
            tournament_id=epl.id, match_id=match.id, player_id=player.id,
            predicted_home=1, predicted_away=0, updated_at=now,
            points=points, exact=exact, graded_at=now,
        ))

    # Same alphabetized-opposite handle trick as the weekly-board test, so a
    # dropped -exact_count term (falling back to points+handle) sorts these
    # the wrong way round and fails.
    exact_player = _player(0, "ZebraExactTwo")
    _pred(exact_player, matches[0], 5, True)
    _pred(exact_player, matches[1], 5, True)

    result_player = _player(1, "AlphaResultFive")
    for m in matches:
        _pred(result_player, m, 2, False)

    for i in range(2, 10):
        p = _player(i, f"Filler{i}")
        _pred(p, matches[0], 0, False)

    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard/season")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 10
    top_two = [(e["handle"], e["points"], e["exact_count"]) for e in body["entries"][:2]]
    assert top_two == [("ZebraExactTwo", 10, 2), ("AlphaResultFive", 10, 0)]


# ---------------------------------------------------------------------------
# leaderboard: the model is always a ranked row (UX rebuild 2026-11, Phase 0)
# ---------------------------------------------------------------------------

def test_leaderboard_single_player_is_ranked_against_the_model(client):
    """One player still gets a real board ("You #1 of 2"): their own row and
    the model's, which participant_count never counts."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    m = _match(db, epl, ars, che, 1, now - timedelta(days=1), status="finished", score_home=2, score_away=1)
    _prediction(db, m, pred_home=1, pred_away=0)  # right result, wrong score -> 2
    player = TipPlayer(device_id=DEVICE_A, handle="SoloPlayer")
    db.add(player)
    db.flush()
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m.id, player_id=player.id,
        predicted_home=2, predicted_away=1, updated_at=now - timedelta(days=2),
        points=5, exact=True, graded_at=now,
    ))
    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 1})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 1
    assert body["entries"] == [
        {"handle": "SoloPlayer", "points": 5, "exact_count": 1, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 2, "exact_count": 0, "is_model": True},
    ]
    assert DEVICE_A not in r.text  # human rows still never expose a device_id


def test_leaderboard_model_row_scores_kickoff_locked_picks_on_graded_matches_only(client):
    """The model's row is _score_prediction applied to its kickoff-locked
    scoreline on every GRADED match of the matchweek -- finished, with a
    kickoff and a final score, the grading pass's own conditions. A
    post-kickoff write or a shadow twin is never its pick, a live score is
    not a result, and a match it never predicted earns nothing."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    ko = now - timedelta(days=1)

    exact = _match(db, epl, ars, che, 6, ko, status="finished", score_home=2, score_away=1)
    _prediction(db, exact, 2, 1, created_at=ko - timedelta(hours=2))  # exact -> 5
    # Same created_at, written after the production row: wins the id tiebreak
    # unless shadow rows are excluded.
    _prediction(db, exact, 0, 3, created_at=ko - timedelta(hours=2), is_shadow=True)
    _prediction(db, exact, 0, 0, created_at=ko + timedelta(minutes=30))  # after kickoff: never its pick
    drawn = _match(db, epl, ars, che, 6, ko, status="finished", score_home=0, score_away=0)
    _prediction(db, drawn, 1, 1)  # right result -> 2
    missed = _match(db, epl, ars, che, 6, ko, status="finished", score_home=3, score_away=0)
    _prediction(db, missed, 0, 2)  # wrong result -> 0
    live = _match(db, epl, ars, che, 6, now - timedelta(minutes=30), status="in_play", score_home=1, score_away=0)
    _prediction(db, live, 1, 0)  # would be exact, but a live score isn't a result
    upcoming = _match(db, epl, ars, che, 6, now + timedelta(days=2))
    _prediction(db, upcoming, 1, 0)
    late_only = _match(db, epl, ars, che, 6, ko, status="finished", score_home=1, score_away=1)
    _prediction(db, late_only, 1, 1, created_at=ko + timedelta(hours=1))  # no eligible pick at all
    _match(db, epl, ars, che, 6, ko, status="finished", score_home=4, score_away=4)  # never predicted
    db.commit()

    body = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 6}).json()

    assert body["participant_count"] == 0
    assert body["entries"] == [{"handle": MODEL_HANDLE, "points": 7, "exact_count": 1, "is_model": True}]


def test_leaderboard_ungraded_matchweek_gives_the_model_zero(client):
    """Nothing graded yet: the model sits at zero, and a player level with it
    on every key ranks above it -- the tie goes to the human."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 8, datetime.now(timezone.utc) + timedelta(days=2))
    _prediction(db, m, 1, 0)
    db.commit()

    empty = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 8}).json()
    assert empty["participant_count"] == 0
    assert empty["entries"] == [{"handle": MODEL_HANDLE, "points": 0, "exact_count": 0, "is_model": True}]

    submitted = c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 1, "predicted_away": 0,
    })
    assert submitted.status_code == 200, submitted.text
    handle = submitted.json()["handle"]

    body = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 8}).json()
    assert body["participant_count"] == 1
    assert body["entries"] == [
        {"handle": handle, "points": 0, "exact_count": 0, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 0, "exact_count": 0, "is_model": True},
    ]


def test_leaderboard_model_points_equal_the_summary_model_points(client):
    """One computation, not two: for a player who predicted every graded
    match of a matchweek, the board's model row and /summary's model_points
    for that matchweek are the same number."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    ko = now - timedelta(days=1)
    player = TipPlayer(device_id=DEVICE_A, handle="ParityPlayer")
    db.add(player)
    db.flush()
    for (home_goals, away_goals), (model_home, model_away) in (
        ((2, 1), (2, 1)), ((0, 0), (1, 0)), ((1, 3), (0, 2)),
    ):
        m = _match(db, epl, ars, che, 4, ko, status="finished", score_home=home_goals, score_away=away_goals)
        _prediction(db, m, model_home, model_away)
        db.add(LeagueScorePrediction(
            tournament_id=epl.id, match_id=m.id, player_id=player.id,
            predicted_home=0, predicted_away=0, updated_at=ko - timedelta(hours=1),
            points=0, exact=False, graded_at=now,
        ))
    db.commit()

    summary = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_A}).json()
    board = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 4}).json()

    model_row = next(e for e in board["entries"] if e["is_model"])
    assert summary["matchweeks"][0]["model_points"] == model_row["points"] == 7


def test_season_leaderboard_ranks_a_player_against_the_models_season_total(client):
    """The season row is the model's points across every graded match in this
    league's tournament: another league's match, or one still to be played,
    never counts. matchweeks_played counts matchweeks the model was scored
    in, a zero-point one included -- the same rule a player's row follows."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    laliga = _tournament(db, "La Liga 2026-27")
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    rma, fcb = _team(db, "Real Madrid"), _team(db, "Barcelona")
    now = datetime.now(timezone.utc)
    mw1 = _match(db, epl, ars, che, 1, now - timedelta(days=21), status="finished", score_home=2, score_away=1)
    _prediction(db, mw1, 2, 1)  # exact -> 5
    mw2 = _match(db, epl, che, ars, 2, now - timedelta(days=14), status="finished", score_home=0, score_away=1)
    _prediction(db, mw2, 1, 1)  # wrong result -> 0, but a matchweek the model played
    mw3 = _match(db, epl, ars, che, 3, now - timedelta(days=7), status="finished", score_home=1, score_away=1)
    _prediction(db, mw3, 0, 0)  # right result -> 2
    mw4 = _match(db, epl, che, ars, 4, now + timedelta(days=7))
    _prediction(db, mw4, 3, 0)  # not played yet
    other = _match(db, laliga, rma, fcb, 1, now - timedelta(days=21), status="finished", score_home=3, score_away=3)
    _prediction(db, other, 3, 3)  # another league's exact hit
    player = TipPlayer(device_id=DEVICE_A, handle="SeasonSolo")
    db.add(player)
    db.flush()
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=mw1.id, player_id=player.id,
        predicted_home=1, predicted_away=0, updated_at=now - timedelta(days=22),
        points=2, exact=False, graded_at=now,
    ))
    db.commit()

    r = c.get("/api/leagues/epl/tips/leaderboard/season")

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 1
    assert body["entries"] == [
        {"handle": MODEL_HANDLE, "points": 7, "exact_count": 1, "matchweeks_played": 3, "is_model": True},
        {"handle": "SeasonSolo", "points": 2, "exact_count": 0, "matchweeks_played": 1, "is_model": False},
    ]
    assert DEVICE_A not in r.text


def test_model_row_waits_until_the_players_picks_on_a_match_are_graded(client):
    """Review H1, the reviewer's repro: live refresh flips a match to
    finished minutes after full time, but players' picks are graded by a
    separate pass. Until it has run, the model must not bank the match --
    the model and a player who both called 2-1 are level at 0, then level at
    5 once graded, and /summary agrees with the boards throughout."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    m = _match(db, epl, ars, che, 10, now - timedelta(hours=3), status="finished",
               score_home=2, score_away=1, score_home_90=2, score_away_90=1)
    _prediction(db, m, 2, 1)
    player = TipPlayer(device_id=DEVICE_A, handle="SwiftStriker7")
    db.add(player)
    db.flush()
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m.id, player_id=player.id,
        predicted_home=2, predicted_away=1, updated_at=now - timedelta(days=2),
    ))
    db.commit()

    def boards():
        weekly = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 10}).json()
        season = c.get("/api/leagues/epl/tips/leaderboard/season").json()
        summary = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_A}).json()
        return weekly, season, summary

    weekly, season, summary = boards()
    assert weekly["entries"] == [
        {"handle": "SwiftStriker7", "points": 0, "exact_count": 0, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 0, "exact_count": 0, "is_model": True},
    ]
    assert season["participant_count"] == 0
    assert season["entries"] == [
        {"handle": MODEL_HANDLE, "points": 0, "exact_count": 0, "matchweeks_played": 0, "is_model": True},
    ]
    assert summary["matchweeks"] == []

    assert grade_score_predictions(db) == 1

    weekly, season, summary = boards()
    assert weekly["entries"] == [
        {"handle": "SwiftStriker7", "points": 5, "exact_count": 1, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 5, "exact_count": 1, "is_model": True},
    ]
    assert season["participant_count"] == 1
    assert season["entries"] == [
        {"handle": "SwiftStriker7", "points": 5, "exact_count": 1, "matchweeks_played": 1, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 5, "exact_count": 1, "matchweeks_played": 1, "is_model": True},
    ]
    assert summary["matchweeks"] == [
        {"matchweek": 10, "your_points": 5, "model_points": 5, "matches_played": 1},
    ]


def test_a_pick_the_grader_will_never_score_does_not_hold_the_model_back(client):
    """Only a grade-eligible pick (stamped at or before kickoff, the grading
    pass's own filter) holds the model's points; one stamped after kickoff is
    never graded, so it must not freeze the model's row for good."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    ko = now - timedelta(hours=3)
    m = _match(db, epl, ars, che, 10, ko, status="finished", score_home=2, score_away=1)
    _prediction(db, m, 2, 1)
    player = TipPlayer(device_id=DEVICE_A, handle="LateStamp")
    db.add(player)
    db.flush()
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m.id, player_id=player.id,
        predicted_home=2, predicted_away=1, updated_at=ko + timedelta(minutes=10),
    ))
    db.commit()

    body = c.get("/api/leagues/epl/tips/leaderboard", params={"matchweek": 10}).json()

    assert body["entries"][0] == {"handle": MODEL_HANDLE, "points": 5, "exact_count": 1, "is_model": True}


def test_model_predictions_are_narrowed_to_one_kickoff_locked_row_per_match_in_sql(client):
    """Review M3: the append-only log carries a row per pipeline run per
    match (plus shadow twins), so the model's rows are narrowed to the single
    kickoff-locked one per match in SQL -- the row _kickoff_locked_prediction
    would pick -- never materialised by the hundred to pick one in Python."""
    _, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    ko = datetime(2026, 10, 1, 15, 0, tzinfo=timezone.utc)
    locked = _match(db, epl, ars, che, 6, ko, status="finished", score_home=1, score_away=0)
    for day in range(5, 0, -1):  # five daily runs; the last is a day before kickoff
        last_before_kickoff = _prediction(db, locked, day % 3, 0, created_at=ko - timedelta(days=day))
    _prediction(db, locked, 0, 0, created_at=ko - timedelta(days=1), is_shadow=True)  # same instant
    _prediction(db, locked, 4, 4, created_at=ko + timedelta(hours=1))  # after kickoff
    undated = _match(db, epl, ars, che, 7, None)
    _prediction(db, undated, 1, 1, created_at=ko - timedelta(days=2))
    newest = _prediction(db, undated, 2, 2, created_at=ko - timedelta(days=1))
    never_predicted = _match(db, epl, ars, che, 8, ko + timedelta(days=7))
    db.commit()

    by_match = lsp._model_predictions_by_match(db, [locked.id, undated.id, never_predicted.id])

    assert {mid: [p.id for p in rows] for mid, rows in by_match.items()} == {
        locked.id: [last_before_kickoff.id], undated.id: [newest.id],
    }


def test_season_board_query_count_stays_flat_as_the_season_grows(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    start = datetime.now(timezone.utc) - timedelta(days=200)

    def play(first, count, runs_per_match):
        for i in range(first, first + count):
            m = _match(db, epl, ars, che, i // 10 + 1, start + timedelta(days=i), status="finished",
                       score_home=1, score_away=0)
            for k in range(runs_per_match):
                _prediction(db, m, 1, 0, created_at=m.kickoff_utc - timedelta(days=k + 1))
        db.commit()

    statements = []
    event.listen(TestingSession.kw["bind"], "before_cursor_execute",
                 lambda *args, **kw: statements.append(args[2]))

    def season_board():
        statements.clear()
        body = c.get("/api/leagues/epl/tips/leaderboard/season").json()
        return body["entries"][0]["points"], len(statements)

    play(0, 3, 2)
    small_points, small_sql = season_board()
    play(3, 27, 12)
    big_points, big_sql = season_board()

    assert (small_points, big_points) == (3 * 5, 30 * 5)
    assert big_sql == small_sql  # ten times the matches, six times the rows each: same queries


# ---------------------------------------------------------------------------
# share: graded-only, 404 matrix, no leak of pre-kickoff picks
# ---------------------------------------------------------------------------

def test_share_unknown_handle_404(client):
    c, TestingSession = client
    db = TestingSession()
    _epl(db)
    db.commit()

    r = c.get("/api/leagues/epl/tips/share/1/NoSuchHandle")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "share_not_found"


def test_share_ungraded_matchweek_404_never_leaks_prekickoff_pick(client):
    """A device predicts before kickoff; the match hasn't finished (or been
    graded) yet -- share must 404, never surface the pre-kickoff pick."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 4, "predicted_away": 0,
    })
    db2 = TestingSession()
    player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    handle = player.handle
    db2.close()

    r = c.get(f"/api/leagues/epl/tips/share/1/{handle}")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "share_not_found"


def test_share_returns_graded_summary(client):
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    now = datetime.now(timezone.utc)
    m = _match(db, epl, ars, che, 1, now - timedelta(days=1), status="finished", score_home=2, score_away=1)
    _prediction(db, m, pred_home=1, pred_away=1, created_at=now - timedelta(days=2))
    db.flush()
    player = TipPlayer(device_id=DEVICE_A, handle="ShareTester")
    db.add(player)
    db.flush()
    db.add(LeagueScorePrediction(
        tournament_id=epl.id, match_id=m.id, player_id=player.id,
        predicted_home=2, predicted_away=1, updated_at=now - timedelta(days=2),
        points=5, exact=True, graded_at=now,
    ))
    db.commit()

    r = c.get("/api/leagues/epl/tips/share/1/ShareTester")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handle_display"] == "ShareTester"
    assert body["player_points"] == 5
    assert body["model_points"] == 0  # model predicted 1-1, actual was 2-1 -- a miss
    assert body["matchweek_complete"] is True
    assert "device_id" not in body and "device" not in str(body).lower()


# ---------------------------------------------------------------------------
# cross-league isolation
# ---------------------------------------------------------------------------

def _fill_graded_players(db, tournament, match, n, offset):
    """n more graded (points=0, exact=False) players on `match`, so each
    league's boards carry a crowd beyond the real test subject's own row
    (originally to clear the old >=10 reveal gate; now it proves one league's
    crowd never inflates another's participant_count). Distinct `offset` per league
    keeps device_id unique across the three leagues seeded in the same test
    (unlike _seed_leaderboard_players, which is single-tournament and reuses
    the same device_id family every call). graded_at is always set (unlike
    _seed_leaderboard_players' points-or-exact-gated version) since the
    season leaderboard's population filter is graded-only."""
    now = datetime.now(timezone.utc)
    for i in range(n):
        idx = offset + i
        p = TipPlayer(device_id=f"99999999-9999-4999-8999-{idx:012d}", handle=f"Filler{idx}")
        db.add(p)
        db.flush()
        db.add(LeagueScorePrediction(
            tournament_id=tournament.id, match_id=match.id, player_id=p.id,
            predicted_home=1, predicted_away=0, updated_at=now,
            points=0, exact=False, graded_at=now,
        ))


def test_three_league_isolation_matrix(client):
    """Phase 2: epl/laliga/bundesliga are simultaneously live, real registry
    entries (no monkeypatch needed, unlike the Phase-1-era two-league version
    of this test) -- predictions (summary/mine), both leaderboards (weekly +
    season), and shares must never bleed across tournaments, even for the
    SAME device/handle predicting perfectly in all three."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    laliga = _tournament(db, "La Liga 2026-27")
    bundesliga = _tournament(db, "Bundesliga 2026-27")
    now = datetime.now(timezone.utc)

    fixtures = [
        ("epl", epl, "Arsenal", "Chelsea", 0),
        ("laliga", laliga, "Real Madrid", "Barcelona", 100),
        ("bundesliga", bundesliga, "Bayern Munich", "Dortmund", 200),
    ]
    leagues = {}
    for code, tournament, home_name, away_name, offset in fixtures:
        home, away = _team(db, home_name), _team(db, away_name)
        m = _match(db, tournament, home, away, 1, now - timedelta(days=1),
                   status="finished", score_home=2, score_away=1)
        leagues[code] = {"tournament": tournament, "match": m, "home": home_name}

    # One player, one shared handle, predicts perfectly in EVERY league --
    # tip_players isn't league-scoped, so a shared identity across leagues is
    # exactly the case where isolation could accidentally leak.
    player = TipPlayer(device_id=DEVICE_A, handle="TriLeagueTester")
    db.add(player)
    db.flush()
    for code, data in leagues.items():
        db.add(LeagueScorePrediction(
            tournament_id=data["tournament"].id, match_id=data["match"].id, player_id=player.id,
            predicted_home=2, predicted_away=1, updated_at=now - timedelta(days=2),
            points=5, exact=True, graded_at=now,
        ))
    # 9 more graded players per league (10 each), none of which may inflate
    # another league's count.
    for code, _, _, _, offset in fixtures:
        _fill_graded_players(db, leagues[code]["tournament"], leagues[code]["match"], 9, offset)
    db.commit()

    for code, data in leagues.items():
        summary = c.get(f"/api/leagues/{code}/tips/summary", params={"device_id": DEVICE_A}).json()
        assert summary["league"] == code
        assert summary["totals"] == {"your_points": 5, "model_points": 0, "matchweeks_played": 1}

        mine = c.get(f"/api/leagues/{code}/tips/mine", params={"device_id": DEVICE_A, "matchweek": 1}).json()
        assert mine["league"] == code
        assert [row["home"] for row in mine["matches"]] == [data["home"]]

        weekly = c.get(f"/api/leagues/{code}/tips/leaderboard", params={"matchweek": 1}).json()
        assert weekly["league"] == code
        assert weekly["participant_count"] == 10  # this league's 10, never the other leagues' 20 more
        assert len(weekly["entries"]) == 11  # this league's 10 plus exactly one model row
        assert sum(e["is_model"] for e in weekly["entries"]) == 1

        season = c.get(f"/api/leagues/{code}/tips/leaderboard/season").json()
        assert season["participant_count"] == 10
        assert sum(e["is_model"] for e in season["entries"]) == 1

        share = c.get(f"/api/leagues/{code}/tips/share/1/TriLeagueTester").json()
        assert share["league"] == code
        assert share["handle_display"] == "TriLeagueTester"
        assert share["player_points"] == 5
        assert share["matchweek_complete"] is True


# ---------------------------------------------------------------------------
# POST /api/nrl/tips/claim -- league predictions passthrough (identity reuse)
# ---------------------------------------------------------------------------

def test_claim_simple_path_carries_league_predictions(client):
    """The simple-claim branch (no prior account player) needs no
    sport-specific logic -- it just reassigns tip_players.user_id, so a
    device's league predictions are implicitly claimed too."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che = _team(db, "Arsenal"), _team(db, "Chelsea")
    m = _match(db, epl, ars, che, 1, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "predicted_home": 2, "predicted_away": 1,
    })

    _register(c, "leaguetipper1@example.com")
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text

    db2 = TestingSession()
    player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    assert player.user_id is not None
    pred = db2.query(LeagueScorePrediction).filter_by(player_id=player.id).one()
    assert (pred.predicted_home, pred.predicted_away) == (2, 1)  # untouched, still queryable
    db2.close()


def test_claim_merge_conflict_reassigns_league_predictions_without_crashing(client):
    """Regression for the recon-flagged bug: the merge branch used to touch
    ONLY user_tips before deleting device_player, which would either FK-
    violate or silently drop league_score_predictions rows once a device had
    played both sports and hit the two-existing-players merge path. This
    proves the second reassign/dedupe loop fixes it: the account's own
    prediction survives on conflict, the non-conflicting one moves over, and
    claimed_tips (NRL-only) is unaffected."""
    c, TestingSession = client
    db = TestingSession()
    epl = _epl(db)
    ars, che, bha, whu = (_team(db, n) for n in ("Arsenal", "Chelsea", "Brighton", "West Ham"))
    now = datetime.now(timezone.utc)
    m1 = _match(db, epl, ars, che, 1, now + timedelta(days=1))
    m2 = _match(db, epl, bha, whu, 1, now + timedelta(days=1))
    # Also give device A an NRL tip, so claimed_tips has a real NRL-only count
    # to assert against.
    storm, eels = SportTeam(sport="nrl", name="Storm"), SportTeam(sport="nrl", name="Eels")
    db.add_all([storm, eels])
    db.flush()
    nrl_match = SportMatch(sport="nrl", season=2026, round=1, match_no=1,
                           home_team_id=storm.id, away_team_id=eels.id,
                           kickoff_utc=now + timedelta(days=1), status="scheduled")
    db.add(nrl_match)
    db.commit()

    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": nrl_match.id, "pick": "home"})
    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m1.id, "predicted_home": 2, "predicted_away": 0,
    })
    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_B, "match_id": m1.id, "predicted_home": 0, "predicted_away": 3,
    })
    c.post("/api/leagues/epl/tips/submit", json={
        "device_id": DEVICE_B, "match_id": m2.id, "predicted_home": 1, "predicted_away": 1,
    })

    _register(c, "leaguetipper2@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B})
    assert r.status_code == 200, r.text
    assert r.json()["claimed_tips"] == 0  # NRL-only count: device B had no NRL tips

    db2 = TestingSession()
    account_player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    preds = {
        p.match_id: (p.predicted_home, p.predicted_away)
        for p in db2.query(LeagueScorePrediction).filter_by(player_id=account_player.id).all()
    }
    assert preds[m1.id] == (2, 0)  # account's own prediction wins the conflict, untouched
    assert preds[m2.id] == (1, 1)  # non-conflicting prediction moved over
    assert db2.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None  # merged away
    assert db2.query(UserTip).filter_by(player_id=account_player.id).count() == 1  # NRL tip intact
    db2.close()


def test_claim_merge_conflict_degrades_gracefully_when_league_table_missing(client):
    """Regression for the deploy-sequencing finding: league_score_predictions
    ships in its own migration (b7c8d9e0f1a2), applied to prod via a SEPARATE
    refresh.yml dispatch AFTER this already-live claim code deploys (CLAUDE.md
    migration sequencing). If a real user hits the two-existing-players merge
    branch before that dispatch completes, the NRL-only claim must still
    succeed rather than 500ing on the missing relation -- proves the
    _has_table guard, not just the happy path where the table exists."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = SportTeam(sport="nrl", name="Storm"), SportTeam(sport="nrl", name="Eels")
    db.add_all([storm, eels])
    db.flush()
    now = datetime.now(timezone.utc)
    m1 = SportMatch(sport="nrl", season=2026, round=1, match_no=1,
                    home_team_id=storm.id, away_team_id=eels.id,
                    kickoff_utc=now + timedelta(days=1), status="scheduled")
    m2 = SportMatch(sport="nrl", season=2026, round=1, match_no=2,
                    home_team_id=storm.id, away_team_id=eels.id,
                    kickoff_utc=now + timedelta(days=1), status="scheduled")
    db.add_all([m1, m2])
    db.commit()

    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m1.id, "pick": "home"})
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_B, "match_id": m2.id, "pick": "away"})

    _register(c, "predatemigration@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})

    # league_score_predictions doesn't exist yet -- the exact window the
    # guard is for.
    db.execute(text("DROP TABLE league_score_predictions"))
    db.commit()

    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B})
    assert r.status_code == 200, r.text
    assert r.json()["claimed_tips"] == 1  # B's non-conflicting NRL tip moved over

    db2 = TestingSession()
    account_player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    assert db2.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None  # merged away
    assert db2.query(UserTip).filter_by(player_id=account_player.id).count() == 2  # both tips landed on the account
    db2.close()


# ---------------------------------------------------------------------------
# signed-in players: one account is one player on every device (review H3)
# ---------------------------------------------------------------------------

DEVICE_C = "5fa85f64-5717-4562-b3fc-2c963f66afa8"


def _submit(c, device_id, match, home, away):
    return c.post("/api/leagues/epl/tips/submit", json={
        "device_id": device_id, "match_id": match.id, "predicted_home": home, "predicted_away": away,
    })


def _open_matchweek(db, matchweek=5, n=3):
    epl = _epl(db)
    home, away = _team(db, "Arsenal"), _team(db, "Chelsea")
    kickoff = datetime.now(timezone.utc) + timedelta(days=2)
    matches = [_match(db, epl, home, away, matchweek, kickoff + timedelta(hours=2 * i)) for i in range(n)]
    for m in matches:
        _prediction(db, m, 1, 0)
    db.commit()
    return matches


def test_signed_in_second_device_reads_and_writes_the_accounts_picks(client):
    """Claiming a second device merges its row into the account's player and
    deletes it, so a device-only lookup found nothing there: no picks shown,
    and a fresh row that let the device lock a different score for a match
    the account had already picked (the model revealed) until the next claim
    deleted it. Signed in, every device reads and writes the account's
    player."""
    c, TestingSession = client
    db = TestingSession()
    phone_pick, laptop_pick, unpicked = _open_matchweek(db)

    assert _submit(c, DEVICE_A, phone_pick, 2, 1).status_code == 200  # anonymous, on the phone
    assert _submit(c, DEVICE_B, laptop_pick, 0, 0).status_code == 200  # anonymous, on the laptop
    user_id = _register(c, "two-devices@example.com")
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A}).status_code == 200
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B}).status_code == 200  # merged, B deleted

    check = TestingSession()
    account = check.query(TipPlayer).filter_by(user_id=user_id).one()
    assert check.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None
    check.close()

    mine = c.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_B, "matchweek": 5})
    assert mine.status_code == 200, mine.text
    assert mine.json()["handle"] == account.handle
    picks = {row["id"]: row["your_prediction"] for row in mine.json()["matches"]}
    assert (picks[phone_pick.id]["predicted_home"], picks[phone_pick.id]["predicted_away"]) == (2, 1)
    assert (picks[laptop_pick.id]["predicted_home"], picks[laptop_pick.id]["predicted_away"]) == (0, 0)
    assert picks[unpicked.id] is None

    # The phone's pick is final from every device.
    again = _submit(c, DEVICE_B, phone_pick, 3, 1)
    assert again.status_code == 409, again.text
    assert again.json()["error"]["code"] == "prediction_finalized"

    # A new pick from the laptop lands on the account's player, not a new device row.
    assert _submit(c, DEVICE_B, unpicked, 1, 1).status_code == 200
    check = TestingSession()
    assert check.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None
    assert check.query(LeagueScorePrediction).filter_by(match_id=unpicked.id).one().player_id == account.id
    check.close()

    summary = c.get("/api/leagues/epl/tips/summary", params={"device_id": DEVICE_B}).json()
    assert summary["handle"] == account.handle


def test_signed_out_requests_keep_the_device_only_identity(client):
    """Anonymous play is unchanged: a device reads and writes its own row,
    and a request without a session never resolves through an account --
    even for a device whose row a claim has merged away."""
    c, TestingSession = client
    db = TestingSession()
    first, second, _ = _open_matchweek(db)
    assert _submit(c, DEVICE_A, first, 2, 1).status_code == 200
    assert _submit(c, DEVICE_B, second, 1, 1).status_code == 200
    _register(c, "claims-both@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B})

    anonymous = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})  # no session cookie
    merged_away = anonymous.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_B, "matchweek": 5}).json()
    assert merged_away["handle"] is None
    assert all(row["your_prediction"] is None for row in merged_away["matches"])

    assert _submit(anonymous, DEVICE_C, first, 0, 0).status_code == 200
    check = TestingSession()
    own_row = check.query(TipPlayer).filter_by(device_id=DEVICE_C).one()
    assert own_row.user_id is None
    assert check.query(LeagueScorePrediction).filter_by(player_id=own_row.id).count() == 1
    check.close()


def test_a_signed_in_first_pick_creates_the_accounts_player(client):
    c, TestingSession = client
    db = TestingSession()
    first, _, _ = _open_matchweek(db)
    user_id = _register(c, "fresh@example.com")

    assert _submit(c, DEVICE_C, first, 1, 0).status_code == 200

    check = TestingSession()
    player = check.query(TipPlayer).filter_by(user_id=user_id).one()
    assert player.device_id == DEVICE_C
    assert check.query(LeagueScorePrediction).filter_by(player_id=player.id).count() == 1
    check.close()


def test_a_signed_in_submit_takes_over_this_devices_unclaimed_row(client):
    """No account row yet, but this device has an unclaimed one: the submit
    links it to the account -- exactly what /claim does on the next page
    load -- instead of creating a second player."""
    c, TestingSession = client
    db = TestingSession()
    first, second, _ = _open_matchweek(db)
    assert _submit(c, DEVICE_A, first, 2, 0).status_code == 200  # anonymous
    user_id = _register(c, "link-me@example.com")

    assert _submit(c, DEVICE_A, second, 0, 2).status_code == 200  # signed in, no claim yet

    check = TestingSession()
    players = check.query(TipPlayer).all()
    assert [(p.device_id, p.user_id) for p in players] == [(DEVICE_A, user_id)]
    assert check.query(LeagueScorePrediction).filter_by(player_id=players[0].id).count() == 2
    check.close()


def test_a_shared_device_never_shows_or_takes_another_accounts_picks(client):
    """Signed in on a device another account has claimed: that device's row
    is the other account's, so this account neither sees its picks nor
    writes into it -- it gets a player of its own."""
    c, TestingSession = client
    db = TestingSession()
    first, _, _ = _open_matchweek(db)
    assert _submit(c, DEVICE_A, first, 2, 1).status_code == 200
    owner_id = _register(c, "owner@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})

    guest = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    guest_id = _register(guest, "guest@example.com")
    mine = guest.get("/api/leagues/epl/tips/mine", params={"device_id": DEVICE_A, "matchweek": 5}).json()
    assert mine["handle"] is None
    assert all(row["your_prediction"] is None for row in mine["matches"])

    assert _submit(guest, DEVICE_A, first, 0, 3).status_code == 200  # the guest's own first pick

    check = TestingSession()
    owner = check.query(TipPlayer).filter_by(user_id=owner_id).one()
    guest_player = check.query(TipPlayer).filter_by(user_id=guest_id).one()
    assert owner.device_id == DEVICE_A and guest_player.id != owner.id
    picks = {p.player_id: (p.predicted_home, p.predicted_away)
             for p in check.query(LeagueScorePrediction).filter_by(match_id=first.id).all()}
    assert picks == {owner.id: (2, 1), guest_player.id: (0, 3)}
    check.close()
