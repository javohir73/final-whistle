"""Load the Premier League 2026-27 structure (teams, one group, fixtures).

League pivot D1/D2 (docs/LEAGUE-PIVOT-PLAN.md): unlike WC2026's fixed
wc26_schedule.json, league fixtures move (TV picks, postponements), so teams
seed once from a small checked-in JSON but the 380 fixtures come from the
provider every refresh. Produces:
  - 20 teams (from teams_file)
  - 1 group ("Premier League") containing all 20
  - 380 stage="group" matches upserted from API-Football fixtures

Idempotent: safe to run repeatedly (upserts by provider fixture id; never
duplicates, never touches WC26 rows — those are a different tournament_id and
were seeded without a provider_fixture_id in the first place).

Also writes matches.matchweek (League Score Predictions design doc,
c8d9e0f1a2b3_add_match_matchweek migration) from the normalized fixture
contract — the
matchweek-scoped tipsheet/leaderboards' read side (app/api/
league_score_predictions.py) query this column; this is that column's only
writer. Set unconditionally on every upsert, like kickoff_utc/status/score_*,
so a broadcaster reshuffle that moves a fixture's round corrects it on the
next ingestion.

Parameterized (tournament_name/group_name/league_id/season) so
pipeline/leagues.py's registry + pipeline/run_pipeline.py's league branch can
drive this loader for any configured league, not just EPL — every parameter
defaults to this module's own EPL constant below, so nothing here changes
behavior for a bare load_league_structure(db) call.

League Score Predictions Phase 2 (docs/superpowers/specs/2026-07-24
-league-score-predictions-design.md): ``teams_file`` is now optional. EPL
keeps its checked-in JSON (byte-for-byte unchanged code path below); a league
with no curated JSON (La Liga/Bundesliga: promoted/relegated clubs for a
season not yet played aren't reliably known ahead of time) instead derives its
teams straight from the SAME fetch_fixtures payload this loader already pulls
— see _derive_teams_from_fixtures. Never hand-invent a club list or provider
id; the fixtures response is the one authoritative source at ingest time.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import Group, GroupTeam, Match, Team, Tournament
from pipeline.ingest.api_football import fetch_fixtures, normalize_league_fixture
from pipeline.ingest.fixture_contract import NormalizedFixture
from pipeline.ingest.football_data_org import fetch_football_data_fixtures
from pipeline.team_mapping import normalize_team_name

log = logging.getLogger(__name__)

DEFAULT_TEAMS_FILE = "pipeline/data/epl2627_teams.json"

TOURNAMENT_NAME = "Premier League 2026-27"
TOURNAMENT_YEAR = 2026
GROUP_NAME = "Premier League"

# API-Football league/season for this competition (a league loader is
# competition-specific, same as wc26_structure.py hardcoding its own
# TOURNAMENT_NAME/YEAR — the provider-facing values live here, not in
# app.config, which stays the single "whichever competition is currently
# live" switch used by odds/live-scores/injuries).
LEAGUE_ID = 39
SEASON = 2026

_RECONCILIATION_WINDOW_SECONDS = 48 * 60 * 60


class FixtureReconciliationError(RuntimeError):
    """Raised when a provider switch cannot be matched without guessing."""


def fetch_league_fixtures(
    api_key: str,
    *,
    fixture_source: str,
    league_id: int,
    competition_code: str | None,
    season: int,
    preserve_stopped_statuses: bool = True,
) -> list[NormalizedFixture | None]:
    """The sole provider-selection boundary for league fixture persistence."""
    if fixture_source == "api_football":
        raw_fixtures = fetch_fixtures(api_key, league=league_id, season=season)
        normalized = []
        for raw in raw_fixtures:
            # Older internal callers/tests supplied the subset consumed by the
            # pre-contract loader. The provider's real payload always includes
            # score, but an empty object is equivalent for scheduled fixtures.
            if isinstance(raw, dict) and "score" not in raw:
                raw = {**raw, "score": {}}
            normalized.append(
                normalize_league_fixture(
                    raw,
                    preserve_stopped_statuses=preserve_stopped_statuses,
                )
            )
        return normalized
    if fixture_source == "football_data":
        if not competition_code:
            raise ValueError(
                "competition_code is required for football_data fixtures"
            )
        return list(
            fetch_football_data_fixtures(
                api_key,
                competition_code,
                season,
            )
        )
    raise ValueError(f"unsupported fixture source: {fixture_source}")


def _load_teams_file(teams_file: str) -> list[dict]:
    return json.loads(Path(teams_file).read_text(encoding="utf-8"))["teams"]


def _derive_teams_from_fixtures(
    fixtures: list[NormalizedFixture | None],
) -> list[dict]:
    """Derive a teams-file-shaped roster from normalized fixtures.

    Only API-Football IDs belong in Team.provider_team_id. football-data.org
    IDs identify a different namespace and are deliberately discarded.
    """
    seen: dict[tuple[str, int | str], dict] = {}
    for fixture in fixtures:
        if fixture is None:
            continue
        for name, provider_id in (
            (fixture.home_name, fixture.home_provider_id),
            (fixture.away_name, fixture.away_provider_id),
        ):
            if fixture.provider == "api_football" and provider_id is None:
                continue
            api_football_id = (
                provider_id if fixture.provider == "api_football" else None
            )
            key: tuple[str, int | str]
            if api_football_id is not None:
                key = ("id", api_football_id)
            else:
                key = ("name", normalize_team_name(name))
            seen.setdefault(
                key,
                {
                    "name": name,
                    "code": None,
                    "api_football_id": api_football_id,
                },
            )
    return list(seen.values())


def _seed_teams(
    db: Session,
    group: Group,
    teams_data: list[dict],
    *,
    group_member_names: set[str] | None = None,
) -> dict[str, Team]:
    """Upsert every team in teams_data (whichever source produced it) and add
    it to ``group``. Factored out of load_league_structure so both the
    teams_file and the derive-from-fixtures paths share one upsert loop —
    same body, same order of operations, as the original inline loop."""
    team_by_name: dict[str, Team] = {}
    for t in teams_data:
        team = _upsert_team(db, t["name"], t.get("code"), t["api_football_id"])
        team_by_name[team.name] = team
        belongs_to_group = (
            group_member_names is None
            or team.name in group_member_names
        )
        if belongs_to_group:
            exists = db.query(GroupTeam).filter_by(
                group_id=group.id, team_id=team.id
            ).one_or_none()
            if exists is None:
                db.add(GroupTeam(group_id=group.id, team_id=team.id))
    return team_by_name


def _get_or_create_tournament(db: Session, tournament_name: str = TOURNAMENT_NAME) -> Tournament:
    t = db.query(Tournament).filter_by(name=tournament_name).one_or_none()
    if t is None:
        t = Tournament(
            name=tournament_name,
            # Every registered league (pipeline/leagues.py) is a 2026-27
            # season, same as EPL's -- not worth its own parameter until
            # Phase 2 actually needs a different value.
            year=TOURNAMENT_YEAR,
            host_countries="",
            # D4: a league has a real home side, not a host-nation bonus.
            home_advantage_mode="home",
        )
        db.add(t)
        db.flush()
    return t


def _upsert_team(
    db: Session,
    name: str,
    code: str | None,
    api_football_id: int | None,
) -> Team:
    """Look up by ``provider_team_id`` FIRST, falling back to name only for a
    team this provider id has never been seen for yet. Team.provider_team_id
    is unique (backend/app/models/__init__.py) -- a name-only lookup would
    miss an existing row whenever the provider renames a club's display name
    (a real, recurring API-Football event; the numeric id stays stable, only
    the label changes), then try to INSERT a second row with the SAME
    provider_team_id and raise IntegrityError on flush instead of updating
    the existing one in place (see league_structure_test.py's rename
    regression). The name-lookup fallback keeps a hypothetical bare
    name-only caller (api_football_id already unique-constrained, so this
    only matters pre-flush) working the same as before."""
    canon = normalize_team_name(name)
    team = None
    if api_football_id is not None:
        team = db.query(Team).filter_by(provider_team_id=api_football_id).one_or_none()
    if team is None:
        team = db.query(Team).filter_by(name=canon).one_or_none()
    if team is None:
        team = Team(
            name=canon, country_code=code, is_host=False,
            provider_team_id=api_football_id,
        )
        db.add(team)
        db.flush()
    else:
        team.name = canon
        team.country_code = code
        if api_football_id is not None:
            team.provider_team_id = api_football_id
    return team


def _get_or_create_group(db: Session, tournament: Tournament, group_name: str = GROUP_NAME) -> Group:
    group = db.query(Group).filter_by(
        tournament_id=tournament.id, name=group_name
    ).one_or_none()
    if group is None:
        group = Group(tournament_id=tournament.id, name=group_name)
        db.add(group)
        db.flush()
    return group


def _round_name(fx: NormalizedFixture) -> str | None:
    return fx.round_label


def _is_group_round(
    fx: NormalizedFixture, prefixes: tuple[str, ...] | None,
) -> bool:
    """Whether a fixture belongs to the displayed shared table.

    ``prefixes=None`` preserves domestic-league behavior (every fixture is a
    table fixture). An explicit prefix list is fail-closed: before the UCL
    league-phase draw, qualifying fixtures do not silently become table rows.
    """
    if prefixes is None:
        return True
    round_name = (_round_name(fx) or "").casefold()
    return any(round_name.startswith(prefix.casefold()) for prefix in prefixes)


def _stage_for_fixture(
    fx: NormalizedFixture, prefixes: tuple[str, ...] | None,
) -> str:
    """Map provider round text to an honest platform stage.

    Domestic leagues retain their historical ``group`` value. A configured
    shared-table cup distinguishes league-phase, qualifying/play-off, and
    knockout fixtures so downstream UI and tips never infer a table round from
    an unrelated trailing number such as "Round of 16".
    """
    if prefixes is None or _is_group_round(fx, prefixes):
        return "group"
    round_name = (_round_name(fx) or "").casefold()
    if "qualifying" in round_name or round_name in {"play-offs", "playoffs"}:
        return "qualifying"
    return "knockout"


def _is_neutral_fixture(fx: NormalizedFixture) -> bool:
    """UEFA's one-match final is played at a preselected neutral venue."""
    return (_round_name(fx) or "").casefold() == "final"


