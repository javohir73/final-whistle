"""Control fidelity: which reading of serving reproduces the served 2026-27
league-phase probabilities? Scores no candidate.

    PYTHONPATH=backend:. python docs/experiments/2026-11-27-ucl-rating-scale/fidelity.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402


def main() -> None:
    ucl, dom, report = core.load_all()
    print("data report:", json.dumps({k: v for k, v in report.items() if k != "no_feed_clubs"}, indent=1))
    ctrl = core.ucl_only_rolling(ucl)
    domr = core.domestic_alone(dom, ucl)
    cur = [m for m in ucl if m.season == core.CURRENT and m.scored and m.served]
    rows, out = [], {}
    for name in ("CTRL_ucl_only", "CTRL_alt"):
        gaps, lls, sll = [], [], []
        for m in cur:
            rh, ra = ctrl[id(m)]
            if name == "CTRL_alt":
                d = domr.get(id(m), {})
                rh, ra = d.get(m.home, rh), d.get(m.away, ra)
            p = core.probs(rh, ra)
            gaps.append(sum(abs(p[i] - m.served[i]) for i in range(3)) / 3)
            lls.append(core.ll(p, m.outcome))
            sll.append(core.ll(m.served, m.outcome))
            if name == "CTRL_ucl_only":
                rows.append((m.date, m.home, m.away, rh, ra, p, m.served))
        out[name] = {"n": len(cur), "mean_abs_prob_gap": sum(gaps) / len(gaps),
                     "max_abs_prob_gap": max(gaps), "logloss": sum(lls) / len(lls),
                     "served_logloss": sum(sll) / len(sll)}
        print(f"{name:14s} n={len(cur)} mean|Δp|={out[name]['mean_abs_prob_gap']:.4f} "
              f"max={out[name]['max_abs_prob_gap']:.4f} LL={out[name]['logloss']:.4f} "
              f"(served LL {out[name]['served_logloss']:.4f})")
    print("\nlargest CTRL_ucl_only gaps (date home away  pre_h pre_a  offline  served):")
    rows.sort(key=lambda r: -sum(abs(r[5][i] - r[6][i]) for i in range(3)))
    for d, h, a, rh, ra, p, s in rows[:12]:
        print(f"  {d} {h:24s} {a:24s} {rh:7.1f} {ra:7.1f}  "
              f"{p[0]:.3f}/{p[1]:.3f}/{p[2]:.3f}  {s[0]:.3f}/{s[1]:.3f}/{s[2]:.3f}")
    # clubs entering the 2026-27 league phase with no rated UCL match offline
    seen = set()
    for m in ucl:
        if m.season < core.CURRENT or (m.season == core.CURRENT and not m.scored):
            seen |= {m.home, m.away}
    field = {c for m in cur for c in (m.home, m.away)}
    cold = sorted(field - seen)
    print("\nleague-phase clubs with no offline UCL history:", cold)
    out["cold_start_clubs_offline"] = cold
    out["control"] = min(("CTRL_ucl_only", "CTRL_alt"), key=lambda k: out[k]["mean_abs_prob_gap"])
    print("-> control:", out["control"])
    (core.OUT / "fidelity_results.json").write_text(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
