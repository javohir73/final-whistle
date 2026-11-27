"""Shared engine for the UCL rating-scale experiment.

Every rating update goes through the production rule
(``ml.ratings.elo.update_ratings``) and every probability through the served
goal model (``ml.models.poisson`` + ``ml.evaluation.calibration.calibrate``),
exactly as ``ml/evaluation/club_walkforward.loss_1x2`` does. Bootstrap CIs use
``club_walkforward.season_clustered_ci`` keyed by ISO matchweek, as
``pipeline/experiment_ucl_eval.py`` does.

Leakage: each replay walks matches in date order and records a club's rating
BEFORE the match is applied; a club never plays twice on one day, so every
pre-match rating uses only matches strictly before that day.
"""
from __future__ import annotations

import math
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import data  # noqa: E402
import names  # noqa: E402
from ml.evaluation.calibration import calibrate, effective_gap  # noqa: E402
from ml.evaluation.club_walkforward import season_clustered_ci  # noqa: E402
from ml.models.params import load_params  # noqa: E402
from ml.models.poisson import expected_goals_from_elo, outcome_probabilities, score_matrix  # noqa: E402
from ml.ratings.elo import update_ratings  # noqa: E402

OUT = Path(__file__).resolve().parent
UCL_COMP = "UEFA Champions League"   # k_factor -> 30, as served
HA = 60.0                            # served UCL home advantage
UCL_BASE = 1.44                      # served UCL goal base
SELECTION = ("2021-22", "2022-23", "2023-24")
CONFIRMATION = ("2024-25", "2025-26")
CURRENT = "2026-27"
ALL_UCL = data.UCL_SEASONS + [CURRENT]
DOM_HA = {"SP1": 80.0}               # served domestic HA (La Liga 80, else 60)
BIG3 = {"ENG", "ESP", "GER"}


@dataclass
class Match:
    date: str
    season: str        # UCL season label, or fd code for domestic
    comp: str          # "UCL" | "UCLQ" | division
    home: str
    away: str
    gh: int
    ga: int
    neutral: bool = False
    scored: bool = False      # group/league stage onward (the scored set)
    served: tuple | None = None  # served (pH, pD, pA) for 2026-27
    rnd: str = ""

    @property
    def outcome(self) -> int:
        return 0 if self.gh > self.ga else (1 if self.gh == self.ga else 2)


def _fd_to_ucl_season(code: str) -> str:
    y = 2000 + int(code[:2])
    return f"{y}-{(y + 1) % 100:02d}"


def load_all() -> tuple[list[Match], list[Match], dict]:
    """(ucl, domestic, report). Sorted oldest-first."""
    raw, problems = data.load_ucl_raw()
    clean, dropped = data.clean_ucl(raw)
    ucl: list[Match] = []
    for r in clean:
        ucl.append(Match(
            date=r["date"], season=r["season"], comp=r["comp"],
            home=names.ucl_key(r["home_raw"], r["hc"]), away=names.ucl_key(r["away_raw"], r["ac"]),
            gh=r["gh"], ga=r["ga"], neutral=r["neutral"],
            scored=(r["comp"] == "UCL"), rnd=r["rnd"],
        ))
    for m in data.load_served():
        if m["status"] != "finished" or m["score_home"] is None:
            continue
        # serving's history sync prefers the 90-minute pair when present
        gh = m["score_home_90"] if m["score_home_90"] is not None else m["score_home"]
        ga = m["score_away_90"] if m["score_away_90"] is not None else m["score_away"]
        p = m["probabilities"]
        ucl.append(Match(
            date=m["kickoff_utc"][:10], season=CURRENT,
            comp="UCL" if m["stage"] != "qualifying" else "UCLQ",
            home=names.served_key(m["teams"]["home"]), away=names.served_key(m["teams"]["away"]),
            gh=gh, ga=ga, neutral=False, scored=(m["stage"] != "qualifying"),
            served=(p["home_win"], p["draw"], p["away_win"]) if p else None,
            rnd=f"MD{m['matchweek']}" if m["matchweek"] else m["stage"],
        ))
    ucl.sort(key=lambda m: m.date)

    dom = []
    for r in data.load_domestic_raw():
        if r["date"] < "2011-07-01":
            continue
        dom.append(Match(date=r["date"], season=r["season"], comp=r["comp"],
                         home=names.dom_key(r["home_raw"], r["comp"]),
                         away=names.dom_key(r["away_raw"], r["comp"]),
                         gh=r["gh"], ga=r["ga"]))
    dom.sort(key=lambda m: m.date)

    dom_keys = {m.home for m in dom} | {m.away for m in dom}
    ucl_keys = {m.home for m in ucl} | {m.away for m in ucl}
    unmapped = sorted(k for k in ucl_keys if names.country(k) in names.COVERED and k not in dom_keys)
    report = {
        "parse_problems": problems, "dropped_rows": dropped,
        "ucl_rows": len(ucl), "domestic_rows": len(dom),
        "ucl_clubs": len(ucl_keys),
        "covered_country_clubs_without_domestic_match": unmapped,
        "no_feed_clubs": sorted(k for k in ucl_keys if names.country(k) not in names.COVERED),
    }
    return ucl, dom, report


