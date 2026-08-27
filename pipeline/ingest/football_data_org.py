"""football-data.org v4 league fixture ingestion."""
from __future__ import annotations

import time
from datetime import datetime
from typing import Callable

import requests

from app.match_status import (
    CANCELLED,
    FINISHED,
    IN_PLAY,
    POSTPONED,
    SCHEDULED,
    SUSPENDED,
)
from pipeline.ingest.fixture_contract import NormalizedFixture
from pipeline.ingest.provider_errors import (
    ProviderAuthError,
    ProviderError,
    ProviderQuotaError,
)

BASE_URL = "https://api.football-data.org/v4"
MAX_ATTEMPTS = 2
RETRY_DELAY_SECONDS = 6.5

_STATUS_TO_INTERNAL = {
    "SCHEDULED": SCHEDULED,
    "TIMED": SCHEDULED,
    "IN_PLAY": IN_PLAY,
    "PAUSED": IN_PLAY,
    "FINISHED": FINISHED,
    "POSTPONED": POSTPONED,
    "CANCELLED": CANCELLED,
    "SUSPENDED": SUSPENDED,
}


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def normalize_fixture(
    raw: object,
    *,
    preserve_stopped_statuses: bool = True,
) -> NormalizedFixture | None:
    """Normalize one football-data.org v4 match, or reject a malformed row."""
    if not isinstance(raw, dict):
        return None
    fixture_id = raw.get("id")
    kickoff = _parse_datetime(raw.get("utcDate"))
    home = raw.get("homeTeam") or {}
    away = raw.get("awayTeam") or {}
    home_name = _optional_text(home.get("name"))
    away_name = _optional_text(away.get("name"))
    if (
        not isinstance(fixture_id, int)
        or kickoff is None
        or home_name is None
        or away_name is None
    ):
        return None

    status = _STATUS_TO_INTERNAL.get(raw.get("status"), SCHEDULED)
    if not preserve_stopped_statuses and status in {
        POSTPONED, CANCELLED, SUSPENDED,
    }:
        status = SCHEDULED

    score = raw.get("score") or {}
    full_time = score.get("fullTime") or {}
    regular_time = score.get("regularTime") or {}
    score_home_90 = score_away_90 = None
    if score.get("duration") not in {None, "REGULAR"}:
        if (
            isinstance(regular_time.get("home"), int)
            and isinstance(regular_time.get("away"), int)
        ):
            score_home_90 = regular_time["home"]
            score_away_90 = regular_time["away"]

    venue = raw.get("venue") or {}
    matchweek = raw.get("matchday")
    if not isinstance(matchweek, int):
        matchweek = None
    return NormalizedFixture(
        provider="football_data",
        fixture_id=fixture_id,
        home_name=home_name,
        away_name=away_name,
        kickoff_utc=kickoff,
        status=status,
        score_home=full_time.get("home"),
        score_away=full_time.get("away"),
        matchweek=matchweek,
        score_home_90=score_home_90,
        score_away_90=score_away_90,
        venue_name=_optional_text(venue.get("name")),
        venue_city=_optional_text(venue.get("city")),
        round_label=_optional_text(raw.get("stage")),
        upstream_updated_at=_parse_datetime(raw.get("lastUpdated")),
        home_provider_id=home.get("id") if isinstance(home.get("id"), int) else None,
        away_provider_id=away.get("id") if isinstance(away.get("id"), int) else None,
    )


def _retry_delay(response) -> float:
    raw = getattr(response, "headers", {}).get("Retry-After")
    if raw is not None:
        try:
            return max(0.0, float(raw))
        except (TypeError, ValueError):
            pass
    return RETRY_DELAY_SECONDS


def _provider_error(message: str, *, endpoint: str, detail=None) -> ProviderError:
    return ProviderError(message, endpoint=endpoint, detail=detail)


def fetch_football_data_fixtures(
    api_key: str,
    competition_code: str,
    season: int,
    *,
    timeout: float = 15.0,
    request_get: Callable | None = None,
    sleeper: Callable[[float], None] = time.sleep,
) -> list[NormalizedFixture]:
    """Fetch and normalize one current-season football-data.org competition."""
    endpoint = f"/competitions/{competition_code}/matches"
    get = request_get or requests.get
    for attempt in range(MAX_ATTEMPTS):
        try:
            response = get(
                f"{BASE_URL}{endpoint}",
                headers={"X-Auth-Token": api_key},
                params={"season": season},
                timeout=timeout,
            )
        except requests.Timeout as exc:
            if attempt + 1 < MAX_ATTEMPTS:
                sleeper(RETRY_DELAY_SECONDS)
                continue
            raise _provider_error(
                f"{endpoint}: request timed out after {MAX_ATTEMPTS} attempts",
                endpoint=endpoint,
            ) from exc

        status_code = getattr(response, "status_code", 0)
        if status_code in {401, 403}:
            raise ProviderAuthError(
                f"{endpoint}: key rejected or forbidden (HTTP {status_code})",
                endpoint=endpoint,
                detail={"http_status": status_code},
            )
        if status_code == 429:
            if attempt + 1 < MAX_ATTEMPTS:
                sleeper(_retry_delay(response))
                continue
            raise ProviderQuotaError(
                f"{endpoint}: rate limit exhausted (HTTP 429)",
                endpoint=endpoint,
                detail={"http_status": status_code},
            )
        if 500 <= status_code < 600:
            if attempt + 1 < MAX_ATTEMPTS:
                sleeper(_retry_delay(response))
                continue
            raise _provider_error(
                f"{endpoint}: provider unavailable (HTTP {status_code})",
                endpoint=endpoint,
                detail={"http_status": status_code},
            )
        if status_code != 200:
            raise _provider_error(
                f"{endpoint}: unexpected HTTP {status_code}",
                endpoint=endpoint,
                detail={"http_status": status_code},
            )

        try:
            payload = response.json()
        except (TypeError, ValueError) as exc:
            raise _provider_error(
                f"{endpoint}: response was not valid JSON",
                endpoint=endpoint,
            ) from exc
        if not isinstance(payload, dict):
            raise _provider_error(
                f"{endpoint}: expected a JSON object",
                endpoint=endpoint,
            )
        returned_code = (payload.get("competition") or {}).get("code")
        if returned_code != competition_code:
            raise _provider_error(
                f"{endpoint}: expected competition {competition_code}, got {returned_code!r}",
                endpoint=endpoint,
            )
        matches = payload.get("matches")
        if not isinstance(matches, list) or not matches:
            raise _provider_error(
                f"{endpoint}: current-season fixture list is empty",
                endpoint=endpoint,
            )
        normalized = [normalize_fixture(row) for row in matches]
        if any(row is None for row in normalized):
            raise _provider_error(
                f"{endpoint}: fixture list contains a malformed row",
                endpoint=endpoint,
            )
        return [row for row in normalized if row is not None]

    raise AssertionError("unreachable")
