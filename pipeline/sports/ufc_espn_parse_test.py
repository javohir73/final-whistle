"""Tests for pipeline/sports/ufc_espn_parse.py, run against the recorded ESPN
fixtures in pipeline/sports/testdata/ufc/raw/. No network."""
from __future__ import annotations

import json
from datetime import date, datetime, timezone
from pathlib import Path

from pipeline.sports.ufc_espn_parse import (
    normalise_method,
    parse_event,
    parse_fighter,
    parse_odds,
    parse_outcome,
    parse_stats,
    competition_fighter_ids,
    find_competition,
    winner_flags_by_id,
)
from pipeline.sports.ufc_provider import BoutOutcome, OddsLine

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"


def load(name: str) -> dict:
    with (RAW / name).open(encoding="utf-8") as f:
        return json.load(f)


def status_with(name: str, display_name: str, state: str = "post") -> dict:
    return {
        "period": 3,
        "displayClock": "5:00",
        "type": {"state": state},
        "result": {"name": name, "displayName": display_name},
    }


def test_parse_event_reads_the_card():
    card = parse_event(load("events/600061665.json"))
    assert card.name == "UFC Fight Night: Procházka vs. Stirling" and card.is_card is True
    main = next(b for b in card.bouts if b.provider_id == "401922277")
    assert main.weight_class == "Light Heavyweight" and main.scheduled_rounds == 5
    assert main.card_order == 1 and main.segment == "main" and main.segment_label == "Main Card"
    assert main.fighter_a.provider_id == "3156612" and main.fighter_b.provider_id == "5216713"
    assert main.scheduled_utc == datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)
    assert len(card.bouts) == 3


def test_event_times_are_min_and_max_of_bouts():
    card = parse_event(load("events/600062700.json"))
    assert card.first_bout_utc == datetime(2026, 12, 5, 15, 0, tzinfo=timezone.utc)
    assert card.last_bout_utc == datetime(2026, 12, 5, 18, 0, tzinfo=timezone.utc)


def test_competition_without_two_competitors_is_skipped():
    doc = load("events/600061665.json")
    doc["competitions"][0]["competitors"] = doc["competitions"][0]["competitors"][:1]
    card = parse_event(doc)
    assert [b.provider_id for b in card.bouts] == ["401927850", "401922278"]


def test_datetime_with_seconds_is_accepted():
    doc = load("events/600061665.json")
    doc["competitions"][0]["date"] = "2026-11-21T18:00:30Z"
    main = parse_event(doc).bouts[0]
    assert main.scheduled_utc == datetime(2026, 11, 21, 18, 0, 30, tzinfo=timezone.utc)


def test_outcome_of_a_knockout():
    bout = load("bouts/600061665_401922277.json")
    out = parse_outcome(bout["status"], False, True)
    assert (out.state, out.winner, out.method, out.round, out.clock) == ("final", "b", "ko_tko", 2, "4:58")
    assert out.method_detail == "Punch"


def test_winner_flags_by_id_in_feed_order():
    comp = find_competition(load("events/600061665.json"), "401922277")
    assert winner_flags_by_id(comp, "3156612", "5216713") == (False, True)
    assert competition_fighter_ids(comp) == frozenset({"3156612", "5216713"})


def test_winner_flags_by_id_follow_the_ids_when_flipped():
    comp = find_competition(load("events/600061665.json"), "401922277")
    assert winner_flags_by_id(comp, "5216713", "3156612") == (True, False)


def test_winner_flags_by_id_missing_competitor_and_flag():
    comp = {"competitors": [{"id": "1", "winner": True}, {"id": 2}]}
    assert winner_flags_by_id(comp, "1", "2") == (True, None)
    assert winner_flags_by_id(comp, "1", "9") == (True, None)
    assert winner_flags_by_id(comp, "8", "9") == (None, None)


def test_winner_flags_by_id_wrong_typed_input():
    for bad in (None, 3, "x", {"competitors": 3}, {"competitors": [3, None]}, {}):
        assert winner_flags_by_id(bad, "1", "2") == (None, None)
        assert competition_fighter_ids(bad) == frozenset()
    assert find_competition({"competitions": 3}, "1") is None
    assert find_competition(None, "1") is None


