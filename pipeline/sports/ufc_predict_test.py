"""Tests for the UFC prediction step: append-only rows, frozen at lock."""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import event, select

from app.models import UfcBout, UfcFighter, UfcPrediction, UfcPredictionResult
from ml.sports.ufc.elo import EloParams
from ml.sports.ufc.features import FEATURES
from ml.sports.ufc.methods import WINDOW_YEARS, method_table
from ml.sports.ufc.model import FORM_VERSION, FormParams
from ml.sports.ufc.params import UfcParams
from pipeline.sports.ufc_history import load_history
from pipeline.sports.ufc_ingest import _utc
import pipeline.sports.ufc_predict as mod
from pipeline.sports.ufc_predict import _write_prediction, generate, grade, grade_summary, lock_time, main
from pipeline.sports.ufc_testkit import build

NOW = datetime(2026, 12, 1, tzinfo=timezone.utc)
ELO_V, FORM_V = "ufc-elo-v0.1", "ufc-form-v0.2"


def _form(version: str = FORM_VERSION) -> FormParams:
    return FormParams(
        version=version, features=FEATURES,
        weights=tuple(1.0 if f == "elo_diff" else 0.0 for f in FEATURES),
        means=tuple(0.0 for _ in FEATURES),
        scales=tuple(100.0 for _ in FEATURES),
        c=1.0, train_from=date(2020, 1, 1), train_to=date(2025, 1, 1),
        fitted_on=date(2026, 1, 1), n_bouts=100,
    )


params = UfcParams(EloParams(k=80, history_from=1993), _form())
BASE = [("2026-01-01", "A", "B", "a", "decision"), ("2026-12-05T18:00", "A", "C", None, None)]


def rows_for(db, bout):
    return db.scalars(
        select(UfcPrediction).where(UfcPrediction.bout_id == bout.id).order_by(UfcPrediction.id)
    ).all()


def count(db):
    return len(db.scalars(select(UfcPrediction)).all())


def test_writes_one_row_per_model_for_an_open_bout(db_session):
    built = build(db_session, BASE)
    s = generate(db_session, params, now=NOW)
    rows = rows_for(db_session, built.bouts[1])
    assert s.written == 2 and {r.model_version for r in rows} == {ELO_V, FORM_V}
    by = {r.model_version: r for r in rows}
    elo, form = by[ELO_V], by[FORM_V]
    assert elo.p_a == pytest.approx(0.557312, abs=1e-6) and elo.p_b == pytest.approx(1 - elo.p_a)
    assert form.p_a == pytest.approx(1 / (1 + math.exp(-0.4)))
    assert all(r.is_shadow for r in rows) and set(elo.method_probs) == {"ko_tko", "submission", "decision"}
    assert sum(elo.method_probs.values()) == pytest.approx(1.0) and len(form.reasons) <= 3
    assert _utc(elo.created_at) == NOW


def test_reasons_use_the_fact_not_the_name(db_session):
    # A is five years younger than C; the form model is age-blind here, so only the
    # Elo sentence can appear; it must be a sentence about the rating gap.
    build(db_session, BASE, fighters={"A": {"dob": "1995-01-01"}, "C": {"dob": "2000-01-01"}})
    generate(db_session, params, now=NOW)
    elo = db_session.scalars(select(UfcPrediction).where(UfcPrediction.model_version == ELO_V)).one()
    assert len(elo.reasons) == 1 and "40" in elo.reasons[0]


def test_second_run_writes_nothing(db_session):
    build(db_session, BASE)
    generate(db_session, params, now=NOW)
    before = count(db_session)
    s = generate(db_session, params, now=NOW)
    assert s.written == 0 and count(db_session) == before == 2


def test_an_intervening_result_writes_a_new_row(db_session):
    built = build(db_session, [
        *BASE, ("2026-11-15", "A", "D", "b", "ko_tko", {"status": "live"}),
    ])
    generate(db_session, params, now=NOW)
    first = [(r.id, r.p_a) for r in rows_for(db_session, built.bouts[1])]
    assert len(first) == 2
    built.bouts[2].status = "finished"
    db_session.flush()
    s = generate(db_session, params, now=NOW + timedelta(minutes=1))
    rows = rows_for(db_session, built.bouts[1])
    assert s.written == 2 and len(rows) == 4
    assert [(r.id, r.p_a) for r in rows[:2]] == first