# --------------------------------------------------------------------------
# probabilities


_P = load_params()


def probs(rh: float, ra: float, *, base: float = UCL_BASE, calibrator="served",
          ha: float = HA) -> tuple[float, float, float]:
    """Served UCL triple. Home advantage is applied to every UCL match, finals
    included, because generate_predictions._host_adv applies a 'home' mode
    tournament's value unconditionally."""
    lam_h, lam_a = expected_goals_from_elo(rh, ra, home_adv=ha, base=base, beta=_P.beta)
    p = outcome_probabilities(score_matrix(lam_h, lam_a, rho=_P.rho))
    cal = _P.calibrator if calibrator == "served" else calibrator
    if cal is None:
        return tuple(p)
    return calibrate(p, cal, _P.temperature, eff_gap=effective_gap(rh, ra, ha))


def ll(p, outcome: int) -> float:
    return -math.log(max(p[outcome], 1e-12))


def brier(p, outcome: int) -> float:
    return sum((p[i] - (1.0 if i == outcome else 0.0)) ** 2 for i in range(3))


def week(d: str) -> str:
    iso = date.fromisoformat(d).isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def clustered(deltas: list[float], dates: list[str], n_bootstrap: int = 4000) -> dict:
    by: dict[str, list[float]] = {}
    for v, d in zip(deltas, dates):
        by.setdefault(week(d), []).append(v)
    return season_clustered_ci(by, n_bootstrap=n_bootstrap)


# --------------------------------------------------------------------------
# rating systems. Each returns {id(match): (pre_home, pre_away)} for every
# UCL match it replays.


def ucl_only_rolling(ucl: list[Match], window: int = 8) -> dict[int, tuple[float, float]]:
    """CONTROL: what serving does. One UCL-only replay per edition S, from a
    1500 cold start, over the `window` completed editions before S plus S's
    own matches so far (pipeline/leagues.py history_seasons = 8 editions;
    compute_club_elo.club_elo_ratings; learning_loop.effective_elos with
    base_ratings -> missing clubs at 1500). Finals neutral in the replay
    (api_football_club_results marks them so)."""
    pre: dict[int, tuple[float, float]] = {}
    for i, s in enumerate(ALL_UCL):
        eds = set(ALL_UCL[max(0, i - window): i + 1])
        r: dict[str, float] = {}
        for m in ucl:
            if m.season not in eds:
                continue
            rh, ra = r.get(m.home, 1500.0), r.get(m.away, 1500.0)
            if m.season == s:
                pre[id(m)] = (rh, ra)
            r[m.home], r[m.away] = update_ratings(rh, ra, m.gh, m.ga, competition=UCL_COMP,
                                                  is_neutral=m.neutral, home_advantage=HA)
    return pre


