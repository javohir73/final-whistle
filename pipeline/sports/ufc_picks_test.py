"""Grading picks: once, again when a result changes, never for a late pick."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from sqlalchemy import event, select

from app.models import TipPlayer, UfcPick
from pipeline.sports.ufc_picks import PickGradeSummary, grade_picks, main
import pipeline.sports.ufc_picks as mod
from pipeline.sports.ufc_testkit import build

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "ufc-refresh.yml"
NOW = datetime(2026, 12, 1, tzinfo=timezone.utc)
START = "2026-11-28T18:00"  # three days before NOW
LOCK = datetime(2026, 11, 28, 18, tzinfo=timezone.utc)
SECRET_NAME, SECRET_HANDLE, SECRET_DEVICE = "Zed Quillfeather", "swift-otter-77", "dev-secret-0001"


def seed(db, winner="b", method="decision", status=None, start=START, picks=(("b", "decision"), ("b", "ko_tko"), ("a", "decision")),
         updated=None):
    extra = {"status": status} if status else {}
    built = build(db, [(start, SECRET_NAME, "Yan Other", winner, method, extra)])
    bout = built.bouts[0]
    lock = bout.scheduled_utc
    for i, (w, m) in enumerate(picks):
        player = TipPlayer(device_id=f"{SECRET_DEVICE}-{i}", handle=f"{SECRET_HANDLE}-{i}")
        db.add(player)
        db.flush()
        db.add(UfcPick(bout_id=bout.id, player_id=player.id, winner=w, method=m,
                       updated_at=updated or lock - timedelta(hours=2)))
    db.commit()
    return bout


def add_pick(db, bout, n, winner="a", method="decision", **cols):
    player = TipPlayer(device_id=f"dev-extra-{n}", handle=f"handle-extra-{n}")
    db.add(player)
    db.flush()
    db.add(UfcPick(bout_id=bout.id, player_id=player.id, winner=winner, method=method,
                   updated_at=bout.scheduled_utc - timedelta(hours=1), **cols))


def picks(db):
    return db.scalars(select(UfcPick).order_by(UfcPick.id)).all()


def test_grades_a_finished_bout_once(db_session):
    seed(db_session)
    s = grade_picks(db_session, now=NOW)
    assert (s.written, s.voided) == (3, 0)
    assert [p.points for p in picks(db_session)] == [5, 2, 0]
    assert [(p.winner_correct, p.method_correct) for p in picks(db_session)] == [(True, True), (True, False), (False, False)]
    stamped = [p.graded_at for p in picks(db_session)]
    assert all(stamped)
    again = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert again.written == 0 and [p.graded_at for p in picks(db_session)] == stamped


@pytest.mark.parametrize("case", ["draw", "no_contest", "cancelled", "changed"])
def test_voids_draw_no_contest_cancelled_and_changed(db_session, case):
    if case in ("draw", "no_contest"):
        seed(db_session, winner=None, method=case, status="finished", picks=(("a", "decision"),))
    else:
        seed(db_session, winner=None, method=None, status=case, picks=(("a", "decision"),))
    s = grade_picks(db_session, now=NOW)
    p = picks(db_session)[0]
    assert (p.points, p.winner_correct, p.method_correct, p.graded_at is not None) == (None, None, None, True)
    assert s.voided == 1 and s.written == 1


def test_a_pick_stamped_after_the_lock_is_never_graded(db_session):
    seed(db_session, picks=(("b", "decision"),), updated=LOCK + timedelta(seconds=1))
    s = grade_picks(db_session, now=NOW)
    p = picks(db_session)[0]
    assert (p.points, p.winner_correct, p.method_correct, p.graded_at) == (None, None, None, None)
    assert s.late == 1 and s.written == 0


def test_a_pick_stamped_exactly_at_the_lock_is_graded(db_session):
    seed(db_session, picks=(("b", "decision"),), updated=LOCK)
    assert grade_picks(db_session, now=NOW).written == 1


def test_a_bout_without_a_lock_is_never_graded(db_session):
    bout = seed(db_session, picks=(("b", "decision"),))
    bout.scheduled_utc = None
    db_session.commit()
    s = grade_picks(db_session, now=NOW)
    assert s.late == 1 and picks(db_session)[0].graded_at is None


def test_an_overturned_result_is_regraded(db_session):
    bout = seed(db_session)
    grade_picks(db_session, now=NOW)
    bout.winner, bout.method = "a", "submission"
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert s.written == 3
    assert [p.points for p in picks(db_session)] == [0, 0, 2]
    assert grade_picks(db_session, now=NOW + timedelta(hours=24)).written == 0


def test_a_result_turned_no_contest_voids_the_grade(db_session):
    bout = seed(db_session)
    grade_picks(db_session, now=NOW)
    bout.winner, bout.method = None, "no_contest"
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert (s.written, s.voided) == (3, 3)
    assert all((p.points, p.winner_correct, p.method_correct) == (None, None, None) and p.graded_at for p in picks(db_session))


def test_a_reinstated_bout_resets_its_void_grade(db_session):
    bout = seed(db_session, winner=None, method=None, status="cancelled", picks=(("a", "decision"),))
    grade_picks(db_session, now=NOW)
    assert picks(db_session)[0].graded_at is not None
    bout.status = "scheduled"
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    p = picks(db_session)[0]
    assert s.reset == 1 and p.graded_at is None and p.points is None
    assert grade_picks(db_session, now=NOW + timedelta(hours=24)).reset == 0


def test_a_reinstated_bout_resets_a_scored_grade(db_session):
    bout = seed(db_session, picks=(("b", "decision"),))
    grade_picks(db_session, now=NOW)
    bout.status, bout.winner, bout.method = "scheduled", None, None
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    p = picks(db_session)[0]
    assert s.reset == 1 and (p.points, p.winner_correct, p.method_correct, p.graded_at) == (None,) * 4


def test_a_scheduled_or_live_bout_is_left_alone(db_session):
    seed(db_session, winner=None, method=None, status="live", picks=(("a", None),))
    s = grade_picks(db_session, now=NOW)
    assert (s.written, s.reset, s.late) == (0, 0, 0) and picks(db_session)[0].graded_at is None


def test_a_result_outside_the_reconcile_window_is_left_alone(db_session):
    bout = seed(db_session, start=(NOW - timedelta(days=31)).strftime("%Y-%m-%dT%H:%M"))
    grade_picks(db_session, now=NOW - timedelta(days=30))  # graded while still inside the window
    before = [(p.points, p.graded_at) for p in picks(db_session)]
    bout.winner = "a"
    db_session.commit()
    s = grade_picks(db_session, now=NOW)
    assert s.written == 0 and [(p.points, p.graded_at) for p in picks(db_session)] == before


def test_an_old_ungraded_pick_is_still_graded(db_session):
    seed(db_session, start=(NOW - timedelta(days=60)).strftime("%Y-%m-%dT%H:%M"))
    assert grade_picks(db_session, now=NOW).written == 3


def test_grading_does_not_move_updated_at(db_session):
    seed(db_session)
    before = [p.updated_at for p in picks(db_session)]
    grade_picks(db_session, now=NOW)
    db_session.expire_all()
    assert [p.updated_at for p in picks(db_session)] == before


def test_aware_values_from_the_database_compare_through_utc(db_session):
    seed(db_session, picks=(("b", "decision"),))
    p = picks(db_session)[0]
    p.updated_at = p.updated_at.replace(tzinfo=timezone.utc)  # Postgres hands back aware values
    db_session.commit()
    assert grade_picks(db_session, now=NOW.replace(tzinfo=None)).written == 1  # a naive `now` is read as UTC


def test_one_failing_bout_does_not_stop_the_rest(db_session, monkeypatch):
    first, second = build(db_session, [
        (START, "Ab First", "Ba Second", "b", "decision"),
        ("2026-11-28T20:00", "Cy Third", "Di Fourth", "a", "decision"),
    ]).bouts
    add_pick(db_session, first, 1, "b")
    add_pick(db_session, second, 2, "a")
    db_session.commit()
    real = mod.score_pick

    def flaky(winner, method, bout):
        if bout.id == first.id:
            raise RuntimeError("boom")
        return real(winner, method, bout)

    monkeypatch.setattr(mod, "score_pick", flaky)
    s = grade_picks(db_session, now=NOW)
    assert s.failed == 1 and s.written == 1
    assert [p.points for p in picks(db_session)] == [None, 5]


def _count_queries(db, fn):
    seen = []
    engine = db.get_bind()
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return len(seen)


def test_query_count_does_not_grow_with_old_graded_picks(db_session):
    def rows(n):
        out = [(START, "Ab First", "Ba Second", "b", "decision")]
        for i in range(n):  # old bouts, beyond the reconcile window
            out.append(((NOW - timedelta(days=90 + i)).strftime("%Y-%m-%dT%H:%M"), f"Old{i}", f"Older{i}", "a", "decision"))
        return out

    built = build(db_session, rows(40))
    add_pick(db_session, built.bouts[0], 0, "b")
    for i, b in enumerate(built.bouts[1:], start=1):
        add_pick(db_session, b, i, "a", points=5, winner_correct=True, method_correct=True, graded_at=NOW - timedelta(days=80))
    db_session.commit()
    first = _count_queries(db_session, lambda: grade_picks(db_session, now=NOW))
    assert picks(db_session)[0].points == 5 and first <= 8, first
    assert _count_queries(db_session, lambda: grade_picks(db_session, now=NOW)) <= 4


def test_logs_carry_counts_only(db_session, caplog):
    seed(db_session)
    with caplog.at_level(logging.INFO):
        grade_picks(db_session, now=NOW)
    assert "ufc picks:" in caplog.text
    for secret in (SECRET_NAME, "Quillfeather", SECRET_HANDLE, SECRET_DEVICE):
        assert secret not in caplog.text


def test_main_requires_the_flag():
    with pytest.raises(SystemExit):
        main([])


def test_main_exit_codes(monkeypatch):
    class FakeDb:
        rolled = 0
        def rollback(self): FakeDb.rolled += 1
        def close(self): pass
    import app.db
    monkeypatch.setattr(app.db, "SessionLocal", FakeDb)
    monkeypatch.setattr(mod, "grade_picks", lambda db: PickGradeSummary(failed=2))
    assert main(["--grade"]) == 0 and FakeDb.rolled == 0

    def raising(db): raise RuntimeError("x")
    monkeypatch.setattr(mod, "grade_picks", raising)
    assert main(["--grade"]) == 1 and FakeDb.rolled == 1


def test_workflow_grades_picks_after_predict_and_fails_the_run():
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["ufc-refresh"]["steps"]
    runs = [s.get("run", "") for s in steps]
    i_predict = next(i for i, r in enumerate(runs) if "ufc_predict --generate --grade" in r)
    i_picks = next(i for i, r in enumerate(runs) if "ufc_picks --grade" in r)
    step = steps[i_picks]
    assert i_picks == i_predict + 1 == len(steps) - 1
    assert "continue-on-error" not in step and step["timeout-minutes"] == 5
    assert step["env"] == {"DATABASE_URL": "${{ secrets.DATABASE_URL }}", "PYTHONPATH": "backend:."}
