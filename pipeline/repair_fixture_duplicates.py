"""Dry-run-first repair for duplicate fixtures from the provider cutover.

API-Football lapsed and football-data.org took over league fixtures. Promoted
clubs without an alias were created as new clubs on the first football-data
refresh, and every one of their fixtures as a second Match row. This tool
merges each football-data duplicate into its legacy row (the legacy match id
survives, so links and picks keep working) and each duplicate club into the
original club.

Pairing is by identity, never by current team ids or kickoff: one
football-data row and one legacy row in the same tournament for the same
oriented (home, away) canonical club pair. A double round-robin makes that
unique; matchweek breaks any tie and anything still ambiguous fails closed.
Canonical clubs are resolved through the alias table, so the plan is the same
whether or not an alias-aware refresh has already re-pointed the
football-data rows at the original clubs.

Rules the merge follows:

- fixture state comes from the football-data row, except that a finished
  legacy row is never un-finished by an unfinished donor (ingest's rule);
- a dependent row that would violate a unique constraint is a conflict. The
  dry run lists each one; apply refuses until an explicit ``--on-conflict``
  policy names the side to keep, and every losing row goes to the evidence;
- derived duplicates are dropped automatically and listed in full: history
  rows for the same real match (double Elo credit), odds rows for the same
  phase, probability snapshots for the same day, regenerable per-team rows,
  and predictions that would change which prediction reads as frozen (see
  ``_prediction_drops``);
- a duplicate club is deleted only after every reference to it has moved;
- anything the tool cannot prove blocks the plan, and every block names its
  way forward (``--acknowledge <kind>:<match id>``):
  * a fixture of an affected club with no twin, an ambiguous group, or a
    twin in another tournament: ``exclude`` leaves that fixture group, its
    dependents and its duplicate club untouched and lists it under
    ``left_for_manual_handling`` (the club stays, so later dry runs still
    see it);
  * matchweeks differ: ``matchweek-mismatch`` (merge anyway) or ``exclude``;
  * kickoffs over 14 days apart: ``kickoff-gap`` or ``exclude``;
  * both copies finished with different scores and one is graded:
    ``score-mismatch`` or ``exclude``;
  * a grade that cannot survive the merge (it disagrees with the merged
    result, or protecting it is impossible): ``regrade`` deletes that pair's
    grades (listed in full) so the next refresh grades the frozen prediction
    against the merged result; or ``exclude``.

The dry run never commits. Unless ``--no-trial`` is passed it also executes
the plan once inside a savepoint and rolls it back, holding the same row
locks apply would for that time. All reads happen before the first write and
the writes are set-based (one statement per table and operation), so row
locks are held for a few dozen statements. On Postgres both runs use one
REPEATABLE READ transaction with lock, statement and idle-in-transaction
timeouts; any database error refuses cleanly with nothing written.

The evidence holds enough to reverse the repair by hand: every deleted row
in full, every re-pointed row (table, id, column, old -> new), each
survivor's full pre-merge row, every history row changed in place (old and
new values) and the old learning-chain watermark.

The digest is a sha256 over: the code revision, the conflict policy, the
acknowledgements, the team and fixture mappings with each merged fixture's
final state, every conflict with both rows in full, every row to be deleted
in full, and every row to be re-pointed (id and a hash of its full content).
Apply recomputes it in its own transaction and refuses unless it equals the
``--expected-digest`` printed by the dry run, so a change to any of those
rows in between also refuses.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import (
    JSON,
    Column,
    MetaData,
    Table,
    UniqueConstraint,
    case,
    delete,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.exc import DBAPIError
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal
from app.match_status import FINISHED
from pipeline.team_mapping import normalize_team_name


class DuplicateRepairError(RuntimeError):
    """The repair cannot prove that a proposed merge is safe."""


class RepairRefused(DuplicateRepairError):
    """Apply was asked for but the plan is not cleared to run."""


FOOTBALL_DATA = "football_data"
KEEP_SURVIVOR = "keep-survivor"
KEEP_DONOR = "keep-donor"
POLICIES = (KEEP_SURVIVOR, KEEP_DONOR)

# Two rows for the same oriented club pair this close together are one real
# match (league fixtures are weeks apart). Mirrors the day-window tolerance
# in learning_loop._already_in_history.
_SAME_MATCH_WINDOW = timedelta(hours=48)

# The only merges this tool may make: duplicate club name -> original club
# name (production ids 647->406, 648->375, 649->437 on 2026-11-20). Anything
# else is out of scope.
_EXPECTED_MERGES = {
    "Real Racing Club de Santander": "Racing Santander",
    "RC Deportivo La Coruña": "Deportivo La Coruna",
    "SV 07 Elversberg": "SV Elversberg",
}

# A legacy kickoff froze on 2026-08-18. Broadcaster slotting moves a fixture
# within its weekend (<= 3 days) and European/cup congestion moves it within
# a fortnight; a larger gap is a postponement or a wrong pair, which a human
# must confirm with --acknowledge kickoff-gap:<survivor id>.
_MAX_KICKOFF_GAP = timedelta(days=14)

# Postgres only. Fail fast rather than queue behind (or hold up) live writers:
# the API's writes take milliseconds, so 5s of waiting means real contention.
# The largest statement is a 500-id delete or a bulk re-point; 60s is far
# above that on Render's small instance while still bounding a stuck run.
_LOCK_TIMEOUT = "5s"
_STATEMENT_TIMEOUT = "60s"
# The longest pause between two of the tool's own statements is in-process
# planning and hashing (well under 5s on the production-shaped rehearsal
# seed). If the runner dies mid-transaction, Postgres would otherwise keep
# its snapshot and row locks until TCP keepalive notices (hours); 30s bounds
# that while leaving ample margin over the tool's own gaps.
_IDLE_IN_TRANSACTION_TIMEOUT = "30s"

# tournament name -> the club_competition the refresh's history sync uses for
# it (pipeline/leagues.py). The post-repair history must hold each finished
# merged fixture under exactly the key that sync looks up.
def _sync_competitions() -> dict[str, str]:
    from pipeline.leagues import LEAGUES

    return {cfg["tournament_name"]: cfg["club_competition"] for cfg in LEAGUES.values()}

# Rebuilt by every refresh from matches and history; the duplicate's copies
# are dropped instead of merged.
_REGENERABLE_TEAM_TABLES = {
    "group_teams",
    "standings",
    "team_stats",
    "team_tournament_state",
    "tournament_odds",
}

# Integer references without a foreign key (the target table depends on
# `sport`). Only football rows point at matches/teams.
_SOFT_REFERENCES = (
    ("market_odds_snapshots", "match_id", "matches.id"),
    ("venue_market", "canonical_event_id", "matches.id"),
    ("market_odds_snapshots", "team_id", "teams.id"),
    ("probability_snapshots", "entity_id", "teams.id"),
)

# Lifecycle fields follow the copy whose state is kept.
_LIFECYCLE_FIELDS = (
    "kickoff_utc",
    "status",
    "score_home",
    "score_away",
    "score_home_90",
    "score_away_90",
    "minute",
    "period",
    "injury_time",
    "penalty_home",
    "penalty_away",
)
# Provider identity always moves to the survivor so the next refresh
# reconciles it by fixture id.
_IDENTITY_FIELDS = (
    "group_id",
    "stage",
    "is_neutral",
    "matchweek",
    "fixture_provider",
    "provider_fixture_id",
    "provider_last_updated",
)
# Taken from the donor only when it has a value (football-data has no
# venues, events or injuries; never erase what API-Football recorded).
_KEEP_KNOWN_FIELDS = (
    "venue",
    "venue_city",
    "venue_country",
    "goal_events",
    "card_events",
    "injuries",
)


@dataclass(frozen=True)
class TeamMerge:
    donor_team_id: int
    donor_name: str
    survivor_team_id: int
    survivor_name: str


@dataclass(frozen=True)
class MatchMerge:
    tournament_id: int
    tournament_name: str
    home: str
    away: str
    survivor_match_id: int
    donor_match_id: int
    survivor_fixture_id: int | None
    donor_fixture_id: int | None
    paired_by: str
    survivor_matchweek: int | None
    donor_matchweek: int | None
    survivor_kickoff_utc: str | None
    donor_kickoff_utc: str | None
    kickoff_delta_seconds: int | None
    survivor_status: str
    donor_status: str
    survivor_score: list | None
    donor_score: list | None
    state_source: str
    merged_kickoff_utc: str | None
    merged_status: str
    merged_score: list | None
    score_mismatch: bool


@dataclass
class RepairReport:
    dry_run: bool
    code_revision: str
    on_conflict: dict[str, str]
    digest: str
    ready_to_apply: bool
    matches_merged: int
    teams_merged: int
    survivor_match_ids: tuple[int, ...]
    removed_match_ids: tuple[int, ...]
    team_mappings: tuple[TeamMerge, ...]
    match_mappings: tuple[MatchMerge, ...]
    tournament_counts: dict[str, int]
    conflicts: list[dict]
    unresolved_conflicts: int
    blocking: list[str]
    warnings: list[str]
    moved_counts: dict[str, int]
    dropped_counts: dict[str, int]
    acknowledged: list[str]
    finished_count_delta: int
    left_for_manual_handling: list[dict]
    summary: dict
    deleted_rows: dict[str, list[dict]]
    moved_rows: dict[str, list[dict]]
    changed_rows: dict[str, list[dict]]
    survivors_before: list[dict]
    covered_finished_before: int | None
    trial: str = "not run"


# ---------------------------------------------------------------- helpers


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime | None) -> str | None:
    return None if value is None else _utc(value).isoformat()


def _jsonable(value):
    if isinstance(value, datetime):
        return _utc(value).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    return value


def _evidence(row: dict) -> dict:
    return {key: _jsonable(value) for key, value in row.items()}


def _table(name: str) -> Table:
    return Base.metadata.tables[name]


def _foreign_key_columns(target: str):
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if any(fk.target_fullname == target for fk in column.foreign_keys):
                yield table, column


def _soft_columns(target: str):
    for table_name, column_name, soft_target in _SOFT_REFERENCES:
        if soft_target == target and table_name in Base.metadata.tables:
            table = _table(table_name)
            yield table, table.c[column_name]


def _soft_filter(table: Table):
    return table.c.sport == "football"


def _unique_sets(table: Table) -> list[tuple[str, ...]]:
    sets = [
        tuple(column.name for column in constraint.columns)
        for constraint in table.constraints
        if isinstance(constraint, UniqueConstraint)
    ]
    sets.extend((column.name,) for column in table.columns if column.unique)
    return sets


def _score(row: dict) -> list | None:
    if row["score_home"] is None and row["score_away"] is None:
        return None
    return [row["score_home"], row["score_away"]]


def _score_90(row: dict) -> tuple:
    home = row["score_home_90"] if row["score_home_90"] is not None else row["score_home"]
    away = row["score_away_90"] if row["score_away_90"] is not None else row["score_away"]
    return home, away


def _rank(row: dict) -> tuple:
    """Frozen-selection order: created_at desc, id desc (learning_loop)."""
    return (_utc(row["created_at"]), row["id"])


def _chunks(values: list, size: int = 5000):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def code_revision() -> str:
    return (
        os.environ.get("REPAIR_CODE_REVISION")
        or os.environ.get("GITHUB_SHA")
        or "local"
    )


def parse_on_conflict(values: list[str] | None) -> dict[str, str]:
    """``keep-survivor`` (every table) or ``<table>=keep-donor`` (one table);
    a per-table entry overrides the global one."""
    policy: dict[str, str] = {}
    for raw in values or []:
        for item in raw.replace(",", " ").split():
            table, sep, choice = item.rpartition("=")
            table = table if sep else "*"
            if choice not in POLICIES:
                raise DuplicateRepairError(
                    f"unknown conflict policy {item!r}; use one of {POLICIES}"
                )
            if table != "*" and table not in Base.metadata.tables:
                raise DuplicateRepairError(f"unknown table in policy {item!r}")
            if policy.get(table, choice) != choice:
                raise DuplicateRepairError(f"contradictory policy for {table}")
            policy[table] = choice
    return dict(sorted(policy.items()))





ACK_KINDS = ("kickoff-gap", "matchweek-mismatch", "score-mismatch", "regrade", "exclude")


def parse_acknowledgements(values: list[str] | None) -> list[str]:
    """``<kind>:<match id>`` items, space or comma separated. The match id is
    the one the blocking message names (the survivor of a pair, or any
    fixture of a group for ``exclude``)."""
    acks: set[str] = set()
    for raw in values or []:
        for item in raw.replace(",", " ").split():
            kind, sep, match_id = item.partition(":")
            if not sep or kind not in ACK_KINDS or not match_id.isdigit():
                raise DuplicateRepairError(
                    f"unknown acknowledgement {item!r}; use <kind>:<match id> "
                    f"with kind in {ACK_KINDS}"
                )
            acks.add(f"{kind}:{int(match_id)}")
    return sorted(acks)


# ------------------------------------------------------------- the plan


@dataclass
class _Pair:
    survivor: dict
    donor: dict
    paired_by: str
    state_source: str
    merged: dict
    tournament_name: str = ""


@dataclass
class _Plan:
    db: Session
    team_map: dict[int, int]
    team_details: list[TeamMerge]
    policy: dict[str, str]
    acknowledged: list[str]
    pairs: list[_Pair] = field(default_factory=list)
    conflicts: list[dict] = field(default_factory=list)
    # table -> row id -> {"reason": str, "row": dict}
    deletions: dict[str, dict[int, dict]] = field(default_factory=dict)
    # "table.column" -> row id -> {"old", "new", "hash"} for re-pointed rows
    moves: dict[str, dict[int, dict]] = field(default_factory=dict)
    # history rows corrected in place: id -> {"old": {...}, "new": {...}}
    history_fixes: dict[int, dict] = field(default_factory=dict)
    blocking: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    excluded: list[dict] = field(default_factory=list)
    excluded_match_ids: set[int] = field(default_factory=set)
    # duplicate clubs left in place because an excluded group involves them
    kept_clubs: set[int] = field(default_factory=set)
    # survivor match id -> read paths that agreed with the kept grade before
    read_paths: dict[int, dict[str, int]] = field(default_factory=dict)
    # survivor match id -> kept grades
    kept_grades: dict[int, list[dict]] = field(default_factory=dict)
    grades: list[dict] = field(default_factory=list)
    finished_count_delta: int = 0
    covered_finished_before: int | None = None
    facts: dict = field(default_factory=dict)
    _cache: dict = field(default_factory=dict)

    def drop(self, table: str, row: dict, reason: str) -> None:
        self.deletions.setdefault(table, {}).setdefault(
            row["id"], {"reason": reason, "row": _evidence(row)}
        )

    def dropped(self, table: str, row_id: int) -> bool:
        return row_id in self.deletions.get(table, {})

    def move(self, key: str, rows: list[dict], old: int, new: int) -> None:
        moved = self.moves.setdefault(key, {})
        for row in rows:
            moved[row["id"]] = {"old": old, "new": new, "hash": _content_hash(row)}

    def acked(self, kind: str, match_id: int) -> bool:
        return f"{kind}:{match_id}" in self.acknowledged

    def unresolved(self) -> list[dict]:
        return [c for c in self.conflicts if c["resolution"] is None]

    # Planning reads go through a per-(table, column) cache loaded in one
    # statement per table, instead of one query per pair and table.
    def preload(self, table: Table, column, values, *, soft: bool = False) -> None:
        key = (table.name, column.name, soft)
        bucket = self._cache.setdefault(key, {})
        wanted = sorted({v for v in values if v is not None} - set(bucket))
        for chunk in _chunks(wanted):
            query = select(table).where(column.in_(chunk)).order_by(table.c.id)
            if soft:
                query = query.where(_soft_filter(table))
            for value in chunk:
                bucket.setdefault(value, [])
            for row in self.db.execute(query):
                mapping = dict(row._mapping)
                bucket[mapping[column.name]].append(mapping)

    def rows(self, table: Table, column, value, *, soft: bool = False) -> list[dict]:
        bucket = self._cache.get((table.name, column.name, soft), {})
        if value not in bucket:
            self.preload(table, column, [value], soft=soft)
            bucket = self._cache[(table.name, column.name, soft)]
        return bucket[value]


def _content_hash(row: dict) -> str:
    return hashlib.sha256(
        json.dumps(_evidence(row), sort_keys=True, default=str).encode()
    ).hexdigest()


def _team_merges(db: Session) -> tuple[dict[int, int], list[str]]:
    """Merges limited to _EXPECTED_MERGES by name, with the alias table
    required to agree; anything else is a blocking problem (a code fix, not a
    data decision)."""
    teams = db.execute(select(_table("teams").c.id, _table("teams").c.name)
                       .order_by(_table("teams").c.id)).all()
    by_name: dict[str, list[int]] = {}
    for team_id, name in teams:
        by_name.setdefault(name, []).append(team_id)
    merges: dict[int, int] = {}
    problems: list[str] = []
    for donor_name, survivor_name in sorted(_EXPECTED_MERGES.items()):
        donors = by_name.get(donor_name, [])
        if not donors:
            continue
        survivors = by_name.get(survivor_name, [])
        if len(donors) > 1 or len(survivors) != 1:
            problems.append(
                f"club {donor_name!r} {donors} -> {survivor_name!r} {survivors} "
                "is not exactly one club to one club (code fix needed)"
            )
            continue
        if normalize_team_name(donor_name) != survivor_name:
            problems.append(
                f"alias table maps {donor_name!r} to "
                f"{normalize_team_name(donor_name)!r}, expected {survivor_name!r} "
                "(code fix needed)"
            )
            continue
        merges[donors[0]] = survivors[0]
    return merges, problems


def _describe(rows: list[dict]) -> str:
    return ", ".join(
        f"id={row['id']} tournament={row['tournament_id']} "
        f"provider={row['fixture_provider']} "
        f"fixture={row['provider_fixture_id']} kickoff={_iso(row['kickoff_utc'])} "
        f"matchweek={row['matchweek']} status={row['status']}"
        for row in rows
    )


def _pair_group(rows: list[dict]) -> tuple[list[tuple[dict, dict, str]], list[dict]]:
    """Pairs and the legacy rows left without a football-data twin."""
    donors = [row for row in rows if row["fixture_provider"] == FOOTBALL_DATA]
    survivors = [row for row in rows if row["fixture_provider"] != FOOTBALL_DATA]
    if len(donors) == 1 and len(survivors) == 1:
        return [(survivors[0], donors[0], "identity")], []
    by_week: dict[int, tuple[list, list]] = {}
    for row in rows:
        if row["matchweek"] is None:
            raise DuplicateRepairError("no matchweek to break the tie")
        bucket = by_week.setdefault(row["matchweek"], ([], []))
        bucket[0 if row["fixture_provider"] != FOOTBALL_DATA else 1].append(row)
    pairs, leftover = [], []
    for week, (week_survivors, week_donors) in sorted(by_week.items()):
        if not week_donors:
            leftover.extend(week_survivors)
            continue
        if len(week_survivors) != 1 or len(week_donors) != 1:
            raise DuplicateRepairError(f"matchweek {week} does not pair one-to-one")
        pairs.append((week_survivors[0], week_donors[0], "identity+matchweek"))
    return pairs, leftover


def _merged_state(survivor: dict, donor: dict, team_map: dict[int, int]):
    keep_survivor_state = (
        survivor["status"] == FINISHED and donor["status"] != FINISHED
    )
    state_source = "survivor" if keep_survivor_state else "donor"
    state = survivor if keep_survivor_state else donor
    merged = {name: state[name] for name in _LIFECYCLE_FIELDS}
    merged.update({name: donor[name] for name in _IDENTITY_FIELDS})
    for name in _KEEP_KNOWN_FIELDS:
        merged[name] = donor[name] if donor[name] is not None else survivor[name]
    merged["team_home_id"] = team_map.get(donor["team_home_id"], donor["team_home_id"])
    merged["team_away_id"] = team_map.get(donor["team_away_id"], donor["team_away_id"])
    return state_source, merged


def _exclude_hint(ids) -> str:
    return ("investigate; to leave a fixture untouched, --acknowledge "
            + " ".join(f"exclude:{i}" for i in sorted(ids)))


def _match_pairs(plan: _Plan, db: Session, tournament_names: dict[int, str]) -> None:
    """Pair every football-data/legacy fixture of an affected club pairing.

    Groups are keyed on tournament + oriented canonical clubs, independent of
    current team ids. Blocked (review H1/M1), whatever the current team ids:
    a fixture still on a duplicate club with no twin; a football-data row with
    no twin in its tournament but a legacy row for the same clubs in another;
    a legacy row with no twin in a tournament the cutover touched; an
    ambiguous group. ``exclude:<id>`` takes exactly that fixture out of
    pairing and leaves it (and its dependents) untouched; the duplicate club
    of any merge it involves is kept, so later dry runs still see it.
    """
    team_map = plan.team_map
    if not team_map:
        return
    involved = set(team_map) | set(team_map.values())
    matches = _table("matches")
    rows = [
        dict(row._mapping)
        for row in db.execute(
            select(matches)
            .where(
                matches.c.team_home_id.isnot(None),
                matches.c.team_away_id.isnot(None),
                matches.c.team_home_id.in_(involved)
                | matches.c.team_away_id.in_(involved),
            )
            .order_by(matches.c.id)
        )
    ]
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        key = (
            row["tournament_id"],
            team_map.get(row["team_home_id"], row["team_home_id"]),
            team_map.get(row["team_away_id"], row["team_away_id"]),
        )
        groups.setdefault(key, []).append(row)
    excluded_ids = {
        int(ack.split(":")[1]) for ack in plan.acknowledged if ack.startswith("exclude:")
    }
    matched_excludes: set[int] = set()
    # Tournaments the cutover touched: a football-data row of an affected club.
    affected = {key[0] for key, group in groups.items()
                if any(r["fixture_provider"] == FOOTBALL_DATA for r in group)}
    legacy_by_clubs: dict[tuple, list[dict]] = {}
    for key, group in groups.items():
        for row in group:
            if row["fixture_provider"] != FOOTBALL_DATA:
                legacy_by_clubs.setdefault(key[1:], []).append(row)

    for key in sorted(groups):
        where = f"tournament {key[0]} clubs {key[1]} v {key[2]}"
        left_out = [row for row in groups[key] if row["id"] in excluded_ids]
        group = [row for row in groups[key] if row["id"] not in excluded_ids]
        if left_out:
            out_ids = [row["id"] for row in left_out]
            matched_excludes.update(out_ids)
            plan.excluded.append({
                "tournament_id": key[0], "home_team_id": key[1], "away_team_id": key[2],
                "match_ids": out_ids, "rows": [_evidence(row) for row in left_out],
            })
            plan.excluded_match_ids.update(out_ids)
            for donor_id, survivor_id in team_map.items():
                if survivor_id in key[1:] or donor_id in key[1:]:
                    plan.kept_clubs.add(donor_id)
        if not group:
            continue
        ids = [row["id"] for row in group]
        donors = [r for r in group if r["fixture_provider"] == FOOTBALL_DATA]
        legacy = [r for r in group if r["fixture_provider"] != FOOTBALL_DATA]
        if donors and legacy:
            try:
                found, leftover = _pair_group(group)
            except DuplicateRepairError as exc:
                plan.blocking.append(
                    f"ambiguous fixture group ({exc}) for {where}: "
                    f"{_describe(group)}; {_exclude_hint(ids)}"
                )
                continue
            if leftover:
                plan.blocking.append(
                    f"legacy fixture(s) with no football-data twin for {where}: "
                    f"{_describe(leftover)}; {_exclude_hint(ids)}"
                )
                continue
            for survivor, donor, paired_by in found:
                state_source, merged = _merged_state(survivor, donor, team_map)
                plan.pairs.append(_Pair(survivor, donor, paired_by, state_source, merged,
                                        tournament_names.get(key[0], "")))
            continue
        if donors:
            on_duplicate = [r for r in donors
                            if r["team_home_id"] in team_map or r["team_away_id"] in team_map]
            elsewhere = [r for r in legacy_by_clubs.get(key[1:], [])
                         if r["tournament_id"] != key[0]]
            if on_duplicate or elsewhere:
                plan.blocking.append(
                    f"football-data fixture(s) with no twin in their tournament for "
                    f"{where}: {_describe(donors)}"
                    + (f"; a legacy row for the same clubs is in another tournament: "
                       f"{_describe(elsewhere)}" if elsewhere else "")
                    + f"; {_exclude_hint(ids)}"
                )
            # Otherwise a football-data row on the original clubs with no
            # legacy row anywhere: already merged, or a genuinely new fixture.
            continue
        if key[0] in affected:
            plan.blocking.append(
                f"legacy fixture(s) with no football-data twin for {where}: "
                f"{_describe(legacy)}; {_exclude_hint(ids)}"
            )
    for match_id in sorted(excluded_ids - matched_excludes):
        plan.warnings.append(f"exclude:{match_id} matched no fixture of an affected club")


def _pair_checks(plan: _Plan, pair: _Pair) -> None:
    """Things identity pairing alone cannot prove (review H2/H3/M5)."""
    survivor, donor = pair.survivor, pair.donor
    sid = survivor["id"]
    ref = f"pair {sid}<-{donor['id']}"
    if (
        survivor["matchweek"] is not None
        and donor["matchweek"] is not None
        and survivor["matchweek"] != donor["matchweek"]
        and not plan.acked("matchweek-mismatch", sid)
    ):
        plan.blocking.append(
            f"{ref}: matchweek {survivor['matchweek']} vs {donor['matchweek']}; if it "
            f"is the same match, --acknowledge matchweek-mismatch:{sid}, otherwise "
            f"--acknowledge exclude:{sid} exclude:{donor['id']}"
        )
    if survivor["kickoff_utc"] is not None and donor["kickoff_utc"] is not None:
        gap = abs(_utc(donor["kickoff_utc"]) - _utc(survivor["kickoff_utc"]))
        if gap > _MAX_KICKOFF_GAP and not plan.acked("kickoff-gap", sid):
            plan.blocking.append(
                f"{ref}: kickoffs {gap.days} days apart (limit "
                f"{_MAX_KICKOFF_GAP.days}); if it is the same match, --acknowledge "
                f"kickoff-gap:{sid}, otherwise --acknowledge "
                f"exclude:{sid} exclude:{donor['id']}"
            )
    both_finished = survivor["status"] == FINISHED and donor["status"] == FINISHED
    if both_finished and _score_90(survivor) != _score_90(donor):
        graded = bool(_pair_grades(plan, pair))
        if graded and not plan.acked("score-mismatch", sid):
            plan.blocking.append(
                f"{ref}: both copies finished with different scores "
                f"{_score(survivor)} vs {_score(donor)} and one is graded; check the "
                f"real result, then --acknowledge score-mismatch:{sid} (the "
                f"football-data result is kept) or exclude:{sid} exclude:{donor['id']}"
            )


def _outcome(home, away) -> str | None:
    if home is None or away is None:
        return None
    return "home" if home > away else "away" if away > home else "draw"


def _pair_grades(plan: _Plan, pair: _Pair) -> list[dict]:
    ids = (pair.survivor["id"], pair.donor["id"])
    return [g for g in plan.grades
            if g["match_id"] in ids and not plan.dropped("prediction_results", g["id"])]


def _regrade(plan: _Plan, pair: _Pair) -> None:
    """``regrade:<id>``: drop every grade on both copies (listed in full) so
    the next refresh grades the frozen prediction against the merged result."""
    if not plan.acked("regrade", pair.survivor["id"]):
        return
    for grade in _pair_grades(plan, pair):
        plan.drop("prediction_results", grade, "regrade_requested")
    for conflict in plan.conflicts:
        if (
            conflict["table"] == "prediction_results"
            and conflict["resolution"] is None
            and conflict["survivor_id"] == pair.survivor["id"]
        ):
            conflict["resolution"] = "regrade"


def _grade_checks(plan: _Plan, pair: _Pair) -> None:
    """Every grade that survives must describe the merged match's result."""
    merged = pair.merged
    expected = (merged["score_home"], merged["score_away"])
    grades = []
    sid = pair.survivor["id"]
    for row in _pair_grades(plan, pair):
        actual = (row["actual_score_home"], row["actual_score_away"])
        grades.append({"id": row["id"], "is_shadow": bool(row["is_shadow"]),
                       "home": actual[0], "away": actual[1], "outcome": row["outcome"]})
        if merged["status"] != FINISHED or actual != expected or (
            row["outcome"] != _outcome(*expected)
        ):
            plan.blocking.append(
                f"pair {sid}<-{pair.donor['id']}: kept grade {row['id']} records "
                f"{actual[0]}-{actual[1]} ({row['outcome']}) but the merged match is "
                f"{merged['status']} {expected[0]}-{expected[1]}; keep the grade on the "
                f"copy whose match state is kept, or --acknowledge regrade:{sid}, or "
                f"exclude:{sid} exclude:{pair.donor['id']}"
            )
    plan.kept_grades[sid] = grades


