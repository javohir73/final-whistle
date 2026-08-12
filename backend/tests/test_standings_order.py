"""A live league table is ranked on real results, never on the model.

group_to_out used the model's ``qualification_prob`` as its final tiebreak for
every competition. On a club league that means two clubs genuinely level on
points, goal difference and goals for are separated by the forecast — the table
quietly promotes whichever side the model prefers, while the page above it is
labelled "Live standings". WC26 groups legitimately keep the forecast as their
last tiebreak, so the fix is competition-shaped rather than global.
"""
import pytest

from app.models import Group, GroupTeam, HistoricalMatch, Match, Standing, Team, Tournament
from app.serializers import group_to_out


def _league(db, *, mode="home"):
    t = Tournament(name="Premier League 2026-27", year=2026, host_countries="",
                   home_advantage_mode=mode)
    db.add(t)
    db.flush()
    g = Group(tournament_id=t.id, name="Premier League")
    db.add(g)
    db.flush()
    return t, g


def _club(db, group, name, *, qual):
    team = Team(name=name, is_host=False)
    db.add(team)
    db.flush()
    db.add(GroupTeam(group_id=group.id, team_id=team.id))
    # Only the forecast is stored here; the served table's points/GF/GD come
    # from live_group_table's tally of finished results, not from this row.
    db.add(Standing(group_id=group.id, team_id=team.id, qualification_prob=qual))
    db.commit()
    return team


def _played(db, tournament, group, home, away, hg, ag):
    """One finished fixture, so the league is no longer 'unplayed'."""
    db.add(Match(tournament_id=tournament.id, group_id=group.id, stage="group",
                 team_home_id=home.id, team_away_id=away.id, status="finished",
                 score_home=hg, score_away=ag, is_neutral=False))
    db.commit()


def _order(db, group):
    return [r.team for r in group_to_out(db, group).standings]


def test_a_started_league_breaks_exact_ties_alphabetically_not_by_model(db_session):
    """THE regression. Zenith and Alpha are level on points, GD and GF; the
    model rates Zenith far higher. A live table must not use that."""
    t, g = _league(db_session)
    zenith = _club(db_session, g, "Zenith FC", qual=0.95)
    alpha = _club(db_session, g, "Alpha FC", qual=0.05)
    other_a = _club(db_session, g, "Midtable A", qual=0.5)
    other_b = _club(db_session, g, "Midtable B", qual=0.5)

    # Both drew 1-1, so both sit on 1 point, GD 0, GF 1 — a genuine dead heat.
    _played(db_session, t, g, zenith, other_a, 1, 1)
    _played(db_session, t, g, alpha, other_b, 1, 1)

    order = _order(db_session, g)
    assert order.index("Alpha FC") < order.index("Zenith FC")


def test_real_table_metrics_still_decide_the_order(db_session):
    """Guard against over-correcting into an alphabetical table."""
    t, g = _league(db_session)
    zenith = _club(db_session, g, "Zenith FC", qual=0.05)
    alpha = _club(db_session, g, "Alpha FC", qual=0.95)

    _played(db_session, t, g, zenith, alpha, 3, 0)  # Zenith 3pts, Alpha 0

    assert _order(db_session, g)[0] == "Zenith FC"


def test_an_unplayed_league_is_alphabetical(db_session):
    t, g = _league(db_session)
    _club(db_session, g, "Zenith FC", qual=0.95)
    _club(db_session, g, "Alpha FC", qual=0.05)

    assert _order(db_session, g) == ["Alpha FC", "Zenith FC"]


def test_wc26_groups_keep_the_qualification_forecast_as_a_tiebreak(db_session):
    """Unchanged behaviour. A tournament group's forecast is the useful signal
    before any match is played, and WC26 must not regress to alphabetical."""
    t, g = _league(db_session, mode="host")  # tournament, not a club league
    zenith = _club(db_session, g, "Zenith FC", qual=0.95)
    alpha = _club(db_session, g, "Alpha FC", qual=0.05)
    other_a = _club(db_session, g, "Midtable A", qual=0.5)
    other_b = _club(db_session, g, "Midtable B", qual=0.5)

    _played(db_session, t, g, zenith, other_a, 1, 1)
    _played(db_session, t, g, alpha, other_b, 1, 1)

    order = _order(db_session, g)
    assert order.index("Zenith FC") < order.index("Alpha FC")
