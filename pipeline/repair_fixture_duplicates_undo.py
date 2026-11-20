"""Reverse an applied fixture-duplicate repair from its evidence file alone.

Only for the same window as the apply: writers still paused, nothing run
since. It refuses, with nothing written, unless the database is exactly in
the state the repair left it in:

- every row it would re-create is absent;
- every survivor fixture, re-pointed row and corrected history row still
  has exactly the content the repair gave it (checked against the evidence;
  a pick edited, a prediction pruned or a match finished since is drift);
- the learning-chain watermark is the value the repair set;
- no row was written after the repair onto a survivor fixture or an
  original club (new picks, predictions, grades, history, ...), detected by
  ids above the highest id the repair saw in each affected table.

Drift is listed as table, id and (where known) column, never values. There
is deliberately no override: after the writers have resumed, the choices are
a restore from the backup (loses everything since the dump) or a forward fix.

The reversal itself runs in one transaction with the repair's lock,
statement and idle timeouts, set-based (a handful of statements per table),
and every statement's row count must equal the plan or everything rolls back:

1. merged clubs are re-inserted;
2. each survivor gets its pre-merge row back, then the merged-away fixtures
   are re-inserted;
3. every re-pointed row points back to its old value (updated_at untouched);
4. every other deleted row is re-inserted, parents first;
5. corrected history rows get their old values; the watermark is restored.

Without ``--confirm-database`` it only verifies and reports.
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, datetime
from pathlib import Path

if __name__ == "__main__":  # before app.* is imported (it connects on import)
    from pipeline.repair_cli_guard import install

    install()

from sqlalchemy import (
    JSON,
    Column,
    Date,
    DateTime,
    MetaData,
    Table,
    Text,
    cast,
    insert,
    select,
    text,
    update,
)
from sqlalchemy.orm import Session

import app.models  # noqa: F401  (registers every table on Base.metadata)
from app.db import Base, SessionLocal
from pipeline.repair_fixture_duplicates import (
    _begin,
    _chunks,
    _content_hash,
    _evidence,
    _foreign_key_columns,
    _soft_columns,
    _soft_filter,
    full_select,
    public_error,
)


class UndoRefused(RuntimeError):
    """The database is not in the state the evidence's repair left it in."""


def _coerce(table: Table, row: dict) -> dict:
    """Evidence values back to Python values for the column types (JSON stays
    the raw stored text; it is cast on the way in)."""
    out = {}
    for name, value in row.items():
        column_type = table.c[name].type
        if value is not None and isinstance(column_type, DateTime):
            value = datetime.fromisoformat(value)
        elif value is not None and isinstance(column_type, Date):
            value = date.fromisoformat(value)
        out[name] = value
    return out


def _current(db: Session, table: Table, ids: list[int]) -> dict[int, dict]:
    rows: dict[int, dict] = {}
    for chunk in _chunks(sorted(ids)):
        for row in db.execute(full_select(table).where(table.c.id.in_(chunk))):
            rows[row.id] = dict(row._mapping)
    return rows


