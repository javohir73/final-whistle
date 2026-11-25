"""Elo replay tests; expected values are worked by hand from the formula."""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from ml.sports.ufc.elo import EloParams, EloState, elo_probs, final_ratings, win_prob
from ml.sports.ufc.testkit import history

P = EloParams(k=80, history_from=1993)


def test_first_bout_and_an_upset():
    h = history([("2020-01-01", "A", "B", "a", "decision"), ("2020-02-01", "A", "C", "b", "ko_tko")])
    probs = elo_probs(h, P)
    assert probs[1] == 0.5 and probs[2] == pytest.approx(0.557312, abs=1e-6)
    r = final_ratings(h, P, at=datetime(2020, 3, 1, tzinfo=timezone.utc))
    assert r[1] == pytest.approx(1495.415, abs=1e-3)
    assert r[3] == pytest.approx(1544.585, abs=1e-3)
    assert r[2] == 1460.0


def test_bouts_sharing_a_time_are_rated_as_one_batch():
    h = history([("2020-01-01", "A", "B", "a", "ko_tko"), ("2020-01-01", "A", "C", "a", "submission")])
    assert elo_probs(h, P) == {1: 0.5, 2: 0.5}
    r = final_ratings(h, P, at=datetime(2020, 1, 2, tzinfo=timezone.utc))
    assert r == {1: 1580.0, 2: 1460.0, 3: 1460.0}


def test_draw_moves_unequal_ratings_and_no_contest_moves_nothing():
    h = history([
        ("2020-01-01", "A", "B", "a", "decision"),
        ("2020-02-01", "A", "C", None, "draw"),
        ("2020-03-01", "B", "C", None, "no_contest"),
    ])
    at = datetime(2020, 4, 1, tzinfo=timezone.utc)
    r = final_ratings(h, P, at=at)
    p = win_prob(1540, 1500)
    assert r[1] == pytest.approx(1540 + 80 * (0.5 - p), abs=1e-9)
    assert r[1] == pytest.approx(1535.415, abs=1e-3)
    assert r[3] == pytest.approx(1500 - 80 * (0.5 - p), abs=1e-9)
    assert r[2] == 1460.0
    probs = elo_probs(h, P)
    assert probs[3] == pytest.approx(win_prob(1460, r[3]), abs=1e-9)


def test_a_dq_with_a_winner_is_a_win_and_without_one_changes_nothing():
    h = history([("2020-01-01", "A", "B", "a", "dq"), ("2020-02-01", "C", "D", None, "dq")])
    r = final_ratings(h, P, at=datetime(2020, 3, 1, tzinfo=timezone.utc))
    assert r == {1: 1540.0, 2: 1460.0}


def test_decay_pulls_an_idle_fighter_back():
    h = history([("2020-01-01", "A", "B", "a", "decision")])
    s = EloState(EloParams(k=80, history_from=1993, decay=0.5))
    s.apply(h.bouts)
    assert s.rating(1, datetime(2020, 1, 1, tzinfo=timezone.utc)) == 1540.0
    assert s.rating(1, datetime(2022, 1, 1, tzinfo=timezone.utc)) == pytest.approx(1510.0, abs=0.05)
    assert s.rating(99, datetime(2022, 1, 1, tzinfo=timezone.utc)) == 1500.0


def test_history_from_ignores_older_bouts():
    h = history([("2020-01-01", "A", "B", "a", "decision")])
    p = EloParams(k=80, history_from=2021)
    assert final_ratings(h, p, at=datetime(2022, 1, 1, tzinfo=timezone.utc)) == {}
    assert elo_probs(h, p) == {1: 0.5}


def test_win_prob_is_antisymmetric():
    for i in range(20):
        a, b = 1200 + 30 * i, 1800 - 17 * i
        assert win_prob(a, b) + win_prob(b, a) == pytest.approx(1, abs=1e-12)
