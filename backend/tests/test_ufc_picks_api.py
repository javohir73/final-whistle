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


# ---- GET /api/ufc/picks/mine and /summary -------------------------------------------------

from sqlalchemy import event as sa_event  # noqa: E402


def _mine(c, device=DEVICE_A, slug=SLUG, **kw):
    r = c.get("/api/ufc/picks/mine", params={"device_id": device, "event": slug, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _mb(body, bout_id):
    return next(b for b in body["bouts"] if b["bout_id"] == bout_id)


def _summary(c, device=DEVICE_A):
    r = c.get("/api/ufc/picks/summary", params={"device_id": device})
    assert r.status_code == 200, r.text
    return r.json()


def _stored_pick(Session, bout_id, device=DEVICE_A, winner="a", method="decision", **kw):
    """A pick row written straight to the database (states the endpoint would refuse)."""
    db = Session()
    player = db.query(TipPlayer).filter_by(device_id=device).one_or_none()
    if player is None:
        player = TipPlayer(device_id=device, handle=f"Tester {device[:4]}")
        db.add(player)
        db.flush()
    db.add(UfcPick(bout_id=bout_id, player_id=player.id, winner=winner, method=method,
                   created_at=NOW - timedelta(hours=3), updated_at=NOW - timedelta(hours=3), **kw))
    db.commit()
    db.close()


def _set(Session, bout_id, **kw):
    db = Session()
    db.query(UfcBout).filter_by(id=bout_id).update(kw)
    db.commit()
    db.close()


def _call_rows(Session, bout_id, p_a, reason):
    db = Session()
    db.add(UfcPrediction(bout_id=bout_id, model_version=VERSION, p_a=p_a, p_b=1 - p_a,
                         method_probs={"ko_tko": 0.2, "submission": 0.1, "decision": 0.7},
                         reasons=[reason], is_shadow=True, created_at=LOCK - timedelta(days=2)))
    db.commit()
    db.close()


def test_mine_without_a_player_lists_the_card_with_no_picks(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    body = _mine(c, DEVICE_B)
    assert body["handle"] is None and body["changed_picks"] == []
    assert body["totals"] == {"picked": 0, "graded": 0, "points": 0, "winner_method": 0}
    assert body["event"] == {"slug": SLUG, "name": SLUG, "first_bout_utc": ANY}
    assert [b["bout_id"] for b in body["bouts"]] == [b1, b2]
    assert all(b["pick"] is None and b["picks_open"] is True and b["model"] is None for b in body["bouts"])
    assert body["disclaimer"] == DISCLAIMER
    _, players = _stored(Session)
    assert players == []                                   # a read creates no player


def test_mine_hides_the_call_on_an_open_bout_until_this_player_picks(client, monkeypatch):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    _call_rows(Session, b1, 0.4, "Reason one")
    _call_rows(Session, b2, 0.8, "Reason two")
    assert _submit(c, b1, "a", "ko_tko", DEVICE_A).status_code == 200
    a, b = _mine(c, DEVICE_A), _mine(c, DEVICE_B)
    assert _mb(a, b1)["model"]["winner"] == "b" and _mb(a, b2)["model"] is None
    assert _mb(a, b1)["pick"]["winner"] == "a" and _mb(a, b2)["pick"] is None
    assert _mb(b, b1)["model"] is None and _mb(b, b1)["pick"] is None          # never A's pick
    assert _mb(b, b2)["model"] is None


def test_mine_shows_the_call_on_locked_bouts_to_everyone(client, monkeypatch):
    c, Session = client
    (b1,) = _card(Session, scheduled_utc=NOW - timedelta(hours=1))
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    _call_rows(Session, b1, 0.3, "Reason locked")
    for dev in (DEVICE_A, DEVICE_B):
        row = _mb(_mine(c, dev), b1)
        assert row["model"]["winner"] == "b" and row["picks_open"] is False and row["pick"] is None


def test_mine_reveal_is_decided_fight_by_fight_with_nothing_derived(client, monkeypatch):
    c, Session = client
    picked, open_un, locked_un, cancelled = _card(Session, n=4)
    _set(Session, locked_un, scheduled_utc=NOW - timedelta(hours=1))
    _set(Session, cancelled, status="cancelled")
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    probs = {picked: 0.6111, open_un: 0.7222, locked_un: 0.8333, cancelled: 0.9444}
    for bid, p in probs.items():
        _call_rows(Session, bid, p, f"REASON-{bid}-TEXT")
    assert _submit(c, picked, "a", "decision", DEVICE_A).status_code == 200
    _stored_pick(Session, cancelled, DEVICE_A, "b", "ko_tko")
    assert _submit(c, open_un, "a", "decision", DEVICE_B).status_code == 200       # B picks the other one

    ra = c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": SLUG})
    a = ra.json()
    assert _mb(a, picked)["model"]["p_a"] == 0.6111
    assert _mb(a, open_un)["model"] is None and "model" in _mb(a, open_un)          # present, null
    assert _mb(a, locked_un)["model"]["p_a"] == 0.8333
    assert _mb(a, cancelled)["model"] is None
    assert _mb(a, cancelled)["pick"]["state"] == "void"
    for secret in ("0.7222", "REASON-%d-TEXT" % open_un, "0.9444", "REASON-%d-TEXT" % cancelled):
        assert secret not in ra.text
    assert set(a) == {"event", "handle", "bouts", "changed_picks", "totals", "disclaimer"}

    rb = c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_B, "event": SLUG})
    b = rb.json()
    assert _mb(b, picked)["model"] is None and _mb(b, picked)["pick"] is None
    assert _mb(b, open_un)["model"]["p_a"] == 0.7222 and _mb(b, open_un)["pick"]["winner"] == "a"
    assert _mb(b, locked_un)["model"]["p_a"] == 0.8333
    assert _mb(b, cancelled)["model"] is None and _mb(b, cancelled)["pick"] is None
    for secret in ("0.6111", "REASON-%d-TEXT" % picked, "0.9444", "REASON-%d-TEXT" % cancelled):
        assert secret not in rb.text


def test_mine_never_carries_a_call_for_a_placeholder_or_changed_fight(client, monkeypatch):
    c, Session = client
    tba, changed, ok = _card(Session, n=3)
    from app.models import UfcFighter
    db = Session()
    fid = db.get(UfcBout, tba).fighter_b_id
    db.query(UfcFighter).filter_by(id=fid).update({"name": "TBA"})
    db.commit()
    db.close()
    _set(Session, changed, status="changed")
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    for bid in (tba, changed, ok):
        _call_rows(Session, bid, 0.55, f"REASON-{bid}-TEXT")
    _stored_pick(Session, tba)
    _stored_pick(Session, changed)
    r = c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": SLUG})
    body = r.json()
    assert _mb(body, tba)["model"] is None and _mb(body, tba)["picks_open"] is False
    assert changed not in [b["bout_id"] for b in body["bouts"]]
    assert f"REASON-{tba}-TEXT" not in r.text and f"REASON-{changed}-TEXT" not in r.text
    assert _mb(body, ok)["model"] is None


def test_mine_exposes_nothing_about_other_players(client, monkeypatch):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    _set(Session, b2, scheduled_utc=NOW - timedelta(hours=1))
    for dev in (DEVICE_B, "5fa85f64-5717-4562-b3fc-2c963f66afa8"):
        _stored_pick(Session, b1, dev, "a", "ko_tko")
        _stored_pick(Session, b2, dev, "a", "ko_tko")
    for body in (_mine(c, DEVICE_A), _mine(c)):
        assert all(b["pick"] is None for b in body["bouts"])
        assert set(_mb(body, b1)) == {"bout_id", "status", "fighter_a", "fighter_b", "locks_at",
                                      "picks_open", "pick", "model"}


def test_mine_marks_void_and_graded_picks(client):
    c, Session = client
    cancelled, draw, graded, pending = _card(Session, n=4)
    _set(Session, cancelled, status="cancelled")
    _set(Session, draw, status="finished", winner=None, method="draw", scheduled_utc=NOW - timedelta(hours=2))
    _set(Session, graded, status="finished", winner="a", method="decision", scheduled_utc=NOW - timedelta(hours=2))
    gt = NOW - timedelta(minutes=5)
    _stored_pick(Session, cancelled)
    _stored_pick(Session, draw, graded_at=gt)
    _stored_pick(Session, graded, DEVICE_A, "a", "decision", points=5, winner_correct=True, method_correct=True, graded_at=gt)
    body = _mine(c)
    assert _mb(body, cancelled)["pick"]["state"] == "void" and _mb(body, cancelled)["pick"]["points"] is None
    assert _mb(body, draw)["pick"]["state"] == "void"
    g = _mb(body, graded)["pick"]
    assert (g["state"], g["points"], g["winner_correct"], g["method_correct"]) == ("graded", 5, True, True)
    assert _mb(body, pending)["pick"] is None
    assert body["totals"] == {"picked": 3, "graded": 1, "points": 5, "winner_method": 1}


def test_mine_lists_a_pick_on_a_changed_bout_with_its_current_replacement(client):
    c, Session = client
    b1, b2, b3 = _card(Session, n=3)
    _set(Session, b1, status="changed", replaced_by_id=b2)
    _set(Session, b2, status="changed", replaced_by_id=b3)
    _stored_pick(Session, b1, DEVICE_A, "a", "ko_tko")
    body = _mine(c)
    assert [b["bout_id"] for b in body["bouts"]] == [b3]
    assert _mb(body, b3)["pick"] is None and _mb(body, b3)["picks_open"] is True
    (ch,) = body["changed_picks"]
    assert ch == {"bout_id": b1, "fighter_a": "Fighter A0", "fighter_b": "Fighter B0",
                  "pick": {"winner": "a", "method": "ko_tko", "created_at": ANY, "state": "void",
                           "points": None, "winner_correct": None, "method_correct": None},
                  "replaced_by_id": b3}
    assert body["totals"]["picked"] == 1 and body["totals"]["graded"] == 0


def test_mine_changed_chain_stops_at_a_missing_link_and_after_five_hops(client):
    c, Session = client
    ids = _card(Session, n=8)
    for i in range(7):
        _set(Session, ids[i], status="changed", replaced_by_id=ids[i + 1])
    _stored_pick(Session, ids[0])
    _stored_pick(Session, ids[6])
    db = Session()
    db.execute(UfcBout.__table__.update().where(UfcBout.id == ids[6]).values(replaced_by_id=None))
    db.commit()
    db.close()
    by = {ch["bout_id"]: ch["replaced_by_id"] for ch in _mine(c)["changed_picks"]}
    assert by[ids[0]] == ids[5]            # five hops from the first row, then stop
    assert by[ids[6]] is None              # a changed row with no successor


def test_mine_reports_the_server_lock(client):
    c, Session = client
    ok, placeholder, past = _card(Session, n=3)
    _set(Session, past, scheduled_utc=NOW - timedelta(minutes=1))
    db = Session()
    from app.models import UfcFighter
    fid = db.get(UfcBout, placeholder).fighter_b_id
    db.query(UfcFighter).filter_by(id=fid).update({"name": "Opponent TBA"})
    db.commit()
    db.close()
    body = _mine(c)
    assert _mb(body, ok)["picks_open"] is True and _mb(body, ok)["locks_at"].startswith("2027-03-06T23:00:00")
    assert _mb(body, placeholder)["picks_open"] is False
    assert _mb(body, past)["picks_open"] is False and _mb(body, past)["locks_at"].startswith("2027-03-06T21:59:00")
    assert _mb(body, ok)["fighter_a"] == "Fighter A0" and _mb(body, ok)["status"] == "scheduled"


def test_mine_orders_by_lock_time_then_card_order(client):
    c, Session = client
    b1, b2, b3, b4 = _card(Session, n=4)
    _set(Session, b1, scheduled_utc=LOCK + timedelta(hours=2))
    _set(Session, b2, scheduled_utc=None)
    _set(Session, b3, scheduled_utc=LOCK)
    _set(Session, b4, scheduled_utc=LOCK)
    assert [b["bout_id"] for b in _mine(c)["bouts"]] == [b3, b4, b1, b2]


@pytest.mark.parametrize("slug", ["no-such-card", "Bad Slug!", "x" * 300, ""])
def test_mine_unknown_or_malformed_card_is_404(client, slug):
    c, Session = client
    _card(Session)
    r = c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": slug})
    assert _code(r) == (404, "not_found") and r.json()["error"]["message"] == "No UFC card with that name"


def test_mine_non_card_event_is_404(client):
    c, Session = client
    _card(Session, is_card=False)
    r = c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": SLUG})
    assert _code(r) == (404, "not_found")


def test_mine_and_summary_validate_the_device(client):
    c, Session = client
    _card(Session)
    for bad in ("not-a-uuid", "", "3fa85f64-5717-4562-b3fc-2c963f66afa6x"):
        r = c.get("/api/ufc/picks/mine", params={"device_id": bad, "event": SLUG})
        assert _code(r) == (422, "invalid_device_id")
        r = c.get("/api/ufc/picks/summary", params={"device_id": bad})
        assert _code(r) == (422, "invalid_device_id")
    assert _code(c.get("/api/ufc/picks/summary")) == (422, "invalid_device_id")


def test_summary_zero_state(client):
    c, Session = client
    body = _summary(c, DEVICE_B)
    assert body == {"handle": None, "cards": [], "totals": {"picked": 0, "graded": 0, "points": 0, "winner_method": 0}}
    _, players = _stored(Session)
    assert players == []


def test_summary_totals_per_card_newest_first(client):
    c, Session = client
    db = Session()
    old = _event(db, "old-card", "completed", LOCK - timedelta(days=60), LOCK - timedelta(days=60), is_card=True)
    new = _event(db, "new-card", "scheduled", LOCK + timedelta(days=30), LOCK + timedelta(days=30), is_card=True)
    nopick = _event(db, "quiet-card", "scheduled", LOCK + timedelta(days=90), LOCK + timedelta(days=90), is_card=True)
    dwcs = _event(db, "dwcs", "completed", LOCK - timedelta(days=90), LOCK - timedelta(days=90), is_card=False)
    ob = [_seed_bout(db, old, i + 1, a=f"Old A{i}", b=f"Old B{i}", status="finished",
                     scheduled_utc=LOCK - timedelta(days=60)) for i in range(3)]
    nb = [_seed_bout(db, new, i + 1, a=f"New A{i}", b=f"New B{i}") for i in range(2)]
    _seed_bout(db, nopick, 1, a="Quiet A", b="Quiet B")
    xb = _seed_bout(db, dwcs, 1, a="Series A", b="Series B")
    ob[0].winner, ob[0].method = "a", "decision"
    ob[1].winner, ob[1].method = "b", "ko_tko"
    ob[2].winner, ob[2].method = None, "draw"
    db.commit()
    ids = ([b.id for b in ob], [b.id for b in nb], xb.id)
    db.close()
    gt = NOW - timedelta(days=50)
    _stored_pick(Session, ids[0][0], DEVICE_A, "a", "decision", points=5, winner_correct=True, method_correct=True, graded_at=gt)
    _stored_pick(Session, ids[0][1], DEVICE_A, "b", "decision", points=2, winner_correct=True, method_correct=False, graded_at=gt)
    _stored_pick(Session, ids[0][2], DEVICE_A, "a", "decision", graded_at=gt)           # void
    _stored_pick(Session, ids[1][0], DEVICE_A, "a", "ko_tko")
    _stored_pick(Session, ids[2], DEVICE_A, "a", "ko_tko")                              # not a card
    _stored_pick(Session, ids[1][1], DEVICE_B, "a", "ko_tko")                           # someone else
    body = _summary(c, DEVICE_A)
    assert [c_["slug"] for c_ in body["cards"]] == ["new-card", "old-card"]
    assert body["cards"][0] == {"slug": "new-card", "name": "new-card", "first_bout_utc": ANY,
                                "picked": 1, "graded": 0, "points": 0, "winner_method": 0}
    assert body["cards"][1]["picked"] == 3 and body["cards"][1]["graded"] == 2
    assert body["cards"][1]["points"] == 7 and body["cards"][1]["winner_method"] == 1
    assert body["totals"] == {"picked": 4, "graded": 2, "points": 7, "winner_method": 1}
    assert body["handle"]
    assert _summary(c, DEVICE_B)["totals"]["picked"] == 1


def test_summary_includes_a_card_whose_only_pick_is_on_a_changed_fight(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    _set(Session, b1, status="changed", replaced_by_id=b2)
    _stored_pick(Session, b1)
    body = _summary(c)
    assert [(x["slug"], x["picked"], x["graded"]) for x in body["cards"]] == [(SLUG, 1, 0)]


def test_signed_in_mine_reads_the_accounts_picks_from_a_second_device(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    anon = TestClient(app, headers={"Origin": ALLOWED_ORIGIN})
    assert _submit(anon, b1, "a", "ko_tko", DEVICE_A).status_code == 200
    _register(c, "ufc-mine@example.com")
    assert c.post("/api/nrl/tips/claim", json={"device_id": DEVICE_A}).status_code == 200
    body = _mine(c, DEVICE_B)                                   # a device the account never used
    assert _mb(body, b1)["pick"]["winner"] == "a" and _mb(body, b2)["pick"] is None
    assert _summary(c, DEVICE_B)["totals"]["picked"] == 1
    assert _mine(anon, DEVICE_B)["totals"]["picked"] == 0       # signed out: only this device's own row


def test_mine_and_summary_are_never_cached(client):
    c, Session = client
    _card(Session)
    for r in (c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": SLUG}),
              c.get("/api/ufc/picks/mine", params={"device_id": DEVICE_A, "event": "nope"}),
              c.get("/api/ufc/picks/mine", params={"device_id": "bad", "event": SLUG}),
              c.get("/api/ufc/picks/summary", params={"device_id": DEVICE_A}),
              c.get("/api/ufc/picks/summary", params={"device_id": "bad"})):
        assert r.headers["cache-control"] == "no-store"


def test_mine_and_summary_with_the_production_state_are_complete(client):
    c, Session = client
    b1, b2 = _card(Session, n=2)
    _submit(c, b1)
    body = _mine(c)                                             # no public model, no finished fights
    assert all(b["model"] is None for b in body["bouts"])
    assert _mb(body, b1)["pick"]["state"] == "pending"
    assert body["totals"] == {"picked": 1, "graded": 0, "points": 0, "winner_method": 0}
    assert _summary(c)["cards"][0]["picked"] == 1


def _count(engine, fn):
    n = [0]

    def listener(*a, **k):
        n[0] += 1

    sa_event.listen(engine, "before_cursor_execute", listener)
    try:
        fn()
    finally:
        sa_event.remove(engine, "before_cursor_execute", listener)
    return n[0]


def test_mine_and_summary_query_counts_do_not_grow(client, monkeypatch):
    c, Session = client
    engine = Session.kw["bind"]
    monkeypatch.setattr(settings, "ufc_public_model", VERSION)
    ids = _card(Session, n=2)
    _set(Session, ids[1], status="changed", replaced_by_id=ids[0])
    for bid in ids:
        _call_rows(Session, bid, 0.4, "r")
    _submit(c, ids[0])
    _stored_pick(Session, ids[1])
    mine = lambda: _mine(c)                                     # noqa: E731
    summary = lambda: _summary(c)                               # noqa: E731
    small_m, small_s = _count(engine, mine), _count(engine, summary)

    db = Session()
    for k in range(2):
        ev = _event(db, f"extra-{k}", "scheduled", LOCK, LOCK, is_card=True)
        for i in range(6):
            _seed_bout(db, ev, i + 1, a=f"Ex{k} A{i}", b=f"Ex{k} B{i}")
    ev = db.query(UfcBout).filter_by(id=ids[0]).one().event_id
    for i in range(10):
        extra = _seed_bout(db, db.get(__import__("app.models", fromlist=["UfcEvent"]).UfcEvent, ev), 10 + i,
                           a=f"Big A{i}", b=f"Big B{i}")
        db.flush()
        db.add(UfcPick(bout_id=extra.id, player_id=db.query(TipPlayer).filter_by(device_id=DEVICE_A).one().id,
                       winner="a", method="decision", created_at=NOW, updated_at=NOW))
        db.add(UfcPrediction(bout_id=extra.id, model_version=VERSION, p_a=0.4, p_b=0.6, method_probs=None,
                             reasons=[], is_shadow=True, created_at=LOCK - timedelta(days=2)))
    db.commit()
    db.close()
    big_m, big_s = _count(engine, mine), _count(engine, summary)
    assert big_m == small_m and big_m <= 10
    assert big_s == small_s and big_s <= 5


def test_a_graded_pick_with_no_points_is_void_even_on_a_finished_fight(client):
    c, Session = client
    late, normal = _card(Session, n=2)
    for bid in (late, normal):
        _set(Session, bid, status="finished", winner="a", method="decision", scheduled_utc=NOW - timedelta(hours=2))
    gt = NOW - timedelta(minutes=5)
    _stored_pick(Session, late, DEVICE_A, "a", "decision", graded_at=gt)            # voided as made after the lock
    _stored_pick(Session, normal, DEVICE_A, "b", "decision", points=0, winner_correct=False,
                 method_correct=False, graded_at=gt)
    body = _mine(c)
    v = _mb(body, late)["pick"]
    assert (v["state"], v["points"], v["winner_correct"], v["method_correct"]) == ("void", None, None, None)
    assert _mb(body, normal)["pick"]["state"] == "graded" and _mb(body, normal)["pick"]["points"] == 0
    assert body["totals"] == {"picked": 2, "graded": 1, "points": 0, "winner_method": 0}
    card = _summary(c)["cards"][0]
    assert (card["picked"], card["graded"], card["points"], card["winner_method"]) == (2, 1, 0, 0)
