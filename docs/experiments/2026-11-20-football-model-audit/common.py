"""Shared loaders for the 2026-11-20 football audit scripts.

Offline only: every function reads the captures under
``data/raw/football-audit-2026-11/`` (git-ignored) that the operator fetched
once. Nothing here touches a database or the network.
"""
from __future__ import annotations

import csv
import json
import math
import random
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from pipeline.team_mapping import normalize_team_name

ROOT = Path(__file__).resolve().parents[3]
RAW = ROOT / "data" / "raw" / "football-audit-2026-11"
OUT = Path(__file__).resolve().parent
# Per-match intermediates carry copied odds/results rows: kept beside the raw
# captures (git-ignored), not in the evidence folder.
DERIVED = RAW / "derived"

SEASONS = ["1617", "1718", "1819", "1920", "2021", "2122", "2223", "2324",
           "2425", "2526", "2627"]
HOLDOUT = "2627"
CUTOFF = "2026-11-19"  # last kickoff date scored

# league code -> (football-data.co.uk division, Elo competition string,
# served home advantage). Mirrors pipeline/leagues.py.
LEAGUES = {
    "epl": ("E0", "Premier League", 60.0),
    "laliga": ("SP1", "La Liga", 80.0),
    "bundesliga": ("D1", "Bundesliga", 60.0),
}

# Spellings that pipeline/team_mapping.py does not reconcile today. The three
# football-data.org names are the duplicate Team rows found in production (see
# AUDIT.md section 3); the two football-data.co.uk names are the promoted clubs
# that have no top-flight row in the ten-season window.
AUDIT_ALIASES = {
    "Real Racing Club de Santander": "Racing Santander",
    "Santander": "Racing Santander",
    "RC Deportivo La Coruña": "Deportivo La Coruna",
    "SV 07 Elversberg": "SV Elversberg",
    "Elversberg": "SV Elversberg",
}

_LONDON = ZoneInfo("Europe/London")


def canon(name: str) -> str:
    n = normalize_team_name(name)
    return AUDIT_ALIASES.get(n, n)


def parse_utc(value: str) -> datetime:
    d = datetime.fromisoformat(value)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def _float(row: dict, key: str) -> float | None:
    v = (row.get(key) or "").strip()
    try:
        f = float(v)
    except ValueError:
        return None
    return f if f > 1.0 else None


@dataclass
class FdMatch:
    league: str
    season: str
    date: str  # ISO day
    kickoff_utc: datetime | None
    home: str  # canonical
    away: str
    gh: int
    ga: int
    odds: dict  # family -> (h, d, a) decimal, closing families + O/U

    @property
    def label(self) -> int:
        return 0 if self.gh > self.ga else (1 if self.gh == self.ga else 2)


def load_fd(league: str, seasons=SEASONS) -> list[FdMatch]:
    div = LEAGUES[league][0]
    out: list[FdMatch] = []
    for s in seasons:
        path = RAW / "fdcuk" / f"{div}_{s}.csv"
        with open(path, encoding="utf-8-sig", newline="") as fh:
            for r in csv.DictReader(fh):
                if not r.get("HomeTeam") or not (r.get("FTHG") or "").strip():
                    continue
                d, m, y = r["Date"].split("/")
                y = int(y) + (2000 if len(y) == 2 else 0)
                day = f"{y:04d}-{int(m):02d}-{int(d):02d}"
                ko = None
                if (r.get("Time") or "").strip():
                    hh, mm = r["Time"].split(":")
                    ko = datetime(y, int(m), int(d), int(hh), int(mm),
                                  tzinfo=_LONDON).astimezone(timezone.utc)
                odds = {}
                for fam in ("AvgC", "BFEC", "B365C", "MaxC", "PSC", "Avg"):
                    trip = tuple(_float(r, f"{fam}{x}") for x in "HDA")
                    if all(trip):
                        odds[fam] = trip
                ou = (_float(r, "AvgC>2.5"), _float(r, "AvgC<2.5"))
                if all(ou):
                    odds["AvgC_OU"] = ou
                out.append(FdMatch(
                    league=league, season=s, date=day, kickoff_utc=ko,
                    home=canon(r["HomeTeam"]), away=canon(r["AwayTeam"]),
                    gh=int(float(r["FTHG"])), ga=int(float(r["FTAG"])), odds=odds,
                ))
    # Stable chronological order; file order breaks same-day ties, as in the
    # production backfill.
    out.sort(key=lambda m: (m.date, m.kickoff_utc or datetime.min.replace(tzinfo=timezone.utc)))
    return out


def load_api(league: str) -> list[dict]:
    rows = json.loads((RAW / "api" / f"upcoming_{league}.json").read_text())
    for r in rows:
        r["home_c"] = canon(r["teams"]["home"])
        r["away_c"] = canon(r["teams"]["away"])
        r["kickoff"] = parse_utc(r["kickoff_utc"]) if r["kickoff_utc"] else None
        hp = RAW / "api" / "pred_history" / f"{r['match_id']}.json"
        r["history"] = None
        r["current_pred"] = None
        if hp.exists():
            blob = json.loads(hp.read_text())
            if "history" in blob:
                r["history"] = blob["history"]
                r["current_pred"] = blob["current"]
            else:
                r["history"] = []
    return rows


def frozen(row: dict) -> dict | None:
    """Latest production row generated at or before kickoff — the learning
    loop's _frozen_prediction rule (created_at <= kickoff_utc)."""
    if not row.get("history") or row["kickoff"] is None:
        return None
    pre = [h for h in row["history"]
           if h["generated_at"] and parse_utc(h["generated_at"]) <= row["kickoff"]]
    return pre[-1] if pre else None


def log_loss(p, i: int) -> float:
    return -math.log(max(1e-15, p[i]))


def brier(p, i: int) -> float:
    return sum((p[k] - (1.0 if k == i else 0.0)) ** 2 for k in range(3))


def iso_week(day: str) -> str:
    from datetime import date
    y, w, _ = date.fromisoformat(day).isocalendar()
    return f"{y}-W{w:02d}"


def cluster_ci(values_by_cluster: dict[str, list[float]], *, n_boot: int = 2000,
               seed: int = 12345, alphas=(0.05, 0.025)) -> dict:
    """Mean of pooled values with percentile CIs from resampling whole clusters."""
    keys = sorted(values_by_cluster)
    pooled = [v for k in keys for v in values_by_cluster[k]]
    if not pooled:
        return {"n": 0}
    mean = sum(pooled) / len(pooled)
    rng = random.Random(seed)
    sums = [(sum(values_by_cluster[k]), len(values_by_cluster[k])) for k in keys]
    means = []
    for _ in range(n_boot):
        s = n = 0
        for _k in keys:
            a, b = sums[rng.randrange(len(keys))]
            s += a
            n += b
        means.append(s / n)
    means.sort()
    out = {"n": len(pooled), "clusters": len(keys), "mean": mean}
    for a in alphas:
        lo = means[int((a / 2) * n_boot)]
        hi = means[min(n_boot - 1, int((1 - a / 2) * n_boot))]
        out[f"ci{round((1 - a) * 1000) / 10:g}"] = (lo, hi)
    return out


def fmt_ci(r: dict, key: str = "ci95") -> str:
    if not r or r.get("n", 0) == 0:
        return "n/a"
    lo, hi = r[key]
    return f"{r['mean']:+.4f} [{lo:+.4f}, {hi:+.4f}]"
