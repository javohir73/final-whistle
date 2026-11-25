"""Leak-free, antisymmetric model features for a UFC bout.

A bout's snapshot is built only from finished bouts that started strictly
earlier: bouts are walked in batches of equal `when`, every bout in a batch is
snapshotted from the state before the batch, and only then do the batch's
finished bouts update Elo and each fighter's prior-bout list. Fighter "a"/"b" is
just listing order, so every feature is a difference (a - b) or a missing-value
indicator (m_b - m_a): swapping the sides negates the whole vector.
"""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime
from typing import Mapping, Sequence

from ml.sports.ufc.elo import EloParams, EloState, win_prob
from ml.sports.ufc.history import BoutRecord, History, batches, fight_minutes, order_key

log = logging.getLogger(__name__)

FEATURES: tuple[str, ...] = (
    "elo_diff", "elo_diff_x_five", "elo_diff_x_womens",
    "age_diff", "age_missing", "reach_diff", "reach_missing", "height_diff", "height_missing",
    "layoff_diff", "debut", "fights_diff",
    "win3_diff", "win5_diff", "form_missing", "finish_diff", "finish_missing",
    "sig_str_diff", "td_diff", "stats_missing",
)
LAYOFF_CAP_DAYS = 1095


@dataclass(frozen=True)
class FighterFacts:
    rating: float
    age_years: float | None
    reach_in: float | None
    height_in: float | None
    layoff_days: int | None
    ufc_fights: int
    wins3: tuple[int, int] | None  # (won, of) over the latest 3 decided bouts
    wins5: tuple[int, int] | None
    finish_rate: float | None
    sig_str_pm: float | None
    td_p15: float | None


@dataclass(frozen=True)
class Snapshot:
    bout_id: int
    when: datetime
    p_elo: float
    x: Mapping[str, float]
    a: FighterFacts
    b: FighterFacts


@dataclass(frozen=True)
class _Prior:
    """One finished bout from a single fighter's point of view."""
    when: datetime
    result: str | None  # "w" | "l" | None (draw / no contest)
    method: str | None
    own_sig: int | None
    own_td: int | None
    opp_sig: int | None
    opp_td: int | None
    minutes: float | None


def _prior(b: BoutRecord, side: str) -> _Prior:
    own, opp = (b.stats_a, b.stats_b) if side == "a" else (b.stats_b, b.stats_a)
    result = None if b.winner is None else ("w" if b.winner == side else "l")
    return _Prior(
        b.when, result, b.method,
        own.sig_landed if own else None, own.td_landed if own else None,
        opp.sig_landed if opp else None, opp.td_landed if opp else None,
        fight_minutes(b),
    )


def _record(prior: _Prior, fighter: int, hist: dict[int, list[_Prior]]) -> None:
    hist.setdefault(fighter, []).append(prior)


def _form(priors: list[_Prior], n: int) -> tuple[int, int] | None:
    decided = [p for p in priors if p.result is not None][-n:]
    return (sum(p.result == "w" for p in decided), len(decided)) if decided else None


def _facts(info, fighter: int, priors: list[_Prior], when: datetime, rating: float) -> FighterFacts:
    wins = [p for p in priors if p.result == "w"]
    usable = [
        p for p in priors
        if None not in (p.own_sig, p.own_td, p.opp_sig, p.opp_td) and p.minutes is not None and p.minutes > 0
    ]
    minutes = sum(p.minutes for p in usable)
    dob = info.date_of_birth if info else None
    return FighterFacts(
        rating=rating,
        age_years=(when.date() - dob).days / 365.25 if dob else None,
        reach_in=info.reach_in if info else None,
        height_in=info.height_in if info else None,
        layoff_days=(when - priors[-1].when).days if priors else None,
        ufc_fights=len(priors),
        wins3=_form(priors, 3),
        wins5=_form(priors, 5),
        finish_rate=(sum(p.method in ("ko_tko", "submission") for p in wins) / len(wins)) if wins else None,
        sig_str_pm=sum(p.own_sig - p.opp_sig for p in usable) / minutes if usable else None,
        td_p15=15 * sum(p.own_td - p.opp_td for p in usable) / minutes if usable else None,
    )