def _group_member_names(
    fixtures: list[NormalizedFixture | None],
    prefixes: tuple[str, ...] | None,
) -> set[str] | None:
    if prefixes is None:
        return None
    members: set[str] = set()
    for fx in fixtures:
        if fx is None or not _is_group_round(fx, prefixes):
            continue
        members.add(normalize_team_name(fx.home_name))
        members.add(normalize_team_name(fx.away_name))
    return members


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _reconcile_match(
    matches: list[Match],
    fixture: NormalizedFixture,
    home: Team,
    away: Team,
) -> Match | None:
    same_source_id = [
        match
        for match in matches
        if match.fixture_provider == fixture.provider
        and match.provider_fixture_id == fixture.fixture_id
    ]
    if len(same_source_id) == 1:
        return same_source_id[0]
    if len(same_source_id) > 1:
        raise FixtureReconciliationError(
            "ambiguous fixture reconciliation: repeated source fixture id "
            f"{fixture.provider}/{fixture.fixture_id}"
        )

    oriented_pair = [
        match
        for match in matches
        if match.team_home_id == home.id and match.team_away_id == away.id
    ]
    if len(oriented_pair) == 1:
        return oriented_pair[0]
    if len(oriented_pair) < 2:
        return None

    near_kickoff = [
        match
        for match in oriented_pair
        if match.kickoff_utc is not None
        and abs(
            (_utc(match.kickoff_utc) - _utc(fixture.kickoff_utc)).total_seconds()
        ) <= _RECONCILIATION_WINDOW_SECONDS
    ]
    if len(near_kickoff) == 1:
        return near_kickoff[0]
    if len(near_kickoff) > 1:
        raise FixtureReconciliationError(
            "ambiguous fixture reconciliation: multiple oriented team-pair "
            f"candidates within 48 hours for {fixture.home_name!r} vs "
            f"{fixture.away_name!r}"
        )
    return None


