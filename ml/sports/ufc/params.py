"""Parameter file for the UFC models (Elo section plus a fitted form section).

Loading falls back per section so a missing or damaged file never breaks the
pipeline. Elo: a missing or malformed `elo` section, or an unreadable file,
gives `EloParams()` (k 60, history from 2016, no decay: the spike's best 2016
setting). Form: `None` when the section is missing or malformed, when its
`features` differ from `FEATURES` (a stale file), when the list lengths
differ, or when any mean is not 0. There are no default form weights: without a
fitted section the form model does not run and only Elo rows are written.
"""
from __future__ import annotations

import json
import logging
import math
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path

from ml.sports.ufc.elo import EloParams
from ml.sports.ufc.features import FEATURES
from ml.sports.ufc.model import FormParams

log = logging.getLogger(__name__)

DEFAULT_PARAMS_FILE = Path(__file__).with_name("params.json")


@dataclass(frozen=True)
class UfcParams:
    elo: EloParams
    form: FormParams | None
    # False when the Elo settings are the code fallback (unreadable file or bad Elo section):
    # they are not the settings the rows' version label stands for.
    elo_from_file: bool = True


def _parse_elo(data: dict) -> EloParams | None:
    try:
        d = data["elo"]
        return EloParams(
            version=str(d["version"]), k=float(d["k"]), history_from=int(d["history_from"]),
            decay=float(d["decay"]), scale=float(d["scale"]), start=float(d["start"]),
        )
    except (KeyError, TypeError, ValueError):
        log.warning("ufc params: elo section missing or malformed, using default Elo settings")
        return None


def _parse_form(data: dict) -> FormParams | None:
    if "form" not in data:
        log.info("ufc params: no form section (expected until a model is fitted); form model off")
        return None
    try:
        d = data["form"]
        features = tuple(d["features"])
        if features != FEATURES:
            log.warning("ufc params: form section is stale (features differ from FEATURES); form model off")
            return None
        weights = tuple(float(v) for v in d["weights"])
        means = tuple(float(v) for v in d["means"])
        scales = tuple(float(v) for v in d["scales"])
        if not (len(weights) == len(means) == len(scales) == len(features)):
            log.warning("ufc params: form section list lengths differ from features; form model off")
            return None
        if any(m != 0 for m in means):
            log.warning("ufc params: form section has a non-zero mean; form model off")
            return None
        if not all(math.isfinite(w) for w in weights):
            log.warning("ufc params: form section has a non-finite weight; form model off")
            return None
        if not all(math.isfinite(sc) and sc > 0 for sc in scales):
            log.warning("ufc params: form section has a scale that is not positive and finite; form model off")
            return None
        return FormParams(
            version=str(d["version"]), features=features, weights=weights, means=means,
            scales=scales, c=float(d["c"]),
            train_from=date.fromisoformat(d["train_from"]),
            train_to=date.fromisoformat(d["train_to"]),
            fitted_on=date.fromisoformat(d["fitted_on"]),
            n_bouts=int(d["n_bouts"]),
        )
    except (KeyError, TypeError, ValueError):
        log.warning("ufc params: form section malformed; form model off")
        return None


def load_params(path: Path | None = None) -> UfcParams:
    try:
        data = json.loads((path or DEFAULT_PARAMS_FILE).read_text())
        if not isinstance(data, dict):
            raise ValueError("top level is not an object")
    except (OSError, ValueError):
        log.warning("ufc params: file unreadable or corrupt, using default Elo settings and no form model")
        return UfcParams(EloParams(), None, elo_from_file=False)
    elo = _parse_elo(data)
    return UfcParams(elo or EloParams(), _parse_form(data), elo_from_file=elo is not None)


def save_params(params: UfcParams, path: Path | None = None) -> None:
    out: dict[str, object] = {"elo": asdict(params.elo)}
    if params.form is not None:
        form = asdict(params.form)
        for key in ("features", "weights", "means", "scales"):
            form[key] = list(form[key])
        for key in ("train_from", "train_to", "fitted_on"):
            form[key] = form[key].isoformat()
        out["form"] = form
    (path or DEFAULT_PARAMS_FILE).write_text(json.dumps(out, indent=2) + "\n")
