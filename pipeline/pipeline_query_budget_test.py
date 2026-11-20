"""Query budget for the daily league pipeline (Actions-minutes regression).

The daily refresh runs on a GitHub Actions runner against a remote Postgres,
so every SQL statement is a network round trip. The 2026-11-15 run spent
~2.9 s per match in ``<league>_predictions`` and ~200 s per learning-loop
pass re-querying finished matches that have no prediction at all. Both were
per-row N+1 lookups, not compute.

These tests seed a realistic club league in in-memory SQLite, count the
statements actually sent to the database (a ``before_cursor_execute``
listener), and pin a per-match ceiling so the N+1 can't silently return.
The ceilings carry headroom over the measured value; raise them only with a
reason, never to make a new per-match query fit.

INSERTs are not counted: SQLite's driver makes the ORM insert row by row,
while Postgres batches each flush into one statement, so the INSERT count
here says nothing about production round trips. Reads are what multiplied.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from sqlalchemy import event

from app.models import (
    Group,
    GroupTeam,
    HistoricalMatch,
    LineupPlayer,
    Match,
    MatchLineup,
    Odds,
    Player,
    Prediction,
    Team,
    TeamStats,
    TeamTournamentState,
    Tournament,
)
from pipeline.generate_predictions import generate_predictions
from pipeline.leagues import club_baseline_params_for, club_params_for
from pipeline.learning_loop import run_learning_loop

N_TEAMS = 20
N_SCHEDULED = 60
N_FINISHED_PREDICTED = 30
N_FINISHED_UNPREDICTED = 80

#: Non-INSERT statements per scheduled match in a league predictions pass
#: (club params + the v0.1 baseline twin). Measured 47.4 before the run memo
#: (teams, stats, squads, lineups, odds and finished matches re-read per
#: twin), 2.6 after (the head-to-head read and fixed per-pass overhead).
PREDICTIONS_STATEMENTS_PER_MATCH = 4
#: Non-INSERT statements per finished match in a first learning-loop pass.
#: Measured 3.5 before (a frozen-prediction lookup per match per record,
#: never-predicted matches included, plus the history double-count guard and
#: the per-team state read), 0.85 after (lookups only for matches that have
#: predictions to grade).
LEARNING_LOOP_STATEMENTS_PER_MATCH = 1.5
#: SELECTs on team_tournament_state in one learning-loop pass, whatever the
#: team count: update_tournament_state reads every row once, then the pass
#: reads them back once. The per-match ceiling above can't see this one -- a
#: per-team lookup is only N_TEAMS / finished (~0.18) extra per match.
TOURNAMENT_STATE_READS = 3
#: A steady-state learning-loop pass (nothing new to grade -- the second
#: served model version in the daily run). Measured 300 before, 10 after.
LEARNING_LOOP_STEADY_STATE_STATEMENTS = 15


@contextmanager
def count_statements(db):
    """Yield a list that collects every non-INSERT SQL statement the
    session's engine executes inside the block (see module docstring)."""
    engine = db.get_bind()
    seen: list[str] = []

    def _on_execute(conn, cursor, statement, parameters, context, executemany):
        if not statement.lstrip().upper().startswith("INSERT"):
            seen.append(statement)

    event.listen(engine, "before_cursor_execute", _on_execute)
    try:
        yield seen
    finally:
        event.remove(engine, "before_cursor_execute", _on_execute)


def _reads_of(statements: list[str], table: str) -> int:
    """How many of ``statements`` are SELECTs reading from ``table``."""
    return sum(
        1 for s in statements
        if s.lstrip().upper().startswith("SELECT") and f"FROM {table}".upper() in s.upper()
    )


