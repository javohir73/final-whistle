import hashlib
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker

from app.db import Base
from app.models import (
    AppUser,
    Group,
    GroupTeam,
    HistoricalMatch,
    LearningChainStatus,
    LeagueScorePrediction,
    LineupPlayer,
    MarketOddsSnapshot,
    Match,
    MatchLineup,
    MatchPick,
    Odds,
    Prediction,
    PredictionResult,
    ProbabilitySnapshot,
    Standing,
    Team,
    TeamTournamentState,
    TipPlayer,
    Tournament,
    VenueMarket,
)
from app.serializers import latest_prediction
from pipeline.generate_predictions import shadow_model_version_for
from pipeline.ingest import league_structure as ls_mod
from pipeline.ingest.club_results import sync_finished_matches_to_history
from pipeline.ingest.fixture_contract import NormalizedFixture
from pipeline.ingest.league_structure import load_league_structure
from pipeline.learning_loop import _frozen_prediction
from app.chain_status import chain_pending
import pipeline.repair_fixture_duplicates as repair_mod
from pipeline.repair_fixture_duplicates_undo import undo_from_evidence
from pipeline.repair_fixture_duplicates import (
    DuplicateRepairError,
    MatchMerge,
    RepairRefused,
    TeamMerge,
    main,
    parse_acknowledgements,
    parse_on_conflict,
    repair_fixture_duplicates,
    report_json,
)


