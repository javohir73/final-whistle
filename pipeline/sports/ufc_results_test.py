"""Tests for UFC results, stats and odds (task-5-brief.md)."""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select

from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter, UfcOddsSnapshot
from pipeline.sports.ufc_ingest import ingest_window, upsert_event
from pipeline.sports.ufc_provider import (
    BoutCard,
    BoutOutcome,
    EventCard,
    FighterBoutStats,
    FighterRef,
    OddsLine,
)
from pipeline.sports.ufc_recorded import RecordedUfcProvider
from pipeline.sports.ufc_results import (
    ResultsSummary,
    apply_outcome,
    ensure_profiles,
    record_odds,
    record_stats,
    refresh_results,
    roll_up_event,
)

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"
EVENT = "600061665"
AFTER_CARD = datetime(2026, 11, 22, tzinfo=timezone.utc)
T0 = datetime(2026, 11, 21, 18, 0, tzinfo=timezone.utc)


def _utc(dt):
    return dt.replace(tzinfo=timezone.utc) if dt is not None and dt.tzinfo is None else dt


def _provider() -> RecordedUfcProvider:
    return RecordedUfcProvider(RAW)


def _ingested(db) -> RecordedUfcProvider:
    provider = _provider()
    ingest_window(db, provider, date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    return provider


def _bout(db, provider_bout_id: str) -> UfcBout:
    return db.scalar(select(UfcBout).where(UfcBout.provider_bout_id == provider_bout_id))


def _count(db, model) -> int:
    return db.query(model).count()


def _bare_bout(db, bouts=(("b1", "scheduled"),), when=T0, event_id="e1") -> list[UfcBout]:
    """Bouts built through the real ingest path, then set to the wanted status."""
    cards = tuple(
        BoutCard(
            provider_id=bid, card_order=i, segment="main", segment_label="Main Card",
            weight_class="Lightweight", scheduled_rounds=3, scheduled_utc=when,
            fighter_a=FighterRef(f"{bid}-a", f"A {bid}"), fighter_b=FighterRef(f"{bid}-b", f"B {bid}"),
        )
        for i, (bid, _) in enumerate(bouts, 1)
    )
    card = EventCard(
        provider_id=event_id, name="UFC Test Night", first_bout_utc=when, last_bout_utc=when,
        venue="Arena", is_card=True, bouts=cards,
    )
    upsert_event(db, "espn", card, now=AFTER_CARD)
    rows = [_bout(db, bid) for bid, _ in bouts]
    for row, (_, status) in zip(rows, bouts):
        row.status = status
    db.flush()
    return rows


KO = BoutOutcome("final", 2, "4:58", "b", "ko_tko", "Punch")


class FailingOutcomeProvider(RecordedUfcProvider):
    def __init__(self, *args, fail_bout: str, **kwargs):
        super().__init__(*args, **kwargs)
        self.fail_bout = fail_bout

    def fetch_outcome(self, event_id, bout):
        if bout.provider_id == self.fail_bout:
            raise RuntimeError("boom")
        return super().fetch_outcome(event_id, bout)


class CountingOutcomeProvider(RecordedUfcProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.outcome_calls: list[str] = []

    def fetch_outcome(self, event_id, bout):
        self.outcome_calls.append(bout.provider_id)
        return super().fetch_outcome(event_id, bout)


def test_knockout_is_recorded(db_session):
    provider = _ingested(db_session)
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    bout = _bout(db_session, "401922277")
    assert bout.status == "finished"
    assert (bout.winner, bout.method, bout.end_round, bout.end_clock) == ("b", "ko_tko", 2, "4:58")
    assert bout.method_detail
    assert bout.locked_at is not None
    assert summary.finished == 3 and summary.failed == 0


def test_stats_and_judges_are_stored(db_session):
    provider = _ingested(db_session)
    refresh_results(db_session, provider, now=AFTER_CARD)
    decision = _bout(db_session, "401927850")
    rows = db_session.scalars(select(UfcBoutStat).where(UfcBoutStat.bout_id == decision.id)).all()
    assert len(rows) == 2
    by_fighter = {r.fighter_id: r for r in rows}
    assert list(by_fighter[decision.fighter_a_id].judges) == [27, 28, 27]
    assert list(by_fighter[decision.fighter_b_id].judges) == [30, 29, 30]
    ko = _bout(db_session, "401922277")
    ko_a = db_session.scalar(
        select(UfcBoutStat).where(UfcBoutStat.bout_id == ko.id, UfcBoutStat.fighter_id == ko.fighter_a_id)
    )
    assert (ko_a.knockdowns, ko_a.total_strikes_landed, ko_a.total_strikes_attempted) == (0, 26, 48)


def test_record_stats_upserts(db_session):
    provider = _ingested(db_session)
    bout = _bout(db_session, "401922277")
    stats = provider.fetch_stats(EVENT, _card_for(db_session, bout))
    assert record_stats(db_session, bout, stats) == 2
    assert record_stats(db_session, bout, stats) == 2
    assert _count(db_session, UfcBoutStat) == 2


def _card_for(db, bout):
    from pipeline.sports.ufc_results import bout_card

    return bout_card(db, bout)


def test_odds_snapshot_is_stored_once(db_session):
    provider = _ingested(db_session)
    bout = _bout(db_session, "401922277")
    lines = provider.fetch_odds(EVENT, _card_for(db_session, bout))
    assert lines
    assert record_odds(db_session, bout, lines) == len(lines)
    assert record_odds(db_session, bout, lines) == 0
    sources = [s.source for s in db_session.scalars(select(UfcOddsSnapshot))]
    assert len(sources) == len(set(sources)) == len(lines)
    ml = {s.source: (s.moneyline_a, s.moneyline_b) for s in db_session.scalars(select(UfcOddsSnapshot))}
    assert ml["DraftKings"] == (180, -218)


def test_odds_that_return_to_an_earlier_price_are_stored_again(db_session):
    (bout,) = _bare_bout(db_session)
    a, b = OddsLine("DK", 100, -120), OddsLine("DK", 110, -130)
    assert record_odds(db_session, bout, [a]) == 1
    assert record_odds(db_session, bout, [b]) == 1
    assert record_odds(db_session, bout, [a]) == 1
    assert _count(db_session, UfcOddsSnapshot) == 3


def test_draw_and_no_contest_finish_without_a_winner(db_session):
    draw_bout, nc_bout = _bare_bout(db_session, (("d", "scheduled"), ("n", "live")))
    assert apply_outcome(db_session, draw_bout, BoutOutcome("final", 3, "5:00", None, "draw", None), now=AFTER_CARD)
    assert apply_outcome(db_session, nc_bout, BoutOutcome("final", 1, "2:10", None, "no_contest", "Eye poke"), now=AFTER_CARD)
    for row, method in ((draw_bout, "draw"), (nc_bout, "no_contest")):
        assert (row.status, row.winner, row.method) == ("finished", None, method)


def test_live_outcome_locks_the_bout(db_session):
    (bout,) = _bare_bout(db_session)
    assert bout.locked_at is None
    assert apply_outcome(db_session, bout, BoutOutcome("live", 1, "3:00", None, None, None), now=AFTER_CARD)
    assert bout.status == "live"
    assert _utc(bout.locked_at) == AFTER_CARD
    # a later live tick changes nothing and keeps the first lock time
    later = AFTER_CARD + timedelta(minutes=5)
    assert not apply_outcome(db_session, bout, BoutOutcome("live", 2, "1:00", None, None, None), now=later)
    assert _utc(bout.locked_at) == AFTER_CARD


def test_finished_is_never_reopened(db_session):
    (bout,) = _bare_bout(db_session)
    assert apply_outcome(db_session, bout, KO, now=AFTER_CARD)
    for outcome in (
        BoutOutcome("pre", None, None, None, None, None),
        BoutOutcome("live", 1, "1:00", None, None, None),
    ):
        assert apply_outcome(db_session, bout, outcome, now=AFTER_CARD) is False
        assert (bout.status, bout.winner, bout.method) == ("finished", "b", "ko_tko")
    # another final that carries a method may correct the result
    fix = BoutOutcome("final", 2, "4:58", "a", "ko_tko", "Punch")
    assert apply_outcome(db_session, bout, fix, now=AFTER_CARD)
    assert bout.winner == "a"


def test_finished_without_method_does_not_blank_a_result(db_session):
    (bout,) = _bare_bout(db_session)
    apply_outcome(db_session, bout, KO, now=AFTER_CARD)
    blank = BoutOutcome("final", None, None, None, None, None)
    assert apply_outcome(db_session, bout, blank, now=AFTER_CARD) is False
    assert (bout.winner, bout.method, bout.end_round, bout.end_clock) == ("b", "ko_tko", 2, "4:58")


def test_cancelled_and_changed_rows_are_skipped(db_session):
    cancelled, changed = _bare_bout(db_session, (("c", "cancelled"), ("x", "changed")))
    for row in (cancelled, changed):
        before = row.status
        assert apply_outcome(db_session, row, KO, now=AFTER_CARD) is False
        assert row.status == before and row.winner is None and row.locked_at is None


def test_event_rolls_up_to_finished(db_session):
    one, two = _bare_bout(db_session, (("b1", "scheduled"), ("b2", "scheduled")))
    event = db_session.get(UfcEvent, one.event_id)
    roll_up_event(db_session, event)
    assert event.status == "scheduled"
    apply_outcome(db_session, one, KO, now=AFTER_CARD)
    roll_up_event(db_session, event)
    assert event.status == "live"
    apply_outcome(db_session, two, KO, now=AFTER_CARD)
    roll_up_event(db_session, event)
    assert event.status == "finished"


def test_event_rollup_ignores_cancelled_and_changed_bouts(db_session):
    one, gone, swapped = _bare_bout(
        db_session, (("b1", "finished"), ("b2", "cancelled"), ("b3", "changed"))
    )
    event = db_session.get(UfcEvent, one.event_id)
    roll_up_event(db_session, event)
    assert event.status == "finished"


def test_event_rollup_live_when_a_bout_is_live(db_session):
    one, two = _bare_bout(db_session, (("b1", "live"), ("b2", "scheduled")))
    event = db_session.get(UfcEvent, one.event_id)
    roll_up_event(db_session, event)
    assert event.status == "live"


def test_future_bouts_are_not_fetched_for_results(db_session):
    provider = CountingOutcomeProvider(RAW)
    ingest_window(db_session, provider, date(2026, 12, 4), date(2026, 12, 6), now=AFTER_CARD)
    assert _count(db_session, UfcBout) == 3
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert provider.outcome_calls == []
    assert summary.checked == 0


def test_profiles_are_filled(db_session):
    provider = _provider()
    card = provider.fetch_event(EVENT)
    upsert_event(db_session, "espn", card, now=AFTER_CARD)  # leaves fighters TBA, no birth date
    fighter = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "3156612"))
    assert fighter.date_of_birth is None
    assert ensure_profiles(db_session, provider, limit=40) == 6
    assert fighter.date_of_birth == date(1992, 10, 14)
    assert fighter.name != "TBA"
    assert ensure_profiles(db_session, provider, limit=40) == 0


