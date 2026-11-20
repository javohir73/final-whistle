"""Descriptive context for AUDIT.md (not gate inputs): outcome calibration in
the large for the graded live rows, the UCL record against a base-rate
reference, and the sample a re-run needs.

Usage::

    PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit \\
        python docs/experiments/2026-11-20-football-model-audit/descriptives.py
"""
from __future__ import annotations

import json
import math

from common import CUTOFF, DERIVED, OUT, frozen, load_api, log_loss
from ml.evaluation.market_benchmark import devig


def main() -> None:
    out = {}
    live = json.loads((DERIVED / "live_matches.json").read_text())
    for league in ("epl", "laliga", "bundesliga"):
        rows = [g for g in live if g["league"] == league and g["recording"] == "frozen_pre_kickoff"]
        n = len(rows)
        mean_p = [sum(g["frozen"][k] for g in rows) / n for k in ("home_win", "draw", "away_win")]
        mkt = [devig(*g["odds"]["AvgC"]) for g in rows if "AvgC" in g["odds"]]
        mean_m = [sum(q[i] for q in mkt) / len(mkt) for i in range(3)]
        actual = [sum(1 for g in rows if g["label"] == i) / n for i in range(3)]
        out[league] = {"n": n, "model_mean_HDA": mean_p, "market_mean_HDA": mean_m,
                       "actual_HDA": actual}

    # UCL: live record vs the base rate of its own graded sample (an
    # in-sample, therefore flattering, reference).
    ucl = []
    for r in load_api("ucl"):
        if r["status"] != "finished" or not r["kickoff"] or r["kickoff"].date().isoformat() > CUTOFF:
            continue
        fz = frozen(r)
        if fz is None:
            continue
        gh = r["score_home_90"] if r["score_home_90"] is not None else r["score_home"]
        ga = r["score_away_90"] if r["score_away_90"] is not None else r["score_away"]
        i = 0 if gh > ga else (1 if gh == ga else 2)
        p = (fz["home_win"], fz["draw"], fz["away_win"])
        s = sum(p)
        ucl.append((tuple(x / s for x in p), i, r["stage"]))
    for stage in ("all", "qualifying", "group"):
        rows = [u for u in ucl if stage == "all" or u[2] == stage]
        if not rows:
            continue
        n = len(rows)
        freq = [sum(1 for u in rows if u[1] == k) / n for k in range(3)]
        out[f"ucl_{stage}"] = {
            "n": n,
            "model_ll": sum(log_loss(u[0], u[1]) for u in rows) / n,
            "base_rate_in_sample_ll": sum(-math.log(freq[u[1]]) for u in rows) / n,
            "actual_HDA": freq,
            "model_mean_HDA": [sum(u[0][k] for u in rows) / n for k in range(3)],
        }

    # Re-run sizing from the observed per-league intervals, assuming today's
    # point estimate is the true effect and SE shrinks as 1/sqrt(n):
    # - n_ci_excludes_0_at_95: the n at which the nominal 95% CI half-width
    #   equals the effect -- a coin flip (~50% power), NOT a decision-grade n;
    # - n_80pct_power_bonferroni: 80% power for the actual gate (two-sided
    #   97.5% Bonferroni interval, z 2.241 + 0.842).
    # Post-review correction (2026-11-20): the first version reported only the
    # former and called it "the sample a decision needs".
    def size(n, mean, half):
        se = half / 1.96
        return {
            "n_now": n, "mean": mean, "half_width_95": half,
            "n_ci_excludes_0_at_95": math.ceil(n * (half / abs(mean)) ** 2),
            "n_80pct_power_bonferroni": math.ceil(n * ((2.241 + 0.842) * se / abs(mean)) ** 2),
        }

    cand = json.loads((OUT / "candidates_results.json").read_text())
    sizing = {}
    for league in ("epl", "laliga", "bundesliga"):
        for c in ("R1", "U1"):
            r = cand[league][f"{c}_minus_C0_1x2"]
            lo, hi = r["ci95"]
            if r["mean"] < 0:
                sizing[f"{league}_{c}"] = size(r["n"], r["mean"], (hi - lo) / 2)
    pooled = cand["pooled"]["R1_1x2"]
    lo, hi = pooled["ci95"]
    sizing["pooled_R1"] = size(pooled["n"], pooled["mean"], (hi - lo) / 2)
    widths = {}
    for league in ("epl", "laliga", "bundesliga"):
        w = {c: cand[league][f"{c}_minus_C0_1x2"]["ci95"][1] - cand[league][f"{c}_minus_C0_1x2"]["ci95"][0]
             for c in ("R1", "U1")}
        widths[league] = round(w["U1"] / w["R1"], 2)
    out["u1_over_r1_ci95_width"] = widths
    out["rerun_sizing"] = sizing
    (OUT / "descriptives_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
