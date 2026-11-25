"""Walk-forward evaluation of the UFC models against the betting market.

Why this exists: before visitors see a UFC probability we need to know whether it
beats a coin flip, and how far it sits from the market's price, on fights the model
never trained on. The harness reads finished bouts from the database (read-only),
tunes Elo on 2018-2021, picks the form model's training window and regularisation on
2021, then predicts every held-out year from data that ended the year before. It
also scores a market baseline built from `ufc_odds_snapshots`, the method pick and
the picks game, and applies the gate the owner set. It writes a markdown report and,
on request, the fitted parameter file. It never writes to the database and never
touches the network.

Usage:
    PYTHONPATH=backend:. python -m pipeline.sports.ufc_evaluate \
        --db sqlite:///ufc-history.db --out docs/UFC-EVALUATION.md --write-params
"""
from __future__ import annotations

import argparse
import itertools
import logging
import math
import subprocess
from dataclasses import asdict, dataclass, replace
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Mapping, Sequence

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.models import UfcBout, UfcOddsSnapshot
from ml.sports.ufc.elo import EloParams, elo_probs
from ml.sports.ufc.features import Snapshot, snapshots
from ml.sports.ufc.history import BoutRecord, History
from ml.sports.ufc.methods import METHODS, method_pick, method_table
from ml.sports.ufc.model import FORM_VERSION, FormParams, fit_form, predict_form
from ml.sports.ufc.params import DEFAULT_PARAMS_FILE, UfcParams, save_params
from pipeline.sports.nrl_evaluate import _read_only_snapshot
from pipeline.sports.ufc_history import load_history
from pipeline.sports.ufc_ingest import _utc

log = logging.getLogger(__name__)

ELO_GRID = {
    "k": (40.0, 60.0, 80.0, 100.0, 120.0),
    "history_from": (1993, 2005, 2010, 2016),
    "decay": (0.0, 0.1, 0.2),
}
FORM_GRID = {"window_years": (3, 5, 8), "c": (0.1, 1.0, 10.0)}
GATE_BRIER = 0.235
GATE_MIN_FIGHTS = 100
LN2 = math.log(2)
_EPS = 1e-15


# ---------------------------------------------------------------- market


def implied(moneyline: int) -> float | None:
    """Probability implied by an American moneyline (vig included); None if not a price."""
    if moneyline >= 100:
        return 100.0 / (moneyline + 100.0)
    if moneyline <= -100:
        return -moneyline / (-moneyline + 100.0)
    return None


def devig(ml_a: int, ml_b: int) -> float | None:
    """Fighter a's probability with the bookmaker's margin removed proportionally."""
    ia, ib = implied(ml_a), implied(ml_b)
    if ia is None or ib is None:
        return None
    return ia / (ia + ib)


def _is_live_source(source: str) -> bool:
    return "live" in source.lower()


def market_probs(db: Session) -> dict[int, float]:
    """bout_id -> market P(a wins): per source the latest valid price taken at or
    before the scheduled start, de-vigged, then the plain mean over sources.

    Sources named "...Live..." (for example "ESPN Bet - Live Odds") are skipped. Backfilled
    history stamps every snapshot with the scheduled time, but a live source holds in-play
    prices that already reflect how the fight went, so including it would make the market
    look better than any pre-fight price could be."""
    latest: dict[tuple[int, str], tuple[datetime, int, float]] = {}
    rows = db.execute(
        select(UfcOddsSnapshot, UfcBout.scheduled_utc).join(UfcBout, UfcBout.id == UfcOddsSnapshot.bout_id)
    )
    for snap, scheduled in rows:
        if scheduled is None or _is_live_source(snap.source):
            continue
        taken, start = _utc(snap.taken_at), _utc(scheduled)
        p = devig(snap.moneyline_a, snap.moneyline_b)
        if p is None or taken > start:
            continue
        key = (snap.bout_id, snap.source)
        if key not in latest or (taken, snap.id) > latest[key][:2]:
            latest[key] = (taken, snap.id, p)
    by_bout: dict[int, list[float]] = {}
    for (bout_id, _), (_, _, p) in latest.items():
        by_bout.setdefault(bout_id, []).append(p)
    return {b: sum(ps) / len(ps) for b, ps in by_bout.items()}


# ---------------------------------------------------------------- scoring


@dataclass(frozen=True)
class Scored:
    n: int
    accuracy: float
    brier: float
    log_loss: float


