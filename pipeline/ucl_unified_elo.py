"""Unified (C2) Elo for the UCL shadow variants -- runtime continuation.

Candidate C2 of docs/experiments/2026-11-27-ucl-rating-scale: one joint
chronological Elo replay of twelve domestic leagues plus every UCL match, so a
club's Champions League rating reflects its domestic results too (the served
UCL ratings come from a UCL-only replay with every unknown club at 1500).

Replaying 2011 -> now each run would mean ~190 CSV downloads, so the history
before ``CUTOFF`` is frozen in ``ml/models/ucl_unified_snapshot.json`` (built
offline by pipeline/build_ucl_unified_snapshot.py with THIS engine). At run time
this module loads the snapshot, fetches only the current season's
football-data.co.uk files, takes the DB's UCL results dated on/after the cutoff,
and continues the exact same replay.

Fail-closed: ``compute_unified_strengths`` returns None on ANY fetch/parse/
snapshot problem and logs it; the caller then skips the unified variants for the
run. Nothing here can alter a served prediction -- the result only feeds
shadow (is_shadow) rows.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

from ml.ratings.elo import update_ratings
from pipeline.ucl_unified_names import (
    COVERED,
    DIV_COUNTRY,
    UNMAPPED_PREFIX,
    country,
    db_club_key,
    dom_key,
)

log = logging.getLogger(__name__)

SNAPSHOT_PATH = Path(__file__).resolve().parents[1] / "ml" / "models" / "ucl_unified_snapshot.json"
CUTOFF = "2026-07-01"          # snapshot holds every event dated strictly before this
UCL_COMP = "UEFA Champions League"   # K via update_ratings (30), as served
HA = 60.0                      # home advantage, every match (as in the experiment)

# C2 constants, frozen in docs/experiments/2026-11-27-ucl-rating-scale/frozen.json
TIER_SEED = {"ENG": 1600.0, "ESP": 1600.0, "GER": 1600.0, "ITA": 1600.0,
             "FRA": 1550.0, "POR": 1550.0,
             "NED": 1500.0, "TUR": 1500.0, "BEL": 1500.0, "GRE": 1500.0,
             "AUT": 1500.0, "SCO": 1500.0}
NOFEED_PRIOR = 1450.0
NEWCOMER_DROP = 100.0
SHRINK_N0 = 10.0

CURRENT_SEASON_CODE = "2627"
FD_URL = "https://www.football-data.co.uk/mmz4281/{season}/{div}.csv"
AUT_URL = "https://www.football-data.co.uk/new/AUT.csv"
USER_AGENT = "finalwhistle-pipeline/1.0"
FETCH_TIMEOUT = 20.0

_UCL = "UCL"


def constants() -> dict:
    return {"tier_seed": dict(TIER_SEED), "nofeed_prior": NOFEED_PRIOR,
            "newcomer_drop": NEWCOMER_DROP, "shrink_n0": SHRINK_N0, "home_advantage": HA}


@dataclass(frozen=True)
class Event:
    """One result. ``comp`` is a division code or "UCL"; ``season`` is the
    football-data season code ("2627") for domestic rows, free-form for UCL."""

    date: str
    comp: str
    season: str
    home: str
    away: str
    gh: int
    ga: int
    neutral: bool = False      # one-off final: no home advantage in the update


class UnifiedElo:
    """The C2 replay state. ``apply`` is core.unified's loop, verbatim."""

    def __init__(self, r: dict[str, float] | None = None, n: dict[str, int] | None = None,
                 opening: dict[str, str] | None = None) -> None:
        self.r: dict[str, float] = dict(r or {})
        self.n: dict[str, int] = dict(n or {})
        self.opening: dict[str, str] = dict(opening or {})

    # -- C2 rules ----------------------------------------------------------

    def _seed(self, club: str, ev: Event | None) -> float:
        c = country(club)
        if c not in COVERED:
            return NOFEED_PRIOR
        s = TIER_SEED[c]
        if ev is not None and ev.comp != _UCL:
            self.opening.setdefault(ev.comp, ev.season)
            if ev.season != self.opening[ev.comp]:
                s -= NEWCOMER_DROP      # a side first seen after its league's opening season
        return s

    def used(self, club: str) -> float:
        """Rating fed to the forecast. No-feed clubs are shrunk toward the prior
        by n/(n+n0), n = rated matches so far; a club never seen is its seed."""
        if club not in self.r:
            return self._seed(club, None)
        if country(club) in COVERED:
            return self.r[club]
        k = self.n.get(club, 0)
        return NOFEED_PRIOR + (self.r[club] - NOFEED_PRIOR) * k / (k + SHRINK_N0)

    def apply(self, events: Iterable[Event]) -> list[tuple[Event, float, float, int, int]]:
        """Replay ``events`` (any order; same-day domestic before UCL). Returns
        (event, pre-match used home, used away, n home, n away) per UCL event."""
        ordered = sorted(events, key=lambda e: (e.date, 0 if e.comp != _UCL else 1))
        out: list[tuple[Event, float, float, int, int]] = []
        for ev in ordered:
            for c in (ev.home, ev.away):
                if c not in self.r:
                    self.r[c] = self._seed(c, ev)
            if ev.comp == _UCL:
                out.append((ev, self.used(ev.home), self.used(ev.away),
                            self.n.get(ev.home, 0), self.n.get(ev.away, 0)))
                comp = UCL_COMP
            else:
                comp = ev.comp
            self.r[ev.home], self.r[ev.away] = update_ratings(
                self.r[ev.home], self.r[ev.away], ev.gh, ev.ga, competition=comp,
                is_neutral=ev.neutral, home_advantage=HA)
            self.n[ev.home] = self.n.get(ev.home, 0) + 1
            self.n[ev.away] = self.n.get(ev.away, 0) + 1
        return out

    # -- snapshot ------------------------------------------------------------

    def to_clubs(self) -> dict[str, dict]:
        return {k: {"r": self.r[k], "n": self.n.get(k, 0)} for k in sorted(self.r)}


