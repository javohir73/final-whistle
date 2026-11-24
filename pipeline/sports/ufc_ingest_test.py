"""Tests for UFC card ingest (task-4-brief.md)."""
from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime, timezone
from pathlib import Path

from app.models import UfcBout, UfcEvent, UfcFighter
from pipeline.sports.ufc_ingest import (
    IngestSummary,
    current_bout,
    ingest_window,
    slugify,
    upsert_event,
    upsert_fighter,
)
from pipeline.sports.ufc_provider import BoutCard, EventCard, FighterRef
from pipeline.sports.ufc_recorded import RecordedUfcProvider

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"
NOW = datetime(2026, 11, 25, tzinfo=timezone.utc)
T0 = datetime(2026, 12, 5, 18, 0, tzinfo=timezone.utc)


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _bout(bout_id="b1", a=("1", None), b=("2", None), when=T0, order=1) -> BoutCard:
    return BoutCard(
        provider_id=bout_id, card_order=order, segment="main", segment_label="Main Card",
        weight_class="Lightweight", scheduled_rounds=3, scheduled_utc=when,
        fighter_a=FighterRef(*a), fighter_b=FighterRef(*b),
    )


def _card(*bouts: BoutCard, event_id="e1", name="UFC Test Night") -> EventCard:
    return EventCard(
        provider_id=event_id, name=name, first_bout_utc=T0, last_bout_utc=T0,
        venue="Arena", is_card=True, bouts=tuple(bouts),
    )


def _count(db, model) -> int:
    return db.query(model).count()


class CountingProvider(RecordedUfcProvider):
    """Recorded provider that counts profile fetches and can hide events."""

    def __init__(self, *args, missing_events=(), no_profiles=False, **kwargs):
        super().__init__(*args, **kwargs)
        self.fighter_calls: list[str] = []
        self.missing_events = set(missing_events)
        self.no_profiles = no_profiles

    def fetch_event(self, event_id):
        return None if event_id in self.missing_events else super().fetch_event(event_id)

    def fetch_fighter(self, fighter_id):
        self.fighter_calls.append(fighter_id)
        return None if self.no_profiles else super().fetch_fighter(fighter_id)


def test_ingests_a_card(db_session):
    card = RecordedUfcProvider(RAW).fetch_event("600061665")
    event = upsert_event(db_session, "espn", card, now=NOW)
    db_session.commit()
    assert _count(db_session, UfcEvent) == 1
    assert _count(db_session, UfcBout) == 3
    fighters = db_session.query(UfcFighter).all()
    assert len(fighters) == 6
    assert {f.name for f in fighters} == {"TBA"}
    assert {b.status for b in db_session.query(UfcBout)} == {"scheduled"}
    assert event.slug == "ufc-fight-night-prochazka-vs-stirling-2026-11-21"


def test_second_run_changes_nothing(db_session):
    card = RecordedUfcProvider(RAW).fetch_event("600061665")
    upsert_event(db_session, "espn", card, now=NOW)
    db_session.commit()
    ids = sorted(b.id for b in db_session.query(UfcBout))
    summary = IngestSummary()
    upsert_event(db_session, "espn", card, now=NOW, summary=summary)
    db_session.commit()
    assert sorted(b.id for b in db_session.query(UfcBout)) == ids
    assert _count(db_session, UfcEvent) == 1 and _count(db_session, UfcFighter) == 6
    assert summary.bouts_new == 0 and summary.bouts_changed == 0 and summary.bouts_cancelled == 0


def test_slugs_are_ascii_and_unique(db_session):
    assert slugify("Mateusz Rębecki") == "mateusz-rebecki"
    assert slugify("Jiří Procházka") == "jiri-prochazka"
    assert slugify("") == "x" and slugify("!!!") == "x"
    one = upsert_fighter(db_session, "espn", FighterRef("1", "Bruno Silva"))
    two = upsert_fighter(db_session, "espn", FighterRef("2", "Bruno Silva"))
    assert one.slug == "bruno-silva" and two.slug == "bruno-silva-2"


