"""Method-probability tests; expected values are worked by hand from the shrinkage rule."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ml.sports.ufc.methods import FALLBACK_RATES, method_pick, method_table, weight_group
from ml.sports.ufc.testkit import history

START = datetime(2020, 1, 1, tzinfo=timezone.utc)
END = datetime(2021, 1, 1, tzinfo=timezone.utc)


def _rows(counts: dict[str, int], weight_class: str = "Lightweight", rounds: int = 3, day: str = "2020-06-01"):
    return [
        (day, f"{m}{i}a", f"{m}{i}b", "a", m, {"weight_class": weight_class, "rounds": rounds})
        for m, n in counts.items() for i in range(n)
    ]


def _table(rows, start=START, end=END):
    return method_table(history(rows).bouts, start, end)


def _hundred():
    # 100 counted bouts overall: 30 ko_tko, 20 submission, 50 decision;
    # 10 of them are Lightweight/3 rounds: 6 ko_tko, 1 submission, 3 decision.
    return (
        _rows({"ko_tko": 6, "submission": 1, "decision": 3})
        + _rows({"ko_tko": 24, "submission": 19, "decision": 47}, weight_class="Heavyweight", rounds=5)
    )


def test_shrunk_group_rates():
    p = _table(_hundred()).probs("Lightweight", 3)
    assert p["ko_tko"] == pytest.approx(21 / 60)
    assert p["submission"] == pytest.approx(11 / 60)
    assert p["decision"] == pytest.approx(28 / 60)
    assert sum(p.values()) == pytest.approx(1.0)


def test_unknown_class_gets_overall_rates():
    t = _table(_hundred())
    expected = {"ko_tko": 0.3, "submission": 0.2, "decision": 0.5}
    assert t.probs(None, 3) == pytest.approx(expected)
    assert t.probs("Strawweight", 3) == pytest.approx(expected)  # unseen group
    assert t.probs("Lightweight", 5) == pytest.approx(expected)  # same class, unseen rounds


def test_empty_window_uses_fallback():
    assert _table([]).probs("Lightweight", 3) == pytest.approx(FALLBACK_RATES)


def test_window_is_half_open():
    rows = (
        _rows({"ko_tko": 1}, day="2020-01-01")  # exactly start: included
        + _rows({"submission": 1}, day="2021-01-01")  # exactly end: excluded
    )
    rows = [(r[0] + ("T00:00"), *r[1:]) for r in rows]
    p = _table(rows).probs(None, 3)
    assert p["ko_tko"] == pytest.approx(1.0) and p["submission"] == 0.0


def test_draws_dq_and_no_contests_not_counted():
    rows = _rows({"decision": 1}) + [
        ("2020-06-01", "d1", "d2", None, "draw"),
        ("2020-06-01", "q1", "q2", "a", "dq"),
        ("2020-06-01", "n1", "n2", None, "no_contest"),
        ("2020-06-01", "o1", "o2", "a", "other"),
        ("2020-06-01", "m1", "m2", "a", None),
        ("2020-06-01", "w1", "w2", None, "ko_tko"),  # a stoppage with no winner
    ]
    t = _table(rows)
    assert t.probs("Lightweight", 3) == pytest.approx({
        "ko_tko": 0.0, "submission": 0.0, "decision": 1.0,
    })


def test_unfinished_bouts_not_counted():
    rows = _rows({"decision": 1}) + [
        ("2020-06-01", "u1", "u2", "a", "ko_tko", {"status": "scheduled"}),
    ]
    bouts = history(rows).bouts  # the kit drops unfinished bouts, so build one directly
    from dataclasses import replace
    extra = replace(bouts[0], bout_id=99, method="ko_tko", finished=False)
    p = method_table([*bouts, extra], START, END).probs(None, 3)
    assert p["decision"] == pytest.approx(1.0)


def test_catchweight_spellings_merge():
    assert weight_group("Catchweight") == weight_group("Catch Weight") == "catch weight"
    assert weight_group(" Women's Catchweight ") == "women's catch weight"
    assert weight_group("Women's Catch Weight") == "women's catch weight"
    assert weight_group("Lightweight") == "lightweight"
    assert weight_group("") is None and weight_group("   ") is None and weight_group(None) is None


def test_weight_class_lookup_is_case_insensitive():
    t = _table(_hundred())
    assert t.probs("LIGHTWEIGHT", 3) == t.probs("lightweight ", 3)


def test_rounds_none_is_three():
    t = _table(_hundred())
    assert t.probs("Lightweight", None) == t.probs("Lightweight", 3)


def test_bouts_with_unknown_rounds_count_as_three():
    rows = [("2020-06-01", "a1", "a2", "a", "ko_tko", {"rounds": None})]
    p = _table(rows).probs("Lightweight", 3)
    assert p["ko_tko"] == pytest.approx((1 + 50 * 1.0) / 51)


def test_pick_and_its_tie_order():
    assert method_pick({"ko_tko": 0.4, "submission": 0.2, "decision": 0.4}) == "decision"
    assert method_pick({"ko_tko": 0.4, "submission": 0.4, "decision": 0.2}) == "ko_tko"
    assert method_pick({"ko_tko": 0.2, "submission": 0.5, "decision": 0.3}) == "submission"