def test_profiles_respect_the_limit(db_session):
    provider = _provider()
    upsert_event(db_session, "espn", provider.fetch_event(EVENT), now=AFTER_CARD)
    assert ensure_profiles(db_session, provider, limit=2) == 2


def test_provider_failure_on_one_bout_is_counted_not_raised(db_session):
    provider = FailingOutcomeProvider(RAW, fail_bout="401922277")
    ingest_window(db_session, provider, date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert summary.failed == 1
    assert summary.finished == 2
    assert _bout(db_session, "401922277").status == "scheduled"
    assert _bout(db_session, "401927850").status == "finished"


def test_outcome_none_means_nothing_to_apply(db_session):
    class Untrusted(RecordedUfcProvider):
        def fetch_outcome(self, event_id, bout):
            return None

    provider = Untrusted(RAW)
    ingest_window(db_session, provider, date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert summary == ResultsSummary(checked=3, profiles=summary.profiles)
    assert _bout(db_session, "401922277").status == "scheduled"


def test_second_run_is_a_no_op(db_session):
    provider = _ingested(db_session)
    first = refresh_results(db_session, provider, now=AFTER_CARD)
    assert first.finished == 3
    counts = (_count(db_session, UfcBoutStat), _count(db_session, UfcOddsSnapshot))
    second = refresh_results(db_session, provider, now=AFTER_CARD)
    assert second.finished == 0
    assert (_count(db_session, UfcBoutStat), _count(db_session, UfcOddsSnapshot)) == counts
    assert db_session.scalar(select(UfcEvent)).status == "finished"


def test_finished_bout_without_stats_is_retried_for_three_days(db_session):
    (bout,) = _bare_bout(db_session, (("b1", "finished"),), when=AFTER_CARD - timedelta(days=1))
    provider = CountingOutcomeProvider(RAW)
    refresh_results(db_session, provider, now=AFTER_CARD)
    assert provider.outcome_calls == ["b1"]
    bout.scheduled_utc = AFTER_CARD - timedelta(days=4)
    db_session.flush()
    provider.outcome_calls.clear()
    refresh_results(db_session, provider, now=AFTER_CARD)
    assert provider.outcome_calls == []


def test_winner_follows_the_stored_fighter_not_the_feed_order(db_session):
    provider = _ingested(db_session)
    bout = _bout(db_session, "401922277")
    bout.fighter_a_id, bout.fighter_b_id = bout.fighter_b_id, bout.fighter_a_id
    db_session.commit()
    refresh_results(db_session, provider, now=AFTER_CARD)
    bout = _bout(db_session, "401922277")
    stirling = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "5216713"))
    assert bout.fighter_a_id == stirling.id
    assert bout.winner == "a"
    row = db_session.scalar(
        select(UfcBoutStat).where(UfcBoutStat.bout_id == bout.id, UfcBoutStat.fighter_id == stirling.id)
    )
    assert row.knockdowns == 1