def test_no_prediction_at_or_after_lock(db_session):
    built = build(db_session, [
        ("2026-12-01", "A", "B", None, None),
        ("2026-12-02", "C", "D", None, None, {"locked_at": "2026-11-30T23:59:00"}),
        ("2026-12-09", "E", "F", None, None, {"status": "live"}),
    ])
    built.bouts[0].scheduled_utc = NOW
    db_session.flush()
    s = generate(db_session, params, now=NOW)
    assert count(db_session) == 0 and s.locked_skipped == 2 and s.candidates == 0


def test_locked_at_after_the_start_does_not_extend_the_window(db_session):
    built = build(db_session, [("2026-11-20", "A", "B", None, None, {"locked_at": "2026-12-10T00:00:00"})])
    assert _utc(lock_time(built.bouts[0])) == _utc(built.bouts[0].scheduled_utc)
    generate(db_session, params, now=NOW)
    assert count(db_session) == 0


def test_lock_time_cases():
    t1, t2 = datetime(2026, 1, 1), datetime(2026, 1, 2, tzinfo=timezone.utc)
    assert lock_time(UfcBout(scheduled_utc=None, locked_at=None)) is None
    assert lock_time(UfcBout(scheduled_utc=t2, locked_at=None)) == t2
    assert lock_time(UfcBout(scheduled_utc=None, locked_at=t1)) == t1.replace(tzinfo=timezone.utc)
    assert lock_time(UfcBout(scheduled_utc=t2, locked_at=t1)) == t1.replace(tzinfo=timezone.utc)


def test_replaced_opponent_predicts_only_the_new_revision(db_session):
    built = build(db_session, [
        ("2026-12-05T18:00", "A", "B", None, None, {"status": "changed"}),
        ("2026-12-05T18:00", "A", "C", None, None),
    ])
    built.bouts[1].revision = 1
    db_session.flush()
    generate(db_session, params, now=NOW)
    assert rows_for(db_session, built.bouts[0]) == [] and len(rows_for(db_session, built.bouts[1])) == 2


def test_without_form_params_only_elo_rows(db_session):
    built = build(db_session, BASE)
    s = generate(db_session, UfcParams(EloParams(k=80, history_from=1993), None), now=NOW)
    rows = rows_for(db_session, built.bouts[1])
    assert s.written == 1 and [r.model_version for r in rows] == [ELO_V]


def test_form_params_with_another_version_write_elo_only(db_session, caplog):
    built = build(db_session, BASE)
    p = UfcParams(EloParams(k=80, history_from=1993), _form("ufc-form-v0.1"))
    with caplog.at_level(logging.WARNING):
        generate(db_session, p, now=NOW)
    assert [r.model_version for r in rows_for(db_session, built.bouts[1])] == [ELO_V]
    assert any("form" in m.lower() for m in caplog.messages)


def test_non_finite_feature_skips_the_form_row(db_session, caplog, monkeypatch):
    import pipeline.sports.ufc_predict as mod
    built = build(db_session, BASE)
    real = mod.snapshots

    def bad(history, elo, targets=()):
        out = real(history, elo, targets)
        t = targets[0].bout_id
        out[t] = type(out[t])(**{**out[t].__dict__, "x": {**out[t].x, "age_diff": float("nan")}})
        return out

    monkeypatch.setattr(mod, "snapshots", bad)
    with caplog.at_level(logging.WARNING):
        generate(db_session, params, now=NOW)
    assert [r.model_version for r in rows_for(db_session, built.bouts[1])] == [ELO_V]
    assert any("non-finite" in m or "missing" in m for m in caplog.messages)


def test_ratings_are_written_to_fighters(db_session):
    built = build(db_session, [("2026-01-01", "A", "B", "a", "decision"), ("2026-02-01", "C", "D", None, None)])
    s = generate(db_session, params, now=NOW)
    f = built.fighters
    assert f["A"].rating == 1540.0 and f["B"].rating == 1460.0 and f["C"].rating == 1500.0
    assert s.ratings_updated == 2
    assert generate(db_session, params, now=NOW).ratings_updated == 0


