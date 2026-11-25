from __future__ import annotations

import json
from dataclasses import asdict
from datetime import date

from ml.sports.ufc.elo import EloParams
from ml.sports.ufc.features import FEATURES
from ml.sports.ufc.model import FORM_VERSION, FormParams
from ml.sports.ufc.params import UfcParams, load_params, save_params


def _form() -> FormParams:
    n = len(FEATURES)
    return FormParams(
        version=FORM_VERSION, features=FEATURES, weights=tuple(0.1 * i for i in range(n)),
        means=(0.0,) * n, scales=tuple(1.0 + i for i in range(n)), c=0.5,
        train_from=date(2016, 1, 1), train_to=date(2023, 12, 31), fitted_on=date(2024, 1, 5), n_bouts=1234,
    )


def _write(path, form_edit=None, elo=None):
    form = {**asdict(_form()), **{k: v.isoformat() for k, v in asdict(_form()).items() if isinstance(v, date)}}
    form["features"] = list(form["features"])
    form["weights"] = list(form["weights"])
    form["means"] = list(form["means"])
    form["scales"] = list(form["scales"])
    if form_edit:
        form_edit(form)
    path.write_text(json.dumps({"elo": elo or asdict(EloParams(k=42.0)), "form": form}))


def test_missing_file_gives_default_elo_and_no_form(tmp_path):
    assert load_params(tmp_path / "nope.json") == UfcParams(EloParams(), None)


def test_round_trip(tmp_path):
    p = UfcParams(EloParams(k=33.0, history_from=2018), _form())
    save_params(p, tmp_path / "p.json")
    assert load_params(tmp_path / "p.json") == p


def test_round_trip_elo_only(tmp_path):
    p = UfcParams(EloParams(), None)
    save_params(p, tmp_path / "p.json")
    assert load_params(tmp_path / "p.json") == p


def test_stale_feature_list_drops_form(tmp_path):
    def edit(f):
        f["features"] = f["features"][:-1]
        f["weights"], f["means"], f["scales"] = f["weights"][:-1], f["means"][:-1], f["scales"][:-1]
    _write(tmp_path / "p.json", edit)
    got = load_params(tmp_path / "p.json")
    assert got.form is None
    assert got.elo.k == 42.0


def test_length_mismatch_drops_form(tmp_path):
    _write(tmp_path / "p.json", lambda f: f.update(weights=f["weights"][:-1]))
    assert load_params(tmp_path / "p.json").form is None


def test_nonzero_mean_drops_form(tmp_path):
    def edit(f):
        f["means"][0] = 0.5
    _write(tmp_path / "p.json", edit)
    got = load_params(tmp_path / "p.json")
    assert got.form is None
    assert got.elo.k == 42.0


def test_malformed_form_drops_form_only(tmp_path):
    _write(tmp_path / "p.json", lambda f: f.update(train_from="not a date"))
    got = load_params(tmp_path / "p.json")
    assert got.form is None and got.elo.k == 42.0


def test_malformed_elo_falls_back_to_default(tmp_path):
    _write(tmp_path / "p.json", elo={"k": "abc"})
    got = load_params(tmp_path / "p.json")
    assert got.elo == EloParams() and got.form == _form()


def test_corrupt_json_falls_back(tmp_path):
    (tmp_path / "p.json").write_text("{")
    assert load_params(tmp_path / "p.json") == UfcParams(EloParams(), None)


def test_shipped_file_loads():
    assert load_params().elo.version == "ufc-elo-v0.1"


# --- fallbacks are logged, never silent ---------------------------------------------------

import logging  # noqa: E402


def _warnings(caplog):
    return [r.getMessage() for r in caplog.records if r.levelno >= logging.WARNING]


def _loaded(tmp_path, caplog, form_edit=None, elo=None):
    _write(tmp_path / "p.json", form_edit, elo)
    caplog.clear()
    with caplog.at_level(logging.DEBUG, logger="ml.sports.ufc.params"):
        return load_params(tmp_path / "p.json")


def test_unreadable_file_warns(tmp_path, caplog):
    with caplog.at_level(logging.DEBUG, logger="ml.sports.ufc.params"):
        got = load_params(tmp_path / "nope.json")
    assert got == UfcParams(EloParams(), None)
    assert any("unreadable" in m for m in _warnings(caplog))


def test_corrupt_json_warns(tmp_path, caplog):
    (tmp_path / "p.json").write_text("{")
    with caplog.at_level(logging.DEBUG, logger="ml.sports.ufc.params"):
        load_params(tmp_path / "p.json")
    assert any("unreadable" in m for m in _warnings(caplog))


def test_malformed_elo_warns(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, elo={"k": "abc"})
    assert got.elo == EloParams()
    assert any("elo section" in m for m in _warnings(caplog))


def test_stale_features_warn(tmp_path, caplog):
    def edit(f):
        f["features"] = f["features"][:-1]
    got = _loaded(tmp_path, caplog, edit)
    assert got.form is None and got.elo.k == 42.0
    assert any("stale" in m for m in _warnings(caplog))


def test_length_mismatch_warns(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f.update(weights=f["weights"][:-1]))
    assert got.form is None
    assert any("length" in m for m in _warnings(caplog))


def test_nonzero_mean_warns(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f["means"].__setitem__(0, 0.5))
    assert got.form is None
    assert any("mean" in m for m in _warnings(caplog))


def test_malformed_form_warns(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f.update(train_from="not a date"))
    assert got.form is None and got.elo.k == 42.0
    assert any("form section malformed" in m for m in _warnings(caplog))


def test_absent_form_does_not_warn(tmp_path, caplog):
    p = tmp_path / "p.json"
    save_params(UfcParams(EloParams(), None), p)
    with caplog.at_level(logging.DEBUG, logger="ml.sports.ufc.params"):
        got = load_params(p)
    assert got.form is None
    assert _warnings(caplog) == []


def test_zero_scale_drops_form(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f["scales"].__setitem__(2, 0.0))
    assert got.form is None and got.elo.k == 42.0
    assert any("scale" in m for m in _warnings(caplog))


def test_nan_weight_drops_form(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f["weights"].__setitem__(1, float("nan")))
    assert got.form is None and got.elo.k == 42.0
    assert any("weight" in m for m in _warnings(caplog))


def test_infinite_scale_drops_form(tmp_path, caplog):
    got = _loaded(tmp_path, caplog, lambda f: f["scales"].__setitem__(0, float("inf")))
    assert got.form is None and got.elo.k == 42.0
    assert any("scale" in m for m in _warnings(caplog))