@pytest.fixture
def db_session():
    """The shared fixture's engine leaves SQLite foreign keys off; turn them
    on here so delete/re-point ordering is enforced as it is on Postgres."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, future=True)
    event.listen(engine, "connect",
                 lambda conn, _record: conn.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(engine)
    session = sessionmaker(bind=engine, future=True)()
    assert session.execute(text("PRAGMA foreign_keys")).scalar() == 1
    try:
        yield session
    finally:
        session.close()


KICKOFF = datetime(2026, 8, 24, 19, 30, tzinfo=timezone.utc)
SERVED = "poisson-elo-club-v0.1"
SHADOW = shadow_model_version_for(SERVED)
COMPETITION = "La Liga"


def _seed_duplicate(db_session, *, donor_kickoff=KICKOFF):
    tournament = Tournament(name="La Liga 2026-27", year=2026)
    group = Group(tournament=tournament, name="La Liga")
    malaga = Team(name="Malaga", provider_team_id=1200)
    canonical = Team(name="Deportivo La Coruna", provider_team_id=1201)
    duplicate = Team(name="RC Deportivo La Coruña")
    db_session.add_all([tournament, group, malaga, canonical, duplicate])
    db_session.flush()
    db_session.add_all([
        GroupTeam(group_id=group.id, team_id=canonical.id),
        GroupTeam(group_id=group.id, team_id=duplicate.id),
        Standing(group_id=group.id, team_id=canonical.id, points=7),
        Standing(group_id=group.id, team_id=duplicate.id, points=0),
        TeamTournamentState(team_id=canonical.id),
        TeamTournamentState(team_id=duplicate.id),
    ])
    legacy = Match(
        tournament_id=tournament.id,
        group_id=group.id,
        stage="group",
        team_home_id=malaga.id,
        team_away_id=canonical.id,
        kickoff_utc=KICKOFF,
        status="scheduled",
        fixture_provider="api_football",
        provider_fixture_id=2001,
        matchweek=2,
        is_neutral=False,
    )
    provider = Match(
        tournament_id=tournament.id,
        group_id=group.id,
        stage="group",
        team_home_id=malaga.id,
        team_away_id=duplicate.id,
        kickoff_utc=donor_kickoff,
        status="finished",
        score_home=1,
        score_away=1,
        score_home_90=1,
        score_away_90=1,
        fixture_provider="football_data",
        provider_fixture_id=564640,
        provider_last_updated=datetime(2026, 8, 25, tzinfo=timezone.utc),
        matchweek=2,
        is_neutral=False,
    )
    db_session.add_all([legacy, provider])
    db_session.flush()
    return tournament, group, canonical, duplicate, legacy, provider


def _prediction(match_id, *, shadow=False, created_at=None, version=None):
    return Prediction(
        match_id=match_id,
        model_version=version or (SHADOW if shadow else SERVED),
        prob_home_win=0.4,
        prob_draw=0.3,
        prob_away_win=0.3,
        predicted_score_home=1,
        predicted_score_away=1,
        is_shadow=shadow,
        created_at=created_at or KICKOFF - timedelta(days=1),
    )


def _grade(match_id, prediction, *, shadow=False, score=(1, 1)):
    home, away = score
    return PredictionResult(
        match_id=match_id,
        prediction_id=prediction.id,
        model_version=prediction.model_version,
        is_shadow=shadow,
        actual_score_home=home,
        actual_score_away=away,
        outcome="home" if home > away else "away" if away > home else "draw",
        winner_correct=False,
        exact_score_correct=True,
        prob_assigned=0.3,
        brier=0.5,
        log_loss=1.2,
        goal_error=0,
    )


def _fingerprint(db_session) -> dict[str, tuple[int, str]]:
    """Row count and content hash of every table, JSON columns as their raw
    stored text (so a JSON null and an SQL NULL differ)."""
    out = {}
    for table in Base.metadata.sorted_tables:
        rows = db_session.execute(
            repair_mod.full_select(table).order_by(*table.primary_key.columns)).all()
        blob = json.dumps([list(row) for row in rows], default=str, sort_keys=True)
        out[table.name] = (len(rows), hashlib.sha256(blob.encode()).hexdigest())
    return out


def _apply(db_session, **kwargs):
    dry = repair_fixture_duplicates(db_session, **kwargs)
    return repair_fixture_duplicates(
        db_session, apply=True, expected_digest=dry.digest, **kwargs
    )


def test_dry_run_reports_exact_merge_and_is_side_effect_free(db_session):
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    served = _prediction(provider.id)
    db_session.add(served)
    db_session.commit()
    before = _fingerprint(db_session)

    report = repair_fixture_duplicates(db_session)

    assert _fingerprint(db_session) == before
    assert report.dry_run is True
    assert report.trial == "ok"
    assert report.ready_to_apply is True
    assert report.matches_merged == 1
    assert report.teams_merged == 1
    assert report.survivor_match_ids == (legacy.id,)
    assert report.removed_match_ids == (provider.id,)
    assert report.team_mappings == (
        TeamMerge(
            donor_team_id=duplicate.id,
            donor_name="RC Deportivo La Coruña",
            survivor_team_id=canonical.id,
            survivor_name="Deportivo La Coruna",
        ),
    )
    assert report.match_mappings == (
        MatchMerge(
            tournament_id=legacy.tournament_id,
            tournament_name="La Liga 2026-27",
            home="Malaga",
            away="Deportivo La Coruna",
            survivor_match_id=legacy.id,
            donor_match_id=provider.id,
            survivor_fixture_id=2001,
            donor_fixture_id=564640,
            paired_by="identity",
            survivor_matchweek=2,
            donor_matchweek=2,
            survivor_kickoff_utc="2026-08-24T19:30:00+00:00",
            donor_kickoff_utc="2026-08-24T19:30:00+00:00",
            kickoff_delta_seconds=0,
            survivor_status="scheduled",
            donor_status="finished",
            survivor_score=None,
            donor_score=[1, 1],
            state_source="donor",
            merged_kickoff_utc="2026-08-24T19:30:00+00:00",
            merged_status="finished",
            merged_score=[1, 1],
            score_mismatch=False,
        ),
    )
    assert report.tournament_counts == {"La Liga 2026-27": 1}
    assert report.moved_counts["predictions.match_id"] == 1
    assert report.dropped_counts["matches"] == 1
    assert report.dropped_counts["teams"] == 1
    assert report.dropped_counts["standings"] == 1
    payload = json.loads(report_json(report))
    assert list(payload) == ["summary", "report"]
    assert payload["report"]["digest"] == report.digest
    assert payload["report"]["deleted_rows"]["teams"][0]["row"]["name"] == "RC Deportivo La Coruña"
    # Same data, same code: same digest.
    assert repair_fixture_duplicates(db_session).digest == report.digest


def test_apply_preserves_dependencies_and_authoritative_fixture_state(db_session):
    tournament, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    served = _prediction(provider.id)
    shadow = _prediction(provider.id, shadow=True)
    user = AppUser(email="repair@example.com", password_hash="hash")
    player = TipPlayer(device_id="repair-device", handle="Repair")
    db_session.add_all([served, shadow, user, player])
    db_session.flush()
    pick = MatchPick(user_id=user.id, match_id=provider.id, pick="draw")
    score_pick = LeagueScorePrediction(
        tournament_id=tournament.id,
        match_id=provider.id,
        player_id=player.id,
        predicted_home=1,
        predicted_away=1,
    )
    db_session.add_all([pick, score_pick])
    db_session.commit()
    provider_id = provider.id
    duplicate_id = duplicate.id

    report = _apply(db_session)

    assert report.dry_run is False
    assert report.trial == "applied"
    assert db_session.get(Match, provider_id) is None
    survivor = db_session.get(Match, legacy.id)
    assert survivor.fixture_provider == "football_data"
    assert survivor.provider_fixture_id == 564640
    assert survivor.status == "finished"
    assert (survivor.score_home, survivor.score_away) == (1, 1)
    assert survivor.team_away_id == canonical.id
    assert db_session.get(Team, duplicate_id) is None
    assert db_session.get(Prediction, served.id).match_id == legacy.id
    assert db_session.get(Prediction, shadow.id).match_id == legacy.id
    assert db_session.get(Prediction, served.id).prob_home_win == 0.4
    assert db_session.get(MatchPick, pick.id).match_id == legacy.id
    assert db_session.get(LeagueScorePrediction, score_pick.id).match_id == legacy.id
    assert db_session.query(GroupTeam).filter_by(team_id=duplicate_id).count() == 0
    assert db_session.query(Standing).filter_by(team_id=duplicate_id).count() == 0
    assert db_session.query(TeamTournamentState).filter_by(team_id=canonical.id).count() == 1


def test_apply_refuses_without_or_with_a_stale_digest(db_session):
    _, _, _, duplicate, legacy, provider = _seed_duplicate(db_session)
    db_session.commit()
    before = _fingerprint(db_session)

    with pytest.raises(RepairRefused, match="expected-digest"):
        repair_fixture_duplicates(db_session, apply=True)
    with pytest.raises(RepairRefused, match="digest mismatch"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest="0" * 64)
    assert _fingerprint(db_session) == before

    dry = repair_fixture_duplicates(db_session)
    # Data moves between dry run and apply: a new prediction on the donor.
    db_session.add(_prediction(provider.id))
    db_session.commit()
    changed = _fingerprint(db_session)
    with pytest.raises(RepairRefused, match="digest mismatch"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)
    assert _fingerprint(db_session) == changed
    assert db_session.get(Team, duplicate.id) is not None


def test_digest_binds_the_code_revision(db_session, monkeypatch):
    _seed_duplicate(db_session)
    db_session.commit()
    monkeypatch.setenv("REPAIR_CODE_REVISION", "aaaa")
    dry = repair_fixture_duplicates(db_session)
    monkeypatch.setenv("REPAIR_CODE_REVISION", "bbbb")

    with pytest.raises(RepairRefused, match="digest mismatch"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)


def test_apply_is_idempotent(db_session):
    _seed_duplicate(db_session)
    db_session.commit()
    _apply(db_session)
    after_first = _fingerprint(db_session)

    second = repair_fixture_duplicates(db_session)

    assert second.matches_merged == 0
    assert second.teams_merged == 0
    assert second.conflicts == []
    assert second.deleted_rows == {}
    assert second.moved_counts == {}
    assert second.trial == "skipped: nothing to repair"
    repair_fixture_duplicates(db_session, apply=True, expected_digest=second.digest)
    assert _fingerprint(db_session) == after_first


def test_moved_kickoff_still_pairs_and_reports_the_difference(db_session):
    moved = KICKOFF + timedelta(days=6, hours=2)
    _, _, _, _, legacy, provider = _seed_duplicate(db_session, donor_kickoff=moved)
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    (pair,) = report.match_mappings
    assert (pair.survivor_match_id, pair.donor_match_id) == (legacy.id, provider.id)
    assert pair.kickoff_delta_seconds == int(timedelta(days=6, hours=2).total_seconds())
    _apply(db_session)
    assert db_session.get(Match, legacy.id).kickoff_utc.replace(tzinfo=timezone.utc) == moved


def test_matchweek_breaks_a_tie_and_ambiguity_fails_closed_naming_rows(db_session):
    tournament, group, canonical, _, legacy, provider = _seed_duplicate(db_session)
    other_leg = Match(
        tournament_id=tournament.id,
        group_id=group.id,
        stage="group",
        team_home_id=legacy.team_home_id,
        team_away_id=canonical.id,
        kickoff_utc=KICKOFF + timedelta(days=150),
        status="scheduled",
        fixture_provider="api_football",
        provider_fixture_id=2002,
        matchweek=30,
        is_neutral=False,
    )
    db_session.add(other_leg)
    db_session.commit()

    # The stray legacy row has no twin: blocked until a person decides.
    report = repair_fixture_duplicates(db_session)
    assert report.match_mappings == ()
    assert any("no football-data twin" in b and f"id={other_leg.id} " in b
               and f"exclude:{other_leg.id}" in b for b in report.blocking)
    # Excluding exactly that row lets the rest pair.
    report = repair_fixture_duplicates(db_session, acknowledge=[f"exclude:{other_leg.id}"])
    (pair,) = report.match_mappings
    assert (pair.survivor_match_id, pair.donor_match_id) == (legacy.id, provider.id)
    assert report.left_for_manual_handling[0]["match_ids"] == [other_leg.id]

    other_leg.matchweek = 2
    db_session.commit()
    before = _fingerprint(db_session)
    report = repair_fixture_duplicates(db_session)
    (block,) = report.blocking
    assert "ambiguous" in block
    for match_id in (legacy.id, provider.id, other_leg.id):
        assert f"id={match_id} " in block
    assert report.ready_to_apply is False
    assert _fingerprint(db_session) == before


def test_same_plan_after_an_alias_aware_refresh_repointed_the_donor(db_session):
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    db_session.commit()
    before_refresh = repair_fixture_duplicates(db_session)

    # What league_structure does with the new alias: the football-data row is
    # matched by fixture id and re-pointed at the original club.
    provider.team_away_id = canonical.id
    db_session.commit()
    duplicate_id = duplicate.id
    after_refresh = repair_fixture_duplicates(db_session)

    assert after_refresh.match_mappings == before_refresh.match_mappings
    assert after_refresh.team_mappings == before_refresh.team_mappings
    assert after_refresh.ready_to_apply is True
    _apply(db_session)
    assert db_session.query(Match).count() == 1
    assert db_session.get(Team, duplicate_id) is None


def test_duplicate_club_is_never_deleted_while_its_fixtures_are_unmerged(db_session):
    # The PR #265 failure: after an alias-aware refresh no football-data row
    # pointed at the duplicate club, so the club was deleted with both
    # fixtures still in place. Now the pair is found by identity.
    _, _, canonical, duplicate, _, provider = _seed_duplicate(db_session)
    provider.team_away_id = canonical.id
    db_session.commit()

    report = _apply(db_session)

    assert report.matches_merged == 1
    assert db_session.query(Match).count() == 1


def test_history_collision_keeps_each_real_match_once(db_session):
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home = legacy.score_away = 1
    db_session.add_all([
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=canonical.id,
                        score_a=1, score_b=1, competition=COMPETITION),
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=duplicate.id,
                        score_a=1, score_b=1, competition=COMPETITION),
    ])
    db_session.commit()

    report = _apply(db_session)

    assert report.dropped_counts["historical_matches"] == 1
    rows = db_session.query(HistoricalMatch).all()
    assert [(r.team_a_id, r.team_b_id) for r in rows] == [(legacy.team_home_id, canonical.id)]


def test_conflicts_are_enumerated_and_apply_needs_an_explicit_policy(db_session):
    tournament, _, _, duplicate, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="conflict@example.com", password_hash="hash")
    player = TipPlayer(device_id="conflict-device", handle="Conflict")
    db_session.add_all([user, player])
    db_session.flush()
    legacy_pick = MatchPick(user_id=user.id, match_id=legacy.id, pick="home",
                            updated_at=datetime(2026, 8, 10, tzinfo=timezone.utc))
    donor_pick = MatchPick(user_id=user.id, match_id=provider.id, pick="draw",
                           updated_at=datetime(2026, 9, 5, tzinfo=timezone.utc))
    legacy_lineup = MatchLineup(match_id=legacy.id, side="home", provider="api_football",
                                fetched_at=KICKOFF)
    donor_lineup = MatchLineup(match_id=provider.id, side="home", provider="api_football",
                               fetched_at=KICKOFF)
    db_session.add_all([
        legacy_pick, donor_pick, legacy_lineup, donor_lineup,
        LeagueScorePrediction(tournament_id=tournament.id, match_id=legacy.id,
                              player_id=player.id, predicted_home=2, predicted_away=0),
        LeagueScorePrediction(tournament_id=tournament.id, match_id=provider.id,
                              player_id=player.id, predicted_home=1, predicted_away=1),
    ])
    db_session.flush()
    db_session.add(LineupPlayer(match_lineup_id=legacy_lineup.id, name="Keeper",
                                is_starter=True, order=1))
    db_session.commit()
    before = _fingerprint(db_session)
    duplicate_id, legacy_id = duplicate.id, legacy.id
    legacy_pick_id, donor_pick_id = legacy_pick.id, donor_pick.id
    legacy_lineup_id, donor_lineup_id = legacy_lineup.id, donor_lineup.id

    dry = repair_fixture_duplicates(db_session)

    assert _fingerprint(db_session) == before
    assert dry.ready_to_apply is False
    assert dry.unresolved_conflicts == 3
    assert dry.trial.startswith("skipped")
    by_table = {c["table"]: c for c in dry.conflicts}
    assert set(by_table) == {"match_picks", "league_score_predictions", "match_lineups"}
    pick_conflict = by_table["match_picks"]
    assert pick_conflict["key"] == {"user_id": user.id}
    assert pick_conflict["survivor_row"]["id"] == legacy_pick.id
    assert pick_conflict["survivor_row"]["pick"] == "home"
    assert pick_conflict["donor_row"]["pick"] == "draw"
    assert pick_conflict["donor_row"]["updated_at"].startswith("2026-09-05")
    assert pick_conflict["resolution"] is None
    with pytest.raises(RepairRefused, match="unresolved"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)
    assert _fingerprint(db_session) == before

    policy = parse_on_conflict(["keep-donor", "match_lineups=keep-survivor"])
    resolved = repair_fixture_duplicates(db_session, on_conflict=policy)
    assert resolved.ready_to_apply is True
    assert resolved.digest != dry.digest
    deleted = resolved.deleted_rows
    assert [e["row"]["id"] for e in deleted["match_picks"]] == [legacy_pick.id]
    assert deleted["match_picks"][0]["row"]["pick"] == "home"
    assert deleted["match_picks"][0]["reason"] == "conflict_loser:keep-donor"
    assert [e["row"]["id"] for e in deleted["match_lineups"]] == [donor_lineup.id]
    assert [e["row"]["predicted_home"] for e in deleted["league_score_predictions"]] == [2]

    repair_fixture_duplicates(db_session, apply=True, expected_digest=resolved.digest,
                              on_conflict=policy)
    picks = db_session.query(MatchPick).all()
    assert [(p.id, p.match_id, p.pick) for p in picks] == [(donor_pick_id, legacy_id, "draw")]
    lineups = db_session.query(MatchLineup).all()
    assert [(l.id, l.match_id) for l in lineups] == [(legacy_lineup_id, legacy_id)]
    assert db_session.query(LineupPlayer).count() == 1
    assert db_session.get(Team, duplicate_id) is None


def test_conflict_losers_with_children_are_reported_in_full(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    lineups = [
        MatchLineup(match_id=match.id, side="away", provider="api_football", fetched_at=KICKOFF)
        for match in (legacy, provider)
    ]
    db_session.add_all(lineups)
    db_session.flush()
    db_session.add(LineupPlayer(match_lineup_id=lineups[0].id, name="Nine",
                                is_starter=True, order=9))
    db_session.commit()

    report = repair_fixture_duplicates(db_session, on_conflict=parse_on_conflict(["keep-donor"]))

    assert report.deleted_rows["lineup_players"][0]["row"]["name"] == "Nine"
    assert report.deleted_rows["lineup_players"][0]["reason"] == (
        "child_of_conflict_loser:match_lineups"
    )


def test_frozen_prediction_equals_graded_after_merge(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    # Donor: graded pre-kickoff production + shadow predictions.
    donor_early = _prediction(provider.id, created_at=KICKOFF - timedelta(days=2))
    donor_graded = _prediction(provider.id, created_at=KICKOFF - timedelta(hours=20))
    donor_shadow = _prediction(provider.id, shadow=True, created_at=KICKOFF - timedelta(hours=20))
    # Legacy stayed "scheduled", so the daily run kept predicting it: one row
    # after the graded one but before kickoff, and rows after kickoff.
    legacy_old = _prediction(legacy.id, created_at=KICKOFF - timedelta(days=5))
    legacy_outranks = _prediction(legacy.id, created_at=KICKOFF - timedelta(hours=19))
    legacy_shadow_outranks = _prediction(legacy.id, shadow=True,
                                         created_at=KICKOFF - timedelta(hours=19))
    legacy_after = [
        _prediction(legacy.id, created_at=KICKOFF + timedelta(days=d)) for d in (1, 2)
    ]
    db_session.add_all([donor_early, donor_graded, donor_shadow, legacy_old,
                        legacy_outranks, legacy_shadow_outranks, *legacy_after])
    db_session.flush()
    db_session.add_all([
        _grade(provider.id, donor_graded),
        _grade(provider.id, donor_shadow, shadow=True),
    ])
    db_session.commit()
    assert _frozen_prediction(db_session, provider).id == donor_graded.id
    ids = {name: row.id for name, row in (
        ("donor_early", donor_early), ("donor_graded", donor_graded),
        ("donor_shadow", donor_shadow), ("legacy_old", legacy_old),
        ("legacy_outranks", legacy_outranks),
        ("legacy_shadow_outranks", legacy_shadow_outranks),
        ("after_1", legacy_after[0]), ("after_2", legacy_after[1]),
    )}
    legacy_id = legacy.id

    report = _apply(db_session)

    dropped = {e["row"]["id"]: e["reason"] for e in report.deleted_rows["predictions"]}
    assert dropped == {
        ids["legacy_outranks"]: "outranks_graded_prediction",
        ids["legacy_shadow_outranks"]: "outranks_graded_prediction",
        ids["after_1"]: "prediction_after_merged_kickoff",
        ids["after_2"]: "prediction_after_merged_kickoff",
    }
    merged = db_session.get(Match, legacy_id)
    assert _frozen_prediction(db_session, merged).id == ids["donor_graded"]
    assert latest_prediction(db_session, merged.id).id == ids["donor_graded"]
    assert _frozen_prediction(db_session, merged, shadow=True,
                              shadow_version=SHADOW).id == ids["donor_shadow"]
    # Nothing graded moved off its prediction; nothing was created.
    grades = db_session.query(PredictionResult).all()
    assert {g.prediction_id for g in grades} == {ids["donor_graded"], ids["donor_shadow"]}
    assert {g.match_id for g in grades} == {legacy_id}
    assert db_session.query(Prediction).count() == 4
    assert db_session.get(Prediction, ids["legacy_old"]).match_id == legacy_id
    assert db_session.get(Prediction, ids["donor_early"]).match_id == legacy_id


def test_a_graded_prediction_is_never_dropped(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    # The legacy copy was graded on a prediction that, on the merged row,
    # lands after the merged kickoff. The repair must block, not delete it.
    legacy.status = "finished"
    legacy.score_home = legacy.score_away = 1
    legacy.kickoff_utc = KICKOFF + timedelta(days=3)
    provider.status = "finished"
    late = _prediction(legacy.id, created_at=KICKOFF + timedelta(days=1))
    db_session.add(late)
    db_session.flush()
    db_session.add(_grade(legacy.id, late))
    db_session.commit()
    before = _fingerprint(db_session)

    report = repair_fixture_duplicates(db_session)

    assert report.ready_to_apply is False
    assert any(str(late.id) in reason for reason in report.blocking)
    with pytest.raises(RepairRefused, match="blocked"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=report.digest)
    assert _fingerprint(db_session) == before


def test_finished_survivor_is_never_unfinished_by_an_unfinished_donor(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home, legacy.score_away = 2, 1
    legacy.score_home_90, legacy.score_away_90 = 2, 1
    provider.status = "scheduled"
    provider.score_home = provider.score_away = None
    provider.score_home_90 = provider.score_away_90 = None
    provider.kickoff_utc = KICKOFF + timedelta(days=1)
    db_session.commit()

    report = _apply(db_session)

    assert report.match_mappings[0].state_source == "survivor"
    merged = db_session.get(Match, legacy.id)
    assert merged.status == "finished"
    assert (merged.score_home, merged.score_away) == (2, 1)
    assert merged.kickoff_utc.replace(tzinfo=timezone.utc) == KICKOFF
    assert (merged.fixture_provider, merged.provider_fixture_id) == ("football_data", 564640)


def test_odds_and_unkeyed_references_follow_the_merge(db_session):
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    legacy_closing = Odds(match_id=legacy.id, snapshot_phase="closing", odds_home=2.0)
    donor_closing = Odds(match_id=provider.id, snapshot_phase="closing", odds_home=2.4)
    donor_opening = Odds(match_id=provider.id, snapshot_phase="opening", odds_home=2.2)
    fetched = datetime(2026, 8, 20, 12, tzinfo=timezone.utc)
    match_odds = MarketOddsSnapshot(sport="football", source="polymarket",
                                    market_type="match_winner", match_id=provider.id,
                                    outcome="home", implied_prob=0.4, external_id="m",
                                    fetched_at=fetched)
    nrl_odds = MarketOddsSnapshot(sport="nrl", source="polymarket",
                                  market_type="match_winner", match_id=provider.id,
                                  outcome="home", implied_prob=0.4, external_id="n",
                                  fetched_at=fetched)
    title_odds = MarketOddsSnapshot(sport="football", source="polymarket",
                                    market_type="title_winner", team_id=duplicate.id,
                                    outcome="win", implied_prob=0.01, external_id="t",
                                    fetched_at=fetched)
    day = date(2026, 9, 1)
    same_day = ProbabilitySnapshot(sport="football", entity_id=duplicate.id,
                                   market="qualify_group", prob=0.1, snapshot_date=day)
    canonical_day = ProbabilitySnapshot(sport="football", entity_id=canonical.id,
                                        market="qualify_group", prob=0.2, snapshot_date=day)
    other_day = ProbabilitySnapshot(sport="football", entity_id=duplicate.id,
                                    market="qualify_group", prob=0.1,
                                    snapshot_date=date(2026, 9, 2))
    venue = VenueMarket(venue="polymarket", venue_key="k", sport="football",
                        canonical_event_id=provider.id, status="open",
                        first_seen=fetched, last_seen=fetched, mapping_status="mapped")
    db_session.add_all([legacy_closing, donor_closing, donor_opening, match_odds, nrl_odds,
                        title_odds, same_day, canonical_day, other_day, venue])
    db_session.commit()
    legacy_closing_id, same_day_id, provider_id = legacy_closing.id, same_day.id, provider.id

    report = _apply(db_session)

    assert [e["row"]["id"] for e in report.deleted_rows["odds"]] == [legacy_closing_id]
    assert {o.id for o in db_session.query(Odds).filter_by(match_id=legacy.id)} == {
        donor_closing.id, donor_opening.id,
    }
    assert db_session.get(MarketOddsSnapshot, match_odds.id).match_id == legacy.id
    assert db_session.get(MarketOddsSnapshot, nrl_odds.id).match_id == provider_id
    assert db_session.get(MarketOddsSnapshot, title_odds.id).team_id == canonical.id
    assert db_session.get(ProbabilitySnapshot, same_day_id) is None
    assert db_session.get(ProbabilitySnapshot, other_day.id).entity_id == canonical.id
    assert db_session.get(VenueMarket, venue.id).canonical_event_id == legacy.id
    assert report.moved_counts["venue_market.canonical_event_id"] == 1


def test_on_conflict_parsing():
    assert parse_on_conflict(["keep-survivor"]) == {"*": "keep-survivor"}
    assert parse_on_conflict(["match_picks=keep-donor,prediction_results=keep-survivor"]) == {
        "match_picks": "keep-donor",
        "prediction_results": "keep-survivor",
    }
    with pytest.raises(DuplicateRepairError):
        parse_on_conflict(["keep-newest"])
    with pytest.raises(DuplicateRepairError):
        parse_on_conflict(["no_such_table=keep-donor"])


def test_cli_prints_digest_and_refuses_apply_without_it(db_session, monkeypatch, capsys, tmp_path):
    _seed_duplicate(db_session)
    db_session.commit()
    monkeypatch.setattr(
        "pipeline.repair_fixture_duplicates.SessionLocal", lambda: _NoClose(db_session)
    )
    evidence = tmp_path / "evidence.json"

    assert main(["--evidence-file", str(evidence)]) == 0
    out = capsys.readouterr().out
    digest = json.loads(evidence.read_text())["report"]["digest"]
    assert f"digest: {digest}" in out
    assert "deleted_rows" not in out
    assert '"clubs_merged"' in out

    # The workflow passes empty strings when no policy/acknowledgement is set.
    assert main(["--on-conflict", "", "--acknowledge", "", "--no-trial"]) == 0
    assert "ready_to_apply: true" in capsys.readouterr().out
    assert main(["--apply"]) == 2
    assert main(["--apply", "--expected-digest", digest]) == 2  # no evidence file
    assert main(["--apply", "--expected-digest", digest,
                 "--evidence-file", str(tmp_path / "apply.json")]) == 0
    assert db_session.query(Match).count() == 1


class _NoClose:
    def __init__(self, session):
        self.session = session

    def __enter__(self):
        return self.session

    def __exit__(self, *exc):
        return False


# --------------------------------------------------------------------------
# End to end on a production-shaped database, with a real alias-aware
# refresh between the merge and the repair.


def _fd_fixture(fid, home, away, kickoff, *, status="scheduled", score=None, matchweek=1):
    score = score or (None, None)
    return NormalizedFixture(
        provider="football_data",
        fixture_id=fid,
        home_name=home,
        away_name=away,
        kickoff_utc=kickoff,
        status=status,
        score_home=score[0],
        score_away=score[1],
        matchweek=matchweek,
        score_home_90=score[0],
        score_away_90=score[1],
        venue_name=None,
        venue_city=None,
        round_label="REGULAR_SEASON",
        upstream_updated_at=datetime(2026, 11, 19, tzinfo=timezone.utc),
        home_provider_id=None,
        away_provider_id=None,
    )


def _production_shaped(db_session):
    tournament = Tournament(name="La Liga 2026-27", year=2026, home_advantage_mode="home")
    group = Group(tournament=tournament, name="La Liga")
    db_session.add_all([tournament, group])
    db_session.flush()
    teams = {
        name: Team(name=name, provider_team_id=pid)
        for name, pid in (("Malaga", 1200), ("Deportivo La Coruna", 1201),
                          ("Racing Santander", 1202), ("Getafe", 1203))
    }
    teams["dup_depor"] = Team(name="RC Deportivo La Coruña")
    teams["dup_racing"] = Team(name="Real Racing Club de Santander")
    db_session.add_all(teams.values())
    db_session.flush()
    db_session.add_all([GroupTeam(group_id=group.id, team_id=t.id) for t in teams.values()])
    ids = {key: team.id for key, team in teams.items()}

    def match(home, away, kickoff, provider, fixture_id, **extra):
        row = Match(
            tournament_id=tournament.id, group_id=group.id, stage="group",
            team_home_id=ids[home], team_away_id=ids[away], kickoff_utc=kickoff,
            fixture_provider=provider, provider_fixture_id=fixture_id, is_neutral=False,
            provider_last_updated=datetime(2026, 8, 18, tzinfo=timezone.utc),
            **{"status": "scheduled", "matchweek": 1, **extra},
        )
        db_session.add(row)
        return row

    k_frozen = datetime(2026, 8, 24, 19, 30, tzinfo=timezone.utc)
    k_both = datetime(2026, 8, 16, 17, 0, tzinfo=timezone.utc)
    k_future = datetime(2026, 12, 6, 15, 0, tzinfo=timezone.utc)
    k_legacy_moved = datetime(2026, 8, 30, 19, 0, tzinfo=timezone.utc)
    k_donor_moved = datetime(2026, 9, 13, 16, 15, tzinfo=timezone.utc)
    rows = {
        # 1. Legacy frozen "scheduled"; football-data copy finished and graded.
        "frozen_legacy": match("Malaga", "Deportivo La Coruna", k_frozen, "api_football", 3001),
        "frozen_donor": match("Malaga", "dup_depor", k_frozen, "football_data", 9001,
                              status="finished", score_home=1, score_away=1,
                              score_home_90=1, score_away_90=1),
        # 2. Finished on both copies (16 Aug) and in history twice.
        "both_legacy": match("Racing Santander", "Malaga", k_both, "api_football", 3002,
                             status="finished", score_home=2, score_away=0,
                             score_home_90=2, score_away_90=0),
        "both_donor": match("dup_racing", "Malaga", k_both, "football_data", 9002,
                            status="finished", score_home=2, score_away=0,
                            score_home_90=2, score_away_90=0),
        # 3. Two duplicate clubs, still scheduled, picks on both copies.
        "picks_legacy": match("Deportivo La Coruna", "Racing Santander", k_future,
                              "api_football", 3003, matchweek=15),
        "picks_donor": match("dup_depor", "dup_racing", k_future, "football_data", 9003,
                             matchweek=15),
        # 4. Kickoff moved two weeks; football-data copy finished.
        "moved_legacy": match("Getafe", "Deportivo La Coruna", k_legacy_moved,
                              "api_football", 3004, matchweek=3),
        "moved_donor": match("Getafe", "dup_depor", k_donor_moved, "football_data", 9004,
                             matchweek=3, status="finished", score_home=0, score_away=2,
                             score_home_90=0, score_away_90=2),
    }
    db_session.flush()

    # Predictions: daily rows on every copy while "scheduled" (the legacy rows
    # never left it), and the graded frozen rows on the finished donors.
    preds = {}

    def predict(key, when, **kw):
        row = _prediction(rows[key].id, created_at=when, **kw)
        db_session.add(row)
        preds.setdefault(key, []).append(row)
        return row

    graded_frozen = predict("frozen_donor", k_frozen - timedelta(hours=18))
    graded_frozen_shadow = predict("frozen_donor", k_frozen - timedelta(hours=18), shadow=True)
    for day in range(-3, 40, 1):
        when = k_frozen + timedelta(days=day, hours=-18, minutes=1)
        predict("frozen_legacy", when)
        predict("frozen_legacy", when, shadow=True)
    graded_moved = predict("moved_donor", k_donor_moved - timedelta(hours=18))
    for day in range(-3, 40, 1):
        predict("moved_legacy", k_legacy_moved + timedelta(days=day))
    predict("picks_legacy", datetime(2026, 11, 19, 6, 1, tzinfo=timezone.utc))
    predict("picks_donor", datetime(2026, 11, 19, 6, 2, tzinfo=timezone.utc))
    db_session.flush()
    db_session.add_all([
        _grade(rows["frozen_donor"].id, graded_frozen),
        _grade(rows["frozen_donor"].id, graded_frozen_shadow, shadow=True),
        _grade(rows["moved_donor"].id, graded_moved, score=(0, 2)),
    ])

    # History as the daily sync left it before the alias existed.
    for key in ("frozen_donor", "both_legacy", "both_donor", "moved_donor"):
        m = rows[key]
        db_session.add(HistoricalMatch(
            date=m.kickoff_utc, team_a_id=m.team_home_id, team_b_id=m.team_away_id,
            score_a=m.score_home, score_b=m.score_away, competition=COMPETITION,
        ))

    # The same signed-in user picked both copies of the scheduled fixture.
    user = AppUser(email="fan@example.com", password_hash="hash")
    player = TipPlayer(device_id="fan-device", handle="Fan")
    db_session.add_all([user, player])
    db_session.flush()
    db_session.add_all([
        MatchPick(user_id=user.id, match_id=rows["picks_legacy"].id, pick="home",
                  updated_at=datetime(2026, 8, 12, tzinfo=timezone.utc)),
        MatchPick(user_id=user.id, match_id=rows["picks_donor"].id, pick="away",
                  updated_at=datetime(2026, 11, 2, tzinfo=timezone.utc)),
        LeagueScorePrediction(tournament_id=tournament.id, match_id=rows["picks_donor"].id,
                              player_id=player.id, predicted_home=0, predicted_away=1),
    ])
    db_session.commit()
    return tournament, ids, rows, {
        "frozen": graded_frozen.id,
        "frozen_shadow": graded_frozen_shadow.id,
        "moved": graded_moved.id,
    }


def _alias_aware_refresh(db_session, monkeypatch, tournament):
    """The real daily ingest + history sync, with football-data's spellings."""
    fixtures = [
        _fd_fixture(9001, "Málaga CF", "RC Deportivo La Coruña",
                    datetime(2026, 8, 24, 19, 30, tzinfo=timezone.utc),
                    status="finished", score=(1, 1)),
        _fd_fixture(9002, "Real Racing Club de Santander", "Málaga CF",
                    datetime(2026, 8, 16, 17, 0, tzinfo=timezone.utc),
                    status="finished", score=(2, 0)),
        _fd_fixture(9003, "RC Deportivo La Coruña", "Real Racing Club de Santander",
                    datetime(2026, 12, 6, 15, 0, tzinfo=timezone.utc), matchweek=15),
        _fd_fixture(9004, "Getafe", "RC Deportivo La Coruña",
                    datetime(2026, 9, 13, 16, 15, tzinfo=timezone.utc),
                    status="finished", score=(0, 2), matchweek=3),
    ]
    monkeypatch.setattr(ls_mod, "fetch_league_fixtures", lambda *a, **k: fixtures)
    result = load_league_structure(
        db_session, teams_file=None, api_key="x", tournament_name=tournament.name,
        group_name="La Liga", fixture_source="football_data", competition_code="PD",
    )
    assert result["fixtures_created"] == 0
    sync_finished_matches_to_history(db_session, tournament, competition=COMPETITION)