def test_mirrored_bout_gets_the_mirrored_probability(db_session):
    built = build(db_session, [
        ("2026-01-01", "A", "B", "a", "decision"),
        ("2026-12-05T18:00", "A", "C", None, None),
        ("2026-12-05T18:00", "C", "A", None, None),
    ])
    generate(db_session, params, now=NOW)
    r1 = {r.model_version: r for r in rows_for(db_session, built.bouts[1])}
    r2 = {r.model_version: r for r in rows_for(db_session, built.bouts[2])}
    assert set(r1) == {ELO_V, FORM_V}
    for v in r1:
        assert r1[v].p_a == pytest.approx(1 - r2[v].p_a, abs=1e-12)


def test_bout_without_a_time_is_not_predicted(db_session):
    built = build(db_session, BASE)
    built.bouts[1].scheduled_utc = None
    db_session.flush()
    s = generate(db_session, params, now=NOW)
    assert count(db_session) == 0 and s.candidates == 0


def test_method_window_excludes_own_time_later_results_and_old_bouts(db_session):
    built = build(db_session, [
        ("2010-01-01", "G", "H", "a", "submission"),        # older than the window
        ("2026-06-01", "A", "B", "a", "decision"),          # inside the window
        ("2026-12-05T18:00", "C", "D", "a", "submission"),  # same timestamp as the candidate
        ("2026-12-05T18:00", "A", "C", None, None),
        ("2026-12-05T20:00", "E", "F", "a", "submission"),  # after the candidate
    ])
    # the same-timestamp and later bouts are history rows, so make them finished
    # before the candidate's own scheduled time is "now" for the prediction
    generate(db_session, params, now=NOW)
    end = _utc(built.bouts[3].scheduled_utc)
    start = end - timedelta(days=round(365.25 * WINDOW_YEARS))
    hist = load_history(db_session)
    expected = method_table([b for b in hist.bouts if b.when < end], start, end).probs("Lightweight", 3)
    rows = rows_for(db_session, built.bouts[3])
    assert rows and all(r.method_probs == pytest.approx(expected, abs=1e-12) for r in rows)
    assert expected["decision"] > 0.47  # only the decision bout is counted


# ---- grade ----------------------------------------------------------------

T = datetime(2026, 12, 5, 18, 0, tzinfo=timezone.utc)
DONE = [("2026-12-05T18:00", "A", "B", "a", "decision")]


def add_row(db, bout, at, p_a, version=ELO_V):
    row = UfcPrediction(
        bout_id=bout.id, model_version=version, p_a=p_a, p_b=1 - p_a,
        method_probs={}, reasons=[], is_shadow=True, created_at=at,
    )
    db.add(row)
    db.flush()
    return row


def results(db):
    return db.scalars(select(UfcPredictionResult).order_by(UfcPredictionResult.id)).all()


def test_grades_the_latest_row_at_or_before_lock(db_session):
    built = build(db_session, DONE)
    bout = built.bouts[0]
    add_row(db_session, bout, T - timedelta(days=2), 0.6)
    keep = add_row(db_session, bout, T - timedelta(days=1), 0.7)
    add_row(db_session, bout, T + timedelta(hours=1), 0.9)
    assert grade(db_session) == 1
    r = results(db_session)[0]
    assert r.prob_assigned == pytest.approx(0.7) and r.winner_correct is True
    assert r.log_loss == pytest.approx(0.356675, abs=1e-6) and r.brier == pytest.approx(0.09)
    assert r.prediction_id == keep.id


def test_row_written_after_scheduled_start_never_counts(db_session):
    built = build(db_session, [("2026-12-05T18:00", "A", "B", "a", "decision",
                                {"locked_at": "2026-12-05T18:30:00"})])
    add_row(db_session, built.bouts[0], T + timedelta(minutes=10), 0.8)
    assert grade(db_session) == 0 and results(db_session) == []


def test_each_model_is_graded_once(db_session):
    built = build(db_session, DONE)
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.7, ELO_V)
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.4, FORM_V)
    assert grade(db_session) == 2
    assert {r.model_version for r in results(db_session)} == {ELO_V, FORM_V}
    assert grade(db_session) == 0 and len(results(db_session)) == 2


