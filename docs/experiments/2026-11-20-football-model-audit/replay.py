"""Section 6 of AUDIT.md: replay the graded live matches through the repo's
model code from public data and explain the live-vs-replay gap.

Three prices per 2026-27 match with a frozen live prediction:

- ``live``   the frozen production row (from reconcile.py)
- ``asof``   C0 (served params) on Elo ratings replayed ONLY from results that
             had finished by the time the frozen row was generated -- the same
             information production had
- ``fresh``  C0 on ratings replayed from every result before kickoff -- the
             model as designed, with a daily refresh that never missed

live - asof isolates what the replay cannot reproduce (odds anchoring,
availability, duplicate cold-start entities, history drift); asof - fresh is
the cost of stale ratings (pipeline outages).

Usage::

    PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit \\
        python docs/experiments/2026-11-20-football-model-audit/replay.py
"""
from __future__ import annotations

import collections
import json
import re
from datetime import timedelta

from common import (
    DERIVED, LEAGUES, OUT, cluster_ci, fmt_ci, load_api, load_fd, log_loss, parse_utc,
)
from ml.models.poisson import predict_match
from ml.ratings.elo import BASE_RATING, update_ratings
from pipeline.leagues import club_params_for

RESULT_LAG = timedelta(hours=2)  # kickoff -> result available, for "as-of"


def served_params(league: str):
    return club_params_for(league)


def price(params, home_adv: float, rh: float, ra: float):
    pred = predict_match(
        rh, ra, home_adv=home_adv, base=params.base, beta=params.beta,
        rho=params.rho, temperature=params.temperature, calibrator=params.calibrator,
    )
    return (pred.prob_home_win, pred.prob_draw, pred.prob_away_win)


def ratings_before(matches, stop, home_adv: float, competition: str) -> dict[str, float]:
    """Elo after every match for which ``stop(match)`` is False, in order."""
    ratings: dict[str, float] = {}
    for m in matches:
        if stop(m):
            continue
        rh = ratings.get(m.home, BASE_RATING)
        ra = ratings.get(m.away, BASE_RATING)
        ratings[m.home], ratings[m.away] = update_ratings(
            rh, ra, m.gh, m.ga, competition=competition, is_neutral=False,
            home_advantage=home_adv,
        )
    return ratings


def _ko(m):
    # Files before 2019-20 carry no kickoff time; a date-only match counts as
    # kicking off at noon UTC, which is only ever compared with 2026 instants.
    from datetime import datetime, timezone
    if m.kickoff_utc is not None:
        return m.kickoff_utc
    return datetime.fromisoformat(m.date).replace(hour=12, tzinfo=timezone.utc)


_ELO_RE = re.compile(r"^(?P<fav>.+?) has a (?:much )?higher Elo rating \((?P<a>\d+) vs (?P<b>\d+)\)\.$")


