"""POST /api/nrl/tips/submit, GET /api/nrl/tips/{mine,summary,leaderboard},
POST /api/nrl/tips/claim -- the beat-the-AI loop (design doc: NRL Round Tips,
Slice 2). Mirrors test_nrl_tips_api.py's fixture style (sport_* tables) plus
test_activity_api.py's Origin-header client for the device-keyed writes."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import SportMatch, SportPrediction, SportTeam, TipPlayer, UserTip

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


def _team(db, name):
    t = SportTeam(sport="nrl", name=name)
    db.add(t)
    db.flush()
    return t


def _match(db, season, rnd, match_no, home, away, kickoff, **kw):
    m = SportMatch(sport="nrl", season=season, round=rnd, match_no=match_no,
                   kickoff_utc=kickoff, home_team_id=home.id, away_team_id=away.id,
                   status=kw.pop("status", "scheduled"), **kw)
    db.add(m)
    db.flush()
    return m


def _prediction(db, match, p_home=0.6, p_draw=0.01, created_at=None):
    p = SportPrediction(match_id=match.id, model_version="nrl-elo-v0.1",
                        created_at=created_at or (match.kickoff_utc - timedelta(days=1)),
                        p_home=p_home, p_draw=p_draw, p_away=round(1 - p_home - p_draw, 4),
                        expected_margin=4.0)
    db.add(p)
    db.flush()
    return p


# ---------------------------------------------------------------------------
# submit: kickoff lock + upsert-until-kickoff + margin bounds
# ---------------------------------------------------------------------------

def test_submit_before_kickoff_ok(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, 2026, 1, 1, storm, eels, kick)
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["tip"]["pick"] == "home"
    assert body["handle"]  # auto-generated, non-empty

    db2 = TestingSession()
    tip = db2.query(UserTip).one()
    assert tip.pick == "home"
    assert tip.points is None and tip.graded_at is None  # ungraded until the separate pass runs
    db2.close()


def test_submit_at_or_after_kickoff_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) - timedelta(seconds=1)  # already passed
    m = _match(db, 2026, 1, 1, storm, eels, kick)
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "match_locked"

    db2 = TestingSession()
    assert db2.query(UserTip).count() == 0
    db2.close()


def test_edit_after_kickoff_rejected(client):
    """A pick made before kickoff cannot be changed once kickoff passes."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) + timedelta(seconds=2)
    m = _match(db, 2026, 1, 1, storm, eels, kick)
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert r.status_code == 200, r.text

    # Push kickoff into the past directly (avoids a real sleep in the suite)
    # and try to change the pick -- must be rejected, never silently accepted.
    db2 = TestingSession()
    row = db2.query(SportMatch).filter_by(id=m.id).one()
    row.kickoff_utc = datetime.now(timezone.utc) - timedelta(seconds=1)
    db2.commit()
    db2.close()

    r2 = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "away"})
    assert r2.status_code == 422
    assert r2.json()["error"]["code"] == "match_locked"

    db3 = TestingSession()
    tip = db3.query(UserTip).one()
    assert tip.pick == "home"  # unchanged
    db3.close()


def test_upsert_changes_pick_until_kickoff(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, 2026, 1, 1, storm, eels, kick)
    db.commit()

    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "away"})
    assert r.status_code == 200
    assert r.json()["tip"]["pick"] == "away"

    db2 = TestingSession()
    assert db2.query(UserTip).count() == 1  # upsert, not a second row
    assert db2.query(UserTip).one().pick == "away"
    db2.close()


def test_margin_accepted_only_on_featured_match(client):
    """Featured match = earliest kickoff in the round."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels, broncos, titans = (_team(db, n) for n in ("Storm", "Eels", "Broncos", "Titans"))
    now = datetime.now(timezone.utc)
    featured = _match(db, 2026, 1, 1, storm, eels, now + timedelta(hours=1))
    later = _match(db, 2026, 1, 2, broncos, titans, now + timedelta(days=1))
    db.commit()

    ok = c.post("/api/nrl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": featured.id, "pick": "home", "margin": 12,
    })
    assert ok.status_code == 200, ok.text
    assert ok.json()["tip"]["margin"] == 12

    rejected = c.post("/api/nrl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": later.id, "pick": "home", "margin": 6,
    })
    assert rejected.status_code == 422
    assert rejected.json()["error"]["code"] == "margin_not_allowed"


def test_margin_out_of_bounds_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(hours=1))
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={
        "device_id": DEVICE_A, "match_id": m.id, "pick": "home", "margin": 101,
    })
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "bad_margin"


def test_bad_pick_rejected(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(hours=1))
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "banana"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "bad_pick"


def test_invalid_device_id_rejected_on_submit(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(hours=1))
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": "not-a-uuid", "match_id": m.id, "pick": "home"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_device_id"

    db2 = TestingSession()
    assert db2.query(TipPlayer).count() == 0  # rejected before any player row is created
    db2.close()


def test_foreign_origin_rejected_on_submit(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(hours=1))
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"},
              headers={"Origin": "https://evil.example.com"})
    assert r.status_code == 403
    assert r.json()["error"]["code"] == "forbidden_origin"


def test_unknown_match_404s(client):
    c, _ = client
    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": 999, "pick": "home"})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "match_not_found"


def test_finished_match_with_no_kickoff_is_locked(client):
    """Belt-and-braces on top of the kickoff comparison: a match that already
    has a final score is locked even with kickoff_utc missing -- not
    reachable via today's NRL feed, but the kickoff check alone would
    otherwise wave a null-kickoff match through regardless of status."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, None, status="finished",
              score_home=20, score_away=10)
    db.commit()

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "match_locked"


