"""Tests for pipeline/sports/ufc_recorded.py against the recorded fixtures."""
from __future__ import annotations

from datetime import date, datetime, timezone
from pathlib import Path

from pipeline.sports.ufc_provider import BoutOutcome, OddsLine
from pipeline.sports.ufc_recorded import RecordedUfcProvider

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"


def test_lists_events_in_a_date_window():
    p = RecordedUfcProvider(RAW)
    assert p.name == "espn"
    assert p.list_event_ids(date(2026, 11, 1), date(2026, 11, 30)) == ["600061665"]
    assert "600062700" in p.list_event_ids(date(2026, 12, 1), date(2026, 12, 31))
    assert p.list_event_ids(date(2025, 1, 1), date(2025, 1, 31)) == []


def test_upcoming_card_has_two_segments():
    card = RecordedUfcProvider(RAW).fetch_event("600062700")
    assert {b.segment for b in card.bouts} == {"main", "prelims1"}
    assert card.first_bout_utc == datetime(2026, 12, 5, 15, 0, tzinfo=timezone.utc)
    assert card.last_bout_utc.hour == 18


def test_fetches_through_the_same_parsers():
    p = RecordedUfcProvider(RAW)
    card = p.fetch_event("600061665")
    main = next(b for b in card.bouts if b.provider_id == "401922277")
    assert p.fetch_outcome("600061665", main).winner == "b"
    assert set(p.fetch_stats("600061665", main)) == {"a", "b"}
    assert p.fetch_odds("600061665", main) == [OddsLine("DraftKings", 180, -218)]
    assert p.fetch_fighter("3156612").name == "Jiří Procházka"
    decision = next(b for b in card.bouts if b.provider_id == "401927850")
    assert p.fetch_stats("600061665", decision)["a"].judges == (27, 28, 27)


def test_missing_files_are_not_errors():
    p = RecordedUfcProvider(RAW)
    assert p.fetch_event("nope") is None and p.fetch_fighter("nope") is None
    upcoming = p.fetch_event("600062700").bouts[0]
    assert p.fetch_outcome("600062700", upcoming) == BoutOutcome("pre", None, None, None, None, None)
    assert p.fetch_stats("600062700", upcoming) == {} and p.fetch_odds("600062700", upcoming) == []
    assert p.fetch_outcome("nope", upcoming) is None


def test_outcome_credits_winner_by_fighter_id_not_feed_order():
    from dataclasses import replace

    p = RecordedUfcProvider(RAW)
    main = next(b for b in p.fetch_event("600061665").bouts if b.provider_id == "401922277")
    flipped = replace(main, fighter_a=main.fighter_b, fighter_b=main.fighter_a)
    assert p.fetch_outcome("600061665", main).winner == "b"
    assert p.fetch_outcome("600061665", flipped).winner == "a"  # Navajo Stirling, 5216713


def test_outcome_none_when_recorded_pair_differs_from_card():
    from dataclasses import replace

    p = RecordedUfcProvider(RAW)
    main = next(b for b in p.fetch_event("600061665").bouts if b.provider_id == "401922277")
    other = replace(main, fighter_b=replace(main.fighter_b, provider_id="999"))
    assert p.fetch_outcome("600061665", other) is None


def _write_event(raw, event_id, when):
    (raw / "events" / f"{event_id}.json").write_text(f'{{"date": "{when}"}}', encoding="utf-8")


def test_events_are_listed_by_date_then_id_not_by_filename(tmp_path):
    import shutil

    raw = tmp_path / "raw"
    shutil.copytree(RAW, raw)
    _write_event(raw, "99", "2020-03-01T00:00Z")
    _write_event(raw, "1000", "2021-03-01T00:00Z")
    _write_event(raw, "5", "2021-03-01T00:00Z")
    ids = RecordedUfcProvider(raw).list_event_ids(date(2020, 1, 1), date(2021, 12, 31))
    assert ids == ["99", "1000", "5"]


def test_unreadable_event_file_is_listed_after_the_dated_ones(tmp_path):
    import shutil

    raw = tmp_path / "raw"
    shutil.copytree(RAW, raw)
    path = raw / "events" / "600061665.json"
    path.write_text(path.read_text()[:30], encoding="utf-8")
    p = RecordedUfcProvider(raw)
    assert p.list_event_ids(date(2026, 12, 1), date(2026, 12, 31)) == ["600062700", "600061665"]
    assert p.list_event_ids(date(2020, 1, 1), date(2020, 1, 2)) == ["600061665"]
    assert p.fetch_event("600061665") is None
