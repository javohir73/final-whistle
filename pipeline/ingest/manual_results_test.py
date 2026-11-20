"""Tests for the reviewed manual-results list (pipeline/ingest/manual_results.py)."""
import logging
from datetime import date, datetime, timedelta, timezone

import pytest

from app.config import settings
from app.data_freshness import data_status, stuck_matches
from app.models import (
    HistoricalMatch,
    Match,
    Prediction,
    PredictionResult,
    Team,
    Tournament,
)
from pipeline.ingest import league_structure as ls_mod
from pipeline.ingest.fixture_contract import NormalizedFixture
from pipeline.ingest.league_structure import load_league_structure
from pipeline.ingest.manual_results import (
    MANUAL_PROVIDER,
    MANUAL_RESULTS,
    ManualResult,
    apply_manual_results,
    decide,
    entries_for,
)
from pipeline.learning_loop import evaluate_finished_predictions

UCL = "UEFA Champions League 2026-27"
NOW = datetime(2026, 11, 20, 6, 0, tzinfo=timezone.utc)
KICKOFF = datetime(2026, 8, 26, 19, 0, tzinfo=timezone.utc)
# Celje 1-2 Slovan Bratislava after extra time, 1-1 at 90'.
CELJE_SLOVAN = ManualResult("ucl", "Celje", "Slovan Bratislava", date(2026, 8, 26), 1, 2, 1, 1)


def _tournament(db) -> Tournament:
    t = Tournament(name=UCL, year=2026, host_countries="", home_advantage_mode="home")
    db.add(t)
    db.flush()
    return t


def _team(db, name) -> Team:
    team = Team(name=name, is_host=False)
    db.add(team)
    db.flush()
    return team


def _stuck(db, t, home, away, *, kickoff=KICKOFF, provider="api_football", fid=9001) -> Match:
    """A qualifying fixture the provider created and then stopped updating."""
    m = Match(
        tournament_id=t.id, stage="qualifying", is_neutral=False,
        team_home_id=home.id, team_away_id=away.id, kickoff_utc=kickoff,
        status="scheduled", fixture_provider=provider, provider_fixture_id=fid,
        provider_last_updated=kickoff - timedelta(days=8),
    )
    db.add(m)
    db.flush()
    return m


def _pred(db, m, created_at, *, home=0.45, draw=0.27, away=0.28, score=(2, 1),
          version="poisson-elo-ucl-v0.2") -> Prediction:
    p = Prediction(
        match_id=m.id, model_version=version, created_at=created_at,
        prob_home_win=home, prob_draw=draw, prob_away_win=away,
        predicted_score_home=score[0], predicted_score_away=score[1],
    )
    db.add(p)
    db.flush()
    return p


@pytest.fixture
def celje_slovan(db_session):
    t = _tournament(db_session)
    celje, slovan = _team(db_session, "Celje"), _team(db_session, "Slovan Bratislava")
    m = _stuck(db_session, t, celje, slovan)
    db_session.commit()
    return t, m


def _apply(db, t, entries=(CELJE_SLOVAN,), now=NOW):
    return apply_manual_results(db, t, "ucl", now=now, entries=tuple(entries))


# --- the reviewed list itself ---------------------------------------------


def test_list_is_the_fourteen_play_off_fixtures_with_unique_identities():
    ucl = entries_for("ucl")
    assert len(ucl) == len(MANUAL_RESULTS) == 14
    keys = {(e.competition, e.home, e.away, e.kickoff_date) for e in MANUAL_RESULTS}
    assert len(keys) == 14
    # Seven ties: every pairing appears once in each orientation.
    assert {(e.home, e.away) for e in ucl} == {(e.away, e.home) for e in ucl}


def test_extra_time_entries_are_exactly_the_three_aet_ties():
    for e in MANUAL_RESULTS:
        assert e.score_home >= e.score_home_90 and e.score_away >= e.score_away_90
    aet = {(e.home, e.away): (e.score_home, e.score_away, e.score_home_90, e.score_away_90)
           for e in MANUAL_RESULTS
           if (e.score_home, e.score_away) != (e.score_home_90, e.score_away_90)}
    assert aet == {
        ("Sabah FA", "Hapoel Beer Sheva"): (5, 2, 3, 2),
        ("Lask Linz", "Celtic"): (5, 1, 4, 1),
        ("Celje", "Slovan Bratislava"): (1, 2, 1, 1),
    }


