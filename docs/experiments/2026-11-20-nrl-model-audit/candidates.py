"""NRL audit, part 2: nested walk-forward comparison of refit/upgrade recipes.

Implements exactly the protocol, recipes and gates written in AUDIT.md section 0.
Read-only against the local SQLite copy; writes results.json next to this file.

Usage (from the repo root):
    PYTHONPATH=backend:. python docs/experiments/2026-11-20-nrl-model-audit/candidates.py \
        --db artifacts/nrl_backtests/audit-2026-11-20/nrl.db
"""
from __future__ import annotations

import argparse
import json
import math
import sqlite3
from collections import defaultdict
from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
from pathlib import Path

from ml.sports.nrl.backtest import class_freqs_from_matches, evaluate_season, replay_seasons, tune
from ml.sports.nrl.evaluation import cluster_bootstrap_ci
from ml.sports.nrl.model import NrlParams, expected_home_prob, regress_season
from ml.sports.nrl.params import load_nrl_params

ALIASES = {"Tigers": "Wests Tigers"}
TEST_SEASONS = tuple(range(2019, 2027))
EPS = 1e-15

GRID = {
    "k": [8.0, 12.0, 16.0, 20.0, 24.0, 28.0, 32.0, 36.0, 44.0],
    "home_adv": [15.0, 25.0, 35.0, 45.0, 55.0, 65.0, 80.0],
    "margin_mult_cap": [1.0, 1.4, 1.8, 2.2, 2.6, 3.0],
    "season_regress": [0.15, 0.25, 0.35, 0.45, 0.55, 0.65],
}
TAU_GRID = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3]
P_DRAW_FLOOR = 0.004


@dataclass(frozen=True)
class Spec:
    params: NrlParams
    tau: float = 1.0        # prediction-time sharpness; 1.0 = the shipped model
    damp: bool = False      # damp the margin multiplier by the rating gap


def load_rows(db_path: str) -> dict[int, list[dict]]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    names = {r["id"]: r["name"] for r in con.execute("SELECT id, name FROM sport_teams WHERE sport='nrl'")}
    canon_id = {}
    by_name = {v: k for k, v in names.items()}
    for team_id, name in names.items():
        canon_id[team_id] = by_name[ALIASES.get(name, name)]
    by_season: dict[int, list[dict]] = defaultdict(list)
    for r in con.execute(
        "SELECT id, season, round, kickoff_utc, home_team_id, away_team_id, score_home, score_away "
        "FROM sport_matches WHERE sport='nrl' AND status='finished' ORDER BY kickoff_utc, id"
    ):
        kickoff = datetime.fromisoformat(r["kickoff_utc"]).replace(tzinfo=timezone.utc)
        by_season[r["season"]].append({
            "match_id": r["id"], "season": r["season"], "round": r["round"], "kickoff_utc": kickoff,
            "home_team_id": canon_id[r["home_team_id"]], "away_team_id": canon_id[r["away_team_id"]],
            "score_home": r["score_home"], "score_away": r["score_away"],
        })
    return dict(by_season)


def probs(elo_home: float, elo_away: float, spec: Spec) -> tuple[float, float, float]:
    p = spec.params
    raw = expected_home_prob(elo_home, elo_away, p.home_adv)
    if spec.tau != 1.0:
        raw = min(1 - 1e-12, max(1e-12, raw))
        raw = 1.0 / (1.0 + math.exp(-math.log(raw / (1 - raw)) / spec.tau))
    return raw * (1 - p.p_draw), p.p_draw, (1 - raw) * (1 - p.p_draw)


