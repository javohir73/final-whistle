"""Tests for the UFC history backfill and its daily workflow file."""
from __future__ import annotations

import shutil
from datetime import date, datetime, timezone
from pathlib import Path

import yaml
from sqlalchemy import select

from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter, UfcOddsSnapshot
from pipeline.sports.ufc_backfill import backfill
from pipeline.sports.ufc_recorded import RecordedUfcProvider

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"
WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "ufc-refresh.yml"
NOW = datetime(2026, 11, 25, 12, 0, tzinfo=timezone.utc)
START, END = date(2026, 11, 1), date(2026, 12, 31)
FINISHED_EVENT, UPCOMING_EVENT = "600061665", "600062700"
MODELS = (UfcEvent, UfcBout, UfcFighter, UfcBoutStat, UfcOddsSnapshot)


def _counts(db) -> list[int]:
    return [db.query(m).count() for m in MODELS]


def _bout(db, provider_bout_id: str) -> UfcBout:
    return db.scalar(select(UfcBout).where(UfcBout.provider_bout_id == provider_bout_id))


def _event(db, provider_event_id: str) -> UfcEvent:
    return db.scalar(select(UfcEvent).where(UfcEvent.provider_event_id == provider_event_id))


def test_backfill_loads_a_finished_card(db_session):
    summary = backfill(db_session, RecordedUfcProvider(RAW), START, END, now=NOW)
    assert _event(db_session, FINISHED_EVENT).status == "finished"
    main = _bout(db_session, "401922277")
    assert (main.status, main.winner, main.method) == ("finished", "b", "ko_tko")
    assert db_session.query(UfcBoutStat).count() == 6
    assert db_session.query(UfcOddsSnapshot).count() >= 3
    prochazka = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "3156612"))
    assert prochazka.date_of_birth is not None
    assert (summary.events, summary.finished, summary.stats, summary.failed) == (2, 3, 6, 0)
    assert summary.bouts == 6 and summary.fighters > 0 and summary.odds >= 3


def test_backfill_twice_is_identical(db_session):
    provider = RecordedUfcProvider(RAW)
    backfill(db_session, provider, START, END, now=NOW)
    before = _counts(db_session)
    second = backfill(db_session, provider, START, END, now=NOW)
    assert _counts(db_session) == before
    assert second.finished == 0 and second.odds == 0 and second.failed == 0


def test_backfill_includes_an_upcoming_card_as_scheduled(db_session):
    backfill(db_session, RecordedUfcProvider(RAW), START, END, now=NOW)
    assert _event(db_session, UPCOMING_EVENT).status == "scheduled"
    for bout_id in ("401933595", "401933606", "401936473"):
        bout = _bout(db_session, bout_id)
        assert bout.status == "scheduled" and bout.winner is None


def test_backfill_survives_a_truncated_event_file(db_session, tmp_path):
    # An unparseable file cannot even be listed by the recorded provider, so it
    # is skipped without being counted; the rest of the history still loads.
    raw = tmp_path / "raw"
    shutil.copytree(RAW, raw)
    path = raw / "events" / f"{UPCOMING_EVENT}.json"
    path.write_text(path.read_text()[:40], encoding="utf-8")
    summary = backfill(db_session, RecordedUfcProvider(raw), START, END, now=NOW)
    assert _event(db_session, FINISHED_EVENT).status == "finished"
    assert _event(db_session, UPCOMING_EVENT) is None
    assert summary.events == 1 and summary.finished == 3 and summary.failed == 0


def test_backfill_counts_a_listed_but_unusable_event_file(db_session, tmp_path):
    raw = tmp_path / "raw"
    shutil.copytree(RAW, raw)
    path = raw / "events" / f"{UPCOMING_EVENT}.json"
    path.write_text('{"date": "2026-12-05T15:00Z"}', encoding="utf-8")
    summary = backfill(db_session, RecordedUfcProvider(raw), START, END, now=NOW)
    assert _event(db_session, FINISHED_EVENT).status == "finished"
    assert summary.failed == 1 and summary.events == 1 and summary.finished == 3


class _OneBadEvent(RecordedUfcProvider):
    def fetch_event(self, event_id):
        if event_id == FINISHED_EVENT:
            return None
        return super().fetch_event(event_id)


def test_missing_event_is_counted_and_others_load(db_session):
    summary = backfill(db_session, _OneBadEvent(RAW), START, END, now=NOW)
    assert summary.failed == 1 and summary.events == 1
    assert _event(db_session, UPCOMING_EVENT) is not None
    assert _event(db_session, FINISHED_EVENT) is None


class _ExplodingStats(RecordedUfcProvider):
    def fetch_stats(self, event_id, bout):
        if event_id == FINISHED_EVENT:
            raise RuntimeError("boom")
        return super().fetch_stats(event_id, bout)


def test_an_exception_rolls_back_that_event_only(db_session):
    summary = backfill(db_session, _ExplodingStats(RAW), START, END, now=NOW)
    assert summary.failed == 1 and summary.events == 1
    assert _event(db_session, FINISHED_EVENT) is None
    assert _event(db_session, UPCOMING_EVENT) is not None


def test_missing_athlete_file_does_not_stop_the_run(db_session, tmp_path):
    raw = tmp_path / "raw"
    shutil.copytree(RAW, raw)
    (raw / "athletes" / "3156612.json").unlink()
    summary = backfill(db_session, RecordedUfcProvider(raw), START, END, now=NOW)
    assert summary.failed == 0 and summary.events == 2
    fighter = db_session.scalar(select(UfcFighter).where(UfcFighter.provider_fighter_id == "3156612"))
    assert fighter.date_of_birth is None


def test_window_limits_events(db_session):
    summary = backfill(db_session, RecordedUfcProvider(RAW), date(2026, 12, 1), END, now=NOW)
    assert summary.events == 1
    assert _event(db_session, FINISHED_EVENT) is None


def test_workflow_is_valid_yaml_with_both_steps():
    doc = yaml.safe_load(WORKFLOW.read_text())
    assert doc["name"] == "UFC refresh"
    triggers = doc.get("on", doc.get(True))
    assert "workflow_dispatch" in triggers
    assert [s["cron"] for s in triggers["schedule"]] == ["20 9 * * *", "20 21 * * *"]
    steps = [s for job in doc["jobs"].values() for s in job["steps"]]
    runs = [s for s in steps if "run" in s]
    ingest = [s for s in runs if "ufc_ingest" in s["run"]]
    results = [s for s in runs if "ufc_results" in s["run"]]
    assert ingest and results
    assert "--days-back 2 --days-ahead 60" in ingest[0]["run"]
    assert results[0].get("continue-on-error") is True
    assert not ingest[0].get("continue-on-error")