def test_later_final_that_changes_winner_or_method_is_logged(db_session, caplog):
    (bout,) = _bare_bout(db_session)
    apply_outcome(db_session, bout, KO, now=AFTER_CARD)
    caplog.clear()
    with caplog.at_level("WARNING"):
        assert apply_outcome(
            db_session, bout, BoutOutcome("final", 2, "4:58", "a", "ko_tko", "Punch"), now=AFTER_CARD
        )
    assert any("b1" in r.getMessage() and "ko_tko" in r.getMessage() for r in caplog.records)


def test_later_final_cannot_leave_a_finished_bout_without_a_winner(db_session, caplog):
    (bout,) = _bare_bout(db_session)
    apply_outcome(db_session, bout, KO, now=AFTER_CARD)
    with caplog.at_level("WARNING"):
        assert apply_outcome(
            db_session, bout, BoutOutcome("final", 2, "4:58", None, "ko_tko", None), now=AFTER_CARD
        ) is False
    assert (bout.winner, bout.method) == ("b", "ko_tko")
    assert caplog.records
    # a genuine draw correction is allowed
    assert apply_outcome(db_session, bout, BoutOutcome("final", 3, "5:00", None, "draw", None), now=AFTER_CARD)
    assert (bout.winner, bout.method) == (None, "draw")