class SnapshotError(RuntimeError):
    pass


def load_snapshot(path: Path = SNAPSHOT_PATH) -> UnifiedElo:
    """Load the frozen pre-cutoff state; raise SnapshotError on any mismatch
    with this module's constants (a drifted engine must not silently continue
    a differently-built snapshot)."""
    try:
        blob = json.loads(Path(path).read_text())
    except (OSError, ValueError) as exc:
        raise SnapshotError(f"cannot read snapshot: {exc}") from exc
    if blob.get("cutoff") != CUTOFF:
        raise SnapshotError(f"snapshot cutoff {blob.get('cutoff')!r} != {CUTOFF!r}")
    if blob.get("constants") != constants():
        raise SnapshotError("snapshot constants differ from the engine's frozen C2 constants")
    clubs = blob.get("clubs")
    if not isinstance(clubs, dict) or not clubs:
        raise SnapshotError("snapshot has no clubs")
    opening = blob.get("opening") or {}
    if set(opening) != set(DIV_COUNTRY):
        raise SnapshotError("snapshot is missing a division's opening season")
    return UnifiedElo(
        r={k: float(v["r"]) for k, v in clubs.items()},
        n={k: int(v["n"]) for k, v in clubs.items()},
        opening=opening,
    )


# --------------------------------------------------------------------------
# football-data.co.uk parsing (shared by the offline build and the runtime)


def _fd_date(s: str) -> str:
    d, m, y = s.strip().split("/")
    yy = int(y)
    if yy < 100:
        yy += 2000
    return date(yy, int(m), int(d)).isoformat()


def parse_division_csv(text: str, div: str, season: str) -> list[Event]:
    """mmz4281 file for one division/season -> domestic Events (played rows)."""
    out: list[Event] = []
    reader = csv.DictReader(io.StringIO(text))
    cols = set(reader.fieldnames or [])
    missing = {"Date", "HomeTeam", "AwayTeam", "FTHG", "FTAG"} - cols
    if missing:
        raise ValueError(f"{div}_{season}: missing columns {sorted(missing)}")
    for r in reader:
        if not r.get("FTHG") or not r.get("HomeTeam"):
            continue
        out.append(Event(_fd_date(r["Date"]), div, season,
                         dom_key(r["HomeTeam"].strip(), div), dom_key(r["AwayTeam"].strip(), div),
                         int(float(r["FTHG"])), int(float(r["FTAG"]))))
    return out


def parse_aut_csv(text: str) -> list[Event]:
    """new/AUT.csv (all seasons in one file) -> domestic Events (played rows)."""
    out: list[Event] = []
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    cols = set(reader.fieldnames or [])
    missing = {"Season", "Date", "Home", "Away", "HG", "AG"} - cols
    if missing:
        raise ValueError(f"AUT: missing columns {sorted(missing)}")
    for r in reader:
        if not r.get("HG") or not r.get("Home"):
            continue
        y0 = int(r["Season"][:4])
        out.append(Event(_fd_date(r["Date"]), "AUT", f"{y0 % 100:02d}{(y0 + 1) % 100:02d}",
                         dom_key(r["Home"].strip(), "AUT"), dom_key(r["Away"].strip(), "AUT"),
                         int(float(r["HG"])), int(float(r["AG"]))))
    return out


