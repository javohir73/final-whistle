"""Grading picks: once, again when a result changes, never for a late pick."""
from __future__ import annotations

import logging
from types import SimpleNamespace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml
from sqlalchemy import event, select

from app.models import TipPlayer, UfcBout, UfcPick
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
         created=None):
    extra = {"status": status} if status else {}
    built = build(db, [(start, SECRET_NAME, "Yan Other", winner, method, extra)])
    bout = built.bouts[0]
    lock = bout.scheduled_utc
    for i, (w, m) in enumerate(picks):
        player = TipPlayer(device_id=f"{SECRET_DEVICE}-{i}", handle=f"{SECRET_HANDLE}-{i}")
        db.add(player)
        db.flush()
        db.add(UfcPick(bout_id=bout.id, player_id=player.id, winner=w, method=m,
                       created_at=created or lock - timedelta(hours=2),
                       updated_at=created or lock - timedelta(hours=2)))
    db.commit()
    return bout


def add_pick(db, bout, n, winner="a", method="decision", **cols):
    player = TipPlayer(device_id=f"dev-extra-{n}", handle=f"handle-extra-{n}")
    db.add(player)
    db.flush()
    db.add(UfcPick(bout_id=bout.id, player_id=player.id, winner=winner, method=method,
                   created_at=bout.scheduled_utc - timedelta(hours=1),
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


def test_a_pick_created_after_the_lock_is_voided_once(db_session):
    seed(db_session, picks=(("b", "decision"),), created=LOCK + timedelta(seconds=1))
    s = grade_picks(db_session, now=NOW)
    p = picks(db_session)[0]
    assert (p.points, p.winner_correct, p.method_correct, p.graded_at is not None) == (None, None, None, True)
    assert (s.written, s.voided, s.late) == (1, 1, 1)
    stamped = p.graded_at
    s2 = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert (s2.written, s2.voided, s2.late) == (0, 0, 0) and picks(db_session)[0].graded_at == stamped


def test_a_lock_moved_earlier_voids_the_late_pick_and_scores_the_rest(db_session):
    bout = seed(db_session, picks=(("b", "decision"), ("b", "decision")))
    first, second = picks(db_session)
    second.created_at = LOCK + timedelta(minutes=30)  # made after the start moved earlier
    db_session.commit()
    s = grade_picks(db_session, now=NOW)
    assert (s.written, s.voided, s.late) == (2, 1, 1)
    assert [p.points for p in picks(db_session)] == [5, None]


def test_a_late_pick_is_not_loaded_again_outside_the_window(db_session):
    seed(db_session, picks=(("b", "decision"),), created=LOCK + timedelta(seconds=1))
    grade_picks(db_session, now=NOW)
    calls = []
    real = mod._grade_bout
    mod._grade_bout = lambda *a, **k: calls.append(1) or real(*a, **k)
    try:
        grade_picks(db_session, now=NOW + timedelta(days=40))
    finally:
        mod._grade_bout = real
    assert calls == []


def test_a_pick_created_exactly_at_the_lock_is_on_time(db_session):
    seed(db_session, picks=(("b", "decision"),), created=LOCK)
    s = grade_picks(db_session, now=NOW)
    assert (s.written, s.voided, s.late) == (1, 0, 0) and picks(db_session)[0].points == 5


def test_a_late_pick_regrades_when_the_lock_moves_later(db_session):
    bout = seed(db_session, picks=(("b", "decision"),), created=LOCK + timedelta(minutes=5))
    grade_picks(db_session, now=NOW)
    assert picks(db_session)[0].points is None
    bout.locked_at = None
    bout.scheduled_utc = LOCK + timedelta(hours=1)
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert s.written == 1 and picks(db_session)[0].points == 5


def test_a_bout_without_a_lock_voids_its_picks(db_session):
    bout = seed(db_session, picks=(("b", "decision"),))
    bout.scheduled_utc = None
    db_session.commit()
    s = grade_picks(db_session, now=NOW)
    p = picks(db_session)[0]
    assert (s.voided, s.late) == (1, 1) and p.graded_at is not None and p.points is None


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


def test_aware_attributes_compare_through_utc():
    aware = timezone(timedelta(hours=-5))
    bout = SimpleNamespace(status="finished", winner="b", method="decision", locked_at=None,
                           scheduled_utc=datetime(2026, 11, 28, 13, 0, tzinfo=aware))  # 18:00 UTC
    on_time = SimpleNamespace(winner="b", method="decision", points=None, winner_correct=None, method_correct=None,
                              graded_at=None, created_at=datetime(2026, 11, 28, 12, 59, tzinfo=aware))
    late = SimpleNamespace(winner="b", method="decision", points=None, winner_correct=None, method_correct=None,
                           graded_at=None, created_at=datetime(2026, 11, 28, 18, 1, tzinfo=timezone.utc))
    naive = SimpleNamespace(winner="b", method="decision", points=None, winner_correct=None, method_correct=None,
                            graded_at=None, created_at=datetime(2026, 11, 28, 17, 0))  # read as UTC
    out = mod._grade_bout([on_time, late, naive], bout, NOW, True)
    assert (out.written, out.voided, out.late) == (3, 1, 1)
    assert (on_time.points, late.points, naive.points) == (5, None, 5)


def test_naive_now_is_read_as_utc(db_session):
    seed(db_session, picks=(("b", "decision"),))
    assert grade_picks(db_session, now=NOW.replace(tzinfo=None)).written == 1


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


def _statements(db, fn):
    seen = []
    engine = db.get_bind()
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        fn()
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    return seen


def test_old_graded_picks_are_neither_loaded_nor_counted(db_session, monkeypatch):
    out = [(START, "Ab First", "Ba Second", "b", "decision")]
    for i in range(40):  # old bouts, beyond the reconcile window
        out.append(((NOW - timedelta(days=90 + i)).strftime("%Y-%m-%dT%H:%M"), f"Old{i}", f"Older{i}", "a", "decision"))
    built = build(db_session, out)
    add_pick(db_session, built.bouts[0], 0, "b")
    for i, b in enumerate(built.bouts[1:], start=1):
        add_pick(db_session, b, i, "a", points=5, winner_correct=True, method_correct=True, graded_at=NOW - timedelta(days=80))
    db_session.commit()
    processed = []
    real = mod._grade_bout
    monkeypatch.setattr(mod, "_grade_bout", lambda picks_, bout, *a: processed.append((bout.id, len(picks_))) or real(picks_, bout, *a))
    seen = _statements(db_session, lambda: grade_picks(db_session, now=NOW))
    assert processed == [(built.bouts[0].id, 1)] and len(seen) <= 8, (processed, len(seen))
    assert picks(db_session)[0].points == 5
    processed.clear()
    again = _statements(db_session, lambda: grade_picks(db_session, now=NOW + timedelta(hours=12)))
    assert [x for x in processed if x[0] != built.bouts[0].id] == []
    assert not [q for q in again if q.lstrip().upper().startswith("UPDATE")]


def test_a_second_run_issues_no_update(db_session):
    seed(db_session)
    grade_picks(db_session, now=NOW)
    seen = _statements(db_session, lambda: grade_picks(db_session, now=NOW + timedelta(hours=12)))
    assert not [q for q in seen if q.lstrip().upper().startswith(("UPDATE", "INSERT", "DELETE"))]


def test_finished_to_live_resets_a_graded_pick(db_session):
    bout = seed(db_session, picks=(("b", "decision"),))
    grade_picks(db_session, now=NOW)
    bout.status, bout.winner, bout.method = "live", None, None
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    p = picks(db_session)[0]
    assert s.reset == 1 and (p.points, p.graded_at) == (None, None)


def test_a_no_contest_later_given_a_winner_is_scored(db_session):
    bout = seed(db_session, winner=None, method="no_contest", status="finished", picks=(("b", "decision"),))
    grade_picks(db_session, now=NOW)
    assert picks(db_session)[0].points is None and picks(db_session)[0].graded_at is not None
    bout.winner, bout.method = "b", "decision"
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=12))
    assert (s.written, s.voided) == (1, 0) and picks(db_session)[0].points == 5


