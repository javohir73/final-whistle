"""NRL audit, part 1: data reconciliation and live-versus-replay.

Inputs (all read-only):
  --db     local SQLite built by `pipeline.sports.nrl_ingest --seasons 2017 2026`
  --prod   directory of production API snapshots (matches-YYYY.json, model-record.json)
  --official  official_results.json from fetch_official_results.py (optional)

Prints a plain-text report; writes nothing to any database.

Usage (from the repo root):
    PYTHONPATH=backend:. python docs/experiments/2026-11-20-nrl-model-audit/audit_data.py \
        --db artifacts/nrl_backtests/audit-2026-11-20/nrl.db \
        --prod artifacts/nrl_backtests/audit-2026-11-20/prod \
        --official artifacts/nrl_backtests/audit-2026-11-20/official/official_results.json
"""
from __future__ import annotations

import argparse
import collections
import json
import math
import sqlite3
import statistics
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ml.sports.nrl.model import predict, regress_season, update
from ml.sports.nrl.params import load_nrl_params

ALIASES = {"Tigers": "Wests Tigers"}
# Official nickname -> feed name, where they differ.
OFFICIAL_NAMES = {"Wests Tigers": "Wests Tigers"}


def parse_dt(value: str) -> datetime:
    dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load_feed(db_path: str) -> list[dict]:
    con = sqlite3.connect(db_path)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        """SELECT m.id, m.season, m.round, m.match_no, m.kickoff_utc, m.venue, m.status,
                  m.score_home, m.score_away, h.name AS home, a.name AS away
           FROM sport_matches m
           JOIN sport_teams h ON h.id = m.home_team_id
           JOIN sport_teams a ON a.id = m.away_team_id
           WHERE m.sport = 'nrl'"""
    ).fetchall()
    out = [dict(r) for r in rows]
    for r in out:
        r["kickoff"] = parse_dt(r["kickoff_utc"])
    out.sort(key=lambda r: (r["kickoff"], r["id"]))
    return out


def load_prod(prod_dir: Path) -> list[dict]:
    out = []
    for path in sorted(prod_dir.glob("matches-*.json")):
        doc = json.loads(path.read_text())
        for rnd in doc.get("rounds", []):
            for m in rnd["matches"]:
                out.append({**m, "season": doc["season"], "round": rnd.get("round")})
    return out


def section(title: str) -> None:
    print(f"\n=== {title} ===")


def reconcile_feed_vs_prod(feed: list[dict], prod: list[dict]) -> None:
    section("1. Feed (fixturedownload.com, fetched today) vs production database (public API)")
    fkey = {(r["season"], r["match_no"]): r for r in feed}
    pkey = {(r["season"], r["match_no"]): r for r in prod}
    print(f"feed rows {len(feed)}, production rows {len(prod)}")
    print(f"only in feed: {len(set(fkey) - set(pkey))}, only in production: {len(set(pkey) - set(fkey))}")
    diffs = collections.Counter()
    examples = []
    for key in sorted(set(fkey) & set(pkey)):
        f, p = fkey[key], pkey[key]
        if (f["home"], f["away"]) != (p["home"], p["away"]):
            diffs["teams"] += 1
            examples.append(("teams", key, (f["home"], f["away"]), (p["home"], p["away"])))
        if (f["score_home"], f["score_away"]) != (p["score_home"], p["score_away"]):
            diffs["score"] += 1
            examples.append(("score", key, (f["score_home"], f["score_away"]), (p["score_home"], p["score_away"])))
        if f["status"] != p["status"]:
            diffs["status"] += 1
        if p.get("kickoff_utc") and abs((f["kickoff"] - parse_dt(p["kickoff_utc"])).total_seconds()) > 60:
            diffs["kickoff"] += 1
            examples.append(("kickoff", key, f["kickoff"].isoformat(), p["kickoff_utc"]))
        if (f["venue"] or "") != (p.get("venue") or ""):
            diffs["venue"] += 1
    print("field differences:", dict(diffs) or "none")
    for ex in examples[:10]:
        print("  ", ex)