def _real_match_history_counts(db_session, ids):
    pairs = [
        ("Malaga", "Deportivo La Coruna"),
        ("Racing Santander", "Malaga"),
        ("Getafe", "Deportivo La Coruna"),
    ]
    return {
        pair: db_session.query(HistoricalMatch).filter_by(
            team_a_id=ids[pair[0]], team_b_id=ids[pair[1]]).count()
        for pair in pairs
    }


@pytest.mark.parametrize("refresh_first", [False, True])
def test_end_to_end_on_a_production_shaped_database(db_session, monkeypatch, refresh_first):
    tournament, ids, rows, graded = _production_shaped(db_session)
    row_ids = {key: row.id for key, row in rows.items()}
    plan_before_refresh = repair_fixture_duplicates(db_session)

    if refresh_first:
        history_before = db_session.query(HistoricalMatch).count()
        _alias_aware_refresh(db_session, monkeypatch, tournament)
        after_first = db_session.query(HistoricalMatch).count()
        _alias_aware_refresh(db_session, monkeypatch, tournament)
        # The first alias-aware refresh re-syncs the two finished football-data
        # fixtures under the original club; later refreshes add nothing more.
        assert (history_before, after_first) == (4, 6)
        assert db_session.query(HistoricalMatch).count() == after_first
        # The refresh re-pointed every football-data row at the original club
        # and re-synced the finished ones into history under it.
        assert db_session.query(Match).filter(
            Match.team_home_id.in_([ids["dup_depor"], ids["dup_racing"]])
            | Match.team_away_id.in_([ids["dup_depor"], ids["dup_racing"]])
        ).count() == 0

    dry = repair_fixture_duplicates(db_session)
    pairs = {(m.survivor_match_id, m.donor_match_id) for m in dry.match_mappings}
    assert pairs == {
        (row_ids["frozen_legacy"], row_ids["frozen_donor"]),
        (row_ids["both_legacy"], row_ids["both_donor"]),
        (row_ids["picks_legacy"], row_ids["picks_donor"]),
        (row_ids["moved_legacy"], row_ids["moved_donor"]),
    }
    assert dry.match_mappings == plan_before_refresh.match_mappings
    assert dry.team_mappings == plan_before_refresh.team_mappings
    moved = next(m for m in dry.match_mappings if m.survivor_match_id == row_ids["moved_legacy"])
    assert moved.kickoff_delta_seconds == 14 * 86400 - 2 * 3600 - 45 * 60
    both = next(m for m in dry.match_mappings if m.survivor_match_id == row_ids["both_legacy"])
    assert (both.survivor_status, both.donor_status, both.score_mismatch) == (
        "finished", "finished", False)
    # The only owner decision in this data: the doubled pick.
    assert [c["table"] for c in dry.conflicts] == ["match_picks"]
    assert dry.ready_to_apply is False

    policy = parse_on_conflict(["match_picks=keep-donor"])
    cleared = repair_fixture_duplicates(db_session, on_conflict=policy)
    assert cleared.ready_to_apply is True
    assert cleared.trial == "ok"
    # Before the refresh only the both-finished match is doubled; the refresh
    # re-syncs every finished football-data row under the original club, so
    # each of the three finished matches is doubled by the time apply runs.
    assert cleared.dropped_counts["historical_matches"] == (3 if refresh_first else 1)
    repair_fixture_duplicates(db_session, apply=True, expected_digest=cleared.digest,
                              on_conflict=policy)

    # Fixtures: one row per real match, on the legacy id, with the live state.
    assert db_session.query(Match).count() == 4
    assert db_session.get(Team, ids["dup_depor"]) is None
    assert db_session.get(Team, ids["dup_racing"]) is None
    frozen = db_session.get(Match, row_ids["frozen_legacy"])
    assert (frozen.status, frozen.score_home, frozen.score_away) == ("finished", 1, 1)
    moved_match = db_session.get(Match, row_ids["moved_legacy"])
    assert moved_match.kickoff_utc.replace(tzinfo=timezone.utc) == datetime(
        2026, 9, 13, 16, 15, tzinfo=timezone.utc)
    # History: each real match exactly once (no double Elo credit).
    assert _real_match_history_counts(db_session, ids) == {
        ("Malaga", "Deportivo La Coruna"): 1,
        ("Racing Santander", "Malaga"): 1,
        ("Getafe", "Deportivo La Coruna"): 1,
    }
    assert db_session.query(HistoricalMatch).count() == 3
    # Frozen == graded, and no merged match carries a post-kickoff prediction.
    assert _frozen_prediction(db_session, frozen).id == graded["frozen"]
    assert latest_prediction(db_session, frozen.id).id == graded["frozen"]
    assert _frozen_prediction(db_session, frozen, shadow=True,
                              shadow_version=SHADOW).id == graded["frozen_shadow"]
    assert _frozen_prediction(db_session, moved_match).id == graded["moved"]
    assert latest_prediction(db_session, moved_match.id).id == graded["moved"]
    for match in (frozen, moved_match):
        kickoff = match.kickoff_utc.replace(tzinfo=None)
        assert db_session.query(Prediction).filter(
            Prediction.match_id == match.id, Prediction.created_at > kickoff
        ).count() == 0
    # The user keeps exactly one pick, the one chosen by the explicit policy.
    picks = db_session.query(MatchPick).all()
    assert [(p.match_id, p.pick) for p in picks] == [(row_ids["picks_legacy"], "away")]
    assert db_session.query(LeagueScorePrediction).one().match_id == row_ids["picks_legacy"]

    # Idempotent, and a later refresh neither recreates nor re-duplicates.
    again = repair_fixture_duplicates(db_session)
    assert (again.matches_merged, again.teams_merged, again.deleted_rows) == (0, 0, {})
    _alias_aware_refresh(db_session, monkeypatch, tournament)
    assert db_session.query(Match).count() == 4
    assert db_session.query(HistoricalMatch).count() == 3
    assert db_session.query(Team).count() == 4