def test_concurrent_first_submit_new_device_is_idempotent_not_a_500(client, monkeypatch):
    """Two concurrent first-submits from the same brand-new device can both
    pass _get_or_create_player's pre-check; the second's insert must hit
    tip_players.device_id's UNIQUE constraint and still resolve as a normal
    success, never a 500 -- simulated by forcing the pre-check to miss a row
    that's already committed (mirrors test_activity_api.py's race test)."""
    import app.api.nrl_user_tips as nrl_user_tips_api
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.add(TipPlayer(device_id=DEVICE_A, handle="AlreadyThere"))
    db.commit()

    monkeypatch.setattr(nrl_user_tips_api, "_find_player", lambda db, device_id: None, raising=False)

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert r.status_code == 200, r.text

    db2 = TestingSession()
    assert db2.query(TipPlayer).filter_by(device_id=DEVICE_A).count() == 1
    tip = db2.query(UserTip).one()
    assert tip.pick == "home"
    db2.close()


def test_concurrent_first_tip_same_match_is_idempotent_not_a_500(client, monkeypatch):
    """Two concurrent first-submits to the same (match, player) can both pass
    _find_tip's pre-check; the second's insert must hit
    uq_user_tip_match_player and still resolve as a normal success, never a
    500 -- same forced-miss idiom as the device-race test above."""
    import app.api.nrl_user_tips as nrl_user_tips_api
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    monkeypatch.setattr(nrl_user_tips_api, "_find_tip", lambda db, match_id, player_id: None, raising=False)

    r = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "away"})
    assert r.status_code == 200, r.text

    db2 = TestingSession()
    assert db2.query(UserTip).count() == 1  # still one row, not a duplicate
    assert db2.query(UserTip).one().pick == "away"  # this request's pick won the race
    db2.close()


# ---------------------------------------------------------------------------
# GET /mine
# ---------------------------------------------------------------------------