def integrity(feed: list[dict]) -> None:
    section("2. Internal integrity of the feed data")
    by_season = collections.defaultdict(list)
    for r in feed:
        by_season[r["season"]].append(r)
    print("season  rows finished draws rounds teams  first..last kickoff")
    for season in sorted(by_season):
        rows = by_season[season]
        teams = {r["home"] for r in rows} | {r["away"] for r in rows}
        draws = sum(1 for r in rows if r["status"] == "finished" and r["score_home"] == r["score_away"])
        print(
            f"{season}  {len(rows):4d} {sum(r['status'] == 'finished' for r in rows):8d} {draws:5d} "
            f"{len({r['round'] for r in rows}):6d} {len(teams):5d}  "
            f"{rows[0]['kickoff'].date()}..{rows[-1]['kickoff'].date()}"
        )
    dup = collections.Counter((r["season"], r["home"], r["away"], r["kickoff"]) for r in feed)
    print("duplicate (season, home, away, kickoff):", sum(1 for v in dup.values() if v > 1))
    print("null scores on finished:", sum(1 for r in feed if r["status"] == "finished" and (r["score_home"] is None or r["score_away"] is None)))
    names = collections.defaultdict(set)
    for r in feed:
        names[r["home"]].add(r["season"])
        names[r["away"]].add(r["season"])
    for alias, target in ALIASES.items():
        print(f"team identity: {alias!r} seasons {sorted(names.get(alias, []))}; {target!r} seasons {min(names[target])}-{max(names[target])}")
    ties = collections.Counter(r["kickoff"] for r in feed)
    print("matches sharing a kickoff timestamp with another match:", sum(v for v in ties.values() if v > 1))
    same_day_team = collections.Counter()
    for r in feed:
        for t in (r["home"], r["away"]):
            same_day_team[(t, r["kickoff"].date())] += 1
    print("team playing twice on one UTC date:", sum(1 for v in same_day_team.values() if v > 1))


def reconcile_official(feed: list[dict], official_path: str | None) -> None:
    section("3. Feed vs official results (nrl.com draw data)")
    if not official_path or not Path(official_path).exists():
        print("official results not available; skipped")
        return
    official = [r for r in json.loads(Path(official_path).read_text()) if r["state"] == "FullTime"]
    canon = lambda n: ALIASES.get(n, n)  # noqa: E731
    per_season = collections.Counter(r["season"] for r in official)
    okey = collections.defaultdict(list)
    for r in official:
        okey[(r["season"], canon(r["home"]), canon(r["away"]))].append(r)
    missing_in_official, score_diff, kickoff_diff, matched = [], [], [], 0
    used = collections.Counter()
    for f in feed:
        if f["status"] != "finished":
            continue
        cands = okey.get((f["season"], canon(f["home"]), canon(f["away"])), [])
        best = None
        for c in cands:
            if not c.get("kickoff_utc"):
                continue
            gap = abs((parse_dt(c["kickoff_utc"]) - f["kickoff"]).total_seconds())
            if best is None or gap < best[0]:
                best = (gap, c)
        if best is None or best[0] > 4 * 86400:
            missing_in_official.append(f)
            continue
        matched += 1
        gap, c = best
        used[(c["season"], c["round"], c["home"], c["away"])] += 1
        if (c["score_home"], c["score_away"]) != (f["score_home"], f["score_away"]):
            score_diff.append((f["season"], f["round"], f["home"], f["away"], (f["score_home"], f["score_away"]), (c["score_home"], c["score_away"])))
        if gap > 3600:
            kickoff_diff.append((f["season"], f["round"], f["home"], f["away"], f["kickoff"].isoformat(), c["kickoff_utc"]))
    feed_keys = collections.Counter(r["season"] for r in feed if r["status"] == "finished")
    print("finished matches per season, official vs feed:")
    for season in sorted(set(per_season) | set(feed_keys)):
        flag = "" if per_season[season] == feed_keys[season] else "   <-- differs"
        print(f"  {season}: official {per_season[season]:4d}  feed {feed_keys[season]:4d}{flag}")
    print(f"feed matches matched to an official result: {matched}")
    print(f"feed matches with no official counterpart: {len(missing_in_official)}")
    for f in missing_in_official[:8]:
        print("   ", f["season"], f["round"], f["home"], "v", f["away"], f["kickoff"].isoformat())
    print(f"score disagreements: {len(score_diff)}")
    for d in score_diff[:12]:
        print("   ", d)
    print(f"kickoff differs by more than 1 hour: {len(kickoff_diff)}")
    for d in kickoff_diff[:8]:
        print("   ", d)
    absent = [r for r in official if used[(r["season"], r["round"], r["home"], r["away"])] == 0]
    print(f"official full-time matches absent from the feed: {len(absent)}")
    by = collections.Counter((r["season"], r["round_title"]) for r in absent)
    for key, n in sorted(by.items()):
        print("   ", key, n)


