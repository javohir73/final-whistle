"""football-data.org v4 league fixture ingestion."""
from __future__ import annotations

import time
from collections.abc import Mapping
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
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
MAX_RETRY_DELAY_SECONDS = 30.0

_STATUS_TO_INTERNAL = {
    "SCHEDULED": SCHEDULED,
    "TIMED": SCHEDULED,
    "IN_PLAY": IN_PLAY,
    "PAUSED": IN_PLAY,
    "FINISHED": FINISHED,
    "AWARDED": FINISHED,
    "POSTPONED": POSTPONED,
    "CANCELLED": CANCELLED,
    "SUSPENDED": SUSPENDED,
}
_SCORE_DURATIONS = frozenset({None, "REGULAR", "EXTRA_TIME", "PENALTY_SHOOTOUT"})


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        return None
    return parsed.astimezone(timezone.utc)


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value or None


def _valid_optional_integer(value: object) -> bool:
    return value is None or type(value) is int


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
    home = raw.get("homeTeam")
    away = raw.get("awayTeam")
    score = raw.get("score")
    if not all(isinstance(node, dict) for node in (home, away, score)):
        return None
    home_name = _optional_text(home.get("name"))
    away_name = _optional_text(away.get("name"))
    matchweek = raw.get("matchday")
    home_provider_id = home.get("id")
    away_provider_id = away.get("id")
    if (
        type(fixture_id) is not int
        or kickoff is None
        or home_name is None
        or away_name is None
        or not all(_valid_optional_integer(value) for value in (
            matchweek,
            home_provider_id,
            away_provider_id,
        ))
    ):
        return None

    provider_status = raw.get("status")
    if not isinstance(provider_status, str):
        return None
    status = _STATUS_TO_INTERNAL.get(provider_status)
    if status is None:
        return None
    if not preserve_stopped_statuses and status in {
        POSTPONED, CANCELLED, SUSPENDED,
    }:
        status = SCHEDULED

    full_time = score.get("fullTime")
    regular_time = score.get("regularTime")
    duration = score.get("duration")
    if (
        (full_time is not None and not isinstance(full_time, dict))
        or (regular_time is not None and not isinstance(regular_time, dict))
        or (duration is not None and type(duration) is not str)
    ):
        return None
    if duration not in _SCORE_DURATIONS:
        return None
    full_time = full_time or {}
    regular_time = regular_time or {}
    score_home = full_time.get("home")
    score_away = full_time.get("away")
    if not all(_valid_optional_integer(value) for value in (
        score_home,
        score_away,
    )):
        return None
    score_home_90 = score_away_90 = None
    if duration in {"EXTRA_TIME", "PENALTY_SHOOTOUT"}:
        score_home_90 = regular_time.get("home")
        score_away_90 = regular_time.get("away")
        if not all(_valid_optional_integer(value) for value in (
            score_home_90,
            score_away_90,
        )):
            return None

    venue = raw.get("venue")
    if venue is not None and not isinstance(venue, dict):
        return None
    venue = venue or {}
    last_updated = raw.get("lastUpdated")
    upstream_updated_at = _parse_datetime(last_updated)
    if last_updated is not None and upstream_updated_at is None:
        return None
    return NormalizedFixture(
        provider="football_data",
        fixture_id=fixture_id,
        home_name=home_name,
        away_name=away_name,
        kickoff_utc=kickoff,
        status=status,
        score_home=score_home,
        score_away=score_away,
        matchweek=matchweek,
        score_home_90=score_home_90,
        score_away_90=score_away_90,
        venue_name=_optional_text(venue.get("name")),
        venue_city=_optional_text(venue.get("city")),
        round_label=_optional_text(raw.get("stage")),
        upstream_updated_at=upstream_updated_at,
        home_provider_id=home_provider_id,
        away_provider_id=away_provider_id,
    )


def _retry_delay(response, *, clock: Callable[[], datetime]) -> float:
    headers = getattr(response, "headers", {})
    raw = headers.get("Retry-After") if isinstance(headers, Mapping) else None
    if raw is not None:
        try:
            delay = float(raw)
        except (TypeError, ValueError):
            try:
                retry_at = parsedate_to_datetime(raw)
                now = clock()
                if (
                    retry_at.tzinfo is None
                    or retry_at.utcoffset() is None
                    or now.tzinfo is None
                    or now.utcoffset() is None
                ):
                    raise ValueError("Retry-After date and clock must be timezone-aware")
                delay = (
                    retry_at.astimezone(timezone.utc)
                    - now.astimezone(timezone.utc)
                ).total_seconds()
            except (TypeError, ValueError, OverflowError):
                delay = RETRY_DELAY_SECONDS
        return min(MAX_RETRY_DELAY_SECONDS, max(0.0, delay))
    return min(MAX_RETRY_DELAY_SECONDS, RETRY_DELAY_SECONDS)


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
    clock: Callable[[], datetime] | None = None,
) -> list[NormalizedFixture]:
    """Fetch and normalize one current-season football-data.org competition."""
    endpoint = f"/competitions/{competition_code}/matches"
    get = request_get or requests.get
    now = clock or (lambda: datetime.now(timezone.utc))
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
                sleeper(_retry_delay(response, clock=now))
                continue
            raise ProviderQuotaError(
                f"{endpoint}: rate limit exhausted (HTTP 429)",
                endpoint=endpoint,
                detail={"http_status": status_code},
            )
        if 500 <= status_code < 600:
            if attempt + 1 < MAX_ATTEMPTS:
                sleeper(_retry_delay(response, clock=now))
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
        competition = payload.get("competition")
        if not isinstance(competition, dict):
            raise _provider_error(
                f"{endpoint}: competition must be a JSON object",
                endpoint=endpoint,
            )
        returned_code = competition.get("code")
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