def _resolve(plan: _Plan, conflict: dict) -> None:
    choice = plan.policy.get(conflict["table"]) or plan.policy.get("*")
    conflict["resolution"] = choice
    if choice is None:
        return
    loser_side = "donor" if choice == KEEP_SURVIVOR else "survivor"
    loser = conflict[f"{loser_side}_row"]
    conflict["deleted_row_id"] = loser["id"]
    plan.drop(conflict["table"], loser, f"conflict_loser:{choice}")
    for child, child_column in _foreign_key_columns(f"{conflict['table']}.id"):
        for row in plan.rows(child, child_column, loser["id"]):
            plan.drop(child.name, row, f"child_of_conflict_loser:{conflict['table']}")


def _plan_reference_moves(
    plan: _Plan,
    target: str,
    donor_id: int,
    survivor_id: int,
    *,
    scope: str,
    skip_tables: set[str],
    skip_ids: dict[str, set[int]] | None = None,
) -> None:
    """Enumerate rows that will be re-pointed donor -> survivor, and every
    unique-constraint conflict that re-pointing would raise."""
    skip_ids = skip_ids or {}
    for table, column in _foreign_key_columns(target):
        if table.name in skip_tables:
            continue
        donor_rows = [
            row for row in plan.rows(table, column, donor_id)
            if not plan.dropped(table.name, row["id"])
            and row["id"] not in skip_ids.get(table.name, set())
        ]
        if not donor_rows:
            continue
        for unique in _unique_sets(table):
            if column.name not in unique:
                continue
            survivor_rows = plan.rows(table, column, survivor_id)
            others = [name for name in unique if name != column.name]
            survivor_by_key: dict[tuple, dict] = {}
            for row in survivor_rows:
                key = tuple(row[name] for name in others)
                if all(value is not None for value in key):
                    survivor_by_key.setdefault(key, row)
            for row in donor_rows:
                key = tuple(row[name] for name in others)
                if any(value is None for value in key) or key not in survivor_by_key:
                    continue
                conflict = {
                    "scope": scope,
                    "table": table.name,
                    "constraint": list(unique),
                    "key": _evidence(dict(zip(others, key))),
                    "survivor_id": survivor_id,
                    "donor_id": donor_id,
                    "survivor_row": _evidence(survivor_by_key[key]),
                    "donor_row": _evidence(row),
                    "resolution": None,
                    "deleted_row_id": None,
                }
                plan.conflicts.append(conflict)
                _resolve(plan, conflict)
        plan.move(f"{table.name}.{column.name}", donor_rows, donor_id, survivor_id)
    for table, column in _soft_columns(target):
        if table.name in skip_tables:
            continue
        rows = plan.rows(table, column, donor_id, soft=True)
        if rows:
            plan.move(f"{table.name}.{column.name}", rows, donor_id, survivor_id)


