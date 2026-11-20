"""NRL audit, part 3: which margin should be served?

Compares, on 2023-2026 with the shipped winner parameters:
  (i)   the winner model's built-in margin (0.045 x rating gap incl. home advantage)
  (ii)  a least-squares line margin ~ rating gap, refitted on seasons before each test season
  (iii) the score model's margin, read from the harness's predictions.jsonl

Usage (from the repo root):
    PYTHONPATH=backend:. python docs/experiments/2026-11-20-nrl-model-audit/margin_check.py \
        --db artifacts/nrl_backtests/audit-2026-11-20/nrl.db \
        --predictions artifacts/nrl_backtests/nrl-score-v0.1-shadow-2023-2026-5ecd28b7912c/predictions.jsonl
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from candidates import Spec, load_rows, mean, step  # noqa: E402

from ml.sports.nrl.evaluation import cluster_bootstrap_ci  # noqa: E402
from ml.sports.nrl.model import predict, regress_season  # noqa: E402
from ml.sports.nrl.params import load_nrl_params  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--predictions", required=True)
    args = ap.parse_args()
    by_season = load_rows(args.db)
    params = load_nrl_params()
    spec = Spec(params)
    score = {}
    for line in Path(args.predictions).read_text().splitlines():
        rec = json.loads(line)
        score[rec["match_id"]] = rec["margin"]["model"]

    elos: dict[int, float] = {}
    history: list[tuple[int, float, float]] = []   # (season, gap, actual margin)
    rows = []
    first = True
    for season in sorted(by_season):
        if not first:
            elos = regress_season(elos, params)
        first = False
        prior = [(g, a) for s, g, a in history if s < season]
        if len(prior) > 50:
            mx, my = mean(g for g, _ in prior), mean(a for _, a in prior)
            slope = sum((g - mx) * (a - my) for g, a in prior) / sum((g - mx) ** 2 for g, _ in prior)
            intercept = my - slope * mx
        else:
            slope, intercept = None, None
        for m in by_season[season]:
            eh, ea = elos.get(m["home_team_id"], 1500.0), elos.get(m["away_team_id"], 1500.0)
            actual = m["score_home"] - m["score_away"]
            built_in = predict(eh, ea, params)["expected_margin"]
            if season >= 2023:
                rows.append({
                    "season": season, "round": m["round"], "actual": actual,
                    "built_in": built_in, "fitted": slope * (eh - ea) + intercept,
                    "score_model": score[m["match_id"]],
                    "fav_home": (eh + params.home_adv) >= ea,
                })
            history.append((season, eh - ea, actual))
            step(elos, m, spec)
        if season >= 2023:
            print(f"{season}: fitted line on prior seasons: slope {slope:.5f} intercept {intercept:.3f}")

    keys = [(r["season"], r["round"]) for r in rows]
    print(f"\nn = {len(rows)}")
    for name in ("built_in", "fitted", "score_model"):
        mae = mean(abs(r[name] - r["actual"]) for r in rows)
        bias = mean(r[name] - r["actual"] for r in rows)
        decided = [r for r in rows if r["actual"] != 0]
        sign = mean(1.0 if (r[name] > 0) == (r["actual"] > 0) else 0.0 for r in decided)
        against = sum(1 for r in rows if (r[name] > 0) != r["fav_home"])
        print(f"{name:12s} MAE {mae:.3f}  bias {bias:+.3f}  winner-sign accuracy {sign:.4f}  "
              f"margin points against the win-probability favourite in {against} of {len(rows)}")
    for a, b in (("score_model", "built_in"), ("fitted", "built_in"), ("score_model", "fitted")):
        deltas = [abs(r[a] - r["actual"]) - abs(r[b] - r["actual"]) for r in rows]
        lo, hi = cluster_bootstrap_ci(deltas, keys, samples=10_000, seed=2026)
        per = {s: round(mean(d for d, r in zip(deltas, rows) if r["season"] == s), 3) for s in (2023, 2024, 2025, 2026)}
        print(f"MAE {a} - {b}: {mean(deltas):+.3f}  ci95 [{lo:+.3f}, {hi:+.3f}]  by season {per}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
