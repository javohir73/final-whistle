"""UCL unified-Elo shadow variants end to end (synthetic DB, no network):
identity mapping from DB teams, fail-closed fetch, per-variant strengths
isolation, tags, env parsing, and the frozen C3 calibrator."""
from __future__ import annotations

import json
from dataclasses import replace
from datetime import datetime, timezone

import pytest

from app.models import Group, GroupTeam, HistoricalMatch, Match, Prediction, Team, Tournament
from ml.evaluation.calibration import apply_vector_scaling, calibrate
from pipeline import ucl_unified_elo as U
from pipeline.generate_predictions import generate_predictions, variant_model_version_for
from pipeline.leagues import (
    LEAGUES,
    STRENGTH_SHADOW_VARIANTS,
    club_params_for,
    club_shadow_variants_for,
    enabled_shadow_variants,
)
from pipeline.run_pipeline import _strength_variants
from pipeline.ucl_unified_elo_test import AUT, E0_2627, _fake_get

CFG = LEAGUES["ucl"]
SERVED = CFG["model_version"]
NAMES = ["Arsenal", "Real Madrid", "Inter", "Sabah FA", "Viking", "Lens", "Unlisted FC", "Napoli"]


def _seed_ucl(db):
    t = Tournament(name=CFG["tournament_name"], year=2026, host_countries="",
                   home_advantage_mode="home")
    teams = [Team(name=n) for n in NAMES]
    db.add_all([t, *teams])
    db.flush()
    g = Group(tournament_id=t.id, name=CFG["group_name"])
    db.add(g)
    db.flush()
    db.add_all(GroupTeam(group_id=g.id, team_id=x.id) for x in teams)
    by = {x.name: x.id for x in teams}
    for i, (h, a) in enumerate([("Arsenal", "Real Madrid"), ("Inter", "Sabah FA"),
                                ("Viking", "Lens"), ("Unlisted FC", "Napoli")]):
        db.add(Match(tournament_id=t.id, group_id=g.id, stage="group", matchweek=6,
                     team_home_id=by[h], team_away_id=by[a], is_neutral=False,
                     kickoff_utc=datetime(2099, 1, 1 + i, 20, tzinfo=timezone.utc),
                     status="scheduled"))
    comp = CFG["club_competition"]

    def hist(day, h, a, sh, sa, neutral=False):
        db.add(HistoricalMatch(date=datetime.fromisoformat(day).replace(tzinfo=timezone.utc),
                               team_a_id=by[h], team_b_id=by[a], score_a=sh, score_b=sa,
                               competition=comp, is_neutral=neutral))

    hist("2026-05-30", "Arsenal", "Inter", 5, 0)         # pre-cutoff: already in the snapshot, ignored
    hist("2026-09-08", "Sabah FA", "Viking", 2, 0)
    hist("2026-09-09", "Unlisted FC", "Lens", 1, 1)
    db.commit()
    return by


@pytest.fixture
def ucl_db(db_session):
    return db_session, _seed_ucl(db_session)


def _compute(db, get=None):
    return U.compute_unified_strengths(
        db, tournament_name=CFG["tournament_name"], competition=CFG["club_competition"],
        get=get or _fake_get())


# --- identity / continuation from the DB --------------------------------------

def test_db_teams_are_mapped_explicitly_and_unmapped_ones_are_reported(ucl_db):
    db, by = ucl_db
    res = _compute(db)
    assert res is not None
    assert res.unmapped == ["Unlisted FC"]
    assert set(res.strengths) == set(by.values())
    assert res.summary()["unmapped"] == ["Unlisted FC"]
    # an unmapped club is a no-feed club: shrunk toward the 1450 prior, not left out
    assert res.strengths[by["Unlisted FC"]] == pytest.approx(1450.0, abs=5.0)


def test_continuation_uses_only_post_cutoff_db_rows_and_current_season_domestic(ucl_db):
    db, by = ucl_db
    res = _compute(db)
    # replay by hand: snapshot + the two current-season domestic rows + two UCL rows
    st = U.load_snapshot()
    st.apply([
        U.Event("2026-08-15", "E0", "2627", "ENG:Arsenal", "ENG:Chelsea", 2, 1),
        U.Event("2026-08-02", "AUT", "2627", "AUT:LASK", "AUT:Salzburg", 2, 2),
        U.Event("2026-09-08", "UCL", "ucl", "AZE:Sabah FA", "NOR:Viking", 2, 0),
        U.Event("2026-09-09", "UCL", "ucl", "UNMAPPED:Unlisted FC", "FRA:Lens", 1, 1),
    ])
    for name, key in (("Arsenal", "ENG:Arsenal"), ("Sabah FA", "AZE:Sabah FA"),
                      ("Lens", "FRA:Lens"), ("Unlisted FC", "UNMAPPED:Unlisted FC")):
        assert res.strengths[by[name]] == st.used(key), name
    assert (res.domestic_events, res.ucl_events) == (2, 2)


