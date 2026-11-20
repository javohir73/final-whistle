"""Section 7 of AUDIT.md: score the pre-registered candidates C0 / R1 / U1 on
the 2026-27 holdout (section 2 of AUDIT.md fixes every choice made here).

Usage::

    PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit \\
        python docs/experiments/2026-11-20-football-model-audit/candidates.py

Writes ``candidates_results.json`` and ``r1_params.json`` beside this file.

Re-runs (winter break, season end) must score the configs frozen on
2026-11-20, not refit them: football-data.co.uk revises past files in place, so
a refit could silently move the candidates. Pass ``--frozen`` to load
``frozen_candidates.json`` (R1 parameters + calibrator, U1 half-life) and write
``candidates_results_frozen.json`` instead::

    python docs/experiments/2026-11-20-football-model-audit/candidates.py --frozen
"""
from __future__ import annotations

import argparse
import collections
import json
import math
from dataclasses import replace
from datetime import date, timedelta

import numpy as np
from scipy.optimize import minimize

from common import CUTOFF, HOLDOUT, LEAGUES, OUT, cluster_ci, fmt_ci, iso_week, load_fd, log_loss
from ml.evaluation.calibration import calibrate, effective_gap
from ml.evaluation.club_calibration import fit_segmented, quantile_edges
from ml.evaluation.club_walkforward import (
    ClubMatch, EloConfig, GridConfig, loss_1x2, loss_totals, replay,
)
from ml.evaluation.market_benchmark import devig, devig2
from ml.models.poisson import expected_goals_from_elo, outcome_probabilities, score_matrix
from pipeline.leagues import club_params_for

BURN_IN = "1617"
U1_HALF_LIVES = (90.0, 180.0, 365.0)
U1_RIDGE = 1.0
U1_RHO = -0.06


def _frange(lo, hi, step, nd=4):
    out, x = [], lo
    while x <= hi + step / 2:
        out.append(round(x, nd))
        x += step
    return out


def to_club(fd) -> list[ClubMatch]:
    return [ClubMatch(season=m.season, home=m.home, away=m.away,
                      goals_home=m.gh, goals_away=m.ga, date=m.date) for m in fd]


def p_over(matrix, line=2.5) -> float:
    tot = sum(sum(r) for r in matrix)
    po = sum(matrix[h][a] for h in range(len(matrix)) for a in range(len(matrix[h])) if h + a > line)
    return min(max(po / tot, 1e-12), 1 - 1e-12)


def served(league: str) -> tuple[EloConfig, GridConfig]:
    p = club_params_for(league)
    return (EloConfig(home_adv=LEAGUES[league][2]),
            GridConfig(base=p.base, beta=p.beta, rho=p.rho,
                       temperature=p.temperature, calibrator=p.calibrator))


def price_elo(pre, elo: EloConfig, grid: GridConfig, cal_override=None):
    lam_h, lam_a = expected_goals_from_elo(pre[0], pre[1], home_adv=elo.home_adv,
                                           base=grid.base, beta=grid.beta)
    mat = score_matrix(lam_h, lam_a, rho=grid.rho)
    raw = outcome_probabilities(mat)
    cal = grid.calibrator if cal_override is None else cal_override
    probs = calibrate(raw, cal, grid.temperature,
                      eff_gap=effective_gap(pre[0], pre[1], elo.home_adv))
    return probs, p_over(mat), raw


# --------------------------------------------------------------------- R1

