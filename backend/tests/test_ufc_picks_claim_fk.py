"""The sign-in claim with UFC picks, under ENFORCED foreign keys (as Postgres
does). SQLite ignores foreign keys by default, which hid a delete-ordering bug:
`UfcPick` has no relationship() to `TipPlayer`, so the unit of work does not
order a duplicate pick's DELETE before the `tip_players` DELETE."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import (
    LeagueScorePrediction, Match, SportMatch, SportTeam, Team, TipPlayer, Tournament, UfcPick, UserTip,
)
from backend.tests.test_ufc_api import _bout, _event, _fighter

ORIGIN = "http://localhost:3000"
DEVICE_A = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
DEVICE_B = "4fa85f64-5717-4562-b3fc-2c963f66afa7"
LOCK = datetime(2027, 3, 6, 23, 0, tzinfo=timezone.utc)


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)

    @event.listens_for(engine, "connect")
    def _fk_on(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    db = Session()
    assert db.connection().exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
    db.close()
    yield TestClient(app, headers={"Origin": ORIGIN}), Session
    app.dependency_overrides.clear()


def _bouts(Session, n):
    db = Session()
    ev = _event(db, "fk-card", "scheduled", LOCK, LOCK)
    ids = [
        _bout(db, ev, _fighter(db, f"Fighter A{i}"), _fighter(db, f"Fighter B{i}"), card_order=i + 1,
              segment="main", segment_label="Main Card", scheduled_utc=LOCK, status="scheduled").id
        for i in range(n)
    ]
    db.commit()
    db.close()
    return ids


def _player(Session, device_id, user_id=None, handle=None):
    db = Session()
    p = TipPlayer(device_id=device_id, handle=handle or f"Player-{device_id[:4]}", user_id=user_id)
    db.add(p)
    db.commit()
    pid = p.id
    db.close()
    return pid


def _pick(Session, bout_id, player_id, winner, method="decision"):
    db = Session()
    db.add(UfcPick(bout_id=bout_id, player_id=player_id, winner=winner, method=method))
    db.commit()
    db.close()


def _register(c, email):
    r = c.post("/api/auth/register", json={"email": email, "password": "supersecret1"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _claim(c, device):
    return c.post("/api/nrl/tips/claim", json={"device_id": device})


def _picks(Session):
    db = Session()
    try:
        return {p.bout_id: (p.player_id, p.winner) for p in db.query(UfcPick).all()}
    finally:
        db.close()


def _account_with_own_player(c, Session, email, handle="Account"):
    uid = _register(c, email)
    return uid, _player(Session, "account:own-device-key", user_id=uid, handle=handle)


def test_conflicting_pick_keeps_the_accounts_and_drops_the_devices(env):
    c, Session = env
    b1, b2 = _bouts(Session, 2)
    uid, account = _account_with_own_player(c, Session, "fk-merge@example.com")
    device = _player(Session, DEVICE_A)
    _pick(Session, b1, account, "a", "ko_tko")
    _pick(Session, b1, device, "b", "decision")      # same fight, other pick
    _pick(Session, b2, device, "a", "submission")
    r = _claim(c, DEVICE_A)
    assert r.status_code == 200, r.text
    assert _picks(Session) == {b1: (account, "a"), b2: (account, "a")}
    db = Session()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_A).one_or_none() is None
    db.close()


def test_device_only_picks_move_to_the_account(env):
    c, Session = env
    b1, b2 = _bouts(Session, 2)
    uid, account = _account_with_own_player(c, Session, "fk-move@example.com")
    device = _player(Session, DEVICE_A)
    _pick(Session, b1, device, "a")
    _pick(Session, b2, device, "b")
    assert _claim(c, DEVICE_A).status_code == 200
    assert _picks(Session) == {b1: (account, "a"), b2: (account, "b")}
    db = Session()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_A).one_or_none() is None
    db.close()


def test_whole_claim_succeeds_with_ufc_football_and_nrl_rows_and_one_ufc_conflict(env):
    c, Session = env
    b1, b2 = _bouts(Session, 2)
    uid, account = _account_with_own_player(c, Session, "fk-all@example.com")
    device = _player(Session, DEVICE_A)
    db = Session()
    t = Tournament(name="Premier League 2026-27", year=2026, home_advantage_mode="home")
    home, away = Team(name="Home FC"), Team(name="Away FC")
    nh, na = SportTeam(sport="nrl", name="Home RLFC"), SportTeam(sport="nrl", name="Away RLFC")
    db.add_all([t, home, away, nh, na])
    db.flush()
    kick = datetime(2027, 3, 6, 12, 0, tzinfo=timezone.utc)
    fm = Match(tournament_id=t.id, team_home_id=home.id, team_away_id=away.id, stage="group",
               matchweek=1, kickoff_utc=kick, status="scheduled")
    nm = SportMatch(sport="nrl", season=2027, round=1, match_no=1, kickoff_utc=kick,
                    home_team_id=nh.id, away_team_id=na.id, status="scheduled")
    db.add_all([fm, nm])
    db.flush()
    db.add(LeagueScorePrediction(tournament_id=t.id, match_id=fm.id, player_id=device,
                                 predicted_home=1, predicted_away=0, updated_at=kick))
    db.add(UserTip(match_id=nm.id, player_id=device, pick="home", updated_at=kick))
    db.commit()
    nm_id, fm_id = nm.id, fm.id
    db.close()
    _pick(Session, b1, account, "a", "ko_tko")
    _pick(Session, b1, device, "b", "decision")
    _pick(Session, b2, device, "a", "submission")

    r = _claim(c, DEVICE_A)
    assert r.status_code == 200, r.text
    assert r.json()["claimed_tips"] == 1
    assert _picks(Session) == {b1: (account, "a"), b2: (account, "a")}
    db = Session()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_A).one_or_none() is None
    assert db.query(UserTip).filter_by(match_id=nm_id).one().player_id == account
    assert db.query(LeagueScorePrediction).filter_by(match_id=fm_id).one().player_id == account
    db.close()
    assert _claim(c, DEVICE_A).status_code == 200      # later sign-ins stay fine


def test_delete_account_keeps_ufc_picks_with_foreign_keys_enforced(env, monkeypatch):
    from app.api import ufc_picks
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK - timedelta(hours=1))
    c, Session = env
    (b1,) = _bouts(Session, 1)
    _register(c, "fk-delete@example.com")
    r = c.post("/api/ufc/picks/submit", json={"device_id": DEVICE_B, "bout_id": b1,
                                              "winner": "a", "method": "ko_tko"})
    assert r.status_code == 200, r.text
    handle = r.json()["handle"]
    assert c.post("/api/auth/delete-account", json={"password": "supersecret1"}).status_code == 200
    db = Session()
    assert db.query(UfcPick).count() == 1
    assert [p.handle for p in db.query(TipPlayer).all()] == [handle]
    db.close()
