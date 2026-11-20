"""Reviewed manual results for football fixtures no provider will ever finish.

API-Football lapsed on 2026-08-18 and football-data.org (the provider since)
does not carry Champions League qualifying, so the 2026-27 play-off round —
fourteen fixtures, seven two-legged ties — stayed "scheduled" forever: shown
as unplayed, counted as stuck by /api/health, their frozen pre-kickoff
predictions never graded, and club Elo never learned from them.

This is deliberately a short, hand-reviewed list, not a second feed (the same
discipline as pipeline/sports/nrl_result_corrections.py). Rules:

- Add an entry only for a match no configured provider covers, and only with
  two independent sources that agree on the score; cite them below.
- Entries are keyed by natural identity — league code, home name, away name,
  kickoff date (UTC) — never by database id. Names resolve through
  pipeline.team_mapping exactly as provider fixtures do.
- An entry only ever fills a match that is still "scheduled" with no score.
  It never overwrites or contradicts a provider result: if a provider later
  reports the match, the provider's row wins and a disagreement is logged.
- Applied rows carry fixture_provider="manual" (migration a9b4c7d2e601's
  provenance column); provider_fixture_id keeps the id of the feed that
  created the fixture, for traceability.

Score convention, same as the providers (pipeline/ingest/league_structure.py):
score_home/away is the final result, after extra time when played, never
counting shootout kicks; score_home_90/away_90 is the score at the end of
normal time. No entry below went to penalties, so shootouts are not modelled.

Sources for the 2026-27 UEFA Champions League play-off round (every score
checked against both; they agree on all fourteen):
- UEFA Full Time Reports, https://www.uefa.com/newsfiles/UCL/2027/<id>_FR.pdf
  for match ids 2049208-2049221.
- https://en.wikipedia.org/wiki/2026–27_UEFA_Champions_League_qualifying
  (play-off round).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone

from sqlalchemy.orm import Session

from app.models import Match, Team, Tournament
from pipeline.ingest.league_structure import _club_identity_index, _club_identity_key
from pipeline.team_mapping import normalize_team_name

log = logging.getLogger(__name__)

MANUAL_PROVIDER = "manual"


@dataclass(frozen=True)
class ManualResult:
    competition: str  # pipeline.leagues code, e.g. "ucl"
    home: str
    away: str
    kickoff_date: date  # UTC calendar date of kickoff
    score_home: int  # final, after extra time when played
    score_away: int
    score_home_90: int  # end of normal time
    score_away_90: int


def _r(home: str, away: str, day: date, final: tuple[int, int],
       ninety: tuple[int, int] | None = None) -> ManualResult:
    ninety = final if ninety is None else ninety
    return ManualResult("ucl", home, away, day, final[0], final[1], ninety[0], ninety[1])


MANUAL_RESULTS: tuple[ManualResult, ...] = (
    # Play-off round, first legs.
    _r("Fenerbahçe", "Lyon", date(2026, 8, 18), (1, 1)),
    _r("Dinamo Zagreb", "Viking", date(2026, 8, 18), (2, 2)),
    _r("Levski Sofia", "AEK Athens FC", date(2026, 8, 18), (0, 0)),
    _r("Celtic", "Lask Linz", date(2026, 8, 19), (3, 0)),
    _r("NEC Nijmegen", "Bodo/Glimt", date(2026, 8, 19), (1, 3)),
    _r("Hapoel Beer Sheva", "Sabah FA", date(2026, 8, 19), (2, 1)),  # played in Bucharest
    _r("Slovan Bratislava", "Celje", date(2026, 8, 19), (1, 1)),
    # Second legs.
    _r("Sabah FA", "Hapoel Beer Sheva", date(2026, 8, 25), (5, 2), ninety=(3, 2)),  # aet
    _r("Lask Linz", "Celtic", date(2026, 8, 25), (5, 1), ninety=(4, 1)),  # aet
    _r("Bodo/Glimt", "NEC Nijmegen", date(2026, 8, 25), (3, 0)),
    _r("Lyon", "Fenerbahçe", date(2026, 8, 26), (1, 2)),
    _r("AEK Athens FC", "Levski Sofia", date(2026, 8, 26), (4, 0)),
    _r("Viking", "Dinamo Zagreb", date(2026, 8, 26), (3, 1)),
    _r("Celje", "Slovan Bratislava", date(2026, 8, 26), (1, 2), ninety=(1, 1)),  # aet
)


def entries_for(competition: str,
                entries: tuple[ManualResult, ...] = MANUAL_RESULTS) -> list[ManualResult]:
    return [e for e in entries if e.competition == competition]


def decide(entry: ManualResult, *, status: str, score_home: int | None,
           score_away: int | None, fixture_provider: str | None) -> str:
    """What to do with one entry against the one match it identifies. Pure.

    "apply"            scheduled, no score: fill it.
    "already_applied"  our own earlier write, unchanged: no-op.
    "provider_agrees"  a provider finished it with the same score: no-op.
    "conflict"         finished with a different score: never touched.
    "not_eligible"     any other state (in play, a provider stop status, a
                       scheduled row carrying a score): never touched.
    """
    if status == "scheduled" and score_home is None and score_away is None:
        return "apply"
    if status == "finished":
        same = (score_home, score_away) == (entry.score_home, entry.score_away)
        if not same:
            return "conflict"
        return "already_applied" if fixture_provider == MANUAL_PROVIDER else "provider_agrees"
    return "not_eligible"


def _apply(match: Match, entry: ManualResult) -> None:
    """Finish ``match`` in the shape a provider-finished fixture has."""
    match.status = "finished"
    match.score_home = entry.score_home
    match.score_away = entry.score_away
    match.score_home_90 = entry.score_home_90
    match.score_away_90 = entry.score_away_90
    match.penalty_home = match.penalty_away = None
    match.period = None
    match.minute = None
    match.injury_time = None
    match.fixture_provider = MANUAL_PROVIDER


def _team(db: Session, name: str, identity_index: dict) -> Team | None:
    team = db.query(Team).filter_by(name=normalize_team_name(name)).one_or_none()
    if team is not None:
        return team
    # The loader's own conservative cross-provider key; a key two clubs share
    # maps to None, so this never guesses between them.
    return identity_index.get(_club_identity_key(name))


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def apply_manual_results(
    db: Session,
    tournament: Tournament,
    competition: str,
    *,
    now: datetime | None = None,
    entries: tuple[ManualResult, ...] = MANUAL_RESULTS,
) -> dict:
    """Apply ``competition``'s reviewed entries to ``tournament``. Idempotent.

    Runs after the competition's fixture ingest and before its history sync,
    in the same transaction (flushes, never commits). Every entry that cannot
    be matched to exactly one past fixture is skipped with a warning naming it.
    """
    now = _utc(now or datetime.now(timezone.utc))
    counts = {
        "entries": 0, "applied": 0, "already_applied": 0,
        "provider_agrees": 0, "conflicts": 0, "skipped": 0,
    }
    selected = entries_for(competition, entries)
    if not selected:
        return counts
    identity_index = _club_identity_index(db)
    for entry in selected:
        counts["entries"] += 1
        label = (f"{entry.competition} {entry.home} v {entry.away} "
                 f"{entry.kickoff_date.isoformat()}")
        home = _team(db, entry.home, identity_index)
        away = _team(db, entry.away, identity_index)
        if home is None or away is None:
            log.warning("manual result %s: team name did not resolve, skipping", label)
            counts["skipped"] += 1
            continue
        candidates = [
            m for m in db.query(Match).filter_by(
                tournament_id=tournament.id,
                team_home_id=home.id,
                team_away_id=away.id,
            )
            if m.kickoff_utc is not None and _utc(m.kickoff_utc).date() == entry.kickoff_date
        ]
        if len(candidates) != 1:
            log.warning("manual result %s: %d candidate matches, skipping",
                        label, len(candidates))
            counts["skipped"] += 1
            continue
        match = candidates[0]
        if _utc(match.kickoff_utc) >= now:
            log.warning("manual result %s: match %s has not kicked off, skipping",
                        label, match.id)
            counts["skipped"] += 1
            continue
        action = decide(
            entry,
            status=match.status,
            score_home=match.score_home,
            score_away=match.score_away,
            fixture_provider=match.fixture_provider,
        )
        if action == "apply":
            _apply(match, entry)
            counts["applied"] += 1
            log.info("manual result %s: match %s finished %d-%d",
                     label, match.id, entry.score_home, entry.score_away)
        elif action == "already_applied":
            counts["already_applied"] += 1
        elif action == "provider_agrees":
            counts["provider_agrees"] += 1
            log.info("manual result %s: provider %s now reports match %s with the "
                     "same score; the entry can be removed", label,
                     match.fixture_provider, match.id)
        elif action == "conflict":
            counts["conflicts"] += 1
            # The stored row wins and is left alone. A PredictionResult graded
            # from the manual score is append-only and is NOT regraded: delete
            # that row by hand (after review) so the learning loop regrades it.
            log.error(
                "manual result %s DISAGREES with match %s as stored "
                "(provider=%s, %s-%s; entry says %d-%d). Stored row left "
                "unchanged; review the entry and any PredictionResult for "
                "this match.",
                label, match.id, match.fixture_provider, match.score_home,
                match.score_away, entry.score_home, entry.score_away,
            )
        else:
            counts["skipped"] += 1
            log.warning("manual result %s: match %s is %s with score %s-%s, "
                        "not eligible, skipping", label, match.id, match.status,
                        match.score_home, match.score_away)
    db.flush()
    return counts