def _odds_drops(plan: _Plan, pair: _Pair) -> None:
    """One phased odds row per (match, phase): keep the copy whose fixture
    state is kept, drop the stale copy's twin."""
    odds = _table("odds")
    stale = pair.survivor if pair.state_source == "donor" else pair.donor
    kept = pair.donor if pair.state_source == "donor" else pair.survivor
    kept_phases = {
        row["snapshot_phase"]
        for row in plan.rows(odds, odds.c.match_id, kept["id"])
        if row["snapshot_phase"] is not None
    }
    for row in plan.rows(odds, odds.c.match_id, stale["id"]):
        if row["snapshot_phase"] in kept_phases:
            plan.drop("odds", row, "odds_phase_duplicate")


def _prediction_drops(plan: _Plan, pair: _Pair) -> None:
    """Make the merged row's frozen prediction the graded one.

    The two copies were predicted independently, and a legacy row left
    "scheduled" kept receiving daily predictions long after the real match
    was played. On the merged row (kickoff K):

    1. Any prediction created after K, from either copy, is dropped: the
       merged match must not carry a post-kickoff prediction (review L1);
       the read paths already hide such rows, this keeps the data clean.
    2. For each kept grade G, a prediction from the other copy in G's frozen
       basis (production: is_shadow=False; shadow: same is_shadow and
       model_version) created at or before K that sorts after G's prediction
       in the frozen order (created_at desc, id desc) is dropped, so
       _frozen_prediction resolves to G's prediction.

    A prediction a surviving grade points at is never dropped or edited; if
    one would have to be, the pair is blocking (way forward: regrade or
    exclude). No prediction is created.
    """
    predictions = _table("predictions")
    kickoff = pair.merged["kickoff_utc"]
    survivor_preds = plan.rows(predictions, predictions.c.match_id, pair.survivor["id"])
    donor_preds = plan.rows(predictions, predictions.c.match_id, pair.donor["id"])
    copy_of = {row["id"]: "survivor" for row in survivor_preds}
    copy_of.update({row["id"]: "donor" for row in donor_preds})
    by_id = {row["id"]: row for row in survivor_preds + donor_preds}
    sid = pair.survivor["id"]
    match_ref = f"pair {sid}<-{pair.donor['id']}"
    kept = _pair_grades(plan, pair)
    graded = {g["prediction_id"] for g in kept}
    hint = f"--acknowledge regrade:{sid} or exclude:{sid} exclude:{pair.donor['id']}"

    def drop(row: dict, reason: str) -> None:
        if row["id"] in graded:
            plan.blocking.append(
                f"{match_ref}: graded prediction {row['id']} would have to be "
                f"dropped ({reason}); {hint}"
            )
            return
        plan.drop("predictions", row, reason)

    if kickoff is None:
        return
    kickoff = _utc(kickoff)
    for row in by_id.values():
        if _utc(row["created_at"]) > kickoff:
            drop(row, "prediction_after_merged_kickoff")

    for is_shadow in (False, True):
        grades = [g for g in kept if bool(g["is_shadow"]) is is_shadow]
        if not grades:
            continue
        if len(grades) > 1:
            # An unresolved prediction_results conflict: the kept grade is the
            # owner's decision, so alignment waits for the policy.
            continue
        grade = grades[0]
        graded_pred = by_id.get(grade["prediction_id"])
        if graded_pred is None:
            plan.blocking.append(
                f"{match_ref}: grade {grade['id']} points at prediction "
                f"{grade['prediction_id']} outside this pair; {hint}"
            )
            continue
        if _utc(graded_pred["created_at"]) > kickoff:
            continue  # already blocked by rule 1
        other = "donor" if copy_of[graded_pred["id"]] == "survivor" else "survivor"
        for row in by_id.values():
            if copy_of[row["id"]] != other or bool(row["is_shadow"]) is not is_shadow:
                continue
            if is_shadow and row["model_version"] != graded_pred["model_version"]:
                continue
            if _utc(row["created_at"]) > kickoff:
                continue
            if _rank(row) > _rank(graded_pred):
                drop(row, "outranks_graded_prediction")