def test_event_slug_collision_appends_provider_id(db_session):
    first = upsert_event(db_session, "espn", _card(_bout(), event_id="e1"), now=NOW)
    second = upsert_event(db_session, "espn", _card(_bout("b2", ("3", None), ("4", None)), event_id="e2"), now=NOW)
    assert first.slug == "ufc-test-night-2026-12-05"
    assert second.slug == "ufc-test-night-2026-12-05-e2"
    renamed = upsert_event(db_session, "espn", replace(_card(_bout()), name="Other"), now=NOW)
    assert renamed.slug == "ufc-test-night-2026-12-05" and renamed.name == "Other"


def test_replaced_fighter_makes_a_new_revision(db_session):
    upsert_event(db_session, "espn", _card(_bout()), now=NOW)
    db_session.commit()
    summary = IngestSummary()
    upsert_event(db_session, "espn", _card(_bout(b=("3", None))), now=NOW, summary=summary)
    db_session.commit()
    old = db_session.query(UfcBout).filter_by(revision=0).one()
    new = current_bout(db_session, "espn", "b1")
    assert old.status == "changed" and old.replaced_by_id == new.id
    assert new.revision == 1 and new.status == "scheduled" and new.id != old.id
    assert summary.bouts_changed == 1 and summary.bouts_new == 0


def test_removed_bout_is_cancelled_not_deleted(db_session):
    other = ("5", None), ("6", None)
    upsert_event(db_session, "espn", _card(_bout(), _bout("b2", *other, order=2)), now=NOW)
    db_session.commit()
    summary = IngestSummary()
    upsert_event(db_session, "espn", _card(_bout()), now=NOW, summary=summary)
    db_session.commit()
    assert _count(db_session, UfcBout) == 2
    assert current_bout(db_session, "espn", "b2").status == "cancelled"
    assert current_bout(db_session, "espn", "b1").status == "scheduled"
    assert summary.bouts_cancelled == 1


def test_time_moves_until_locked(db_session):
    upsert_event(db_session, "espn", _card(_bout()), now=NOW)
    db_session.commit()
    later = datetime(2026, 12, 5, 20, 0, tzinfo=timezone.utc)
    upsert_event(db_session, "espn", _card(_bout(when=later)), now=NOW)
    db_session.commit()
    bout = current_bout(db_session, "espn", "b1")
    assert _utc(bout.scheduled_utc) == later
    bout.locked_at = NOW
    db_session.commit()
    latest = datetime(2026, 12, 5, 22, 0, tzinfo=timezone.utc)
    upsert_event(db_session, "espn", _card(_bout(when=latest)), now=NOW)
    db_session.commit()
    assert _utc(current_bout(db_session, "espn", "b1").scheduled_utc) == later


def test_finished_bout_is_not_rewritten_by_a_changed_card(db_session):
    upsert_event(db_session, "espn", _card(_bout()), now=NOW)
    bout = current_bout(db_session, "espn", "b1")
    bout.status = "finished"
    db_session.commit()
    summary = IngestSummary()
    upsert_event(db_session, "espn", _card(_bout(b=("3", None), when=T0.replace(hour=23))), now=NOW, summary=summary)
    db_session.commit()
    assert _count(db_session, UfcBout) == 1
    row = current_bout(db_session, "espn", "b1")
    assert row.id == bout.id and row.status == "finished" and row.revision == 0
    assert row.replaced_by_id is None and _utc(row.scheduled_utc) == T0
    assert summary.bouts_changed == 0


def test_one_bad_event_does_not_stop_the_rest(db_session):
    provider = CountingProvider(RAW, missing_events={"600061665"}, no_profiles=True)
    summary = ingest_window(db_session, provider, date(2026, 11, 1), date(2026, 12, 31), now=NOW)
    assert summary.failed == 1 and summary.events == 1
    assert db_session.query(UfcEvent).one().provider_event_id == "600062700"


def test_an_exception_rolls_back_only_that_event(db_session):
    class Exploding(CountingProvider):
        def fetch_event(self, event_id):
            card = super().fetch_event(event_id)
            if event_id == "600061665":
                bad = replace(card.bouts[0], fighter_a=None)  # breaks upsert midway
                return replace(card, bouts=(card.bouts[1], bad))
            return card

    summary = ingest_window(
        db_session, Exploding(RAW, no_profiles=True), date(2026, 11, 1), date(2026, 12, 31), now=NOW
    )
    assert summary.failed == 1 and summary.events == 1
    assert [e.provider_event_id for e in db_session.query(UfcEvent)] == ["600062700"]
    assert _count(db_session, UfcBout) == 3


