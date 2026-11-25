"""How a fight ends (KO/TKO, submission, decision), by weight class and scheduled rounds.

The picks game pays 5 points for winner and method but 2 for the winner alone, so the
model also names a method. The estimate is each group's observed method shares from a
trailing window of past bouts, shrunk towards the overall shares with a pseudo-count
(`ALPHA`), so a thin group falls back to the overall rate instead of chasing noise.
The probabilities describe how the bout ends given that the predicted winner wins; v0.2
does not condition on the fighters, so both models store the same numbers.

Only finished bouts with a winner and a method in `METHODS` are counted: DQs, draws,
no contests and `other` are not outcomes this model predicts. The caller picks the
window; `[start, end)` is half-open so a bout's own result and later bouts never feed
its estimate when `end` is the bout's scheduled time.
"""
from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable, Mapping

from ml.sports.ufc.history import BoutRecord

log = logging.getLogger(__name__)

METHODS = ("ko_tko", "submission", "decision")
FALLBACK_RATES = {"ko_tko": 0.35, "submission": 0.18, "decision": 0.47}  # 2022-2026 holdout shares
WINDOW_YEARS = 10
ALPHA = 50.0
DEFAULT_ROUNDS = 3
_TIE_ORDER = ("decision", "ko_tko", "submission")
_CATCHWEIGHT = re.compile(r"catch\s*weight")

GroupKey = tuple[str | None, int]


def weight_group(weight_class: str | None) -> str | None:
    if weight_class is None:
        return None
    text = " ".join(weight_class.lower().split())
    if not text:
        return None
    return _CATCHWEIGHT.sub("catch weight", text)


def _key(weight_class: str | None, scheduled_rounds: int | None) -> GroupKey:
    return (weight_group(weight_class), scheduled_rounds or DEFAULT_ROUNDS)


@dataclass(frozen=True)
class MethodTable:
    overall: Mapping[str, float] = field(default_factory=lambda: dict(FALLBACK_RATES))
    counts: Mapping[GroupKey, Mapping[str, int]] = field(default_factory=dict)

    def probs(self, weight_class: str | None, scheduled_rounds: int | None) -> dict[str, float]:
        group_key = _key(weight_class, scheduled_rounds)
        group = self.counts.get(group_key) if group_key[0] is not None else None
        group = group or {}
        n = sum(group.values())
        return {
            m: (group.get(m, 0) + ALPHA * self.overall[m]) / (n + ALPHA) for m in METHODS
        }


def method_table(bouts: Iterable[BoutRecord], start: datetime, end: datetime) -> MethodTable:
    """Table from counted bouts with `start <= when < end`."""
    overall: Counter[str] = Counter()
    groups: dict[GroupKey, Counter[str]] = {}
    for b in bouts:
        if not (b.finished and b.winner is not None and b.method in METHODS):
            continue
        if not (start <= b.when < end):
            continue
        overall[b.method] += 1
        groups.setdefault(_key(b.weight_class, b.scheduled_rounds), Counter())[b.method] += 1
    total = sum(overall.values())
    rates = {m: overall[m] / total for m in METHODS} if total else dict(FALLBACK_RATES)
    return MethodTable(overall=rates, counts={k: dict(v) for k, v in groups.items()})


def method_pick(probs: Mapping[str, float]) -> str:
    """The most likely method; exact ties resolve decision, ko_tko, submission."""
    return max(_TIE_ORDER, key=lambda m: probs[m])
