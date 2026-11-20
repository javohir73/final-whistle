"""Tests for the NRL backtest CLI's held-out season selection."""
from __future__ import annotations

from pipeline.sports.nrl_backtest import held_out_seasons


def test_held_out_seasons_follow_the_latest_completed_seasons():
    finished = set(range(2017, 2027))
    assert held_out_seasons(finished, unfinished=set()) == (2024, 2025, 2026)


def test_a_season_still_being_played_is_not_held_out():
    finished = set(range(2017, 2028))
    assert held_out_seasons(finished, unfinished={2027}) == (2024, 2025, 2026)


def test_short_history_returns_what_exists():
    assert held_out_seasons({2025, 2026}, unfinished=set()) == (2025, 2026)
    assert held_out_seasons(set(), unfinished=set()) == ()