def test_tba_fighter_is_named_later(db_session):
    upsert_fighter(db_session, "espn", FighterRef("7", None))
    fighter = db_session.query(UfcFighter).one()
    assert fighter.name == "TBA" and fighter.slug == "tba"
    upsert_fighter(db_session, "espn", FighterRef("7", "Dan Hooker"))
    db_session.commit()
    fighter = db_session.query(UfcFighter).one()
    assert fighter.name == "Dan Hooker" and fighter.slug == "dan-hooker"
    upsert_fighter(db_session, "espn", FighterRef("7", "Daniel Hooker"))
    assert db_session.query(UfcFighter).one().slug == "dan-hooker"  # recomputed once


def test_ingest_window_names_fighters_from_profiles(db_session):
    provider = CountingProvider(RAW)
    summary = ingest_window(db_session, provider, date(2026, 11, 21), date(2026, 11, 21), now=NOW)
    assert summary.events == 1 and summary.bouts_new == 3 and summary.failed == 0
    assert summary.fighters_named == 6
    assert not [f for f in db_session.query(UfcFighter) if f.name == "TBA"]
    pro = db_session.query(UfcFighter).filter_by(provider_fighter_id="3156612").one()
    assert pro.name == "Jiří Procházka" and pro.slug == "jiri-prochazka"
    assert pro.height_in == 75.0 and pro.reach_in == 80.0 and pro.stance == "Orthodox"
    assert str(pro.date_of_birth) == "1992-10-14"
    # A second run has nothing left to name and fetches no profiles.
    provider.fighter_calls.clear()
    again = ingest_window(db_session, provider, date(2026, 11, 21), date(2026, 11, 21), now=NOW)
    assert provider.fighter_calls == [] and again.fighters_named == 0 and again.bouts_new == 0


def test_profile_fetches_are_capped(db_session):
    provider = CountingProvider(RAW)
    window = (date(2026, 11, 21), date(2026, 11, 21))
    first = ingest_window(db_session, provider, *window, now=NOW, max_profiles=2)
    assert len(provider.fighter_calls) == 2 and first.fighters_named == 2
    assert _count(db_session, UfcFighter) == 6
    assert len([f for f in db_session.query(UfcFighter) if f.name == "TBA"]) == 4
    provider.fighter_calls.clear()
    second = ingest_window(db_session, provider, *window, now=NOW, max_profiles=60)
    assert len(provider.fighter_calls) == 4 and second.fighters_named == 4
    assert not [f for f in db_session.query(UfcFighter) if f.name == "TBA"]


def test_cap_is_shared_across_events(db_session):
    provider = CountingProvider(RAW)
    ingest_window(db_session, provider, date(2026, 11, 1), date(2026, 12, 31), now=NOW, max_profiles=3)
    assert len(provider.fighter_calls) == 3


def test_missing_profile_leaves_tba(db_session):
    provider = CountingProvider(RAW, no_profiles=True)
    summary = ingest_window(db_session, provider, date(2026, 11, 21), date(2026, 11, 21), now=NOW)
    assert summary.failed == 0 and summary.fighters_named == 0
    assert {f.name for f in db_session.query(UfcFighter)} == {"TBA"}
    assert len(provider.fighter_calls) == 6


def test_flipped_pair_is_the_same_bout_and_keeps_stored_order(db_session):
    upsert_event(db_session, "espn", _card(_bout(a=("1", None), b=("2", None))), now=NOW)
    db_session.commit()
    before = current_bout(db_session, "espn", "b1")
    stored = (before.id, before.fighter_a_id, before.fighter_b_id)
    later = datetime(2026, 12, 5, 21, 0, tzinfo=timezone.utc)
    summary = IngestSummary()
    upsert_event(
        db_session, "espn", _card(_bout(a=("2", None), b=("1", None), when=later)),
        now=NOW, summary=summary,
    )
    db_session.commit()
    row = current_bout(db_session, "espn", "b1")
    assert _count(db_session, UfcBout) == 1
    assert (row.id, row.fighter_a_id, row.fighter_b_id) == stored
    assert row.revision == 0 and row.status == "scheduled"
    assert _utc(row.scheduled_utc) == later
    assert summary.bouts_changed == 0 and summary.bouts_new == 0


