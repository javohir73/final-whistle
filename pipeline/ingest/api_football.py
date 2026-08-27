"""Live in-game score ingestion from API-Football (api-sports.io v3).

Unlike football-data.org's free tier, api-sports carries the OFFICIAL live
minute (fixture.status.elapsed) and added time (status.extra). Rather than
re-implement the match-update logic, to_feed() translates each api-sports
fixture into the SAME football-data v4 shape that
pipeline.ingest.live_scores.update_live_scores already consumes — so all the
tested behaviour (team orientation, freshness/lifecycle guards, period
derivation, penalty tally) is reused unchanged.

api-sports v3: GET /fixtures?league={id}&season={year}, auth via the
`x-apisports-key` header.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime

import requests

from pipeline.ingest.provider_errors import read_payload
from pipeline.ingest.api_football_status import football_data_status
from pipeline.ingest.api_football_status import internal_status
from pipeline.ingest.fixture_contract import NormalizedFixture

log = logging.getLogger(__name__)

BASE_URL = "https://v3.football.api-sports.io"

# Statuses signalling extra time / a shootout — surfaced via score.duration, the
# same channel football-data uses (status stays IN_PLAY/FINISHED).
_EXTRA_TIME = frozenset({"ET", "AET", "BT"})
_SHOOTOUT = frozenset({"P", "PEN"})

# api-sports goal-event detail -> our scorer type. Other details (e.g.
# "Missed Penalty") and non-Goal events are ignored.
_GOAL_DETAIL = {"Normal Goal": "goal", "Penalty": "penalty", "Own Goal": "own_goal"}

# api-sports card-event detail -> our card type. A second yellow arrives from
# the feed as a single "Red Card" event. Other details are ignored.
_CARD_DETAIL = {"Yellow Card": "yellow", "Red Card": "red"}


#: Every provider call this module makes, counted per endpoint for the run
#: summary. Cheap request accounting beats guessing which step burned the
#: allowance — see reset_request_counts/request_counts.
_request_counts: dict[str, int] = {}


def request_counts() -> dict[str, int]:
    """Provider requests issued this process, by endpoint path."""
    return dict(_request_counts)


def reset_request_counts() -> None:
    _request_counts.clear()


def _get(api_key: str, path: str, params: dict, timeout: float) -> list[dict]:
    """One provider GET -> its ``response`` list.

    Central because every caller needs the SAME failure semantics: a provider
    error is an exception, never an empty list. api-sports signals quota and
    plan failures with HTTP 200 plus an ``errors`` object, so returning
    ``data["response"] or []`` (what every fetch_* used to do) made an
    exhausted key indistinguishable from a genuinely empty fixture list — the
    daily refresh then ingested nothing and exited 0. See
    pipeline/ingest/provider_errors.py.
    """
    _request_counts[path] = _request_counts.get(path, 0) + 1
    resp = requests.get(
        f"{BASE_URL}{path}",
        headers={"x-apisports-key": api_key},
        params=params,
        timeout=timeout,
    )
    data = read_payload(resp, endpoint=path)
    return data.get("response") or []


def fetch_fixtures(api_key: str, league: int, season: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw fixture list for a league+season from api-sports.io.

    Raises ProviderError (quota/auth/other) rather than returning [] — this
    feed is load-bearing: no fixtures means no matches and no predictions."""
    return _get(api_key, "/fixtures", {"league": league, "season": season}, timeout)