def verify(db: Session, report: dict) -> tuple[list[str], dict]:
    """Every check, reads only. Returns (problems, planned row counts)."""
    if report.get("dry_run"):
        raise UndoRefused("this is dry-run evidence; only apply evidence can be undone")
    for key in ("deleted_rows", "moved_rows", "survivors_before", "survivors_after",
                "changed_rows", "max_ids_at_plan", "removed_match_ids", "team_mappings"):
        if key not in report:
            raise UndoRefused(f"the evidence has no {key!r}; it is incomplete or from an "
                              "older version of the tool")
    tables = Base.metadata.tables
    problems: list[str] = []
    planned: dict[str, int] = {}

    removed = list(report["removed_match_ids"])
    if not removed or _current(db, tables["matches"], removed):
        raise UndoRefused("the merged-away fixtures exist (or the evidence lists none): the "
                          "repair this evidence describes is not applied to this database")

    # Rows to re-create must be absent.
    for table_name, entries in sorted(report["deleted_rows"].items()):
        ids = [e["row"]["id"] for e in entries]
        for row_id in sorted(_current(db, tables[table_name], ids)):
            problems.append(f"{table_name} id {row_id}: exists, but the undo would re-create it")
        planned[f"insert {table_name}"] = len(ids)

    # Survivors must look exactly as the repair left them.
    expected = {row["id"]: row for row in report["survivors_after"]}
    current = _current(db, tables["matches"], list(expected))
    for match_id, row in sorted(expected.items()):
        now = current.get(match_id)
        if now is None:
            problems.append(f"matches id {match_id}: survivor fixture is missing")
            continue
        now = _evidence(now)
        for column in sorted(set(row) | set(now)):
            if row.get(column) != now.get(column):
                problems.append(f"matches id {match_id}: {column} changed since the repair")
    planned["restore survivors"] = len(expected)

    # Re-pointed rows: present, still pointing at the new value, unchanged.
    for key, entries in sorted(report["moved_rows"].items()):
        table_name, column = key.split(".", 1)
        current = _current(db, tables[table_name], [e["id"] for e in entries])
        for entry in entries:
            now = current.get(entry["id"])
            if now is None:
                problems.append(f"{table_name} id {entry['id']}: deleted since the repair")
            elif now[column] != entry["new"]:
                problems.append(f"{table_name} id {entry['id']}: {column} changed since the repair")
            elif _content_hash(now) != entry["after_hash"]:
                problems.append(f"{table_name} id {entry['id']}: changed since the repair")
        planned[f"point back {key}"] = len(entries)

    for table_name, entries in sorted(report["changed_rows"].items()):
        current = _current(db, tables[table_name], [e["id"] for e in entries])
        for entry in entries:
            now = current.get(entry["id"])
            if now is None:
                problems.append(f"{table_name} id {entry['id']}: deleted since the repair")
            elif _content_hash(now) != entry["after_hash"]:
                problems.append(f"{table_name} id {entry['id']}: changed since the repair")
        planned[f"restore {table_name}"] = len(entries)

    before = report.get("covered_finished_before")
    delta = report.get("finished_count_delta") or 0
    if before is not None:
        status = tables["learning_chain_status"]
        now = db.execute(select(status.c.covered_finished).where(status.c.id == 1)).scalar()
        if now != (max(0, before + delta) if delta else before):
            problems.append("learning_chain_status id 1: covered_finished changed since the repair")
        planned["restore learning_chain_status"] = 1

    # Nothing written after the repair onto a survivor fixture or an original club.
    survivors = sorted(expected)
    clubs = sorted({t["survivor_team_id"] for t in report["team_mappings"]})
    max_ids = report["max_ids_at_plan"]
    for target, ids, what in (("matches.id", survivors, "a survivor fixture"),
                              ("teams.id", clubs, "an original club")):
        if not ids:
            continue
        refs = [(t, c, False) for t, c in _foreign_key_columns(target)]
        refs += [(t, c, True) for t, c in _soft_columns(target)]
        for table, column, soft in refs:
            if table.name not in max_ids:
                continue
            query = select(table.c.id).where(column.in_(ids))
            if max_ids[table.name] is not None:
                query = query.where(table.c.id > max_ids[table.name])
            if soft:
                query = query.where(_soft_filter(table))
            for (row_id,) in db.execute(query.order_by(table.c.id).limit(20)):
                problems.append(f"{table.name} id {row_id}: written after the repair onto {what}")
    return problems, planned


def _temp(db: Session, table: Table, rows: list[dict], name: str) -> Table:
    names = sorted(rows[0])
    is_json = {n for n in names if isinstance(table.c[n].type, JSON)}
    temp = Table(name, MetaData(), *[
        Column(n, Text if n in is_json else table.c[n].type, primary_key=(n == "id"))
        for n in names], prefixes=["TEMPORARY"])
    temp.create(db.connection())
    db.execute(insert(temp), [_coerce(table, row) for row in rows])
    return temp


def _value(db: Session, table: Table, temp: Table, name: str):
    if isinstance(table.c[name].type, JSON) and db.get_bind().dialect.name == "postgresql":
        return cast(temp.c[name], table.c[name].type)
    return temp.c[name]


def _keep_onupdate(table: Table, names) -> dict:
    return {c.name: table.c[c.name] for c in table.columns
            if c.onupdate is not None and c.name not in names}


def _insert_rows(db: Session, table: Table, rows: list[dict]) -> int:
    if not rows:
        return 0
    temp = _temp(db, table, rows, f"_undo_insert_{table.name}")
    names = sorted(rows[0])
    result = db.execute(insert(table).from_select(
        names, select(*[_value(db, table, temp, n) for n in names])))
    temp.drop(db.connection())
    return result.rowcount


