"""Tests for pipeline/sports/ufc_espn.py using a fake session (no network)."""
from __future__ import annotations

import copy
import json
from datetime import date
from pathlib import Path

import pytest
import requests

from pipeline.sports import ufc_espn as espn
from pipeline.sports.ufc_espn import EspnUfcProvider
from pipeline.sports.ufc_provider import get_provider

RAW = Path(__file__).parent / "testdata" / "ufc" / "raw"
EVENT = "600061665"
KO_BOUT, DEC_BOUT = "401922277", "401927850"


def load(*parts: str) -> dict:
    return json.loads(RAW.joinpath(*parts).read_text(encoding="utf-8"))


class FakeResponse:
    def __init__(self, status: int = 200, body: object = None, text: str | None = None):
        self.status_code = status
        self._text = text if text is not None else json.dumps(body)

    def json(self):
        return json.loads(self._text)


class FakeSession:
    """Serves canned responses by URL. A list value is consumed one per call."""

    def __init__(self, routes: dict[str, object] | None = None):
        self.routes = routes or {}
        self.calls: list[tuple[str, dict, object]] = []

    def get(self, url, headers=None, timeout=None):
        self.calls.append((url, headers, timeout))
        value = self.routes.get(url, FakeResponse(404, {}))
        if isinstance(value, list):
            value = value.pop(0)
        if isinstance(value, Exception):
            raise value
        return value

    @property
    def urls(self) -> list[str]:
        return [c[0] for c in self.calls]


def ok(body: object) -> FakeResponse:
    return FakeResponse(200, body)


def bout_url(bout_id: str, suffix: str = "") -> str:
    return f"{espn.LEAGUE}/events/{EVENT}/competitions/{bout_id}{suffix}"


def comp_doc(bout_id: str) -> dict:
    event = load("events", f"{EVENT}.json")
    return next(c for c in event["competitions"] if c["id"] == bout_id)


def make(routes=None):
    session = FakeSession(routes)
    sleeps: list[float] = []
    return EspnUfcProvider(session=session, sleep=sleeps.append), session, sleeps


def bout_routes(bout_id: str) -> dict[str, object]:
    doc = load("bouts", f"{EVENT}_{bout_id}.json")
    routes: dict[str, object] = {
        bout_url(bout_id): ok(comp_doc(bout_id)),
        bout_url(bout_id, "/status"): ok(doc["status"]),
        bout_url(bout_id, "/odds?limit=50"): ok(doc["odds"]),
    }
    for fid, block in doc["competitors"].items():
        routes[bout_url(bout_id, f"/competitors/{fid}/statistics")] = ok(block["statistics"])
        if "linescores" in block:
            routes[bout_url(bout_id, f"/competitors/{fid}/linescores")] = ok(block["linescores"])
    return routes


def card_bout(provider, bout_id: str):
    event = load("events", f"{EVENT}.json")
    from pipeline.sports import ufc_espn_parse as parse

    return next(b for b in parse.parse_event(event).bouts if b.provider_id == bout_id)


def test_fetch_event_parses_the_feed():
    provider, _, _ = make({f"{espn.LEAGUE}/events/{EVENT}": ok(load("events", f"{EVENT}.json"))})
    assert provider.fetch_event(EVENT).name.startswith("UFC Fight Night")


def test_every_request_is_polite():
    provider, session, _ = make({f"{espn.LEAGUE}/events/{EVENT}": ok(load("events", f"{EVENT}.json"))})
    provider.fetch_event(EVENT)
    provider.fetch_fighter("0")
    assert len(session.calls) == 2
    for _, headers, timeout in session.calls:
        assert headers["User-Agent"] == "Mozilla/5.0"
        assert timeout == 20


def test_outcome_uses_live_winner_flags():
    routes = bout_routes(KO_BOUT)
    comp = copy.deepcopy(comp_doc(KO_BOUT))
    for c in comp["competitors"]:
        c["winner"] = c["order"] == 2
    routes[bout_url(KO_BOUT)] = ok(comp)
    provider, _, _ = make(routes)
    outcome = provider.fetch_outcome(EVENT, card_bout(provider, KO_BOUT))
    assert outcome.winner == "b"
    assert outcome.state == "final"
    assert outcome.method == "ko_tko"