def step(elos: dict[int, float], m: dict, spec: Spec) -> None:
    p = spec.params
    eh, ea = elos.get(m["home_team_id"], 1500.0), elos.get(m["away_team_id"], 1500.0)
    expected = expected_home_prob(eh, ea, p.home_adv)
    margin = m["score_home"] - m["score_away"]
    if margin == 0:
        w, mult = 0.5, 1.0
    else:
        w = 1.0 if margin > 0 else 0.0
        mult = min(math.log(abs(margin) + 1.0), p.margin_mult_cap)
        if spec.damp:
            gap = abs((eh + p.home_adv) - ea)
            mult *= 2.2 / (0.001 * gap + 2.2)
    delta = p.k * mult * (w - expected)
    elos[m["home_team_id"]] = eh + delta
    elos[m["away_team_id"]] = ea - delta


def walk(by_season: dict[int, list[dict]], spec: Spec, score_seasons: set[int]) -> list[dict]:
    """Walk every season in order; return one scored record per match in `score_seasons`."""
    elos: dict[int, float] = {}
    out: list[dict] = []
    first = True
    for season in sorted(by_season):
        if not first:
            elos = regress_season(elos, spec.params)
        first = False
        for m in by_season[season]:
            if season in score_seasons:
                ph, pd, pa = probs(elos.get(m["home_team_id"], 1500.0), elos.get(m["away_team_id"], 1500.0), spec)
                idx = 0 if m["score_home"] > m["score_away"] else (2 if m["score_home"] < m["score_away"] else 1)
                triple = (ph, pd, pa)
                out.append({
                    "season": season, "round": m["round"], "match_id": m["match_id"],
                    "p_home": ph, "outcome": idx,
                    "ll": -math.log(min(1 - EPS, max(EPS, triple[idx]))),
                    "brier": sum((triple[k] - (1.0 if k == idx else 0.0)) ** 2 for k in range(3)),
                    "correct": int(max(range(3), key=lambda k: triple[k]) == idx),
                })
            step(elos, m, spec)
    return out


def mean(values) -> float:
    values = list(values)
    return sum(values) / len(values)


def objective(by_season: dict[int, list[dict]], spec: Spec) -> float:
    seasons = sorted(by_season)
    return mean(r["ll"] for r in walk(by_season, spec, set(seasons[1:])))


def draw_rate(by_season: dict[int, list[dict]]) -> float:
    matches = [m for rows in by_season.values() for m in rows]
    return max(P_DRAW_FLOOR, sum(m["score_home"] == m["score_away"] for m in matches) / len(matches))


def fit_wide(prior: dict[int, list[dict]], with_tau: bool = False, damp: bool = False) -> Spec:
    """Coordinate descent (3 passes) from the shipped parameters on the pooled
    walk-forward log loss of `prior` (first season is burn-in)."""
    start = load_nrl_params()
    spec = Spec(replace(start, p_draw=draw_rate(prior)), damp=damp)
    for _ in range(3):
        for field, grid in GRID.items():
            best_v, best = getattr(spec.params, field), objective(prior, spec)
            for v in grid:
                trial = replace(spec, params=replace(spec.params, **{field: v}))
                ll = objective(prior, trial)
                if ll < best - 1e-12:
                    best, best_v = ll, v
            spec = replace(spec, params=replace(spec.params, **{field: best_v}))
        if with_tau:
            best_v, best = spec.tau, objective(prior, spec)
            for v in TAU_GRID:
                ll = objective(prior, replace(spec, tau=v))
                if ll < best - 1e-12:
                    best, best_v = ll, v
            spec = replace(spec, tau=best_v)
    return spec


def fit_incumbent(prior: dict[int, list[dict]], season: int) -> Spec:
    train = {s: rows for s, rows in prior.items() if s <= season - 2}
    return Spec(tune(train, prior[season - 1]))


def ece(records: list[dict], bins: int = 10) -> float:
    buckets: dict[int, list[dict]] = defaultdict(list)
    for r in records:
        buckets[min(bins - 1, int(r["p_home"] * bins))].append(r)
    n = len(records)
    return sum(
        len(b) / n * abs(mean(r["p_home"] for r in b) - mean(1.0 if r["outcome"] == 0 else 0.0 for r in b))
        for b in buckets.values()
    )


