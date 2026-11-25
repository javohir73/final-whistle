"""No-intercept logistic model over the antisymmetric UFC features.

Fighter "a"/"b" is only the feed's listing order, and "a" wins more often than
chance, so the model must not learn that. Every input negates when the sides
swap, there is no intercept, and fitting augments each bout with its mirror
image `(-x, 1 - y)`. The augmented columns are therefore centred by
construction (means are asserted ~0 and stored as 0.0), and prediction only
divides by the scale, never subtracting a mean. Together this gives
`predict_form(-x) == 1 - predict_form(x)` up to float rounding.
"""
from __future__ import annotations

import logging
import math
import warnings
from dataclasses import dataclass
from datetime import date
from typing import Mapping, Sequence

import numpy as np
from sklearn.linear_model import LogisticRegression

from ml.sports.ufc.features import FEATURES

log = logging.getLogger(__name__)

FORM_VERSION = "ufc-form-v0.2"
_MIN_SCALE = 1e-9


@dataclass(frozen=True)
class FormParams:
    version: str
    features: tuple[str, ...]
    weights: tuple[float, ...]
    means: tuple[float, ...]
    scales: tuple[float, ...]
    c: float
    train_from: date
    train_to: date
    fitted_on: date
    n_bouts: int


def contributions(params: FormParams, x: Mapping[str, float]) -> dict[str, float]:
    """Each feature's share of the logit: weight * x / scale."""
    return {
        name: w * x[name] / s
        for name, w, s in zip(params.features, params.weights, params.scales)
    }


def _sigmoid(z: float) -> float:
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    e = math.exp(z)
    return e / (1.0 + e)


def predict_form(params: FormParams, x: Mapping[str, float]) -> float:
    """Probability that fighter a wins."""
    return _sigmoid(sum(contributions(params, x).values()))


def fit_form(
    xs: Sequence[Mapping[str, float]],
    a_won: Sequence[int],
    c: float,
    *,
    train_from: date,
    train_to: date,
    fitted_on: date,
) -> FormParams:
    matrix = np.array([[x[f] for f in FEATURES] for x in xs], dtype=float)
    y = np.asarray(a_won, dtype=int)
    aug_x = np.vstack([matrix, -matrix])
    aug_y = np.concatenate([y, 1 - y])

    means = aug_x.mean(axis=0)
    assert np.all(np.abs(means) < 1e-9), "augmented columns must be centred"
    scales = aug_x.std(axis=0)
    scales = np.where(scales < _MIN_SCALE, 1.0, scales)

    clf = LogisticRegression(fit_intercept=False, C=c, solver="lbfgs", max_iter=2000)
    # numpy's macOS Accelerate matmul raises spurious FP flags (even on clean
    # finite data); the finiteness assert below is the real check.
    # sklearn also passes a solver option this scipy no longer knows.
    with np.errstate(all="ignore"), warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Unknown solver options")
        clf.fit(aug_x / scales, aug_y)
    assert np.all(np.isfinite(clf.coef_)), "fit produced non-finite weights"
    return FormParams(
        version=FORM_VERSION,
        features=FEATURES,
        weights=tuple(float(w) for w in clf.coef_[0]),
        means=tuple(0.0 for _ in FEATURES),
        scales=tuple(float(s) for s in scales),
        c=float(c),
        train_from=train_from,
        train_to=train_to,
        fitted_on=fitted_on,
        n_bouts=len(xs),
    )
