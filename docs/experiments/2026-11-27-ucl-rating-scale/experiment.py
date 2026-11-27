"""Selection, then (separately, once) confirmation, for the pre-registered
UCL rating-scale candidates. See EVIDENCE.md section 1 for the protocol.

    PYTHONPATH=backend:. python <dir>/experiment.py select     # writes frozen.json
    PYTHONPATH=backend:. python <dir>/experiment.py confirm    # needs frozen.json
    PYTHONPATH=backend:. python <dir>/experiment.py current    # 2026-27 descriptive

`select` never touches a confirmation or 2026-27 match: the guard below
raises if the scored set contains one.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import core  # noqa: E402
import names  # noqa: E402
from ml.evaluation.calibration import apply_vector_scaling, fit_vector_scaling  # noqa: E402

FROZEN = core.OUT / "frozen.json"
DELTA_GRID = [float(d) for d in range(-100, 301, 10)]
C1_FIRST_FIT_SEASON = "2014-15"
CANDS = ("C1_offset", "C2_unified", "C3_unified_cal")


def source(club: str) -> str:
    c = names.country(club)
    if c in core.BIG3:
        return "ENG/ESP/GER"
    return "other covered league" if c in names.COVERED else "no domestic feed"


class World:
    """All ratings, computed once (each replay is leak-free on its own)."""

    def __init__(self) -> None:
        self.ucl, self.dom, self.report = core.load_all()
        self.ctrl = core.ucl_only_rolling(self.ucl)
        self.uni, self.uni_n = core.unified(self.ucl, self.dom)

    def scored(self, seasons) -> list[core.Match]:
        return [m for m in self.ucl if m.scored and m.season in seasons]

    def p_ctrl(self, m):
        return core.probs(*self.ctrl[id(m)])

    def p_c1(self, m, delta):
        rh, ra = self.ctrl[id(m)]
        rh += delta if names.country(m.home) in core.BIG3 else 0.0
        ra += delta if names.country(m.away) in core.BIG3 else 0.0
        return core.probs(rh, ra)

    def p_c2(self, m):
        return core.probs(*self.uni[id(m)])

    def p_c2_raw(self, m):
        return core.probs(*self.uni[id(m)], calibrator=None)


def fit_delta(w: World, seasons) -> float:
    ms = w.scored(seasons)
    return min(DELTA_GRID, key=lambda d: sum(core.ll(w.p_c1(m, d), m.outcome) for m in ms) / len(ms))


def fit_cal(w: World, seasons) -> dict:
    ms = w.scored(seasons)
    t, b = fit_vector_scaling([w.p_c2_raw(m) for m in ms], [m.outcome for m in ms])
    return {"method": "vector_scaling", "t": t, "b": list(b), "fit_seasons": list(seasons),
            "n": len(ms)}


def p_c3(w: World, m, cal: dict):
    return apply_vector_scaling(w.p_c2_raw(m), cal["t"], tuple(cal["b"]))


def metrics(ms, ps) -> dict:
    n = len(ms)
    out = {
        "n": n,
        "logloss": sum(core.ll(p, m.outcome) for m, p in zip(ms, ps)) / n,
        "brier": sum(core.brier(p, m.outcome) for m, p in zip(ms, ps)) / n,
        "accuracy": sum(max(range(3), key=lambda i: p[i]) == m.outcome for m, p in zip(ms, ps)) / n,
        "draw_pred": sum(p[1] for p in ps) / n,
        "draw_obs": sum(m.outcome == 1 for m in ms) / n,
        "max_fav_prob": max(max(p[0], p[2]) for p in ps),
        "min_draw_prob": min(p[1] for p in ps),
    }
    cal: dict[str, list[float]] = {}
    for m, p in zip(ms, ps):
        for club, pw, pd_, won, drew in ((m.home, p[0], p[1], m.outcome == 0, m.outcome == 1),
                                         (m.away, p[2], p[1], m.outcome == 2, m.outcome == 1)):
            s = cal.setdefault(source(club), [0, 0.0, 0.0])
            s[0] += 1
            s[1] += 3 * won + drew
            s[2] += 3 * pw + pd_
    out["points_by_source"] = {k: {"team_games": v[0], "actual_ppg": v[1] / v[0],
                                   "expected_ppg": v[2] / v[0], "diff_ppg": (v[1] - v[2]) / v[0]}
                               for k, v in sorted(cal.items())}
    return out


def compare(name, ms, p_cand, p_ctrl) -> dict:
    d = [core.ll(a, m.outcome) - core.ll(b, m.outcome) for m, a, b in zip(ms, p_cand, p_ctrl)]
    ci = core.clustered(d, [m.date for m in ms])
    return {"candidate": name, "n": ci["n"], "clusters": ci["n_seasons"], "mean_delta": ci["mean"],
            "ci95": list(ci["ci95"]), "verdict": ci["verdict"],
            "metrics": metrics(ms, p_cand)}


def fmt(r: dict) -> str:
    m = r["metrics"]
    lines = [f"{r['candidate']:16s} ΔLL {r['mean_delta']:+.4f}  CI95 [{r['ci95'][0]:+.4f}, {r['ci95'][1]:+.4f}]"
             f"  n={r['n']}/{r['clusters']} wk  -> {r['verdict']}",
             f"    LL {m['logloss']:.4f}  Brier {m['brier']:.4f}  acc {m['accuracy']:.3f}  "
             f"draw pred {m['draw_pred']:.3f} obs {m['draw_obs']:.3f}  "
             f"max fav {m['max_fav_prob']:.3f}  min draw {m['min_draw_prob']:.3f}"]
    for k, v in m["points_by_source"].items():
        lines.append(f"    {k:22s} {v['team_games']:4d} tg  actual {v['actual_ppg']:.2f}  "
                     f"exp {v['expected_ppg']:.2f}  diff {v['diff_ppg']:+.2f}")
    return "\n".join(lines)


def control_block(ms, w) -> dict:
    pc = [w.p_ctrl(m) for m in ms]
    return {"candidate": "CONTROL", "metrics": metrics(ms, pc)}, pc


def print_control(c):
    m = c["metrics"]
    print(f"CONTROL          LL {m['logloss']:.4f}  Brier {m['brier']:.4f}  acc {m['accuracy']:.3f}  "
          f"draw pred {m['draw_pred']:.3f} obs {m['draw_obs']:.3f}  max fav {m['max_fav_prob']:.3f}  "
          f"min draw {m['min_draw_prob']:.3f}")
    for k, v in m["points_by_source"].items():
        print(f"    {k:22s} {v['team_games']:4d} tg  actual {v['actual_ppg']:.2f}  "
              f"exp {v['expected_ppg']:.2f}  diff {v['diff_ppg']:+.2f}")


def select() -> None:
    w = World()
    ms = w.scored(core.SELECTION)
    assert all(m.season in core.SELECTION for m in ms)
    assert not any(m.season in core.CONFIRMATION + (core.CURRENT,) for m in ms)
    ctrl, pc = control_block(ms, w)
    print(f"SELECTION {core.SELECTION}: {len(ms)} matches\n")
    print_control(ctrl)

    all_seasons = core.data.UCL_SEASONS
    deltas, cals, p1, p3 = {}, {}, [], []
    for s in core.SELECTION:
        prior = [x for x in all_seasons if C1_FIRST_FIT_SEASON <= x < s]
        deltas[s] = fit_delta(w, prior)
        i = all_seasons.index(s)
        cals[s] = fit_cal(w, all_seasons[i - 3:i])
    for m in ms:
        p1.append(w.p_c1(m, deltas[m.season]))
        p3.append(p_c3(w, m, cals[m.season]))
    p2 = [w.p_c2(m) for m in ms]
    res = [compare("C1_offset", ms, p1, pc), compare("C2_unified", ms, p2, pc),
           compare("C3_unified_cal", ms, p3, pc)]
    res[0]["walk_forward"] = deltas
    res[2]["walk_forward"] = cals
    for r in res:
        print(fmt(r))
    print("\nC1 walk-forward δ:", deltas)
    print("C3 walk-forward calibrators:", {k: (v["t"], v["b"]) for k, v in cals.items()})

    # Freeze final configs (pre-confirmation data only).
    pre_conf = [x for x in all_seasons if C1_FIRST_FIT_SEASON <= x <= "2023-24"]
    frozen = {
        "C1_offset": {"delta": fit_delta(w, pre_conf), "fit_seasons": pre_conf},
        "C2_unified": {"tier_seed": core.TIER_SEED, "nofeed_prior": core.NOFEED_PRIOR,
                       "newcomer_drop": core.NEWCOMER_DROP, "shrink_n0": core.SHRINK_N0},
        "C3_unified_cal": fit_cal(w, list(core.SELECTION)),
    }
    passers = [r for r in res if r["ci95"][1] < 0]
    frozen["designated"] = min(passers, key=lambda r: r["mean_delta"])["candidate"] if passers else None
    print("\nFROZEN:", json.dumps(frozen))
    FROZEN.write_text(json.dumps(frozen, indent=2))
    (core.OUT / "selection_results.json").write_text(json.dumps(
        {"control": ctrl, "candidates": res, "data_report": {k: v for k, v in w.report.items()}},
        indent=2, default=str))


def score_frozen(seasons, label: str, out_name: str) -> None:
    frozen = json.loads(FROZEN.read_text())
    w = World()
    ms = w.scored(seasons)
    ctrl, pc = control_block(ms, w)
    print(f"{label} {seasons}: {len(ms)} matches  (frozen config, no refit)\n")
    print_control(ctrl)
    p1 = [w.p_c1(m, frozen["C1_offset"]["delta"]) for m in ms]
    p2 = [w.p_c2(m) for m in ms]
    p3 = [p_c3(w, m, frozen["C3_unified_cal"]) for m in ms]
    res = [compare("C1_offset", ms, p1, pc), compare("C2_unified", ms, p2, pc),
           compare("C3_unified_cal", ms, p3, pc)]
    extra = {}
    if seasons == (core.CURRENT,):
        ps = [m.served for m in ms]
        extra["served"] = metrics(ms, ps)
        d = [core.ll(a, m.outcome) - core.ll(b, m.outcome) for m, a, b in zip(ms, ps, pc)]
        ci = core.clustered(d, [m.date for m in ms])
        print(f"SERVED (actual)  LL {extra['served']['logloss']:.4f}  vs offline control ΔLL "
              f"{ci['mean']:+.4f}")
        for k, v in extra["served"]["points_by_source"].items():
            print(f"    {k:22s} {v['team_games']:4d} tg  actual {v['actual_ppg']:.2f}  "
                  f"exp {v['expected_ppg']:.2f}  diff {v['diff_ppg']:+.2f}")
        # per-club points vs expected, served and C3
        clubs: dict[str, list[float]] = {}
        for m, ps_, p3_, p2_ in zip(ms, ps, p3, p2):
            for club, i, won in ((m.home, 0, m.outcome == 0), (m.away, 2, m.outcome == 2)):
                c = clubs.setdefault(club, [0.0, 0.0, 0.0, 0.0])
                c[0] += 3 * won + (m.outcome == 1)
                c[1] += 3 * ps_[i] + ps_[1]
                c[2] += 3 * p2_[i] + p2_[1]
                c[3] += 3 * p3_[i] + p3_[1]
        extra["per_club_points"] = {k: {"actual": v[0], "served_exp": round(v[1], 2),
                                        "c2_exp": round(v[2], 2), "c3_exp": round(v[3], 2)}
                                    for k, v in clubs.items()}
        print("\n  club                       pts  served-exp  C2-exp  C3-exp")
        for k, v in sorted(clubs.items(), key=lambda kv: kv[1][0] - kv[1][1]):
            print(f"  {k:26s} {v[0]:3.0f}  {v[1]:9.1f}  {v[2]:6.1f}  {v[3]:6.1f}")
        print("\n  extreme favourites (served max side >= 0.80):")
        for m, ps_, p2_, p3_ in zip(ms, ps, p2, p3):
            if max(ps_[0], ps_[2]) >= 0.80:
                print(f"  {m.home} v {m.away} {m.gh}-{m.ga}: served {ps_[0]:.2f}/{ps_[1]:.2f}/{ps_[2]:.2f}"
                      f"  C2 {p2_[0]:.2f}/{p2_[1]:.2f}/{p2_[2]:.2f}  C3 {p3_[0]:.2f}/{p3_[1]:.2f}/{p3_[2]:.2f}")
        print()
    for r in res:
        print(fmt(r))
    (core.OUT / out_name).write_text(json.dumps(
        {"frozen": frozen, "control": ctrl, "candidates": res, **extra}, indent=2, default=str))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "select":
        select()
    elif mode == "confirm":
        print("!! CONFIRMATION — consuming quarantined 2024-25 and 2025-26 once.\n")
        score_frozen(core.CONFIRMATION, "CONFIRMATION", "confirmation_results.json")
    elif mode == "current":
        score_frozen((core.CURRENT,), "2026-27 LEAGUE PHASE (descriptive)", "current_results.json")
    else:
        raise SystemExit("usage: experiment.py select|confirm|current")