def test_later_final_never_blanks_round_clock_or_detail(db_session):
    (bout,) = _bare_bout(db_session)
    apply_outcome(db_session, bout, KO, now=AFTER_CARD)
    apply_outcome(db_session, bout, BoutOutcome("final", None, None, "a", "ko_tko", None), now=AFTER_CARD)
    assert bout.winner == "a"
    assert (bout.end_round, bout.end_clock, bout.method_detail) == (2, "4:58", "Punch")


def test_missed_roll_up_heals_on_the_next_run(db_session):
    one, two = _bare_bout(db_session, (("b1", "finished"), ("b2", "finished")), when=AFTER_CARD - timedelta(days=10))
    event = db_session.get(UfcEvent, one.event_id)
    event.status = "live"
    db_session.commit()
    refresh_results(db_session, _provider(), now=AFTER_CARD)
    assert db_session.get(UfcEvent, event.id).status == "finished"


class _NoDobProvider(RecordedUfcProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.calls: list[str] = []
        self.none_for: set[str] = set()
        self.raise_for: set[str] = set()

    def fetch_fighter(self, fighter_id):
        self.calls.append(fighter_id)
        if fighter_id in self.raise_for:
            raise RuntimeError("boom")
        if fighter_id in self.none_for:
            return None
        from dataclasses import replace

        profile = super().fetch_fighter(fighter_id)
        return replace(profile, date_of_birth=None) if profile else None


def _tba_card(db, provider):
    upsert_event(db, "espn", provider.fetch_event(EVENT), now=AFTER_CARD)


def test_fighter_without_dob_is_fetched_once_then_again_after_31_days(db_session):
    provider = _NoDobProvider(RAW)
    _tba_card(db_session, provider)
    assert ensure_profiles(db_session, provider, now=AFTER_CARD) == 6  # named: real change
    assert len(provider.calls) == 6
    assert ensure_profiles(db_session, provider, now=AFTER_CARD + timedelta(days=1)) == 0
    assert len(provider.calls) == 6
    assert ensure_profiles(db_session, provider, now=AFTER_CARD + timedelta(days=31)) == 0  # fetched, nothing changed
    assert len(provider.calls) == 12


def test_none_profile_is_not_retried_next_run(db_session):
    provider = _NoDobProvider(RAW)
    provider.none_for = {"3156612"}
    _tba_card(db_session, provider)
    assert ensure_profiles(db_session, provider, now=AFTER_CARD) == 5
    provider.calls.clear()
    ensure_profiles(db_session, provider, now=AFTER_CARD + timedelta(days=1))
    assert provider.calls == []
    fighter = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "3156612"))
    assert fighter.profile_checked_at is not None