@pytest.mark.parametrize("status,winner", [
    ("finished", None), ("finished", "draw"), ("no_contest", None), ("finished", "nc"),
    ("cancelled", "a"), ("changed", "a"), ("live", "a"), ("scheduled", None),
])
def test_draw_no_contest_cancelled_changed_are_skipped(db_session, status, winner):
    built = build(db_session, DONE)
    bout = built.bouts[0]
    bout.status, bout.winner = status, winner
    add_row(db_session, bout, T - timedelta(days=1), 0.7)
    db_session.flush()
    assert grade(db_session) == 0 and results(db_session) == []


def test_dq_win_is_graded(db_session):
    built = build(db_session, [("2026-12-05T18:00", "A", "B", "b", "dq")])
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.7)
    assert grade(db_session) == 1
    r = results(db_session)[0]
    assert r.prob_assigned == pytest.approx(0.3) and r.winner_correct is False
    assert r.brier == pytest.approx(0.49)


def test_coin_flip_call_is_not_correct(db_session):
    built = build(db_session, DONE)
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.5)
    assert grade(db_session) == 1
    r = results(db_session)[0]
    assert r.winner_correct is False and r.log_loss == pytest.approx(0.693147, abs=1e-6)


def test_bout_without_any_time_is_not_graded(db_session):
    built = build(db_session, DONE)
    built.bouts[0].scheduled_utc = None
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.7)
    db_session.flush()
    assert grade(db_session) == 0


def test_cli_requires_a_flag():
    with pytest.raises(SystemExit):
        main([])


# ---- isolation, version guard, direct guard -------------------------------

TWO_OPEN = [
    ("2026-01-01", "A", "B", "a", "decision"),
    ("2026-12-05T18:00", "A", "C", None, None),
    ("2026-12-06T18:00", "B", "C", None, None),
]


def test_one_failing_candidate_does_not_stop_the_rest(db_session, monkeypatch, caplog):
    built = build(db_session, TWO_OPEN)
    real = mod.form_reasons
    boom = built.bouts[1].id

    def flaky(name_a, name_b, snap, contribs, p):
        if snap.bout_id == boom:
            raise ValueError("secret-row-detail")
        return real(name_a, name_b, snap, contribs, p)

    monkeypatch.setattr(mod, "form_reasons", flaky)
    with caplog.at_level(logging.INFO):
        s = generate(db_session, params, now=NOW)
    assert s.failed == 1 and rows_for(db_session, built.bouts[1]) == []
    assert len(rows_for(db_session, built.bouts[2])) == 2 and s.written == 2
    assert built.fighters["A"].rating == 1540.0 and s.ratings_updated == 2
    assert "ValueError" in caplog.text and "secret-row-detail" not in caplog.text


def test_one_failing_bout_does_not_stop_grading(db_session, monkeypatch):
    built = build(db_session, [
        ("2026-12-05T18:00", "A", "B", "a", "decision"),
        ("2026-12-06T18:00", "C", "D", "a", "decision"),
    ])
    for b in built.bouts:
        add_row(db_session, b, b.scheduled_utc - timedelta(days=1), 0.7)
    real = mod.lock_time
    monkeypatch.setattr(mod, "lock_time", lambda b: (_ for _ in ()).throw(KeyError("x")) if b.id == built.bouts[0].id else real(b))
    assert grade(db_session) == 1
    assert [r.bout_id for r in results(db_session)] == [built.bouts[1].id]


def test_elo_version_mismatch_writes_nothing(db_session, caplog):
    built = build(db_session, BASE)
    p = UfcParams(EloParams(k=80, history_from=1993, version="ufc-elo-v0.0"), _form())
    with caplog.at_level(logging.WARNING):
        s = generate(db_session, p, now=NOW)
    assert count(db_session) == 0 and s.written == 0 and s.ratings_updated == 0
    assert built.fighters["A"].rating == 1500.0  # column default, not the Elo update (1540)
    warns = [r for r in caplog.records if r.levelno >= logging.WARNING]
    assert len(warns) == 1 and "version" in warns[0].getMessage()
    assert "Lightweight" not in warns[0].getMessage()


def test_naive_now_is_accepted(db_session):
    build(db_session, BASE)
    s = generate(db_session, params, now=NOW.replace(tzinfo=None))
    assert s.written == 2


