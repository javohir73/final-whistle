"""Sections 3-5 of AUDIT.md: reconcile production fixtures/results against
football-data.co.uk, classify forecast recording, grade the frozen live
predictions and benchmark them against de-vigged closing odds.

Usage (from the worktree root)::

    PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit \\
        python docs/experiments/2026-11-20-football-model-audit/reconcile.py

Writes ``reconcile_results.json`` beside this file and the per-match
``live_matches.json`` under ``data/raw/football-audit-2026-11/derived/``.
"""
from __future__ import annotations

import collections
import json
from datetime import timedelta

from common import (
    CUTOFF, DERIVED, HOLDOUT, LEAGUES, OUT, brier, cluster_ci, fmt_ci, frozen, iso_week,
    load_api, load_fd, log_loss, parse_utc,
)
from ml.evaluation.market_benchmark import devig


def label_of(gh: int, ga: int) -> int:
    return 0 if gh > ga else (1 if gh == ga else 2)


def reconcile_league(league: str) -> tuple[dict, list[dict]]:
    fd = [m for m in load_fd(league, [HOLDOUT]) if m.date <= CUTOFF]
    api = load_api(league)
    by_pair = collections.defaultdict(list)
    for r in api:
        by_pair[(r["home_c"], r["away_c"])].append(r)

    issues = collections.Counter()
    examples = collections.defaultdict(list)
    matched_api_ids = set()
    graded: list[dict] = []

    for m in fd:
        rows = by_pair.get((m.home, m.away), [])
        for r in rows:
            matched_api_ids.add(r["match_id"])
        if not rows:
            issues["fd_match_missing_in_api"] += 1
            examples["fd_match_missing_in_api"].append(f"{m.date} {m.home}-{m.away}")
            continue
        if len(rows) > 1:
            issues["duplicate_api_rows"] += 1
            examples["duplicate_api_rows"].append(
                f"{m.date} {m.home}-{m.away}: " + ", ".join(
                    f"#{r['match_id']} {r['teams']['home']}-{r['teams']['away']} {r['status']}"
                    for r in rows))
        finished = [r for r in rows if r["status"] == "finished"]
        if not finished:
            issues["result_missing_in_api(stuck_or_never_finished)"] += 1
            examples["result_missing_in_api(stuck_or_never_finished)"].append(
                f"{m.date} {m.home}-{m.away} " + ",".join(f"#{r['match_id']}:{r['status']}" for r in rows))
            continue
        if len(finished) > 1:
            issues["multiple_finished_api_rows"] += 1
        r = finished[0]
        if (r["score_home"], r["score_away"]) != (m.gh, m.ga):
            issues["wrong_score"] += 1
            examples["wrong_score"].append(
                f"#{r['match_id']} {m.home}-{m.away} api {r['score_home']}-{r['score_away']} fd {m.gh}-{m.ga}")
        if m.kickoff_utc and r["kickoff"]:
            dh = (r["kickoff"] - m.kickoff_utc).total_seconds() / 3600
            if abs(dh) > 0.5:
                issues["kickoff_differs_>30min"] += 1
                examples["kickoff_differs_>30min"].append(
                    f"#{r['match_id']} {m.home}-{m.away} api {r['kickoff_utc']} fd {m.kickoff_utc.isoformat()} ({dh:+.1f}h)")
        fz = frozen(r)
        hist = r["history"]
        post = [h for h in (hist or []) if parse_utc(h["generated_at"]) > r["kickoff"]]
        rec = {
            "league": league, "match_id": r["match_id"], "date": m.date,
            "week": iso_week(m.date), "matchweek": r.get("matchweek"),
            "home": m.home, "away": m.away,
            "api_home_name": r["teams"]["home"], "api_away_name": r["teams"]["away"],
            "gh": m.gh, "ga": m.ga, "label": m.label,
            "kickoff_utc": r["kickoff_utc"],
            "n_history_rows": None if hist is None else len(hist),
            "n_post_kickoff_rows": len(post),
            "frozen": fz,
            "odds": m.odds,
        }
        if hist is None:
            rec["recording"] = "history_not_fetched"
        elif not hist:
            rec["recording"] = "never_predicted"
        elif fz is None:
            rec["recording"] = "only_post_kickoff_predictions"
        else:
            rec["recording"] = "frozen_pre_kickoff"
            lead = (r["kickoff"] - parse_utc(fz["generated_at"])).total_seconds() / 3600
            rec["lead_hours"] = lead
            # Results the frozen row could not know: matches of either club that
            # kicked off after it was generated and before this kickoff.
            gen = parse_utc(fz["generated_at"])
            rec["unseen_team_results"] = sum(
                1 for o in fd
                if o.kickoff_utc and gen < o.kickoff_utc + timedelta(hours=2) <= r["kickoff"]
                and ({o.home, o.away} & {m.home, m.away}) and o is not m
            )
        graded.append(rec)

    api_unmatched = [r for r in api if r["match_id"] not in matched_api_ids]
    for r in api_unmatched:
        past = r["kickoff"] and r["kickoff"].date().isoformat() <= CUTOFF
        if r["status"] == "finished" and past:
            issues["api_finished_not_in_fd"] += 1
            examples["api_finished_not_in_fd"].append(
                f"#{r['match_id']} {r['kickoff_utc'][:10]} {r['teams']['home']}-{r['teams']['away']}")
        elif r["status"] != "finished" and past:
            issues["api_past_kickoff_not_finished_unmatched"] += 1
            examples["api_past_kickoff_not_finished_unmatched"].append(
                f"#{r['match_id']} {r['kickoff_utc'][:10]} {r['teams']['home']}-{r['teams']['away']} {r['status']}")

    teams = collections.Counter()
    for r in api:
        teams[r["teams"]["home"]] += 1
        teams[r["teams"]["away"]] += 1
    canon_teams = {}
    for name in teams:
        from common import canon
        canon_teams.setdefault(canon(name), []).append(name)
    dup_entities = {k: v for k, v in canon_teams.items() if len(v) > 1}

    summary = {
        "league": league,
        "fd_matches_to_cutoff": len(fd),
        "api_rows": len(api),
        "api_status": dict(collections.Counter(r["status"] for r in api)),
        "api_team_names": len(teams),
        "duplicate_team_entities": dup_entities,
        "issues": dict(issues),
        "examples": {k: v[:40] for k, v in examples.items()},
        "recording": dict(collections.Counter(g["recording"] for g in graded)),
    }
    return summary, graded


