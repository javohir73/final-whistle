"""Create ufc_* rows from compact rows for tests (a helper, not a test file).

Uses the same row format as `ml.sports.ufc.testkit` (see its docstring) via
`parse_row`. Rows are flushed, not committed.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from typing import Mapping, Sequence

from sqlalchemy.orm import Session

from app.models import UfcBout, UfcBoutStat, UfcEvent, UfcFighter
from ml.sports.ufc.testkit import parse_row
from pipeline.sports.ufc_ingest import slugify


@dataclass
class Built:
    fighters: dict[str, UfcFighter] = field(default_factory=dict)
    bouts: list[UfcBout] = field(default_factory=list)


def build(
    db: Session, rows: Sequence[tuple], fighters: Mapping[str, Mapping] | None = None
) -> Built:
    profiles = fighters or {}
    out = Built()
    events: dict[str, UfcEvent] = {}
    stat_rows: list[tuple[UfcBout, str, tuple | None]] = []

    def fighter(name: str) -> UfcFighter:
        if name not in out.fighters:
            p = profiles.get(name, {})
            n = len(out.fighters) + 1
            f = UfcFighter(
                provider="espn", provider_fighter_id=f"f{n}", name=name, slug=f"{slugify(name)}-{n}",
                date_of_birth=date.fromisoformat(p["dob"]) if p.get("dob") else None,
                height_in=p.get("height"), reach_in=p.get("reach"),
            )
            db.add(f)
            out.fighters[name] = f
        return out.fighters[name]

    for n, row in enumerate(rows, start=1):
        r = parse_row(row)
        ev = events.get(r["event"])
        if ev is None:
            k = len(events) + 1
            ev = UfcEvent(provider="espn", provider_event_id=f"e{k}", name=r["event"],
                          slug=f"{slugify(r['event'])}-{k}")
            db.add(ev)
            events[r["event"]] = ev
        fa, fb = fighter(r["a"]), fighter(r["b"])
        db.flush()
        locked = datetime.fromisoformat(r["locked_at"]) if r["locked_at"] else None
        if locked is not None and locked.tzinfo is None:
            locked = locked.replace(tzinfo=timezone.utc)
        bout = UfcBout(
            event_id=ev.id, provider="espn", provider_bout_id=f"b{n}", revision=0,
            weight_class=r["weight_class"], scheduled_rounds=r["rounds"],
            fighter_a_id=fa.id, fighter_b_id=fb.id, scheduled_utc=r["when"], locked_at=locked,
            status=r["status"], winner=r["winner"], method=r["method"],
            end_round=r["end_round"], end_clock=r["end_clock"],
        )
        db.add(bout)
        out.bouts.append(bout)
        stat_rows.append((bout, r["a"], r["stats_a"]))
        stat_rows.append((bout, r["b"], r["stats_b"]))
    db.flush()
    for bout, name, pair in stat_rows:
        if pair is not None:
            db.add(UfcBoutStat(bout_id=bout.id, fighter_id=out.fighters[name].id,
                               sig_strikes_landed=pair[0], takedowns_landed=pair[1]))
    db.flush()
    return out