def score(pairs: Sequence[tuple[float, int]]) -> Scored | None:
    """pairs are (p_a, 1 if a won). Brier is (1 - p_actual)^2; p_a == 0.5 counts wrong."""
    if not pairs:
        return None
    right = brier = ll = 0.0
    for p, a_won in pairs:
        p_actual = p if a_won else 1.0 - p
        right += (p > 0.5 and a_won == 1) or (p < 0.5 and a_won == 0)
        brier += (1.0 - p_actual) ** 2
        ll += -math.log(max(_EPS, p_actual))
    n = len(pairs)
    return Scored(n, right / n, brier / n, ll / n)


def calibration(pairs: Sequence[tuple[float, int]]) -> list[tuple[str, int, float, float]]:
    """Per favourite-probability bucket of width 5 points: (bucket, n, mean said, favourite won)."""
    buckets: dict[int, list[tuple[float, int]]] = {}
    for p, a_won in pairs:
        fav = max(p, 1.0 - p)
        fav_won = a_won if p >= 0.5 else 1 - a_won
        buckets.setdefault(min(int(fav * 20), 19), []).append((fav, fav_won))
    return [
        (f"{5 * i}–{5 * i + 5}", len(v), sum(f for f, _ in v) / len(v), sum(w for _, w in v) / len(v))
        for i, v in sorted(buckets.items())
    ]


def picks_points(p_a: float, method_pick: str, winner: str, method: str | None) -> int:
    """Picks game: 5 for winner and method, 2 for the winner alone, 0 otherwise."""
    if p_a == 0.5:
        return 0
    called = "a" if p_a > 0.5 else "b"
    if called != winner:
        return 0
    return 5 if method_pick == method else 2


def gate(
    log_loss_by_year: Mapping[int, float], n_by_year: Mapping[int, int], pooled_brier: float
) -> tuple[bool, str]:
    """Pass when log loss beats a coin flip in two of the three latest years with
    enough fights and the pooled Brier is within GATE_BRIER."""
    years = sorted(y for y in log_loss_by_year if n_by_year.get(y, 0) >= GATE_MIN_FIGHTS)[-3:]
    if len(years) < 3:
        return False, (
            f"FAIL (fewer than three held-out years with at least {GATE_MIN_FIGHTS} scored fights: "
            f"{len(years)} found)"
        )
    beaten = sum(log_loss_by_year[y] < LN2 for y in years)
    ok = beaten >= 2 and pooled_brier <= GATE_BRIER
    op = "<=" if pooled_brier <= GATE_BRIER else ">"
    return ok, (
        f"{'PASS' if ok else 'FAIL'} (log loss below {LN2:.4f} in {beaten} of 3: "
        f"{' '.join(map(str, years))}; pooled Brier {pooled_brier:.4f} {op} {GATE_BRIER})"
    )


# ---------------------------------------------------------------- tuning


def _scored(history: History) -> list[BoutRecord]:
    return [b for b in history.bouts if b.winner in ("a", "b")]


def _won(b: BoutRecord) -> int:
    return 1 if b.winner == "a" else 0


def tune_elo(history: History, tune_years: tuple[int, int]) -> EloParams:
    """Grid-search Elo on log loss over scored bouts in `tune_years` (inclusive).
    Ties keep the earlier grid point. Uses nothing from later years."""
    bouts = [b for b in _scored(history) if tune_years[0] <= b.when.year <= tune_years[1]]
    if not bouts:
        raise ValueError("no scored bouts in the Elo tuning years")
    best: tuple[float, EloParams] | None = None
    for k, hf, decay in itertools.product(ELO_GRID["k"], ELO_GRID["history_from"], ELO_GRID["decay"]):
        params = EloParams(k=k, history_from=hf, decay=decay)
        probs = elo_probs(history, params)
        s = score([(probs[b.bout_id], _won(b)) for b in bouts])
        if best is None or s.log_loss < best[0]:
            best = (s.log_loss, params)
    return best[1]


def _fit(
    bouts: Sequence[BoutRecord], snaps: Mapping[int, Snapshot], c: float, first: date, last: date,
) -> FormParams:
    xs = [snaps[b.bout_id].x for b in bouts]
    return fit_form(xs, [_won(b) for b in bouts], c, train_from=first, train_to=last, fitted_on=last)


