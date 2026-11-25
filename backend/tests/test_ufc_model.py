"""The model's call: built only by app.ufc_model, public only once a fight is locked."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event

from app.config import settings
from app.models import UfcPrediction
from app.ufc_model import reword_reason
from backend.tests.test_ufc_api import (  # noqa: F401  (client is a fixture)
    _bout, _event, _fighter, client,
)

VERSION = "ufc-form-v0.2"
SLUG = "model-card"


def _keys(obj):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield k
            yield from _keys(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _keys(v)


def _pred(db, bout, at, version=VERSION, p_a=0.4, reasons=None, method_probs=None):
    p = UfcPrediction(
        bout_id=bout.id, model_version=version, p_a=p_a, p_b=1 - p_a,
        method_probs=method_probs or {"ko_tko": 0.2, "submission": 0.1, "decision": 0.7},
        reasons=reasons or [], is_shadow=True, created_at=at,
    )
    db.add(p)
    db.flush()
    return p


def _setup(client, *, status="scheduled", lock_in=timedelta(hours=1), a="Israel Adesanya",
           b="Shara Magomedov", **kw):
    c, Session, engine = client
    db = Session()
    now = datetime.now(timezone.utc)
    lock = now + lock_in
    ev = _event(db, SLUG, "scheduled", lock, lock)
    bout = _bout(db, ev, _fighter(db, a), _fighter(db, b), card_order=1, segment="main",
                 segment_label="Main Card", scheduled_utc=lock, status=status, **kw)
    return c, db, engine, bout, lock


def _model_set(monkeypatch, value=VERSION):
    monkeypatch.setattr(settings, "ufc_public_model", value)


def _models(c):
    d = c.get(f"/api/ufc/events/{SLUG}").json()
    return [b["model"] for s in d["segments"] for b in s["bouts"]]


def test_no_call_when_the_setting_is_empty(client, monkeypatch):
    _model_set(monkeypatch, "")
    c, db, _, bout, lock = _setup(client, status="finished", lock_in=-timedelta(hours=3),
                                  winner="a", method="decision")
    _pred(db, bout, lock - timedelta(hours=1))
    db.commit()
    assert all(m is None for m in _models(c))
    assert c.get(f"/api/ufc/bouts/{bout.id}").json()["model"] is None


def test_no_call_without_a_row_of_that_version_at_or_before_lock(client, monkeypatch):
    _model_set(monkeypatch)
    c, db, _, bout, lock = _setup(client, status="live", lock_in=-timedelta(hours=1))
    _pred(db, bout, lock + timedelta(minutes=1))
    _pred(db, bout, lock - timedelta(hours=1), version="ufc-elo-v0.1")
    db.commit()
    assert _models(c) == [None]
    assert c.get(f"/api/ufc/bouts/{bout.id}").json()["model"] is None


def test_counting_row_is_the_latest_at_or_before_lock(client, monkeypatch):
    _model_set(monkeypatch)
    c, db, _, bout, lock = _setup(client, status="live", lock_in=-timedelta(hours=1))
    _pred(db, bout, lock - timedelta(hours=2), p_a=0.55)
    _pred(db, bout, lock, p_a=0.61)
    _pred(db, bout, lock + timedelta(minutes=1), p_a=0.90)
    db.commit()
    assert c.get(f"/api/ufc/bouts/{bout.id}").json()["model"]["p_a"] == 0.61


def test_open_bout_never_carries_a_call(client, monkeypatch):
    _model_set(monkeypatch)
    c, db, _, bout, lock = _setup(client)
    _pred(db, bout, lock - timedelta(hours=2), reasons=["Shara Magomedov is five years younger."])
    db.commit()
    for r in (c.get(f"/api/ufc/events/{SLUG}"), c.get("/api/ufc/events/next"),
              c.get(f"/api/ufc/bouts/{bout.id}")):
        assert r.status_code == 200
        assert "five years younger" not in r.text and '"p_a"' not in r.text


@pytest.mark.parametrize("state", ["locked_by_clock", "live", "finished"])
def test_locked_bouts_carry_the_call_for_everyone(client, monkeypatch, state):
    _model_set(monkeypatch)
    kw = {"locked_by_clock": dict(status="scheduled"), "live": dict(status="live"),
          "finished": dict(status="finished", winner="b", method="decision")}[state]
    c, db, _, bout, lock = _setup(client, lock_in=-timedelta(hours=1), **kw)
    _pred(db, bout, lock - timedelta(hours=2), p_a=0.4)
    db.commit()
    m = c.get(f"/api/ufc/bouts/{bout.id}").json()["model"]
    assert m["model_version"] == VERSION and m["winner"] == "b" and m["method"] == "decision"
    assert abs(m["p_a"] + m["p_b"] - 1) < 1e-9
    assert _models(c)[0]["winner"] == "b"


@pytest.mark.parametrize("kind", ["cancelled", "placeholder"])
def test_cancelled_and_placeholder_bouts_never_carry_a_call(client, monkeypatch, kind):
    _model_set(monkeypatch)
    if kind == "cancelled":
        c, db, _, bout, lock = _setup(client, status="cancelled", lock_in=-timedelta(hours=1))
    else:
        c, db, _, bout, lock = _setup(client, status="live", lock_in=-timedelta(hours=1),
                                      b="Opponent TBA")
    _pred(db, bout, lock - timedelta(hours=2))
    db.commit()
    assert c.get(f"/api/ufc/bouts/{bout.id}").json()["model"] is None
    assert _models(c) == [None]


def test_list_and_fighter_endpoints_never_carry_model_fields(client, monkeypatch):
    _model_set(monkeypatch)
    c, db, _, bout, lock = _setup(client, status="finished", lock_in=-timedelta(hours=3),
                                  winner="a", method="decision")
    _pred(db, bout, lock - timedelta(hours=1))
    db.commit()
    slug = "israel-adesanya"
    for path in ("/api/ufc/events?when=upcoming", "/api/ufc/events?when=past",
                 f"/api/ufc/fighters/{slug}"):
        r = c.get(path)
        assert r.status_code == 200, path
        assert not set(_keys(r.json())) & {"model", "p_a", "p_b", "method_probs", "reasons"}


def test_rating_reason_is_reworded():
    assert reword_reason("Jiří Procházka is rated higher, 1560 to 1500.") == \
        "Jiří Procházka is ahead on FinalWhistle's own fighter rating, 1560 to 1500."
    assert reword_reason("Shara Magomedov is five years younger.") == \
        "Shara Magomedov is five years younger."


def test_served_reasons_are_reworded(client, monkeypatch):
    _model_set(monkeypatch)
    c, db, _, bout, lock = _setup(client, status="live", lock_in=-timedelta(hours=1))
    _pred(db, bout, lock - timedelta(hours=2),
          reasons=["Israel Adesanya is rated higher, 1560 to 1500.", "Other."])
    db.commit()
    assert c.get(f"/api/ufc/bouts/{bout.id}").json()["model"]["reasons"] == [
        "Israel Adesanya is ahead on FinalWhistle's own fighter rating, 1560 to 1500.", "Other."]


def test_card_query_count_grows_by_at_most_one_with_calls(client, monkeypatch):
    c, db, engine, bout, lock = _setup(client, status="live", lock_in=-timedelta(hours=1))
    _pred(db, bout, lock - timedelta(hours=2))
    db.commit()

    def count():
        n = [0]

        def listener(*a, **k):
            n[0] += 1

        event.listen(engine, "before_cursor_execute", listener)
        try:
            assert c.get(f"/api/ufc/events/{SLUG}").status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", listener)
        return n[0]

    _model_set(monkeypatch, "")
    without = count()
    _model_set(monkeypatch)
    assert count() <= without + 1
    assert _models(c)[0] is not None