def fit_r1(league: str, matches: list[ClubMatch]) -> tuple[EloConfig, GridConfig, dict]:
    competition = LEAGUES[league][1]
    c_elo, c_grid = served(league)
    train_idx = [i for i, m in enumerate(matches) if m.season not in (BURN_IN, HOLDOUT)]
    sub = [matches[i] for i in train_idx]

    def mean(v):
        return sum(v) / len(v)

    trace = {}
    # 1. home_adv on 1X2 (each value needs its own replay)
    best = None
    for h in _frange(20.0, 120.0, 10.0):
        e = replace(c_elo, home_adv=h)
        pre = replay(matches, e, competition)
        loss = mean(loss_1x2(sub, [pre[i] for i in train_idx], e, c_grid))
        if best is None or loss < best[0]:
            best = (loss, h, pre)
    _, home_adv, pre_all = best
    elo = replace(c_elo, home_adv=home_adv)
    pre_sub = [pre_all[i] for i in train_idx]
    trace["home_adv"] = home_adv
    grid = c_grid
    # 2. base on O/U 2.5
    grid = replace(grid, base=min(_frange(1.10, 1.80, 0.02),
                                  key=lambda b: mean(loss_totals(sub, pre_sub, elo, replace(grid, base=b)))))
    trace["base"] = grid.base
    # 3. beta on 1X2
    grid = replace(grid, beta=min(_frange(0.0010, 0.0035, 0.0001, nd=5),
                                  key=lambda b: mean(loss_1x2(sub, pre_sub, elo, replace(grid, beta=b)))))
    trace["beta"] = grid.beta
    # 4. rho on 1X2
    grid = replace(grid, rho=min(_frange(-0.20, 0.00, 0.01),
                                 key=lambda r: mean(loss_1x2(sub, pre_sub, elo, replace(grid, rho=r)))))
    trace["rho"] = grid.rho
    # 5. calibrator recut (q3) on the uncalibrated triples
    raws, labels, gaps = [], [], []
    for m, pre in zip(sub, pre_sub):
        _, _, raw = price_elo(pre, elo, grid)
        raws.append(raw)
        labels.append(0 if m.goals_home > m.goals_away else (1 if m.goals_home == m.goals_away else 2))
        gaps.append(effective_gap(pre[0], pre[1], elo.home_adv))
    blob = fit_segmented(raws, labels, gaps, quantile_edges(gaps, 3), min_bucket=200)
    grid = replace(grid, calibrator=blob)
    trace["calibrator"] = blob
    trace["train_seasons"] = sorted({m.season for m in sub})
    trace["n_train"] = len(sub)
    return elo, grid, trace


# --------------------------------------------------------------------- U1

def fit_dc(matches, ref_day: date, half_life: float):
    """Time-decayed Poisson team-strength fit on matches dated before ref_day."""
    horizon = ref_day - timedelta(days=int(4 * half_life))
    rows = [m for m in matches if horizon <= date.fromisoformat(m.date) < ref_day]
    teams = sorted({t for m in rows for t in (m.home, m.away)})
    ix = {t: k for k, t in enumerate(teams)}
    n = len(teams)
    hi = np.array([ix[m.home] for m in rows])
    ai = np.array([ix[m.away] for m in rows])
    yh = np.array([m.goals_home for m in rows], float)
    ya = np.array([m.goals_away for m in rows], float)
    age = np.array([(ref_day - date.fromisoformat(m.date)).days for m in rows], float)
    w = 0.5 ** (age / half_life)

    def f(theta):
        mu, home = theta[0], theta[1]
        att, dfn = theta[2:2 + n], theta[2 + n:]
        eh = mu + home + att[hi] + dfn[ai]
        ea = mu + att[ai] + dfn[hi]
        lh, la = np.exp(eh), np.exp(ea)
        nll = np.sum(w * (lh - yh * eh)) + np.sum(w * (la - ya * ea))
        nll += 0.5 * U1_RIDGE * (np.sum(att ** 2) + np.sum(dfn ** 2))
        rh = w * (lh - yh)
        ra = w * (la - ya)
        g = np.zeros_like(theta)
        g[0] = rh.sum() + ra.sum()
        g[1] = rh.sum()
        g_att = np.bincount(hi, rh, n) + np.bincount(ai, ra, n) + U1_RIDGE * att
        g_def = np.bincount(ai, rh, n) + np.bincount(hi, ra, n) + U1_RIDGE * dfn
        g[2:2 + n] = g_att
        g[2 + n:] = g_def
        return nll, g

    x0 = np.zeros(2 + 2 * n)
    x0[0] = math.log(max(1e-3, (yh.sum() + ya.sum()) / (2 * len(rows))))
    res = minimize(f, x0, jac=True, method="L-BFGS-B")
    th = res.x
    att = dict(zip(teams, th[2:2 + n]))
    dfn = dict(zip(teams, th[2 + n:]))
    weakest = sorted(teams, key=lambda t: att[t] - dfn[t])[:3]
    prior = (float(np.mean([att[t] for t in weakest])), float(np.mean([dfn[t] for t in weakest])))
    return {"mu": th[0], "home": th[1], "att": att, "def": dfn, "prior": prior}