def _read_paths_bulk(db: Session, match_ids: list[int],
                     dropped: set[int] = frozenset()) -> dict[int, dict]:
    """What _frozen_prediction (production and shadow) and
    serializers.latest_prediction select for each match, in two statements
    instead of three queries per match. ``read_paths_agree_test`` pins this to
    the real functions."""
    from pipeline.generate_predictions import shadow_model_version_for

    if not match_ids:
        return {}
    matches = _table("matches")
    predictions = _table("predictions")
    kickoffs = {}
    for chunk in _chunks(sorted(match_ids)):
        kickoffs.update(db.execute(
            select(matches.c.id, matches.c.kickoff_utc).where(matches.c.id.in_(chunk))
        ).all())
    by_match: dict[int, list] = {m: [] for m in match_ids}
    for chunk in _chunks(sorted(match_ids)):
        for row in db.execute(select(
            predictions.c.id, predictions.c.match_id, predictions.c.is_shadow,
            predictions.c.model_version, predictions.c.created_at,
        ).where(predictions.c.match_id.in_(chunk))):
            if row.id not in dropped:
                by_match[row.match_id].append(row)

    def best(rows):
        return max(rows, key=lambda r: (_utc(r.created_at), r.id), default=None)

    out = {}
    for match_id, rows in by_match.items():
        kickoff = kickoffs.get(match_id)
        before = [r for r in rows if kickoff is None or _utc(r.created_at) <= _utc(kickoff)]
        frozen = best([r for r in before if not r.is_shadow])
        # latest_prediction applies the same written-by-kickoff rule
        # (serializers.created_by_kickoff), so it selects what frozen does.
        latest = best([r for r in before if not r.is_shadow])
        shadow = None
        if frozen is not None:
            version = shadow_model_version_for(frozen.model_version)
            shadow = best([r for r in before if r.is_shadow and r.model_version == version])
        out[match_id] = {
            "frozen": frozen.id if frozen else None,
            "latest": latest.id if latest else None,
            "frozen_shadow": shadow.id if shadow else None,
        }
    return out