def test_outcome_of_a_decision_has_judges():
    bout = load("bouts/600061665_401927850.json")
    out = parse_outcome(bout["status"], False, True)
    assert (out.method, out.winner, out.round, out.clock) == ("decision", "b", 3, "5:00")
    block_a = bout["competitors"]["3031559"]
    block_b = bout["competitors"]["5145681"]
    stats_a = parse_stats(block_a["statistics"], block_a.get("linescores"))
    stats_b = parse_stats(block_b["statistics"], block_b.get("linescores"))
    assert stats_a.judges == (27, 28, 27) and stats_b.judges == (30, 29, 30)


def test_draw_and_no_contest_have_no_winner():
    draw = parse_outcome(status_with("draw", "Draw"), False, False)
    nc = parse_outcome(status_with("nocontest", "No Contest"), False, False)
    assert draw.method == "draw" and nc.method == "no_contest"
    assert draw.winner is None and nc.winner is None
    assert draw.state == "final" and nc.state == "final"


def test_scheduled_bout_is_pre_with_no_result():
    pre = {"period": 0, "displayClock": "-", "type": {"state": "pre"}}
    assert parse_outcome(pre, False, False) == BoutOutcome("pre", 0, "-", None, None, None)
    assert parse_outcome(None, None, None) is None


def test_in_progress_state_is_live():
    assert parse_outcome({"type": {"state": "in"}}, None, None).state == "live"


def test_normalise_method_vocabulary():
    cases = {
        "kotko": "ko_tko",
        "submission": "submission",
        "decision---unanimous": "decision",
        "dq": "dq",
        "disqualification": "dq",
        "draw": "draw",
        "nocontest": "no_contest",
        "technical---decision": "decision",
        "something odd": "other",
    }
    for name, expected in cases.items():
        assert normalise_method({"name": name}) == expected, name
    assert normalise_method({"name": "x", "displayName": "No Contest"}) == "no_contest"
    assert normalise_method({}) is None and normalise_method(None) is None


def test_stats_split_known_fields_from_extra():
    bout = load("bouts/600061665_401922277.json")
    block = bout["competitors"]["3156612"]
    stats = parse_stats(block["statistics"], block.get("linescores"))
    assert stats.knockdowns == 0 and stats.total_strikes_attempted == 48 and stats.total_strikes_landed == 26
    assert stats.sig_strikes_landed == 23 and stats.control_seconds == 18 and isinstance(stats.knockdowns, int)
    assert "sigDistanceLegStrikesLanded" in stats.extra and "totalStrikesLanded" not in stats.extra
    assert stats.judges == ()
    other = bout["competitors"]["5216713"]
    stats_b = parse_stats(other["statistics"], other.get("linescores"))
    assert stats_b.knockdowns == 1 and stats_b.total_strikes_landed == 51 and stats_b.total_strikes_attempted == 98


def test_empty_stat_block_is_none():
    assert parse_stats({"splits": {"categories": []}}, None) is None
    assert parse_stats(None, None) is None


def test_judges_without_stats_keep_the_scores():
    linescores = {"items": [{"linescores": [{"value": 29.0, "order": 2}, {"value": 30.0, "order": 1}]}]}
    stats = parse_stats({"splits": {"categories": []}}, linescores)
    assert stats.judges == (30, 29)
    assert stats.knockdowns is None and stats.total_strikes_attempted is None and stats.extra == {}


def test_odds_line_for_the_main_event():
    bout = load("bouts/600061665_401922277.json")
    assert parse_odds(bout["odds"], "3156612", "5216713") == [OddsLine("DraftKings", 180, -218)]
    assert parse_odds(bout["odds"], "5216713", "3156612") == [OddsLine("DraftKings", -218, 180)]
    assert parse_odds(bout["odds"], "1", "2") == []


def test_contender_series_is_not_a_card():
    doc = load("events/600061665.json")
    doc["name"] = "Dana White's Contender Series: Season 10, Week 1"
    assert parse_event(doc).is_card is False


def test_malformed_documents_return_none():
    assert parse_event({}) is None and parse_fighter(None) is None and parse_odds(None, "1", "2") == []
    assert parse_stats({"splits": "oops"}, {"items": "oops"}) is None
    assert parse_outcome({"type": {"state": "weird"}}, None, None) is None


def test_fighter_profile():
    p = parse_fighter(load("athletes/3156612.json"))
    assert (p.name, p.date_of_birth, p.height_in, p.reach_in, p.stance) == (
        "Jiří Procházka", date(1992, 10, 14), 75.0, 80.0, "Orthodox",
    )
    assert p.weight_lb == 205.0 and p.country == "Czechia" and p.gender == "MALE"