def swap_history(history: History) -> History:
    """The same history with every bout's fighters a and b exchanged: ids, winner
    and per-side stats all swap. Features and Elo must be recomputed from it."""
    swapped = tuple(
        replace(
            b, fighter_a=b.fighter_b, fighter_b=b.fighter_a,
            winner={"a": "b", "b": "a"}.get(b.winner), stats_a=b.stats_b, stats_b=b.stats_a,
        )
        for b in history.bouts
    )
    return History(bouts=swapped, fighters=history.fighters)


def _window(scored: Sequence[BoutRecord], first_year: int, last_year: int) -> list[BoutRecord]:
    return [b for b in scored if first_year <= b.when.year <= last_year]


def choose_form_settings(
    history: History, snaps: Mapping[int, Snapshot], validation_year: int
) -> tuple[int, float]:
    """(window_years, c) with the lowest log loss on `validation_year`, trained
    only on the W years before it. Ties keep the earlier grid point."""
    scored = _scored(history)
    valid = _window(scored, validation_year, validation_year)
    if not valid:
        raise ValueError("no scored bouts in the validation year")
    best: tuple[float, tuple[int, float]] | None = None
    for w, c in itertools.product(FORM_GRID["window_years"], FORM_GRID["c"]):
        train = _window(scored, validation_year - w, validation_year - 1)
        if not train:
            continue
        model = _fit(train, snaps, c, date(validation_year - w, 1, 1), date(validation_year - 1, 12, 31))
        s = score([(predict_form(model, snaps[b.bout_id].x), _won(b)) for b in valid])
        if best is None or s.log_loss < best[0]:
            best = (s.log_loss, (w, c))
    if best is None:
        raise ValueError("no training bouts before the validation year")
    return best[1]


# ---------------------------------------------------------------- run


def _d(s: Scored | None) -> dict | None:
    return None if s is None else asdict(s)


def _years_back(now: datetime, years: int) -> datetime:
    try:
        return now.replace(year=now.year - years)
    except ValueError:  # 29 February
        return now.replace(year=now.year - years, day=28)


