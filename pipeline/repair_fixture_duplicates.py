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
- a duplicate club is deleted only after every reference to it has moved.

The digest is a hash of the full planned change set and the code revision.
Apply recomputes it and refuses unless it equals the ``--expected-digest``
printed by the dry run, so data that changed in between also refuses.
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

from sqlalchemy import Table, UniqueConstraint, delete, select, update
from sqlalchemy.orm import Session

from app.db import Base, SessionLocal
from app.match_status import FINISHED
from app.models import Match, PredictionResult
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

_REPAIR_TEAM_NAMES = {
    "Real Racing Club de Santander",
    "RC Deportivo La Coruña",
    "Málaga CF",
    "SV 07 Elversberg",
}

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
    deleted_rows: dict[str, list[dict]]
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


def _chunks(values: list, size: int = 500):
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


# ------------------------------------------------------------- the plan


@dataclass
class _Pair:
    survivor: dict
    donor: dict
    paired_by: str
    state_source: str
    merged: dict


@dataclass
class _Plan:
    db: Session
    team_map: dict[int, int]
    team_details: list[TeamMerge]
    pairs: list[_Pair]
    policy: dict[str, str]
    conflicts: list[dict] = field(default_factory=list)
    # table -> row id -> {"reason": str, "row": dict}
    deletions: dict[str, dict[int, dict]] = field(default_factory=dict)
    # "table.column" -> row ids re-pointed at the survivor
    moves: dict[str, set[int]] = field(default_factory=dict)
    blocking: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    # survivor match id -> read paths that agreed with the kept grade before
    read_paths: dict[int, dict[str, int]] = field(default_factory=dict)

    def drop(self, table: str, row: dict, reason: str) -> None:
        self.deletions.setdefault(table, {}).setdefault(
            row["id"], {"reason": reason, "row": _evidence(row)}
        )

    def dropped(self, table: str, row_id: int) -> bool:
        return row_id in self.deletions.get(table, {})

    def unresolved(self) -> list[dict]:
        return [c for c in self.conflicts if c["resolution"] is None]


def _team_merges(db: Session) -> dict[int, int]:
    teams = db.execute(select(_table("teams").c.id, _table("teams").c.name)
                       .order_by(_table("teams").c.id)).all()
    by_name = {name: team_id for team_id, name in teams}
    merges: dict[int, int] = {}
    for team_id, name in teams:
        if name not in _REPAIR_TEAM_NAMES:
            continue
        survivor_id = by_name.get(normalize_team_name(name))
        if survivor_id is None or survivor_id == team_id:
            continue
        merges[team_id] = survivor_id
    return merges


def _describe(rows: list[dict]) -> str:
    return ", ".join(
        f"id={row['id']} provider={row['fixture_provider']} "
        f"fixture={row['provider_fixture_id']} kickoff={_iso(row['kickoff_utc'])} "
        f"matchweek={row['matchweek']} status={row['status']}"
        for row in rows
    )


def _pair_group(rows: list[dict]) -> list[tuple[dict, dict, str]]:
    donors = [row for row in rows if row["fixture_provider"] == FOOTBALL_DATA]
    survivors = [row for row in rows if row["fixture_provider"] != FOOTBALL_DATA]
    if len(donors) == 1 and len(survivors) == 1:
        return [(survivors[0], donors[0], "identity")]
    by_week: dict[int, tuple[list, list]] = {}
    for row in rows:
        if row["matchweek"] is None:
            raise DuplicateRepairError(
                "ambiguous fixture duplicate group (no matchweek to break the "
                f"tie): {_describe(rows)}"
            )
        bucket = by_week.setdefault(row["matchweek"], ([], []))
        bucket[0 if row["fixture_provider"] != FOOTBALL_DATA else 1].append(row)
    pairs = []
    for week, (week_survivors, week_donors) in sorted(by_week.items()):
        if not week_donors:
            continue  # a legacy row with no football-data twin stays as it is
        if len(week_survivors) != 1 or len(week_donors) != 1:
            raise DuplicateRepairError(
                f"ambiguous fixture duplicate group (matchweek {week} does not "
                f"pair one-to-one): {_describe(rows)}"
            )
        pairs.append((week_survivors[0], week_donors[0], "identity+matchweek"))
    return pairs


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