def test_mine_shows_model_pick_and_your_tip_side_by_side(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) + timedelta(days=1)
    m = _match(db, 2026, 1, 1, storm, eels, kick)
    _prediction(db, m, p_home=0.65)
    db.commit()

    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "away"})

    r = c.get("/api/nrl/tips/mine", params={"device_id": DEVICE_A, "season": 2026, "round": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["season"] == 2026 and body["round"] == 1
    assert body["handle"]
    match = body["matches"][0]
    assert match["home"] == "Storm" and match["away"] == "Eels"
    assert match["is_featured"] is True  # only match in the round
    assert match["model"]["pick"] == "home"
    assert match["your_tip"]["pick"] == "away"
    assert match["your_tip"]["points"] is None  # ungraded


def test_mine_unknown_device_returns_null_handle_no_tips(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()

    r = c.get("/api/nrl/tips/mine", params={"device_id": DEVICE_B, "season": 2026, "round": 1})
    assert r.status_code == 200
    body = r.json()
    assert body["handle"] is None
    assert body["matches"][0]["your_tip"] is None


def test_mine_invalid_device_id_422s(client):
    c, _ = client
    r = c.get("/api/nrl/tips/mine", params={"device_id": "garbage", "season": 2026, "round": 1})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_device_id"


# ---------------------------------------------------------------------------
# GET /summary -- draw scoring rule (model's side, computed live)
# ---------------------------------------------------------------------------

def test_summary_applies_draw_rule_to_model_points(client):
    """The match drew; the model picked home, not draw. Comp-standard scoring
    says a draw scores EVERY tipper regardless of pick -- so the model's
    round points must still count this match, even though the model's own
    graded ledger (winner_correct, strict pick match) would not."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    kick = datetime.now(timezone.utc) - timedelta(days=1)
    m = _match(db, 2026, 1, 1, storm, eels, kick, status="finished", score_home=18, score_away=18)
    _prediction(db, m, p_home=0.7, created_at=kick - timedelta(days=1))
    db.flush()
    player = TipPlayer(device_id=DEVICE_A, handle="TestTipper1")
    db.add(player)
    db.flush()
    # Graded by the (separate) grading pass this builder doesn't own -- seeded
    # directly, same as test_sports_api.py seeds SportPredictionResult rows.
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="away",
                   points=1, round_margin=None, graded_at=datetime.now(timezone.utc)))
    db.commit()

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["totals"]["your_points"] == 1
    assert body["totals"]["model_points"] == 1  # draw -> model scores despite picking home
    assert body["rounds"][0] == {
        "season": 2026, "round": 1, "your_points": 1, "model_points": 1, "matches_played": 1,
    }


def test_summary_ungraded_tips_are_not_played_rounds(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200
    body = r.json()
    assert body["rounds"] == []
    assert body["totals"] == {"your_points": 0, "model_points": 0, "rounds_played": 0}


# ---------------------------------------------------------------------------
# GET /summary -- streaks + best_round (Slice 2.5)
# ---------------------------------------------------------------------------

def test_summary_streaks_null_safe_no_player(client):
    c, _ = client
    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_B})
    assert r.status_code == 200
    body = r.json()
    assert body["current_streak"] == 0
    assert body["best_streak"] == 0
    assert body["best_round"] is None


def test_summary_streaks_null_safe_ungraded_only(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200
    body = r.json()
    assert body["current_streak"] == 0
    assert body["best_streak"] == 0
    assert body["best_round"] is None


def test_summary_streaks_ordered_by_kickoff_not_id(client):
    """Kickoff order is win, win, loss, win -> current_streak=1, best_streak=2.
    Rows are inserted in a DIFFERENT order than their kickoff times so a bug
    that sorted by insertion/id instead of kickoff_utc would get this wrong
    (id order here is loss, win, win, win -> would wrongly give current=3)."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    player = TipPlayer(device_id=DEVICE_A, handle="Streaker1")
    db.add(player)
    db.flush()

    m_loss = _match(db, 2026, 1, 3, storm, eels, now - timedelta(days=2),
                    status="finished", score_home=10, score_away=20)
    m_win4 = _match(db, 2026, 1, 4, storm, eels, now - timedelta(days=1),
                    status="finished", score_home=20, score_away=10)
    m_win1 = _match(db, 2026, 1, 1, storm, eels, now - timedelta(days=4),
                    status="finished", score_home=20, score_away=10)
    m_win2 = _match(db, 2026, 1, 2, storm, eels, now - timedelta(days=3),
                    status="finished", score_home=20, score_away=10)
    db.flush()

    db.add(UserTip(match_id=m_loss.id, player_id=player.id, pick="away", points=0, graded_at=now))
    db.add(UserTip(match_id=m_win4.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.add(UserTip(match_id=m_win1.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.add(UserTip(match_id=m_win2.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["current_streak"] == 1
    assert body["best_streak"] == 2


def test_summary_best_round_ties_pick_later_round(client):
    """Two rounds tie on points; the LATER (season, round) wins the tie --
    documented rule, mirrors rounds_out's own (season, round) ascending sort."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    player = TipPlayer(device_id=DEVICE_A, handle="Tiebreaker1")
    db.add(player)
    db.flush()

    m1 = _match(db, 2026, 1, 1, storm, eels, now - timedelta(days=2),
               status="finished", score_home=20, score_away=10)
    m3 = _match(db, 2026, 3, 1, storm, eels, now - timedelta(days=1),
               status="finished", score_home=20, score_away=10)
    db.flush()

    db.add(UserTip(match_id=m1.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.add(UserTip(match_id=m3.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["best_round"] == {"round": 3, "points": 1}


def test_summary_streaks_do_not_span_seasons(client):
    """A win in the LAST graded match of one season and a win in the FIRST
    graded match of the next must not join into one streak across the
    off-season -- streaks/best_round are season-scoped (design doc, Slice
    2.5), reset at the season boundary even though both tips are graded and
    ordering by kickoff alone would otherwise chain them together."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    player = TipPlayer(device_id=DEVICE_A, handle="SeasonSpanner1")
    db.add(player)
    db.flush()

    m_last_2026 = _match(db, 2026, 26, 1, storm, eels, now - timedelta(days=200),
                         status="finished", score_home=20, score_away=10)
    m_first_2027 = _match(db, 2027, 1, 1, storm, eels, now - timedelta(days=1),
                          status="finished", score_home=20, score_away=10)
    db.flush()

    db.add(UserTip(match_id=m_last_2026.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.add(UserTip(match_id=m_first_2027.id, player_id=player.id, pick="home", points=1, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    # A cross-season streak of 2 would be the bug this test guards against --
    # only the current season's (2027) win counts.
    assert body["current_streak"] == 1
    assert body["best_streak"] == 1
    assert body["best_round"] == {"round": 1, "points": 1}
    # rounds/totals stay season-long (unaffected by the streak/best_round scope).
    assert body["totals"] == {"your_points": 2, "model_points": 0, "rounds_played": 2}


def test_summary_best_round_null_when_every_graded_round_scored_zero(client):
    """A player who tipped and got every pick wrong must not see a best_round
    chip bragging about a zero -- StreakChips already suppresses zero streaks,
    best_round must match that convention."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    player = TipPlayer(device_id=DEVICE_A, handle="Zeroed1")
    db.add(player)
    db.flush()

    m1 = _match(db, 2026, 1, 1, storm, eels, now - timedelta(days=2),
               status="finished", score_home=10, score_away=20)
    m2 = _match(db, 2026, 2, 1, storm, eels, now - timedelta(days=1),
               status="finished", score_home=10, score_away=20)
    db.flush()

    db.add(UserTip(match_id=m1.id, player_id=player.id, pick="home", points=0, graded_at=now))
    db.add(UserTip(match_id=m2.id, player_id=player.id, pick="home", points=0, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["best_round"] is None


# ---------------------------------------------------------------------------
# GET /leaderboard -- never hidden + ranking (points desc, margin asc), with
# the model always a ranked row (UX rebuild 2026-11, Phase 0)
# ---------------------------------------------------------------------------

MODEL_HANDLE = "FinalWhistle model"


def _seed_leaderboard_round(db, n_players, points_and_margins):
    """points_and_margins: list of (points, round_margin) for the featured
    match tip of each of n_players devices."""
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 5, 1, storm, eels,
              datetime.now(timezone.utc) - timedelta(days=1), status="finished",
              score_home=20, score_away=10)
    db.flush()
    for i in range(n_players):
        p = TipPlayer(device_id=f"aaaaaaaa-0000-4000-8000-{i:012d}", handle=f"Player{i}")
        db.add(p)
        db.flush()
        points, margin = points_and_margins[i]
        db.add(UserTip(match_id=m.id, player_id=p.id, pick="home",
                       points=points, round_margin=margin, graded_at=datetime.now(timezone.utc)))
    db.commit()
    return m


def test_leaderboard_never_hides_below_the_old_ten_player_gate(client):
    """The old >=10 reveal gate meant no NRL board ever rendered a row (3
    players live in November 2026). Nine tippers now see all nine rows, plus
    the model's -- which never counts as a participant."""
    c, TestingSession = client
    db = TestingSession()
    _seed_leaderboard_round(db, 9, [(1, i) for i in range(9)])

    r = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 9
    assert [e["handle"] for e in body["entries"]] == [f"Player{i}" for i in range(9)] + [MODEL_HANDLE]


def test_leaderboard_ranked_points_then_margin(client):
    c, TestingSession = client
    db = TestingSession()
    # 10 players: player 0 has the most points; players 1-2 tie on points but
    # player 2's margin is closer (better tiebreak).
    points_and_margins = [(1, 5)] + [(0, 8), (0, 3)] + [(0, None)] * 7
    _seed_leaderboard_round(db, 10, points_and_margins)

    r = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 5})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 10
    entries = body["entries"]
    assert len(entries) == 11  # ten tippers plus the model
    assert entries[0]["handle"] == "Player0" and entries[0]["points"] == 1
    assert entries[1]["handle"] == "Player2" and entries[1]["round_margin"] == 3
    assert entries[2]["handle"] == "Player1" and entries[2]["round_margin"] == 8
    # No model prediction was seeded, so the model sits at zero with no margin:
    # level with Player3-9 on every key, and a tie goes to the humans.
    assert entries[-1]["is_model"] is True and entries[-1]["points"] == 0
    assert all("device_id" not in e for e in entries)  # never exposed


def test_leaderboard_unknown_round_404s(client):
    c, _ = client
    r = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 99})
    assert r.status_code == 404


# ---------------------------------------------------------------------------
# GET /leaderboard/season -- season totals, never hidden, total_margin
# tiebreak (Slice 2.5)
# ---------------------------------------------------------------------------

def _seed_season_player(db, match, device_id, handle, points, margin):
    """One player's graded tip on `match` -- mirrors _seed_leaderboard_round's
    direct-insert idiom, but returns the player so a second round's tip can be
    added onto it (season totals span more than one round's featured match)."""
    p = TipPlayer(device_id=device_id, handle=handle)
    db.add(p)
    db.flush()
    db.add(UserTip(match_id=match.id, player_id=p.id, pick="home",
                   points=points, round_margin=margin, graded_at=datetime.now(timezone.utc)))
    return p


def test_season_leaderboard_never_hides_below_the_old_ten_player_gate(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 5, 1, storm, eels, datetime.now(timezone.utc) - timedelta(days=1),
              status="finished", score_home=20, score_away=10)
    db.flush()
    for i in range(9):
        _seed_season_player(db, m, f"bbbbbbbb-0000-4000-8000-{i:012d}", f"SPlayer{i}", 1, i)
    db.commit()

    r = c.get("/api/nrl/tips/leaderboard/season", params={"season": 2026})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 9
    assert [e["handle"] for e in body["entries"]] == [f"SPlayer{i}" for i in range(9)] + [MODEL_HANDLE]


def test_season_leaderboard_ranking_points_then_total_margin(client):
    """10 participants across two rounds. Top0/Top1 tie on season points and
    are ranked by cumulative total_margin (summed across both rounds); a
    second tier ties on points with one player having a real (if large)
    margin and the other having none -- the real margin ranks ABOVE the
    missing one, since a missing total_margin sorts last (like the weekly
    board's missing round_margin), never a false "0" beating a real attempt."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    round_a = _match(db, 2026, 5, 1, storm, eels, datetime.now(timezone.utc) - timedelta(days=2),
                     status="finished", score_home=20, score_away=10)
    round_b = _match(db, 2026, 6, 1, storm, eels, datetime.now(timezone.utc) - timedelta(days=1),
                     status="finished", score_home=18, score_away=12)
    db.flush()

    top0 = _seed_season_player(db, round_a, "cccccccc-0000-4000-8000-000000000000", "Top0", 1, 5)
    db.add(UserTip(match_id=round_b.id, player_id=top0.id, pick="home", points=1, round_margin=2,
                   graded_at=datetime.now(timezone.utc)))
    top1 = _seed_season_player(db, round_a, "cccccccc-0000-4000-8000-000000000001", "Top1", 1, 1)
    db.add(UserTip(match_id=round_b.id, player_id=top1.id, pick="home", points=1, round_margin=10,
                   graded_at=datetime.now(timezone.utc)))
    _seed_season_player(db, round_a, "cccccccc-0000-4000-8000-000000000002", "NoMargin", 1, None)
    _seed_season_player(db, round_a, "cccccccc-0000-4000-8000-000000000003", "WithMargin", 1, 50)
    for i in range(4, 10):
        _seed_season_player(db, round_a, f"cccccccc-0000-4000-8000-{i:012d}", f"Zero{i}", 0, None)
    db.commit()

    r = c.get("/api/nrl/tips/leaderboard/season", params={"season": 2026})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 10
    entries = body["entries"]
    assert entries[0] == {"handle": "Top0", "points": 2, "total_margin": 7, "rounds_played": 2, "is_model": False}
    assert entries[1] == {"handle": "Top1", "points": 2, "total_margin": 11, "rounds_played": 2, "is_model": False}
    assert entries[2]["handle"] == "WithMargin" and entries[2]["total_margin"] == 50
    assert entries[3]["handle"] == "NoMargin" and entries[3]["total_margin"] is None
    assert all("device_id" not in e for e in entries)


def test_season_leaderboard_unknown_season_404s(client):
    c, _ = client
    r = c.get("/api/nrl/tips/leaderboard/season", params={"season": 2099})
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "season_not_found"


# ---------------------------------------------------------------------------
# The model as a ranked row on both boards (UX rebuild 2026-11, Phase 0)
# ---------------------------------------------------------------------------

def test_leaderboard_single_tipper_is_ranked_against_the_model(client):
    """One tipper still gets a real board ("You #1 of 2"): their own row and
    the model's, which participant_count never counts. The model never
    enters a margin guess, so its round_margin is None."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    m = _match(db, 2026, 5, 1, storm, eels, now - timedelta(days=1), status="finished",
               score_home=20, score_away=10)
    _prediction(db, m, p_home=0.4)  # p_away 0.59: the model picked away and missed
    player = TipPlayer(device_id=DEVICE_A, handle="SoloTipper")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", margin=7,
                   points=1, round_margin=3, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 5})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 1
    assert body["entries"] == [
        {"handle": "SoloTipper", "points": 1, "round_margin": 3, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 0, "round_margin": None, "is_model": True},
    ]
    assert DEVICE_A not in r.text  # human rows still never expose a device_id


def test_leaderboard_model_row_scores_kickoff_locked_picks_on_graded_matches_only(client):
    """The model's row is _scores_point (draw rule included) applied to its
    kickoff-locked pick on every GRADED match of the round -- finished, with
    a kickoff and a final score, the grading pass's own conditions. A
    post-kickoff write is never its pick, and a match nrl-refresh hasn't
    marked finished yet earns nothing."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    kick = now - timedelta(days=1)
    drew = _match(db, 2026, 6, 1, storm, eels, kick, status="finished", score_home=18, score_away=18)
    _prediction(db, drew, p_home=0.7)  # picked home; a draw scores every tipper -> 1
    away_win = _match(db, 2026, 6, 2, storm, eels, kick, status="finished", score_home=10, score_away=20)
    _prediction(db, away_win, p_home=0.3)  # picked away (0.69) -> 1
    _prediction(db, away_win, p_home=0.9, created_at=kick + timedelta(minutes=20))  # after kickoff: ignored
    missed = _match(db, 2026, 6, 3, storm, eels, kick, status="finished", score_home=30, score_away=0)
    _prediction(db, missed, p_home=0.2)  # picked away -> 0
    lagging = _match(db, 2026, 6, 4, storm, eels, now - timedelta(hours=1))  # still "scheduled"
    _prediction(db, lagging, p_home=0.6)
    late_only = _match(db, 2026, 6, 5, storm, eels, kick, status="finished", score_home=12, score_away=6)
    _prediction(db, late_only, p_home=0.8, created_at=kick + timedelta(hours=1))  # no eligible pick
    db.commit()

    body = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 6}).json()

    assert body["participant_count"] == 0
    assert body["entries"] == [{"handle": MODEL_HANDLE, "points": 2, "round_margin": None, "is_model": True}]


def test_leaderboard_ungraded_round_gives_the_model_zero(client):
    """Nothing graded yet: the model sits at zero, and a tipper level with it
    on every key ranks above it -- the tie goes to the human."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 8, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=2))
    _prediction(db, m, p_home=0.6)
    db.commit()

    empty = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 8}).json()
    assert empty["participant_count"] == 0
    assert empty["entries"] == [{"handle": MODEL_HANDLE, "points": 0, "round_margin": None, "is_model": True}]

    submitted = c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})
    assert submitted.status_code == 200, submitted.text
    handle = submitted.json()["handle"]

    body = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 8}).json()
    assert body["participant_count"] == 1
    assert body["entries"] == [
        {"handle": handle, "points": 0, "round_margin": None, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 0, "round_margin": None, "is_model": True},
    ]