def test_result_is_deterministic(ucl_db):
    db, _ = ucl_db
    assert _compute(db).strengths == _compute(db).strengths


@pytest.mark.parametrize("failure", ["network", "bad_csv", "bad_snapshot", "no_tournament"])
def test_every_failure_mode_returns_none_without_raising(ucl_db, tmp_path, failure):
    db, _ = ucl_db
    get = None
    if failure == "network":
        def get(url):
            raise TimeoutError("boom")
    elif failure == "bad_csv":
        get = _fake_get({U.AUT_URL: b"garbage"})
    elif failure == "bad_snapshot":
        assert U.compute_unified_strengths(
            db, tournament_name=CFG["tournament_name"], competition=CFG["club_competition"],
            get=_fake_get(), snapshot_path=tmp_path / "missing.json") is None
        return
    elif failure == "no_tournament":
        assert U.compute_unified_strengths(db, tournament_name="nope", competition="x",
                                           get=_fake_get()) is None
        return
    assert _compute(db, get) is None


# --- fail closed: served rows byte-identical when the variants are skipped -----

def _served_rows(db):
    return sorted(
        (p.match_id, p.prob_home_win, p.prob_draw, p.prob_away_win, p.lambda_home, p.lambda_away,
         p.predicted_score_home, p.predicted_score_away)
        for p in db.query(Prediction).filter_by(model_version=SERVED, is_shadow=False).all())


def _run(db, variants, variant_strengths, base=None):
    return generate_predictions(
        db, SERVED, n_sims=30, tournament_sims=10,
        tournament_id=db.query(Tournament).one().id, params=club_params_for("ucl"),
        shadow_variants=variants, shadow_variant_base_strengths=variant_strengths,
        base_strengths=base)


def _wipe(db):
    for p in db.query(Prediction).all():
        db.delete(p)
    db.commit()


def test_fetch_failure_skips_the_unified_variants_and_leaves_served_rows_identical(ucl_db, monkeypatch):
    db, by = ucl_db
    base = {i: 1500.0 + 20 * k for k, i in enumerate(by.values())}
    _run(db, {}, None, base)
    clean = _served_rows(db)
    _wipe(db)

    def boom(url):
        raise OSError("down")

    monkeypatch.setattr(U, "_http_get", boom)
    steps = {}
    variants = club_shadow_variants_for("ucl", env_value="ucl:unified,ucl:unified_cal")
    assert set(variants) == {"unified", "unified_cal"}
    kept, vs = _strength_variants(db, lambda name, fn: steps.setdefault(name, fn()), "ucl", CFG, variants)
    assert kept == {} and vs is None
    assert steps["ucl_unified_elo"]["status"] == "skipped"
    _run(db, kept, vs, base)
    assert _served_rows(db) == clean
    assert db.query(Prediction).filter(Prediction.model_version.like("%+unified%")).count() == 0


def test_success_supplies_each_unified_variant_its_own_strengths(ucl_db, monkeypatch):
    db, by = ucl_db
    monkeypatch.setattr(U, "_http_get", _fake_get())
    variants = club_shadow_variants_for("ucl", env_value="ucl:unified,ucl:unified_cal")
    steps = {}
    kept, vs = _strength_variants(db, lambda name, fn: steps.setdefault(name, fn()), "ucl", CFG, variants)
    assert set(kept) == {"unified", "unified_cal"} and set(vs) == {"unified", "unified_cal"}
    assert steps["ucl_unified_elo"]["status"] == "ok"
    assert steps["ucl_unified_elo"]["unmapped"] == ["Unlisted FC"]


def test_non_strength_variants_pass_through_untouched(ucl_db):
    db, _ = ucl_db
    sentinel = {"cal_q3": object()}
    kept, vs = _strength_variants(db, None, "bundesliga", LEAGUES["bundesliga"], sentinel)
    assert kept is sentinel and vs is None


# --- per-variant strengths isolation -------------------------------------------

def _probs(db, version):
    return {p.match_id: (p.prob_home_win, p.prob_draw, p.prob_away_win)
            for p in db.query(Prediction).filter_by(model_version=version).all()}