def test_wrong_typed_values_degrade_instead_of_raising():
    assert parse_stats({"splits": {"categories": [{"stats": 5}]}}, None) is None
    assert parse_stats({"splits": {"categories": 5}}, None) is None
    assert parse_stats(None, {"items": [{"linescores": 7}]}) is None
    assert parse_stats(None, {"items": 7}) is None
    assert parse_event({"id": "1", "name": "UFC X", "competitions": 5}).bouts == ()
    assert parse_event({"id": "1", "name": "UFC X", "competitions": [{"id": "2", "competitors": 5}]}).bouts == ()
    assert parse_odds({"items": 5}, "1", "2") == []
    assert parse_odds({"items": [5, {"awayAthleteOdds": 3}]}, "1", "2") == []


def test_unhashable_state_is_none():
    assert parse_outcome({"type": {"state": ["post"]}}, None, None) is None
    assert parse_outcome({"type": {"state": {"a": 1}}}, None, None) is None


def test_non_finite_numbers_are_ignored():
    nan, inf = float("nan"), float("inf")
    doc = load("events/600061665.json")
    doc["competitions"][0]["competitors"][0]["order"] = nan
    assert [b.provider_id for b in parse_event(doc).bouts] == ["401927850", "401922278"]
    stats = parse_stats(
        {"splits": {"categories": [{"stats": [
            {"name": "knockDowns", "value": nan},
            {"name": "totalStrikesAttempted", "value": inf},
            {"name": "totalStrikesLanded", "value": 3.0},
        ]}]}},
        None,
    )
    assert stats is None
    assert parse_outcome({"period": inf, "type": {"state": "post"}}, None, None).round is None


def test_huge_ints_are_ignored():
    huge = 10**400
    doc = load("events/600061665.json")
    doc["competitions"][0]["competitors"][0]["order"] = huge
    assert [b.provider_id for b in parse_event(doc).bouts] == ["401927850", "401922278"]
    stats = parse_stats(
        {"splits": {"categories": [{"stats": [{"name": "knockDowns", "value": huge}]}]}}, None
    )
    assert stats is None
    odds = load("bouts/600061665_401922277.json")["odds"]
    odds["items"][0]["homeAthleteOdds"]["moneyLine"] = huge
    assert parse_odds(odds, "3156612", "5216713") == []
    athlete = load("athletes/3156612.json")
    athlete["height"] = huge
    assert parse_fighter(athlete).height_in is None
    assert parse_outcome({"period": huge, "type": {"state": "post"}}, None, None).round is None


def test_extreme_datetime_is_none():
    doc = load("events/600061665.json")
    doc["competitions"][0]["date"] = "0001-01-01T00:00:00+05:00"
    assert parse_event(doc).bouts[0].scheduled_utc is None


def _cancelled_status(name: str, state: str = "post", completed: bool | None = False) -> dict:
    type_doc: dict = {"name": name, "state": state}
    if completed is not None:
        type_doc["completed"] = completed
    return {"period": 0, "displayClock": "0:00", "type": type_doc, "result": {}}


def test_cancelled_status_parses_as_cancelled():
    out = parse_outcome(_cancelled_status("STATUS_CANCELED"), None, None)
    assert out.state == "cancelled"
    assert (out.winner, out.method, out.method_detail) == (None, None, None)


def test_postponed_status_parses_as_cancelled():
    out = parse_outcome(_cancelled_status("STATUS_POSTPONED", state="pre", completed=None), None, None)
    assert out.state == "cancelled"
    assert (out.winner, out.method, out.method_detail) == (None, None, None)


def test_post_and_not_completed_parses_as_cancelled():
    out = parse_outcome(_cancelled_status("STATUS_SOMETHING_NEW"), False, False)
    assert out.state == "cancelled"


def test_normal_final_is_not_cancelled():
    doc = status_with("kotko", "KO/TKO")
    doc["type"].update({"name": "STATUS_FINAL", "completed": True})
    assert parse_outcome(doc, True, False).state == "final"
    assert parse_outcome(status_with("kotko", "KO/TKO"), True, False).state == "final"


def test_int_is_capped_at_the_postgres_integer_range():
    from pipeline.sports.ufc_espn_parse import _int

    assert _int(2**31) is None
    assert _int(-(2**31)) is None
    assert _int(2**31 - 1) == 2**31 - 1
    assert _int(-(2**31 - 1)) == -(2**31 - 1)