def summary(records: list[dict]) -> dict:
    return {
        "n": len(records),
        "log_loss": mean(r["ll"] for r in records),
        "brier": mean(r["brier"] for r in records),
        "accuracy": mean(r["correct"] for r in records),
        "ece": ece(records),
    }


def paired(a: list[dict], b: list[dict]) -> dict:
    """a - b on log loss, matched by match_id."""
    bmap = {r["match_id"]: r for r in b}
    deltas = [r["ll"] - bmap[r["match_id"]]["ll"] for r in a]
    keys = [(r["season"], r["round"]) for r in a]
    lo, hi = cluster_bootstrap_ci(deltas, keys, samples=10_000, seed=2026)
    per_season: dict[int, list[float]] = defaultdict(list)
    for r, d in zip(a, deltas):
        per_season[r["season"]].append(d)
    by = {s: mean(v) for s, v in sorted(per_season.items())}
    return {
        "mean_delta": mean(deltas), "ci95": [lo, hi], "clusters": len(set(keys)),
        "by_season": by, "seasons_better": sum(v < 0 for v in by.values()), "seasons": len(by),
    }


def gate(cand: list[dict], base: list[dict], shipped_2026: list[dict]) -> dict:
    p = paired(cand, base)
    cand_2026 = mean(r["ll"] for r in cand if r["season"] == 2026)
    ship_2026 = mean(r["ll"] for r in shipped_2026)
    checks = {
        "1_point_negative_and_ci_upper_le_0": p["mean_delta"] < 0 and p["ci95"][1] <= 0,
        "1a_point_negative": p["mean_delta"] < 0,
        "2_better_in_5_of_8": p["seasons_better"] >= 5,
        "3_2026_not_worse_than_shipped_by_0.002": cand_2026 - ship_2026 <= 0.002,
        "4_ece_not_worse_by_0.01": ece(cand) - ece(base) <= 0.01,
    }
    if all(checks[k] for k in checks if k != "1a_point_negative"):
        verdict = "PASS"
    elif checks["1a_point_negative"] and checks["2_better_in_5_of_8"] and checks["3_2026_not_worse_than_shipped_by_0.002"] and checks["4_ece_not_worse_by_0.01"]:
        verdict = "COLLECT MORE EVIDENCE"
    else:
        verdict = "FAIL"
    return {"paired": p, "delta_2026_vs_shipped": cand_2026 - ship_2026, "checks": checks, "verdict": verdict}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    args = ap.parse_args()
    by_season = load_rows(args.db)
    shipped = load_nrl_params()
    print("seasons:", {s: len(v) for s, v in sorted(by_season.items())})
    print("shipped:", shipped)

    # Sanity: this file's walk must reproduce the repo's own evaluate_season.
    prior = {s: by_season[s] for s in by_season if s < 2026}
    mine = mean(r["ll"] for r in walk(by_season, Spec(shipped), {2026}))
    snaps = replay_seasons(prior, shipped)
    theirs = evaluate_season(
        by_season[2026], regress_season(snaps[2025], shipped), shipped,
        class_freqs_from_matches([m for rows in prior.values() for m in rows]),
    )["log_loss"]
    print(f"sanity, shipped params on 2026: this script {mine:.10f}  repo evaluate_season {theirs:.10f}")
    assert abs(mine - theirs) < 1e-9

    recipes = {
        "R0": lambda prior, season: fit_incumbent(prior, season),
        "R1": lambda prior, season: fit_wide(prior),
        "R2": lambda prior, season: fit_wide(prior, with_tau=True),
        "R4": lambda prior, season: fit_wide(prior, damp=True),
    }
    records: dict[str, list[dict]] = {name: [] for name in recipes}
    chosen: dict[str, dict[int, dict]] = {name: {} for name in recipes}
    for season in TEST_SEASONS:
        prior = {s: by_season[s] for s in by_season if s < season}
        upto = {s: by_season[s] for s in by_season if s <= season}
        for name, fit in recipes.items():
            spec = fit(prior, season)
            chosen[name][season] = {
                **{k: v for k, v in asdict(spec.params).items() if k in ("k", "home_adv", "margin_mult_cap", "season_regress", "p_draw")},
                "tau": spec.tau, "damp": spec.damp,
            }
            records[name].extend(walk(upto, spec, {season}))

    assert chosen["R0"][2026]["k"] == shipped.k and chosen["R0"][2026]["season_regress"] == shipped.season_regress, \
        "R0's 2026 fold is expected to be the shipped parameter set"
    shipped_2026 = walk(by_season, Spec(shipped), {2026})

    print("\nparameters chosen per fold")
    for name in recipes:
        for season in TEST_SEASONS:
            c = chosen[name][season]
            print(f"  {name} {season}: k={c['k']:<4} home_adv={c['home_adv']:<4} cap={c['margin_mult_cap']:<3} "
                  f"regress={c['season_regress']:<4} p_draw={c['p_draw']:.4f} tau={c['tau']} damp={c['damp']}")

    print("\nlog loss by season (nested walk-forward)")
    print("  season   n   " + "  ".join(f"{name:>7}" for name in recipes))
    for season in TEST_SEASONS:
        row = [mean(r["ll"] for r in records[name] if r["season"] == season) for name in recipes]
        n = sum(1 for r in records["R0"] if r["season"] == season)
        print(f"  {season}  {n:4d}  " + "  ".join(f"{v:7.4f}" for v in row))
    print("\npooled 2019-2026")
    summaries = {name: summary(records[name]) for name in recipes}
    for name, s in summaries.items():
        print(f"  {name}: n={s['n']} log_loss={s['log_loss']:.4f} brier={s['brier']:.4f} acc={s['accuracy']:.4f} ece={s['ece']:.4f}")
    s26 = summary(shipped_2026)
    print(f"  shipped params, 2026 only: n={s26['n']} log_loss={s26['log_loss']:.4f} brier={s26['brier']:.4f} acc={s26['accuracy']:.4f}")

    gates = {
        "R1_vs_R0": gate(records["R1"], records["R0"], shipped_2026),
        "R2_vs_R1": gate(records["R2"], records["R1"], shipped_2026),
        "R4_vs_R1": gate(records["R4"], records["R1"], shipped_2026),
        "R2_vs_R0": gate(records["R2"], records["R0"], shipped_2026),
        "R4_vs_R0": gate(records["R4"], records["R0"], shipped_2026),
    }
    print("\ngates")
    for name, g in gates.items():
        p = g["paired"]
        print(f"  {name}: delta={p['mean_delta']:+.5f} ci95=[{p['ci95'][0]:+.5f}, {p['ci95'][1]:+.5f}] "
              f"better in {p['seasons_better']}/{p['seasons']} seasons; 2026 vs shipped {g['delta_2026_vs_shipped']:+.5f}; {g['verdict']}")
        print("     by season:", {s: round(v, 4) for s, v in p["by_season"].items()})
        print("     checks:", g["checks"])

    final = {name: fit(by_season, 2027) for name, fit in recipes.items() if name != "R0"}
    print("\nparameters each recipe would ship for 2027 (fitted on 2017-2026)")
    for name, spec in final.items():
        print(f"  {name}: {asdict(spec.params)} tau={spec.tau} damp={spec.damp}")

    out = Path(__file__).with_name("results.json")
    out.write_text(json.dumps({
        "data_cutoff": "2026-10-04", "test_seasons": list(TEST_SEASONS),
        "shipped": asdict(shipped), "chosen": chosen, "summaries": summaries,
        "shipped_2026": s26, "gates": gates,
        "final_2027": {n: {**asdict(s.params), "tau": s.tau, "damp": s.damp} for n, s in final.items()},
    }, indent=1, default=str) + "\n")
    print("wrote", out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
