"""Feature snapshot tests; expected values are worked by hand from the brief's formulas."""
from __future__ import annotations

import math
from datetime import datetime, timezone

import pytest

from ml.sports.ufc.elo import EloParams
from ml.sports.ufc.features import FEATURES, flip, snapshots
from ml.sports.ufc.history import BoutRecord
from ml.sports.ufc.testkit import history

P = EloParams(k=80, history_from=1993)
DEC = {"stats_a": (10, 0), "stats_b": (5, 0)}


def test_profile_differences():
    h = history(
        [("2020-01-01", "A", "B", "a", "decision")],
        fighters={"A": {"dob": "1990-01-01", "reach": 76, "height": 72},
                  "B": {"dob": "1995-01-01", "reach": 70, "height": 71}},
    )
    s = snapshots(h, P)[1]
    assert set(s.x) == set(FEATURES)
    x = s.x
    assert x["age_diff"] == pytest.approx(5.0, abs=0.01) and x["reach_diff"] == 6.0 and x["height_diff"] == 1.0
    assert x["age_missing"] == x["reach_missing"] == x["height_missing"] == 0.0
    # sign convention is a - b: with the dates of birth swapped, a is the younger fighter
    swapped = history(
        [("2020-01-01", "A", "B", "a", "decision")],
        fighters={"A": {"dob": "1995-01-01"}, "B": {"dob": "1990-01-01"}},
    )
    assert snapshots(swapped, P)[1].x["age_diff"] == pytest.approx(-5.0, abs=0.01)


def test_missing_profile_is_neutral_with_an_indicator():
    rows = [("2020-01-01", "A", "B", "a", "decision")]
    prof = {"A": {"dob": "1990-01-01", "reach": 76, "height": 72}, "B": {}}
    x = snapshots(history(rows, fighters=prof), P)[1].x
    assert x["age_diff"] == 0.0 and x["age_missing"] == 1.0
    assert x["reach_diff"] == 0.0 and x["reach_missing"] == 1.0
    assert x["height_diff"] == 0.0 and x["height_missing"] == 1.0
    mirrored = history([("2020-01-01", "B", "A", "b", "decision")], fighters=prof)
    assert snapshots(mirrored, P)[1].x["age_missing"] == -1.0


def test_debutant_against_a_veteran():
    h = history([
        ("2019-01-01", "A", "B", "a", "decision", DEC),
        ("2019-07-01", "A", "C", "a", "decision", DEC),
        ("2020-01-01", "A", "D", "a", "decision"),
    ])
    x = snapshots(h, P)[3].x
    assert x["debut"] == 1.0 and x["layoff_diff"] == 0.0 and x["fights_diff"] == pytest.approx(math.log(3))
    assert x["form_missing"] == 1.0 and x["win3_diff"] == 0.0 and x["stats_missing"] == 1.0


def test_form_windows_and_finish_rate():
    h = history([
        ("2019-01-01", "A", "B", "a", "ko_tko"),
        ("2019-03-01", "A", "C", "a", "submission"),
        ("2019-05-01", "A", "D", "b", "decision"),
        ("2019-07-01", "A", "E", "a", "decision"),
        ("2020-01-01", "A", "F", "a", "decision"),
    ])
    s = snapshots(h, P)[5]
    assert s.a.wins3 == (2, 3) and s.a.wins5 == (3, 4) and s.a.finish_rate == pytest.approx(2 / 3)
    assert s.b.wins3 is None


def test_striking_and_takedown_differentials():
    h = history([
        ("2019-01-01", "A", "B", "a", "decision", {"stats_a": (50, 3), "stats_b": (30, 1)}),
        ("2020-01-01", "A", "C", "a", "decision"),
    ])
    s = snapshots(h, P)[2]
    assert s.a.sig_str_pm == pytest.approx(20 / 15) and s.a.td_p15 == pytest.approx(2.0)
    assert s.b.sig_str_pm is None and s.x["stats_missing"] == 1.0
    assert s.x["sig_str_diff"] == 0.0 and s.x["td_diff"] == 0.0


def test_context_products():
    rows = [("2019-01-01", "A", "B", "a", "decision"),
            ("2020-01-01", "A", "B", "a", "decision", {"rounds": 5, "weight_class": "Women's Flyweight"}),
            ("2020-02-01", "A", "B", "a", "decision")]
    x = snapshots(history(rows), P)
    assert x[2].x["elo_diff"] != 0.0
    assert x[2].x["elo_diff_x_five"] == x[2].x["elo_diff"]
    assert x[2].x["elo_diff_x_womens"] == x[2].x["elo_diff"]
    assert x[3].x["elo_diff_x_five"] == 0.0 and x[3].x["elo_diff_x_womens"] == 0.0


def _eight(swap: bool):
    rows = [
        ("2019-01-01", "A", "B", "a", "ko_tko", {"stats_a": (40, 2), "stats_b": (10, 0), "end_round": 2, "end_clock": "2:30"}),
        ("2019-03-01", "C", "A", "b", "decision", {"stats_a": (20, 1), "stats_b": (35, 0)}),
        ("2019-05-01", "B", "D", "a", "submission", {"end_round": 1, "end_clock": "3:00"}),
        ("2019-07-01", "D", "C", None, "draw", {"stats_a": (30, 1), "stats_b": (30, 2)}),
        ("2019-09-01", "A", "D", "a", "decision", {"rounds": 5, "stats_a": (80, 4), "stats_b": (60, 0)}),
        ("2019-09-01", "B", "C", "b", "decision", {"stats_a": (12, 0), "stats_b": (44, 3)}),
        ("2020-01-01", "C", "B", None, "no_contest"),
        ("2020-02-01", "D", "A", "a", "ko_tko", {"weight_class": "Women's Strawweight", "end_round": 3, "end_clock": "1:00"}),
    ]
    prof = {"A": {"dob": "1990-05-05", "reach": 72, "height": 70}, "B": {"dob": "1988-02-02", "height": 69},
            "C": {"reach": 70}, "D": {"dob": "1992-09-09", "reach": 68, "height": 66}}
    if swap:
        flipped = []
        for when, a, b, w, m, *rest in rows:
            ex = dict(rest[0]) if rest else {}
            ex["stats_a"], ex["stats_b"] = ex.get("stats_b"), ex.get("stats_a")
            flipped.append((when, b, a, {"a": "b", "b": "a"}.get(w), m, ex))
        rows = flipped
    h = history(rows, fighters=prof)
    # fighter ids depend on first appearance, so map by name for stable comparison
    return h