def test_leaderboard_model_points_equal_the_summary_model_points(client):
    """One computation, not two: for a tipper who tipped every graded match
    of a round, the board's model row and /summary's model_points for that
    round are the same number."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    kick = now - timedelta(days=1)
    player = TipPlayer(device_id=DEVICE_A, handle="ParityTipper")
    db.add(player)
    db.flush()
    for no, (home_pts, away_pts), p_home in ((1, (18, 18), 0.7), (2, (10, 20), 0.3), (3, (30, 0), 0.2)):
        m = _match(db, 2026, 4, no, storm, eels, kick, status="finished",
                   score_home=home_pts, score_away=away_pts)
        _prediction(db, m, p_home=p_home)
        db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", points=0, graded_at=now))
    db.commit()

    summary = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A}).json()
    board = c.get("/api/nrl/tips/leaderboard", params={"season": 2026, "round": 4}).json()

    model_row = next(e for e in board["entries"] if e["is_model"])
    assert summary["rounds"][0]["model_points"] == model_row["points"] == 2


def test_season_leaderboard_ranks_a_tipper_against_the_models_season_total(client):
    """The season row is the model's points across every graded match of the
    season: last season's matches, or one still to be played, never count.
    rounds_played counts rounds the model was scored in, a zero-point one
    included -- the same rule a tipper's row follows."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    r1 = _match(db, 2026, 1, 1, storm, eels, now - timedelta(days=14), status="finished",
                score_home=20, score_away=10)
    _prediction(db, r1, p_home=0.6)  # correct -> 1
    r2 = _match(db, 2026, 2, 1, storm, eels, now - timedelta(days=7), status="finished",
                score_home=6, score_away=24)
    _prediction(db, r2, p_home=0.6)  # wrong -> 0, but a round the model played
    r3 = _match(db, 2026, 3, 1, storm, eels, now + timedelta(days=7))
    _prediction(db, r3, p_home=0.6)  # not played yet
    old = _match(db, 2025, 27, 1, storm, eels, now - timedelta(days=400), status="finished",
                 score_home=40, score_away=0)
    _prediction(db, old, p_home=0.6)  # last season's hit
    player = TipPlayer(device_id=DEVICE_A, handle="SeasonTipper")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=r1.id, player_id=player.id, pick="home", margin=6,
                   points=1, round_margin=4, graded_at=now))
    db.commit()

    r = c.get("/api/nrl/tips/leaderboard/season", params={"season": 2026})

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["participant_count"] == 1
    # Level on points; the tipper's real margin outranks the model's missing one.
    assert body["entries"] == [
        {"handle": "SeasonTipper", "points": 1, "total_margin": 4, "rounds_played": 1, "is_model": False},
        {"handle": MODEL_HANDLE, "points": 1, "total_margin": None, "rounds_played": 2, "is_model": True},
    ]
    assert DEVICE_A not in r.text