def _git_commit() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True, check=True)
        return out.stdout.strip() or "unknown"
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def run(
    db: Session,
    first_holdout: int = 2022,
    tune_years: tuple[int, int] = (2018, 2021),
    validation_year: int = 2021,
    params_path: Path | None = None,
    now: datetime | None = None,
) -> dict:
    if tune_years[1] >= first_holdout or validation_year >= first_holdout:
        raise ValueError(
            f"tuning years {tune_years} and validation year {validation_year} must end before "
            f"the first held-out year {first_holdout}"
        )
    now = now or datetime.now(timezone.utc)
    history = load_history(db)
    scored = _scored(history)
    elo = tune_elo(history, tune_years)
    snaps = snapshots(history, elo)
    swapped_scored = {b.bout_id: b for b in _scored(swap_history(history))}
    snaps_sw = snapshots(swap_history(history), elo)
    window, c = choose_form_settings(history, snaps, validation_year)
    last_year = max(b.when.year for b in scored)
    years = list(range(first_holdout, last_year + 1))
    market = market_probs(db)
    elo_v, form_v = elo.version, FORM_VERSION

    names = (elo_v, form_v)
    pairs: dict[str, dict[int, list[tuple[float, int]]]] = {m: {} for m in names}
    swapped_pairs: dict[int, list[tuple[float, int]]] = {}
    base_pairs: dict[int, list[tuple[float, int]]] = {}
    rating_right: dict[int, list[int]] = {}
    picks = {m: [0, 0] for m in names}  # total points, bouts
    method_right = method_n = decision_n = 0
    market_rows: dict[int, dict[str, list]] = {}
    max_diff = 0.0
    train_sizes: dict[int, int] = {}
    held = []
    for year in years:
        test = _window(scored, year, year)
        train = _window(scored, year - window, year - 1)
        if not test:
            continue
        if not train:
            raise ValueError(f"no training bouts for held-out year {year}")
        held.append(year)
        first, last = date(year - window, 1, 1), date(year - 1, 12, 31)
        model = _fit(train, snaps, c, first, last)
        model_sw = _fit([swapped_scored[b.bout_id] for b in train], snaps_sw, c, first, last)
        table = method_table(history.bouts, datetime(year - 10, 1, 1, tzinfo=timezone.utc),
                             datetime(year, 1, 1, tzinfo=timezone.utc))
        train_sizes[year] = len(train)
        for b in test:
            snap, won = snaps[b.bout_id], _won(b)
            p = {elo_v: snap.p_elo, form_v: predict_form(model, snap.x)}
            for m in names:
                pairs[m].setdefault(year, []).append((p[m], won))
            b_sw = swapped_scored[b.bout_id]
            p_sw = predict_form(model_sw, snaps_sw[b.bout_id].x)
            swapped_pairs.setdefault(year, []).append((p_sw, _won(b_sw)))
            max_diff = max(max_diff, abs(p[form_v] - (1.0 - p_sw)))
            base_pairs.setdefault(year, []).append((0.5, won))
            higher_a = snap.a.rating > snap.b.rating
            higher_b = snap.b.rating > snap.a.rating
            rating_right.setdefault(year, []).append(int((higher_a and won == 1) or (higher_b and won == 0)))
            pick = method_pick(table.probs(b.weight_class, b.scheduled_rounds))
            for m in names:
                picks[m][0] += picks_points(p[m], pick, b.winner, b.method)
                picks[m][1] += 1
            if b.method in METHODS:
                method_n += 1
                method_right += pick == b.method
                decision_n += b.method == "decision"
            if b.bout_id in market:
                row = market_rows.setdefault(year, {"market": [], elo_v: [], form_v: []})
                row["market"].append((market[b.bout_id], won))
                row[elo_v].append((p[elo_v], won))
                row[form_v].append((p[form_v], won))

    def pool(by_year: Mapping[int, list]) -> list:
        return [x for y in held for x in by_year.get(y, [])]

    models = {}
    for m in names:
        by_year = {y: _d(score(pairs[m][y])) for y in held}
        pooled = score(pool(pairs[m]))
        ok, line = gate({y: by_year[y]["log_loss"] for y in held}, {y: by_year[y]["n"] for y in held}, pooled.brier)
        called = [x for x in pool(pairs[m]) if x[0] != 0.5]
        models[m] = {
            "by_year": by_year, "pooled": _d(pooled),
            "no_call": pooled.n - len(called), "accuracy_when_called": score(called).accuracy if called else None, "calibration": calibration(pool(pairs[m])),
            "picks": {"total": picks[m][0], "n": picks[m][1], "per_fight": picks[m][0] / picks[m][1]},
            "gate": {"ok": ok, "line": f"GATE {m}: {line}"},
        }

    coin_acc = lambda y: 0.5
    rating_acc = lambda y: sum(rating_right[y]) / len(rating_right[y])
    baselines = {}
    for label, acc in (("coin flip", coin_acc), ("higher rating at 50/50", rating_acc)):
        by_year = {y: _d(replace(score(base_pairs[y]), accuracy=acc(y))) for y in held}
        n_all = sum(by_year[y]["n"] for y in held)
        pooled_acc = (
            0.5 if label == "coin flip"
            else sum(sum(rating_right[y]) for y in held) / n_all
        )
        pooled = replace(score(pool(base_pairs)), accuracy=pooled_acc)
        baselines[label] = {"by_year": by_year, "pooled": _d(pooled)}

    market_payload = {"n": sum(len(r["market"]) for r in market_rows.values()), "by_year": {}, "pooled": None}
    for y in held:
        if y in market_rows:
            r = market_rows[y]
            market_payload["by_year"][y] = {k: _d(score(v)) for k, v in
                                            (("market", r["market"]), ("elo", r[elo_v]), ("form", r[form_v]))}
    if market_payload["n"]:
        flat = {k: [x for y in held for x in market_rows.get(y, {}).get(k, [])] for k in ("market", elo_v, form_v)}
        market_payload["pooled"] = {"market": _d(score(flat["market"])), "elo": _d(score(flat[elo_v])),
                                    "form": _d(score(flat[form_v]))}

    swap_pooled = score(pool(swapped_pairs))
    all_priced = sum(1 for b in scored if b.bout_id in market)
    non_scored = len(history.bouts) - len(scored)
    payload = {
        "generated": now.date().isoformat(), "commit": _git_commit(),
        "first_holdout": first_holdout, "tune_years": list(tune_years), "validation_year": validation_year,
        "last_scored_date": max(b.when for b in scored).date().isoformat(), "last_year": last_year,
        "elo_params": asdict(elo), "form_settings": {"window_years": window, "c": c},
        "counts": {
            "finished_bouts": len(history.bouts), "scored_bouts": len(scored), "unscored_bouts": non_scored,
            "fighters": len(history.fighters), "first_year": min(b.when.year for b in history.bouts),
            "last_year": last_year, "priced_bouts": all_priced,
            "priced_from_holdout": market_payload["n"], "scored_from_holdout": len(pool(pairs[elo_v])),
        },
        "years": held, "train_sizes": train_sizes,
        "models": models, "baselines": baselines, "market": market_payload,
        "method": {"n": method_n, "accuracy": method_right / method_n if method_n else None,
                   "decision_share": decision_n / method_n if method_n else None},
        "swap": {"pooled": _d(swap_pooled), "max_abs_diff": max_diff},
    }
    if params_path is not None:
        first = _years_back(now, window)
        train = [b for b in scored if first <= b.when < now]
        form = _fit(train, snaps, c, first.date(), now.date())
        save_params(UfcParams(elo, form), params_path)
        payload["fitted"] = {"n_bouts": form.n_bouts, "train_from": first.date().isoformat(),
                             "train_to": now.date().isoformat()}
    return payload