def main() -> None:
    live = json.loads((DERIVED / "live_matches.json").read_text())
    out_rows = []
    summary = {}
    for league, (_div, competition, home_adv) in LEAGUES.items():
        params = served_params(league)
        fd = load_fd(league)
        api_by_id = {r["match_id"]: r for r in load_api(league)}
        rows = [g for g in live if g["league"] == league and g["recording"] == "frozen_pre_kickoff"]
        # One fresh replay over everything gives every match's pre-match pair.
        fresh_pre = {}
        ratings: dict[str, float] = {}
        for m in fd:
            rh = ratings.get(m.home, BASE_RATING)
            ra = ratings.get(m.away, BASE_RATING)
            if m.season == "2627":
                fresh_pre[(m.home, m.away)] = (rh, ra)
            ratings[m.home], ratings[m.away] = update_ratings(
                rh, ra, m.gh, m.ga, competition=competition, is_neutral=False,
                home_advantage=home_adv,
            )
        asof_cache: dict[str, dict] = {}
        d_live_asof = collections.defaultdict(list)
        d_asof_fresh = collections.defaultdict(list)
        d_live_fresh = collections.defaultdict(list)
        absdiff_by_gen = collections.defaultdict(list)
        elo_check = collections.Counter()
        elo_err = []
        for g in rows:
            gen = parse_utc(g["frozen"]["generated_at"])
            key = g["frozen"]["generated_at"]
            if key not in asof_cache:
                asof_cache[key] = ratings_before(
                    fd, lambda m, gen=gen: not (_ko(m) + RESULT_LAG <= gen),
                    home_adv, competition)
            r_asof = asof_cache[key]
            rh_a = r_asof.get(g["home"], BASE_RATING)
            ra_a = r_asof.get(g["away"], BASE_RATING)
            # Production rated the duplicate football-data.org entities from a
            # 1500 cold start (their history sits on a different Team row).
            dup_home = g["api_home_name"] not in (g["home"],) and g["api_home_name"] != g["home"]
            dup_away = g["api_away_name"] != g["away"]
            rh_f, ra_f = fresh_pre[(g["home"], g["away"])]
            p_live = (g["frozen"]["home_win"], g["frozen"]["draw"], g["frozen"]["away_win"])
            s = sum(p_live)
            p_live = tuple(x / s for x in p_live)
            p_asof = price(params, home_adv, rh_a, ra_a)
            p_fresh = price(params, home_adv, rh_f, ra_f)
            i = g["label"]
            w = g["week"]
            d_live_asof[w].append(log_loss(p_live, i) - log_loss(p_asof, i))
            d_asof_fresh[w].append(log_loss(p_asof, i) - log_loss(p_fresh, i))
            d_live_fresh[w].append(log_loss(p_live, i) - log_loss(p_fresh, i))
            absdiff = max(abs(a - b) for a, b in zip(p_live, p_asof))
            absdiff_by_gen[g["frozen"]["generated_at"][:10]].append(absdiff)
            # Cross-check the Elo pair production printed in its reasons text
            # (only possible when the served "current" row IS the frozen one).
            cur = api_by_id[g["match_id"]].get("current_pred") or {}
            if cur.get("generated_at") == g["frozen"]["generated_at"]:
                for reason in cur.get("reasons") or []:
                    mt = _ELO_RE.match(reason)
                    if mt:
                        prod_pair = sorted((int(mt["a"]), int(mt["b"])))
                        rep_pair = sorted((round(rh_a), round(ra_a)))
                        err = max(abs(x - y) for x, y in zip(prod_pair, rep_pair))
                        elo_err.append(err)
                        elo_check["within_5" if err <= 5 else ("within_25" if err <= 25 else "off_>25")] += 1
                        if err > 25:
                            elo_check_examples = summary.setdefault(f"{league}_elo_mismatch", [])
                            elo_check_examples.append(
                                f"#{g['match_id']} {g['api_home_name']}-{g['api_away_name']} prod {prod_pair} replay {rep_pair}")
            out_rows.append({
                "league": league, "match_id": g["match_id"], "week": w, "label": i,
                "generated_at": g["frozen"]["generated_at"], "kickoff_utc": g["kickoff_utc"],
                "dup_entity": dup_home or dup_away,
                "elo_asof": (rh_a, ra_a), "elo_fresh": (rh_f, ra_f),
                "p_live": p_live, "p_asof": p_asof, "p_fresh": p_fresh,
                "unseen_team_results": g["unseen_team_results"],
            })
        n = len(rows)
        lr = [r for r in out_rows if r["league"] == league]
        summary[league] = {
            "n": n,
            "ll_live": sum(log_loss(r["p_live"], r["label"]) for r in lr) / n,
            "ll_asof": sum(log_loss(r["p_asof"], r["label"]) for r in lr) / n,
            "ll_fresh": sum(log_loss(r["p_fresh"], r["label"]) for r in lr) / n,
            "live_minus_asof": cluster_ci(d_live_asof),
            "asof_minus_fresh": cluster_ci(d_asof_fresh),
            "live_minus_fresh": cluster_ci(d_live_fresh),
            "max_abs_prob_diff_live_vs_asof_by_generation_day": {
                k: {"n": len(v), "median": sorted(v)[len(v) // 2], "max": max(v)}
                for k, v in sorted(absdiff_by_gen.items())},
            "elo_reason_check": dict(elo_check),
            "elo_reason_err_median": sorted(elo_err)[len(elo_err) // 2] if elo_err else None,
            "mean_abs_elo_staleness": sum(
                abs((r["elo_asof"][0] - r["elo_asof"][1]) - (r["elo_fresh"][0] - r["elo_fresh"][1]))
                for r in lr) / n,
        }
    (OUT / "replay_results.json").write_text(json.dumps(summary, indent=1, default=str))
    (DERIVED / "replay_matches.json").write_text(json.dumps(out_rows, indent=0, default=str))
    for league, s in summary.items():
        if league not in LEAGUES:
            continue
        print(f"== {league} n={s['n']}  LL live {s['ll_live']:.4f} | asof {s['ll_asof']:.4f} | fresh {s['ll_fresh']:.4f}")
        print(f"   live-asof {fmt_ci(s['live_minus_asof'])} | asof-fresh {fmt_ci(s['asof_minus_fresh'])} | live-fresh {fmt_ci(s['live_minus_fresh'])}")
        print(f"   elo check {s['elo_reason_check']} median err {s['elo_reason_err_median']} | mean |Δgap| stale vs fresh {s['mean_abs_elo_staleness']:.1f} Elo")
        print("   max|Δp| live vs asof by frozen day:", {k: (v['n'], round(v['median'], 4), round(v['max'], 4)) for k, v in s['max_abs_prob_diff_live_vs_asof_by_generation_day'].items()})
        if f"{league}_elo_mismatch" in summary:
            print("   elo mismatches:", summary[f"{league}_elo_mismatch"][:12])


if __name__ == "__main__":
    main()
