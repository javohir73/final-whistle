"""UFC rules shared by the API and the picks game."""
from __future__ import annotations

import pytest

from app.ufc_rules import is_placeholder_name


@pytest.mark.parametrize("name,expected", [
    ("TBA", True), ("tba", True), (" Opponent TBA ", True), ("opponent   tba", True),
    ("", True), (None, True),
    ("Shara Magomedov", False), ("Tbarra Silva", False), ("Opponent", False),
])
def test_is_placeholder_name(name, expected):
    assert is_placeholder_name(name) is expected


# ---- the lock, the score and the model's pick (task 2) ----
from dataclasses import astuple  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

from sqlalchemy import select  # noqa: E402

from app.models import UfcBout, UfcEvent, UfcFighter  # noqa: E402
from app.ufc_rules import (  # noqa: E402
    call_is_public,
    lock_expr,
    lock_time,
    model_pick,
    pick_block,
    score_pick,
    utc,
)

T = datetime(2026, 12, 5, 18, 0, tzinfo=timezone.utc)
_UNSET = object()


def _b(scheduled=_UNSET, locked_at=None, status="scheduled", winner=None, method=None, **kw):
    return UfcBout(
        scheduled_utc=T if scheduled is _UNSET else scheduled, locked_at=locked_at,
        status=status, winner=winner, method=method, **kw,
    )


def test_lock_time_is_the_earlier_of_locked_at_and_scheduled():
    assert lock_time(_b(scheduled=T)) == T
    assert lock_time(_b(scheduled=T, locked_at=T - timedelta(minutes=5))) == T - timedelta(minutes=5)
    assert lock_time(_b(scheduled=T, locked_at=T + timedelta(minutes=5))) == T
    assert lock_time(_b(scheduled=None, locked_at=None)) is None
    assert lock_time(_b(scheduled=None, locked_at=T)) == T
    assert lock_time(_b(scheduled=T.replace(tzinfo=None))) == T  # SQLite hands back naive values


def test_utc_normalises_naive_and_aware():
    assert utc(None) is None
    assert utc(T.replace(tzinfo=None)) == T
    other = timezone(timedelta(hours=-5))
    assert utc(T.astimezone(other)) == T and utc(T.astimezone(other)).utcoffset() == timedelta(0)


def test_lock_expr_matches_lock_time(db_session):
    cases = [
        dict(scheduled=T),
        dict(scheduled=T, locked_at=T - timedelta(minutes=5)),
        dict(scheduled=T, locked_at=T + timedelta(minutes=5)),
        dict(scheduled=None, locked_at=None),
        dict(scheduled=None, locked_at=T),
    ]
    event = UfcEvent(provider="espn", provider_event_id="e", name="n", slug="n", status="scheduled")
    fighters = [UfcFighter(provider="espn", provider_fighter_id=str(i), name=f"F{i}", slug=f"f{i}") for i in range(2)]
    db_session.add_all([event, *fighters])
    db_session.flush()
    rows = []
    for i, kw in enumerate(cases):
        row = _b(provider="espn", provider_bout_id=f"b{i}", event_id=event.id,
                 fighter_a_id=fighters[0].id, fighter_b_id=fighters[1].id, **kw)
        db_session.add(row)
        rows.append(row)
    db_session.flush()
    got = dict(db_session.execute(select(UfcBout.id, lock_expr())).all())
    for row in rows:
        want = lock_time(row)
        assert utc(got[row.id]) == want


_LOCKED = (422, "fight_locked", "Picks for this fight have closed.")


@pytest.mark.parametrize("kw,now,expected", [
    ({}, T - timedelta(seconds=1), None),
    ({}, T, _LOCKED),
    ({}, T + timedelta(hours=1), _LOCKED),
    ({"status": "live"}, T - timedelta(hours=1), _LOCKED),
    ({"status": "finished", "winner": "a"}, T - timedelta(hours=1), _LOCKED),
    ({"winner": "a"}, T - timedelta(hours=1), _LOCKED),
    ({"locked_at": T - timedelta(hours=2)}, T - timedelta(hours=1), _LOCKED),
    ({"scheduled": None}, T - timedelta(hours=1), _LOCKED),
    ({"status": "cancelled"}, T - timedelta(hours=1), (422, "fight_cancelled", "This fight was cancelled.")),
    ({"status": "changed"}, T - timedelta(hours=1),
     (422, "fight_changed", "This fight has changed. Pick the new one on the card.")),
    ({"event_status": "cancelled"}, T - timedelta(hours=1), (422, "fight_cancelled", "This fight was cancelled.")),
    ({"name_b": "Opponent TBA"}, T - timedelta(hours=1),
     (422, "opponent_tba", "Picks open once both fighters are confirmed.")),
    # order: locked beats a placeholder name; changed beats everything
    ({"name_b": "TBA"}, T + timedelta(hours=1), _LOCKED),
    ({"status": "changed", "event_status": "cancelled"}, T,
     (422, "fight_changed", "This fight has changed. Pick the new one on the card.")),
])
def test_pick_block(kw, now, expected):
    kw = dict(kw)
    event_status = kw.pop("event_status", "scheduled")
    name_a, name_b = kw.pop("name_a", "Shara Magomedov"), kw.pop("name_b", "Michal Oleksiejczuk")
    bout = _b(**kw)
    assert pick_block(bout, UfcEvent(status=event_status), name_a, name_b, now) == expected