def replay_state(feed: list[dict], cutoff: datetime, params, alias: bool) -> dict[str, float]:
    """Elo per team from finished matches that kicked off before `cutoff`,
    exactly as pipeline.sports.nrl_predict._current_elos walks them."""
    elos: dict[str, float] = {}
    season = None
    for m in feed:
        if m["status"] != "finished" or m["kickoff"] >= cutoff:
            continue
        if season is not None and m["season"] != season:
            elos = regress_season(elos, params)
        season = m["season"]
        h = ALIASES.get(m["home"], m["home"]) if alias else m["home"]
        a = ALIASES.get(m["away"], m["away"]) if alias else m["away"]
        nh, na = update(elos.get(h, 1500.0), elos.get(a, 1500.0), m["score_home"], m["score_away"], params)
        elos[h], elos[a] = nh, na
    return elos


def score(probs: tuple[float, float, float], sh: int, sa: int) -> tuple[float, float, int]:
    idx = 0 if sh > sa else (2 if sh < sa else 1)
    eps = 1e-15
    p = [min(1 - eps, max(eps, x)) for x in probs]
    ll = -math.log(p[idx])
    brier = sum((p[k] - (1.0 if k == idx else 0.0)) ** 2 for k in range(3))
    return ll, brier, int(max(range(3), key=lambda k: probs[k]) == idx)


def summarize(name: str, rows: list[tuple[float, float, int]]) -> None:
    n = len(rows)
    if not n:
        print(f"{name}: n=0")
        return
    print(
        f"{name:42s} n={n:3d} log_loss={sum(r[0] for r in rows) / n:.4f} "
        f"brier={sum(r[1] for r in rows) / n:.4f} acc={sum(r[2] for r in rows) / n:.4f}"
    )


