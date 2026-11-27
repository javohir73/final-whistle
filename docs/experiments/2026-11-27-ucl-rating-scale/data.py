"""Loaders for the 2026-11-27 UCL rating-scale experiment.

Offline only. Every function reads raw captures from ``$UCL_EXP_DATA``
(default: the git-ignored ``data/raw/ucl-rating-scale-2026-11``). The raw files are NOT
committed: the repo is public and football-data.co.uk data is not CC0.

Sources
- openfootball/champions-league ``<season>/cl.txt`` (main stage) and
  ``clq.txt`` (qualifiers; only 2024-25 and 2025-26 exist upstream). CC0.
- football-data.co.uk ``mmz4281/<yyyy>/<DIV>.csv`` for E0 SP1 D1 I1 F1 N1 P1
  T1 B1 SC0 G1, plus ``new/AUT.csv`` (Austria, all seasons in one file).
- the served 2026-27 UCL payload (``GET /api/matches/upcoming?competition=ucl``)
  for the current edition's results and served probabilities.

Score basis: regulation time. For an openfootball ``a.e.t.`` line the first
element of the parenthesis is the 90-minute score; otherwise the headline
score is full time.
"""
from __future__ import annotations

import csv
import json
import os
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[3]
# Raw captures live outside version control (data/raw/ is git-ignored).
DATA = Path(os.environ.get("UCL_EXP_DATA", _ROOT / "data" / "raw" / "ucl-rating-scale-2026-11"))
SERVED = Path(os.environ.get("UCL_SERVED_JSON", DATA / "ucl_2026_served.json"))

UCL_SEASONS = [f"{y}-{(y + 1) % 100:02d}" for y in range(2011, 2026)]  # 2011-12 .. 2025-26
QUALI_SEASONS = ["2024-25", "2025-26"]

# country code (openfootball) -> football-data.co.uk division
COUNTRY_DIV = {
    "ENG": "E0", "ESP": "SP1", "GER": "D1", "ITA": "I1", "FRA": "F1",
    "NED": "N1", "POR": "P1", "TUR": "T1", "BEL": "B1", "SCO": "SC0",
    "GRE": "G1", "AUT": "AUT",
}
DIVS = list(COUNTRY_DIV.values())
FD_SEASONS = [f"{y % 100:02d}{(y + 1) % 100:02d}" for y in range(2010, 2027)]  # 1011..2627

