"""Build `History` objects from compact rows for hand-computable tests.

Row format (shared with pipeline.sports.ufc_testkit):
    (when, a_name, b_name, winner, method[, extra])
`when` is "YYYY-MM-DD" (03:00 UTC that day) or "YYYY-MM-DDTHH:MM" (UTC).
`extra` keys, all optional: status, weight_class, rounds, end_round, end_clock,
stats_a / stats_b as (sig_landed, td_landed), event, locked_at.
Fighter ids are 1, 2, ... by first appearance of the name; bout ids 1, 2, ...
by row order. This is a helper, not a test file.
"""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Mapping, Sequence

from ml.sports.ufc.history import BoutRecord, FighterInfo, History, StatLine, order_key


def _when(text: str) -> datetime:
    if "T" in text:
        return datetime.fromisoformat(text).replace(tzinfo=timezone.utc)
    return datetime.fromisoformat(text).replace(hour=3, tzinfo=timezone.utc)


def parse_row(row: Sequence[Any]) -> dict[str, Any]:
    """Normalise a row into a dict with every key filled in."""
    when, a, b, winner, method, *rest = row
    extra: Mapping[str, Any] = rest[0] if rest else {}
    return {
        "when_text": when,
        "when": _when(when),
        "a": a,
        "b": b,
        "winner": winner,
        "method": method,
        "status": extra.get("status", "finished" if (winner or method) else "scheduled"),
        "weight_class": extra.get("weight_class", "Lightweight"),
        "rounds": extra.get("rounds", 3),
        "end_round": extra.get("end_round"),
        "end_clock": extra.get("end_clock"),
        "stats_a": extra.get("stats_a"),
        "stats_b": extra.get("stats_b"),
        "event": extra.get("event", when.split("T")[0]),
        "locked_at": extra.get("locked_at"),
    }


def _stat(pair: tuple | None) -> StatLine | None:
    return None if pair is None else StatLine(pair[0], pair[1])


def history(rows: Sequence[tuple], fighters: Mapping[str, Mapping] | None = None) -> History:
    profiles = fighters or {}
    ids: dict[str, int] = {}
    bouts: list[BoutRecord] = []
    for n, row in enumerate(rows, start=1):
        r = parse_row(row)
        for name in (r["a"], r["b"]):
            ids.setdefault(name, len(ids) + 1)
        bouts.append(BoutRecord(
            bout_id=n, when=r["when"], fighter_a=ids[r["a"]], fighter_b=ids[r["b"]],
            winner=r["winner"], method=r["method"], weight_class=r["weight_class"],
            scheduled_rounds=r["rounds"], end_round=r["end_round"], end_clock=r["end_clock"],
            stats_a=_stat(r["stats_a"]), stats_b=_stat(r["stats_b"]),
            finished=r["status"] == "finished",
        ))
    info = {}
    for name, fid in ids.items():
        p = profiles.get(name, {})
        info[fid] = FighterInfo(
            fighter_id=fid, name=name,
            date_of_birth=date.fromisoformat(p["dob"]) if p.get("dob") else None,
            height_in=float(p["height"]) if p.get("height") is not None else None,
            reach_in=float(p["reach"]) if p.get("reach") is not None else None,
        )
    done = sorted((b for b in bouts if b.finished), key=order_key)
    return History(bouts=tuple(done), fighters=info)