def test_one_profile_failure_does_not_stop_the_others(db_session):
    provider = _NoDobProvider(RAW)
    provider.raise_for = {"3156612"}
    ingest_window(db_session, _provider(), date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    # strip dobs so every fighter is a candidate, and roll-up must still happen
    for f in db_session.scalars(select(UfcFighter)):
        f.date_of_birth = None
        f.profile_checked_at = None
    db_session.commit()
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert summary.failed == 1
    assert summary.profiles == 0
    assert db_session.scalar(select(UfcEvent)).status == "finished"


def test_process_bout_is_public_and_records_odds_for_unfinished_bouts_on_request(db_session):
    from pipeline.sports.ufc_results import process_bout

    provider = _provider()
    ingest_window(db_session, provider, date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    bout = _bout(db_session, "401922277")
    summary = ResultsSummary()
    process_bout(db_session, provider, bout, summary, AFTER_CARD)
    assert bout.status == "finished" and summary.finished == 1 and summary.stats == 2
    assert summary.odds == 1


def test_process_bout_odds_always_covers_a_bout_that_has_not_finished(db_session):
    from pipeline.sports.ufc_results import process_bout

    class PreWithOdds(RecordedUfcProvider):
        def fetch_odds(self, event_id, bout):
            return [OddsLine("DraftKings", -150, 130)]

    provider = PreWithOdds(RAW)
    ingest_window(db_session, provider, date(2026, 12, 4), date(2026, 12, 6), now=AFTER_CARD)
    bout = _bout(db_session, "401933595")
    quiet = ResultsSummary()
    process_bout(db_session, provider, bout, quiet, AFTER_CARD)
    assert quiet.odds == 0
    loud = ResultsSummary()
    process_bout(db_session, provider, bout, loud, AFTER_CARD, odds_always=True)
    assert loud.odds == 1 and bout.status == "scheduled"


def test_record_odds_taken_at_stamps_the_snapshot(db_session):
    bout = _bare_bout(db_session)[0]
    when = datetime(2020, 1, 1, tzinfo=timezone.utc)
    assert record_odds(db_session, bout, [OddsLine("DraftKings", -150, 130)], taken_at=when) == 1
    row = db_session.scalar(select(UfcOddsSnapshot))
    assert _utc(row.taken_at) == when


def test_fill_profiles_fighter_ids_restricts_candidates(db_session):
    from pipeline.sports.ufc_results import fill_profiles

    provider = _NoDobProvider(RAW)
    _tba_card(db_session, provider)
    only = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "3156612"))
    changed, failed = fill_profiles(db_session, provider, now=AFTER_CARD, fighter_ids={only.id})
    assert (changed, failed) == (1, 0)
    assert provider.calls == ["3156612"]


