"""The model's call on a UFC bout. The only module that builds a `UfcModelCallOut`.

`calls_for` has no reveal rule: callers apply one. `public_calls` is the rule for
everyone (the cacheable public endpoints); the picks router applies the per-player
rule on top of `calls_for`. The public version is the `ufc_public_model` setting alone
(`is_shadow` is not read)."""
from __future__ import annotations

import re
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session, load_only

from app.config import settings
from app.models import UfcBout, UfcPrediction
from app.schemas import UfcModelCallOut
from app.ufc_rules import call_is_public, lock_expr, model_pick

_RATING_REASON = re.compile(r"^(?P<w>.+) is rated higher, (?P<rw>\d+) to (?P<rl>\d+)\.$")


def public_version() -> str | None:
    return settings.ufc_public_model.strip() or None


def counting_predictions(db: Session, bout_ids: list[int], version: str) -> dict[int, UfcPrediction]:
    """Per bout, the latest prediction of `version` made at or before the lock (one query)."""
    if not bout_ids:
        return {}
    ranked = (
        select(
            UfcPrediction.id.label("prediction_id"),
            func.row_number()
            .over(partition_by=UfcPrediction.bout_id,
                  order_by=(UfcPrediction.created_at.desc(), UfcPrediction.id.desc()))
            .label("row_number"),
        )
        .join(UfcBout, UfcPrediction.bout_id == UfcBout.id)
        .where(
            UfcPrediction.bout_id.in_(bout_ids),
            UfcPrediction.model_version == version,
            UfcPrediction.created_at <= lock_expr(),  # NULL lock: never true
        )
        .subquery()
    )
    preds = (
        db.query(UfcPrediction)
        .options(load_only(UfcPrediction.bout_id, UfcPrediction.model_version, UfcPrediction.p_a,
                           UfcPrediction.p_b, UfcPrediction.method_probs, UfcPrediction.reasons))
        .join(ranked, UfcPrediction.id == ranked.c.prediction_id)
        .filter(ranked.c.row_number == 1)
        .all()
    )
    return {p.bout_id: p for p in preds}


def reword_reason(text: str) -> str:
    m = _RATING_REASON.match(text)
    if m is None:
        return text
    return f"{m['w']} is ahead on FinalWhistle's own fighter rating, {m['rw']} to {m['rl']}."


def call_out(pred: UfcPrediction) -> UfcModelCallOut:
    winner, method = model_pick(pred.p_a, pred.method_probs)
    return UfcModelCallOut(
        model_version=pred.model_version,
        winner=winner,
        p_a=pred.p_a,
        p_b=pred.p_b,
        method=method,
        method_probs=pred.method_probs,
        reasons=[reword_reason(r) for r in (pred.reasons or []) if isinstance(r, str)],
    )


def calls_for(db: Session, bouts: list[UfcBout]) -> dict[int, UfcModelCallOut]:
    """Every bout with a counting row of the public version. No reveal rule."""
    version = public_version()
    if version is None or not bouts:
        return {}
    preds = counting_predictions(db, [b.id for b in bouts], version)
    return {bid: call_out(p) for bid, p in preds.items()}


def public_calls(
    db: Session, bouts: list[UfcBout], names: dict[int, str], now: datetime
) -> dict[int, UfcModelCallOut]:
    """`calls_for`, kept only where the call is public for everyone. `names` maps fighter id to name."""
    if public_version() is None:
        return {}
    shown = [b for b in bouts
             if call_is_public(b, names.get(b.fighter_a_id), names.get(b.fighter_b_id), now)]
    return calls_for(db, shown)