def _expected_read_paths(plan: _Plan, before: dict[int, dict]) -> None:
    """Read paths that pointed at the kept grade on its own copy before the
    merge must still point at it afterwards; one that disagreed before is
    pre-existing and only warned about."""
    predictions = _table("predictions")
    for pair in plan.pairs:
        expected: dict[str, int] = {}
        for grade in _pair_grades(plan, pair):
            prediction_id = grade["prediction_id"]
            owner = next(
                (match_id for match_id in (pair.survivor["id"], pair.donor["id"])
                 if any(r["id"] == prediction_id
                        for r in plan.rows(predictions, predictions.c.match_id, match_id))),
                None,
            )
            if owner is None:
                continue
            names = ("frozen_shadow",) if grade["is_shadow"] else ("frozen", "latest")
            for name in names:
                if before[owner][name] == prediction_id:
                    expected[name] = prediction_id
                else:
                    plan.warnings.append(
                        f"pair {pair.survivor['id']}<-{pair.donor['id']}: {name} read "
                        f"path already disagreed with graded prediction "
                        f"{prediction_id} before the repair (selected {before[owner][name]})"
                    )
        plan.read_paths[pair.survivor["id"]] = expected


def _history_plan(plan: _Plan, db: Session) -> None:
    """Keep exactly one historical_matches row per real match, and make it
    the row the refresh's sync will look up (review M3).

    sync_finished_matches_to_history skips a finished fixture when a row of
    its competition exists with the same (kickoff date, home, away). So for
    each finished merged fixture, the rows of the same oriented clubs within
    48h of either copy's kickoff are one real match: keep the row already on
    that key (else the one with the merged score, else the one on the
    original club, else the oldest), drop the rest, and correct the kept row
    in place (date, competition, clubs, score) when it is not on the key.
    Remaining clusters that touch a duplicate club keep one row each.
    """
    if not plan.team_map:
        return
    history = _table("historical_matches")
    involved = set(plan.team_map) | set(plan.team_map.values())
    rows = [
        dict(row._mapping)
        for row in db.execute(
            select(history)
            .where(history.c.team_a_id.in_(involved) | history.c.team_b_id.in_(involved))
            .order_by(history.c.id)
        )
    ]

    def mapped(row):
        return (plan.team_map.get(row["team_a_id"], row["team_a_id"]),
                plan.team_map.get(row["team_b_id"], row["team_b_id"]))

    def on_donor(row):
        return row["team_a_id"] in plan.team_map or row["team_b_id"] in plan.team_map

    competitions = _sync_competitions()
    claimed: set[int] = set()
    for pair in plan.pairs:
        merged = pair.merged
        if merged["status"] != FINISHED or merged["kickoff_utc"] is None:
            continue
        kickoff = _utc(merged["kickoff_utc"])
        clubs = (merged["team_home_id"], merged["team_away_id"])
        anchors = [kickoff] + [_utc(c["kickoff_utc"]) for c in (pair.survivor, pair.donor)
                               if c["kickoff_utc"] is not None]
        candidates = [
            row for row in rows
            if row["id"] not in claimed and mapped(row) == clubs
            and min(abs(_utc(row["date"]) - a) for a in anchors) < _SAME_MATCH_WINDOW
        ]
        if not candidates:
            continue
        claimed.update(row["id"] for row in candidates)
        competition = competitions.get(pair.tournament_name)
        final = tuple(_score_90(merged))

        def on_key(row):
            return (
                (competition is None or row["competition"] == competition)
                and _utc(row["date"]).date() == kickoff.date()
                and (row["team_a_id"], row["team_b_id"]) == clubs
            )

        keep = min(candidates, key=lambda row: (
            not on_key(row), (row["score_a"], row["score_b"]) != final, on_donor(row),
            row["id"]))
        for row in candidates:
            if row is not keep:
                plan.drop("historical_matches", row, f"history_duplicate_of:{keep['id']}")
        new = {
            "date": keep["date"] if _utc(keep["date"]).date() == kickoff.date()
            else merged["kickoff_utc"],
            "competition": competition if competition is not None else keep["competition"],
            "team_a_id": clubs[0],
            "team_b_id": clubs[1],
            "score_a": final[0],
            "score_b": final[1],
        }
        old = {name: keep[name] for name in new}
        if old != new:
            plan.history_fixes[keep["id"]] = {"old": old, "new": new}

    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        if row["id"] not in claimed:
            groups.setdefault(mapped(row), []).append(row)
    for key, group in sorted(groups.items()):
        group.sort(key=lambda row: (_utc(row["date"]), row["id"]))
        clusters: list[list[dict]] = []
        for row in group:
            if clusters and _utc(row["date"]) - _utc(clusters[-1][-1]["date"]) < _SAME_MATCH_WINDOW:
                clusters[-1].append(row)
            else:
                clusters.append([row])
        for cluster in clusters:
            if len(cluster) < 2 or not any(on_donor(row) for row in cluster):
                continue
            keep = min(cluster, key=lambda row: (on_donor(row), row["id"]))
            for row in cluster:
                if row is not keep:
                    plan.drop("historical_matches", row, f"history_duplicate_of:{keep['id']}")


def _team_drops(plan: _Plan, db: Session, donor_id: int, survivor_id: int) -> None:
    for table_name in sorted(_REGENERABLE_TEAM_TABLES):
        table = _table(table_name)
        for row in plan.rows(table, table.c.team_id, donor_id):
            if table_name == "group_teams":
                canonical = db.execute(
                    select(table.c.id).where(
                        table.c.group_id == row["group_id"],
                        table.c.team_id == survivor_id,
                    ).limit(1)
                ).scalar_one_or_none()
                if canonical is None:
                    continue  # moved to the original club instead
            plan.drop(table_name, row, "regenerable_team_row")

    snapshots = _table("probability_snapshots")
    survivor_keys = {
        (row["market"], row["ref_id"], row["snapshot_date"])
        for row in plan.rows(snapshots, snapshots.c.entity_id, survivor_id, soft=True)
    }
    for row in plan.rows(snapshots, snapshots.c.entity_id, donor_id, soft=True):
        if (row["market"], row["ref_id"], row["snapshot_date"]) in survivor_keys:
            plan.drop("probability_snapshots", row, "probability_snapshot_duplicate")


def _finished_eligible(row: dict) -> bool:
    """Mirrors app.chain_status.finished_matches_query."""
    return (
        row["status"] == FINISHED
        and row["score_home"] is not None
        and row["score_away"] is not None
        and row["team_home_id"] is not None
        and row["team_away_id"] is not None
    )


def _facts(plan: _Plan, db: Session) -> None:
    """User-visible consequences, for the summary (review M3)."""
    results = _table("prediction_results")
    picks = _table("match_picks")
    scored = _table("league_score_predictions")
    predictions = _table("predictions")
    deleted_grades = [
        entry["row"] for entry in plan.deletions.get("prediction_results", {}).values()
    ]
    public_deleted = [g for g in deleted_grades if not g["is_shadow"]]
    public_rows = db.execute(
        select(results.c.winner_correct, results.c.exact_score_correct)
        .where(results.c.is_shadow.is_(False))
    ).all()
    gradeable, scoreable = [], {"match_picks": 0, "league_score_predictions": 0}
    for pair in plan.pairs:
        merged = pair.merged
        if merged["status"] != FINISHED:
            continue
        if not any(not g["is_shadow"] for g in plan.kept_grades.get(pair.survivor["id"], [])):
            kickoff = merged["kickoff_utc"]
            candidates = [
                row
                for match_id in (pair.survivor["id"], pair.donor["id"])
                for row in plan.rows(predictions, predictions.c.match_id, match_id)
                if not row["is_shadow"]
                and not plan.dropped("predictions", row["id"])
                and (kickoff is None or _utc(row["created_at"]) <= _utc(kickoff))
            ]
            if candidates:
                gradeable.append(pair.survivor["id"])
        for copy in (pair.survivor, pair.donor):
            if copy["status"] == FINISHED:
                continue
            for name, table in (("match_picks", picks), ("league_score_predictions", scored)):
                scoreable[name] += sum(
                    1 for row in plan.rows(table, table.c.match_id, copy["id"])
                    if not plan.dropped(name, row["id"])
                )
    deleted_lsp = [e["row"] for e in plan.deletions.get("league_score_predictions", {}).values()]
    plan.facts = {
        "public_grades_before": len(public_rows),
        "public_grades_after": len(public_rows) - len(public_deleted),
        "public_winner_correct_before": sum(1 for w, _ in public_rows if w),
        "public_winner_correct_after": sum(1 for w, _ in public_rows if w)
        - sum(1 for g in public_deleted if g["winner_correct"]),
        "public_exact_correct_before": sum(1 for _, e in public_rows if e),
        "public_exact_correct_after": sum(1 for _, e in public_rows if e)
        - sum(1 for g in public_deleted if g["exact_score_correct"]),
        "public_grades_removed": len(public_deleted),
        "shadow_grades_removed": len(deleted_grades) - len(public_deleted),
        "become_gradeable_next_refresh": sorted(gradeable),
        "picks_deleted": len(plan.deletions.get("match_picks", {})),
        "league_score_predictions_deleted": len(deleted_lsp),
        "league_score_predictions_deleted_already_scored": sum(
            1 for row in deleted_lsp if row["points"] is not None
        ),
        "picks_become_scoreable": scoreable["match_picks"],
        "league_score_predictions_become_scoreable": scoreable["league_score_predictions"],
    }