def test_outcome_none_when_a_document_is_missing():
    routes = bout_routes(KO_BOUT)
    del routes[bout_url(KO_BOUT, "/status")]
    provider, _, _ = make(routes)
    assert provider.fetch_outcome(EVENT, card_bout(provider, KO_BOUT)) is None


def test_fetch_stats_and_odds():
    provider, _, _ = make(bout_routes(KO_BOUT))
    bout = card_bout(provider, KO_BOUT)
    stats = provider.fetch_stats(EVENT, bout)
    assert set(stats) == {"a", "b"}
    assert stats["b"].knockdowns == 1
    assert stats["a"].judges == ()
    odds = provider.fetch_odds(EVENT, bout)
    assert [(o.source, o.moneyline_a, o.moneyline_b) for o in odds] == [("DraftKings", 180, -218)]


def test_judges_only_for_decisions():
    provider, session, _ = make({**bout_routes(KO_BOUT), **bout_routes(DEC_BOUT)})
    provider.fetch_stats(EVENT, card_bout(provider, KO_BOUT))
    assert not any("linescores" in u for u in session.urls)
    stats = provider.fetch_stats(EVENT, card_bout(provider, DEC_BOUT))
    assert any("linescores" in u for u in session.urls)
    assert stats["a"].judges == (27, 28, 27)


def test_fetch_fighter():
    provider, _, _ = make({f"{espn.CORE}/athletes/3156612": ok(load("athletes", "3156612.json"))})
    assert provider.fetch_fighter("3156612").stance == "Orthodox"


def test_404_is_none_without_retry():
    provider, session, sleeps = make()
    assert provider.fetch_fighter("0") is None
    assert len(session.calls) == 1
    assert sleeps == []


def test_429_then_success_retries_once():
    url = f"{espn.CORE}/athletes/3156612"
    provider, session, sleeps = make({url: [FakeResponse(429, {}), ok(load("athletes", "3156612.json"))]})
    assert provider.fetch_fighter("3156612").provider_id == "3156612"
    assert len(session.calls) == 2
    assert sleeps == [5]


def test_403_three_times_gives_up():
    url = f"{espn.CORE}/athletes/1"
    provider, session, sleeps = make({url: [FakeResponse(403, {}) for _ in range(3)]})
    assert provider.fetch_fighter("1") is None
    assert len(session.calls) == 3
    assert sleeps == [5, 15]


def test_timeout_and_bad_json_are_none():
    provider, _, _ = make({f"{espn.CORE}/athletes/1": requests.Timeout("slow")})
    assert provider.fetch_fighter("1") is None
    provider, _, _ = make({f"{espn.CORE}/athletes/2": FakeResponse(200, text="<html>")})
    assert provider.fetch_fighter("2") is None
    provider, _, _ = make({f"{espn.CORE}/athletes/3": ok([1, 2])})
    assert provider.fetch_fighter("3") is None


def test_list_event_ids_follows_pages():
    base = f"{espn.LEAGUE}/events?dates=20261101-20261130&limit=200&page="
    ref = lambda i: {"$ref": f"{espn.LEAGUE}/events/{i}?lang=en&region=us"}
    provider, session, _ = make(
        {
            base + "1": ok({"pageCount": 2, "items": [ref("11"), ref("12")]}),
            base + "2": ok({"pageCount": 2, "items": [ref("13")]}),
        }
    )
    assert provider.list_event_ids(date(2026, 11, 1), date(2026, 11, 30)) == ["11", "12", "13"]
    assert len(session.calls) == 2


def test_list_event_ids_failure_returns_what_it_has():
    provider, _, _ = make()
    assert provider.list_event_ids(date(2026, 11, 1), date(2026, 11, 30)) == []


def test_get_provider_default_is_espn():
    assert get_provider().name == "espn"


def test_get_provider_rejects_unknown():
    with pytest.raises(ValueError, match="espn"):
        get_provider("nope")
