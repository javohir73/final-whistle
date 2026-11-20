"""Section 6.1 of AUDIT.md (added after review): does the D1 duplicate-club
identity defect explain La Liga's live-vs-replay gap, including the part on
matches where no duplicate club plays?

replay.py's as-of replay uses one identity per club. Production did not:

- every 2026-27 result of Racing Santander and Deportivo La Coruna landed on the
  football-data.org duplicate Team row (1500 cold start, no history), not on
  the canonical row that carries Deportivo's 2016-18 history;
- the two matches of 16/17 Aug finished on BOTH rows, so both copies entered
  the Elo history (the opponent, Villarreal / Elche, was updated twice);
- a frozen row on a legacy fixture priced the legacy entity, one on a
  duplicate fixture priced the duplicate entity;
- all of this only from the 2026-09-02 cutover run onward.

This script replays La Liga with those production identities ("prod-identity
as-of") and decomposes live - as-of by duplicate / non-duplicate rows, for both
replays. If the non-duplicate residual vanishes, D1 explains it.

Usage::

    PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit \\
        python docs/experiments/2026-11-20-football-model-audit/replay_d1.py
"""
from __future__ import annotations

import collections
import json
from dataclasses import replace
from datetime import timedelta

from common import DERIVED, LEAGUES, OUT, load_fd, log_loss, parse_utc
from ml.ratings.elo import BASE_RATING, update_ratings
from replay import RESULT_LAG, _ko, price, served_params

DUP = {"Racing Santander": "Real Racing Club de Santander",
       "Deportivo La Coruna": "RC Deportivo La Coruña"}
# The duplicate rows first appear in the run of 2026-09-02 (first duplicate-row
# prediction 02:03 UTC). Before it, production history had one identity per
# club, exactly like the canonical replay.
CUTOVER = "2026-09-02T00:00:00+00:00"
DOUBLE_INGESTED = {("2026-08-16", "Racing Santander", "Villarreal"),
                   ("2026-08-17", "Deportivo La Coruna", "Elche")}


def prod_identity_history(fd):
    """The La Liga history as production's Elo replay saw it."""
    out = []
    for m in fd:
        if m.season != "2627":
            out.append(m)
            continue
        dup = replace(m, home=DUP.get(m.home, m.home), away=DUP.get(m.away, m.away))
        out.append(dup)
        if (m.date, m.home, m.away) in DOUBLE_INGESTED:
            out.append(m)  # the legacy row's copy of the same result
    return out


def ratings_asof(history, gen, home_adv, competition):
    ratings: dict[str, float] = {}
    for m in history:
        if not (_ko(m) + RESULT_LAG <= gen):
            continue
        rh = ratings.get(m.home, BASE_RATING)
        ra = ratings.get(m.away, BASE_RATING)
        ratings[m.home], ratings[m.away] = update_ratings(
            rh, ra, m.gh, m.ga, competition=competition, is_neutral=False,
            home_advantage=home_adv)
    return ratings


def main() -> None:
    _div, competition, home_adv = LEAGUES["laliga"]
    params = served_params("laliga")
    fd = load_fd("laliga")
    canon_hist = fd
    prod_hist = prod_identity_history(fd)
    live = [g for g in json.loads((DERIVED / "live_matches.json").read_text())
            if g["league"] == "laliga" and g["recording"] == "frozen_pre_kickoff"]
    cache: dict[tuple, dict] = {}
    totals = collections.defaultdict(float)
    counts = collections.Counter()
    differing = collections.Counter()
    for g in live:
        gen = parse_utc(g["frozen"]["generated_at"])
        p_live = tuple(g["frozen"][k] for k in ("home_win", "draw", "away_win"))
        s = sum(p_live)
        p_live = tuple(x / s for x in p_live)
        dup_row = g["api_home_name"] != g["home"] or g["api_away_name"] != g["away"]
        kind = "dup" if dup_row else "nondup"
        i = g["label"]
        after_cutover = gen >= parse_utc(CUTOVER)
        for name, hist in (("canonical", canon_hist),
                           ("prod_identity", prod_hist if after_cutover else canon_hist)):
            key = (name, g["frozen"]["generated_at"], after_cutover)
            if key not in cache:
                cache[key] = ratings_asof(hist, gen, home_adv, competition)
            r = cache[key]
            if name == "prod_identity" and after_cutover:
                # The row prices whichever entity its fixture carries.
                h = g["api_home_name"] if g["api_home_name"] in DUP.values() else g["home"]
                a = g["api_away_name"] if g["api_away_name"] in DUP.values() else g["away"]
            else:
                h, a = g["home"], g["away"]
            p = price(params, home_adv, r.get(h, BASE_RATING), r.get(a, BASE_RATING))
            d = log_loss(p_live, i) - log_loss(p, i)
            totals[(name, kind)] += d
            counts[(name, kind)] += 1
            if max(abs(x - y) for x, y in zip(p_live, p)) > 0.001:
                differing[(name, kind, g["frozen"]["generated_at"][:10])] += 1
    out = {
        "live_minus_asof_total_nats": {f"{a}|{b}": v for (a, b), v in totals.items()},
        "rows": {f"{a}|{b}": v for (a, b), v in counts.items()},
        "rows_differing_gt_0.001": {f"{a}|{b}|{c}": v for (a, b, c), v in sorted(differing.items())},
    }
    (OUT / "replay_d1_results.json").write_text(json.dumps(out, indent=1))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