def test_schema_must_be_at_alembic_head(db_session):
    from alembic.script import ScriptDirectory

    from pipeline.repair_fixture_duplicates import ROOT_ALEMBIC, assert_schema_at_head

    with pytest.raises(DuplicateRepairError, match="schema is at"):
        assert_schema_at_head(db_session)
    (head,) = ScriptDirectory(str(ROOT_ALEMBIC)).get_heads()
    db_session.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32))"))
    db_session.execute(text("INSERT INTO alembic_version VALUES (:v)"), {"v": head})
    assert_schema_at_head(db_session)


# --------------------------------------------------------------------------
# Second review (PR #270): each test reproduces a reviewer scenario.


def test_h1_club_is_not_merged_while_one_of_its_fixtures_is_unpaired(db_session):
    # The football-data copy sits in another tournament row, so it has no
    # twin; merging the club would re-point it and leave both fixtures alive.
    tournament, group, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    elsewhere = Tournament(name="La Liga 2026-27 (football-data)", year=2026)
    db_session.add(elsewhere)
    db_session.flush()
    provider.tournament_id = elsewhere.id
    db_session.commit()
    before = _fingerprint(db_session)

    report = repair_fixture_duplicates(db_session)

    assert report.matches_merged == 0
    assert report.ready_to_apply is False
    assert any(f"id={provider.id} " in b and "no twin" in b for b in report.blocking)
    # The legacy twin is named in the same block, with both ways forward.
    assert any(f"id={legacy.id} " in b and "another tournament" in b
               and f"exclude:{provider.id}" in b for b in report.blocking)
    with pytest.raises(RepairRefused, match="blocked"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=report.digest)
    assert _fingerprint(db_session) == before

    # Excluding both leaves them, and the duplicate club, exactly as they are.
    acks = parse_acknowledgements([f"exclude:{provider.id} exclude:{legacy.id}"])
    acked = repair_fixture_duplicates(db_session, acknowledge=acks)
    assert acked.summary["status"] == "nothing to repair"
    assert acked.summary["clubs_kept_for_manual_handling"] == [duplicate.id]
    assert sorted(i for g in acked.left_for_manual_handling for i in g["match_ids"]) == sorted(
        [legacy.id, provider.id])
    repair_fixture_duplicates(db_session, apply=True, expected_digest=acked.digest,
                              acknowledge=acks)
    assert _fingerprint(db_session) == before
    # Nothing is hidden: a later dry run without the exclusions blocks again.
    assert repair_fixture_duplicates(db_session).ready_to_apply is False