def live_vs_replay(feed: list[dict], prod: list[dict], prod_dir: Path) -> None:
    section("4. Live predictions (production store) vs local replay")
    params = load_nrl_params()
    print("replay params:", params)
    record = json.loads((prod_dir / "model-record.json").read_text())
    print("production model record:", {k: record[k] for k in ("evaluated_matches", "winner_accuracy", "avg_log_loss", "avg_brier", "model_version", "last_updated")})

    fkey = {(r["season"], r["match_no"]): r for r in feed}
    live = [m for m in prod if m.get("prediction")]
    live.sort(key=lambda m: m["kickoff_utc"])
    print(f"production matches carrying a stored prediction: {len(live)} (all season {sorted({m['season'] for m in live})})")
    first_created = min(parse_dt(m["prediction"]["created_at"]) for m in live)
    print("earliest stored prediction created:", first_created.isoformat())

    season_2026 = [m for m in prod if m["season"] == max(m["season"] for m in prod)]
    after_launch = [m for m in season_2026 if parse_dt(m["kickoff_utc"]) > first_created]
    missing = [m for m in after_launch if not m.get("prediction")]
    print(f"matches kicking off after the first prediction: {len(after_launch)}; without any served prediction: {len(missing)}")
    for m in missing[:10]:
        print("   missing:", m["round"], m["home"], "v", m["away"], m["kickoff_utc"])

    leads, late = [], 0
    live_rows, at_creation_rows, at_kickoff_rows, alias_rows = [], [], [], []
    d_creation, d_kickoff, d_alias = [], [], []
    versions = collections.Counter()
    margin_gap = []
    for m in live:
        p = m["prediction"]
        versions[p["model_version"]] += 1
        created, kickoff = parse_dt(p["created_at"]), parse_dt(m["kickoff_utc"])
        lead_h = (kickoff - created).total_seconds() / 3600
        leads.append(lead_h)
        late += lead_h < 0
        f = fkey[(m["season"], m["match_no"])]
        sh, sa = f["score_home"], f["score_away"]
        live_rows.append(score((p["p_home"], p["p_draw"], p["p_away"]), sh, sa))

        # (a) what the model would have said from results finished before the
        #     prediction was created (a match is taken as finished 2h after kickoff)
        elos = replay_state(feed, created - timedelta(hours=2), params, alias=False)
        ra = predict(elos.get(f["home"], 1500.0), elos.get(f["away"], 1500.0), params)
        at_creation_rows.append(score((ra["p_home"], ra["p_draw"], ra["p_away"]), sh, sa))
        d_creation.append(p["p_home"] - ra["p_home"])
        margin_gap.append(p["expected_margin"] - ra["expected_margin"])

        # (b) the ideal: every result before this kickoff
        elos = replay_state(feed, kickoff, params, alias=False)
        rb = predict(elos.get(f["home"], 1500.0), elos.get(f["away"], 1500.0), params)
        at_kickoff_rows.append(score((rb["p_home"], rb["p_draw"], rb["p_away"]), sh, sa))
        d_kickoff.append(p["p_home"] - rb["p_home"])

        # (c) ideal, with the Tigers/Wests Tigers identity merged
        elos = replay_state(feed, kickoff, params, alias=True)
        rc = predict(elos.get(f["home"], 1500.0), elos.get(f["away"], 1500.0), params)
        alias_rows.append(score((rc["p_home"], rc["p_draw"], rc["p_away"]), sh, sa))
        d_alias.append(rb["p_home"] - rc["p_home"])

    print("model versions on stored predictions:", dict(versions))
    print(
        f"lead time kickoff - created (hours): min {min(leads):.1f} median {statistics.median(leads):.1f} "
        f"max {max(leads):.1f}; created after kickoff: {late}"
    )
    summarize("live (as stored in production)", live_rows)
    summarize("replay, state when prediction was created", at_creation_rows)
    summarize("replay, state at kickoff", at_kickoff_rows)
    summarize("replay at kickoff, Tigers identity merged", alias_rows)

    def spread(name: str, values: list[float]) -> None:
        a = [abs(v) for v in values]
        print(
            f"{name}: mean abs {statistics.mean(a):.5f}  max abs {max(a):.5f}  "
            f"exact (<1e-9) {sum(v < 1e-9 for v in a)}/{len(a)}  over 0.01: {sum(v > 0.01 for v in a)}"
        )

    spread("p_home, live - replay at creation", d_creation)
    spread("p_home, live - replay at kickoff ", d_kickoff)
    spread("p_home, unmerged - merged identity", d_alias)
    spread("expected_margin, live - replay at creation", margin_gap)

    worst = sorted(zip((abs(v) for v in d_creation), live), key=lambda t: -t[0])[:5]
    print("largest live-vs-replay-at-creation gaps:")
    for gap, m in worst:
        print(f"   {gap:.4f}  r{m['round']} {m['home']} v {m['away']} kickoff {m['kickoff_utc']} created {m['prediction']['created_at']}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    ap.add_argument("--prod", required=True)
    ap.add_argument("--official")
    args = ap.parse_args()
    feed = load_feed(args.db)
    prod = load_prod(Path(args.prod))
    reconcile_feed_vs_prod(feed, prod)
    integrity(feed)
    reconcile_official(feed, args.official)
    live_vs_replay(feed, prod, Path(args.prod))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