def _build_plan(db: Session, policy: dict[str, str], acknowledged: list[str]) -> _Plan:
    """Every read the repair needs, before any write."""
    team_map, problems = _team_merges(db)
    teams = _table("teams")
    tournaments = _table("tournaments")
    details = []
    for donor_id, survivor_id in sorted(team_map.items()):
        names = dict(db.execute(
            select(teams.c.id, teams.c.name).where(teams.c.id.in_([donor_id, survivor_id]))
        ).all())
        details.append(TeamMerge(donor_id, names[donor_id], survivor_id, names[survivor_id]))
    plan = _Plan(db, team_map, details, policy, acknowledged, blocking=list(problems))
    status = _table("learning_chain_status")
    plan.covered_finished_before = db.execute(
        select(status.c.covered_finished).where(status.c.id == 1)).scalar_one_or_none()
    tournament_names = dict(db.execute(select(tournaments.c.id, tournaments.c.name)).all())
    _match_pairs(plan, db, tournament_names)

    match_ids = [p.survivor["id"] for p in plan.pairs] + [p.donor["id"] for p in plan.pairs]
    for table, column in _foreign_key_columns("matches.id"):
        plan.preload(table, column, match_ids)
    for table, column in _soft_columns("matches.id"):
        plan.preload(table, column, match_ids, soft=True)
    team_ids = list(team_map) + list(team_map.values())
    for table, column in _foreign_key_columns("teams.id"):
        if table.name not in {"matches", "historical_matches"}:
            plan.preload(table, column, team_ids)
    for table, column in _soft_columns("teams.id"):
        plan.preload(table, column, team_ids, soft=True)
    results = _table("prediction_results")
    plan.grades = [
        row for match_id in match_ids
        for row in plan.rows(results, results.c.match_id, match_id)
    ]
    for pair in plan.pairs:
        _plan_reference_moves(
            plan, "matches.id", pair.donor["id"], pair.survivor["id"],
            scope="match", skip_tables=set(),
        )
        _regrade(plan, pair)
        _pair_checks(plan, pair)
        _odds_drops(plan, pair)
        _prediction_drops(plan, pair)
        _grade_checks(plan, pair)
        plan.drop("matches", pair.donor, f"merged_into:{pair.survivor['id']}")
        plan.finished_count_delta += (
            _finished_eligible(pair.merged)
            - _finished_eligible(pair.survivor)
            - _finished_eligible(pair.donor)
        )
    _history_plan(plan, db)
    history = _table("historical_matches")
    matches = _table("matches")
    for donor_id, survivor_id in sorted(team_map.items()):
        if donor_id in plan.kept_clubs:
            plan.warnings.append(
                f"club {donor_id} is kept (an excluded fixture group involves it); "
                "its other references stay on it"
            )
            continue
        _team_drops(plan, db, donor_id, survivor_id)
        plan.preload(matches, matches.c.team_home_id, [donor_id])
        plan.preload(matches, matches.c.team_away_id, [donor_id])
        plan.preload(history, history.c.team_a_id, [donor_id])
        plan.preload(history, history.c.team_b_id, [donor_id])
        _plan_reference_moves(
            plan, "teams.id", donor_id, survivor_id, scope="team",
            skip_tables=(_REGENERABLE_TEAM_TABLES - {"group_teams"}) | {"historical_matches"},
            skip_ids={"matches": plan.excluded_match_ids},
        )
        for column in (history.c.team_a_id, history.c.team_b_id):
            rows = [row for row in plan.rows(history, column, donor_id)
                    if row["id"] not in plan.history_fixes]
            plan.move(f"historical_matches.{column.name}", rows, donor_id, survivor_id)
        plan.drop("teams", plan.rows(teams, teams.c.id, donor_id)[0],
                  f"merged_into:{survivor_id}")
    copies = [m for p in plan.pairs for m in (p.survivor["id"], p.donor["id"])]
    _expected_read_paths(plan, _read_paths_bulk(db, copies))
    # Rows deleted outright are not also "moved".
    for key, moved in plan.moves.items():
        for row_id in plan.deletions.get(key.split(".")[0], {}):
            moved.pop(row_id, None)
    plan.moves = {key: moved for key, moved in plan.moves.items() if moved}
    _facts(plan, db)
    return plan


# ------------------------------------------------------------ execution


def _onupdate_guard(table: Table, column) -> dict:
    """Re-pointing a row must not rewrite its updated_at (review L2)."""
    return {c.name: table.c[c.name] for c in table.columns
            if c.onupdate is not None and c.name != column.name}


def _repoint(db: Session, target: str, mapping: dict[int, int],
             skip: dict[str, set[int]] | None = None) -> None:
    """One UPDATE per referencing column: col = CASE col WHEN donor THEN
    survivor ... END for every pair at once."""
    if not mapping:
        return
    skip = skip or {}
    columns = [(t, c, False) for t, c in _foreign_key_columns(target)]
    columns += [(t, c, True) for t, c in _soft_columns(target)]
    for table, column, soft in columns:
        query = update(table).where(column.in_(sorted(mapping))).values(
            {column.name: case(mapping, value=column), **_onupdate_guard(table, column)})
        if soft:
            query = query.where(_soft_filter(table))
        if skip.get(table.name):
            query = query.where(table.c.id.notin_(sorted(skip[table.name])))
        db.execute(query)


def _bulk_update(db: Session, table: Table, rows: list[dict], name: str) -> None:
    """Per-row values in three statements: fill a temporary table, UPDATE ...
    FROM it, drop it."""
    if not rows:
        return
    names = sorted(rows[0])
    columns = [
        Column(n, JSON(none_as_null=True) if isinstance(table.c[n].type, JSON)
               else table.c[n].type, primary_key=(n == "id"))
        for n in names
    ]
    temp = Table(name, MetaData(), *columns, prefixes=["TEMPORARY"])
    temp.create(db.connection())
    db.execute(insert(temp), rows)
    db.execute(
        update(table).where(table.c.id == temp.c.id).values(
            {n: temp.c[n] for n in names if n != "id"} | {
                c.name: table.c[c.name] for c in table.columns
                if c.onupdate is not None and c.name not in names
            })
    )
    temp.drop(db.connection())


def _execute(db: Session, plan: _Plan) -> None:
    from app.chain_status import finished_match_count

    finished_before = finished_match_count(db)
    # 1. Losers and derived duplicates, dependents before their parents.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name in {"matches", "teams"}:
            continue
        ids = list(plan.deletions.get(table.name, {}))
        for chunk in _chunks(sorted(ids)):
            db.execute(delete(table).where(table.c.id.in_(chunk)))

    # 2. Fixture merges: move dependents, drop the donors, carry their state.
    matches = _table("matches")
    _repoint(db, "matches.id", {p.donor["id"]: p.survivor["id"] for p in plan.pairs})
    donors = [p.donor["id"] for p in plan.pairs]
    for chunk in _chunks(donors):
        db.execute(delete(matches).where(matches.c.id.in_(chunk)))
    _bulk_update(db, matches,
                 [{"id": p.survivor["id"], **p.merged} for p in plan.pairs],
                 "_repair_survivors")
    _bulk_update(db, _table("historical_matches"),
                 [{"id": row_id, **fix["new"]} for row_id, fix in sorted(plan.history_fixes.items())],
                 "_repair_history")

    # 3. Club merges (clubs kept for an excluded group are left alone).
    merges = {d: s for d, s in plan.team_map.items() if d not in plan.kept_clubs}
    _repoint(db, "teams.id", merges, skip={"matches": plan.excluded_match_ids})
    if merges:
        teams = _table("teams")
        db.execute(delete(teams).where(teams.c.id.in_(sorted(merges))))

    # 4. The chain watermark counts finished matches; merging two finished
    # copies into one lowers that count, which would otherwise hide owed work
    # behind a stale high watermark (review M2). Keep the pending gap as is.
    if plan.finished_count_delta and plan.covered_finished_before is not None:
        status = _table("learning_chain_status")
        db.execute(update(status).where(status.c.id == 1).values(
            covered_finished=max(0, plan.covered_finished_before + plan.finished_count_delta)))
    db.flush()
    db.expire_all()
    _verify(db, plan, finished_before)