# ---------------------------------------------------------------------------
# GET /mine -- stale-aware default round (UX rebuild 2026-11, Phase 0)
# ---------------------------------------------------------------------------

def test_mine_default_round_skips_a_round_pinned_by_a_lagging_scheduled_row(client):
    """nrl-refresh can lag a played match's status by days, and the old
    `status != "finished"` rule pinned the default round to it. A scheduled
    match whose kickoff has passed is not tippable, so the default is the
    round of the next one that is."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    now = datetime.now(timezone.utc)
    _match(db, 2026, 26, 1, storm, eels, now - timedelta(days=2))  # played, still "scheduled"
    _match(db, 2026, 26, 2, storm, eels, now - timedelta(days=3), status="finished",
           score_home=12, score_away=10)
    upcoming = _match(db, 2026, 27, 1, storm, eels, now + timedelta(days=2))
    db.commit()

    r = c.get("/api/nrl/tips/mine", params={"device_id": DEVICE_A})

    assert r.status_code == 200, r.text
    assert r.json()["round"] == 27
    assert [row["id"] for row in r.json()["matches"]] == [upcoming.id]


# ---------------------------------------------------------------------------
# GET /share/{season}/{round}/{handle} -- public, handle-addressed (Slice 2.5)
# ---------------------------------------------------------------------------

def _seed_graded_round(db, season, rnd, kickoff, p_home=0.6):
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, season, rnd, 1, storm, eels, kickoff, status="finished",
              score_home=20, score_away=10)
    _prediction(db, m, p_home=p_home)
    db.flush()
    return m


def test_share_happy_path(client):
    c, TestingSession = client
    db = TestingSession()
    m = _seed_graded_round(db, 2026, 7, datetime.now(timezone.utc) - timedelta(days=1))
    player = TipPlayer(device_id=DEVICE_A, handle="SharedHandle1")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", points=1, round_margin=3,
                   graded_at=datetime.now(timezone.utc)))
    db.commit()

    r = c.get("/api/nrl/tips/share/2026/7/SharedHandle1")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["handle_display"] == "SharedHandle1"
    assert body["season"] == 2026 and body["round"] == 7
    assert body["player_points"] == 1 and body["player_of"] == 1
    assert body["model_points"] == 1 and body["model_of"] == 1  # p_home=0.6 -> model picks home too
    assert body["margin_note"] == "Featured-match margin tiebreak score: 3"
    assert body["round_complete"] is True  # the round's only match is finished
    assert "disclaimer" in body
    assert "pick" not in body  # never leaks the raw pick


def test_share_unknown_handle_404s(client):
    c, _ = client
    r = c.get("/api/nrl/tips/share/2026/7/NobodyHome999")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "share_not_found"


def test_share_ungraded_round_404s(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 8, 1, storm, eels, datetime.now(timezone.utc) - timedelta(days=1),
              status="finished", score_home=20, score_away=10)
    player = TipPlayer(device_id=DEVICE_A, handle="Ungraded1")
    db.add(player)
    db.flush()
    # Tip exists but the grading pass hasn't run for this round yet.
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", graded_at=None))
    db.commit()

    r = c.get("/api/nrl/tips/share/2026/8/Ungraded1")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "share_not_found"


def test_share_future_round_tips_never_leak_pre_kickoff_picks(client):
    """A player with ONLY a future (not-yet-kicked-off, ungraded) tip must get
    a plain 404 -- never a fabricated card -- and the response body must
    never contain a pick field regardless."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 9, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=3))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    db2 = TestingSession()
    handle = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one().handle
    db2.close()

    r = c.get(f"/api/nrl/tips/share/2026/9/{handle}")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "share_not_found"
    assert "pick" not in r.text