def test_stale_scheduled_bouts_are_not_fetched_forever(db_session):
    from pipeline.sports.ufc_results import RESULTS_LOOKBACK

    assert RESULTS_LOOKBACK == timedelta(days=14)
    old = _bare_bout(db_session, (("old", "scheduled"),), when=AFTER_CARD - timedelta(days=30), event_id="e-old")[0]
    recent = _bare_bout(db_session, (("recent", "scheduled"),), when=AFTER_CARD - timedelta(days=3), event_id="e-new")[0]
    provider = CountingOutcomeProvider(RAW)
    refresh_results(db_session, provider, now=AFTER_CARD)
    assert "old" not in provider.outcome_calls
    assert "recent" in provider.outcome_calls


def test_failure_warnings_do_not_leak_the_exception_text(db_session, caplog):
    import logging

    class Leaky(RecordedUfcProvider):
        def fetch_outcome(self, event_id, bout):
            raise RuntimeError("SECRET-MARKER-123")

    provider = Leaky(RAW)
    ingest_window(db_session, provider, date(2026, 11, 20), date(2026, 11, 22), now=AFTER_CARD)
    with caplog.at_level(logging.DEBUG):
        summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert summary.failed == 3
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings and not any("SECRET-MARKER-123" in m for m in warnings)
    assert any("RuntimeError" in m for m in warnings)


def test_bouts_older_than_the_lookback_get_no_provider_call_of_any_kind(db_session):
    class Spy(RecordedUfcProvider):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, **kwargs)
            self.calls: list[tuple[str, str]] = []

        def fetch_outcome(self, event_id, bout):
            self.calls.append(("outcome", bout.provider_id))
            return super().fetch_outcome(event_id, bout)

        def fetch_stats(self, event_id, bout):
            self.calls.append(("stats", bout.provider_id))
            return super().fetch_stats(event_id, bout)

        def fetch_odds(self, event_id, bout):
            self.calls.append(("odds", bout.provider_id))
            return super().fetch_odds(event_id, bout)

    _bare_bout(db_session, (("old", "scheduled"),), when=AFTER_CARD - timedelta(days=30), event_id="e-old")
    _bare_bout(db_session, (("recent", "scheduled"),), when=AFTER_CARD - timedelta(days=3), event_id="e-new")
    _bare_bout(db_session, (("soon", "scheduled"),), when=AFTER_CARD + timedelta(days=2), event_id="e-soon")
    provider = Spy(RAW)
    refresh_results(db_session, provider, now=AFTER_CARD)
    assert [c for c in provider.calls if c[1] == "old"] == []
    assert ("outcome", "recent") in provider.calls
    assert ("odds", "soon") in provider.calls


CANCELLED = BoutOutcome("cancelled", None, None, None, None, None)


def test_cancelled_outcome_cancels_a_scheduled_row(db_session):
    (bout,) = _bare_bout(db_session)
    assert apply_outcome(db_session, bout, CANCELLED, now=AFTER_CARD) is True
    assert bout.status == "cancelled" and bout.method_detail == "cancelled by feed"
    assert bout.winner is None and bout.method is None
    assert apply_outcome(db_session, bout, CANCELLED, now=AFTER_CARD) is False  # now untouchable