@pytest.mark.parametrize("status,score,provider,expected", [
    ("scheduled", (None, None), "api_football", "apply"),
    ("scheduled", (1, 2), "api_football", "not_eligible"),
    ("in_play", (1, 1), "api_football", "not_eligible"),
    ("postponed", (None, None), "api_football", "not_eligible"),
    ("finished", (1, 2), MANUAL_PROVIDER, "already_applied"),
    ("finished", (1, 2), "football_data", "provider_agrees"),
    ("finished", (0, 2), "football_data", "conflict"),
    ("finished", (0, 2), MANUAL_PROVIDER, "conflict"),
])
def test_decide(status, score, provider, expected):
    assert decide(CELJE_SLOVAN, status=status, score_home=score[0],
                  score_away=score[1], fixture_provider=provider) == expected


# --- applying -------------------------------------------------------------


def test_finishes_a_stuck_fixture_with_explicit_provenance(db_session, celje_slovan):
    t, m = celje_slovan
    summary = _apply(db_session, t)
    db_session.commit()

    assert summary == {"entries": 1, "applied": 1, "already_applied": 0,
                       "provider_agrees": 0, "conflicts": 0, "skipped": 0}
    db_session.refresh(m)
    assert m.status == "finished"
    assert (m.score_home, m.score_away) == (1, 2)
    assert (m.score_home_90, m.score_away_90) == (1, 1)
    assert m.fixture_provider == MANUAL_PROVIDER
    assert m.provider_fixture_id == 9001  # the creating feed's id, kept for tracing
    assert db_session.query(Match).filter_by(fixture_provider=MANUAL_PROVIDER).count() == 1


def test_second_run_is_a_no_op(db_session, celje_slovan):
    t, m = celje_slovan
    _apply(db_session, t)
    db_session.commit()
    summary = _apply(db_session, t)
    assert summary["applied"] == 0
    assert summary["already_applied"] == 1
    assert not db_session.dirty


def test_shape_matches_a_provider_finished_extra_time_match(db_session, monkeypatch):
    """A manual row differs from a provider-finished AET row only in provenance."""
    def fixture(fid, home, away, kickoff, status, final=None, ninety=None):
        return NormalizedFixture(
            provider="football_data", fixture_id=fid, home_name=home, away_name=away,
            kickoff_utc=kickoff, status=status,
            score_home=final[0] if final else None, score_away=final[1] if final else None,
            matchweek=None,
            score_home_90=ninety[0] if ninety else None,
            score_away_90=ninety[1] if ninety else None,
            venue_name=None, venue_city=None, round_label="PLAYOFFS",
            upstream_updated_at=None, home_provider_id=None, away_provider_id=None,
        )

    first_leg = datetime(2026, 8, 19, 19, 0, tzinfo=timezone.utc)
    fixtures = [
        fixture(1, "Celje", "Slovan Bratislava", KICKOFF, "finished", (1, 2), (1, 1)),
        fixture(2, "Slovan Bratislava", "Celje", first_leg, "scheduled"),
    ]
    monkeypatch.setattr(ls_mod, "fetch_league_fixtures", lambda *a, **k: fixtures)
    load_league_structure(
        db_session, teams_file=None, api_key="x", tournament_name=UCL,
        group_name="Champions League", group_round_prefixes=("League",),
        fixture_source="football_data", competition_code="CL",
    )
    t = db_session.query(Tournament).filter_by(name=UCL).one()
    provider_row = db_session.query(Match).filter_by(provider_fixture_id=1).one()
    manual_row = db_session.query(Match).filter_by(provider_fixture_id=2).one()

    entry = ManualResult("ucl", "Slovan Bratislava", "Celje", first_leg.date(), 1, 2, 1, 1)
    assert _apply(db_session, t, entries=[entry])["applied"] == 1
    db_session.commit()

    identity = {"id", "team_home_id", "team_away_id", "kickoff_utc",
                "provider_fixture_id", "fixture_provider"}
    columns = [c.key for c in Match.__table__.columns if c.key not in identity]
    db_session.refresh(provider_row)
    db_session.refresh(manual_row)
    assert {c: getattr(manual_row, c) for c in columns} == {
        c: getattr(provider_row, c) for c in columns
    }
    assert (provider_row.fixture_provider, manual_row.fixture_provider) == (
        "football_data", MANUAL_PROVIDER,
    )


