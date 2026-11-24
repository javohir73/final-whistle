"""Live UFC provider over ESPN's public sports.core.api feed.

All politeness and failure handling lives in `_get_json`: every request sends
`User-Agent: Mozilla/5.0` with a 20 s timeout, HTTP 403/429 are retried after
5 s then 15 s, and any other trouble (404, timeouts, bad JSON) is logged and
answered with `None`. The provider methods sit on top of it and parse through
the same pure functions as the recorded provider, so they never raise for feed
trouble. A bout's winner comes from the competition document's
`competitors[].winner` flags, which ESPN updates live.
"""
from __future__ import annotations

import logging
import time
from collections.abc import Callable
from datetime import date

import requests

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

CORE = "https://sports.core.api.espn.com/v2/sports/mma"
LEAGUE = CORE + "/leagues/ufc"

_HEADERS = {"User-Agent": "Mozilla/5.0"}
_TIMEOUT = 20
_RETRY_WAITS = (5, 15)  # seconds before the 2nd and 3rd attempt
_RETRY_STATUSES = (403, 429)
_MAX_PAGES = 10  # never walk more event pages than this, whatever pageCount claims
_NO_WINNER_METHODS = ("draw", "no_contest")


class EspnUfcProvider:
    name = "espn"

    def __init__(
        self,
        session: requests.Session | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self.session = session if session is not None else requests.Session()
        self._sleep = sleep

    def _get_json(self, url: str) -> dict | None:
        for attempt in range(len(_RETRY_WAITS) + 1):
            try:
                resp = self.session.get(url, headers=_HEADERS, timeout=_TIMEOUT)
            except requests.RequestException as exc:
                log.warning("UFC feed request failed for %s: %s", url, exc)
                return None
            status = resp.status_code
            if status in _RETRY_STATUSES:
                if attempt < len(_RETRY_WAITS):
                    wait = _RETRY_WAITS[attempt]
                    log.warning("UFC feed HTTP %s for %s; retrying in %ss", status, url, wait)
                    self._sleep(wait)
                    continue
                log.warning("UFC feed HTTP %s for %s; giving up", status, url)
                return None
            if status != 200:
                log.warning("UFC feed HTTP %s for %s", status, url)
                return None
            try:
                doc = resp.json()
            except ValueError as exc:
                log.warning("UFC feed returned bad JSON for %s: %s", url, exc)
                return None
            if not isinstance(doc, dict):
                log.warning("UFC feed returned a non-object for %s", url)
                return None
            return doc
        return None  # pragma: no cover - the loop always returns

    @staticmethod
    def _bout_url(event_id: str, bout: BoutCard, suffix: str = "") -> str:
        return f"{LEAGUE}/events/{event_id}/competitions/{bout.provider_id}{suffix}"

    def list_event_ids(self, start: date, end: date) -> list[str]:
        window = f"{start:%Y%m%d}-{end:%Y%m%d}"
        ids: list[str] = []
        page, page_count = 1, 1
        while page <= page_count:
            if page > _MAX_PAGES:
                log.warning("UFC event list for %s hit the %d page cap; list is partial", window, _MAX_PAGES)
                break
            doc = self._get_json(f"{LEAGUE}/events?dates={window}&limit=200&page={page}")
            if doc is None:
                if page > 1:
                    log.warning("UFC event list for %s failed on page %d; list is partial", window, page)
                break
            items = doc.get("items")
            if not isinstance(items, list) or not items:
                break
            for item in items:
                event_id = parse._ref_id(item)
                if event_id:
                    ids.append(event_id)
            count = parse._int(doc.get("pageCount"))
            page_count = count if count is not None else 1
            page += 1
        return ids

    def fetch_event(self, event_id: str) -> EventCard | None:
        doc = self._get_json(f"{LEAGUE}/events/{event_id}")
        return parse.parse_event(doc) if doc else None

    def _status_doc(self, event_id: str, bout: BoutCard) -> dict | None:
        return self._get_json(self._bout_url(event_id, bout, "/status"))

    def fetch_outcome(self, event_id: str, bout: BoutCard) -> BoutOutcome | None:
        # Status first, so the winner flags are never older than the status.
        status = self._status_doc(event_id, bout)
        competition = self._get_json(self._bout_url(event_id, bout))
        if competition is None or status is None:
            return None
        ids = (bout.fighter_a.provider_id, bout.fighter_b.provider_id)
        if parse.competition_fighter_ids(competition) != frozenset(ids):
            log.warning(
                "UFC bout %s on the feed is no longer %s vs %s; skipping outcome",
                bout.provider_id,
                *ids,
            )
            return None
        a, b = parse.winner_flags_by_id(competition, *ids)
        outcome = parse.parse_outcome(status, a, b)
        if (
            outcome is not None
            and outcome.state == "final"
            and outcome.winner is None
            and outcome.method not in _NO_WINNER_METHODS
        ):
            log.warning(
                "UFC bout %s is final (method %s) but has no winner yet; will retry",
                bout.provider_id,
                outcome.method,
            )
            return None
        return outcome

    def fetch_stats(self, event_id: str, bout: BoutCard) -> dict[str, FighterBoutStats]:
        outcome = parse.parse_outcome(self._status_doc(event_id, bout), None, None)
        is_decision = outcome is not None and outcome.method == "decision"
        out: dict[str, FighterBoutStats] = {}
        for key, fighter in (("a", bout.fighter_a), ("b", bout.fighter_b)):
            base = f"/competitors/{fighter.provider_id}"
            statistics = self._get_json(self._bout_url(event_id, bout, base + "/statistics"))
            linescores = (
                self._get_json(self._bout_url(event_id, bout, base + "/linescores"))
                if is_decision
                else None
            )
            stats = parse.parse_stats(statistics, linescores)
            if stats is not None:
                out[key] = stats
        return out

    def fetch_odds(self, event_id: str, bout: BoutCard) -> list[OddsLine]:
        doc = self._get_json(self._bout_url(event_id, bout, "/odds?limit=50"))
        return parse.parse_odds(doc, bout.fighter_a.provider_id, bout.fighter_b.provider_id)

    def fetch_fighter(self, fighter_id: str) -> FighterProfile | None:
        return parse.parse_fighter(self._get_json(f"{CORE}/athletes/{fighter_id}"))