def test_m1_stray_twin_is_still_blocked_after_an_alias_aware_refresh(db_session):
    # Reviewer case (C): the twin sits in another tournament and the refresh
    # has already re-pointed the football-data row at the original club.
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    stale = Tournament(name="La Liga 2026-27 (stale)", year=2026)
    db_session.add(stale)
    db_session.flush()
    legacy.tournament_id, legacy.group_id = stale.id, None
    provider.team_away_id = canonical.id
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    assert report.ready_to_apply is False
    assert any(f"id={provider.id} " in b and "another tournament" in b
               and f"id={legacy.id} " in b for b in report.blocking)
    acked = repair_fixture_duplicates(db_session, acknowledge=[f"exclude:{provider.id}"])
    # The club is kept so later dry runs keep seeing the excluded fixture.
    assert acked.summary["clubs_kept_for_manual_handling"] == [duplicate.id]
    duplicate_id = duplicate.id
    repair_fixture_duplicates(db_session, apply=True, expected_digest=acked.digest,
                              acknowledge=[f"exclude:{provider.id}"])
    assert db_session.get(Team, duplicate_id) is not None
    assert repair_fixture_duplicates(db_session).ready_to_apply is False


def test_h2_identity_pair_with_different_matchweeks_is_blocked(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(
        db_session, donor_kickoff=KICKOFF + timedelta(days=150))
    provider.matchweek = 30
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    (pair,) = report.match_mappings
    assert pair.paired_by == "identity"
    assert pair.kickoff_delta_seconds == 150 * 86400
    assert any("matchweek 2 vs 30" in b for b in report.blocking)
    assert report.ready_to_apply is False
    # Not acknowledgeable: different matchweeks are different fixtures.
    acked = repair_fixture_duplicates(
        db_session, acknowledge=[f"kickoff-gap:{legacy.id}"])
    assert any("matchweek 2 vs 30" in b for b in acked.blocking)


def test_h2_kickoff_gap_over_the_limit_needs_an_acknowledgement(db_session):
    _, _, _, _, legacy, _ = _seed_duplicate(
        db_session, donor_kickoff=KICKOFF + timedelta(days=15))
    db_session.commit()

    report = repair_fixture_duplicates(db_session)
    assert report.ready_to_apply is False
    assert any(f"kickoff-gap:{legacy.id}" in b for b in report.blocking)

    within = KICKOFF + timedelta(days=13, hours=23)
    db_session.query(Match).filter_by(fixture_provider="football_data").update(
        {"kickoff_utc": within})
    db_session.commit()
    assert repair_fixture_duplicates(db_session).ready_to_apply is True

    db_session.query(Match).filter_by(fixture_provider="football_data").update(
        {"kickoff_utc": KICKOFF + timedelta(days=15)})
    db_session.commit()
    acked = repair_fixture_duplicates(db_session, acknowledge=[f"kickoff-gap:{legacy.id}"])
    assert acked.ready_to_apply is True


def _both_finished_and_graded(db_session, *, survivor_score, donor_score):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home, legacy.score_away = survivor_score
    legacy.score_home_90, legacy.score_away_90 = survivor_score
    provider.score_home, provider.score_away = donor_score
    provider.score_home_90, provider.score_away_90 = donor_score
    legacy_pred = _prediction(legacy.id, created_at=KICKOFF - timedelta(days=2))
    donor_pred = _prediction(provider.id, created_at=KICKOFF - timedelta(days=1))
    db_session.add_all([legacy_pred, donor_pred])
    db_session.flush()
    legacy_grade = _grade(legacy.id, legacy_pred, score=survivor_score)
    donor_grade = _grade(provider.id, donor_pred, score=donor_score)
    db_session.add_all([legacy_grade, donor_grade])
    db_session.commit()
    return legacy, provider, legacy_pred, donor_pred, legacy_grade, donor_grade


def test_h3_kept_grade_must_match_the_merged_score(db_session):
    legacy, provider, _, donor_pred, legacy_grade, donor_grade = _both_finished_and_graded(
        db_session, survivor_score=(2, 0), donor_score=(1, 1))
    ack = [f"score-mismatch:{legacy.id}"]

    unacked = repair_fixture_duplicates(
        db_session, on_conflict=parse_on_conflict(["prediction_results=keep-donor"]))
    assert any(f"score-mismatch:{legacy.id}" in b for b in unacked.blocking)

    wrong = repair_fixture_duplicates(
        db_session, acknowledge=ack,
        on_conflict=parse_on_conflict(["prediction_results=keep-survivor"]))
    assert wrong.ready_to_apply is False
    assert any(f"kept grade {legacy_grade.id} records 2-0" in b for b in wrong.blocking)

    policy = parse_on_conflict(["prediction_results=keep-donor"])
    right = repair_fixture_duplicates(db_session, acknowledge=ack, on_conflict=policy)
    assert right.ready_to_apply is True, right.blocking
    assert right.summary["public_record"]["grades_removed"] == 1
    assert right.summary["public_record"]["graded_matches"] == "2 -> 1"
    assert right.summary["fixtures_with_different_final_scores"] == [legacy.id]
    legacy_id, donor_grade_id, donor_pred_id = legacy.id, donor_grade.id, donor_pred.id
    repair_fixture_duplicates(db_session, apply=True, expected_digest=right.digest,
                              acknowledge=ack, on_conflict=policy)
    merged = db_session.get(Match, legacy_id)
    grade = db_session.query(PredictionResult).one()
    assert (grade.id, grade.prediction_id) == (donor_grade_id, donor_pred_id)
    assert (grade.actual_score_home, grade.actual_score_away) == (
        merged.score_home, merged.score_away) == (1, 1)


def test_l1_a_losing_grade_no_longer_protects_its_prediction(db_session):
    # keep-survivor deletes the donor's grade; the donor's prediction then
    # outranks the kept one and must be dropped, not block the plan.
    legacy, provider, legacy_pred, donor_pred, legacy_grade, _ = _both_finished_and_graded(
        db_session, survivor_score=(1, 1), donor_score=(1, 1))
    policy = parse_on_conflict(["prediction_results=keep-survivor"])

    report = repair_fixture_duplicates(db_session, on_conflict=policy)

    assert report.blocking == []
    dropped = {e["row"]["id"]: e["reason"] for e in report.deleted_rows["predictions"]}
    assert dropped == {donor_pred.id: "outranks_graded_prediction"}
    legacy_id, legacy_pred_id = legacy.id, legacy_pred.id
    repair_fixture_duplicates(db_session, apply=True, expected_digest=report.digest,
                              on_conflict=policy)
    assert _frozen_prediction(db_session, db_session.get(Match, legacy_id)).id == legacy_pred_id


def test_h4_trial_can_be_skipped_and_postgres_runs_get_timeouts(db_session):
    _seed_duplicate(db_session)
    db_session.commit()
    assert repair_fixture_duplicates(db_session, trial=False).trial == "skipped: --no-trial"
    assert repair_fixture_duplicates(db_session).trial == "ok"

    class FakePostgres:
        def __init__(self):
            self.calls = []

        def get_bind(self):
            return type("Bind", (), {"dialect": type("D", (), {"name": "postgresql"})})

        def rollback(self):
            self.calls.append("rollback")

        def connection(self, execution_options=None):
            self.calls.append(("connection", execution_options))

        def execute(self, statement):
            self.calls.append(str(statement))

    fake = FakePostgres()
    repair_mod._begin(fake)
    assert fake.calls == [
        "rollback",
        ("connection", {"isolation_level": "REPEATABLE READ"}),
        "SET LOCAL lock_timeout = '5s'",
        "SET LOCAL statement_timeout = '60s'",
        "SET LOCAL idle_in_transaction_session_timeout = '30s'",
        "SET LOCAL extra_float_digits = 3",
    ]
    calls_on_sqlite = []
    db_session.execute = lambda *a, **k: calls_on_sqlite.append(a)  # noqa: E731
    repair_mod._begin(db_session)
    assert calls_on_sqlite == []


@pytest.mark.parametrize("pgcode", ["55P03", "57014", "40001"])
def test_l3_timeouts_and_serialization_failures_refuse_cleanly(db_session, monkeypatch, pgcode):
    from sqlalchemy.exc import OperationalError

    _seed_duplicate(db_session)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)
    before = _fingerprint(db_session)

    class Orig(Exception):
        pass

    orig = Orig("busy")
    orig.pgcode = pgcode

    def busy(db, plan):
        db.execute(text("DELETE FROM standings"))
        raise OperationalError("UPDATE matches", {}, orig)

    monkeypatch.setattr(repair_mod, "_execute", busy)
    with pytest.raises(RepairRefused, match="nothing was written"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)
    assert _fingerprint(db_session) == before