def test_resolves_names_through_team_mapping(db_session):
    t = _tournament(db_session)
    lask, celtic = _team(db_session, "Lask Linz"), _team(db_session, "Celtic")
    m = _stuck(db_session, t, lask, celtic, kickoff=datetime(2026, 8, 25, 19, 0, tzinfo=timezone.utc))
    entry = ManualResult("ucl", "LASK", "Celtic", date(2026, 8, 25), 5, 1, 4, 1)  # alias spelling
    assert _apply(db_session, t, entries=[entry])["applied"] == 1
    assert m.status == "finished"


# --- refusing to guess ----------------------------------------------------


def test_unresolvable_team_is_skipped_with_a_warning(db_session, celje_slovan, caplog):
    t, m = celje_slovan
    entry = ManualResult("ucl", "Celje", "Slovan Bratislava Typo", date(2026, 8, 26), 1, 2, 1, 1)
    with caplog.at_level(logging.WARNING):
        summary = _apply(db_session, t, entries=[entry])
    assert summary["skipped"] == 1 and summary["applied"] == 0
    assert "Slovan Bratislava Typo" in caplog.text
    assert m.status == "scheduled"


def test_no_candidate_on_that_date_is_skipped(db_session, celje_slovan, caplog):
    t, m = celje_slovan
    entry = ManualResult("ucl", "Celje", "Slovan Bratislava", date(2026, 8, 27), 1, 2, 1, 1)
    with caplog.at_level(logging.WARNING):
        summary = _apply(db_session, t, entries=[entry])
    assert summary["skipped"] == 1
    assert "0 candidate matches" in caplog.text
    assert m.status == "scheduled"


def test_reversed_orientation_is_not_a_candidate(db_session, celje_slovan):
    t, m = celje_slovan
    entry = ManualResult("ucl", "Slovan Bratislava", "Celje", date(2026, 8, 26), 2, 1, 1, 1)
    assert _apply(db_session, t, entries=[entry])["skipped"] == 1
    assert m.status == "scheduled"


def test_two_candidates_are_ambiguous_and_skipped(db_session, celje_slovan, caplog):
    t, m = celje_slovan
    twin = _stuck(db_session, t, db_session.get(Team, m.team_home_id),
                  db_session.get(Team, m.team_away_id), provider="football_data", fid=77)
    with caplog.at_level(logging.WARNING):
        summary = _apply(db_session, t)
    assert summary["skipped"] == 1
    assert "2 candidate matches" in caplog.text
    assert m.status == twin.status == "scheduled"


def test_other_tournament_is_never_searched(db_session, celje_slovan):
    _t, m = celje_slovan
    other = Tournament(name="Some Other Cup", year=2026, host_countries="")
    db_session.add(other)
    db_session.flush()
    assert _apply(db_session, other)["skipped"] == 1
    assert m.status == "scheduled"


def test_fixture_not_yet_kicked_off_is_skipped(db_session, celje_slovan):
    t, m = celje_slovan
    assert _apply(db_session, t, now=KICKOFF - timedelta(hours=1))["skipped"] == 1
    assert m.status == "scheduled"


def test_in_play_row_is_left_alone(db_session, celje_slovan):
    t, m = celje_slovan
    m.status, m.score_home, m.score_away = "in_play", 0, 0
    assert _apply(db_session, t)["skipped"] == 1
    assert (m.status, m.score_home, m.score_away) == ("in_play", 0, 0)
    assert m.fixture_provider == "api_football"


# --- never overriding a provider ------------------------------------------


def test_never_overwrites_a_provider_result(db_session, celje_slovan, caplog):
    t, m = celje_slovan
    m.status, m.score_home, m.score_away = "finished", 0, 3
    m.score_home_90, m.score_away_90 = 0, 3
    db_session.commit()
    with caplog.at_level(logging.ERROR):
        summary = _apply(db_session, t)
    assert summary["conflicts"] == 1 and summary["applied"] == 0
    assert "DISAGREES" in caplog.text
    assert (m.score_home, m.score_away, m.score_home_90) == (0, 3, 0)
    assert m.fixture_provider == "api_football"


