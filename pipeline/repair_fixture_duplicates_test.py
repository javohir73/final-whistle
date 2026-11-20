import json
from datetime import datetime, timezone

import pytest

from app.models import (
    AppUser,
    Group,
    GroupTeam,
    LeagueScorePrediction,
    Match,
    MatchPick,
    Prediction,
    Standing,
    Team,
    TeamTournamentState,
    TipPlayer,
    Tournament,
)
from pipeline.repair_fixture_duplicates import (
    DuplicateRepairError,
    MatchMerge,
    TeamMerge,
    repair_fixture_duplicates,
    report_json,
)


KICKOFF = datetime(2026, 8, 24, 19, 30, tzinfo=timezone.utc)


def _seed_duplicate(db_session):
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
        is_neutral=False,
    )
    provider = Match(
        tournament_id=tournament.id,
        group_id=group.id,
        stage="group",
        team_home_id=malaga.id,
        team_away_id=duplicate.id,
        kickoff_utc=KICKOFF,
        status="finished",
        score_home=1,
        score_away=1,
        score_home_90=1,
        score_away_90=1,
        fixture_provider="football_data",
        provider_fixture_id=564640,
        provider_last_updated=datetime(2026, 8, 25, tzinfo=timezone.utc),
        is_neutral=False,
    )
    db_session.add_all([legacy, provider])
    db_session.flush()
    return tournament, group, canonical, duplicate, legacy, provider


def _prediction(match_id, *, shadow):
    return Prediction(
        match_id=match_id,
        model_version="shadow-v1" if shadow else "served-v1",
        prob_home_win=0.4,
        prob_draw=0.3,
        prob_away_win=0.3,
        predicted_score_home=1,
        predicted_score_away=1,
        is_shadow=shadow,
    )


def test_dry_run_reports_exact_merge_and_writes_nothing(db_session):
    _, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    served = _prediction(provider.id, shadow=False)
    db_session.add(served)
    db_session.commit()

    report = repair_fixture_duplicates(db_session)

    assert report.dry_run is True
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
            kickoff_utc="2026-08-24T19:30:00+00:00",
            donor_match_id=provider.id,
            survivor_match_id=legacy.id,
            donor_fixture_id=564640,
            survivor_fixture_id=2001,
            home="Malaga",
            away="Deportivo La Coruna",
        ),
    )
    assert report.tournament_counts == {"La Liga 2026-27": 1}
    payload = json.loads(report_json(report))
    assert payload["tournament_counts"] == {"La Liga 2026-27": 1}
    assert payload["team_mappings"] == [{
        "donor_name": "RC Deportivo La Coruña",
        "donor_team_id": duplicate.id,
        "survivor_name": "Deportivo La Coruna",
        "survivor_team_id": canonical.id,
    }]
    assert payload["match_mappings"][0] == {
        "away": "Deportivo La Coruna",
        "donor_fixture_id": 564640,
        "donor_match_id": provider.id,
        "home": "Malaga",
        "kickoff_utc": "2026-08-24T19:30:00+00:00",
        "survivor_fixture_id": 2001,
        "survivor_match_id": legacy.id,
        "tournament_id": legacy.tournament_id,
        "tournament_name": "La Liga 2026-27",
    }
    assert db_session.get(Match, legacy.id).status == "scheduled"
    assert db_session.get(Match, provider.id).status == "finished"
    assert db_session.get(Prediction, served.id).match_id == provider.id
    assert db_session.get(Team, canonical.id) is not None
    assert db_session.get(Team, duplicate.id) is not None


def test_apply_preserves_dependencies_and_authoritative_fixture_state(db_session):
    tournament, _, canonical, duplicate, legacy, provider = _seed_duplicate(db_session)
    served = _prediction(provider.id, shadow=False)
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

    report = repair_fixture_duplicates(db_session, apply=True)

    assert report.dry_run is False
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
    assert (
        db_session.query(TeamTournamentState)
        .filter_by(team_id=canonical.id)
        .count()
        == 1
    )


def test_ambiguous_three_match_group_aborts_without_changes(db_session):
    tournament, group, canonical, _, legacy, provider = _seed_duplicate(db_session)
    extra = Match(
        tournament_id=tournament.id,
        group_id=group.id,
        stage="group",
        team_home_id=legacy.team_home_id,
        team_away_id=canonical.id,
        kickoff_utc=KICKOFF,
        status="scheduled",
        fixture_provider="api_football",
        provider_fixture_id=2002,
        is_neutral=False,
    )
    db_session.add(extra)
    db_session.commit()

    with pytest.raises(DuplicateRepairError, match="ambiguous"):
        repair_fixture_duplicates(db_session, apply=True)

    assert db_session.get(Match, provider.id) is not None
    assert db_session.get(Match, legacy.id) is not None
    assert db_session.get(Match, extra.id) is not None


def test_unique_user_conflict_aborts_the_whole_repair(db_session):
    _, _, _, duplicate, legacy, provider = _seed_duplicate(db_session)
    user = AppUser(email="conflict@example.com", password_hash="hash")
    db_session.add(user)
    db_session.flush()
    db_session.add_all([
        MatchPick(user_id=user.id, match_id=legacy.id, pick="home"),
        MatchPick(user_id=user.id, match_id=provider.id, pick="draw"),
    ])
    db_session.commit()

    with pytest.raises(DuplicateRepairError, match="dependent rows"):
        repair_fixture_duplicates(db_session, apply=True)

    assert db_session.get(Match, legacy.id).status == "scheduled"
    assert db_session.get(Match, provider.id).status == "finished"
    assert db_session.get(Team, duplicate.id) is not None
    assert db_session.query(MatchPick).count() == 2