def test_m2_chain_watermark_follows_the_finished_count(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home = legacy.score_away = 1
    db_session.add(LearningChainStatus(id=1, covered_finished=2))
    db_session.commit()
    assert chain_pending(db_session) is False

    report = _apply(db_session)

    assert report.finished_count_delta == -1
    assert report.summary["finished_match_count_change"] == -1
    assert db_session.get(LearningChainStatus, 1).covered_finished == 1
    assert chain_pending(db_session) is False
    # A later genuine finish is still seen as owed work.
    db_session.add(Match(tournament_id=legacy.tournament_id, stage="group",
                         team_home_id=legacy.team_away_id, team_away_id=legacy.team_home_id,
                         kickoff_utc=KICKOFF + timedelta(days=90), status="finished",
                         score_home=0, score_away=0, is_neutral=False))
    db_session.commit()
    assert chain_pending(db_session) is True


def test_m3_summary_states_the_user_visible_consequences(db_session):
    tournament, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="summary@example.com", password_hash="hash")
    player = TipPlayer(device_id="summary-device", handle="Summary")
    db_session.add_all([user, player, _prediction(provider.id)])
    db_session.flush()
    db_session.add_all([
        MatchPick(user_id=user.id, match_id=legacy.id, pick="home"),
        LeagueScorePrediction(tournament_id=tournament.id, match_id=legacy.id,
                              player_id=player.id, predicted_home=1, predicted_away=1),
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=duplicate.id,
                        score_a=1, score_b=1, competition=COMPETITION),
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=canonical.id,
                        score_a=1, score_b=1, competition=COMPETITION),
    ])
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    summary = report.summary
    assert summary["clubs_merged"] == [
        f"RC Deportivo La Coruña (id {duplicate.id}) into Deportivo La Coruna "
        f"(id {canonical.id})"
    ]
    assert summary["fixtures_merged"] == {"La Liga 2026-27": 1}
    assert summary["matches_gradeable_at_next_refresh"] == [legacy.id]
    assert summary["user_picks_becoming_scoreable"] == 1
    assert summary["league_score_predictions_becoming_scoreable"] == 1
    assert summary["user_picks_deleted"] == 0
    assert summary["history_rows_dropped"] == 1
    assert summary["public_record"]["grades_removed"] == 0
    assert summary["status"] == "ready"
    assert summary["match_ids_that_stop_existing"] == [provider.id]
    assert list(json.loads(report_json(report))) == ["summary", "report"]


def test_l2_history_preference_ignores_other_seasons_results(db_session):
    _, _, canonical, duplicate, legacy, _ = _seed_duplicate(db_session)
    old = datetime(2025, 3, 1, 18, tzinfo=timezone.utc)
    # An older meeting recorded twice with different scores; the current
    # season's 1-1 says nothing about which is right.
    original_row = HistoricalMatch(date=old, team_a_id=legacy.team_home_id,
                                   team_b_id=canonical.id, score_a=0, score_b=0,
                                   competition=COMPETITION)
    duplicate_row = HistoricalMatch(date=old + timedelta(hours=2),
                                    team_a_id=legacy.team_home_id, team_b_id=duplicate.id,
                                    score_a=1, score_b=1, competition=COMPETITION)
    db_session.add_all([duplicate_row, original_row])
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    dropped = [e["row"]["id"] for e in report.deleted_rows["historical_matches"]]
    assert dropped == [duplicate_row.id]
    assert not any("differs from the merged fixture" in w for w in report.warnings)


def test_l4_digest_binds_the_content_of_moved_rows(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="l4@example.com", password_hash="hash")
    db_session.add(user)
    db_session.flush()
    pick = MatchPick(user_id=user.id, match_id=provider.id, pick="draw")
    db_session.add(pick)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)

    pick.pick = "home"  # same row id, same counts, different content
    db_session.commit()

    assert repair_fixture_duplicates(db_session).digest != dry.digest
    with pytest.raises(RepairRefused, match="digest mismatch"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)


def test_only_the_expected_club_merges_are_made(db_session, monkeypatch):
    _seed_duplicate(db_session)
    # Aliased to "Malaga", but not one of the three duplicate clubs.
    db_session.add(Team(name="Málaga CF"))
    db_session.commit()
    names = [t.donor_name for t in repair_fixture_duplicates(db_session).team_mappings]
    assert names == ["RC Deportivo La Coruña"]

    monkeypatch.setattr(repair_mod, "normalize_team_name", lambda name: name)
    report = repair_fixture_duplicates(db_session)
    assert report.teams_merged == 0
    assert any("alias table maps 'RC Deportivo La Coruña'" in b for b in report.blocking)
    assert report.ready_to_apply is False


def test_acknowledgement_parsing():
    assert parse_acknowledgements(["kickoff-gap:7, score-mismatch:9", "exclude:12"]) == [
        "exclude:12", "kickoff-gap:7", "score-mismatch:9",
    ]
    for bad in ("kickoff-gap", "gap:7", "exclude:x", "unpaired:12"):
        with pytest.raises(DuplicateRepairError):
            parse_acknowledgements([bad])


# --------------------------------------------------------------------------
# Third review (Postgres rehearsal): each test reproduces a reviewer finding.


def _undo_from_evidence(db_session, evidence: dict) -> None:
    """Reverse an applied repair using nothing but its evidence file."""
    undo_from_evidence(db_session, evidence)
    db_session.commit()


def test_h1_evidence_alone_is_enough_to_undo_the_repair(db_session, monkeypatch):
    tournament, ids, rows, _ = _production_shaped(db_session)
    rows["both_legacy"].kickoff_utc += timedelta(hours=8)  # history row on another day
    db_session.add(LearningChainStatus(id=1, covered_finished=3))
    db_session.commit()
    before = _fingerprint(db_session)
    policy = parse_on_conflict(["match_picks=keep-donor"])
    dry = repair_fixture_duplicates(db_session, on_conflict=policy)
    assert dry.ready_to_apply, dry.blocking
    applied = repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest,
                                        on_conflict=policy)
    assert _fingerprint(db_session) != before
    evidence = json.loads(report_json(applied))
    assert evidence["report"]["moved_rows"]["predictions.match_id"][0].keys() == {
        "id", "old", "new", "after_hash"}
    assert evidence["report"]["covered_finished_before"] == 3

    _undo_from_evidence(db_session, evidence)

    assert _fingerprint(db_session) == before


def test_m2_any_database_error_refuses_cleanly(db_session, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    _seed_duplicate(db_session)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)
    before = _fingerprint(db_session)

    class Orig(Exception):
        pgcode = "23503"

    def concurrent_insert(db, plan):
        db.execute(text("DELETE FROM standings"))
        raise IntegrityError("DELETE FROM matches", {}, Orig("violates foreign key"))

    monkeypatch.setattr(repair_mod, "_execute", concurrent_insert)
    with pytest.raises(RepairRefused, match="nothing was written; rollback confirmed"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)
    assert _fingerprint(db_session) == before