def test_provider_agreeing_is_counted_not_rewritten(db_session, celje_slovan):
    t, m = celje_slovan
    m.status, m.score_home, m.score_away = "finished", 1, 2
    db_session.commit()
    summary = _apply(db_session, t)
    assert summary["provider_agrees"] == 1
    assert m.fixture_provider == "api_football"
    assert m.score_home_90 is None  # untouched: the provider's row is its own


def test_a_later_provider_result_wins_over_the_manual_one(db_session, celje_slovan, monkeypatch, caplog):
    """If a feed ever does carry the match, its ingest overwrites the manual
    row (provider wins) and the manual step then reports the disagreement."""
    t, m = celje_slovan
    _apply(db_session, t)
    db_session.commit()
    monkeypatch.setattr(ls_mod, "fetch_league_fixtures", lambda *a, **k: [NormalizedFixture(
        provider="football_data", fixture_id=555, home_name="Celje",
        home_provider_id=None, away_name="Slovan Bratislava", away_provider_id=None,
        kickoff_utc=KICKOFF, status="finished", score_home=2, score_away=2,
        score_home_90=None, score_away_90=None, matchweek=None, venue_name=None,
        venue_city=None, round_label="PLAYOFFS",
        upstream_updated_at=datetime(2026, 11, 21, tzinfo=timezone.utc),
    )])
    load_league_structure(
        db_session, teams_file=None, api_key="x", tournament_name=UCL,
        group_name="Champions League", group_round_prefixes=("League",),
        fixture_source="football_data", competition_code="CL",
    )
    db_session.refresh(m)
    assert (m.fixture_provider, m.score_home, m.score_away) == ("football_data", 2, 2)

    with caplog.at_level(logging.ERROR):
        assert _apply(db_session, t)["conflicts"] == 1
    assert "DISAGREES" in caplog.text
    assert (m.score_home, m.score_away) == (2, 2)


# --- grading, history, health ---------------------------------------------


def test_only_the_pre_kickoff_prediction_is_graded_on_the_after_et_result(db_session, celje_slovan):
    t, m = celje_slovan
    frozen = _pred(db_session, m, datetime(2026, 8, 18, 7, 57, tzinfo=timezone.utc),
                   home=0.4548, draw=0.2657, away=0.2795, score=(1, 1))
    for i in range(70):  # rows written after kickoff while the fixture sat "scheduled"
        _pred(db_session, m, KICKOFF + timedelta(days=1, hours=i), home=0.1, draw=0.1,
              away=0.8, score=(0, 3))
    _apply(db_session, t)
    db_session.commit()

    assert evaluate_finished_predictions(db_session, "poisson-elo-ucl-v0.2") == 1
    row = db_session.query(PredictionResult).filter_by(match_id=m.id).one()
    assert row.prediction_id == frozen.id
    assert (row.actual_score_home, row.actual_score_away) == (1, 2)
    assert row.outcome == "away"  # winner basis: after extra time
    assert row.winner_correct is False
    assert row.exact_score_correct is True  # 1-1 pick vs 1-1 at 90'
    assert row.prob_assigned == pytest.approx(0.2795)
    assert evaluate_finished_predictions(db_session, "poisson-elo-ucl-v0.2") == 0


def test_manually_finished_match_clears_the_stale_fixture_check(db_session, celje_slovan):
    t, m = celje_slovan
    assert [r["match_id"] for r in stuck_matches(db_session, now=NOW)] == [m.id]
    assert "stale_fixture" in {d["kind"] for d in data_status(db_session, now=NOW)["degradations"]}

    _apply(db_session, t)
    db_session.commit()

    assert stuck_matches(db_session, now=NOW) == []
    assert "stale_fixture" not in {
        d["kind"] for d in data_status(db_session, now=NOW)["degradations"]
    }