def test_cancelled_reinstated_then_finished_end_to_end(db_session):
    bout = seed(db_session, winner=None, method=None, status="cancelled", picks=(("b", "decision"),))
    grade_picks(db_session, now=NOW)
    assert picks(db_session)[0].graded_at is not None
    bout.status = "scheduled"
    db_session.commit()
    assert grade_picks(db_session, now=NOW + timedelta(hours=12)).reset == 1
    bout.status, bout.winner, bout.method = "finished", "b", "decision"
    db_session.commit()
    s = grade_picks(db_session, now=NOW + timedelta(hours=24))
    p = picks(db_session)[0]
    assert s.written == 1 and (p.points, p.winner_correct, p.method_correct) == (5, True, True)


def test_the_window_edges_are_exact(db_session):
    def flip_and_run(days, extra):
        db_session.rollback()
        for b in db_session.scalars(select(UfcBout)):
            b.winner = "b"
        for p in picks(db_session):
            p.points, p.winner_correct, p.method_correct, p.graded_at = 5, True, True, NOW
        db_session.commit()
        bout = db_session.scalars(select(UfcBout)).one()
        bout.winner = "a"
        db_session.commit()
        return grade_picks(db_session, now=bout.scheduled_utc.replace(tzinfo=timezone.utc) + timedelta(days=days) + extra).written

    seed(db_session, picks=(("b", "decision"),))
    assert flip_and_run(30, timedelta(0)) == 1                       # exactly 30 days: inside
    assert flip_and_run(30, timedelta(seconds=1)) == 0               # past the window, inside the SQL slack
    assert flip_and_run(31, timedelta(seconds=1)) == 0               # past the SQL slack too


def test_a_database_error_in_one_bouts_savepoint_leaves_the_rest_graded(db_session, monkeypatch):
    first, second = build(db_session, [
        (START, "Ab First", "Ba Second", "b", "decision"),
        ("2026-11-28T20:00", "Cy Third", "Di Fourth", "a", "decision"),
    ]).bouts
    add_pick(db_session, first, 1, "b")
    add_pick(db_session, second, 2, "a")
    db_session.commit()
    real = mod.score_pick

    def corrupting(winner, method, bout):
        if bout.id == first.id:
            picks(db_session)[0].winner = None  # NOT NULL: fails at the savepoint's flush
        return real(winner, method, bout)

    monkeypatch.setattr(mod, "score_pick", corrupting)
    s = grade_picks(db_session, now=NOW)
    assert (s.failed, s.written) == (1, 1)
    assert [p.points for p in picks(db_session)] == [None, 5]
    monkeypatch.setattr(mod, "score_pick", real)
    assert grade_picks(db_session, now=NOW).written == 1  # the session is still usable


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
    monkeypatch.setattr(mod, "grade_picks", lambda db: PickGradeSummary(written=3))
    assert main(["--grade"]) == 0 and FakeDb.rolled == 0
    monkeypatch.setattr(mod, "grade_picks", lambda db: PickGradeSummary(failed=2))
    assert main(["--grade"]) == 1 and FakeDb.rolled == 0  # a failed bout turns the run red; no rollback of saved work

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