def test_share_model_points_parity_with_summary(client):
    """The share card's model_points for a round must equal what /summary
    computes for the same device/round -- same live-scoring path, same tip."""
    c, TestingSession = client
    db = TestingSession()
    m = _seed_graded_round(db, 2026, 10, datetime.now(timezone.utc) - timedelta(days=1), p_home=0.55)
    player = TipPlayer(device_id=DEVICE_A, handle="ParityCheck1")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="away", points=0,
                   graded_at=datetime.now(timezone.utc)))
    db.commit()

    summary = c.get("/api/nrl/tips/summary", params={"device_id": DEVICE_A})
    share = c.get("/api/nrl/tips/share/2026/10/ParityCheck1")
    assert summary.status_code == 200 and share.status_code == 200, (summary.text, share.text)

    round_out = next(r for r in summary.json()["rounds"] if r["round"] == 10)
    assert round_out["model_points"] == share.json()["model_points"]
    assert round_out["your_points"] == share.json()["player_points"]


def test_share_round_complete_false_while_other_round_matches_are_unplayed(client):
    """NRL rounds run Thu-Sun and grading is per FINISHED MATCH, not per whole
    round (pipeline.sports.nrl_user_tips) -- a round can sit partially graded
    for days. round_complete must be False while any match in the round
    hasn't finished yet, even though the player's own tip is already graded,
    so the share page can soften "beat the AI this round" to a provisional
    framing instead of claiming a final result."""
    c, TestingSession = client
    db = TestingSession()
    m = _seed_graded_round(db, 2026, 11, datetime.now(timezone.utc) - timedelta(days=2))
    storm2, eels2 = _team(db, "Roosters"), _team(db, "Broncos")
    _match(db, 2026, 11, 2, storm2, eels2, datetime.now(timezone.utc) + timedelta(days=1))
    player = TipPlayer(device_id=DEVICE_A, handle="PartialRound1")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", points=1,
                   graded_at=datetime.now(timezone.utc)))
    db.commit()

    r = c.get("/api/nrl/tips/share/2026/11/PartialRound1")
    assert r.status_code == 200, r.text
    assert r.json()["round_complete"] is False