def test_pipeline_finishes_grades_once_and_records_history_once(db_session, monkeypatch):
    """End to end through the daily league path: a stuck UCL play-off fixture
    with one pre-kickoff prediction and many post-kickoff rows."""
    from pipeline import compute_club_elo as club_elo_mod
    from pipeline import league_activation as activation_mod
    from pipeline import leagues as leagues_mod
    from pipeline.run_pipeline import run_pipeline

    monkeypatch.setattr(settings, "pipeline_target", "league")
    monkeypatch.setattr(leagues_mod, "ACTIVE_LEAGUES", ["ucl"])
    monkeypatch.setattr(activation_mod, "ensure_club_history", lambda _db, cfg: {"matches": 0})
    monkeypatch.setattr(club_elo_mod, "unrated_roster_teams", lambda *_a: [])
    # football-data.org: carries the league phase, never the qualifying rounds.
    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: [])

    t = _tournament(db_session)
    fener, lyon = _team(db_session, "Fenerbahçe"), _team(db_session, "Lyon")
    kickoff = datetime(2026, 8, 18, 19, 0, tzinfo=timezone.utc)
    m = _stuck(db_session, t, fener, lyon, kickoff=kickoff)
    frozen = _pred(db_session, m, datetime(2026, 8, 18, 7, 57, tzinfo=timezone.utc),
                   home=0.564, draw=0.2526, away=0.1834, score=(1, 0))
    for i in range(70):
        _pred(db_session, m, kickoff + timedelta(days=1 + i), home=0.2, draw=0.2, away=0.6)
    db_session.commit()
    predictions_before = db_session.query(Prediction).filter_by(match_id=m.id).count()

    run_at = datetime(2026, 11, 20, 6, 0, tzinfo=timezone.utc)
    summary = run_pipeline(db_session, n_sims=10, kickoff_after=run_at)

    assert summary["manual_results"]["applied"] == 1
    # The other thirteen entries name clubs this database does not have.
    assert summary["manual_results"]["skipped"] == 13
    assert summary["league_results_sync"]["matches_inserted"] == 1
    db_session.refresh(m)
    assert (m.status, m.score_home, m.score_away, m.fixture_provider) == (
        "finished", 1, 1, MANUAL_PROVIDER,
    )
    result = db_session.query(PredictionResult).filter_by(match_id=m.id, is_shadow=False).one()
    assert result.prediction_id == frozen.id
    assert result.outcome == "draw" and result.winner_correct is False
    history = db_session.query(HistoricalMatch).filter_by(
        competition="UEFA Champions League", team_a_id=fener.id, team_b_id=lyon.id,
    ).all()
    assert [(h.score_a, h.score_b) for h in history] == [(1, 1)]
    # Finishing the match created no prediction for it.
    assert db_session.query(Prediction).filter_by(match_id=m.id).count() == predictions_before

    again = run_pipeline(db_session, n_sims=10, kickoff_after=run_at)
    assert again["manual_results"]["applied"] == 0
    assert again["manual_results"]["already_applied"] == 1
    assert again["league_results_sync"]["matches_inserted"] == 0
    assert db_session.query(PredictionResult).filter_by(match_id=m.id, is_shadow=False).count() == 1
    assert db_session.query(HistoricalMatch).filter_by(
        competition="UEFA Champions League", team_a_id=fener.id, team_b_id=lyon.id,
    ).count() == 1
    assert db_session.query(Prediction).filter_by(match_id=m.id).count() == predictions_before


def test_pipeline_emits_no_manual_step_for_a_league_without_entries(db_session, monkeypatch):
    from pipeline import compute_club_elo as club_elo_mod
    from pipeline import league_activation as activation_mod
    from pipeline import leagues as leagues_mod
    from pipeline.run_pipeline import run_pipeline

    monkeypatch.setattr(settings, "pipeline_target", "league")
    monkeypatch.setattr(leagues_mod, "ACTIVE_LEAGUES", ["epl"])
    monkeypatch.setattr(activation_mod, "ensure_club_history", lambda _db, cfg: {"matches": 0})
    monkeypatch.setattr(club_elo_mod, "unrated_roster_teams", lambda *_a: [])
    monkeypatch.setattr(ls_mod, "fetch_fixtures", lambda *a, **k: [])
    summary = run_pipeline(db_session, n_sims=10)
    assert "manual_results" not in summary