def _match_pairs(db: Session, team_map: dict[int, int]) -> list[_Pair]:
    if not team_map:
        return []
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
    pairs: list[_Pair] = []
    for key in sorted(groups):
        group = groups[key]
        has_donor = any(r["fixture_provider"] == FOOTBALL_DATA for r in group)
        has_legacy = any(r["fixture_provider"] != FOOTBALL_DATA for r in group)
        if not (has_donor and has_legacy):
            continue
        for survivor, donor, paired_by in _pair_group(group):
            state_source, merged = _merged_state(survivor, donor, team_map)
            pairs.append(_Pair(survivor, donor, paired_by, state_source, merged))
    return pairs


def _rows(db: Session, table: Table, column, value, *, soft: bool = False) -> list[dict]:
    query = select(table).where(column == value).order_by(table.c.id)
    if soft:
        query = query.where(_soft_filter(table))
    return [dict(row._mapping) for row in db.execute(query)]


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
        for row in _rows(plan.db, child, child_column, loser["id"]):
            plan.drop(child.name, row, f"child_of_conflict_loser:{conflict['table']}")


def _plan_reference_moves(
    plan: _Plan,
    db: Session,
    target: str,
    donor_id: int,
    survivor_id: int,
    *,
    scope: str,
    skip_tables: set[str],
) -> None:
    """Enumerate rows that will be re-pointed donor -> survivor, and every
    unique-constraint conflict that re-pointing would raise."""
    for table, column in _foreign_key_columns(target):
        if table.name in skip_tables:
            continue
        donor_rows = _rows(db, table, column, donor_id)
        if not donor_rows:
            continue
        survivor_rows = _rows(db, table, column, survivor_id)
        for unique in _unique_sets(table):
            if column.name not in unique:
                continue
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
        moved = plan.moves.setdefault(f"{table.name}.{column.name}", set())
        moved.update(row["id"] for row in donor_rows)
    for table, column in _soft_columns(target):
        if table.name in skip_tables:
            continue
        rows = _rows(db, table, column, donor_id, soft=True)
        if rows:
            moved = plan.moves.setdefault(f"{table.name}.{column.name}", set())
            moved.update(row["id"] for row in rows)


def _odds_drops(plan: _Plan, db: Session, pair: _Pair) -> None:
    """One phased odds row per (match, phase): keep the copy whose fixture
    state is kept, drop the stale copy's twin."""
    odds = _table("odds")
    stale = pair.survivor if pair.state_source == "donor" else pair.donor
    kept = pair.donor if pair.state_source == "donor" else pair.survivor
    kept_phases = {
        row["snapshot_phase"]
        for row in _rows(db, odds, odds.c.match_id, kept["id"])
        if row["snapshot_phase"] is not None
    }
    for row in _rows(db, odds, odds.c.match_id, stale["id"]):
        if row["snapshot_phase"] in kept_phases:
            plan.drop("odds", row, "odds_phase_duplicate")


def _graded_prediction_ids(db: Session) -> set[int]:
    results = _table("prediction_results")
    return set(db.execute(select(results.c.prediction_id)).scalars())


