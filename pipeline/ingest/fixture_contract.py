"""Provider-neutral fixture values used by league ingestion."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

FixtureProvider = Literal["api_football", "football_data"]


@dataclass(frozen=True, slots=True)
class NormalizedFixture:
    provider: FixtureProvider
    fixture_id: int
    home_name: str
    away_name: str
    kickoff_utc: datetime
    status: str
    score_home: int | None
    score_away: int | None
    matchweek: int | None
    score_home_90: int | None
    score_away_90: int | None
    venue_name: str | None
    venue_city: str | None
    round_label: str | None
    upstream_updated_at: datetime | None
    home_provider_id: int | None
    away_provider_id: int | None


def capabilities_for(provider: FixtureProvider) -> dict[str, str | bool]:
    if provider == "football_data":
        return {
            "mode": "delayed_results",
            "odds": False,
            "injuries": False,
            "lineups": False,
            "events": False,
            "live_minute": False,
        }
    if provider == "api_football":
        return {
            "mode": "live",
            "odds": True,
            "injuries": True,
            "lineups": True,
            "events": True,
            "live_minute": True,
        }
    raise ValueError(f"unsupported fixture provider: {provider}")
