"""Load finished UFC bouts from the database as an `ml.sports.ufc` History.

Three queries in all (bouts, their stats, the fighters involved). Only bouts
with status "finished", a scheduled time and two distinct fighters are
history; draws and no contests come through with `winner None`. SQLite returns
timezone-aware columns naive, so times pass through `_utc`.
"""
from __future__ import annotations

import logging
from typing import Mapping

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import UfcBout, UfcBoutStat, UfcFighter
from ml.sports.ufc.history import BoutRecord, FighterInfo, History, StatLine, order_key
from pipeline.sports.ufc_ingest import _utc

log = logging.getLogger(__name__)


def _line(stat: UfcBoutStat | None) -> StatLine | None:
    if stat is None:
        return None
    return StatLine(stat.sig_strikes_landed, stat.takedowns_landed)


def to_record(bout: UfcBout, stats: Mapping[int, UfcBoutStat] | None = None) -> BoutRecord:
    """One bout row as a BoutRecord; `stats` maps fighter id to that fighter's stat row."""
    stats = stats or {}
    return BoutRecord(
        bout_id=bout.id,
        when=_utc(bout.scheduled_utc),
        fighter_a=bout.fighter_a_id,
        fighter_b=bout.fighter_b_id,
        winner=bout.winner if bout.winner in ("a", "b") else None,
        method=bout.method,
        weight_class=bout.weight_class,
        scheduled_rounds=bout.scheduled_rounds,
        end_round=bout.end_round,
        end_clock=bout.end_clock,
        stats_a=_line(stats.get(bout.fighter_a_id)),
        stats_b=_line(stats.get(bout.fighter_b_id)),
        finished=bout.status == "finished",
    )


def load_history(db: Session) -> History:
    bouts = db.scalars(
        select(UfcBout).where(
            UfcBout.status == "finished",
            UfcBout.scheduled_utc.is_not(None),
            UfcBout.fighter_a_id != UfcBout.fighter_b_id,
        )
    ).all()
    ids = [b.id for b in bouts]
    stats: dict[int, dict[int, UfcBoutStat]] = {}
    fighter_ids = {f for b in bouts for f in (b.fighter_a_id, b.fighter_b_id)}
    if ids:
        for s in db.scalars(select(UfcBoutStat).where(UfcBoutStat.bout_id.in_(ids))):
            stats.setdefault(s.bout_id, {})[s.fighter_id] = s
    fighters: dict[int, FighterInfo] = {}
    if fighter_ids:
        for f in db.scalars(select(UfcFighter).where(UfcFighter.id.in_(fighter_ids))):
            fighters[f.id] = FighterInfo(f.id, f.name, f.date_of_birth, f.height_in, f.reach_in)
    records = sorted((to_record(b, stats.get(b.id)) for b in bouts), key=order_key)
    log.info("loaded %d finished ufc bouts, %d fighters", len(records), len(fighters))
    return History(bouts=tuple(records), fighters=fighters)