def _prediction_drops(
    plan: _Plan, db: Session, pair: _Pair, graded: set[int],
) -> None:
    """Make the merged row's frozen prediction the graded one.

    The two copies were predicted independently, and a legacy row left
    "scheduled" kept receiving daily predictions long after the real match
    was played. On the merged row (kickoff K):

    1. A prediction from the stale copy (the one whose fixture state is NOT
       kept) created after K is dropped: the merged match must not carry a
       post-kickoff prediction, and latest_prediction would serve it.
    2. For each kept grade G, a prediction from the other copy in G's frozen
       basis (production: is_shadow=False; shadow: same is_shadow and
       model_version) created at or before K that sorts after G's prediction
       in the frozen order (created_at desc, id desc) is dropped, so
       _frozen_prediction resolves to G's prediction.

    Graded predictions are never dropped or edited; if one would have to be,
    the pair is blocking. No prediction is ever created.
    """
    predictions = _table("predictions")
    results = _table("prediction_results")
    kickoff = pair.merged["kickoff_utc"]
    survivor_preds = _rows(db, predictions, predictions.c.match_id, pair.survivor["id"])
    donor_preds = _rows(db, predictions, predictions.c.match_id, pair.donor["id"])
    copy_of = {row["id"]: "survivor" for row in survivor_preds}
    copy_of.update({row["id"]: "donor" for row in donor_preds})
    by_id = {row["id"]: row for row in survivor_preds + donor_preds}
    stale = "survivor" if pair.state_source == "donor" else "donor"
    match_ref = f"pair {pair.survivor['id']}<-{pair.donor['id']}"

    def drop(row: dict, reason: str) -> None:
        if row["id"] in graded:
            plan.blocking.append(
                f"{match_ref}: graded prediction {row['id']} would have to be "
                f"dropped ({reason})"
            )
            return
        plan.drop("predictions", row, reason)

    if kickoff is None:
        return
    kickoff = _utc(kickoff)
    for row in by_id.values():
        if copy_of[row["id"]] == stale and _utc(row["created_at"]) > kickoff:
            drop(row, "stale_copy_prediction_after_kickoff")

    for is_shadow in (False, True):
        grades = [
            row
            for match_id in (pair.survivor["id"], pair.donor["id"])
            for row in _rows(db, results, results.c.match_id, match_id)
            if bool(row["is_shadow"]) is is_shadow
            and not plan.dropped("prediction_results", row["id"])
        ]
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
                f"{grade['prediction_id']} outside this pair"
            )
            continue
        if _utc(graded_pred["created_at"]) > kickoff:
            plan.blocking.append(
                f"{match_ref}: graded prediction {graded_pred['id']} was created "
                f"after the merged kickoff {kickoff.isoformat()}"
            )
            continue
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


def _read_paths(db: Session, match: Match) -> dict[str, int | None]:
    """The prediction each read path selects for ``match`` right now."""
    from app.serializers import latest_prediction
    from pipeline.generate_predictions import shadow_model_version_for
    from pipeline.learning_loop import _frozen_prediction

    frozen = _frozen_prediction(db, match)
    latest = latest_prediction(db, match.id)
    shadow = None
    if frozen is not None:
        shadow = _frozen_prediction(
            db,
            match,
            shadow=True,
            shadow_version=shadow_model_version_for(frozen.model_version),
        )
    return {
        "frozen": frozen.id if frozen is not None else None,
        "latest": latest.id if latest is not None else None,
        "frozen_shadow": shadow.id if shadow is not None else None,
    }


def _kept_grades(db: Session, match_ids: list[int], plan: _Plan) -> dict[bool, int]:
    rows = db.execute(
        select(PredictionResult.__table__).where(
            PredictionResult.__table__.c.match_id.in_(match_ids)
        )
    ).all()
    kept: dict[bool, int] = {}
    for row in rows:
        mapping = row._mapping
        if plan.dropped("prediction_results", mapping["id"]):
            continue
        kept.setdefault(bool(mapping["is_shadow"]), mapping["prediction_id"])
    return kept


