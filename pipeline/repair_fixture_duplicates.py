"""Dry-run-first repair for duplicate fixtures from the provider cutover."""
from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from datetime import datetime, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, undefer

from app.db import Base, SessionLocal
from app.models import Match, Team
from pipeline.team_mapping import normalize_team_name


class DuplicateRepairError(RuntimeError):
    """The repair cannot prove that a proposed merge is safe."""


@dataclass(frozen=True)
class RepairReport:
    dry_run: bool
    matches_merged: int
    teams_merged: int
    survivor_match_ids: tuple[int, ...]
    removed_match_ids: tuple[int, ...]


_REPAIR_TEAM_NAMES = {
    "Real Racing Club de Santander",
    "RC Deportivo La Coruña",
    "Málaga CF",
    "SV 07 Elversberg",
}

_REGENERABLE_TEAM_TABLES = {
    "group_teams",
    "standings",
    "team_stats",
    "team_tournament_state",
    "tournament_odds",
}

_FIXTURE_FIELDS = (
    "group_id",
    "stage",
    "is_neutral",
    "kickoff_utc",
    "status",
    "score_home",
    "score_away",
    "score_home_90",
    "score_away_90",
    "matchweek",
    "fixture_provider",
    "provider_fixture_id",
    "provider_last_updated",
)


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _foreign_key_columns(target: str):
    for table in Base.metadata.sorted_tables:
        for column in table.columns:
            if any(fk.target_fullname == target for fk in column.foreign_keys):
                yield table, column


def _team_merges(db: Session) -> dict[int, int]:
    teams = db.query(Team).order_by(Team.id).all()
    by_name = {team.name: team for team in teams}
    merges: dict[int, int] = {}
    for donor in teams:
        if donor.name not in _REPAIR_TEAM_NAMES:
            continue
        canonical_name = normalize_team_name(donor.name)
        survivor = by_name.get(canonical_name)
        if survivor is None or survivor.id == donor.id:
            continue
        merges[donor.id] = survivor.id
    return merges


def _match_merges(
    db: Session, team_merges: dict[int, int],
) -> list[tuple[Match, Match]]:
    matches = (
        db.query(Match)
        .options(
            undefer(Match.fixture_provider),
            undefer(Match.matchweek),
            joinedload(Match.home_team),
            joinedload(Match.away_team),
        )
        .filter(Match.kickoff_utc.isnot(None))
        .order_by(Match.id)
        .all()
    )
    groups: dict[tuple, list[Match]] = {}
    changed_groups: set[tuple] = set()
    for match in matches:
        if match.team_home_id is None or match.team_away_id is None:
            continue
        home_id = team_merges.get(match.team_home_id, match.team_home_id)
        away_id = team_merges.get(match.team_away_id, match.team_away_id)
        key = (match.tournament_id, _utc(match.kickoff_utc), home_id, away_id)
        groups.setdefault(key, []).append(match)
        if (
            match.fixture_provider == "football_data"
            and (home_id != match.team_home_id or away_id != match.team_away_id)
        ):
            changed_groups.add(key)

    result: list[tuple[Match, Match]] = []
    for key in sorted(changed_groups, key=str):
        rows = groups[key]
        donors = [m for m in rows if m.fixture_provider == "football_data"]
        survivors = [m for m in rows if m.fixture_provider != "football_data"]
        if len(rows) != 2 or len(donors) != 1 or len(survivors) != 1:
            raise DuplicateRepairError(
                "ambiguous fixture duplicate group: "
                f"match_ids={[match.id for match in rows]}"
            )
        result.append((survivors[0], donors[0]))
    return result


def _reparent_match_rows(db: Session, donor_id: int, survivor_id: int) -> None:
    for table, column in _foreign_key_columns("matches.id"):
        db.execute(
            update(table)
            .where(column == donor_id)
            .values({column.name: survivor_id})
        )


