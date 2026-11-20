"""Tests for the reviewed NRL feed corrections."""
from __future__ import annotations

from pipeline.sports.nrl_ingest import parse_row
from pipeline.sports.nrl_result_corrections import (
    MISSING_ROWS,
    SCORE_CORRECTIONS,
    apply_corrections,
)


def _row(round_no, match_no, home, away, sh, sa):
    return {"MatchNumber": match_no, "RoundNumber": round_no, "DateUtc": "2026-09-05 09:30:00Z",
            "Location": "Somewhere", "HomeTeam": home, "AwayTeam": away,
            "HomeTeamScore": sh, "AwayTeamScore": sa}


def test_corrects_a_known_wrong_score_without_mutating_the_input():
    wrong = _row(27, 204, "Sharks", "Storm", 20, 23)
    rows, corrected = apply_corrections(2026, [wrong])
    assert (rows[0]["HomeTeamScore"], rows[0]["AwayTeamScore"]) == (20, 24)
    assert corrected == {(27, 204)}
    assert wrong["AwayTeamScore"] == 23


def test_leaves_other_seasons_rounds_and_already_right_scores_alone():
    same_teams_other_round = _row(3, 20, "Sharks", "Storm", 20, 23)
    already_right = _row(27, 204, "Sharks", "Storm", 20, 24)
    rows, corrected = apply_corrections(2026, [same_teams_other_round, already_right])
    assert rows == [same_teams_other_round, already_right]
    assert corrected == set()
    rows, corrected = apply_corrections(2025, [_row(27, 204, "Sharks", "Storm", 20, 23)])
    assert rows[0]["AwayTeamScore"] == 23 and corrected == set()


def test_never_scores_a_match_the_feed_still_lists_as_scheduled():
    scheduled = _row(27, 204, "Sharks", "Storm", None, None)
    rows, corrected = apply_corrections(2026, [scheduled])
    assert rows == [scheduled] and corrected == set()


def test_appends_the_2017_finals_once_and_every_row_parses():
    regular = [_row(26, 192, "Dragons", "Bulldogs", 20, 26)]
    rows, _ = apply_corrections(2017, regular)
    added = rows[1:]
    assert len(added) == 9
    assert [r["RoundNumber"] for r in added] == [27, 27, 27, 27, 28, 28, 29, 29, 30]
    assert [r["MatchNumber"] for r in added] == list(range(193, 202))
    assert all(parse_row(r) is not None and parse_row(r)["status"] == "finished" for r in added)
    assert (added[-1]["HomeTeam"], added[-1]["AwayTeam"], added[-1]["HomeTeamScore"], added[-1]["AwayTeamScore"]) == ("Storm", "Cowboys", 34, 6)
    # Feeding the corrected output back in adds nothing.
    again, _ = apply_corrections(2017, rows)
    assert again == rows


def test_missing_rows_stand_down_once_the_feed_carries_that_stage_itself():
    feed_now_has_finals = [_row(26, 192, "Dragons", "Bulldogs", 20, 26),
                           _row(30, 999, "Storm", "Cowboys", 34, 6)]
    rows, _ = apply_corrections(2017, feed_now_has_finals)
    assert rows == feed_now_has_finals


def test_malformed_rows_pass_through_and_never_raise():
    """parse_row skips malformed rows; this layer must not turn one into a crash
    that aborts the season (and, before the fix, every later season)."""
    good = _row(1, 1, "Sharks", "Storm", 10, 12)
    bad_round = dict(_row(2, 2, "Eels", "Titans", 1, 2), RoundNumber="2")
    no_number = {k: v for k, v in _row(27, 204, "Sharks", "Storm", 20, 23).items() if k != "MatchNumber"}
    for year in (2026, 2017):
        rows, corrected = apply_corrections(year, [good, bad_round, no_number, None])
        assert rows[:4] == [good, bad_round, no_number, None]
        assert corrected == set()


def test_tables_are_well_formed():
    for (season, round_no, home, away), (sh, sa) in SCORE_CORRECTIONS.items():
        assert isinstance(season, int) and isinstance(round_no, int) and home != away
        assert sh >= 0 and sa >= 0
    for season, extra in MISSING_ROWS.items():
        keys = [(r["RoundNumber"], r["MatchNumber"]) for r in extra]
        assert len(keys) == len(set(keys))