def _verify(db: Session, plan: _Plan, finished_before: int) -> None:
    """Postconditions, set-based; any failure rolls the whole repair back."""
    from app.chain_status import finished_match_count

    donor_matches = [pair.donor["id"] for pair in plan.pairs]
    gone_teams = [d for d in plan.team_map if d not in plan.kept_clubs]
    for target, ids in (("matches.id", donor_matches), ("teams.id", gone_teams)):
        if not ids:
            continue
        for table, column in _foreign_key_columns(target):
            left = db.execute(select(table.c.id).where(column.in_(ids)).limit(1)).first()
            if left is not None:
                raise DuplicateRepairError(f"{table.name}.{column.name} still references {ids}")
        for table, column in _soft_columns(target):
            left = db.execute(select(table.c.id).where(
                column.in_(ids), _soft_filter(table)).limit(1)).first()
            if left is not None:
                raise DuplicateRepairError(f"{table.name}.{column.name} still references {ids}")

    finished_after = finished_match_count(db)
    if finished_after - finished_before != plan.finished_count_delta:
        raise DuplicateRepairError(
            f"finished match count moved {finished_after - finished_before}, "
            f"planned {plan.finished_count_delta}"
        )
    if not plan.pairs:
        return

    matches = _table("matches")
    history = _table("historical_matches")
    results = _table("prediction_results")
    survivors = [pair.survivor["id"] for pair in plan.pairs]
    merged_rows = {row.id: row for row in db.execute(
        select(matches).where(matches.c.id.in_(survivors)))}
    clubs = {(r.tournament_id, r.team_home_id, r.team_away_id) for r in merged_rows.values()}
    homes = sorted({c[1] for c in clubs})
    provider_rows: dict[tuple, list[int]] = {}
    for row in db.execute(select(matches.c.id, matches.c.tournament_id, matches.c.team_home_id,
                                 matches.c.team_away_id).where(
            matches.c.fixture_provider == FOOTBALL_DATA, matches.c.team_home_id.in_(homes))):
        provider_rows.setdefault((row.tournament_id, row.team_home_id, row.team_away_id),
                                 []).append(row.id)
    for match_id, row in merged_rows.items():
        same = provider_rows.get((row.tournament_id, row.team_home_id, row.team_away_id), [])
        if same != [match_id]:
            raise DuplicateRepairError(f"fixture {match_id} still has duplicates: {same}")

    for grade in db.execute(select(results).where(results.c.match_id.in_(survivors))):
        merged = merged_rows[grade.match_id]
        actual = (grade.actual_score_home, grade.actual_score_away)
        expected = (merged.score_home, merged.score_away)
        if merged.status != FINISHED or actual != expected or (
            grade.outcome != _outcome(*expected)
        ):
            raise DuplicateRepairError(
                f"fixture {grade.match_id}: grade {grade.id} records {actual} "
                f"{grade.outcome}, match is {merged.status} {expected}"
            )

    # Simulate the next refresh's history sync for every finished merged
    # fixture: it inserts when no row of its competition sits on the key
    # (kickoff date, home, away); that must never make a second row.
    competitions = _sync_competitions()
    involved = sorted({c for key in clubs for c in key[1:]})
    recorded: dict[tuple, list] = {}
    for row in db.execute(select(history).where(history.c.team_a_id.in_(involved))):
        recorded.setdefault((row.team_a_id, row.team_b_id), []).append(row)
    names = {p.survivor["id"]: p.tournament_name for p in plan.pairs}
    for match_id, row in merged_rows.items():
        if row.status != FINISHED or row.kickoff_utc is None:
            continue
        kickoff = _utc(row.kickoff_utc)
        near = [h for h in recorded.get((row.team_home_id, row.team_away_id), [])
                if abs(_utc(h.date) - kickoff) < _SAME_MATCH_WINDOW]
        competition = competitions.get(names[match_id])
        sync_finds = any(
            (competition is None or h.competition == competition)
            and _utc(h.date).date() == kickoff.date() for h in near)
        if len(near) + (0 if sync_finds or competition is None else 1) > 1:
            raise DuplicateRepairError(
                f"fixture {match_id} would be in historical_matches "
                f"{len(near) + (0 if sync_finds else 1)} times after the next refresh"
            )

    expected_paths = {m: p for m, p in plan.read_paths.items() if p}
    actual_paths = _read_paths_bulk(db, sorted(expected_paths))
    for match_id, expected in expected_paths.items():
        for name, prediction_id in expected.items():
            if actual_paths[match_id][name] != prediction_id:
                raise DuplicateRepairError(
                    f"fixture {match_id}: {name} read path selects "
                    f"{actual_paths[match_id][name]}, graded prediction is {prediction_id}"
                )


# --------------------------------------------------------------- report


def _match_details(db: Session, plan: _Plan) -> list[MatchMerge]:
    teams = _table("teams")
    names = dict(db.execute(select(teams.c.id, teams.c.name)).all())
    details = []
    for pair in plan.pairs:
        survivor, donor, merged = pair.survivor, pair.donor, pair.merged
        delta = None
        if survivor["kickoff_utc"] is not None and donor["kickoff_utc"] is not None:
            delta = int((_utc(donor["kickoff_utc"]) - _utc(survivor["kickoff_utc"])).total_seconds())
        both_finished = survivor["status"] == FINISHED and donor["status"] == FINISHED
        details.append(MatchMerge(
            tournament_id=survivor["tournament_id"],
            tournament_name=pair.tournament_name,
            home=names[merged["team_home_id"]],
            away=names[merged["team_away_id"]],
            survivor_match_id=survivor["id"],
            donor_match_id=donor["id"],
            survivor_fixture_id=survivor["provider_fixture_id"],
            donor_fixture_id=donor["provider_fixture_id"],
            paired_by=pair.paired_by,
            survivor_matchweek=survivor["matchweek"],
            donor_matchweek=donor["matchweek"],
            survivor_kickoff_utc=_iso(survivor["kickoff_utc"]),
            donor_kickoff_utc=_iso(donor["kickoff_utc"]),
            kickoff_delta_seconds=delta,
            survivor_status=survivor["status"],
            donor_status=donor["status"],
            survivor_score=_score(survivor),
            donor_score=_score(donor),
            state_source=pair.state_source,
            merged_kickoff_utc=_iso(merged["kickoff_utc"]),
            merged_status=merged["status"],
            merged_score=_score(merged),
            score_mismatch=both_finished and _score_90(survivor) != _score_90(donor),
        ))
    return details


def _status(plan: _Plan, unresolved: int) -> str:
    if plan.blocking or unresolved:
        return "not ready"
    if not plan.pairs and not [d for d in plan.team_map if d not in plan.kept_clubs]:
        return "nothing to repair"
    return "ready"


def _summary(plan: _Plan, matches: list[MatchMerge], tournament_counts: dict,
             unresolved: int) -> dict:
    facts = plan.facts
    return {
        "status": _status(plan, unresolved),
        "blocking_issues": len(plan.blocking),
        "warnings": len(plan.warnings),
        "conflicts_needing_a_decision": unresolved,
        "clubs_merged": [
            f"{t.donor_name} (id {t.donor_team_id}) into {t.survivor_name} "
            f"(id {t.survivor_team_id})"
            for t in plan.team_details if t.donor_team_id not in plan.kept_clubs
        ],
        "clubs_kept_for_manual_handling": sorted(plan.kept_clubs),
        "fixtures_merged": dict(tournament_counts),
        "fixture_groups_left_for_manual_handling": [g["match_ids"] for g in plan.excluded],
        "fixtures_with_different_final_scores": [
            m.survivor_match_id for m in matches if m.score_mismatch
        ],
        "public_record": {
            "grades_removed": facts["public_grades_removed"],
            "graded_matches": f"{facts['public_grades_before']} -> {facts['public_grades_after']}",
            "correct_winner_calls": (
                f"{facts['public_winner_correct_before']} -> "
                f"{facts['public_winner_correct_after']}"
            ),
            "exact_scores": (
                f"{facts['public_exact_correct_before']} -> "
                f"{facts['public_exact_correct_after']}"
            ),
            "shadow_grades_removed": facts["shadow_grades_removed"],
        },
        "matches_gradeable_at_next_refresh": facts["become_gradeable_next_refresh"],
        "user_picks_deleted": facts["picks_deleted"],
        "league_score_predictions_deleted": facts["league_score_predictions_deleted"],
        "league_score_predictions_deleted_already_scored": (
            facts["league_score_predictions_deleted_already_scored"]
        ),
        "user_picks_becoming_scoreable": facts["picks_become_scoreable"],
        "league_score_predictions_becoming_scoreable": (
            facts["league_score_predictions_become_scoreable"]
        ),
        "history_rows_dropped": len(plan.deletions.get("historical_matches", {})),
        "history_rows_corrected": len(plan.history_fixes),
        "predictions_dropped": len(plan.deletions.get("predictions", {})),
        "rows_repointed": sum(len(m) for m in plan.moves.values()),
        "finished_match_count_change": plan.finished_count_delta,
        "match_ids_that_stop_existing": sorted(p.donor["id"] for p in plan.pairs),
    }


def _report(db: Session, plan: _Plan, *, dry_run: bool) -> RepairReport:
    matches = _match_details(db, plan)
    tournament_counts: dict[str, int] = {}
    for detail in matches:
        tournament_counts[detail.tournament_name] = tournament_counts.get(detail.tournament_name, 0) + 1
    deleted_rows = {
        table: [
            {"reason": entry["reason"], "row": entry["row"]}
            for _, entry in sorted(rows.items())
        ]
        for table, rows in sorted(plan.deletions.items())
    }
    moved_rows = {
        key: [{"id": row_id, "old": m["old"], "new": m["new"]}
              for row_id, m in sorted(moved.items())]
        for key, moved in sorted(plan.moves.items())
    }
    changed_rows = {
        "historical_matches": [
            {"id": row_id, "old": _evidence(fix["old"]), "new": _evidence(fix["new"])}
            for row_id, fix in sorted(plan.history_fixes.items())
        ]
    } if plan.history_fixes else {}
    survivors_before = [_evidence(pair.survivor) for pair in plan.pairs]
    conflicts = sorted(
        plan.conflicts,
        key=lambda c: (c["scope"], c["table"], c["survivor_row"]["id"], c["donor_row"]["id"]),
    )
    material = {
        "code_revision": code_revision(),
        "on_conflict": plan.policy,
        "acknowledged": plan.acknowledged,
        "team_mappings": [asdict(team) for team in plan.team_details],
        "kept_clubs": sorted(plan.kept_clubs),
        "excluded": plan.excluded,
        "match_mappings": [asdict(match) for match in matches],
        "merged_state": [
            {key: _jsonable(value) for key, value in sorted(pair.merged.items())}
            for pair in plan.pairs
        ],
        "survivors_before": survivors_before,
        "conflicts": conflicts,
        "blocking": sorted(plan.blocking),
        "moves": {
            key: sorted((row_id, m["old"], m["new"], m["hash"]) for row_id, m in moved.items())
            for key, moved in sorted(plan.moves.items())
        },
        "changed_rows": changed_rows,
        "deleted_rows": deleted_rows,
        "read_paths": {str(k): v for k, v in sorted(plan.read_paths.items())},
        "finished_count_delta": plan.finished_count_delta,
        "covered_finished_before": plan.covered_finished_before,
    }
    digest = hashlib.sha256(
        json.dumps(material, sort_keys=True, default=str).encode()
    ).hexdigest()
    unresolved = len(plan.unresolved())
    return RepairReport(
        dry_run=dry_run,
        code_revision=material["code_revision"],
        on_conflict=plan.policy,
        digest=digest,
        ready_to_apply=_status(plan, unresolved) == "ready",
        matches_merged=len(plan.pairs),
        teams_merged=len([d for d in plan.team_map if d not in plan.kept_clubs]),
        survivor_match_ids=tuple(pair.survivor["id"] for pair in plan.pairs),
        removed_match_ids=tuple(pair.donor["id"] for pair in plan.pairs),
        team_mappings=tuple(plan.team_details),
        match_mappings=tuple(matches),
        tournament_counts=dict(sorted(tournament_counts.items())),
        conflicts=conflicts,
        unresolved_conflicts=unresolved,
        blocking=sorted(plan.blocking),
        warnings=sorted(plan.warnings),
        moved_counts={key: len(moved) for key, moved in sorted(plan.moves.items())},
        dropped_counts={table: len(rows) for table, rows in sorted(plan.deletions.items())},
        acknowledged=plan.acknowledged,
        finished_count_delta=plan.finished_count_delta,
        left_for_manual_handling=plan.excluded,
        summary=_summary(plan, matches, tournament_counts, unresolved),
        deleted_rows=deleted_rows,
        moved_rows=moved_rows,
        changed_rows=changed_rows,
        survivors_before=survivors_before,
        covered_finished_before=plan.covered_finished_before,
    )