def _canonical_group_membership_exists(
    db: Session, table, donor_id: int, survivor_id: int,
) -> bool:
    rows = db.execute(
        select(table.c.group_id).where(table.c.team_id == donor_id)
    ).scalars().all()
    return all(
        db.execute(
            select(table.c.id).where(
                table.c.group_id == group_id,
                table.c.team_id == survivor_id,
            ).limit(1)
        ).scalar_one_or_none()
        is not None
        for group_id in rows
    )


def _merge_team_rows(db: Session, donor_id: int, survivor_id: int) -> None:
    for table, column in _foreign_key_columns("teams.id"):
        if table.name == "matches":
            db.execute(
                update(table)
                .where(column == donor_id)
                .values({column.name: survivor_id})
            )
            continue
        if table.name in _REGENERABLE_TEAM_TABLES:
            if table.name == "group_teams" and not _canonical_group_membership_exists(
                db, table, donor_id, survivor_id
            ):
                raise DuplicateRepairError(
                    f"team {donor_id} has a group membership missing from "
                    f"canonical team {survivor_id}"
                )
            db.execute(delete(table).where(column == donor_id))
            continue
        db.execute(
            update(table)
            .where(column == donor_id)
            .values({column.name: survivor_id})
        )
    db.execute(delete(Team.__table__).where(Team.id == donor_id))


def _apply_repair(
    db: Session,
    team_merges: dict[int, int],
    match_merges: list[tuple[Match, Match]],
) -> RepairReport:
    survivor_ids: list[int] = []
    removed_ids: list[int] = []
    for survivor, donor in match_merges:
        _reparent_match_rows(db, donor.id, survivor.id)
        values = {field: getattr(donor, field) for field in _FIXTURE_FIELDS}
        values["team_home_id"] = team_merges.get(
            donor.team_home_id, donor.team_home_id
        )
        values["team_away_id"] = team_merges.get(
            donor.team_away_id, donor.team_away_id
        )
        if donor.venue is not None:
            values["venue"] = donor.venue
        if donor.venue_city is not None:
            values["venue_city"] = donor.venue_city
        db.execute(
            update(Match.__table__)
            .where(Match.id == donor.id)
            .values(provider_fixture_id=None)
        )
        db.execute(
            update(Match.__table__).where(Match.id == survivor.id).values(values)
        )
        db.execute(delete(Match.__table__).where(Match.id == donor.id))
        survivor_ids.append(survivor.id)
        removed_ids.append(donor.id)

    for donor_id, survivor_id in sorted(team_merges.items()):
        _merge_team_rows(db, donor_id, survivor_id)

    db.flush()
    return RepairReport(
        dry_run=False,
        matches_merged=len(match_merges),
        teams_merged=len(team_merges),
        survivor_match_ids=tuple(survivor_ids),
        removed_match_ids=tuple(removed_ids),
    )


def repair_fixture_duplicates(
    db: Session, *, apply: bool = False,
) -> RepairReport:
    """Repair only proven cutover duplicates; dry-run and roll back by default."""
    team_merges = _team_merges(db)
    match_merges = _match_merges(db, team_merges)
    nested = db.begin_nested() if not apply else None
    try:
        report = _apply_repair(db, team_merges, match_merges)
        if apply:
            db.commit()
            return report
        assert nested is not None
        nested.rollback()
        db.expire_all()
        return RepairReport(**{**asdict(report), "dry_run": True})
    except (IntegrityError, DuplicateRepairError) as exc:
        if nested is not None and nested.is_active:
            nested.rollback()
        else:
            db.rollback()
        db.expire_all()
        if isinstance(exc, DuplicateRepairError):
            raise
        raise DuplicateRepairError(
            "dependent rows cannot be safely reparented"
        ) from exc
    except Exception:
        if nested is not None and nested.is_active:
            nested.rollback()
        else:
            db.rollback()
        db.expire_all()
        raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args(argv)
    with SessionLocal() as db:
        report = repair_fixture_duplicates(db, apply=args.apply)
    print(json.dumps(asdict(report), sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