def test_write_guard_refuses_live_and_locked_bouts(db_session):
    built = build(db_session, [
        ("2026-12-05T18:00", "A", "B", None, None, {"status": "live"}),
        ("2026-12-05T18:00", "C", "D", None, None),
    ])
    live, sched = built.bouts
    assert _write_prediction(db_session, live, ELO_V, 0.6, {}, [], NOW) is False
    late = _utc(sched.scheduled_utc) + timedelta(minutes=1)
    assert _write_prediction(db_session, sched, ELO_V, 0.6, {}, [], late) is False
    assert count(db_session) == 0


def test_main_returns_nonzero_only_when_a_step_raises(monkeypatch):
    class FakeDb:
        rolled = 0
        def rollback(self): FakeDb.rolled += 1
        def close(self): pass
    import app.db
    monkeypatch.setattr(app.db, "SessionLocal", FakeDb)
    monkeypatch.setattr(mod, "generate", lambda db: mod.GenerateSummary(failed=3))
    monkeypatch.setattr(mod, "grade", lambda db: 0)
    assert main(["--generate", "--grade"]) == 0 and FakeDb.rolled == 0
    def raising(db): raise RuntimeError("x")
    monkeypatch.setattr(mod, "generate", raising)
    assert main(["--generate", "--grade"]) == 1 and FakeDb.rolled == 1


# ---- reconcile, query bound, tie-break ------------------------------------

def test_overturned_winner_regrades_the_same_row_in_place(db_session):
    built = build(db_session, DONE)
    bout = built.bouts[0]
    add_row(db_session, bout, T - timedelta(days=1), 0.7)
    assert grade(db_session) == 1
    before = results(db_session)[0]
    rid, pid = before.id, before.prediction_id
    bout.winner = "b"
    db_session.flush()
    s = grade_summary(db_session, now=T + timedelta(days=1))
    after = results(db_session)
    assert s.regraded == 1 and s.removed == 0 and s.written == 0 and len(after) == 1
    r = after[0]
    assert (r.id, r.prediction_id) == (rid, pid)
    assert r.prob_assigned == pytest.approx(0.3) and r.winner_correct is False
    assert r.brier == pytest.approx(0.49) and r.log_loss == pytest.approx(-math.log(0.3))
    assert _utc(r.evaluated_at) == T + timedelta(days=1)
    again = grade_summary(db_session, now=T + timedelta(days=2))
    assert (again.regraded, again.removed, again.written) == (0, 0, 0)


def test_result_removed_when_bout_no_longer_qualifies(db_session):
    built = build(db_session, DONE)
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.7)
    grade(db_session)
    built.bouts[0].winner = None
    db_session.flush()
    s = grade_summary(db_session, now=T + timedelta(days=1))
    assert s.removed == 1 and results(db_session) == []
    assert grade_summary(db_session, now=T + timedelta(days=2)).removed == 0


def test_bouts_older_than_thirty_days_are_not_reconciled(db_session):
    built = build(db_session, DONE)
    add_row(db_session, built.bouts[0], T - timedelta(days=1), 0.7)
    grade(db_session)
    built.bouts[0].winner = "b"
    db_session.flush()
    s = grade_summary(db_session, now=T + timedelta(days=31))
    assert s.regraded == 0 and results(db_session)[0].prob_assigned == pytest.approx(0.7)


def test_grade_query_count_does_not_grow_with_history(db_session):
    rows = [(f"2025-{1 + i // 28:02d}-{1 + i % 28:02d}", f"H{i}", f"I{i}", "a", "decision") for i in range(50)]
    rows += [("2026-12-05T18:00", "A", "B", "a", "decision"), ("2026-12-06T18:00", "C", "D", "b", "decision")]
    built = build(db_session, rows)
    for b in built.bouts[-2:]:
        add_row(db_session, b, b.scheduled_utc - timedelta(days=1), 0.6)
    db_session.commit()
    seen = []
    engine = db_session.get_bind()
    listener = lambda conn, cur, stmt, *a: seen.append(stmt)
    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert grade(db_session) == 2
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    # 1 reconcile + 1 bout select + 2 loads + 2 inserts + savepoints/commit; none depends on the 50 old bouts
    assert len(seen) <= 12, len(seen)


def test_identical_created_at_higher_id_counts(db_session):
    built = build(db_session, DONE)
    at = T - timedelta(days=1)
    add_row(db_session, built.bouts[0], at, 0.6)
    later = add_row(db_session, built.bouts[0], at, 0.8)
    assert grade(db_session) == 1
    assert results(db_session)[0].prediction_id == later.id
