"""Elo rating replayed over UFC history (pure math, no I/O).

Differences from the football/NRL Elo: no home advantage (a/b is just listing
order), a constant K, and bouts sharing a start time are one batch: each is
scored from the ratings before the batch and a fighter's updates are summed, so
the replay never depends on the order of simultaneous bouts. Idle fighters decay
toward the starting rating (`decay` per year; 0 disables it).
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Sequence

from ml.sports.ufc.history import BoutRecord, History, batches


@dataclass(frozen=True)
class EloParams:
    version: str = "ufc-elo-v0.1"
    k: float = 60.0
    history_from: int = 2016
    decay: float = 0.0
    scale: float = 400.0
    start: float = 1500.0


def win_prob(r_a: float, r_b: float, scale: float = 400.0) -> float:
    return 1.0 / (1.0 + 10.0 ** (-(r_a - r_b) / scale))


def _score(b: BoutRecord) -> float | None:
    """Actual result for fighter a, or None when the bout changes nothing."""
    if b.winner == "a":
        return 1.0
    if b.winner == "b":
        return 0.0
    if b.method == "draw":
        return 0.5
    return None


class EloState:
    def __init__(self, params: EloParams) -> None:
        self.params = params
        self._ratings: dict[int, float] = {}
        self._last: dict[int, datetime] = {}

    def rating(self, fighter_id: int, at: datetime) -> float:
        """Stored rating decayed toward `start` for the time idle until `at`."""
        p = self.params
        if fighter_id not in self._ratings:
            return p.start
        stored = self._ratings[fighter_id]
        if p.decay == 0.0:
            return stored
        years = max(0.0, (at - self._last[fighter_id]).total_seconds() / 86400.0 / 365.25)
        return p.start + (stored - p.start) * (1.0 - p.decay) ** years

    def fighters(self) -> list[int]:
        return list(self._ratings)

    def apply(self, batch: Sequence[BoutRecord]) -> None:
        """Apply one batch of bouts sharing a `when`, scored from pre-batch ratings."""
        p = self.params
        if not batch:
            return
        when = batch[0].when
        pre: dict[int, float] = {}
        delta: dict[int, float] = {}
        for b in batch:
            s = _score(b)
            if when.year < p.history_from or s is None:
                continue
            ra = pre.setdefault(b.fighter_a, self.rating(b.fighter_a, when))
            rb = pre.setdefault(b.fighter_b, self.rating(b.fighter_b, when))
            pa = win_prob(ra, rb, p.scale)
            delta[b.fighter_a] = delta.get(b.fighter_a, 0.0) + p.k * (s - pa)
            delta[b.fighter_b] = delta.get(b.fighter_b, 0.0) + p.k * ((1.0 - s) - (1.0 - pa))
        for f, d in delta.items():
            self._ratings[f] = pre[f] + d
            self._last[f] = when


def elo_probs(history: History, params: EloParams) -> dict[int, float]:
    """Pre-bout P(a wins) for every finished bout."""
    state = EloState(params)
    out: dict[int, float] = {}
    for batch in batches(history.bouts):
        for b in batch:
            out[b.bout_id] = win_prob(
                state.rating(b.fighter_a, b.when), state.rating(b.fighter_b, b.when), params.scale
            )
        state.apply(batch)
    return out


def final_ratings(history: History, params: EloParams, at: datetime) -> dict[int, float]:
    """Ratings at `at` for fighters with at least one applied bout."""
    state = EloState(params)
    for batch in batches(history.bouts):
        state.apply(batch)
    return {f: state.rating(f, at) for f in state.fighters()}
