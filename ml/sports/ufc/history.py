"""Plain-data view of UFC fight history, shared by every UFC model.

The models never see a database row: the pipeline turns `ufc_*` rows into these
frozen records, and tests build them directly with `ml.sports.ufc.testkit`.
Fighter "a"/"b" is the feed's listing order and carries no meaning, so models
must treat the two sides symmetrically. Bouts are ordered by `order_key`; bouts
sharing a `when` form a batch (`batches`) that must not see each other's results.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Iterable, Iterator, Mapping

ROUND_MINUTES = 5.0
_CLOCK = re.compile(r"^\s*(\d+):(\d{1,2})\s*$")


@dataclass(frozen=True)
class StatLine:
    sig_landed: int | None
    td_landed: int | None


@dataclass(frozen=True)
class FighterInfo:
    fighter_id: int
    name: str
    date_of_birth: date | None
    height_in: float | None
    reach_in: float | None


@dataclass(frozen=True)
class BoutRecord:
    bout_id: int
    when: datetime
    fighter_a: int
    fighter_b: int
    winner: str | None  # "a" | "b" | None (draw, no contest, or not yet fought)
    method: str | None
    weight_class: str | None
    scheduled_rounds: int | None
    end_round: int | None
    end_clock: str | None
    stats_a: StatLine | None
    stats_b: StatLine | None
    finished: bool  # False for a bout being predicted


@dataclass(frozen=True)
class History:
    bouts: tuple[BoutRecord, ...]  # finished only, sorted by order_key
    fighters: Mapping[int, FighterInfo]


def order_key(b: BoutRecord) -> tuple[datetime, int]:
    return (b.when, b.bout_id)


def batches(bouts: Iterable[BoutRecord]) -> Iterator[list[BoutRecord]]:
    """Consecutive runs of equal `when`; the input must already be sorted."""
    run: list[BoutRecord] = []
    for b in bouts:
        if run and b.when != run[0].when:
            yield run
            run = []
        run.append(b)
    if run:
        yield run


def fight_minutes(b: BoutRecord) -> float | None:
    """Length of the fight in minutes (rounds taken as five minutes), or None
    when a stoppage lacks a usable round/clock."""
    if b.method == "decision":
        return (b.scheduled_rounds if b.scheduled_rounds is not None else 3) * ROUND_MINUTES
    if b.end_round is None or b.end_clock is None:
        return None
    m = _CLOCK.match(b.end_clock)
    if m is None:
        return None
    return (b.end_round - 1) * ROUND_MINUTES + int(m.group(1)) + int(m.group(2)) / 60
