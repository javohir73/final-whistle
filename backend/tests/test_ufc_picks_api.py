"""POST /api/ufc/picks/submit: lock enforced by the server clock, first pick final,
device-first identity with an optional account, the sign-in claim, never cached."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from unittest.mock import ANY

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api import ufc_picks
from app.api.ufc_picks import DISCLAIMER
from app.config import settings
from app.db import Base, get_db
from app.cache import cache
from app.main import app
from app.models import EmailActionAttempt, TipPlayer, UfcBout, UfcPick, UfcPrediction
from backend.tests.test_ufc_api import _bout, _event, _fighter

ALLOWED_ORIGIN = "http://localhost:3000"
DEVICE_A = "3fa85f64-5717-4562-b3fc-2c963f66afa6"
DEVICE_B = "4fa85f64-5717-4562-b3fc-2c963f66afa7"
LOCK = datetime(2027, 3, 6, 23, 0, tzinfo=timezone.utc)
NOW = LOCK - timedelta(hours=1)
SLUG = "pick-card"
VERSION = "ufc-form-v0.2"


@pytest.fixture
def client(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine, future=True)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    cache.clear()
    monkeypatch.setattr(ufc_picks, "_now", lambda: NOW)
    monkeypatch.setattr(settings, "ufc_public_model", "")
    yield TestClient(app, headers={"Origin": ALLOWED_ORIGIN}), Session
    cache.clear()
    app.dependency_overrides.clear()


def _seed_bout(db, ev, card_order=1, a="Israel Adesanya", b="Shara Magomedov", **kw):
    kw.setdefault("scheduled_utc", LOCK)
    kw.setdefault("status", "scheduled")
    return _bout(db, ev, _fighter(db, a), _fighter(db, b), card_order=card_order,
                 segment="main", segment_label="Main Card", **kw)


def _card(Session, n=1, event_status="scheduled", is_card=True, **kw):
    db = Session()
    ev = _event(db, SLUG, event_status, LOCK, LOCK, is_card=is_card)
    bouts = [_seed_bout(db, ev, i + 1, a=f"Fighter A{i}", b=f"Fighter B{i}", **kw) for i in range(n)]
    db.commit()
    ids = [b.id for b in bouts]
    db.close()
    return ids


def _submit(c, bout_id, winner="b", method="decision", device=DEVICE_A, **extra):
    return c.post("/api/ufc/picks/submit", json={
        "device_id": device, "bout_id": bout_id, "winner": winner, "method": method, **extra})


def _code(r):
    return r.status_code, r.json()["error"]["code"]


def _register(c, email):
    r = c.post("/api/auth/register", json={"email": email, "password": "supersecret1"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _stored(Session):
    db = Session()
    try:
        return db.query(UfcPick).order_by(UfcPick.id).all(), db.query(TipPlayer).all()
    finally:
        db.close()


def test_submit_open_bout_saves_and_returns_the_pick(client):
    c, Session = client
    (bid,) = _card(Session)
    r = _submit(c, bid)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["pick"] == {"winner": "b", "method": "decision", "created_at": ANY, "state": "pending",
                            "points": None, "winner_correct": None, "method_correct": None}
    assert body["model"] is None and body["handle"] and body["disclaimer"] == DISCLAIMER
    assert body["ok"] is True and body["bout_id"] == bid
    assert body["pick"]["created_at"].startswith("2027-03-06T22:00:00")
    picks, players = _stored(Session)
    assert [(p.bout_id, p.winner, p.method) for p in picks] == [(bid, "b", "decision")]
    assert players[0].device_id == DEVICE_A and players[0].handle == body["handle"]


def test_response_and_logs_carry_no_identity(client, caplog):
    c, Session = client
    (bid,) = _card(Session)
    with caplog.at_level(logging.DEBUG):
        r = _submit(c, bid)
    _, players = _stored(Session)
    text = r.text
    assert DEVICE_A not in text and "player_id" not in text and "device" not in text
    assert DEVICE_A not in caplog.text
    # An error answer is a fixed string too.
    bad = _submit(c, bid, "a", "ko_tko")
    assert DEVICE_A not in bad.text and bad.json()["error"]["message"] == "Your pick for this fight is already locked in."


def _predict(Session, bout_id, at, p_a=0.4, version=VERSION):
    db = Session()
    db.add(UfcPrediction(bout_id=bout_id, model_version=version, p_a=p_a, p_b=1 - p_a,
                         method_probs={"ko_tko": 0.2, "submission": 0.1, "decision": 0.7},
                         reasons=[], is_shadow=True, created_at=at))
    db.commit()
    db.close()


def test_submit_reveals_the_counting_call_to_the_picker(client, monkeypatch):
    c, Session = client
    picked, other = _card(Session, n=2)
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    _predict(Session, picked, LOCK - timedelta(hours=5))
    _predict(Session, other, LOCK - timedelta(hours=5), p_a=0.9)
    body = _submit(c, picked).json()
    assert body["model"]["winner"] == "b" and body["model"]["model_version"] == VERSION
    assert body["model"]["p_a"] == 0.4
    # Only this fight's call: nothing of the other fight's 0.9 is in the answer.
    assert "0.9" not in str(body)


def test_submit_reveals_nothing_without_a_counting_row(client, monkeypatch):
    c, Session = client
    (bid,) = _card(Session)
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    _predict(Session, bid, LOCK + timedelta(minutes=1))            # made after the lock: does not count
    _predict(Session, bid, LOCK - timedelta(hours=5), version="other-v1")
    assert _submit(c, bid).json()["model"] is None


def test_submit_at_or_after_lock_is_refused(client, monkeypatch):
    c, Session = client
    (bid,) = _card(Session)
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK)
    r = _submit(c, bid)
    assert _code(r) == (422, "fight_locked")
    assert r.json()["error"]["message"] == "Picks for this fight have closed."
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK + timedelta(seconds=1))
    assert _code(_submit(c, bid)) == (422, "fight_locked")
    assert _stored(Session)[0] == []
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK - timedelta(seconds=1))
    assert _submit(c, bid).status_code == 200


def test_a_client_supplied_time_is_ignored(client, monkeypatch):
    c, Session = client
    (bid,) = _card(Session)
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK)
    r = _submit(c, bid, submitted_at=(LOCK - timedelta(hours=1)).isoformat(),
                created_at=(LOCK - timedelta(hours=1)).isoformat(), now=(LOCK - timedelta(hours=1)).isoformat())
    assert _code(r) == (422, "fight_locked")
    assert _stored(Session)[0] == []


def test_the_lock_is_checked_again_at_write_time(client, monkeypatch):
    """The clock can pass the lock while the player row is resolved: the check
    runs once more, right before the insert, on a fresh reading."""
    c, Session = client
    (bid,) = _card(Session)
    readings = iter([LOCK - timedelta(seconds=1), LOCK])
    monkeypatch.setattr(ufc_picks, "_now", lambda: next(readings, LOCK))
    assert _code(_submit(c, bid)) == (422, "fight_locked")
    assert _stored(Session)[0] == []


def test_the_stored_time_is_the_server_clock(client):
    c, Session = client
    (bid,) = _card(Session)
    _submit(c, bid)
    assert ufc_picks.utc(_stored(Session)[0][0].created_at) == NOW


@pytest.mark.parametrize("state,code", [
    ("live", "fight_locked"), ("finished", "fight_locked"), ("feed_live_early", "fight_locked"),
    ("no_time", "fight_locked"), ("cancelled", "fight_cancelled"), ("event_cancelled", "fight_cancelled"),
    ("changed", "fight_changed"), ("tba", "opponent_tba"), ("opponent_tba", "opponent_tba")])
def test_submit_refused_for_every_closed_state(client, state, code):
    c, Session = client
    db = Session()
    ev = _event(db, SLUG, "cancelled" if state == "event_cancelled" else "scheduled", LOCK, LOCK)
    kw = {
        "live": {"status": "live"},
        "finished": {"status": "finished", "winner": "a", "method": "decision"},
        "feed_live_early": {"winner": "a"},
        "no_time": {"scheduled_utc": None},
        "cancelled": {"status": "cancelled"},
        "changed": {"status": "changed"},
    }.get(state, {})
    name_b = {"tba": "TBA", "opponent_tba": "Opponent TBA"}.get(state, "Shara Magomedov")
    bout = _seed_bout(db, ev, b=name_b, **kw)
    db.commit()
    bid = bout.id
    db.close()
    r = _submit(c, bid)
    assert _code(r) == (422, code)
    assert _stored(Session)[0] == []


@pytest.mark.parametrize("kind", ["missing", "contender_series"])
def test_unknown_or_non_card_bout_is_404(client, kind):
    c, Session = client
    if kind == "missing":
        _card(Session)
        bid = 99999
    else:
        (bid,) = _card(Session, is_card=False)
    r = _submit(c, bid)
    assert _code(r) == (404, "bout_not_found")
    assert r.json()["error"]["message"] == "No UFC fight with that id"
    assert _stored(Session)[0] == []


def test_second_pick_is_refused_and_the_first_stays(client):
    c, Session = client
    (bid,) = _card(Session)
    _submit(c, bid, "b", "decision")
    r = _submit(c, bid, "a", "ko_tko")
    assert _code(r) == (409, "pick_finalized")
    assert r.json()["error"]["message"] == "Your pick for this fight is already locked in."
    (p,) = _stored(Session)[0]
    assert (p.winner, p.method) == ("b", "decision")


def test_concurrent_first_pick_keeps_the_first(client, monkeypatch):
    c, Session = client
    (bid,) = _card(Session)
    assert _submit(c, bid, "b", "decision").status_code == 200
    monkeypatch.setattr(ufc_picks, "_find_pick", lambda db, bout_id, player_id: None)
    r = _submit(c, bid, "a", "submission")
    assert _code(r) == (409, "pick_finalized")
    (p,) = _stored(Session)[0]
    assert (p.winner, p.method) == ("b", "decision")
    # The session is usable afterwards: a different bout still works.
    monkeypatch.undo()


@pytest.mark.parametrize("winner,method", [("c", "decision"), ("", "decision"), ("a", None), ("a", "dq"),
                                           ("a", "draw"), ("a", "no_contest"), ("a", "other"), ("a", "KO")])
def test_bad_pick_rejected(client, winner, method):
    c, Session = client
    (bid,) = _card(Session)
    r = _submit(c, bid, winner, method)
    assert _code(r) == (422, "bad_pick")
    assert r.json()["error"]["message"] == "Pick a winner and how they win: KO/TKO, submission or decision."
    assert _stored(Session)[0] == []


def test_a_missing_method_key_is_rejected(client):
    c, Session = client
    (bid,) = _card(Session)
    r = c.post("/api/ufc/picks/submit", json={"device_id": DEVICE_A, "bout_id": bid, "winner": "a"})
    assert _code(r) == (422, "bad_pick")


def test_invalid_device_id_rejected(client):
    c, Session = client
    (bid,) = _card(Session)
    r = _submit(c, bid, device="not-a-uuid")
    assert _code(r) == (422, "invalid_device_id")
    assert r.json()["error"]["message"] == "device_id must be a UUID v4."
    assert _stored(Session)[0] == []


def test_submit_is_rate_limited(client, monkeypatch):
    c, Session = client
    (bid,) = _card(Session)
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK)
    for _ in range(120):
        assert _code(_submit(c, bid)) == (422, "fight_locked")
    r = _submit(c, bid)
    assert _code(r) == (429, "too_many_attempts")
    assert r.json()["error"]["message"] == "Too many attempts. Try again later."
    db = Session()
    assert db.query(EmailActionAttempt).filter_by(action="ufc_pick_submit").count() == 120
    db.close()


def test_submit_requires_the_site_origin(client):
    _, Session = client
    (bid,) = _card(Session)
    r = TestClient(app).post("/api/ufc/picks/submit", json={
        "device_id": DEVICE_A, "bout_id": bid, "winner": "a", "method": "decision"})
    assert _code(r) == (403, "forbidden_origin")
    assert _stored(Session)[0] == []


def test_signed_in_second_device_writes_to_the_accounts_player(client):
    c, Session = client
    b1, b2, b3 = _card(Session, n=3)
    anon = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    assert _submit(c, b1, "a", "ko_tko", DEVICE_A).status_code == 200       # phone, anonymous
    assert _submit(anon, b2, "b", "decision", DEVICE_B).status_code == 200  # laptop, anonymous
    user_id = _register(c, "ufc-two-devices@example.com")
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A}).status_code == 200
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_B}).status_code == 200   # merged, B deleted

    db = Session()
    account = db.query(TipPlayer).filter_by(user_id=user_id).one()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None
    assert {(p.bout_id, p.player_id) for p in db.query(UfcPick).all()} == {(b1, account.id), (b2, account.id)}
    db.close()

    again = _submit(c, b1, "b", "decision", DEVICE_B)                      # the phone's pick is final everywhere
    assert _code(again) == (409, "pick_finalized")
    assert _submit(c, b3, "a", "submission", DEVICE_B).status_code == 200  # lands on the account's player
    db = Session()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_B).one_or_none() is None
    assert db.query(UfcPick).filter_by(bout_id=b3).one().player_id == account.id
    db.close()


def test_claim_moves_ufc_picks_to_the_account(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    _submit(c, b1, "a", "ko_tko")
    _submit(c, b2, "b", "submission")
    user_id = _register(c, "ufc-claim@example.com")
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A}).status_code == 200
    db = Session()
    account = db.query(TipPlayer).filter_by(user_id=user_id).one()
    assert {(p.bout_id, p.player_id) for p in db.query(UfcPick).all()} == {(b1, account.id), (b2, account.id)}
    db.close()


def test_claim_merge_keeps_the_accounts_pick_and_drops_the_device_duplicate(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    anon = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    assert _submit(anon, b1, "b", "decision", DEVICE_A).status_code == 200   # the device
    assert _submit(anon, b2, "a", "submission", DEVICE_A).status_code == 200
    user_id = _register(c, "ufc-merge@example.com")
    assert _submit(c, b1, "a", "ko_tko", DEVICE_B).status_code == 200        # the account's own pick
    r = c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A})
    assert r.status_code == 200, r.text
    assert r.json()["claimed_tips"] == 0                                      # UFC picks are not counted

    db = Session()
    account = db.query(TipPlayer).filter_by(user_id=user_id).one()
    assert db.query(TipPlayer).filter_by(device_id=DEVICE_A).one_or_none() is None
    picks = {p.bout_id: p for p in db.query(UfcPick).all()}
    assert len(picks) == 2 and all(p.player_id == account.id for p in picks.values())
    assert (picks[b1].winner, picks[b1].method) == ("a", "ko_tko")
    assert (picks[b2].winner, picks[b2].method) == ("a", "submission")
    db.close()


def test_delete_account_keeps_ufc_picks_under_the_generated_handle(client):
    c, Session = client
    (bid,) = _card(Session)
    _register(c, "ufc-delete@example.com")
    handle = _submit(c, bid).json()["handle"]
    r = c.post("/api/auth/delete-account", json={"password": "supersecret1"})
    assert r.status_code == 200, r.text
    picks, players = _stored(Session)
    assert len(picks) == 1 and [p.handle for p in players] == [handle]


def test_submit_is_never_cached(client):
    c, Session = client
    (bid,) = _card(Session)
    assert _submit(c, bid).headers["cache-control"] == "no-store"
    assert _submit(c, bid, "a", "ko_tko").headers["cache-control"] == "no-store"   # 409
    assert _submit(c, bid, "z").headers["cache-control"] == "no-store"             # 422


def test_public_ufc_endpoints_keep_their_public_caching(client):
    c, Session = client
    (bid,) = _card(Session)
    for path in (f"/api/ufc/events/{SLUG}", f"/api/ufc/bouts/{bid}"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert r.headers["cache-control"].startswith("public, max-age=60"), path