# ---------------------------------------------------------------- report


def _pct(x: float) -> str:
    return f"{100 * x:.1f}%"


def _row(label: object, s: dict | None) -> str:
    if s is None:
        return f"| {label} | 0 | n/a | n/a | n/a |"
    return f"| {label} | {s['n']:,} | {_pct(s['accuracy'])} | {s['brier']:.4f} | {s['log_loss']:.4f} |"


_HEAD = "| Year | Fights | Accuracy | Brier | Log loss |\n|---|---|---|---|---|"
_HEAD_SIDE = "| Predictor | Fights | Accuracy | Brier | Log loss |\n|---|---|---|---|---|"


def _table(by_year: Mapping, pooled: dict | None) -> list[str]:
    lines = [_HEAD] + [_row(y, s) for y, s in by_year.items()] + [_row("Pooled", pooled)]
    return lines + [""]


def _compare(label: str, a: float, b: float, name_a: str, name_b: str) -> str:
    if a < b:
        return f"{name_a} {label} is lower (better) than {name_b} by {b - a:.4f}."
    if a > b:
        return f"{name_a} {label} is higher (worse) than {name_b} by {a - b:.4f}."
    return f"{name_a} and {name_b} have the same {label}."


def _summary(p: dict) -> list[str]:
    elo_v = p["elo_params"]["version"]
    lines = []
    for m in (elo_v, FORM_VERSION):
        d = p["models"][m]["pooled"]
        lines.append(
            f"- {m}: {d['n']:,} held-out fights, accuracy {_pct(d['accuracy'])}, Brier {d['brier']:.4f}, "
            f"log loss {d['log_loss']:.4f}. {p['models'][m]['gate']['line']}"
        )
    if p["market"]["n"]:
        pm = p["market"]["pooled"]
        lines.append(
            f"- Market, on the {p['market']['n']:,} held-out fights with a price: accuracy "
            f"{_pct(pm['market']['accuracy'])}, Brier {pm['market']['brier']:.4f}, log loss "
            f"{pm['market']['log_loss']:.4f}. On the same fights the form model has accuracy "
            f"{_pct(pm['form']['accuracy'])}, Brier {pm['form']['brier']:.4f}, log loss {pm['form']['log_loss']:.4f}."
        )
    return lines


