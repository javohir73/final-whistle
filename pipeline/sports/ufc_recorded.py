"""File-backed UFC provider that replays recorded ESPN documents.

Layout under `root`: `events/<event_id>.json`, `bouts/<event_id>_<bout_id>.json`
(keys `status`, `odds`, `competitors: {fighter_id: {statistics, linescores?}}`)
and `athletes/<fighter_id>.json`. Used by tests and offline runs; it reads
through the same parsers as the HTTP provider. A missing or unreadable file is
a normal "not available" answer, never an error.
"""
from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path

from pipeline.sports import ufc_espn_parse as parse
from pipeline.sports.ufc_provider import (
    BoutCard,
    BoutOutcome,
    EventCard,
    FighterBoutStats,
    FighterProfile,
    OddsLine,
)

log = logging.getLogger(__name__)


class RecordedUfcProvider:
    def __init__(self, root: str | Path, name: str = "espn") -> None:
        self.root = Path(root)
        self.name = name

    def _load(self, *parts: str) -> dict | None:
        path = self.root.joinpath(*parts)
        try:
            with path.open(encoding="utf-8") as f:
                doc = json.load(f)
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            log.warning("unreadable recorded UFC file %s: %s", path, exc)
            return None
        return doc if isinstance(doc, dict) else None

    def _bout_doc(self, event_id: str, bout: BoutCard) -> dict | None:
        return self._load("bouts", f"{event_id}_{bout.provider_id}.json")

    def list_event_ids(self, start: date, end: date) -> list[str]:
        ids: list[str] = []
        for path in sorted((self.root / "events").glob("*.json")):
            doc = self._load("events", path.name)
            when = parse.parse_dt(doc.get("date")) if doc else None
            if when is not None and start <= when.date() <= end:
                ids.append(path.stem)
        return ids

    def fetch_event(self, event_id: str) -> EventCard | None:
        doc = self._load("events", f"{event_id}.json")
        return parse.parse_event(doc) if doc else None

    def fetch_outcome(self, event_id: str, bout: BoutCard) -> BoutOutcome | None:
        event_doc = self._load("events", f"{event_id}.json")
        if event_doc is None:
            return None
        bout_doc = self._bout_doc(event_id, bout)
        if bout_doc is None:
            # Recorded layout only: "no bout file" means nothing has happened yet.
            # The HTTP provider must not copy this; a failed fetch there is None.
            return BoutOutcome("pre", None, None, None, None, None)
        competition = parse.find_competition(event_doc, bout.provider_id)
        ids = (bout.fighter_a.provider_id, bout.fighter_b.provider_id)
        if parse.competition_fighter_ids(competition) != frozenset(ids):
            log.warning("recorded UFC bout %s is not %s vs %s", bout.provider_id, *ids)
            return None
        a, b = parse.winner_flags_by_id(competition, *ids)
        return parse.parse_outcome(bout_doc.get("status"), a, b)

    def fetch_stats(self, event_id: str, bout: BoutCard) -> dict[str, FighterBoutStats]:
        competitors = (self._bout_doc(event_id, bout) or {}).get("competitors")
        if not isinstance(competitors, dict):
            return {}
        out: dict[str, FighterBoutStats] = {}
        for key, fighter in (("a", bout.fighter_a), ("b", bout.fighter_b)):
            block = competitors.get(fighter.provider_id)
            if not isinstance(block, dict):
                continue
            stats = parse.parse_stats(block.get("statistics"), block.get("linescores"))
            if stats is not None:
                out[key] = stats
        return out

    def fetch_odds(self, event_id: str, bout: BoutCard) -> list[OddsLine]:
        doc = self._bout_doc(event_id, bout) or {}
        return parse.parse_odds(
            doc.get("odds"), bout.fighter_a.provider_id, bout.fighter_b.provider_id
        )

    def fetch_fighter(self, fighter_id: str) -> FighterProfile | None:
        return parse.parse_fighter(self._load("athletes", f"{fighter_id}.json"))