def test_cancelled_outcome_cancels_a_live_row(db_session):
    (bout,) = _bare_bout(db_session, (("b1", "live"),))
    assert apply_outcome(db_session, bout, CANCELLED, now=AFTER_CARD) is True
    assert bout.status == "cancelled"


def test_cancelled_outcome_never_touches_finished_cancelled_or_changed(db_session):
    finished, cancelled, changed = _bare_bout(
        db_session, (("f", "finished"), ("c", "cancelled"), ("x", "changed"))
    )
    finished.winner, finished.method, finished.method_detail = "a", "decision", "Unanimous"
    for row in (finished, cancelled, changed):
        before = (row.status, row.winner, row.method, row.method_detail)
        assert apply_outcome(db_session, row, CANCELLED, now=AFTER_CARD) is False
        assert (row.status, row.winner, row.method, row.method_detail) == before


def test_event_rolls_up_to_finished_when_the_other_bout_was_cancelled_by_the_feed(db_session):
    one, two = _bare_bout(db_session, (("b1", "scheduled"), ("b2", "scheduled")))
    event = db_session.get(UfcEvent, one.event_id)
    apply_outcome(db_session, one, KO, now=AFTER_CARD)
    apply_outcome(db_session, two, CANCELLED, now=AFTER_CARD)
    roll_up_event(db_session, event)
    assert (one.status, two.status, event.status) == ("finished", "cancelled", "finished")


class _ProfileCountingProvider(RecordedUfcProvider):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fighter_calls: list[str] = []

    def fetch_fighter(self, fighter_id):
        self.fighter_calls.append(fighter_id)
        return super().fetch_fighter(fighter_id)


def test_refresh_results_skips_profiles_of_retired_fighters(db_session):
    _bare_bout(db_session, (("old", "finished"),), when=AFTER_CARD - timedelta(days=3000), event_id="e-old")
    _bare_bout(db_session, (("soon", "scheduled"),), when=AFTER_CARD + timedelta(days=7), event_id="e-soon")
    _bare_bout(db_session, (("far", "scheduled"),), when=AFTER_CARD + timedelta(days=90), event_id="e-far")
    _bare_bout(db_session, (("gone", "cancelled"),), when=AFTER_CARD + timedelta(days=7), event_id="e-gone")
    provider = _ProfileCountingProvider(RAW)
    refresh_results(db_session, provider, now=AFTER_CARD)
    assert sorted(provider.fighter_calls) == ["soon-a", "soon-b"]


def test_clipped_text_fits_the_postgres_columns(db_session):
    from pipeline.sports.ufc_ingest import _clip

    assert _clip(None, 5) is None and _clip("abcdef", 5) == "abcde" and _clip("abc", 5) == "abc"
    (bout,) = _bare_bout(db_session)
    long_outcome = BoutOutcome("final", 1, "x" * 30, "a", "m" * 50, "d" * 400)
    apply_outcome(db_session, bout, long_outcome, now=AFTER_CARD)
    assert len(bout.method_detail) == 120 and len(bout.method) == 20 and len(bout.end_clock) == 8
    record_odds(db_session, bout, [OddsLine("S" * 100, -150, 130)])
    assert len(db_session.scalar(select(UfcOddsSnapshot)).source) == 40


def test_results_main_exit_codes(monkeypatch):
    import app.db
    import pipeline.sports.ufc_provider as prov
    from pipeline.sports import ufc_results

    class _Db:
        def close(self):
            pass

    monkeypatch.setattr(app.db, "SessionLocal", lambda: _Db())
    monkeypatch.setattr(prov, "get_provider", lambda name=None: object())

    def run(summary):
        monkeypatch.setattr(ufc_results, "refresh_results", lambda db, provider: summary)
        return ufc_results.main([])

    assert run(ResultsSummary(checked=3, failed=3, bouts_failed=3)) == 1
    assert run(ResultsSummary(checked=1, failed=4, bouts_failed=1)) == 1
    assert run(ResultsSummary(checked=0, failed=1, bouts_failed=0)) == 0  # quiet day, a profile or odds step failed
    assert run(ResultsSummary(checked=3, failed=5, bouts_failed=2)) == 0  # one due bout succeeded
    assert run(ResultsSummary(checked=0, failed=0)) == 0