def test_share_round_complete_true_when_every_round_match_finished(client):
    c, TestingSession = client
    db = TestingSession()
    m = _seed_graded_round(db, 2026, 12, datetime.now(timezone.utc) - timedelta(days=1))
    player = TipPlayer(device_id=DEVICE_A, handle="FullRound1")
    db.add(player)
    db.flush()
    db.add(UserTip(match_id=m.id, player_id=player.id, pick="home", points=1,
                   graded_at=datetime.now(timezone.utc)))
    db.commit()

    r = c.get("/api/nrl/tips/share/2026/12/FullRound1")
    assert r.status_code == 200, r.text
    assert r.json()["round_complete"] is True


# ---------------------------------------------------------------------------
# POST /claim -- idempotency + merge conflict rule
# ---------------------------------------------------------------------------

def _register(c, email):
    r = c.post("/api/auth/register", json={"email": email, "password": "supersecret1"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_claim_attaches_device_with_no_prior_account_player(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    _register(c, "tipper1@example.com")
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert body["claimed_tips"] == 1

    db2 = TestingSession()
    player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    assert player.user_id is not None
    db2.close()


def test_claim_is_idempotent_on_repeat_call(client):
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    _register(c, "tipper2@example.com")
    first = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    second = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["claimed_tips"] == 1  # not double-counted

    db2 = TestingSession()
    assert db2.query(TipPlayer).count() == 1
    db2.close()


def test_claim_unknown_device_is_a_no_op_success(client):
    c, _ = client
    _register(c, "tipper3@example.com")
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "handle": None, "claimed_tips": 0}


def test_claim_merges_second_device_keeping_accounts_tip_on_conflict(client):
    """The account already claimed device A (with a pick for match 1). It then
    claims device B, which has picks for match 1 (conflicting) AND match 2
    (no conflict). The account's own match-1 pick must survive unchanged;
    match 2 must move over."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels, broncos, titans = (_team(db, n) for n in ("Storm", "Eels", "Broncos", "Titans"))
    now = datetime.now(timezone.utc)
    m1 = _match(db, 2026, 1, 1, storm, eels, now + timedelta(days=1))
    m2 = _match(db, 2026, 1, 2, broncos, titans, now + timedelta(days=1))
    db.commit()

    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m1.id, "pick": "home"})
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_B, "match_id": m1.id, "pick": "away"})
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_B, "match_id": m2.id, "pick": "home"})

    _register(c, "tipper4@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B})
    assert r.status_code == 200, r.text
    assert r.json()["claimed_tips"] == 1  # only match 2 moved; match 1 was a conflict

    db2 = TestingSession()
    account_player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    assert account_player.user_id is not None
    tips = {t.match_id: t.pick for t in db2.query(UserTip).filter_by(player_id=account_player.id).all()}
    assert tips[m1.id] == "home"  # account's own pick wins, not overwritten by device B's "away"
    assert tips[m2.id] == "home"  # non-conflicting pick moved over
    # Device B's player row is gone -- its tips were fully migrated/dropped.
    assert db2.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None
    db2.close()


def test_claim_does_not_reassign_device_owned_by_another_account(client):
    """Account V already claimed device D. On the same device, account A
    (freshly registered, no player row of its own) must never be able to
    steal D by claiming it -- that would silently strip V of their entire
    tip history (broken access control)."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels = _team(db, "Storm"), _team(db, "Eels")
    m = _match(db, 2026, 1, 1, storm, eels, datetime.now(timezone.utc) + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m.id, "pick": "home"})

    victim_id = _register(c, "victim@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})

    _register(c, "attacker@example.com")  # same cookie jar -- now signed in as the attacker
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 200
    assert r.json()["claimed_tips"] == 0  # no-op, not a hijack

    db2 = TestingSession()
    device_player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one()
    assert device_player.user_id == victim_id  # still owned by the victim, unchanged
    db2.close()


def test_claim_does_not_merge_or_delete_device_owned_by_another_account(client):
    """Same access-control gap via the merge branch: an attacker who already
    has their own player row must not be able to merge-and-delete a device's
    TipPlayer that a different account already claimed."""
    c, TestingSession = client
    db = TestingSession()
    storm, eels, broncos, titans = (_team(db, n) for n in ("Storm", "Eels", "Broncos", "Titans"))
    now = datetime.now(timezone.utc)
    m1 = _match(db, 2026, 1, 1, storm, eels, now + timedelta(days=1))
    m2 = _match(db, 2026, 1, 2, broncos, titans, now + timedelta(days=1))
    db.commit()
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_A, "match_id": m1.id, "pick": "home"})

    victim_id = _register(c, "victim2@example.com")
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})

    _register(c, "attacker2@example.com")
    c.post("/api/nrl/tips/submit", json={"device_id": DEVICE_B, "match_id": m2.id, "pick": "away"})
    c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B})  # attacker claims their own device

    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})  # attacker tries to grab victim's device
    assert r.status_code == 200
    assert r.json()["claimed_tips"] == 0

    db2 = TestingSession()
    device_player = db2.query(TipPlayer).filter_by(device_id=DEVICE_A).one_or_none()
    assert device_player is not None  # never deleted
    assert device_player.user_id == victim_id  # still the victim's
    tip = db2.query(UserTip).filter_by(player_id=device_player.id).one()
    assert tip.match_id == m1.id and tip.pick == "home"  # victim's tip untouched
    db2.close()


def test_claim_invalid_device_id_rejected(client):
    c, _ = client
    _register(c, "tipper5@example.com")
    r = c.post("/api/nrl/tips/claim", json={"device_id": "garbage"})
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "invalid_device_id"


def test_claim_requires_auth(client):
    c, _ = client
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 401