# ------------------------------------------------------------ entrypoint


def _begin(db: Session) -> None:
    """On Postgres: one REPEATABLE READ snapshot for plan + execution, so the
    plan and the writes see the same data (review L3), with lock, statement
    and idle-in-transaction timeouts so the run fails fast instead of
    queueing behind live traffic or leaving locks behind if the runner dies
    (review H4/M4). No-op elsewhere (tests use SQLite)."""
    if db.get_bind().dialect.name != "postgresql":
        return
    db.rollback()
    db.connection(execution_options={"isolation_level": "REPEATABLE READ"})
    db.execute(text(f"SET LOCAL lock_timeout = '{_LOCK_TIMEOUT}'"))
    db.execute(text(f"SET LOCAL statement_timeout = '{_STATEMENT_TIMEOUT}'"))
    db.execute(text(
        f"SET LOCAL idle_in_transaction_session_timeout = '{_IDLE_IN_TRANSACTION_TIMEOUT}'"))


def _db_error(exc: BaseException) -> DBAPIError | None:
    while exc is not None:
        if isinstance(exc, DBAPIError):
            return exc
        exc = exc.__cause__ or exc.__context__
    return None


def _refused_after_rollback(db: Session, plan: _Plan | None, exc: DBAPIError) -> RepairRefused:
    """Every database error (lock or statement timeout, serialization
    failure, a concurrent insert tripping a foreign key or unique constraint)
    is a clean refusal once the rollback is confirmed (review M2)."""
    db.rollback()
    db.expire_all()
    confirmed = ""
    if plan is not None and plan.team_map:
        teams = _table("teams")
        left = db.execute(select(teams.c.id).where(
            teams.c.id.in_(sorted(plan.team_map)))).scalars().all()
        db.rollback()
        confirmed = (f"; rollback confirmed: duplicate clubs {sorted(left)} still present"
                     if sorted(left) == sorted(plan.team_map) else
                     f"; WARNING: expected duplicate clubs {sorted(plan.team_map)}, found {left}")
    code = getattr(exc.orig, "pgcode", None) or getattr(exc.orig, "sqlstate", None)
    first_line = str(exc.orig).strip().splitlines()[0] if str(exc.orig).strip() else ""
    return RepairRefused(
        f"database error {code or type(exc.orig).__name__}: {first_line} "
        f"(the data changed or is busy); nothing was written{confirmed}; "
        "run the dry run again"
    )


def repair_fixture_duplicates(
    db: Session,
    *,
    apply: bool = False,
    expected_digest: str | None = None,
    on_conflict: dict[str, str] | None = None,
    acknowledge: list[str] | None = None,
    trial: bool = True,
    require_schema_head: bool = False,
) -> RepairReport:
    """Plan the repair; apply it only with a matching dry-run digest.

    The dry run never commits. When the plan is cleared to run and ``trial``
    is on, it executes once inside a savepoint (postconditions included) and
    rolls back, so a constraint the plan did not foresee shows up before
    apply. Any database error refuses cleanly with nothing written.
    """
    policy = dict(sorted((on_conflict or {}).items()))
    acknowledged = sorted(set(acknowledge or []))
    plan = None
    try:
        _begin(db)
        if require_schema_head:
            assert_schema_at_head(db)
        plan = _build_plan(db, policy, acknowledged)
        report = _report(db, plan, dry_run=not apply)
        if not apply:
            status = report.summary["status"]
            if status == "not ready":
                report.trial = "skipped: plan is blocked or has unresolved conflicts"
            elif status == "nothing to repair":
                report.trial = "skipped: nothing to repair"
            elif not trial:
                report.trial = "skipped: --no-trial"
            else:
                nested = db.begin_nested()
                try:
                    _execute(db, plan)
                    report.trial = "ok"
                except Exception as exc:  # noqa: BLE001 - reported, then rolled back
                    report.trial = f"failed: {exc}"
                    report.ready_to_apply = False
                    report.summary["status"] = "not ready"
                finally:
                    nested.rollback()
                    db.expire_all()
            db.rollback()
            return report

        if not expected_digest:
            raise RepairRefused("apply requires --expected-digest from a dry run")
        if expected_digest != report.digest:
            raise RepairRefused(
                f"digest mismatch: dry run {expected_digest}, now {report.digest}; "
                "the data or code changed since the dry run, run it again"
            )
        if report.blocking:
            raise RepairRefused(f"plan is blocked: {report.blocking}")
        if report.unresolved_conflicts:
            raise RepairRefused(
                f"{report.unresolved_conflicts} unresolved dependent-row conflicts; "
                "pass an explicit --on-conflict policy"
            )
        _execute(db, plan)
        db.commit()
    except RepairRefused:
        db.rollback()
        raise
    except Exception as exc:
        dbapi = _db_error(exc)
        if dbapi is not None:
            raise _refused_after_rollback(db, plan, dbapi) from exc
        db.rollback()
        db.expire_all()
        raise
    report.trial = "applied"
    return report


def report_json(report: RepairReport, *, include_rows: bool = True) -> str:
    """Evidence: the plain-language summary first, then the full report."""
    payload = asdict(report)
    summary = payload.pop("summary")
    if not include_rows:
        for name in ("deleted_rows", "moved_rows", "changed_rows", "survivors_before",
                     "conflicts", "left_for_manual_handling"):
            payload.pop(name)
    return (
        '{"summary": ' + json.dumps(summary, sort_keys=True, default=str)
        + ', "report": ' + json.dumps(payload, sort_keys=True, default=str) + "}"
    )


ROOT_ALEMBIC = Path(__file__).resolve().parents[1] / "backend" / "alembic"


def assert_schema_at_head(db: Session) -> None:
    from alembic.runtime.migration import MigrationContext
    from alembic.script import ScriptDirectory

    script = ScriptDirectory(str(ROOT_ALEMBIC))
    heads = set(script.get_heads())
    current = set(MigrationContext.configure(db.connection()).get_current_heads())
    if current != heads:
        raise DuplicateRepairError(
            f"database schema is at {sorted(current)}, code expects {sorted(heads)}; "
            "apply migrations first (see the runbook)"
        )


EXIT_OK = 0
EXIT_REFUSED = 2
EXIT_NOT_READY = 3


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-digest", default=None)
    parser.add_argument(
        "--on-conflict", action="append", default=[],
        help="keep-survivor | keep-donor | <table>=keep-survivor|keep-donor",
    )
    parser.add_argument(
        "--acknowledge", action="append", default=[],
        help="<kind>:<match id>, kind in " + ", ".join(ACK_KINDS),
    )
    parser.add_argument("--no-trial", action="store_true")
    parser.add_argument("--evidence-file", default=None)
    parser.add_argument("--require-schema-head", action="store_true")
    args = parser.parse_args(argv)
    policy = parse_on_conflict(args.on_conflict)
    acknowledged = parse_acknowledgements(args.acknowledge)
    with SessionLocal() as db:
        try:
            report = repair_fixture_duplicates(
                db,
                apply=args.apply,
                expected_digest=args.expected_digest,
                on_conflict=policy,
                acknowledge=acknowledged,
                trial=not args.no_trial,
                require_schema_head=args.require_schema_head,
            )
        except RepairRefused as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return EXIT_REFUSED
    if args.evidence_file:
        Path(args.evidence_file).write_text(report_json(report))
    # Only fixture/club ids, counts and table names reach stdout: workflow
    # logs of this repository are public. Rows (user picks included) go to
    # the evidence file only.
    print(json.dumps(report.summary, indent=2, sort_keys=True))
    for item in report.blocking:
        print(f"BLOCKING: {item}")
    for item in report.warnings:
        print(f"WARNING: {item}")
    unresolved: dict[str, int] = {}
    for conflict in report.conflicts:
        if conflict["resolution"] is None:
            unresolved[conflict["table"]] = unresolved.get(conflict["table"], 0) + 1
    for table, count in sorted(unresolved.items()):
        print(f"CONFLICTS: {table}: {count} need --on-conflict {table}=keep-survivor|keep-donor")
    if not args.evidence_file:
        print(report_json(report))
    status = report.summary["status"]
    print(f"trial: {report.trial}")
    print(f"status: {status}")
    if report.dry_run and status == "ready":
        print(f"digest: {report.digest}")
        print("ready_to_apply: true")
        return EXIT_OK
    if report.dry_run and status == "not ready":
        print("ready_to_apply: false (resolve the blocking items first; no digest is issued)")
        return EXIT_NOT_READY
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
