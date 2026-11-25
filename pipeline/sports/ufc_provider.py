"""Provider contract for UFC data.

The ingest code (a later task) talks only to `UfcProvider` and these frozen
value types, so the live ESPN HTTP provider and the file-backed recorded
provider used in tests are interchangeable. Fighters "a" and "b" are the
provider's listing order (ESPN `order` 1 and 2); nothing may attach meaning
to the position.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol


@dataclass(frozen=True)
class FighterRef:
    provider_id: str
    name: str | None


@dataclass(frozen=True)
class BoutCard:
    provider_id: str
    card_order: int | None
    segment: str | None
    segment_label: str | None
    weight_class: str | None
    scheduled_rounds: int | None
    scheduled_utc: datetime | None
    fighter_a: FighterRef
    fighter_b: FighterRef


@dataclass(frozen=True)
class EventCard:
    provider_id: str
    name: str
    first_bout_utc: datetime | None
    last_bout_utc: datetime | None
    venue: str | None
    is_card: bool
    bouts: tuple[BoutCard, ...]


@dataclass(frozen=True)
class FighterProfile:
    provider_id: str
    name: str
    date_of_birth: date | None
    height_in: float | None
    reach_in: float | None
    weight_lb: float | None
    stance: str | None
    country: str | None
    gender: str | None


@dataclass(frozen=True)
class BoutOutcome:
    state: str  # "pre" | "live" | "final" | "cancelled" (cancelled or postponed; no result)
    round: int | None
    clock: str | None
    winner: str | None  # "a" | "b" | None
    method: str | None
    method_detail: str | None


@dataclass(frozen=True)
class FighterBoutStats:
    knockdowns: int | None
    sig_strikes_landed: int | None
    sig_strikes_attempted: int | None
    total_strikes_landed: int | None
    total_strikes_attempted: int | None
    takedowns_landed: int | None
    takedowns_attempted: int | None
    submission_attempts: int | None
    reversals: int | None
    control_seconds: int | None
    extra: dict
    judges: tuple[int, ...]


@dataclass(frozen=True)
class OddsLine:
    source: str
    moneyline_a: int
    moneyline_b: int


class UfcProvider(Protocol):
    name: str  # "espn"; stored in the tables' provider column

    def list_event_ids(self, start: date, end: date) -> list[str]: ...

    def fetch_event(self, event_id: str) -> EventCard | None: ...

    def fetch_outcome(self, event_id: str, bout: BoutCard) -> BoutOutcome | None: ...

    def fetch_stats(self, event_id: str, bout: BoutCard) -> dict[str, FighterBoutStats]: ...  # "a" / "b"

    def fetch_odds(self, event_id: str, bout: BoutCard) -> list[OddsLine]: ...

    def fetch_fighter(self, fighter_id: str) -> FighterProfile | None: ...


def get_provider(name: str | None = None) -> UfcProvider:
    """Build the configured provider (default: settings.ufc_provider)."""
    if name is None:
        from app.config import settings

        name = settings.ufc_provider
    if name == "espn":
        # Imported here because ufc_espn imports this module.
        from pipeline.sports.ufc_espn import EspnUfcProvider

        return EspnUfcProvider()
    raise ValueError(f"unknown UFC provider {name!r}; supported: 'espn'")