def seed_league(db) -> Tournament:
    """A club league shaped like production: rated teams with stats, squads
    and history; a played half-season (cards, some predicted pre-kickoff,
    most synced from results only); and a scheduled run-in with odds,
    injuries and a couple of announced XIs."""
    now = datetime.now(timezone.utc).replace(microsecond=0)
    tournament = Tournament(
        name="Test League", year=2026, home_advantage_mode="home",
        home_advantage_value=55.0,
    )
    db.add(tournament)
    db.flush()
    group = Group(tournament_id=tournament.id, name="Test League")
    db.add(group)
    db.flush()

    teams = []
    for i in range(N_TEAMS):
        t = Team(name=f"Club {i:02d}", elo_rating=1450.0 + i * 17,
                 provider_team_id=1000 + i)
        db.add(t)
        teams.append(t)
    db.flush()
    pid = 50_000
    for i, t in enumerate(teams):
        db.add(GroupTeam(group_id=group.id, team_id=t.id))
        db.add(TeamStats(team_id=t.id, as_of_date=now - timedelta(days=1),
                         matches_played=20, goals_for=25 + i, goals_against=30 - i,
                         form_points_last10=1.0 + (i % 5) * 0.3))
        for j in range(18):
            pid += 1
            db.add(Player(
                provider_player_id=pid, name=f"P{t.id}-{j}", team_id=t.id,
                position="GDDDDMMMMMMFFFFDMF"[j], club_goals=j % 7,
                club_minutes=600 + 90 * j, wc_goals=0, wc_minutes=0, season=2025,
            ))
    # Two seasons of history between every pair -> realistic h2h/form reads.
    for season in range(2):
        for a in range(N_TEAMS):
            for b in range(a + 1, N_TEAMS):
                db.add(HistoricalMatch(
                    date=now - timedelta(days=400 + season * 365 + a * 3 + b),
                    team_a_id=teams[a].id, team_b_id=teams[b].id,
                    score_a=(a + b + season) % 4, score_b=(a * b) % 3,
                    competition="Test League", is_neutral=False,
                ))
    db.flush()

    pairs = [(h, a) for h in range(N_TEAMS) for a in range(N_TEAMS) if h != a]
    fixture = 0

    def _match(h, a, **kw):
        nonlocal fixture
        fixture += 1
        m = Match(tournament_id=tournament.id, group_id=group.id, stage="group",
                  team_home_id=teams[h].id, team_away_id=teams[a].id,
                  is_neutral=False, provider_fixture_id=fixture, **kw)
        db.add(m)
        return m

    finished = N_FINISHED_PREDICTED + N_FINISHED_UNPREDICTED
    predicted_finished = []
    for k in range(finished):
        h, a = pairs[(k * 7) % len(pairs)]
        m = _match(
            h, a, status="finished", score_home=k % 3, score_away=(k + 1) % 2,
            score_home_90=k % 3, score_away_90=(k + 1) % 2,
            kickoff_utc=now - timedelta(days=finished - k, hours=2),
            card_events=[
                {"minute": 30, "side": "home", "player": f"P{teams[h].id}-{k % 18}", "type": "yellow"},
                {"minute": 70, "side": "away", "player": f"P{teams[a].id}-{(k + 3) % 18}",
                 "type": "red" if k % 9 == 0 else "yellow"},
            ],
        )
        if k % 4 == 0:
            predicted_finished.append(m)
    # Most finished rows were synced from results only (no prediction ever).
    while len(predicted_finished) < N_FINISHED_PREDICTED:
        predicted_finished.append(None)
    db.flush()
    for m in predicted_finished:
        if m is None:
            continue
        for shadow, version in ((False, "poisson-elo-club-v0.3"),
                                (True, "poisson-elo-club-v0.3-shadow")):
            db.add(Prediction(
                match_id=m.id, model_version=version,
                created_at=m.kickoff_utc - timedelta(days=1),
                prob_home_win=0.45, prob_draw=0.27, prob_away_win=0.28,
                predicted_score_home=1, predicted_score_away=1,
                predicted_score_prob=0.12, confidence="medium",
                reasons=[], top_features=[], is_shadow=shadow,
            ))

    scheduled = []
    for k in range(N_SCHEDULED):
        h, a = pairs[(k * 11 + 3) % len(pairs)]
        injuries = None
        if k % 3 == 0:
            injuries = [{"provider_player_id": 50_001 + h * 18 + 5, "name": "x",
                         "type": "out", "reason": "knee", "side": "home"}]
        elif k % 3 == 1:
            injuries = []
        scheduled.append(_match(h, a, status="scheduled",
                                kickoff_utc=now + timedelta(days=1 + k // 10, hours=k % 10),
                                injuries=injuries))
    db.flush()
    for k, m in enumerate(scheduled):
        if k % 2 == 0:
            db.add(Odds(match_id=m.id, bookmaker="consensus", odds_home=2.1,
                        odds_draw=3.4, odds_away=3.6, odds_over25=1.9,
                        odds_under25=1.95, implied_prob_home=0.46,
                        implied_prob_draw=0.28, implied_prob_away=0.26,
                        captured_at=now - timedelta(hours=k % 5)))
    for m in scheduled[:2]:
        for side, team_id in (("home", m.team_home_id), ("away", m.team_away_id)):
            lineup = MatchLineup(match_id=m.id, side=side, provider="api_football",
                                 fetched_at=now)
            db.add(lineup)
            db.flush()
            squad = db.query(Player).filter_by(team_id=team_id).order_by(Player.id).all()
            for order, p in enumerate(squad[:11]):
                db.add(LineupPlayer(match_lineup_id=lineup.id, name=p.name,
                                    position=p.position, is_starter=True,
                                    order=order, provider_player_id=p.provider_player_id))
    db.commit()
    return tournament


def _league_predictions(db, tournament):
    params = club_params_for("epl")
    return generate_predictions(
        db, model_version=params.version, n_sims=50, tournament_sims=50,
        tournament_id=tournament.id, params=params,
        baseline_params=club_baseline_params_for("epl"),
        base_strengths={t.id: t.elo_rating for t in db.query(Team).all()},
    )


def test_league_predictions_stay_within_statement_budget(db_session):
    tournament = seed_league(db_session)
    with count_statements(db_session) as statements:
        summary = _league_predictions(db_session, tournament)

    assert summary["matches_predicted"] == N_SCHEDULED
    per_match = len(statements) / N_SCHEDULED
    assert per_match <= PREDICTIONS_STATEMENTS_PER_MATCH, (
        f"{len(statements)} statements for {N_SCHEDULED} matches "
        f"({per_match:.1f}/match) -- a per-match query has crept back in"
    )


def test_learning_loop_stays_within_statement_budget(db_session, caplog):
    seed_league(db_session)
    finished = N_FINISHED_PREDICTED + N_FINISHED_UNPREDICTED
    with caplog.at_level(logging.WARNING, logger="pipeline.learning_loop"):
        with count_statements(db_session) as statements:
            summary = run_learning_loop(db_session, "poisson-elo-club-v0.3")

    # Behaviour is unchanged: every finished match with a frozen prediction
    # is graded, every one without is warned about (by id, in kickoff order).
    predicted = db_session.query(Prediction.match_id).filter(
        Prediction.is_shadow.is_(False)).distinct().count()
    assert summary["evaluated_new"] == predicted
    assert summary["shadow_evaluated_new"] == predicted
    warned = [r.getMessage() for r in caplog.records
              if "has no pre-kickoff prediction" in r.getMessage()]
    assert len(warned) == finished - predicted

    per_match = len(statements) / finished
    assert per_match <= LEARNING_LOOP_STATEMENTS_PER_MATCH, (
        f"{len(statements)} statements for {finished} finished matches "
        f"({per_match:.1f}/match) -- a per-match query has crept back in"
    )
    state_reads = _reads_of(statements, TeamTournamentState.__tablename__)
    assert db_session.query(TeamTournamentState).count() == N_TEAMS
    assert state_reads <= TOURNAMENT_STATE_READS, (
        f"{state_reads} reads of {TeamTournamentState.__tablename__} for "
        f"{N_TEAMS} teams -- a per-team state lookup has crept back in"
    )

    # Second served version, nothing new to grade: must not re-query every
    # finished match one by one.
    with count_statements(db_session) as steady:
        again = run_learning_loop(db_session, "poisson-elo-ucl-v0.2")
    assert again["evaluated_new"] == again["shadow_evaluated_new"] == 0
    assert len(steady) <= LEARNING_LOOP_STEADY_STATE_STATEMENTS, (
        f"{len(steady)} statements for a pass with nothing to grade"
    )
