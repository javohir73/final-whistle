"""Tests for the UFC walk-forward evaluation harness."""
from __future__ import annotations

import math
import random
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session, sessionmaker

import pipeline.sports.ufc_evaluate as ev
from app.db import Base
from app.models import UfcBout, UfcOddsSnapshot
from ml.sports.ufc.elo import EloParams
from ml.sports.ufc.params import load_params
from ml.sports.ufc.testkit import history as make_history
from pipeline.sports.ufc_evaluate import (
    calibration, devig, gate, implied, main, market_probs, picks_points,
    render_report, run, score, tune_elo,
)
from pipeline.sports.ufc_ingest import _utc
from pipeline.sports.ufc_testkit import build

UTC = timezone.utc


def test_implied_and_devig():
    assert implied(150) == pytest.approx(0.4) and implied(-200) == pytest.approx(2 / 3)
    assert devig(150, -200) == pytest.approx(0.375) and devig(50, -200) is None


def test_market_uses_latest_snapshot_before_start_averaged_over_sources(db_session):
    built = build(db_session, [("2026-01-01T18:00", "A", "B", "a", "decision")])
    bout = built.bouts[0]
    t = _utc(bout.scheduled_utc)
    for source, a, b, at in [
        ("DraftKings", 150, -200, t - timedelta(hours=2)),
        ("DraftKings", 300, -400, t + timedelta(hours=1)),
        ("Other", 100, -100, t - timedelta(days=1)),
        ("Bad", 50, -200, t - timedelta(hours=1)),
        ("ESPN Bet - Live Odds", -5000, 1500, t - timedelta(minutes=1)),
    ]:
        db_session.add(UfcOddsSnapshot(bout_id=bout.id, source=source, moneyline_a=a, moneyline_b=b, taken_at=at))
    db_session.flush()
    assert market_probs(db_session)[bout.id] == pytest.approx((0.375 + 0.5) / 2)


def test_score_by_hand():
    s = score([(0.8, 1), (0.4, 0)])
    assert (s.n, s.accuracy) == (2, 1.0) and s.brier == pytest.approx(0.1)
    assert s.log_loss == pytest.approx(0.366985, abs=1e-6)
    assert score([]) is None
    assert score([(0.5, 1)]).accuracy == 0.0


def test_calibration_buckets():
    rows = calibration([(0.52, 1), (0.3, 0)])
    assert [r[0] for r in rows] == ["50–55", "70–75"]
    assert rows[0][1:] == (1, pytest.approx(0.52), 1.0)
    assert rows[1][1:] == (1, pytest.approx(0.7), 1.0)


def test_picks_points():
    assert picks_points(0.7, "decision", "a", "decision") == 5 and picks_points(0.7, "ko_tko", "a", "decision") == 2
    assert picks_points(0.3, "decision", "a", "decision") == 0 and picks_points(0.5, "decision", "a", "decision") == 0
    assert picks_points(0.7, "decision", "a", "dq") == 2
    assert picks_points(0.3, "decision", "b", "decision") == 5


def test_gate():
    n = {2024: 500, 2025: 500, 2026: 400}
    ok, line = gate({2024: 0.68, 2025: 0.70, 2026: 0.69}, n, 0.234)
    assert ok and line == "PASS (log loss below 0.6931 in 2 of 3: 2024 2025 2026; pooled Brier 0.2340 <= 0.235)"
    assert not gate({2024: 0.68, 2025: 0.70, 2026: 0.69}, n, 0.236)[0]
    assert not gate({2024: 0.70, 2025: 0.70, 2026: 0.69}, n, 0.20)[0]
    ok, line = gate({2025: 0.60, 2026: 0.60}, {2025: 500, 2026: 500}, 0.20)
    assert not ok and line.startswith("FAIL") and "fewer than three" in line
    # a thin year is skipped, the three latest years with enough fights are used
    ok, line = gate({2023: 0.6, 2024: 0.6, 2025: 0.6, 2026: 0.7}, {2023: 300, 2024: 300, 2025: 300, 2026: 50}, 0.2)
    assert ok and "2023 2024 2025" in line


def test_tune_elo_picks_the_lowest_log_loss_and_breaks_ties_early(monkeypatch):
    # every bout is a debut pairing: no rating ever carries over, so k cannot matter
    rows = [(f"{2019 + i % 2}-0{1 + i // 2 % 9}-0{1 + i % 9}", f"A{i}", f"B{i}", "a", "decision") for i in range(8)]
    monkeypatch.setattr(ev, "ELO_GRID", {"k": (40.0, 80.0), "history_from": (1993,), "decay": (0.0,)})
    best = tune_elo(make_history(rows), (2019, 2020))
    assert best.k == 40.0
    # a repeated winner makes a larger k better
    rows = [(f"2019-0{1 + i}-01", "A", "B", "a", "decision") for i in range(8)]
    best = tune_elo(make_history(rows), (2019, 2019))
    assert best.k == 80.0 and isinstance(best, EloParams)