def test_empty_card_cancels_nothing(db_session):
    upsert_event(db_session, "espn", _card(_bout()), now=NOW)
    db_session.commit()
    summary = IngestSummary()
    upsert_event(db_session, "espn", _card(), now=NOW, summary=summary)
    db_session.commit()
    assert current_bout(db_session, "espn", "b1").status == "scheduled"
    assert summary.bouts_cancelled == 0


def _drop(db_session):
    upsert_event(db_session, "espn", _card(_bout(), _bout("b2", ("5", None), ("6", None), order=2)), now=NOW)
    db_session.commit()
    upsert_event(db_session, "espn", _card(_bout("b2", ("5", None), ("6", None), order=2)), now=NOW)
    db_session.commit()
    assert current_bout(db_session, "espn", "b1").status == "cancelled"


def test_dropped_then_readded_same_pair_is_reinstated(db_session):
    _drop(db_session)
    old = current_bout(db_session, "espn", "b1")
    old_id, a_id, b_id = old.id, old.fighter_a_id, old.fighter_b_id
    later = datetime(2026, 12, 5, 19, 0, tzinfo=timezone.utc)
    summary = IngestSummary()
    upsert_event(
        db_session, "espn",
        _card(_bout(a=("2", None), b=("1", None), when=later), _bout("b2", ("5", None), ("6", None), order=2)),
        now=NOW, summary=summary,
    )
    db_session.commit()
    row = current_bout(db_session, "espn", "b1")
    assert (row.id, row.revision, row.status) == (old_id, 0, "scheduled")
    assert (row.fighter_a_id, row.fighter_b_id) == (a_id, b_id)
    assert _utc(row.scheduled_utc) == later
    assert summary.bouts_reinstated == 1 and summary.bouts_new == 0


def test_dropped_then_readded_with_new_opponent_is_a_new_revision(db_session):
    _drop(db_session)
    old = current_bout(db_session, "espn", "b1")
    summary = IngestSummary()
    upsert_event(
        db_session, "espn",
        _card(_bout(b=("3", None)), _bout("b2", ("5", None), ("6", None), order=2)),
        now=NOW, summary=summary,
    )
    db_session.commit()
    new = current_bout(db_session, "espn", "b1")
    db_session.refresh(old)
    assert new.id != old.id and new.revision == 1 and new.status == "scheduled"
    assert old.status == "cancelled" and old.replaced_by_id == new.id
    assert summary.bouts_changed == 1 and summary.bouts_reinstated == 0


def test_locked_cancelled_bout_is_not_reinstated(db_session):
    _drop(db_session)
    old = current_bout(db_session, "espn", "b1")
    old.locked_at = NOW
    db_session.commit()
    summary = IngestSummary()
    upsert_event(
        db_session, "espn",
        _card(_bout(), _bout("b2", ("5", None), ("6", None), order=2)), now=NOW, summary=summary,
    )
    db_session.commit()
    assert current_bout(db_session, "espn", "b1").status == "cancelled"
    assert _count(db_session, UfcBout) == 2 and summary.bouts_reinstated == 0


def test_failure_warning_does_not_leak_the_exception_text(db_session, caplog):
    import logging

    class Leaky(RecordedUfcProvider):
        def fetch_event(self, event_id):
            raise RuntimeError("SECRET-MARKER-123")

    with caplog.at_level(logging.DEBUG):
        summary = ingest_window(db_session, Leaky(RAW), date(2026, 11, 1), date(2026, 12, 31))
    assert summary.failed == 2
    warnings = [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]
    assert warnings and not any("SECRET-MARKER-123" in m for m in warnings)
    assert any("RuntimeError" in m for m in warnings)
    assert any("SECRET-MARKER-123" in r.getMessage() for r in caplog.records if r.levelno == logging.DEBUG)
