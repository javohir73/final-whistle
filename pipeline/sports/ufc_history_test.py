"""History loader tests against the in-memory database."""
from __future__ import annotations

import pytest

from ml.sports.ufc.history import StatLine, fight_minutes
from pipeline.sports.ufc_history import load_history
from pipeline.sports.ufc_testkit import build


def test_loads_only_finished_bouts_in_time_order(db_session):
    build(db_session, [
        ("2020-02-01", "A", "B", "a", "decision"),
        ("2020-01-01", "C", "D", "b", "ko_tko"),
        ("2020-03-01", "E", "F", None, "draw"),
        ("2020-04-01", "G", "H", None, None, {"status": "cancelled"}),
        ("2020-05-01", "I", "J", None, None, {"status": "changed"}),
        ("2020-06-01", "K", "L", None, None),
    ])
    h = load_history(db_session)
    assert [b.when.month for b in h.bouts] == [1, 2, 3]
    assert h.bouts[2].winner is None and h.bouts[2].method == "draw"
    assert all(b.finished for b in h.bouts)


def test_times_are_utc_aware(db_session):
    build(db_session, [("2020-01-01", "A", "B", "a", "decision"), ("2020-01-02T20:30", "C", "D", "b", "ko_tko")])
    h = load_history(db_session)
    assert all(b.when.tzinfo is not None for b in h.bouts)
    assert (h.bouts[0].when.hour, h.bouts[1].when.hour) == (3, 20)


def test_stats_are_attached_to_the_right_side(db_session):
    build(db_session, [("2020-01-01", "A", "B", "a", "decision", {"stats_a": (50, 3), "stats_b": (30, 1)})])
    b = load_history(db_session).bouts[0]
    assert b.stats_a == StatLine(50, 3) and b.stats_b == StatLine(30, 1)


def test_bout_without_stats_has_none(db_session):
    build(db_session, [("2020-01-01", "A", "B", "a", "decision")])
    b = load_history(db_session).bouts[0]
    assert b.stats_a is None and b.stats_b is None


def test_fighter_profiles_come_along(db_session):
    built = build(db_session, [("2020-01-01", "A", "B", "a", "decision")],
                  fighters={"A": {"dob": "1990-01-01", "reach": 76}})
    h = load_history(db_session)
    info = h.fighters[built.fighters["A"].id]
    assert info.reach_in == 76.0 and info.date_of_birth.year == 1990 and info.name == "A"
    assert h.fighters[built.fighters["B"].id].reach_in is None


def test_fight_minutes(db_session):
    build(db_session, [
        ("2020-01-01", "A", "B", "a", "decision"),
        ("2020-01-02", "C", "D", "a", "ko_tko", {"end_round": 2, "end_clock": "4:58"}),
        ("2020-01-03", "E", "F", "a", "ko_tko", {"end_round": 1}),
    ])
    b1, b2, b3 = load_history(db_session).bouts
    assert fight_minutes(b1) == 15.0
    assert fight_minutes(b2) == pytest.approx(9.9667, abs=1e-3)
    assert fight_minutes(b3) is None