_MONTHS = {m: i + 1 for i, m in enumerate(
    "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


@dataclass(frozen=True)
class M:
    """One match. ``home``/``away`` are canonical club keys."""

    date: str          # ISO day
    season: str        # UCL season "2021-22" or domestic fd code "2122"
    comp: str          # "UCL", "UCLQ" or a division code
    home: str
    away: str
    gh: int
    ga: int
    neutral: bool = False
    rnd: str = ""


# --------------------------------------------------------------------------
# names


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


_STOP = {"fc", "cf", "ac", "afc", "ssc", "sc", "sk", "fk", "cd", "sl", "as",
         "rc", "club", "de", "futbol", "football", "calcio", "sv", "vfl", "tsg",
         "bc", "kv", "osc", "psv", "rcd", "ud", "ca", "sd", "sad", "ks", "nk",
         "gnk", "hnk", "pfc", "bk", "if", "ff", "aik", "ogc", "kaa", "krc",
         "rsc", "1", "1899", "1846", "1900", "1909", "1913", "1907", "04", "05",
         "29", "03", "79", "e", "y", "do", "da", "cp", "sporting"}


def norm(name: str) -> str:
    """Loose key used only to PROPOSE matches; the explicit maps decide."""
    s = _ascii(name).lower().replace("&", " ")
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = [t for t in s.split() if t not in _STOP]
    return " ".join(toks)


# --------------------------------------------------------------------------
# openfootball Football.TXT


_LINE = re.compile(
    r"^\s*(?:\d\d:\d\d\s+)?(?P<home>.+?) \((?P<hc>[A-Z]{3})\)\s+v\s+"
    r"(?P<away>.+?) \((?P<ac>[A-Z]{3})\)\s+(?P<score>.+?)\s*$")
_DATE = re.compile(r"^\s+(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\w{3}) (\d{1,2})(?: (\d{4}))?\s*$")


def _ninety(score: str) -> tuple[int, int] | None:
    s = score.strip()
    if "a.e.t." in s:
        m = re.search(r"\((\d+)-(\d+)", s)
        return (int(m.group(1)), int(m.group(2))) if m else None
    if "pen." in s:  # shoot-out without a.e.t. marker: should not occur
        return None
    m = re.match(r"^(\d+)-(\d+)", s)
    return (int(m.group(1)), int(m.group(2))) if m else None


def parse_txt(path: Path, season: str, comp: str) -> tuple[list[dict], list[str]]:
    """Rows with raw names + country codes, and a list of parse problems."""
    rows, problems = [], []
    start_year = int(season[:4])
    cur: date | None = None
    rnd = ""
    for ln, line in enumerate(path.read_text().splitlines(), 1):
        if line.startswith("▪"):
            rnd = line.lstrip("▪ ").strip()
            continue
        dm = _DATE.match(line)
        if dm:
            mon, day, yr = _MONTHS[dm.group(2)], int(dm.group(3)), dm.group(4)
            year = int(yr) if yr else (start_year if mon >= 7 else start_year + 1)
            if comp == "UCL" and season == "2019-20" and mon in (7, 8):
                year = 2020  # the 2020 Lisbon finals ran in August 2020
            if comp == "UCLQ":
                year = start_year
            cur = date(year, mon, day)
            continue
        lm = _LINE.match(line)
        if lm:
            sc = _ninety(lm.group("score"))
            if sc is None or cur is None:
                problems.append(f"{path.name}:{ln}: unparsed score/date: {line.strip()}")
                continue
            rows.append({
                "date": cur.isoformat(), "season": season, "comp": comp,
                "home_raw": lm.group("home").strip(), "hc": lm.group("hc"),
                "away_raw": lm.group("away").strip(), "ac": lm.group("ac"),
                "gh": sc[0], "ga": sc[1], "rnd": rnd,
                "neutral": rnd.endswith("Final") and "Semi" not in rnd
                and "Quarter" not in rnd and comp == "UCL",
                "line": ln,
            })
        elif " v " in line:
            problems.append(f"{path.name}:{ln}: unmatched fixture line: {line.strip()}")
    return rows, problems


def validate_ucl(rows: list[dict], season: str) -> list[dict]:
    """Drop the corrupt tails openfootball carries in some files.

    A main-stage row is kept only if its date lies inside the edition
    (Sep..Jun, Aug 2020 for 2019-20) and BOTH clubs belong to that edition's
    group/league-phase field (first section block). Duplicate (date, pair)
    rows are dropped. Everything dropped is reported by the caller.
    """
    return rows  # filtering is done in load_ucl_raw with reporting


def load_ucl_raw() -> tuple[list[dict], list[str]]:
    rows, problems = [], []
    for s in UCL_SEASONS:
        r, p = parse_txt(DATA / "clq" / f"cl.{s}.txt", s, "UCL")
        rows += r
        problems += p
    for s in QUALI_SEASONS:
        r, p = parse_txt(DATA / "clq" / f"clq.{s}.txt", s, "UCLQ")
        rows += r
        problems += p
    return rows, problems


def clean_ucl(rows: list[dict]) -> tuple[list[dict], list[str]]:
    """Season-window + field-membership + duplicate filter, with a log."""
    out, dropped, seen = [], [], set()
    by_season: dict[tuple, list[dict]] = {}
    for r in rows:
        by_season.setdefault((r["season"], r["comp"]), []).append(r)
    for (season, comp), rs in sorted(by_season.items()):
        y0 = int(season[:4])
        if comp == "UCL":
            lo = date(y0, 9, 1)
            hi = date(y0 + 1, 8, 31) if season == "2019-20" else date(y0 + 1, 6, 30)
            field_rows = [r for r in rs if r["rnd"].startswith(("Group", "Gruppe", "League"))]
            field = {(r["home_raw"], r["hc"]) for r in field_rows} | {
                (r["away_raw"], r["ac"]) for r in field_rows}
            # playoff/KO clubs always come from the group/league field
        else:
            lo, hi = date(y0, 6, 15), date(y0, 9, 5)
            field = None
        for r in rs:
            d = date.fromisoformat(r["date"])
            key = (r["date"], r["home_raw"], r["away_raw"])
            why = None
            if not (lo <= d <= hi):
                why = "date outside edition window"
            elif field is not None and ((r["home_raw"], r["hc"]) not in field
                                        or (r["away_raw"], r["ac"]) not in field):
                why = "club not in this edition's field"
            elif key in seen:
                why = "duplicate"
            if why:
                dropped.append(f"{season} {comp} line {r['line']}: {r['date']} "
                               f"{r['home_raw']} v {r['away_raw']} -> {why}")
                continue
            seen.add(key)
            out.append(r)
    return out, dropped


# --------------------------------------------------------------------------
# football-data.co.uk


def _fd_date(s: str) -> str:
    d, m, y = s.split("/")
    y = int(y)
    if y < 100:
        y += 2000
    return date(y, int(m), int(d)).isoformat()


def load_domestic_raw() -> list[dict]:
    out = []
    for div in DIVS:
        if div == "AUT":
            path = DATA / "fdco" / "AUT.csv"
            with path.open(encoding="utf-8-sig", errors="replace") as f:
                for r in csv.DictReader(f):
                    if not r.get("HG") or not r.get("Home"):
                        continue
                    y0 = int(r["Season"][:4])
                    out.append({"date": _fd_date(r["Date"]),
                                "season": f"{y0 % 100:02d}{(y0 + 1) % 100:02d}",
                                "comp": div, "home_raw": r["Home"].strip(),
                                "away_raw": r["Away"].strip(),
                                "gh": int(float(r["HG"])), "ga": int(float(r["AG"]))})
            continue
        for s in FD_SEASONS:
            path = DATA / "fdco" / f"{div}_{s}.csv"
            if not path.exists() or path.stat().st_size < 100:
                continue
            with path.open(encoding="latin-1") as f:
                for r in csv.DictReader(f):
                    if not r.get("FTHG") or not r.get("HomeTeam"):
                        continue
                    out.append({"date": _fd_date(r["Date"]), "season": s, "comp": div,
                                "home_raw": r["HomeTeam"].strip(),
                                "away_raw": r["AwayTeam"].strip(),
                                "gh": int(float(r["FTHG"])), "ga": int(float(r["FTAG"]))})
    return out


# --------------------------------------------------------------------------
# served 2026-27


def load_served() -> list[dict]:
    return json.loads(SERVED.read_text())