def load_league_structure(
    db: Session,
    teams_file: str | None = DEFAULT_TEAMS_FILE,
    api_key: str | None = None,
    *,
    tournament_name: str = TOURNAMENT_NAME,
    group_name: str = GROUP_NAME,
    league_id: int = LEAGUE_ID,
    season: int = SEASON,
    group_round_prefixes: tuple[str, ...] | None = None,
    preserve_stopped_statuses: bool = True,
    fixture_source: str = "api_football",
    competition_code: str | None = None,
    commit: bool = True,
) -> dict:
    """Load one league's structure (default: EPL 2026-27). The keyword-only
    tournament_name/group_name/league_id/season let pipeline/run_pipeline.py's
    league branch drive this for any league in pipeline.leagues.LEAGUES --
    every default is this module's own EPL constant, so a bare
    load_league_structure(db) call keeps behaving exactly as it did before
    this became parameterized. teams_file=None (Phase 2: a league with no
    curated JSON) derives teams from the fixtures payload instead -- see
    _derive_teams_from_fixtures. ``commit=False`` lets the caller atomically
    combine structure and history writes. Returns a summary dict."""
    if api_key is None:
        from app.config import settings

        api_key = (
            settings.football_data_api_key
            if fixture_source == "football_data"
            else settings.api_football_api_key
        )

    tournament = _get_or_create_tournament(db, tournament_name)
    group = _get_or_create_group(db, tournament, group_name)
    fixtures = fetch_league_fixtures(
        api_key,
        fixture_source=fixture_source,
        league_id=league_id,
        competition_code=competition_code,
        season=season,
        preserve_stopped_statuses=preserve_stopped_statuses,
    )

    if teams_file is not None:
        teams_data = _load_teams_file(teams_file)
        team_by_name = _seed_teams(db, group, teams_data)
    else:
        team_by_name = _seed_teams(
            db,
            group,
            _derive_teams_from_fixtures(fixtures),
            group_member_names=_group_member_names(
                fixtures, group_round_prefixes
            ),
        )

    existing_matches = db.query(Match).filter_by(
        tournament_id=tournament.id
    ).all()

    created = updated = skipped = 0
    for fixture in fixtures:
        if fixture is None:
            skipped += 1
            continue
        status = fixture.status
        if not preserve_stopped_statuses and status in {
            "postponed", "cancelled", "suspended",
        }:
            status = "scheduled"
        is_group_round = _is_group_round(fixture, group_round_prefixes)
        matchweek = fixture.matchweek
        if not is_group_round:
            matchweek = None
        home = team_by_name.get(normalize_team_name(fixture.home_name))
        away = team_by_name.get(normalize_team_name(fixture.away_name))
        if home is None or away is None:
            log.warning(
                "league fixture %s: unknown team(s) %r/%r",
                fixture.fixture_id,
                fixture.home_name,
                fixture.away_name,
            )
            skipped += 1
            continue

        match = _reconcile_match(existing_matches, fixture, home, away)
        if match is None:
            match = Match(
                tournament_id=tournament.id,
                group_id=group.id if is_group_round else None,
                stage=_stage_for_fixture(fixture, group_round_prefixes),
                team_home_id=home.id,
                team_away_id=away.id,
                is_neutral=_is_neutral_fixture(fixture),
            )
            db.add(match)
            created += 1
        else:
            updated += 1
        match.fixture_provider = fixture.provider
        match.provider_fixture_id = fixture.fixture_id
        match.provider_last_updated = fixture.upstream_updated_at
        match.team_home_id = home.id
        match.team_away_id = away.id
        match.group_id = group.id if is_group_round else None
        match.stage = _stage_for_fixture(fixture, group_round_prefixes)
        match.is_neutral = _is_neutral_fixture(fixture)
        match.kickoff_utc = fixture.kickoff_utc
        match.status = status
        match.score_home = fixture.score_home
        match.score_away = fixture.score_away
        match.score_home_90 = fixture.score_home_90
        match.score_away_90 = fixture.score_away_90
        # Unconditional, same as the fields above -- a fixture correction
        # (round moved by broadcaster reshuffle) must re-land on every
        # subsequent ingestion, not just the first time this row is created.
        match.matchweek = matchweek
        # API-Sports sometimes omits venue data on later refreshes. Preserve
        # the last known values instead of turning a confirmed venue into TBC.
        if fixture.venue_name is not None:
            match.venue = fixture.venue_name
        if fixture.venue_city is not None:
            match.venue_city = fixture.venue_city

    if commit:
        db.commit()
    else:
        db.flush()

    # Best-effort: only matters if this ever runs inside the web process
    # itself (a separate CLI run — the daily/cutover case — has its own cache
    # instance, so this line is a no-op there; GET /api/tournaments/active's
    # short ttl_seconds is what actually bounds staleness across that
    # boundary — see backend/app/cache.py and backend/app/api/tournaments.py).
    try:
        from app.cache import cache

        cache.invalidate("tournaments:active")
    except Exception:  # noqa: BLE001 - never let cache housekeeping fail the load
        log.warning("could not invalidate tournaments:active cache", exc_info=True)

    total_matches = db.query(Match).filter_by(tournament_id=tournament.id).count()
    return {
        "tournament_id": tournament.id,
        "teams": len(team_by_name),
        "group_id": group.id,
        "fixtures_created": created,
        "fixtures_updated": updated,
        "fixtures_skipped": skipped,
        "total_matches": total_matches,
    }
