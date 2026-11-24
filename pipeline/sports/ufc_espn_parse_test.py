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