@pytest.mark.parametrize("kw,now,public", [
    ({}, T - timedelta(seconds=1), False), ({}, T, True), ({"status": "live"}, T - timedelta(hours=1), True),
    ({"status": "finished", "winner": "b"}, T - timedelta(hours=1), True),
    ({"status": "cancelled"}, T + timedelta(hours=1), False),
    ({"status": "changed"}, T + timedelta(hours=1), False),
    ({"name_a": "TBA", "status": "finished"}, T, False),
    ({"scheduled": None}, T, False),
    ({"locked_at": T - timedelta(hours=2)}, T - timedelta(hours=1), True),
])
def test_call_is_public(kw, now, public):
    kw = dict(kw)
    name_a, name_b = kw.pop("name_a", "Shara Magomedov"), kw.pop("name_b", "Michal Oleksiejczuk")
    assert call_is_public(_b(**kw), name_a, name_b, now) is public


@pytest.mark.parametrize("status,winner,method,pick,expected", [
    ("finished", "b", "decision", ("b", "decision"), (5, True, True, False)),
    ("finished", "b", "ko_tko", ("b", "decision"), (2, True, False, False)),
    ("finished", "b", "decision", ("a", "decision"), (0, False, False, False)),
    ("finished", "a", "dq", ("a", "ko_tko"), (2, True, False, False)),
    ("finished", "a", "other", ("a", "submission"), (2, True, False, False)),
    ("finished", "a", None, ("a", "submission"), (2, True, False, False)),
    ("finished", "a", "ko_tko", ("a", None), (2, True, False, False)),
    ("finished", "a", "dq", ("b", "decision"), (0, False, False, False)),
    ("finished", None, "draw", ("a", "decision"), (None, None, None, True)),
    ("finished", "a", "draw", ("a", "decision"), (None, None, None, True)),
    ("finished", None, "no_contest", ("b", "ko_tko"), (None, None, None, True)),
    ("finished", None, None, ("b", "ko_tko"), (None, None, None, True)),
    ("cancelled", None, None, ("a", "decision"), (None, None, None, True)),
    ("changed", None, None, ("a", "decision"), (None, None, None, True)),
])
def test_score_pick_matrix(status, winner, method, pick, expected):
    assert astuple(score_pick(*pick, _b(status=status, winner=winner, method=method))) == expected


@pytest.mark.parametrize("status", ["scheduled", "live"])
def test_score_pick_waits_for_a_result(status):
    assert score_pick("a", "decision", _b(status=status)) is None


def test_model_pick():
    probs = {"ko_tko": 0.3, "submission": 0.2, "decision": 0.5}
    assert model_pick(0.62, probs) == ("a", "decision")
    assert model_pick(0.38, probs) == ("b", "decision")
    assert model_pick(0.5, probs) == (None, None)
    assert model_pick(0.5, None) == (None, None)
    assert model_pick(0.7, {"ko_tko": 0.4, "submission": 0.2, "decision": 0.4}) == ("a", "decision")  # tie order
    assert model_pick(0.7, {"ko_tko": 0.4, "submission": 0.4, "decision": 0.2}) == ("a", "ko_tko")
    assert model_pick(0.7, None) == ("a", None)
    assert model_pick(0.7, {}) == ("a", None)
    assert model_pick(0.7, {"other": 0.9}) == ("a", None)


def test_model_pick_skips_malformed_method_probabilities():
    nan, inf = float("nan"), float("inf")
    assert model_pick(0.7, {"ko_tko": None, "submission": "0.9", "decision": nan}) == ("a", None)
    assert model_pick(0.7, {"ko_tko": True, "submission": inf, "decision": -inf}) == ("a", None)
    assert model_pick(0.7, {"ko_tko": 0.3, "submission": None, "decision": "x"}) == ("a", "ko_tko")
    assert model_pick(0.7, {"ko_tko": nan, "submission": 0.2, "decision": 0.1}) == ("a", "submission")
    assert model_pick(0.3, {"ko_tko": 1, "submission": 0, "decision": 0}) == ("b", "ko_tko")
