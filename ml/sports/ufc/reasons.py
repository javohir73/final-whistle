"""Plain-English reasons for a prediction, from fixed templates.

The model's logit is a sum of per-feature contributions. Features are grouped
into ten human factors; the groups that push hardest toward the predicted winner
are rendered with fixed sentence templates (no generated prose). These sentences
are public copy about real people, so a template is skipped whenever the fact it
states is not supported by the data: a missing value is never "younger" or
"shorter", a factor the model counts against the winner is never selected, and a
difference that rounds to zero is not reported.
"""
from __future__ import annotations

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Callable, Mapping

from ml.sports.ufc.features import FighterFacts, Snapshot

log = logging.getLogger(__name__)

GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("rating", ("elo_diff", "elo_diff_x_five", "elo_diff_x_womens")),
    ("age", ("age_diff", "age_missing")),
    ("reach", ("reach_diff", "reach_missing")),
    ("height", ("height_diff", "height_missing")),
    ("activity", ("layoff_diff", "debut")),
    ("experience", ("fights_diff",)),
    ("form", ("win3_diff", "win5_diff", "form_missing")),
    ("finishing", ("finish_diff", "finish_missing")),
    ("striking", ("sig_str_diff", "stats_missing")),
    ("wrestling", ("td_diff",)),
)
MIN_CONTRIBUTION = 0.05  # logit units
MAX_REASONS = 3
ELO_MIN_EDGE = 0.01
LONG_LAYOFF_DAYS = 365

_WORDS = ("zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten")


def _num(n: int) -> str:
    return _WORDS[n] if 1 <= n <= 10 else str(n)


def _round(x: float) -> int:
    """Round half up (not banker's) for non-negative values."""
    return int(x + 0.5)


def _one_decimal(x: float) -> str:
    return str(Decimal(repr(x)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def _plural(n: int, one: str, many: str) -> str:
    return one if n == 1 else many


# Each template gets (winner and loser names, winner facts, loser facts)
# and returns a sentence, or None when its condition fails.
Render = Callable[[str, str, FighterFacts, FighterFacts], "str | None"]


def _rating(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    rw, rl = _round(fw.rating), _round(fl.rating)
    if fw.rating > fl.rating and rw > rl:
        return f"{w} is rated higher, {rw} to {rl}."
    return None


def _age(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if fw.age_years is None or fl.age_years is None:
        return None
    n = _round(abs(fw.age_years - fl.age_years))
    if n == 0:
        return None
    word = "younger" if fw.age_years < fl.age_years else "older"
    return f"{w} is {_num(n)} {_plural(n, 'year', 'years')} {word}."


def _reach(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if fw.reach_in is None or fl.reach_in is None or fw.reach_in <= fl.reach_in:
        return None
    n = _round(fw.reach_in - fl.reach_in)
    return f"{w} has a {_num(n)}-inch reach advantage." if n else None


def _height(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if fw.height_in is None or fl.height_in is None or fw.height_in <= fl.height_in:
        return None
    n = _round(fw.height_in - fl.height_in)
    return f"{w} is {_num(n)} {_plural(n, 'inch', 'inches')} taller." if n else None


def _activity(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if fl.layoff_days is None:
        return f"{l} is making a UFC debut." if fw.layoff_days is not None else None
    if fw.layoff_days is None or fw.layoff_days >= fl.layoff_days:
        return None  # a layoff the winner shares or exceeds is not support
    if fl.layoff_days >= LONG_LAYOFF_DAYS:
        return f"{l} has not fought in the UFC for {fl.layoff_days // 30} months."
    return f"{w} has fought more recently."


def _experience(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if fw.ufc_fights > fl.ufc_fights:
        return f"{w} has {fw.ufc_fights} UFC fights to {l}'s {fl.ufc_fights}."
    return None


def _rate(t: tuple[int, int] | None) -> float | None:
    return None if t is None else t[0] / t[1]


def _ahead(w: float | None, l: float | None) -> bool:
    return w is not None and (l is None or w > l)


def _form(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if not _ahead(_rate(fw.wins5), _rate(fl.wins5)):
        return None
    k, n = fw.wins5
    if k == 0 or n < 2:  # never "won 0 of"; "their last one fights" is not worth claiming
        return None
    return f"{w} has won {_num(k)} of their last {_num(n)} UFC fights."


def _finishing(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if not _ahead(fw.finish_rate, fl.finish_rate):
        return None
    pct = _round(fw.finish_rate * 100)
    return f"{w} has finished {pct}% of their UFC wins." if pct else None


def _positive_ahead(w: float | None, l: float | None) -> bool:
    return w is not None and w > 0 and (l is None or w > l)


def _striking(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if not _positive_ahead(fw.sig_str_pm, fl.sig_str_pm) or _one_decimal(fw.sig_str_pm) == "0.0":
        return None
    return f"{w} lands {_one_decimal(fw.sig_str_pm)} more significant strikes a minute than they absorb."


def _wrestling(w: str, l: str, fw: FighterFacts, fl: FighterFacts) -> str | None:
    if not _positive_ahead(fw.td_p15, fl.td_p15) or _one_decimal(fw.td_p15) == "0.0":
        return None
    return f"{w} averages {_one_decimal(fw.td_p15)} more takedowns than they concede per 15 minutes."


_RENDER: dict[str, Render] = {
    "rating": _rating, "age": _age, "reach": _reach, "height": _height,
    "activity": _activity, "experience": _experience, "form": _form,
    "finishing": _finishing, "striking": _striking, "wrestling": _wrestling,
}


def _sides(name_a: str, name_b: str, snap: Snapshot, p_a: float):
    """(sign, winner name, loser name, winner facts, loser facts), or None for no call.

    Names are used exactly as stored: surnames cannot be told from given names reliably.
    """
    if p_a == 0.5 or "TBA" in (name_a.strip().upper(), name_b.strip().upper()):
        return None
    if p_a > 0.5:
        return 1, name_a, name_b, snap.a, snap.b
    return -1, name_b, name_a, snap.b, snap.a


def form_reasons(
    name_a: str, name_b: str, snap: Snapshot, contribs: Mapping[str, float], p_a: float
) -> list[str]:
    """Up to three sentences for the groups that most favour the predicted winner."""
    sides = _sides(name_a, name_b, snap, p_a)
    if sides is None:
        return []
    sign, w, l, fw, fl = sides
    scored = [
        (sign * sum(contribs.get(f, 0.0) for f in feats), name)
        for name, feats in GROUPS
    ]
    ranked = sorted((s for s in scored if s[0] > MIN_CONTRIBUTION), key=lambda s: -s[0])  # stable: ties keep GROUPS order
    out: list[str] = []
    for _, group in ranked:
        sentence = _RENDER[group](w, l, fw, fl)
        if sentence:
            out.append(sentence)
            if len(out) == MAX_REASONS:
                break
    return out


def elo_reasons(name_a: str, name_b: str, snap: Snapshot, p_a: float) -> list[str]:
    """The rating sentence for the Elo call, when the call is not a near coin flip."""
    sides = _sides(name_a, name_b, snap, p_a)
    if sides is None or abs(p_a - 0.5) < ELO_MIN_EDGE:
        return []
    _, w, l, fw, fl = sides
    sentence = _rating(w, l, fw, fl)
    return [sentence] if sentence else []