def _update_rows(db: Session, table: Table, rows: list[dict], name: str) -> int:
    if not rows:
        return 0
    temp = _temp(db, table, rows, name)
    names = [n for n in sorted(rows[0]) if n != "id"]
    result = db.execute(update(table).where(table.c.id == temp.c.id).values(
        {n: _value(db, table, temp, n) for n in names} | _keep_onupdate(table, names)))
    temp.drop(db.connection())
    return result.rowcount


def undo_from_evidence(db: Session, evidence: dict) -> dict:
    """Verify, then reverse inside the caller's transaction (no commit).
    Raises UndoRefused on any drift or count mismatch; the caller rolls back."""
    report = evidence["report"]
    problems, planned = verify(db, report)
    if problems:
        raise UndoRefused(f"{len(problems)} row(s) differ from the state the repair left; "
                          "nothing was written:\n  " + "\n  ".join(problems[:200]))
    tables = Base.metadata.tables
    done: dict[str, int] = {}
    deleted = {name: [e["row"] for e in entries]
               for name, entries in report["deleted_rows"].items()}

    done["insert teams"] = _insert_rows(db, tables["teams"], deleted.get("teams", []))
    done["restore survivors"] = _update_rows(db, tables["matches"], report["survivors_before"],
                                             "_undo_survivors")
    done["insert matches"] = _insert_rows(db, tables["matches"], deleted.get("matches", []))
    for key, entries in sorted(report["moved_rows"].items()):
        table_name, column = key.split(".", 1)
        table = tables[table_name]
        temp = _temp(db, table, [{"id": e["id"], column: e["old"]} for e in entries],
                     f"_undo_point_back_{table_name}")
        result = db.execute(update(table).where(
            table.c.id == temp.c.id,
            table.c[column].in_(sorted({e["new"] for e in entries})),
        ).values({column: temp.c[column]} | _keep_onupdate(table, [column])))
        temp.drop(db.connection())
        done[f"point back {key}"] = result.rowcount
    for table in Base.metadata.sorted_tables:
        if table.name not in {"teams", "matches"} and table.name in deleted:
            done[f"insert {table.name}"] = _insert_rows(db, table, deleted[table.name])
    for table_name, entries in sorted(report["changed_rows"].items()):
        done[f"restore {table_name}"] = _update_rows(
            db, tables[table_name], [{"id": e["id"], **e["old"]} for e in entries],
            f"_undo_restore_{table_name}")
    if report.get("covered_finished_before") is not None:
        status = tables["learning_chain_status"]
        done["restore learning_chain_status"] = db.execute(
            update(status).where(status.c.id == 1)
            .values(covered_finished=report["covered_finished_before"])).rowcount

    wrong = {k: (planned.get(k), v) for k, v in done.items() if planned.get(k, 0) != v}
    wrong.update({k: (p, 0) for k, p in planned.items() if p and k not in done})
    if wrong:
        raise UndoRefused("statement row counts differ from the plan: "
                          + ", ".join(f"{k}: planned {p}, did {d}"
                                      for k, (p, d) in sorted(wrong.items())))
    return done


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
    try:
        evidence = json.loads(Path(args.evidence_file).read_text())
        if not isinstance(evidence.get("report"), dict):
            raise ValueError("no report")
    except (OSError, ValueError, AttributeError) as exc:
        print(f"REFUSED: cannot read the evidence file ({type(exc).__name__})", file=sys.stderr)
        return 2
    try:
        with SessionLocal() as db:
            _begin(db)
            name = _database_name(db)
            if args.confirm_database is None:
                problems, planned = verify(db, evidence["report"])
                db.rollback()
                if problems:
                    print(f"REFUSED: {len(problems)} row(s) differ from the state the repair "
                          "left:", file=sys.stderr)
                    for problem in problems[:200]:
                        print(f"  {problem}", file=sys.stderr)
                    return 2
                print(json.dumps(planned, indent=2, sort_keys=True))
                print(f"database consistent with the evidence; nothing written. To undo: "
                      f"--confirm-database {name}")
                return 0
            if args.confirm_database != name:
                print(f"REFUSED: connected to database {name!r}, not "
                      f"{args.confirm_database!r}", file=sys.stderr)
                return 2
            done = undo_from_evidence(db, evidence)
            db.commit()
    except UndoRefused as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("INTERRUPTED: nothing was committed", file=sys.stderr)
        return 130
    except Exception as exc:  # noqa: BLE001 - sanitised
        print(f"REFUSED: {public_error(exc)}; nothing was committed", file=sys.stderr)
        return 2
    print(json.dumps(done, indent=2, sort_keys=True))
    print("undo committed; every statement touched exactly the planned rows")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