def test_upcoming_odds_failure_is_not_a_bout_failure(db_session):
    _bare_bout(db_session, when=AFTER_CARD + timedelta(days=2))

    class OddsBoom(RecordedUfcProvider):
        def fetch_odds(self, event_id, bout):
            raise RuntimeError("boom")

    summary = refresh_results(db_session, OddsBoom(RAW), now=AFTER_CARD)
    assert (summary.failed, summary.bouts_failed, summary.checked) == (1, 0, 0)


def test_due_bout_failure_counts_as_a_bout_failure(db_session):
    _bare_bout(db_session, when=AFTER_CARD - timedelta(hours=1))
    provider = FailingOutcomeProvider(RAW, fail_bout="b1")
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert (summary.checked, summary.bouts_failed) == (1, 1)


class _PreProvider:
    name = "espn"

    def fetch_outcome(self, event_id, bout):
        return BoutOutcome("pre", None, None, None, None, None)


def _reinstate(db, bout, new_start, now):
    from pipeline.sports.ufc_ingest import IngestSummary, reinstate_feed_cancelled

    card = EventCard(
        provider_id="e1", name="UFC Test Night", first_bout_utc=new_start, last_bout_utc=new_start,
        venue="Arena", is_card=True,
        bouts=(BoutCard(
            provider_id="b1", card_order=1, segment="main", segment_label="Main Card",
            weight_class="Lightweight", scheduled_rounds=3, scheduled_utc=new_start,
            fighter_a=FighterRef("b1-a", "A b1"), fighter_b=FighterRef("b1-b", "B b1"),
        ),),
    )
    return reinstate_feed_cancelled(db, _PreProvider(), card, now, IngestSummary())


def test_feed_cancel_after_the_start_locks_and_does_not_come_back(db_session):
    (bout,) = _bare_bout(db_session)
    assert apply_outcome(db_session, bout, CANCELLED, now=T0 + timedelta(minutes=10)) is True
    assert _utc(bout.locked_at) == T0
    later = T0 + timedelta(days=7)
    assert _reinstate(db_session, bout, later, T0 + timedelta(minutes=20)) == 0
    assert (bout.status, _utc(bout.scheduled_utc)) == ("cancelled", T0)


def test_feed_cancel_before_the_start_can_still_return(db_session):
    (bout,) = _bare_bout(db_session)
    assert apply_outcome(db_session, bout, CANCELLED, now=T0 - timedelta(hours=2)) is True
    assert bout.locked_at is None
    later = T0 + timedelta(days=7)
    assert _reinstate(db_session, bout, later, T0 - timedelta(hours=1)) == 1
    assert (bout.status, bout.locked_at, _utc(bout.scheduled_utc)) == ("scheduled", None, later)


def test_feed_cancel_without_a_stored_start_gets_no_stamp(db_session):
    (bout,) = _bare_bout(db_session)
    bout.scheduled_utc = None
    assert apply_outcome(db_session, bout, CANCELLED, now=T0 + timedelta(hours=1)) is True
    assert bout.locked_at is None


def test_feed_cancelled_before_the_start_stays_locked_if_it_returns_after_that_start(db_session):
    (bout,) = _bare_bout(db_session)
    assert apply_outcome(db_session, bout, CANCELLED, now=T0 - timedelta(hours=2)) is True
    assert bout.locked_at is None
    later = T0 + timedelta(days=7)
    assert _reinstate(db_session, bout, later, T0 + timedelta(minutes=10)) == 0
    assert (bout.status, _utc(bout.locked_at), _utc(bout.scheduled_utc)) == ("cancelled", T0, T0)