def _diff(va: float | None, vb: float | None) -> float:
    return 0.0 if va is None or vb is None else va - vb


def _missing(va: object, vb: object) -> float:
    return float(vb is None) - float(va is None)


def _ratio(w: tuple[int, int] | None) -> float | None:
    return None if w is None else w[0] / w[1]


def _layoff(days: int | None) -> float | None:
    return None if days is None else math.log1p(min(days, LAYOFF_CAP_DAYS))


def _features(b: BoutRecord, fa: FighterFacts, fb: FighterFacts) -> dict[str, float]:
    elo = fa.rating - fb.rating
    form_a, form_b = fa.wins3, fb.wins3  # wins3 is missing exactly when wins5 is
    stats_a, stats_b = fa.sig_str_pm, fb.sig_str_pm
    x = {
        "elo_diff": elo,
        "elo_diff_x_five": elo if b.scheduled_rounds == 5 else 0.0,
        "elo_diff_x_womens": elo if (b.weight_class or "").lower().startswith("women") else 0.0,
        "age_diff": _diff(fa.age_years, fb.age_years),
        "age_missing": _missing(fa.age_years, fb.age_years),
        "reach_diff": _diff(fa.reach_in, fb.reach_in),
        "reach_missing": _missing(fa.reach_in, fb.reach_in),
        "height_diff": _diff(fa.height_in, fb.height_in),
        "height_missing": _missing(fa.height_in, fb.height_in),
        "layoff_diff": _diff(_layoff(fa.layoff_days), _layoff(fb.layoff_days)),
        "debut": _missing(fa.layoff_days, fb.layoff_days),
        "fights_diff": math.log1p(fa.ufc_fights) - math.log1p(fb.ufc_fights),
        "win3_diff": _diff(_ratio(fa.wins3), _ratio(fb.wins3)),
        "win5_diff": _diff(_ratio(fa.wins5), _ratio(fb.wins5)),
        "form_missing": _missing(form_a, form_b),
        "finish_diff": _diff(fa.finish_rate, fb.finish_rate),
        "finish_missing": _missing(fa.finish_rate, fb.finish_rate),
        "sig_str_diff": _diff(stats_a, stats_b),
        "td_diff": _diff(fa.td_p15, fb.td_p15),
        "stats_missing": _missing(stats_a, stats_b),
    }
    return x


def snapshots(history: History, elo: EloParams, targets: Sequence[BoutRecord] = ()) -> dict[int, Snapshot]:
    """Snapshot of every finished bout and every target, keyed by bout_id."""
    finished_ids = {b.bout_id for b in history.bouts}
    merged = sorted([*history.bouts, *targets], key=order_key)
    state = EloState(elo)
    priors: dict[int, list[_Prior]] = {}
    out: dict[int, Snapshot] = {}
    for batch in batches(merged):
        when = batch[0].when
        for b in batch:
            ra, rb = state.rating(b.fighter_a, when), state.rating(b.fighter_b, when)
            fa = _facts(history.fighters.get(b.fighter_a), b.fighter_a, priors.get(b.fighter_a, []), when, ra)
            fb = _facts(history.fighters.get(b.fighter_b), b.fighter_b, priors.get(b.fighter_b, []), when, rb)
            out[b.bout_id] = Snapshot(b.bout_id, when, win_prob(ra, rb, elo.scale), _features(b, fa, fb), fa, fb)
        done = [b for b in batch if b.bout_id in finished_ids and b.finished]
        state.apply(done)
        for b in done:
            _record(_prior(b, "a"), b.fighter_a, priors)
            _record(_prior(b, "b"), b.fighter_b, priors)
    return out


def flip(s: Snapshot) -> Snapshot:
    """The same bout with fighters a and b swapped."""
    return Snapshot(s.bout_id, s.when, 1.0 - s.p_elo, {k: -v for k, v in s.x.items()}, s.b, s.a)