def fetch_events(api_key: str, fixture_id: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw event list for one fixture from api-sports.io."""
    return _get(api_key, "/fixtures/events", {"fixture": fixture_id}, timeout)


def fetch_lineups(api_key: str, fixture_id: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw lineup list for one fixture from api-sports.io.

    Display-only: the lineups feature never feeds the prediction model. Real
    lineups exist only ~40 min before kickoff, so this returns an empty list for
    fixtures the provider has no lineup for yet."""
    return _get(api_key, "/fixtures/lineups", {"fixture": fixture_id}, timeout)


def fetch_teams(api_key: str, league: int, season: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw team list for a league+season from api-sports.io (used to
    map api-football team ids onto our Team rows)."""
    return _get(api_key, "/teams", {"league": league, "season": season}, timeout)


def fetch_squad(api_key: str, team_id: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw squad list for a team from api-sports.io (/players/squads)."""
    return _get(api_key, "/players/squads", {"team": team_id}, timeout)


def fetch_player_stats(api_key: str, player_id: int, season: int, timeout: float = 15.0) -> list[dict]:
    """Return one player's per-(team,league) statistics for a season (/players?id=&season=)."""
    return _get(api_key, "/players", {"id": player_id, "season": season}, timeout)


def probe_player_access(api_key: str, league: int, season: int, timeout: float = 15.0) -> dict:
    """One-shot diagnostic: does this api-sports key reach current-season PLAYER
    data (the raw material for goalscorer predictions)? Calls /status and
    /players/topscorers and reports the plan + reachability — never the key, and
    never raises. api-sports answers 200 with an `errors` object on plan/quota
    issues, so reachability is judged by the topscorers result count."""
    out: dict = {
        "plan": None, "active": None, "requests": None,
        "player_data_reachable": False, "topscorers_results": 0, "note": None,
    }
    try:
        s = requests.get(f"{BASE_URL}/status", headers={"x-apisports-key": api_key}, timeout=timeout)
        sd = s.json().get("response")
        if isinstance(sd, dict):
            sub = sd.get("subscription") or {}
            out["plan"], out["active"] = sub.get("plan"), sub.get("active")
            out["requests"] = sd.get("requests")
        else:
            out["note"] = f"status errors: {s.json().get('errors')}"
    except Exception as exc:  # noqa: BLE001 - a diagnostic must never raise
        out["note"] = f"status error: {exc}"
    try:
        t = requests.get(
            f"{BASE_URL}/players/topscorers",
            headers={"x-apisports-key": api_key},
            params={"league": league, "season": season},
            timeout=timeout,
        )
        td = t.json()
        out["topscorers_results"] = td.get("results") or 0
        out["player_data_reachable"] = bool(out["topscorers_results"])
        if td.get("errors"):
            sep = " | " if out["note"] else ""
            out["note"] = f"{out['note'] or ''}{sep}topscorers errors: {td['errors']}"
    except Exception as exc:  # noqa: BLE001
        sep = " | " if out["note"] else ""
        out["note"] = f"{out['note'] or ''}{sep}topscorers error: {exc}"
    return out


def probe_player_sample(api_key: str, league: int, season: int, club_season: int,
                        timeout: float = 15.0) -> dict:
    """Capture trimmed live sample shapes of /teams, /players/squads and
    /players?id= so the Stage 1b goalscorer ingester is written against real
    field names. No secrets in the output; never raises. `season` is the WC
    season; `club_season` (e.g. 2025) is the 2025-26 club season for the
    per-player stats sample."""
    out: dict = {"team": None, "squad_player": None, "player_stats": None, "note": None}

    def _get(path: str, params: dict) -> dict:
        return requests.get(
            f"{BASE_URL}{path}", headers={"x-apisports-key": api_key},
            params=params, timeout=timeout,
        ).json()

    try:
        teams = _get("/teams", {"league": league, "season": season}).get("response") or []
        if teams:
            out["team"] = teams[0]
            tid = (teams[0].get("team") or {}).get("id")
            squad = _get("/players/squads", {"team": tid}).get("response") or []
            players = (squad[0].get("players") if squad else None) or []
            if players:
                out["squad_player"] = players[0]
                pid = players[0].get("id")
                stats = _get("/players", {"id": pid, "season": club_season}).get("response") or []
                if stats:
                    out["player_stats"] = stats[0]
    except Exception as exc:  # noqa: BLE001 - a diagnostic must never raise
        out["note"] = f"sample error: {exc}"
    return out


# api-sports position letter -> our normalized position. Goalkeeper/Defender/
# Midfielder/Forward all report a single leading letter (G/D/M/F); anything else
# (or a missing pos) is left as None rather than guessed.
_POSITIONS = frozenset({"G", "D", "M", "F"})


def _position(pos: object) -> str | None:
    """First letter of an api-sports position string, normalized to G/D/M/F."""
    if not isinstance(pos, str) or not pos:
        return None
    letter = pos[0].upper()
    return letter if letter in _POSITIONS else None


def _player_row(entry: object, is_starter: bool, order: int) -> dict | None:
    """Map one api-sports {player: {...}} entry into our lineup-player row dict,
    or None if it carries no usable name (never fabricate a player)."""
    if not isinstance(entry, dict):
        return None
    player = entry.get("player")
    if not isinstance(player, dict):
        return None
    name = player.get("name")
    if not name:
        return None
    return {
        "player_id": player.get("id"),
        "name": name,
        "number": player.get("number"),
        "position": _position(player.get("pos")),
        # Grid is "row:col" for starters and null on the bench (substitutes carry
        # no grid). Kept as the provider's string; the UI lays it out.
        "grid": player.get("grid") if is_starter else None,
        "is_starter": is_starter,
        "order": order,
    }


def parse_lineups(response: list[dict]) -> list[dict]:
    """PURE mapping: api-sports /fixtures/lineups response -> our per-team
    lineup dicts. Display-only; never feeds the prediction model.

    Each output item is
    ``{team, formation, coach, players: [row, ...]}`` where every row is the
    shape persisted to ``lineup_players`` (name, number, position, grid,
    is_starter, order). startXI rows are starters (grid kept); substitutes are
    bench (grid forced to None). Malformed teams / nameless players are skipped
    rather than fabricated."""
    out: list[dict] = []
    for team_block in response or []:
        if not isinstance(team_block, dict):
            continue
        team = (team_block.get("team") or {}).get("name")
        if not team:
            continue
        coach = (team_block.get("coach") or {}).get("name")
        players: list[dict] = []
        order = 0
        for entry in team_block.get("startXI") or []:
            row = _player_row(entry, is_starter=True, order=order)
            if row is not None:
                players.append(row)
                order += 1
        for entry in team_block.get("substitutes") or []:
            row = _player_row(entry, is_starter=False, order=order)
            if row is not None:
                players.append(row)
                order += 1
        out.append({
            "team": team,
            "formation": team_block.get("formation"),
            "coach": coach,
            "players": players,
        })
    return out


def fetch_injuries(api_key: str, fixture_id: int, timeout: float = 15.0) -> list[dict]:
    """Return the raw injury list for one fixture from api-sports.io (/injuries)."""
    return _get(api_key, "/injuries", {"fixture": fixture_id}, timeout)


def parse_injuries(response: list[dict]) -> list[dict]:
    """PURE mapping: api-sports /injuries response -> our injury dicts. Each row is
    ``{provider_player_id, name, type, reason, team_name}`` where ``type`` is "out"
    for "Missing Fixture" else "doubtful". Nameless / malformed rows are skipped
    rather than fabricated (same posture as parse_lineups)."""
    out: list[dict] = []
    for rec in response or []:
        if not isinstance(rec, dict):
            continue
        player = rec.get("player") or {}
        name = player.get("name")
        if not name:
            continue
        team = rec.get("team") or {}
        out.append({
            "provider_player_id": player.get("id"),
            "name": name,
            "type": "out" if player.get("type") == "Missing Fixture" else "doubtful",
            "reason": player.get("reason"),
            "team_name": team.get("name"),
        })
    return out


def _duration(short: str) -> str:
    if short in _SHOOTOUT:
        return "PENALTY_SHOOTOUT"
    if short in _EXTRA_TIME:
        return "EXTRA_TIME"
    return "REGULAR"


def _fixture_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _fixture_matchweek(round_label: object) -> int | None:
    if not isinstance(round_label, str):
        return None
    _, separator, suffix = round_label.rpartition("-")
    if not separator:
        return None
    try:
        return int(suffix.strip())
    except ValueError:
        return None


def normalize_league_fixture(
    raw: object,
    *,
    preserve_stopped_statuses: bool = True,
) -> NormalizedFixture | None:
    """Normalize one api-sports league fixture, or reject a malformed row."""
    if not isinstance(raw, dict):
        return None
    fixture = raw.get("fixture") or {}
    teams = raw.get("teams") or {}
    home = teams.get("home") or {}
    away = teams.get("away") or {}
    fixture_id = fixture.get("id")
    kickoff = _fixture_datetime(fixture.get("date"))
    home_name = home.get("name")
    away_name = away.get("name")
    if (
        not isinstance(fixture_id, int)
        or kickoff is None
        or not isinstance(home_name, str)
        or not home_name.strip()
        or not isinstance(away_name, str)
        or not away_name.strip()
    ):
        return None

    provider_status = (fixture.get("status") or {}).get("short")
    status = internal_status(provider_status) or "scheduled"
    if not preserve_stopped_statuses and status in {
        "postponed", "cancelled", "suspended",
    }:
        status = "scheduled"

    goals = raw.get("goals") or {}
    score_home_90 = score_away_90 = None
    if provider_status in {"AET", "PEN"}:
        fulltime = (raw.get("score") or {}).get("fulltime") or {}
        if isinstance(fulltime.get("home"), int) and isinstance(fulltime.get("away"), int):
            score_home_90 = fulltime["home"]
            score_away_90 = fulltime["away"]

    league = raw.get("league") or fixture.get("league") or {}
    round_label = league.get("round")
    if not isinstance(round_label, str) or not round_label.strip():
        round_label = None
    else:
        round_label = round_label.strip()
    venue = fixture.get("venue") or {}
    venue_name = venue.get("name")
    venue_city = venue.get("city")
    updated = (
        fixture.get("updated")
        or fixture.get("lastUpdated")
        or raw.get("lastUpdated")
    )

    return NormalizedFixture(
        provider="api_football",
        fixture_id=fixture_id,
        home_name=home_name.strip(),
        away_name=away_name.strip(),
        kickoff_utc=kickoff,
        status=status,
        score_home=goals.get("home"),
        score_away=goals.get("away"),
        matchweek=_fixture_matchweek(round_label),
        score_home_90=score_home_90,
        score_away_90=score_away_90,
        venue_name=venue_name.strip() if isinstance(venue_name, str) and venue_name.strip() else None,
        venue_city=venue_city.strip() if isinstance(venue_city, str) and venue_city.strip() else None,
        round_label=round_label,
        upstream_updated_at=_fixture_datetime(updated),
        home_provider_id=home.get("id") if isinstance(home.get("id"), int) else None,
        away_provider_id=away.get("id") if isinstance(away.get("id"), int) else None,
    )


def _to_item(fx: object) -> dict | None:
    """Translate one api-sports fixture into a football-data v4 match dict, or
    None if it is malformed or carries a status we don't model."""
    if not isinstance(fx, dict):
        return None
    status = (fx.get("fixture") or {}).get("status") or {}
    short = status.get("short")
    fd_status = football_data_status(short)
    if fd_status is None:
        return None
    # Preserve the two provider break states inside the canonical in-play
    # lifecycle; live_scores uses PAUSED to derive half-time / the ET break.
    if short in {"HT", "BT"}:
        fd_status = "PAUSED"

    teams = fx.get("teams") or {}
    home = (teams.get("home") or {}).get("name")
    away = (teams.get("away") or {}).get("name")
    if not home or not away:
        return None

    goals = fx.get("goals") or {}
    score: dict = {
        "fullTime": {"home": goals.get("home"), "away": goals.get("away")},
        "duration": _duration(short),
    }
    if short in _SHOOTOUT:
        pen = (fx.get("score") or {}).get("penalty") or {}
        score["penalties"] = {"home": pen.get("home"), "away": pen.get("away")}

    item: dict = {
        "homeTeam": {"name": home}, "awayTeam": {"name": away},
        "status": fd_status, "score": score,
    }
    league = fx.get("league") or (fx.get("fixture") or {}).get("league") or {}
    rnd = league.get("round")
    if rnd:
        item["stage"] = rnd
    elapsed = status.get("elapsed")
    if isinstance(elapsed, int):
        item["minute"] = elapsed           # the OFFICIAL live minute
    extra = status.get("extra")
    if isinstance(extra, int):
        item["injuryTime"] = extra
    item["_fixture_id"] = (fx.get("fixture") or {}).get("id")
    item["utcDate"] = (fx.get("fixture") or {}).get("date")
    return item


def to_feed(fixtures: list[dict]) -> list[dict]:
    """Translate an api-sports fixture list into football-data v4-shaped items,
    skipping malformed/unmodelled entries."""
    return [item for fx in (fixtures or []) if (item := _to_item(fx)) is not None]


def goals_from_events(events: list[dict], home_name: str, away_name: str) -> list[dict]:
    """Translate api-sports /fixtures/events into scorer dicts in our home/away
    orientation. Own goals are credited to the opponent of the scoring player's
    team. Non-goal events and unknown teams are skipped."""
    out: list[dict] = []
    for e in events or []:
        if not isinstance(e, dict) or e.get("type") != "Goal":
            continue
        gtype = _GOAL_DETAIL.get(e.get("detail"))
        if gtype is None:
            continue
        team = (e.get("team") or {}).get("name")
        if team == home_name:
            side = "home"
        elif team == away_name:
            side = "away"
        else:
            continue
        if gtype == "own_goal":
            side = "away" if side == "home" else "home"
        out.append({
            "minute": (e.get("time") or {}).get("elapsed"),
            "side": side,
            "player": (e.get("player") or {}).get("name") or "Unknown",
            "type": gtype,
        })
    return out


def cards_from_events(events: list[dict], home_name: str, away_name: str) -> list[dict]:
    """Translate api-sports /fixtures/events into card dicts in our home/away
    orientation. Non-Card events, unknown details and unknown teams are skipped
    (same posture as goals_from_events)."""
    out: list[dict] = []
    for e in events or []:
        if not isinstance(e, dict) or e.get("type") != "Card":
            continue
        ctype = _CARD_DETAIL.get(e.get("detail"))
        if ctype is None:
            continue
        team = (e.get("team") or {}).get("name")
        if team == home_name:
            side = "home"
        elif team == away_name:
            side = "away"
        else:
            continue
        out.append({
            "minute": (e.get("time") or {}).get("elapsed"),
            "side": side,
            "player": (e.get("player") or {}).get("name") or "Unknown",
            "type": ctype,
        })
    return out


# Statuses where new goals can have happened and scorers are worth fetching.
_SCORABLE = frozenset({"IN_PLAY", "PAUSED", "FINISHED"})


#: Feed statuses where the match is live and a card could arrive without a goal.
_LIVE_STATUSES = frozenset({"IN_PLAY", "PAUSED"})

#: fixture id -> time.monotonic() of the last /fixtures/events fetch. In-process
#: on purpose (mirrors live_refresh's module state): a worker restart just
#: refetches once per fixture.
_last_events_fetch: dict[int, float] = {}


def attach_events(db, feed: list[dict], api_key: str) -> list[dict]:
    """Enrich feed items with `scorers` and `cards` from /fixtures/events.

    Fetches when (a) the fixture's goal total differs from what's stored —
    ~once per goal, and the only trigger for finished fixtures — or (b) the
    fixture is live and the last fetch is older than
    settings.events_refetch_seconds, so a red card with no goal around it is
    still seen promptly."""
    from app.config import settings
    from pipeline.ingest.live_scores import _index_by_pair
    from pipeline.team_mapping import normalize_team_name

    index = _index_by_pair(db)
    for item in feed:
        if item.get("status") not in _SCORABLE:
            continue
        fid = item.get("_fixture_id")
        if fid is None:
            continue
        home, away = item["homeTeam"]["name"], item["awayTeam"]["name"]
        match = index.get(frozenset((normalize_team_name(home), normalize_team_name(away))))
        if match is None:
            continue
        ft = item["score"].get("fullTime") or {}
        total = (ft.get("home") or 0) + (ft.get("away") or 0)
        stored = len(match.goal_events) if match.goal_events is not None else -1
        last = _last_events_fetch.get(fid)
        stale = item.get("status") in _LIVE_STATUSES and (
            last is None or time.monotonic() - last >= settings.events_refetch_seconds
        )
        if stored != total or stale:
            events = fetch_events(api_key, fid)
            _last_events_fetch[fid] = time.monotonic()
            item["scorers"] = goals_from_events(events, home, away)
            item["cards"] = cards_from_events(events, home, away)
    return feed