def test_relabelling_listing_order_negates_features():
    original = snapshots(_eight(False), P)
    swapped = snapshots(_eight(True), P)
    for bid in range(1, 9):
        assert swapped[bid].x == {k: -v for k, v in original[bid].x.items()}
        assert swapped[bid].p_elo == pytest.approx(1 - original[bid].p_elo, abs=1e-12)
    assert flip(original[5]).x == swapped[5].x
    assert flip(flip(original[5])).x == original[5].x
    assert flip(original[5]).a == original[5].b


def test_later_bouts_do_not_change_an_earlier_snapshot():
    base = [("2019-01-01", "A", "B", "a", "ko_tko"), ("2019-03-01", "C", "A", "b", "decision", DEC),
            ("2019-06-01", "A", "B", "b", "decision")]
    later = base + [("2020-01-01", "A", "B", "a", "decision"), ("2020-02-01", "B", "C", "a", "ko_tko"),
                    ("2020-03-01", "A", "C", "b", "submission"), ("2020-04-01", "B", "A", "a", "decision")]
    assert snapshots(history(base), P)[3] == snapshots(history(later), P)[3]


def test_own_result_and_stats_do_not_enter_own_snapshot():
    prior = ("2019-01-01", "A", "B", "a", "decision", DEC)
    win = history([prior, ("2020-01-01", "A", "B", "a", "decision", {"stats_a": (90, 5), "stats_b": (1, 0)})])
    loss = history([prior, ("2020-01-01", "A", "B", "b", "ko_tko", {"stats_a": (0, 0), "stats_b": (50, 2),
                                                                      "end_round": 1, "end_clock": "1:00"})])
    assert snapshots(win, P)[2] == snapshots(loss, P)[2]


def test_same_time_bouts_do_not_see_each_other():
    h = history([("2020-01-01T03:00", "A", "B", "a", "ko_tko"), ("2020-01-01T03:00", "A", "C", "a", "submission")])
    s = snapshots(h, P)[2]
    assert s.a.ufc_fights == 0 and s.a.rating == 1500.0 and s.x["debut"] == 0.0


def test_only_draws_and_no_contests_before():
    h = history([
        ("2019-01-01", "A", "B", None, "draw"),
        ("2019-03-01", "A", "C", None, "no_contest"),
        ("2019-05-01", "D", "E", "a", "ko_tko"),
        ("2020-01-01", "A", "D", "a", "decision"),
    ])
    s = snapshots(h, P)[4]
    assert s.a.ufc_fights == 2 and s.a.layoff_days is not None and s.x["debut"] == 0.0
    assert s.a.wins3 is None and s.x["form_missing"] == -1.0 and s.x["win3_diff"] == 0.0
    assert s.a.finish_rate is None and s.b.finish_rate == 1.0 and s.x["finish_missing"] == -1.0
    assert s.a.rating == pytest.approx(1500.0)


def test_rematch_sees_only_the_first_meeting():
    h = history([
        ("2020-01-01", "A", "B", "a", "decision", {"stats_a": (40, 0), "stats_b": (20, 0)}),
        ("2021-01-01", "A", "B", "b", "decision", {"stats_a": (10, 0), "stats_b": (60, 4)}),
    ])
    s = snapshots(h, P)[2]
    assert s.a.wins3 == (1, 1) and s.b.wins3 == (0, 1) and s.a.rating == pytest.approx(1540.0, abs=1e-9)
    assert s.a.sig_str_pm == pytest.approx(20 / 15)


def test_targets_are_predicted_from_all_earlier_history():
    rows = [("2019-01-01", "A", "B", "a", "decision"), ("2019-06-01", "B", "C", "b", "ko_tko")]
    h = history(rows)
    base = snapshots(h, P)
    target = BoundTarget = BoutRecord(
        bout_id=99, when=datetime(2020, 1, 1, tzinfo=timezone.utc), fighter_a=1, fighter_b=3,
        winner=None, method=None, weight_class="Lightweight", scheduled_rounds=3, end_round=None,
        end_clock=None, stats_a=None, stats_b=None, finished=False)
    out = snapshots(h, P, [target])
    assert set(out) == set(base) | {99}
    assert {k: out[k] for k in base} == base
    assert out[99].a.ufc_fights == 1 and out[99].b.ufc_fights == 1 and out[99].a.rating > 1500.0


def test_layoff_diff_is_a_minus_b():
    h = history([
        ("2019-01-01", "A", "B", "a", "decision"),
        ("2019-12-01", "C", "D", "a", "decision"),
        ("2020-01-01", "A", "C", "a", "decision"),
    ])
    s = snapshots(h, P)[3]
    assert s.a.layoff_days == 365 and s.b.layoff_days == 31
    assert s.x["layoff_diff"] == pytest.approx(math.log1p(365) - math.log1p(31))
    assert s.x["layoff_diff"] > 0