def test_a_variants_own_base_ratings_move_only_its_own_row(ucl_db):
    db, by = ucl_db
    base = {i: 1500.0 + 15 * k for k, i in enumerate(by.values())}
    served = club_params_for("ucl")
    _run(db, {}, None, base)
    clean = _served_rows(db)
    _wipe(db)

    # "same" gets exactly production's base map; "shifted" gets a different one;
    # "plain" has no map and must price from production strengths.
    shifted = {i: r + (200.0 if k % 2 else -200.0) for k, (i, r) in enumerate(base.items())}
    _run(db, {"same": served, "shifted": served, "plain": served},
         {"same": dict(base), "shifted": shifted}, base)

    assert _served_rows(db) == clean                      # production untouched
    prod = _probs(db, SERVED)
    same = _probs(db, variant_model_version_for(SERVED, "same"))
    plain = _probs(db, variant_model_version_for(SERVED, "plain"))
    shifted_p = _probs(db, variant_model_version_for(SERVED, "shifted"))
    assert prod and same == prod and plain == prod        # wrapping identical; base is the only lever
    assert shifted_p != prod
    assert all(p.is_shadow for p in db.query(Prediction).filter(
        Prediction.model_version.like(f"{SERVED}+%")).all())


def test_existing_calibrator_variant_path_is_unchanged_without_strength_maps(ucl_db):
    db, by = ucl_db
    base = {i: 1500.0 + 15 * k for k, i in enumerate(by.values())}
    cal = club_shadow_variants_for("ucl", env_value="ucl:unified_cal")["unified_cal"]
    _run(db, {"unified_cal": cal}, None, base)
    assert _probs(db, f"{SERVED}+unified_cal")


# --- tags / env / registry ------------------------------------------------------

def test_tags_and_env_parsing():
    assert variant_model_version_for(SERVED, "unified") == "poisson-elo-ucl-v0.2+unified"
    assert variant_model_version_for(SERVED, "unified_cal") == "poisson-elo-ucl-v0.2+unified_cal"
    assert enabled_shadow_variants("ucl:unified,ucl:unified_cal") == {"ucl": {"unified", "unified_cal"}}
    assert enabled_shadow_variants("ucl:unified_cal") == {"ucl": {"unified_cal"}}
    assert enabled_shadow_variants("ucl:nope,epl:unified,unified") == {}
    assert enabled_shadow_variants("") == {} and enabled_shadow_variants(None) == {}
    assert enabled_shadow_variants("bundesliga:cal_q3,ucl:unified") == {
        "bundesliga": {"cal_q3"}, "ucl": {"unified"}}
    assert STRENGTH_SHADOW_VARIANTS["ucl"] == {"unified", "unified_cal"}


def test_the_workflow_enables_exactly_the_two_ucl_shadows_in_code():
    from pathlib import Path

    text = (Path(__file__).resolve().parents[1] / ".github/workflows/refresh.yml").read_text()
    assert 'CLUB_SHADOW_VARIANTS: "ucl:unified,ucl:unified_cal"' in text
    assert text.count("CLUB_SHADOW_VARIANTS") == 1


def test_unified_variant_changes_nothing_but_the_ratings_and_unified_cal_adds_the_calibrator():
    served = club_params_for("ucl")
    v = club_shadow_variants_for("ucl", env_value="ucl:unified,ucl:unified_cal")
    assert v["unified"] == served
    assert replace(v["unified_cal"], calibrator=served.calibrator) == served
    assert v["unified_cal"].calibrator["method"] == "vector_scaling"
    assert (v["unified_cal"].calibrator["t"], v["unified_cal"].calibrator["b"]) == (1.2, [0.0, -0.1, -0.1])


def test_c3_calibrator_reproduces_the_experiments_vector_scaling_exactly():
    """experiment.p_c3 = apply_vector_scaling(raw, t, b); the variant must route
    through calibrate() to the very same function with the temperature ignored."""
    frozen = json.loads((__import__("pathlib").Path(__file__).resolve().parents[1]
                         / "docs/experiments/2026-11-27-ucl-rating-scale/frozen.json").read_text())
    c3 = frozen["C3_unified_cal"]
    cal = club_shadow_variants_for("ucl", env_value="ucl:unified_cal")["unified_cal"].calibrator
    assert (cal["t"], cal["b"]) == (c3["t"], c3["b"])
    served = club_params_for("ucl")
    assert served.temperature == 1.0
    for raw in [(0.62, 0.23, 0.15), (0.2, 0.3, 0.5), (0.45, 0.30, 0.25)]:
        want = apply_vector_scaling(raw, c3["t"], tuple(c3["b"]))
        assert calibrate(raw, cal, served.temperature, eff_gap=123.0) == want
