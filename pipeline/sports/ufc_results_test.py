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
