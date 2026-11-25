from __future__ import annotations

import math
import random
from datetime import date

import pytest

from ml.sports.ufc.features import FEATURES
from ml.sports.ufc.model import FORM_VERSION, FormParams, contributions, fit_form, predict_form

D = date(2024, 1, 1)


def _params(weights, scales) -> FormParams:
    return FormParams(
        version=FORM_VERSION, features=FEATURES, weights=tuple(weights),
        means=tuple(0.0 for _ in FEATURES), scales=tuple(scales), c=1.0,
        train_from=D, train_to=D, fitted_on=D, n_bouts=1,
    )


def _zero() -> dict[str, float]:
    return {f: 0.0 for f in FEATURES}


def test_prediction_is_antisymmetric():
    rng = random.Random(7)
    params = _params([rng.uniform(-2, 2) for _ in FEATURES], [rng.uniform(0.5, 50) for _ in FEATURES])
    for _ in range(50):
        x = {f: rng.uniform(-300, 300) for f in FEATURES}
        neg = {f: -v for f, v in x.items()}
        assert predict_form(params, x) + predict_form(params, neg) == pytest.approx(1, abs=1e-12)


def test_zero_input_is_a_coin_flip():
    params = _params([0.7] * len(FEATURES), [3.0] * len(FEATURES))
    assert predict_form(params, _zero()) == 0.5


def test_contributions_add_up_to_the_logit():
    rng = random.Random(3)
    params = _params([rng.uniform(-1, 1) for _ in FEATURES], [rng.uniform(1, 20) for _ in FEATURES])
    x = {f: rng.uniform(-10, 10) for f in FEATURES}
    p = predict_form(params, x)
    assert sum(contributions(params, x).values()) == pytest.approx(math.log(p / (1 - p)))
    assert list(contributions(params, x)) == list(FEATURES)


def test_hand_computed_prediction():
    weights = [1.0 if f == "elo_diff" else 0.0 for f in FEATURES]
    scales = [100.0 if f == "elo_diff" else 1.0 for f in FEATURES]
    x = _zero()
    x["elo_diff"] = 100.0
    assert predict_form(_params(weights, scales), x) == pytest.approx(1 / (1 + math.exp(-1)))
    assert predict_form(_params(weights, scales), x) == pytest.approx(0.731059, abs=1e-6)


def test_fit_finds_the_signal():
    xs, ys = [], []
    for sign, wins in ((+1, 160), (-1, 40)):
        for i in range(200):
            x = _zero()
            x["elo_diff"] = 200.0 * sign
            xs.append(x)
            ys.append(1 if i < wins else 0)
    params = fit_form(xs, ys, 1.0, train_from=D, train_to=D, fitted_on=D)
    assert params.weights[FEATURES.index("elo_diff")] > 0
    x = _zero()
    x["elo_diff"] = 200.0
    assert 0.7 < predict_form(params, x) < 0.9


def test_fit_cannot_learn_listing_order():
    xs = [_zero() for _ in range(200)]
    params = fit_form(xs, [1] * 200, 1.0, train_from=D, train_to=D, fitted_on=D)
    assert all(w == pytest.approx(0, abs=1e-9) for w in params.weights)
    assert predict_form(params, _zero()) == 0.5


def test_fit_records_window_and_zero_means():
    xs = [{**_zero(), "elo_diff": float(i - 5)} for i in range(10)]
    ys = [i % 2 for i in range(10)]
    params = fit_form(xs, ys, 0.5, train_from=date(2020, 1, 1), train_to=date(2023, 6, 30), fitted_on=date(2024, 2, 2))
    assert params.means == tuple(0.0 for _ in FEATURES)
    assert (params.train_from, params.train_to, params.fitted_on) == (date(2020, 1, 1), date(2023, 6, 30), date(2024, 2, 2))
    assert params.n_bouts == 10
    assert params.features == FEATURES
    assert params.version == FORM_VERSION
    assert params.c == 0.5
    # constant (all-zero) columns get scale 1.0
    assert params.scales[FEATURES.index("debut")] == 1.0