def domestic_alone(dom: list[Match], ucl: list[Match], window: int = 10) -> dict[int, dict[str, float]]:
    """User's reading of serving (ALT control, fidelity check only): each of
    E0/SP1/D1 replayed alone from 1500 over its served ten-season window
    before the UCL edition plus the current season so far. Returns, per UCL
    match, {club: domestic pre-match rating} for clubs of those leagues."""
    out: dict[int, dict[str, float]] = {}
    for i, s in enumerate(ALL_UCL):
        y = int(s[:4])
        codes = {f"{(y - k) % 100:02d}{(y - k + 1) % 100:02d}" for k in range(0, window + 1)}
        targets = [m for m in ucl if m.season == s]
        for div in ("E0", "SP1", "D1"):
            r: dict[str, float] = {}
            stream = [m for m in dom if m.comp == div and m.season in codes]
            j = 0
            for t in targets:
                while j < len(stream) and stream[j].date < t.date:
                    m = stream[j]
                    rh, ra = r.get(m.home, 1500.0), r.get(m.away, 1500.0)
                    r[m.home], r[m.away] = update_ratings(rh, ra, m.gh, m.ga, competition=div,
                                                          home_advantage=DOM_HA.get(div, 60.0))
                    j += 1
                for c in (t.home, t.away):
                    if c in r:
                        out.setdefault(id(t), {})[c] = r[c]
    return out


# C2 declared constants (frozen in EVIDENCE.md before any candidate run)
TIER_SEED = {"ENG": 1600.0, "ESP": 1600.0, "GER": 1600.0, "ITA": 1600.0,
             "FRA": 1550.0, "POR": 1550.0,
             "NED": 1500.0, "TUR": 1500.0, "BEL": 1500.0, "GRE": 1500.0,
             "AUT": 1500.0, "SCO": 1500.0}
NOFEED_PRIOR = 1450.0
NEWCOMER_DROP = 100.0
SHRINK_N0 = 10.0


def unified(ucl: list[Match], dom: list[Match]) -> tuple[dict[int, tuple[float, float]], dict[int, tuple[int, int]]]:
    """C2: one joint chronological replay of all twelve domestic leagues plus
    every UCL match (main stage + qualifiers where available), from
    2011-07-01. K=30, HA 60 everywhere, no season regression (engine
    defaults). Seeds: a domestic club's first appearance takes its country's
    tier seed, minus NEWCOMER_DROP if it first appears after that league's
    opening season (a promoted side). A club from a country with no feed
    enters at NOFEED_PRIOR and its USED rating is shrunk toward that prior by
    n/(n+SHRINK_N0), n = its rated matches so far. Returns pre-match used
    ratings per UCL match, plus each side's rated-match count."""
    events = sorted(dom + ucl, key=lambda m: (m.date, 0 if m.comp not in ("UCL", "UCLQ") else 1))
    r: dict[str, float] = {}
    n: dict[str, int] = {}
    opening: dict[str, str] = {}
    pre: dict[int, tuple[float, float]] = {}
    cnt: dict[int, tuple[int, int]] = {}

    def seed(club: str, m: Match) -> float:
        c = names.country(club)
        if c not in names.COVERED:
            return NOFEED_PRIOR
        s = TIER_SEED[c]
        if m.comp not in ("UCL", "UCLQ"):
            opening.setdefault(m.comp, m.season)
            if m.season != opening[m.comp]:
                s -= NEWCOMER_DROP
        return s

    def used(club: str) -> float:
        if names.country(club) in names.COVERED:
            return r[club]
        k = n.get(club, 0)
        return NOFEED_PRIOR + (r[club] - NOFEED_PRIOR) * k / (k + SHRINK_N0)

    for m in events:
        for c in (m.home, m.away):
            if c not in r:
                r[c] = seed(c, m)
        if m.comp in ("UCL", "UCLQ"):
            pre[id(m)] = (used(m.home), used(m.away))
            cnt[id(m)] = (n.get(m.home, 0), n.get(m.away, 0))
            comp, ha = UCL_COMP, HA
        else:
            comp, ha = m.comp, HA
        r[m.home], r[m.away] = update_ratings(r[m.home], r[m.away], m.gh, m.ga, competition=comp,
                                              is_neutral=m.neutral, home_advantage=ha)
        n[m.home] = n.get(m.home, 0) + 1
        n[m.away] = n.get(m.away, 0) + 1
    return pre, cnt