def price_dc(model, home: str, away: str):
    ah, dh = (model["att"][home], model["def"][home]) if home in model["att"] else model["prior"]
    aa, da = (model["att"][away], model["def"][away]) if away in model["att"] else model["prior"]
    lam_h = math.exp(model["mu"] + model["home"] + ah + da)
    lam_a = math.exp(model["mu"] + aa + dh)
    mat = score_matrix(lam_h, lam_a, rho=U1_RHO)
    return outcome_probabilities(mat), p_over(mat)


def week_monday(day: str) -> date:
    d = date.fromisoformat(day)
    return d - timedelta(days=d.weekday())


def dc_season_prices(matches, season: str, half_life: float):
    out = {}
    cache = {}
    for k, m in enumerate(matches):
        if m.season != season or m.date > CUTOFF:
            continue
        mon = week_monday(m.date)
        if mon not in cache:
            cache[mon] = fit_dc(matches, mon, half_life)
        out[k] = price_dc(cache[mon], m.home, m.away)
    return out


# --------------------------------------------------------------------- main

def _frozen_r1(league: str, frozen: dict) -> tuple[EloConfig, GridConfig, dict]:
    c_elo, c_grid = served(league)
    f = frozen["R1"][league]
    elo = replace(c_elo, home_adv=f["home_adv"])
    grid = replace(c_grid, base=f["base"], beta=f["beta"], rho=f["rho"], calibrator=f["calibrator"])
    return elo, grid, f


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frozen", action="store_true",
                    help="score the configs frozen in frozen_candidates.json instead of refitting")
    args = ap.parse_args()
    frozen = json.loads((OUT / "frozen_candidates.json").read_text()) if args.frozen else None
    results = {}
    r1_params = {}
    pooled = collections.defaultdict(lambda: collections.defaultdict(list))
    for league in LEAGUES:
        competition = LEAGUES[league][1]
        fd = load_fd(league)
        matches = to_club(fd)
        hold = [k for k, m in enumerate(matches) if m.season == HOLDOUT and m.date <= CUTOFF]

        # C0
        c_elo, c_grid = served(league)
        pre_c0 = replay(matches, c_elo, competition)
        # R1
        if frozen:
            r_elo, r_grid, trace = _frozen_r1(league, frozen)
        else:
            r_elo, r_grid, trace = fit_r1(league, matches)
        r1_params[league] = trace
        pre_r1 = replay(matches, r_elo, competition)
        # U1: half-life selected on 2025-26
        sel = {}
        labels_all = [fd[k].label for k in range(len(fd))]
        if frozen:
            hl_best = frozen["U1"][league]["half_life"]
        else:
            for hl in U1_HALF_LIVES:
                pr = dc_season_prices(matches, "2526", hl)
                sel[hl] = sum(log_loss(p, labels_all[k]) for k, (p, _) in pr.items()) / len(pr)
            hl_best = min(sel, key=sel.get)
        u1 = dc_season_prices(matches, HOLDOUT, hl_best)

        per = {"C0": {}, "R1": {}, "U1": {}}
        for k in hold:
            m = fd[k]
            per["C0"][k] = price_elo(pre_c0[k], c_elo, c_grid)[:2]
            per["R1"][k] = price_elo(pre_r1[k], r_elo, r_grid)[:2]
            per["U1"][k] = u1[k]
        res = {"n": len(hold), "u1_half_life_selection_2526_1x2_ll": sel, "u1_half_life": hl_best,
               "r1": {k: v for k, v in trace.items() if k != "calibrator"},
               "r1_calibrator_edges": trace["calibrator"]["edges"]}
        mk_ll, mk_ou = [], []
        for name in per:
            ll = [log_loss(per[name][k][0], fd[k].label) for k in hold]
            ou = [-math.log(per[name][k][1] if fd[k].gh + fd[k].ga > 2.5 else 1 - per[name][k][1]) for k in hold]
            res[f"{name}_1x2_ll"] = sum(ll) / len(ll)
            res[f"{name}_ou_ll"] = sum(ou) / len(ou)
            # vs market
            dm = collections.defaultdict(list)
            for k in hold:
                if "AvgC" in fd[k].odds:
                    q = devig(*fd[k].odds["AvgC"])
                    dm[iso_week(fd[k].date)].append(log_loss(per[name][k][0], fd[k].label) - log_loss(q, fd[k].label))
            res[f"{name}_minus_market_1x2"] = cluster_ci(dm)
            dmo = collections.defaultdict(list)
            for k in hold:
                if "AvgC_OU" in fd[k].odds:
                    qo, _qu = devig2(*fd[k].odds["AvgC_OU"])
                    over = fd[k].gh + fd[k].ga > 2.5
                    po = per[name][k][1]
                    dmo[iso_week(fd[k].date)].append(
                        -math.log(po if over else 1 - po) + math.log(qo if over else 1 - qo))
            res[f"{name}_minus_market_ou"] = cluster_ci(dmo)
        for k in hold:
            if "AvgC" in fd[k].odds:
                mk_ll.append(log_loss(devig(*fd[k].odds["AvgC"]), fd[k].label))
            if "AvgC_OU" in fd[k].odds:
                qo, _ = devig2(*fd[k].odds["AvgC_OU"])
                over = fd[k].gh + fd[k].ga > 2.5
                mk_ou.append(-math.log(qo if over else 1 - qo))
        res["market_1x2_ll"] = sum(mk_ll) / len(mk_ll)
        res["market_ou_ll"] = sum(mk_ou) / len(mk_ou)
        res["n_market_1x2"] = len(mk_ll)
        for cand in ("R1", "U1"):
            d1 = collections.defaultdict(list)
            d2 = collections.defaultdict(list)
            for k in hold:
                w = iso_week(fd[k].date)
                i = fd[k].label
                d1[w].append(log_loss(per[cand][k][0], i) - log_loss(per["C0"][k][0], i))
                over = fd[k].gh + fd[k].ga > 2.5
                pc, p0 = per[cand][k][1], per["C0"][k][1]
                d2[w].append(-math.log(pc if over else 1 - pc) + math.log(p0 if over else 1 - p0))
                pooled[cand + "_1x2"][f"{league}:{w}"].append(d1[w][-1])
                pooled[cand + "_ou"][f"{league}:{w}"].append(d2[w][-1])
            res[f"{cand}_minus_C0_1x2"] = cluster_ci(d1)
            res[f"{cand}_minus_C0_ou"] = cluster_ci(d2)
        results[league] = res
    results["pooled"] = {k: cluster_ci(v) for k, v in pooled.items()}
    if frozen:
        (OUT / "candidates_results_frozen.json").write_text(json.dumps(results, indent=1, default=str))
    else:
        (OUT / "candidates_results.json").write_text(json.dumps(results, indent=1, default=str))
        (OUT / "r1_params.json").write_text(json.dumps(r1_params, indent=1, default=str))

    for league in LEAGUES:
        r = results[league]
        print(f"== {league} n={r['n']}  U1 half-life {r['u1_half_life']} (2526 LL {r['u1_half_life_selection_2526_1x2_ll']})")
        print(f"   R1 fit: {r['r1']} edges {r['r1_calibrator_edges']}")
        print(f"   1X2 LL  C0 {r['C0_1x2_ll']:.4f}  R1 {r['R1_1x2_ll']:.4f}  U1 {r['U1_1x2_ll']:.4f}  market {r['market_1x2_ll']:.4f}")
        print(f"   O/U LL  C0 {r['C0_ou_ll']:.4f}  R1 {r['R1_ou_ll']:.4f}  U1 {r['U1_ou_ll']:.4f}  market {r['market_ou_ll']:.4f}")
        for cand in ("R1", "U1"):
            print(f"   {cand}-C0 1X2 {fmt_ci(r[f'{cand}_minus_C0_1x2'])} (97.5: {fmt_ci(r[f'{cand}_minus_C0_1x2'], 'ci97.5')}) | O/U {fmt_ci(r[f'{cand}_minus_C0_ou'])}")
        for name in ("C0", "R1", "U1"):
            print(f"   {name}-market 1X2 {fmt_ci(r[f'{name}_minus_market_1x2'])} | O/U {fmt_ci(r[f'{name}_minus_market_ou'])}")
    for k, v in results["pooled"].items():
        print(f"== pooled {k}: {fmt_ci(v)} (97.5: {fmt_ci(v, 'ci97.5')})")


if __name__ == "__main__":
    main()