def _expected_read_paths(db: Session, pair: _Pair, plan: _Plan) -> dict[str, int]:
    """Read paths that pointed at the kept grade on its own copy before the
    merge. Those must still point at it afterwards; one that disagreed before
    is pre-existing and only warned about."""
    kept = _kept_grades(db, [pair.survivor["id"], pair.donor["id"]], plan)
    expected: dict[str, int] = {}
    for is_shadow, prediction_id in kept.items():
        predictions = _table("predictions")
        match_id = db.execute(
            select(predictions.c.match_id).where(predictions.c.id == prediction_id)
        ).scalar_one_or_none()
        if match_id is None:
            continue
        before = _read_paths(db, db.get(Match, match_id))
        names = ("frozen_shadow",) if is_shadow else ("frozen", "latest")
        for name in names:
            if before[name] == prediction_id:
                expected[name] = prediction_id
            else:
                plan.warnings.append(
                    f"pair {pair.survivor['id']}<-{pair.donor['id']}: {name} "
                    f"read path already disagreed with graded prediction "
                    f"{prediction_id} before the repair (selected {before[name]})"
                )
    return expected


def _history_drops(plan: _Plan, db: Session) -> None:
    """Keep one historical_matches row per real match.

    Rows are clustered by canonical oriented club pair and kickoff proximity.
    A cluster with a row on a duplicate club is one real match recorded more
    than once (both copies finished, or an alias-aware refresh re-synced the
    football-data row under the original club). Keep the row whose score
    matches the merged fixture, else the one already on the original club,
    else the oldest; drop the rest.
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
    groups: dict[tuple, list[dict]] = {}
    for row in rows:
        key = (
            plan.team_map.get(row["team_a_id"], row["team_a_id"]),
            plan.team_map.get(row["team_b_id"], row["team_b_id"]),
        )
        groups.setdefault(key, []).append(row)
    finals = {
        (pair.merged["team_home_id"], pair.merged["team_away_id"]): pair
        for pair in plan.pairs
    }
    for key, group in sorted(groups.items()):
        group.sort(key=lambda row: (_utc(row["date"]), row["id"]))
        clusters: list[list[dict]] = []
        for row in group:
            if clusters and _utc(row["date"]) - _utc(clusters[-1][-1]["date"]) < _SAME_MATCH_WINDOW:
                clusters[-1].append(row)
            else:
                clusters.append([row])
        pair = finals.get(key)
        for cluster in clusters:
            on_donor = {
                row["id"] for row in cluster
                if row["team_a_id"] in plan.team_map or row["team_b_id"] in plan.team_map
            }
            if len(cluster) < 2 or not on_donor:
                continue
            final_score = None
            if pair is not None and pair.merged["status"] == FINISHED:
                final_score = _score_90(pair.merged)

            def preference(row: dict) -> tuple:
                return (
                    final_score is not None
                    and (row["score_a"], row["score_b"]) != tuple(final_score),
                    row["id"] in on_donor,
                    row["id"],
                )

            keep = min(cluster, key=preference)
            if final_score is not None and (keep["score_a"], keep["score_b"]) != tuple(final_score):
                plan.warnings.append(
                    f"history row {keep['id']} kept for {key} but its score "
                    f"{keep['score_a']}-{keep['score_b']} differs from the "
                    f"merged fixture's {final_score[0]}-{final_score[1]}"
                )
            for row in cluster:
                if row is not keep:
                    plan.drop("historical_matches", row, f"history_duplicate_of:{keep['id']}")


def _team_drops(plan: _Plan, db: Session, donor_id: int, survivor_id: int) -> None:
    for table_name in sorted(_REGENERABLE_TEAM_TABLES):
        table = _table(table_name)
        for row in _rows(db, table, table.c.team_id, donor_id):
            if table_name == "group_teams":
                canonical = db.execute(
                    select(table.c.id).where(
                        table.c.group_id == row["group_id"],
                        table.c.team_id == survivor_id,
                    ).limit(1)
                ).scalar_one_or_none()
                if canonical is None:
                    plan.blocking.append(
                        f"team {donor_id} has group membership {row['group_id']} "
                        f"missing from canonical team {survivor_id}"
                    )
                    continue
            plan.drop(table_name, row, "regenerable_team_row")

    snapshots = _table("probability_snapshots")
    survivor_keys = {
        (row["market"], row["ref_id"], row["snapshot_date"])
        for row in _rows(db, snapshots, snapshots.c.entity_id, survivor_id, soft=True)
    }
    for row in _rows(db, snapshots, snapshots.c.entity_id, donor_id, soft=True):
        if (row["market"], row["ref_id"], row["snapshot_date"]) in survivor_keys:
            plan.drop("probability_snapshots", row, "probability_snapshot_duplicate")


def _build_plan(db: Session, policy: dict[str, str]) -> _Plan:
    team_map = _team_merges(db)
    teams = _table("teams")
    details = []
    for donor_id, survivor_id in sorted(team_map.items()):
        names = dict(db.execute(
            select(teams.c.id, teams.c.name).where(teams.c.id.in_([donor_id, survivor_id]))
        ).all())
        details.append(TeamMerge(donor_id, names[donor_id], survivor_id, names[survivor_id]))
    plan = _Plan(db, team_map, details, _match_pairs(db, team_map), policy)
    graded = _graded_prediction_ids(db)
    for pair in plan.pairs:
        _plan_reference_moves(
            plan, db, "matches.id", pair.donor["id"], pair.survivor["id"],
            scope="match", skip_tables=set(),
        )
        _odds_drops(plan, db, pair)
        _prediction_drops(plan, db, pair, graded)
        matches = _table("matches")
        plan.drop("matches", _rows(db, matches, matches.c.id, pair.donor["id"])[0],
                  f"merged_into:{pair.survivor['id']}")
    _history_drops(plan, db)
    for donor_id, survivor_id in sorted(team_map.items()):
        _team_drops(plan, db, donor_id, survivor_id)
        _plan_reference_moves(
            plan, db, "teams.id", donor_id, survivor_id, scope="team",
            skip_tables=_REGENERABLE_TEAM_TABLES | {"historical_matches"},
        )
        history = _table("historical_matches")
        for column in (history.c.team_a_id, history.c.team_b_id):
            moved = plan.moves.setdefault(f"historical_matches.{column.name}", set())
            moved.update(row["id"] for row in _rows(db, history, column, donor_id))
        plan.drop("teams", _rows(db, teams, teams.c.id, donor_id)[0],
                  f"merged_into:{survivor_id}")
    for pair in plan.pairs:
        plan.read_paths[pair.survivor["id"]] = _expected_read_paths(db, pair, plan)
    # Rows deleted outright are not also "moved".
    for key, ids in plan.moves.items():
        ids.difference_update(plan.deletions.get(key.split(".")[0], {}))
    plan.moves = {key: ids for key, ids in plan.moves.items() if ids}
    return plan


# ------------------------------------------------------------ execution


def _delete_ids(db: Session, table: Table, ids: list[int]) -> None:
    for chunk in _chunks(sorted(ids)):
        db.execute(delete(table).where(table.c.id.in_(chunk)))


def _execute(db: Session, plan: _Plan) -> None:
    # 1. Losers and derived duplicates, dependents before their parents.
    for table in reversed(Base.metadata.sorted_tables):
        if table.name in {"matches", "teams"}:
            continue
        ids = list(plan.deletions.get(table.name, {}))
        if ids:
            _delete_ids(db, table, ids)

    # 2. Fixture merges: move dependents, drop the donor, then carry its state.
    for pair in plan.pairs:
        donor_id, survivor_id = pair.donor["id"], pair.survivor["id"]
        for table, column in _foreign_key_columns("matches.id"):
            db.execute(update(table).where(column == donor_id)
                       .values({column.name: survivor_id}))
        for table, column in _soft_columns("matches.id"):
            db.execute(update(table).where(column == donor_id, _soft_filter(table))
                       .values({column.name: survivor_id}))
        matches = _table("matches")
        db.execute(delete(matches).where(matches.c.id == donor_id))
        db.execute(update(matches).where(matches.c.id == survivor_id).values(pair.merged))

    # 3. Club merges.
    for donor_id, survivor_id in sorted(plan.team_map.items()):
        for table, column in _foreign_key_columns("teams.id"):
            db.execute(update(table).where(column == donor_id)
                       .values({column.name: survivor_id}))
        for table, column in _soft_columns("teams.id"):
            db.execute(update(table).where(column == donor_id, _soft_filter(table))
                       .values({column.name: survivor_id}))
        teams = _table("teams")
        db.execute(delete(teams).where(teams.c.id == donor_id))
    db.flush()
    db.expire_all()
    _verify(db, plan)


def _verify(db: Session, plan: _Plan) -> None:
    """Postconditions; any failure rolls the whole repair back."""
    donor_matches = [pair.donor["id"] for pair in plan.pairs]
    donor_teams = list(plan.team_map)
    for target, ids in (("matches.id", donor_matches), ("teams.id", donor_teams)):
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

    matches = _table("matches")
    history = _table("historical_matches")
    for pair in plan.pairs:
        same_fixture = db.execute(select(matches.c.id).where(
            matches.c.tournament_id == pair.survivor["tournament_id"],
            matches.c.team_home_id == pair.merged["team_home_id"],
            matches.c.team_away_id == pair.merged["team_away_id"],
            matches.c.fixture_provider == FOOTBALL_DATA,
        )).scalars().all()
        if same_fixture != [pair.survivor["id"]]:
            raise DuplicateRepairError(
                f"fixture {pair.survivor['id']} still has duplicates: {same_fixture}"
            )
        kickoff = pair.merged["kickoff_utc"]
        if pair.merged["status"] == FINISHED and kickoff is not None:
            kickoff = _utc(kickoff)
            recorded = [
                when for (when,) in db.execute(select(history.c.date).where(
                    history.c.team_a_id == pair.merged["team_home_id"],
                    history.c.team_b_id == pair.merged["team_away_id"],
                ))
                if abs(_utc(when) - kickoff) < _SAME_MATCH_WINDOW
            ]
            if len(recorded) > 1:
                raise DuplicateRepairError(
                    f"fixture {pair.survivor['id']} is in historical_matches "
                    f"{len(recorded)} times"
                )
        expected = plan.read_paths.get(pair.survivor["id"], {})
        if expected:
            actual = _read_paths(db, db.get(Match, pair.survivor["id"]))
            for name, prediction_id in expected.items():
                if actual[name] != prediction_id:
                    raise DuplicateRepairError(
                        f"fixture {pair.survivor['id']}: {name} read path selects "
                        f"{actual[name]}, graded prediction is {prediction_id}"
                    )


# --------------------------------------------------------------- report


def _match_details(db: Session, plan: _Plan) -> list[MatchMerge]:
    tournaments = _table("tournaments")
    teams = _table("teams")
    names = dict(db.execute(select(teams.c.id, teams.c.name)).all())
    tournament_names = dict(db.execute(select(tournaments.c.id, tournaments.c.name)).all())
    details = []
    for pair in plan.pairs:
        survivor, donor, merged = pair.survivor, pair.donor, pair.merged
        delta = None
        if survivor["kickoff_utc"] is not None and donor["kickoff_utc"] is not None:
            delta = int((_utc(donor["kickoff_utc"]) - _utc(survivor["kickoff_utc"])).total_seconds())
        both_finished = survivor["status"] == FINISHED and donor["status"] == FINISHED
        details.append(MatchMerge(
            tournament_id=survivor["tournament_id"],
            tournament_name=tournament_names[survivor["tournament_id"]],
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
    conflicts = sorted(
        plan.conflicts,
        key=lambda c: (c["scope"], c["table"], c["survivor_row"]["id"], c["donor_row"]["id"]),
    )
    material = {
        "code_revision": code_revision(),
        "on_conflict": plan.policy,
        "team_mappings": [asdict(team) for team in plan.team_details],
        "match_mappings": [asdict(match) for match in matches],
        "merged_state": [
            {key: _jsonable(value) for key, value in sorted(pair.merged.items())}
            for pair in plan.pairs
        ],
        "conflicts": conflicts,
        "blocking": sorted(plan.blocking),
        "moves": {key: sorted(ids) for key, ids in sorted(plan.moves.items())},
        "deleted_rows": deleted_rows,
        "read_paths": {str(k): v for k, v in sorted(plan.read_paths.items())},
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
        ready_to_apply=not plan.blocking and not unresolved,
        matches_merged=len(plan.pairs),
        teams_merged=len(plan.team_map),
        survivor_match_ids=tuple(pair.survivor["id"] for pair in plan.pairs),
        removed_match_ids=tuple(pair.donor["id"] for pair in plan.pairs),
        team_mappings=tuple(plan.team_details),
        match_mappings=tuple(matches),
        tournament_counts=dict(sorted(tournament_counts.items())),
        conflicts=conflicts,
        unresolved_conflicts=unresolved,
        blocking=sorted(plan.blocking),
        warnings=sorted(plan.warnings),
        moved_counts={key: len(ids) for key, ids in sorted(plan.moves.items())},
        dropped_counts={table: len(rows) for table, rows in sorted(plan.deletions.items())},
        deleted_rows=deleted_rows,
    )


# ------------------------------------------------------------ entrypoint


def repair_fixture_duplicates(
    db: Session,
    *,
    apply: bool = False,
    expected_digest: str | None = None,
    on_conflict: dict[str, str] | None = None,
) -> RepairReport:
    """Plan the repair; apply it only with a matching dry-run digest.

    The dry run reads only. When the plan is cleared to run it also executes
    once inside a savepoint (postconditions included) and rolls back, so a
    constraint the plan did not foresee shows up before apply.
    """
    policy = dict(sorted((on_conflict or {}).items()))
    plan = _build_plan(db, policy)
    report = _report(db, plan, dry_run=not apply)
    if not apply:
        if not report.ready_to_apply:
            report.trial = "skipped: plan is blocked or has unresolved conflicts"
        elif not plan.pairs and not plan.team_map:
            report.trial = "skipped: nothing to repair"
        else:
            nested = db.begin_nested()
            try:
                _execute(db, plan)
                report.trial = "ok"
            except Exception as exc:  # noqa: BLE001 - reported, then rolled back
                report.trial = f"failed: {exc}"
                report.ready_to_apply = False
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
    try:
        _execute(db, plan)
        db.commit()
    except Exception:
        db.rollback()
        db.expire_all()
        raise
    report.trial = "applied"
    return report


def report_json(report: RepairReport, *, include_rows: bool = True) -> str:
    """Stable machine-readable evidence emitted by dry-run and apply."""
    payload = asdict(report)
    if not include_rows:
        payload.pop("deleted_rows")
    return json.dumps(payload, sort_keys=True, default=str)


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
            "run alembic upgrade head first"
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-digest", default=None)
    parser.add_argument(
        "--on-conflict", action="append", default=[],
        help="keep-survivor | keep-donor | <table>=keep-survivor|keep-donor",
    )
    parser.add_argument("--evidence-file", default=None)
    parser.add_argument("--require-schema-head", action="store_true")
    args = parser.parse_args(argv)
    policy = parse_on_conflict(args.on_conflict)
    with SessionLocal() as db:
        if args.require_schema_head:
            assert_schema_at_head(db)
        try:
            report = repair_fixture_duplicates(
                db,
                apply=args.apply,
                expected_digest=args.expected_digest,
                on_conflict=policy,
            )
        except RepairRefused as exc:
            print(f"REFUSED: {exc}", file=sys.stderr)
            return 2
    if args.evidence_file:
        Path(args.evidence_file).write_text(report_json(report))
        print(report_json(report, include_rows=False))
    else:
        print(report_json(report))
    print(f"digest: {report.digest}")
    print(f"ready_to_apply: {str(report.ready_to_apply).lower()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
