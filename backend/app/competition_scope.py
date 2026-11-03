"""Resolve public competition codes to their tournament rows.

The frontend routes use short, stable codes (``wc26``, ``epl``, ``laliga``,
``bundesliga``), while the database stores the provider-facing tournament
name.  Keeping that mapping in one backend module lets every list/detail
endpoint apply the same tournament boundary instead of accidentally combining
clubs and national teams when more than one competition is loaded.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models import Group, GroupTeam, Match, Tournament
from pipeline.leagues import LEAGUES


COMPETITION_TOURNAMENT_NAMES: dict[str, str] = {
    "wc26": "FIFA World Cup 2026",
    **{code: config["tournament_name"] for code, config in LEAGUES.items()},
}

# The reverse lookup, for responses the frontend routes by competition.
_TOURNAMENT_COMPETITIONS: dict[str, str] = {
    name: code for code, name in COMPETITION_TOURNAMENT_NAMES.items()
}


def competition_for_tournament(tournament: Tournament | str | None) -> str | None:
    """The public code for a tournament (row or name), or ``None``.

    The inverse of ``tournament_for_competition``, used where a bare
    ``/match/:id`` or ``/team/:id`` link must be resolved to its
    ``/football/{competition}/...`` page. Unlike that lookup it never raises:
    a tournament with no public code (a past season, anything not in
    ``COMPETITION_TOURNAMENT_NAMES``) is simply ``None``.
    """
    if tournament is None:
        return None
    name = tournament if isinstance(tournament, str) else tournament.name
    return _TOURNAMENT_COMPETITIONS.get(name)


def competition_for_team(db: Session, team_id: int) -> str | None:
    """The competition a team's bare ``/team/:id`` link resolves to, or ``None``.

    Membership is the rule ``/api/teams?competition=`` already applies: a
    ``GroupTeam`` row in one of the tournament's groups, or a fixture in it
    (cup qualifiers never enter ``GroupTeam``). Among the tournaments with a
    public code the latest wins -- year, then row id -- except that within a
    year a domestic league beats a cross-border cup sharing its Team rows
    (``owns_served_rating=False`` in ``LEAGUES``), so a club in the Premier
    League and the Champions League resolves to the Premier League.
    """
    tournament_ids = {
        tournament_id
        for (tournament_id,) in (
            db.query(Group.tournament_id)
            .join(GroupTeam, GroupTeam.group_id == Group.id)
            .filter(GroupTeam.team_id == team_id)
            .all()
        )
    }
    tournament_ids.update(
        tournament_id
        for (tournament_id,) in (
            db.query(Match.tournament_id)
            .filter((Match.team_home_id == team_id) | (Match.team_away_id == team_id))
            .distinct()
            .all()
        )
    )
    if not tournament_ids:
        return None
    candidates = [
        (tournament, code)
        for tournament in db.query(Tournament).filter(Tournament.id.in_(tournament_ids)).all()
        if (code := competition_for_tournament(tournament)) is not None
    ]
    if not candidates:
        return None
    _, code = max(
        candidates,
        key=lambda candidate: (
            candidate[0].year,
            LEAGUES.get(candidate[1], {}).get("owns_served_rating", True),
            candidate[0].id,
        ),
    )
    return code


def tournament_for_competition(
    db: Session,
    competition: str | None,
) -> Tournament | None:
    """Return the requested tournament, or ``None`` for an unloaded one.

    ``competition=None`` intentionally preserves the legacy all-tournaments
    endpoints for old callers.  A known-but-unloaded competition is not an
    error: its dedicated UI can render an honest empty state.  Unknown codes
    are rejected so a typo can never silently broaden a query to all data.
    """
    if competition is None:
        return None

    tournament_name = COMPETITION_TOURNAMENT_NAMES.get(competition)
    if tournament_name is None:
        raise HTTPException(
            status_code=404,
            detail={
                "code": "competition_not_found",
                "message": f"Unknown competition {competition}",
            },
        )
    return db.query(Tournament).filter(Tournament.name == tournament_name).one_or_none()


def competition_cache_key(prefix: str, competition: str | None) -> str:
    return f"{prefix}:{competition or 'all'}"