def test_m3_kept_history_row_is_the_one_the_next_sync_looks_up(db_session):
    # Both copies finished; the legacy kickoff (and its history row) is on
    # another UTC day than the football-data kickoff the merged row keeps.
    tournament, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home = legacy.score_away = 1
    legacy.kickoff_utc = KICKOFF - timedelta(hours=20)
    db_session.add_all([
        HistoricalMatch(date=legacy.kickoff_utc, team_a_id=legacy.team_home_id,
                        team_b_id=canonical.id, score_a=1, score_b=1, competition=COMPETITION),
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id,
                        team_b_id=duplicate.id, score_a=1, score_b=1, competition=COMPETITION),
    ])
    db_session.commit()
    legacy_id = legacy.id

    report = _apply(db_session)

    assert report.summary["history_rows_dropped"] == 1
    (row,) = db_session.query(HistoricalMatch).all()
    assert row.date.replace(tzinfo=timezone.utc).date() == KICKOFF.date()
    assert (row.team_a_id, row.team_b_id) == (
        db_session.get(Match, legacy_id).team_home_id, canonical.id)
    # The refresh's sync finds it and adds nothing.
    tournament = db_session.get(Tournament, tournament.id)
    assert sync_finished_matches_to_history(
        db_session, tournament, competition=COMPETITION)["matches_inserted"] == 0
    assert db_session.query(HistoricalMatch).count() == 1


def test_m3_a_single_history_row_off_the_sync_key_is_corrected(db_session):
    _, _, canonical, _, legacy, _ = _seed_duplicate(db_session)
    row = HistoricalMatch(date=KICKOFF - timedelta(hours=20), team_a_id=legacy.team_home_id,
                          team_b_id=canonical.id, score_a=1, score_b=1, competition="old")
    db_session.add(row)
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    (fix,) = report.changed_rows["historical_matches"]
    assert fix["id"] == row.id
    assert (fix["old"]["competition"], fix["new"]["competition"]) == ("old", COMPETITION)
    assert fix["new"]["date"].startswith(KICKOFF.date().isoformat())


def test_m5_every_pair_block_has_a_way_forward(db_session):
    legacy, provider, legacy_pred, donor_pred, legacy_grade, donor_grade = (
        _both_finished_and_graded(db_session, survivor_score=(2, 0), donor_score=(1, 1)))
    provider.matchweek = 3
    db_session.delete(donor_grade)
    db_session.commit()
    sid = legacy.id

    blocked = repair_fixture_duplicates(db_session)
    assert any(f"matchweek-mismatch:{sid}" in b for b in blocked.blocking)
    assert any(f"score-mismatch:{sid}" in b for b in blocked.blocking)

    # Only the legacy copy is graded, on the legacy score: no policy can keep
    # it, but regrade can.
    acks = [f"matchweek-mismatch:{sid}", f"score-mismatch:{sid}"]
    still = repair_fixture_duplicates(db_session, acknowledge=acks)
    assert any(f"regrade:{sid}" in b for b in still.blocking)
    cleared = repair_fixture_duplicates(db_session, acknowledge=acks + [f"regrade:{sid}"])
    assert cleared.ready_to_apply is True, cleared.blocking
    assert [e["row"]["id"] for e in cleared.deleted_rows["prediction_results"]] == [
        legacy_grade.id]
    assert cleared.summary["matches_gradeable_at_next_refresh"] == [sid]

    # Or leave the pair alone entirely.
    excluded = repair_fixture_duplicates(
        db_session, acknowledge=[f"exclude:{sid}", f"exclude:{provider.id}"])
    assert excluded.blocking == []
    assert excluded.matches_merged == 0


def test_l1_kept_copy_post_kickoff_predictions_are_dropped_too(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    late = _prediction(provider.id, created_at=KICKOFF + timedelta(hours=3))
    db_session.add(late)
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    assert {e["row"]["id"]: e["reason"] for e in report.deleted_rows["predictions"]} == {
        late.id: "prediction_after_merged_kickoff"}


def test_l2_moving_a_pick_keeps_its_updated_at(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="l2@example.com", password_hash="hash")
    db_session.add(user)
    db_session.flush()
    stamp = datetime(2026, 9, 5, 12, tzinfo=timezone.utc)
    pick = MatchPick(user_id=user.id, match_id=provider.id, pick="draw", updated_at=stamp)
    db_session.add(pick)
    db_session.commit()
    pick_id, legacy_id = pick.id, legacy.id

    _apply(db_session)

    moved = db_session.get(MatchPick, pick_id)
    assert moved.match_id == legacy_id
    assert moved.updated_at.replace(tzinfo=timezone.utc) == stamp


def test_l3_l6_cli_exit_codes_and_status(db_session, monkeypatch, capsys, tmp_path):
    _seed_duplicate(db_session)
    db_session.commit()
    monkeypatch.setattr(repair_mod, "SessionLocal", lambda: _NoClose(db_session))

    real_execute = repair_mod._execute

    def broken(db, plan):
        raise DuplicateRepairError("simulated postcondition failure")

    monkeypatch.setattr(repair_mod, "_execute", broken)
    assert main([]) == 3
    out = capsys.readouterr().out
    assert "trial: failed: simulated postcondition failure" in out
    assert not any(l.startswith("digest") for l in out.splitlines())
    assert "status: not ready" in out

    monkeypatch.setattr(repair_mod, "_execute", real_execute)
    assert main([]) == 0
    digest = next(l.split()[1] for l in capsys.readouterr().out.splitlines()
                  if l.startswith("digest:"))
    assert main(["--apply", "--expected-digest", digest,
                 "--evidence-file", str(tmp_path / "apply.json")]) == 0
    capsys.readouterr()
    assert main([]) == 0
    lines = capsys.readouterr().out.splitlines()
    assert "status: nothing to repair" in lines
    assert not any(l.startswith(("ready_to_apply", "digest")) for l in lines)


def test_set_based_read_paths_match_the_real_functions(db_session):
    _, _, rows, _ = _production_shaped(db_session)
    ids = [row.id for row in rows.values()]

    bulk = repair_mod._read_paths_bulk(db_session, ids)

    for match_id in ids:
        match = db_session.get(Match, match_id)
        frozen = _frozen_prediction(db_session, match)
        shadow = frozen and _frozen_prediction(
            db_session, match, shadow=True,
            shadow_version=shadow_model_version_for(frozen.model_version))
        latest = latest_prediction(db_session, match_id)
        assert bulk[match_id] == {
            "frozen": frozen.id if frozen else None,
            "latest": latest.id if latest else None,
            "frozen_shadow": shadow.id if shadow else None,
        }, match_id


# --------------------------------------------------------------------------
# Fourth review.


def _raw(db_session, table_name, column, row_id):
    return db_session.execute(text(
        f"select {column} from {table_name} where id = :i"), {"i": row_id}).scalar()


def test_json_null_and_sql_null_survive_the_repair_and_the_undo(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    moved = _prediction(provider.id)
    dropped = _prediction(legacy.id, created_at=KICKOFF + timedelta(days=1))
    db_session.add_all([moved, dropped])
    db_session.commit()
    # Production stores some JSON columns as JSON null, others as SQL NULL.
    db_session.execute(text("update predictions set knockout = 'null', writeup = NULL"))
    db_session.execute(text("update matches set goal_events = 'null', card_events = NULL"))
    db_session.commit()
    before = _fingerprint(db_session)
    ids = (legacy.id, moved.id, dropped.id)

    report = _apply(db_session)
    evidence = json.loads(report_json(report))

    # Forward: a re-pointed row and the survivor keep JSON null as JSON null.
    assert _raw(db_session, "predictions", "knockout", ids[1]) == "null"
    assert _raw(db_session, "predictions", "writeup", ids[1]) is None
    assert _raw(db_session, "matches", "goal_events", ids[0]) == "null"
    assert _raw(db_session, "matches", "card_events", ids[0]) is None
    # The evidence keeps the distinction.
    (row,) = [e["row"] for e in evidence["report"]["deleted_rows"]["predictions"]]
    assert (row["knockout"], row["writeup"]) == ("null", None)

    _undo_from_evidence(db_session, evidence)

    assert _fingerprint(db_session) == before


def test_undo_cli_reports_first_and_needs_the_database_name(db_session, monkeypatch, tmp_path,
                                                            capsys):
    from pipeline import repair_fixture_duplicates_undo as undo_mod

    _seed_duplicate(db_session)
    db_session.commit()
    before = _fingerprint(db_session)
    dry = repair_fixture_duplicates(db_session)
    applied = repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest)
    evidence = tmp_path / "apply.json"
    evidence.write_text(report_json(applied))
    after = _fingerprint(db_session)
    monkeypatch.setattr(undo_mod, "SessionLocal", lambda: _NoClose(db_session))
    monkeypatch.setattr(undo_mod, "_database_name", lambda db: "fw_prod")

    assert undo_mod.main(["--evidence-file", str(evidence)]) == 0
    assert "nothing written" in capsys.readouterr().out
    assert _fingerprint(db_session) == after
    assert undo_mod.main(["--evidence-file", str(evidence), "--confirm-database", "other"]) == 2
    assert _fingerprint(db_session) == after
    assert undo_mod.main(["--evidence-file", str(evidence), "--confirm-database", "fw_prod"]) == 0
    assert _fingerprint(db_session) == before
    # Applied twice? The fixtures are back, so the evidence no longer applies.
    assert undo_mod.main(["--evidence-file", str(evidence), "--confirm-database", "fw_prod"]) == 2
    dry_evidence = tmp_path / "dry.json"
    dry_evidence.write_text(report_json(dry))
    assert undo_mod.main(["--evidence-file", str(dry_evidence),
                          "--confirm-database", "fw_prod"]) == 2


def test_exclude_leaves_the_excluded_fixtures_history_alone(db_session):
    # Reviewer: excluding the both-finished pair still deleted its history row.
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    legacy.status = "finished"
    legacy.score_home = legacy.score_away = 1
    rows = [
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=canonical.id,
                        score_a=1, score_b=1, competition=COMPETITION),
        HistoricalMatch(date=KICKOFF, team_a_id=legacy.team_home_id, team_b_id=duplicate.id,
                        score_a=1, score_b=1, competition=COMPETITION),
    ]
    db_session.add_all(rows)
    db_session.commit()
    before = _fingerprint(db_session)
    acks = [f"exclude:{legacy.id}", f"exclude:{provider.id}"]

    report = repair_fixture_duplicates(db_session, acknowledge=acks)

    assert "historical_matches" not in report.deleted_rows
    assert report.changed_rows == {}
    repair_fixture_duplicates(db_session, apply=True, expected_digest=report.digest,
                              acknowledge=acks)
    assert _fingerprint(db_session) == before