def fetch_current_domestic(
    get: Callable[[str], bytes] | None = None,
    *, season: str = CURRENT_SEASON_CODE, cutoff: str = CUTOFF,
) -> list[Event]:
    """Current-season football-data.co.uk results for all twelve divisions,
    dated on/after ``cutoff``. Raises on ANY failure (strict: a league silently
    missing mid-season would distort every club rating)."""
    get = get or _http_get
    events: list[Event] = []
    for div in DIV_COUNTRY:
        if div == "AUT":
            evs = parse_aut_csv(get(AUT_URL).decode("utf-8-sig", errors="replace"))
        else:
            evs = parse_division_csv(
                get(FD_URL.format(season=season, div=div)).decode("latin-1"), div, season)
        events += [e for e in evs if e.date >= cutoff]
    return events


def _http_get(url: str) -> bytes:
    import requests

    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=FETCH_TIMEOUT)
    resp.raise_for_status()
    return resp.content


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


# --------------------------------------------------------------------------
# DB side


@dataclass
class UnifiedResult:
    strengths: dict[int, float]          # team_id -> used rating (UCL teams in the DB)
    unmapped: list[str] = field(default_factory=list)
    domestic_events: int = 0
    ucl_events: int = 0

    def summary(self) -> dict:
        return {"status": "ok", "teams": len(self.strengths), "unmapped": list(self.unmapped),
                "domestic_events": self.domestic_events, "ucl_events": self.ucl_events}


def _as_day(dt: datetime) -> str:
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc)
    return dt.date().isoformat()


def ucl_events_from_db(db, competition: str, key_of: Callable[[int], str],
                       cutoff: str = CUTOFF) -> list[Event]:
    """UCL results on/after the cutoff from historical_matches. Rows are the
    regulation-time pair (club_results.sync_finished_matches_to_history prefers
    score_*_90), i.e. exactly what the served club replay consumes."""
    from app.models import HistoricalMatch

    rows = (db.query(HistoricalMatch).filter(HistoricalMatch.competition == competition)
            .order_by(HistoricalMatch.date.asc(), HistoricalMatch.id.asc()).all())
    out = []
    for r in rows:
        day = _as_day(r.date)
        if day < cutoff:
            continue
        out.append(Event(day, _UCL, "ucl", key_of(r.team_a_id), key_of(r.team_b_id),
                         r.score_a, r.score_b, bool(r.is_neutral)))
    return out


def compute_unified_strengths(
    db,
    *,
    tournament_name: str,
    competition: str,
    get: Callable[[str], bytes] | None = None,
    snapshot_path: Path = SNAPSHOT_PATH,
) -> UnifiedResult | None:
    """{team_id: used C2 rating} for every team in the UCL tournament, or None
    (logged) on any failure. Never raises."""
    try:
        from app.models import Match, Team, Tournament

        state = load_snapshot(snapshot_path)
        domestic = fetch_current_domestic(get)

        t = db.query(Tournament).filter_by(name=tournament_name).first()
        if t is None:
            raise RuntimeError(f"tournament {tournament_name!r} not found")
        ids: set[int] = set()
        for h, a in db.query(Match.team_home_id, Match.team_away_id).filter(
                Match.tournament_id == t.id).all():
            ids.update(x for x in (h, a) if x is not None)
        teams = {x.id: x.name for x in db.query(Team).filter(Team.id.in_(ids)).all()}

        unmapped: list[str] = []
        keys: dict[int, str] = {}

        def key_of(team_id: int) -> str:
            if team_id not in keys:
                name = teams.get(team_id)
                if name is None:
                    name = db.get(Team, team_id).name
                k = db_club_key(name)
                if k is None:
                    k = f"{UNMAPPED_PREFIX}:{name}"
                    unmapped.append(name)
                keys[team_id] = k
            return keys[team_id]

        ucl = ucl_events_from_db(db, competition, key_of)
        for tid in sorted(ids):
            key_of(tid)
        state.apply(domestic + ucl)
        strengths = {tid: state.used(keys[tid]) for tid in ids}
        unmapped = sorted(set(unmapped))
        if unmapped:
            log.error("ucl unified elo: %d club(s) have NO explicit identity mapping and are "
                      "treated as no-feed clubs (prior %.0f): %s",
                      len(unmapped), NOFEED_PRIOR, unmapped)
        return UnifiedResult(strengths, unmapped, len(domestic), len(ucl))
    except Exception:  # noqa: BLE001 - a shadow input must never break the run
        log.exception("ucl unified elo FAILED; unified shadow variants skipped this run")
        return None
