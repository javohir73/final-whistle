"""Reverse an applied fixture-duplicate repair from its evidence file alone.

The evidence written by ``pipeline.repair_fixture_duplicates --apply`` holds
every deleted row in full (JSON columns as their raw stored text, so a JSON
null and an SQL NULL stay distinct), every re-pointed row (old -> new), each
survivor's row before the merge, every history row corrected in place and the
old learning-chain watermark. This puts all of it back in one transaction:

1. merged clubs are re-inserted;
2. each survivor gets its pre-merge row back (freeing the football-data
   fixture id), then the merged-away fixtures are re-inserted;
3. every re-pointed row points back to its old value (updated_at untouched);
4. every other deleted row is re-inserted, parents first;
5. corrected history rows get their old values; the watermark is restored.

Rows written after the repair are kept; one that now collides with a row
being restored (for example a new pick on a restored fixture) makes the whole
undo refuse with nothing written. Without ``--confirm-database`` it only
reports what it would do.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

from sqlalchemy import Date, DateTime, insert, select, text, update
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base, SessionLocal
from pipeline.repair_fixture_duplicates import _begin, json_param, public_error


class UndoRefused(RuntimeError):
    """The evidence does not describe an applied repair of this database."""


def _typed(db: Session, table, row: dict) -> dict:
    out = {}
    for name, value in row.items():
        column = table.c[name]
        if value is not None and isinstance(column.type, DateTime):
            value = datetime.fromisoformat(value)
        elif value is not None and isinstance(column.type, Date):
            value = date.fromisoformat(value)
        out[name] = json_param(db, column, value)
    return out


def _counts(report: dict) -> dict:
    return {
        "rows_to_reinsert": {t: len(rows) for t, rows in sorted(report["deleted_rows"].items())},
        "rows_to_point_back": {k: len(rows) for k, rows in sorted(report["moved_rows"].items())},
        "survivors_to_restore": len(report["survivors_before"]),
        "rows_to_restore_in_place": {t: len(r) for t, r in sorted(report["changed_rows"].items())},
        "covered_finished_before": report["covered_finished_before"],
    }


def _check_applied(db: Session, report: dict) -> None:
    if report.get("dry_run"):
        raise UndoRefused("this is dry-run evidence; only apply evidence can be undone")
    matches = Base.metadata.tables["matches"]
    removed = list(report.get("removed_match_ids") or [])
    if removed:
        present = db.execute(select(matches.c.id).where(
            matches.c.id.in_(removed)).limit(1)).first()
        if present is not None:
            raise UndoRefused(
                "merged-away fixtures still exist: the repair this evidence describes "
                "is not applied to this database")


def undo_from_evidence(db: Session, evidence: dict) -> dict:
    """Apply the reversal inside the caller's transaction (no commit)."""
    report = evidence["report"]
    tables = Base.metadata.tables
    _check_applied(db, report)

    def insert_deleted(table) -> None:
        for entry in report["deleted_rows"].get(table.name, []):
            db.execute(insert(table).values(_typed(db, table, entry["row"])))

    insert_deleted(tables["teams"])
    matches = tables["matches"]
    for row in report["survivors_before"]:
        db.execute(update(matches).where(matches.c.id == row["id"])
                   .values(_typed(db, matches, row)))
    insert_deleted(matches)
    for key, rows in report["moved_rows"].items():
        table_name, column = key.split(".")
        table = tables[table_name]
        guard = {c.name: table.c[c.name] for c in table.columns
                 if c.onupdate is not None and c.name != column}
        for row in rows:
            db.execute(update(table).where(table.c.id == row["id"])
                       .values({column: row["old"], **guard}))
    for table in Base.metadata.sorted_tables:
        if table.name not in {"teams", "matches"}:
            insert_deleted(table)
    for table_name, rows in report["changed_rows"].items():
        table = tables[table_name]
        for row in rows:
            db.execute(update(table).where(table.c.id == row["id"])
                       .values(_typed(db, table, row["old"])))
    if report["covered_finished_before"] is not None:
        status = tables["learning_chain_status"]
        db.execute(update(status).where(status.c.id == 1)
                   .values(covered_finished=report["covered_finished_before"]))
    return _counts(report)


def _database_name(db: Session) -> str:
    bind = db.get_bind()
    if bind.dialect.name == "postgresql":
        return db.execute(text("select current_database()")).scalar()
    return Path(bind.url.database or "").name


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--evidence-file", required=True)
    parser.add_argument("--confirm-database", default=None,
                        help="the target database's name; without it nothing is written")
    args = parser.parse_args(argv)
    evidence = json.loads(Path(args.evidence_file).read_text())
    try:
        with SessionLocal() as db:
            _begin(db)
            name = _database_name(db)
            if args.confirm_database is None:
                _check_applied(db, evidence["report"])
                print(json.dumps(_counts(evidence["report"]), indent=2, sort_keys=True))
                print(f"nothing written; to undo, add --confirm-database {name}")
                db.rollback()
                return 0
            if args.confirm_database != name:
                print(f"REFUSED: connected to database {name!r}, not "
                      f"{args.confirm_database!r}", file=sys.stderr)
                return 2
            counts = undo_from_evidence(db, evidence)
            db.commit()
    except UndoRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    except Exception as exc:  # noqa: BLE001 - sanitised; logs may be public
        print(f"REFUSED: {public_error(exc)}; nothing was committed", file=sys.stderr)
        return 2
    print(json.dumps(counts, indent=2, sort_keys=True))
    print("undo committed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