def test_partial_exclusion_and_unmatched_acknowledgements_are_reported(db_session):
    # Reviewer: after an alias-aware refresh, excluding only the legacy copy
    # silently left the football-data copy behind.
    _, _, canonical, _, legacy, provider = _seed_duplicate(db_session)
    provider.team_away_id = canonical.id
    db_session.commit()

    partial = repair_fixture_duplicates(db_session, acknowledge=[f"exclude:{legacy.id}"])
    assert any("partial exclusion" in b and f"id={provider.id} " in b
               and f"exclude:{provider.id}" in b for b in partial.blocking)

    stray = repair_fixture_duplicates(
        db_session, acknowledge=["regrade:999999", f"kickoff-gap:{provider.id}"])
    assert "regrade:999999 matched no pair and was ignored" in stray.warnings
    assert (f"kickoff-gap:{provider.id} matched no pair and was ignored; use the kept "
            f"copy's id: kickoff-gap:{legacy.id}") in stray.warnings


def test_apply_writes_and_fsyncs_evidence_before_the_first_write(db_session, monkeypatch,
                                                                  tmp_path):
    _seed_duplicate(db_session)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)
    path = tmp_path / "evidence.json"
    seen = {}
    real_execute = repair_mod._execute

    def spy(db, plan):
        seen["evidence_before_writes"] = json.loads(path.read_text())
        return real_execute(db, plan)

    monkeypatch.setattr(repair_mod, "_execute", spy)
    repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest,
                              evidence_path=path)
    early = seen["evidence_before_writes"]["report"]
    assert early["digest"] == dry.digest
    assert early["trial"].startswith("applying")
    assert early["deleted_rows"]["teams"]


def test_unwritable_evidence_refuses_apply(db_session, tmp_path):
    _seed_duplicate(db_session)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)
    before = _fingerprint(db_session)

    with pytest.raises(RepairRefused, match="cannot write the evidence file"):
        repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest,
                                  evidence_path=tmp_path / "no-such-dir" / "e.json")
    assert _fingerprint(db_session) == before


SECRETS = ("leak-user@example.com", "user_id, match_id)=(2, 3)", "'away'", "db.internal.host",
           "fw_admin", "INSERT INTO match_picks")


def _integrity_error():
    from sqlalchemy.exc import IntegrityError

    class Orig(Exception):
        pgcode = "23505"

    message = ('duplicate key value violates unique constraint "uq_match_pick_user_match"\n'
               "DETAIL:  Key (user_id, match_id)=(2, 3) already exists. user "
               "leak-user@example.com pick 'away' on db.internal.host as fw_admin")
    return IntegrityError("INSERT INTO match_picks (user_id, match_id, pick) VALUES (2, 3, 'away')",
                          {"user_id": 2, "pick": "away", "email": "leak-user@example.com"},
                          Orig(message))


@pytest.mark.parametrize("mode", ["trial", "apply", "other"])
def test_failing_runs_print_no_row_values_hosts_or_users(db_session, monkeypatch, capfd,
                                                        tmp_path, mode):
    _seed_duplicate(db_session)
    db_session.commit()
    monkeypatch.setattr(repair_mod, "SessionLocal", lambda: _NoClose(db_session))
    digest = repair_fixture_duplicates(db_session).digest
    error = _integrity_error() if mode != "other" else KeyError("leak-user@example.com")

    def failing(db, plan):
        raise error

    monkeypatch.setattr(repair_mod, "_execute", failing)
    evidence = tmp_path / "evidence.json"
    argv = ["--evidence-file", str(evidence)]
    if mode in ("apply", "other"):
        argv += ["--apply", "--expected-digest", digest]

    rc = main(argv)

    out, err = capfd.readouterr()
    for secret in SECRETS:
        assert secret not in out + err, (mode, secret)
    if mode == "trial":
        assert rc == 3
        assert "trial: failed: database error Orig (SQLSTATE 23505)" in out
        # Full detail lives only in the (encrypted) evidence.
        assert "already exists" in json.loads(evidence.read_text())["report"]["trial_error_detail"]
    elif mode == "apply":
        assert rc == 2 and "SQLSTATE 23505" in err and "nothing was written" in err
    else:
        assert rc == 4 and err.strip() == "ERROR: KeyError"


# --------------------------------------------------------------------------
# Fifth review: the undo verifies before it writes.


def _applied_with_dependents(db_session):
    _, _, _, _, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="undo@example.com", password_hash="hash")
    other = AppUser(email="undo2@example.com", password_hash="hash")
    db_session.add_all([user, other])
    db_session.flush()
    pick = MatchPick(user_id=user.id, match_id=provider.id, pick="draw")
    moved_pred = _prediction(provider.id)
    db_session.add_all([pick, moved_pred])
    db_session.commit()
    ids = {"legacy": legacy.id, "pick": pick.id, "pred": moved_pred.id, "other": other.id}
    report = _apply(db_session)
    return ids, json.loads(report_json(report))


@pytest.mark.parametrize("drift", [
    "survivor_finished", "new_pick_on_survivor", "moved_pick_edited", "moved_prediction_deleted",
    "new_history_on_club",
])
def test_undo_refuses_when_anything_changed_since_the_repair(db_session, drift):
    from pipeline.repair_fixture_duplicates_undo import UndoRefused

    ids, evidence = _applied_with_dependents(db_session)
    sql = {
        "survivor_finished": f"update matches set status='postponed' where id={ids['legacy']}",
        "new_pick_on_survivor": f"insert into match_picks (user_id, match_id, pick, updated_at) "
                                f"values ({ids['other']}, {ids['legacy']}, 'home', '2026-11-21')",
        "moved_pick_edited": f"update match_picks set pick='home' where id={ids['pick']}",
        "moved_prediction_deleted": f"delete from predictions where id={ids['pred']}",
        "new_history_on_club": "insert into historical_matches (date, team_a_id, team_b_id, "
                               "score_a, score_b, is_neutral) select kickoff_utc, team_home_id, "
                               f"team_away_id, 1, 0, 0 from matches where id={ids['legacy']}",
    }[drift]
    db_session.execute(text(sql))
    db_session.commit()
    before = _fingerprint(db_session)

    with pytest.raises(UndoRefused, match="differ from the state the repair left") as raised:
        undo_from_evidence(db_session, evidence)
    db_session.rollback()

    assert _fingerprint(db_session) == before
    message = str(raised.value)
    assert {"survivor_finished": "status changed since the repair",
            "new_pick_on_survivor": "written after the repair onto a survivor fixture",
            "moved_pick_edited": f"match_picks id {ids['pick']}: changed since the repair",
            "moved_prediction_deleted": f"predictions id {ids['pred']}: deleted since the repair",
            "new_history_on_club": "written after the repair onto an original club",
            }[drift] in message
    # Never values: the edited pick and the scores do not appear.
    assert "'home'" not in message and "score_home changed" not in message.replace(
        "score_home changed since the repair", "")


def test_undo_rolls_back_when_a_statement_touches_the_wrong_number_of_rows(db_session,
                                                                           monkeypatch):
    from pipeline import repair_fixture_duplicates_undo as undo_mod

    _, evidence = _applied_with_dependents(db_session)
    after = _fingerprint(db_session)
    real = undo_mod._insert_rows
    # One leaf table (nothing references standings) loses a row: the count
    # check, not a constraint, must catch it.
    monkeypatch.setattr(undo_mod, "_insert_rows", lambda db, table, rows: real(
        db, table, rows[:-1] if table.name == "standings" else rows))

    with pytest.raises(undo_mod.UndoRefused, match="row counts differ from the plan"):
        undo_mod.undo_from_evidence(db_session, evidence)
    db_session.rollback()
    assert _fingerprint(db_session) == after


def test_undo_refuses_evidence_of_an_apply_that_never_committed(db_session, tmp_path):
    from pipeline.repair_fixture_duplicates_undo import UndoRefused

    _seed_duplicate(db_session)
    db_session.commit()
    dry = repair_fixture_duplicates(db_session)
    path = tmp_path / "e.json"

    def boom(db, plan):
        raise DuplicateRepairError("simulated crash after the evidence was written")

    import pipeline.repair_fixture_duplicates as mod
    real = mod._execute
    mod._execute = boom
    try:
        with pytest.raises(DuplicateRepairError):
            repair_fixture_duplicates(db_session, apply=True, expected_digest=dry.digest,
                                      evidence_path=path)
    finally:
        mod._execute = real
    evidence = json.loads(path.read_text())
    assert evidence["report"]["trial"].startswith("applying")
    with pytest.raises(UndoRefused, match="not applied to this database"):
        undo_from_evidence(db_session, evidence)


def test_undo_reads_the_database_url_from_an_env_file(tmp_path, capsys):
    """The owner runs the undo from a clean checkout and points it at the
    original project folder's .env (a path with a space)."""
    from sqlalchemy.orm import Session as OrmSession

    from pipeline import repair_fixture_duplicates_undo as undo_mod

    database = tmp_path / "fw repair.sqlite"
    engine = create_engine(f"sqlite:///{database}")
    Base.metadata.create_all(engine)
    with OrmSession(engine) as session:
        _seed_duplicate(session)
        session.commit()
        before = _fingerprint(session)
        dry = repair_fixture_duplicates(session)
        applied = repair_fixture_duplicates(session, apply=True, expected_digest=dry.digest)
    evidence = tmp_path / "apply.json"
    evidence.write_text(report_json(applied))
    folder = tmp_path / "Final Whistle"
    folder.mkdir()
    (folder / ".env").write_text(f'SECRET_KEY=x\nDATABASE_URL="sqlite:///{database}"  # prod\n')

    argv = ["--evidence-file", str(evidence), "--env-file", str(folder / ".env")]
    assert undo_mod.main(argv) == 0
    assert "--confirm-database fw repair.sqlite" in capsys.readouterr().out
    assert undo_mod.main(argv + ["--confirm-database", "fw repair.sqlite"]) == 0
    with OrmSession(engine) as session:
        assert _fingerprint(session) == before
    assert undo_mod.main(["--evidence-file", str(evidence),
                          "--env-file", str(folder / "missing.env")]) == 2