def grade(graded: list[dict]) -> dict:
    """Grade frozen pre-kickoff rows; market = AvgC proportional de-vig."""
    rows = [g for g in graded if g["recording"] == "frozen_pre_kickoff"]
    out = {"n_graded": len(rows)}
    if not rows:
        return out
    ll, br, acc = [], [], []
    d_mkt = collections.defaultdict(list)
    d_mkt_bfe = collections.defaultdict(list)
    d_mkt_shin = collections.defaultdict(list)
    mkt_ll = []
    model_ll_on_mkt = []
    for g in rows:
        p = (g["frozen"]["home_win"], g["frozen"]["draw"], g["frozen"]["away_win"])
        s = sum(p)
        p = tuple(x / s for x in p)
        i = g["label"]
        ll.append(log_loss(p, i))
        br.append(brier(p, i))
        acc.append(1.0 if max(range(3), key=lambda k: p[k]) == i else 0.0)
        if "AvgC" in g["odds"]:
            q = devig(*g["odds"]["AvgC"])
            mkt_ll.append(log_loss(q, i))
            model_ll_on_mkt.append(log_loss(p, i))
            d_mkt[g["week"]].append(log_loss(p, i) - log_loss(q, i))
            qs = devig(*g["odds"]["AvgC"], method="shin")
            d_mkt_shin[g["week"]].append(log_loss(p, i) - log_loss(qs, i))
        if "BFEC" in g["odds"]:
            qb = devig(*g["odds"]["BFEC"])
            d_mkt_bfe[g["week"]].append(log_loss(p, i) - log_loss(qb, i))
    n = len(rows)
    out.update({
        "model_1x2_ll": sum(ll) / n,
        "model_brier": sum(br) / n,
        "model_accuracy": sum(acc) / n,
        "n_with_avgc": len(mkt_ll),
        "market_avgc_ll": sum(mkt_ll) / len(mkt_ll) if mkt_ll else None,
        "model_ll_on_market_rows": sum(model_ll_on_mkt) / len(model_ll_on_mkt) if mkt_ll else None,
        "model_minus_market_avgc": cluster_ci(d_mkt),
        "model_minus_market_avgc_shin": cluster_ci(d_mkt_shin),
        "model_minus_market_bfec": cluster_ci(d_mkt_bfe),
        "lead_hours_median": sorted(g["lead_hours"] for g in rows)[n // 2],
        "lead_hours_max": max(g["lead_hours"] for g in rows),
        "frozen_older_than_48h": sum(1 for g in rows if g["lead_hours"] > 48),
        "frozen_with_unseen_team_results": sum(1 for g in rows if g["unseen_team_results"] > 0),
        "frozen_model_versions": dict(collections.Counter(g["frozen"]["model_version"] for g in rows)),
    })
    return out


def ucl_live() -> dict:
    api = load_api("ucl")
    fin = [r for r in api if r["status"] == "finished" and r["kickoff"]
           and r["kickoff"].date().isoformat() <= CUTOFF]
    rec = collections.Counter()
    ll, br, acc = [], [], []
    by_stage = collections.Counter()
    for r in fin:
        fz = frozen(r)
        if r["history"] is None:
            rec["history_not_fetched"] += 1
        elif not r["history"]:
            rec["never_predicted"] += 1
        elif fz is None:
            rec["only_post_kickoff_predictions"] += 1
        else:
            rec["frozen_pre_kickoff"] += 1
            by_stage[r["stage"]] += 1
            p = (fz["home_win"], fz["draw"], fz["away_win"])
            s = sum(p)
            p = tuple(x / s for x in p)
            gh = r["score_home_90"] if r["score_home_90"] is not None else r["score_home"]
            ga = r["score_away_90"] if r["score_away_90"] is not None else r["score_away"]
            i = label_of(gh, ga)
            ll.append(log_loss(p, i))
            br.append(brier(p, i))
            acc.append(1.0 if max(range(3), key=lambda k: p[k]) == i else 0.0)
    n = len(ll)
    stuck = [r for r in api if r["status"] == "scheduled" and r["kickoff"]
             and r["kickoff"].date().isoformat() <= CUTOFF]
    return {
        "api_rows": len(api), "finished_to_cutoff": len(fin), "recording": dict(rec),
        "graded_by_stage": dict(by_stage),
        "stuck_scheduled": [f"#{r['match_id']} {r['kickoff_utc'][:10]} {r['teams']['home']}-{r['teams']['away']} ({r['stage']})" for r in stuck],
        "model_1x2_ll": sum(ll) / n if n else None,
        "model_brier": sum(br) / n if n else None,
        "model_accuracy": sum(acc) / n if n else None,
        "n_graded": n,
    }


def post_kickoff_writes() -> dict:
    """Production rows written after kickoff, across every fetched fixture."""
    out = {}
    for league in list(LEAGUES) + ["ucl"]:
        n_matches = n_rows = 0
        for r in load_api(league):
            if not r["history"] or r["kickoff"] is None:
                continue
            post = [h for h in r["history"] if parse_utc(h["generated_at"]) > r["kickoff"]]
            if post:
                n_matches += 1
                n_rows += len(post)
        out[league] = {"matches_with_post_kickoff_rows": n_matches, "post_kickoff_rows": n_rows}
    return out


def main() -> None:
    results = {"leagues": {}, "graded": {}}
    all_graded = []
    for league in LEAGUES:
        summary, graded = reconcile_league(league)
        results["leagues"][league] = summary
        results["graded"][league] = grade(graded)
        all_graded.extend(graded)
    results["ucl"] = ucl_live()
    results["post_kickoff_writes"] = post_kickoff_writes()
    # Why are some finished matches missing a frozen prediction? Break down by
    # the fixture's first prediction time relative to kickoff.
    reasons = collections.Counter()
    for g in all_graded:
        if g["recording"] == "frozen_pre_kickoff":
            continue
        dup = g["api_home_name"] != g["home"] or g["api_away_name"] != g["away"]
        reasons[(g["league"], g["recording"], "duplicate-entity row" if dup else "canonical row")] += 1
    results["missing_frozen_breakdown"] = {" | ".join(k): v for k, v in sorted(reasons.items())}
    (OUT / "reconcile_results.json").write_text(json.dumps(results, indent=1, default=str))
    DERIVED.mkdir(parents=True, exist_ok=True)
    (DERIVED / "live_matches.json").write_text(json.dumps(all_graded, indent=0, default=str))

    for league, s in results["leagues"].items():
        print(f"== {league}: fd {s['fd_matches_to_cutoff']} | api rows {s['api_rows']} {s['api_status']} | team names {s['api_team_names']}")
        print("   dup entities:", s["duplicate_team_entities"])
        print("   issues:", s["issues"])
        print("   recording:", s["recording"])
        g = results["graded"][league]
        if g.get("n_graded"):
            print(f"   graded {g['n_graded']}: LL {g['model_1x2_ll']:.4f} Brier {g['model_brier']:.4f} acc {g['model_accuracy']:.3f} | "
                  f"market AvgC LL {g['market_avgc_ll']:.4f} (n {g['n_with_avgc']}) | model-market {fmt_ci(g['model_minus_market_avgc'])} | "
                  f"BFEC {fmt_ci(g['model_minus_market_bfec'])} | shin {fmt_ci(g['model_minus_market_avgc_shin'])}")
            print(f"   lead h median {g['lead_hours_median']:.1f} max {g['lead_hours_max']:.1f}; >48h {g['frozen_older_than_48h']}; with unseen results {g['frozen_with_unseen_team_results']}; versions {g['frozen_model_versions']}")
    print("== ucl", {k: v for k, v in results["ucl"].items() if k != "stuck_scheduled"})
    print("   stuck:", results["ucl"]["stuck_scheduled"])
    print("== post-kickoff writes", results["post_kickoff_writes"])
    print("== missing frozen breakdown", results["missing_frozen_breakdown"])


if __name__ == "__main__":
    main()