def render_report(payload: dict) -> str:
    p, c = payload, payload["counts"]
    elo_v, form_v = (p["elo_params"]["version"], FORM_VERSION)
    ep, fs = p["elo_params"], p["form_settings"]
    first, tl, th = p["first_holdout"], p["tune_years"][0], p["tune_years"][1]
    out = [
        "# UFC prediction evaluation",
        "",
        f"Generated {p['generated']} from commit {p['commit']}. Aggregate numbers only.",
        "",
        "## Summary",
        "",
        *_summary(p),
        "",
        "## Protocol",
        "",
        f"Every number below is walk-forward: a fight is predicted from information that existed before it, "
        f"and nothing from the held-out years is used to choose a setting. Elo (k, first year of history, idle "
        f"decay) is tuned by log loss on fights from {tl} to {th}. The form model's training window "
        f"(3, 5 or 8 years) and regularisation strength (0.1, 1 or 10) are chosen by log loss on {p['validation_year']}, "
        f"trained on the years before it. For each held-out year T from {first} to {p['last_year']}, the form model is "
        f"fitted on the chosen window of years ending 31 December of T-1 and predicts every fight in T. Elo "
        f"predictions use only fights that started earlier. The method pick for year T comes from the finishing "
        f"methods of the ten years before T, by weight class and scheduled rounds. Only finished fights with a "
        f"winner are scored or used as training labels; draws and no contests stay in the rating history but are "
        f"never scored. {p['last_year']} is a partial year: it covers fights up to {p['last_scored_date']}.",
        "",
        "The fighter listed first by the feed won more often than half of the time, so the models must not see "
        "listing order. Every form-model input changes sign when the two fighters swap, and the model has no "
        "intercept. The swap check below rebuilds the whole history with every fight's two fighters swapped, "
        "recomputes the Elo ratings and features from it, refits the form model and re-scores it.",
        "",
        "The market is the de-vigged moneyline from `ufc_odds_snapshots`: per source the latest valid price taken "
        "at or before the scheduled start, averaged over sources. Sources whose name contains \"Live\" "
        "are left out because their prices are in-play. For backfilled history the snapshot time is the "
        "bout's scheduled time, so this approximates the closing line. Prices exist almost only from mid-2019.",
        "",
        "## Data",
        "",
        f"- Finished bouts in history: {c['finished_bouts']:,} ({c['first_year']} to {c['last_year']}).",
        f"- Scored bouts (a winner recorded): {c['scored_bouts']:,}. Draws and no contests, never scored: {c['unscored_bouts']:,}.",
        f"- Fighters: {c['fighters']:,}.",
        f"- Scored bouts with a market price: {c['priced_bouts']:,} in all, {c['priced_from_holdout']:,} of the "
        f"{c['scored_from_holdout']:,} held-out fights ({first} on).",
        "",
        "## Chosen settings",
        "",
        f"- Elo ({elo_v}): k {ep['k']:g}, history from {ep['history_from']}, idle decay {ep['decay']:g} per year.",
        f"- Form ({form_v}): training window {fs['window_years']} years, regularisation C {fs['c']:g}.",
        *(
            [f"- The committed parameter file was fitted on the {fs['window_years']} years from {p['fitted']['train_from']} "
             f"to {p['fitted']['train_to']} ({p['fitted']['n_bouts']:,} scored bouts). That production fit has no "
             "held-out score of its own; the results below come from the per-year walk-forward fits."]
            if "fitted" in p else []
        ),
        "",
        "## Results by model",
        "",
    ]
    for m in (elo_v, form_v):
        mm = p["models"][m]
        out += [f"### {m}", ""] + _table(mm["by_year"], mm["pooled"])
        if mm["no_call"]:
            out += [f"{mm['no_call']:,} of the {mm['pooled']['n']:,} fights have a probability of exactly 50% "
                    f"(both fighters unrated) and count as wrong in the accuracy column. On the other "
                    f"{mm['pooled']['n'] - mm['no_call']:,} fights accuracy is {_pct(mm['accuracy_when_called'])}.", ""]
    out += ["### Baselines", "",
            "The coin flip says 50% every time; its accuracy is shown as 50.0% by convention. "
            "\"Higher rating at 50/50\" says 50% but is scored on whether the fighter with the higher "
            "pre-fight Elo rating won (equal ratings count as wrong), so its accuracy equals Elo's by construction. Both have Brier 0.25 and "
            "log loss 0.6931.", ""]
    for label, b in p["baselines"].items():
        out += [f"**{label}**", ""] + _table(b["by_year"], b["pooled"])
    sw = p["swap"]["pooled"]
    out += [
        "### Swap check", "",
        f"The history was rebuilt with every fight's fighters, winner and per-side stats swapped, and the ratings, "
        f"features and form model were recomputed from it. The form model's pooled result is accuracy {_pct(sw['accuracy'])}, Brier {sw['brier']:.4f}, log loss {sw['log_loss']:.4f} "
        f"on {sw['n']:,} fights. The largest difference between any fight's probability and one minus its "
        f"swapped probability is {p['swap']['max_abs_diff']:.2e}.", "",
        "## Against the market", "",
    ]
    mk = p["market"]
    if not mk["n"]:
        out += ["No held-out fight has a usable price, so there is no market comparison.", ""]
    else:
        pooled = mk["pooled"]
        out += [f"Fights with a market price among the held-out fights: {mk['n']:,}. All three rows below are "
                "scored on those same fights.", ""]
        for y, r in mk["by_year"].items():
            out += [f"**{y}**", "", _HEAD_SIDE, _row("Market", r["market"]), _row("Elo", r["elo"]),
                    _row("Form", r["form"]), ""]
        out += ["**Pooled**", "", _HEAD_SIDE, _row("Market", pooled["market"]), _row("Elo", pooled["elo"]),
                _row("Form", pooled["form"]), ""]
        out += [
            _compare("Brier", pooled["form"]["brier"], pooled["market"]["brier"], "The form model's", "the market's"),
            _compare("Brier", pooled["elo"]["brier"], pooled["market"]["brier"], "Elo's", "the market's"),
            _compare("log loss", pooled["form"]["log_loss"], pooled["market"]["log_loss"], "The form model's", "the market's"),
            "",
        ]
    out += ["## Calibration", "",
            "Fights are grouped by the favourite's stated probability. \"Said\" is the mean favourite "
            "probability in the group and \"won\" the share of those favourites that won. Pooled over all held-out years.",
            ""]
    for m in (elo_v, form_v):
        out += [f"**{m}**", "", "| Favourite probability (%) | Fights | Said | Won |", "|---|---|---|---|"]
        out += [f"| {b} | {n:,} | {_pct(said)} | {_pct(won)} |" for b, n, said, won in p["models"][m]["calibration"]]
        out += [""]
    me = p["method"]
    out += ["## Method pick", "",
            f"Over {me['n']:,} held-out fights that ended by KO/TKO, submission or decision, the picked method "
            f"matched the actual method {_pct(me['accuracy'])} of the time, regardless of who won. "
            f"For comparison, {_pct(me['decision_share'])} of those fights ended by decision. Both models "
            "share the same method pick.", "",
            "## Picks game", "",
            "5 points for the right winner and the right method, 2 for the right winner alone, 0 otherwise; "
            "a probability of exactly 50% is no call and scores 0.", "",
            "| Model | Fights | Points | Points per fight |", "|---|---|---|---|"]
    out += [f"| {m} | {p['models'][m]['picks']['n']:,} | {p['models'][m]['picks']['total']:,} | "
            f"{p['models'][m]['picks']['per_fight']:.3f} |" for m in (elo_v, form_v)]
    out += ["", "## Gate", "",
            f"Per model: the three most recent held-out years with at least {GATE_MIN_FIGHTS} scored fights. "
            f"The model passes when its log loss is below {LN2:.4f} (a coin flip) in at least two of them and its "
            f"pooled Brier over all held-out years is at most {GATE_BRIER}.", "", "```"]
    out += [p["models"][m]["gate"]["line"] for m in (elo_v, form_v)]
    out += ["```", "", "## How to reproduce", "", "```bash",
            "export PYTHONPATH=backend:.",
            "# <db url> is a SQLAlchemy URL for a new local file, <db file>",
            'DB="<db url>"',
            "rm -f <db file>",
            '.venv/bin/python -c "import sys; from sqlalchemy import create_engine; import app.models; '
            'from app.db import Base; Base.metadata.create_all(create_engine(sys.argv[1]))" "$DB"',
            'DATABASE_URL="$DB" .venv/bin/python -m pipeline.sports.ufc_backfill --raw <raw dir> --to <date>',
            '.venv/bin/python -m pipeline.sports.ufc_evaluate --db "$DB" --out docs/UFC-EVALUATION.md --write-params',
            "```", ""]
    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--db", required=True, help="SQLAlchemy URL of a database with backfilled UFC history")
    ap.add_argument("--out", required=True, type=Path, help="where to write the markdown report")
    ap.add_argument("--first-holdout", type=int, default=2022)
    ap.add_argument("--write-params", action="store_true", help="also write the fitted parameter file")
    args = ap.parse_args(argv)
    engine = create_engine(args.db)
    try:
        with sessionmaker(bind=engine)() as db:
            _read_only_snapshot(db)
            payload = run(
                db, first_holdout=args.first_holdout,
                params_path=DEFAULT_PARAMS_FILE if args.write_params else None,
            )
    finally:
        engine.dispose()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render_report(payload))
    for m in payload["models"].values():
        print(m["gate"]["line"])
    print(f"report written to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