def _synthetic(db: Session) -> dict:
    """16 fighters with hidden skill, 60 bouts a year 2014-2024, a price on half of 2022-2024."""
    rng = random.Random(7)
    skill = {f"F{i}": rng.gauss(0, 1) for i in range(16)}
    names = list(skill)
    rows, priced = [], []
    start = date(2014, 1, 1)
    for n in range(60 * 11):
        d = start + timedelta(days=(n // 60) * 365 + (n % 60) * 6)
        a, b = rng.sample(names, 2)
        pa = 1 / (1 + math.exp(-(skill[a] - skill[b])))
        won = "a" if rng.random() < pa else "b"
        method = rng.choice(["ko_tko", "submission", "decision"])
        extra = {"stats_a": (rng.randint(5, 80), rng.randint(0, 4)), "stats_b": (rng.randint(5, 80), rng.randint(0, 4))}
        if method != "decision":
            extra.update(end_round=rng.randint(1, 3), end_clock=f"{rng.randint(0, 4)}:{rng.randint(10, 59)}")
        rows.append((f"{d.isoformat()}T18:00", a, b, won, method, extra))
        priced.append((d.year >= 2022 and rng.random() < 0.5, pa))
    built = build(db, rows)
    for bout, (has_price, pa) in zip(built.bouts, priced):
        if has_price:
            ml = lambda p: round(-100 * p / (1 - p)) if p > 0.5 else round(100 * (1 - p) / p)
            db.add(UfcOddsSnapshot(bout_id=bout.id, source="DraftKings", moneyline_a=ml(pa), moneyline_b=ml(1 - pa),
                                   taken_at=_utc(bout.scheduled_utc) - timedelta(hours=3)))
    db.flush()
    return {"scored_from_2022": sum(1 for b in built.bouts if b.scheduled_utc.year >= 2022),
            "priced_from_2022": sum(1 for _, (p, _) in zip(built.bouts, priced) if p)}


def _counts(db: Session) -> dict:
    from app import models
    return {t.__tablename__: db.scalar(select(func.count()).select_from(t))
            for t in vars(models).values() if hasattr(t, "__tablename__") and t.__tablename__.startswith("ufc_")}


def test_run_end_to_end_without_writing(db_session, tmp_path):
    truth = _synthetic(db_session)
    before = _counts(db_session)
    payload = run(db_session, first_holdout=2022, tune_years=(2017, 2019), validation_year=2020,
                  params_path=tmp_path / "p.json", now=datetime(2025, 3, 1, tzinfo=UTC))
    assert _counts(db_session) == before
    assert sorted(payload["years"]) == [2022, 2023, 2024]
    assert (payload["models"]["ufc-elo-v0.1"]["pooled"]["n"] == truth["scored_from_2022"]
            == payload["models"]["ufc-form-v0.2"]["pooled"]["n"])
    assert payload["market"]["n"] == truth["priced_from_2022"]
    # swapping a and b leaves the form model's result unchanged
    assert payload["swap"]["max_abs_diff"] < 1e-6
    report = render_report(payload)
    assert "GATE ufc-elo-v0.1:" in report and "GATE ufc-form-v0.2:" in report and "sqlite" not in report
    assert "—" not in report and "not fully blind" in report
    ly = payload["last_year"]
    if payload["market"]["by_year"].get(ly):
        n_p = payload["market"]["by_year"][ly]["market"]["n"]
        n_s = payload["models"][payload["elo_params"]["version"]]["by_year"][ly]["n"]
        assert f"{n_p:,} of that year's {n_s:,} scored fights are priced" in report
    assert load_params(tmp_path / "p.json").form is not None


def test_cli_writes_the_report(tmp_path):
    url = f"sqlite:///{tmp_path / 'u.db'}"
    engine = create_engine(url)
    Base.metadata.create_all(engine)
    with sessionmaker(bind=engine)() as s:
        _synthetic(s)
        s.commit()
    out = tmp_path / "report.md"
    assert main(["--db", url, "--out", str(out)]) == 0
    text = out.read_text()
    assert out.exists() and url not in text and str(tmp_path) not in text


def test_swap_check_detects_a_feature_that_is_not_antisymmetric(db_session, monkeypatch):
    import ml.sports.ufc.features as features

    _synthetic(db_session)
    real = features._features

    def lopsided(b, fa, fb):
        x = real(b, fa, fb)
        x["elo_diff"] += 30.0  # a bonus for whoever is listed first, so listing order leaks in
        return x

    monkeypatch.setattr(features, "_features", lopsided)
    payload = run(db_session, first_holdout=2022, tune_years=(2017, 2019), validation_year=2020)
    assert payload["swap"]["max_abs_diff"] > 0.01


def test_swap_history_swaps_sides_winner_and_stats():
    from pipeline.sports.ufc_evaluate import swap_history

    h = make_history([("2020-01-01", "A", "B", "a", "decision", {"stats_a": (10, 1), "stats_b": (5, 0)}),
                      ("2020-02-01", "A", "C", None, "draw")])
    s = swap_history(h)
    b0, s0 = h.bouts[0], s.bouts[0]
    assert (s0.fighter_a, s0.fighter_b, s0.winner) == (b0.fighter_b, b0.fighter_a, "b")
    assert (s0.stats_a, s0.stats_b) == (b0.stats_b, b0.stats_a)
    assert s.bouts[1].winner is None and s.fighters == h.fighters


@pytest.mark.parametrize("kwargs", [{"tune_years": (2018, 2022)}, {"validation_year": 2022}])
def test_run_refuses_settings_that_reach_the_held_out_years(db_session, kwargs):
    with pytest.raises(ValueError, match="held-out"):
        run(db_session, first_holdout=2022, **kwargs)
