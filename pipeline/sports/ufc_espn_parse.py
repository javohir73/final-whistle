"""Pure parsers over ESPN's UFC (sports.core.api mma/ufc) JSON documents.

Both the live HTTP provider and the recorded test provider feed plain dicts
through these functions, so the interpretation of the feed lives in one place.
Every function tolerates malformed input and answers `None` or `[]` rather
than raising: the feed is third-party and routinely incomplete.
"""
from __future__ import annotations

import logging
import math
from datetime import date, datetime, timezone

from pipeline.sports.ufc_provider import (
    BoutCard,
    BoutOutcome,
    EventCard,
    FighterBoutStats,
    FighterProfile,
    FighterRef,
    OddsLine,
)

log = logging.getLogger(__name__)

_INT_MAX = 2**31 - 1
_CANCELLED_NAMES = ("STATUS_CANCELED", "STATUS_POSTPONED")
_STATE = {"pre": "pre", "in": "live", "post": "final"}

# ESPN stat name -> FighterBoutStats field. Everything else lands in `extra`.
_KNOWN_STATS = {
    "knockDowns": "knockdowns",
    "sigStrikesLanded": "sig_strikes_landed",
    "sigStrikesAttempted": "sig_strikes_attempted",
    "totalStrikesLanded": "total_strikes_landed",
    "totalStrikesAttempted": "total_strikes_attempted",
    "takedownsLanded": "takedowns_landed",
    "takedownsAttempted": "takedowns_attempted",
    "submissions": "submission_attempts",
    "reversals": "reversals",
    "timeInControl": "control_seconds",
}


def parse_dt(value: object) -> datetime | None:
    """Feed datetimes look like '2026-11-21T18:00Z' (sometimes with seconds)."""
    if not isinstance(value, str) or not value:
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    try:
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)
    except OverflowError:
        return None


def _int(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        out = int(round(value))  # NaN raises ValueError, inf OverflowError
    except (ValueError, OverflowError):
        return None
    # Not a usable order, round, price or score; beyond Postgres INTEGER (SQLite
    # would take it, Postgres would reject the row).
    return out if abs(out) <= _INT_MAX else None


def _float(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        out = float(value)  # huge ints raise OverflowError
    except OverflowError:
        return None
    return out if math.isfinite(out) else None


def _text(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None


def _dict(value: object) -> dict:
    return value if isinstance(value, dict) else {}


def _list(value: object) -> list:
    return value if isinstance(value, list) else []


def _ref_id(ref: object) -> str | None:
    """'.../athletes/5216713?lang=en' -> '5216713'."""
    url = _dict(ref).get("$ref")
    if not isinstance(url, str):
        return None
    tail = url.split("?", 1)[0].rstrip("/").rsplit("/", 1)[-1]
    return tail or None


def _parse_bout(comp: dict) -> BoutCard | None:
    bout_id = comp.get("id")
    competitors = _list(comp.get("competitors"))
    if bout_id is None or len(competitors) != 2:
        return None
    by_order: dict[int, dict] = {}
    for c in competitors:
        c = _dict(c)
        order = _int(c.get("order"))
        if order is not None and c.get("id") is not None:
            by_order[order] = c
    if set(by_order) != {1, 2}:
        return None
    a, b = by_order[1], by_order[2]

    def ref(c: dict) -> FighterRef:
        return FighterRef(str(c["id"]), _text(_dict(c.get("athlete")).get("displayName")))

    segment = _dict(comp.get("cardSegment"))
    name = _text(segment.get("name"))
    return BoutCard(
        provider_id=str(bout_id),
        card_order=_int(comp.get("matchNumber")),
        segment=name.lower() if name else None,
        segment_label=_text(segment.get("description")),
        weight_class=_text(_dict(comp.get("type")).get("text")),
        scheduled_rounds=_int(_dict(_dict(comp.get("format")).get("regulation")).get("periods")),
        scheduled_utc=parse_dt(comp.get("date")),
        fighter_a=ref(a),
        fighter_b=ref(b),
    )


def parse_event(doc: dict) -> EventCard | None:
    if not isinstance(doc, dict) or doc.get("id") is None or not _text(doc.get("name")):
        return None
    bouts = tuple(
        bout
        for bout in (_parse_bout(_dict(c)) for c in _list(doc.get("competitions")))
        if bout is not None
    )
    times = [b.scheduled_utc for b in bouts if b.scheduled_utc is not None]
    venues = _list(doc.get("venues"))
    venue = None
    if venues:
        venue = _text(_dict(venues[0]).get("fullName"))
    name = _text(doc.get("name"))
    return EventCard(
        provider_id=str(doc["id"]),
        name=name,
        first_bout_utc=min(times) if times else None,
        last_bout_utc=max(times) if times else None,
        venue=venue,
        is_card="contender series" not in name.lower(),
        bouts=bouts,
    )


def find_competition(event_doc: dict | None, bout_id: str) -> dict | None:
    """The entry of an event document's `competitions` list for one bout."""
    for comp in _list(_dict(event_doc).get("competitions")):
        if isinstance(comp, dict) and str(comp.get("id")) == str(bout_id):
            return comp
    return None


def competition_fighter_ids(competition_doc: dict | None) -> frozenset[str]:
    """Ids of the fighters listed in a competition document."""
    return frozenset(
        str(c["id"])
        for c in _list(_dict(competition_doc).get("competitors"))
        if isinstance(c, dict) and c.get("id") is not None
    )


def winner_flags_by_id(
    competition_doc: dict | None, fighter_a_id: str, fighter_b_id: str
) -> tuple[bool | None, bool | None]:
    """Winner flags of the two given fighters, matched by id rather than by the
    feed's listing order (the stored a/b order may differ from the feed's)."""
    flags: dict[str, bool | None] = {}
    for c in _list(_dict(competition_doc).get("competitors")):
        c = _dict(c)
        if c.get("id") is not None:
            w = c.get("winner")
            flags[str(c["id"])] = w if isinstance(w, bool) else None
    return flags.get(str(fighter_a_id)), flags.get(str(fighter_b_id))


def normalise_method(result: dict | None) -> str | None:
    if not isinstance(result, dict):
        return None
    text = " ".join(
        t.lower() for t in (result.get("name"), result.get("displayName")) if isinstance(t, str)
    ).strip()
    if not text:
        return None
    if "no contest" in text or "nocontest" in text:
        return "no_contest"
    if "draw" in text:
        return "draw"
    if "dq" in text or "disq" in text:
        return "dq"
    if "sub" in text:
        return "submission"
    if "ko" in text:
        return "ko_tko"
    if "dec" in text:
        return "decision"
    return "other"


def parse_outcome(
    status_doc: dict | None, winner_a: bool | None, winner_b: bool | None
) -> BoutOutcome | None:
    """State is pre / live / final, or cancelled for a cancelled or postponed
    bout (`type.name` STATUS_CANCELED / STATUS_POSTPONED, or state "post" with
    `completed` false); a cancelled outcome carries no winner or method."""
    if not isinstance(status_doc, dict):
        return None
    type_doc = _dict(status_doc.get("type"))
    raw_state = type_doc.get("state")
    state = _STATE.get(raw_state) if isinstance(raw_state, str) else None
    if state is None:
        return None
    # A cancelled or postponed bout reports state "post" with no result, which
    # would otherwise read as a final with nothing recorded.
    if type_doc.get("name") in _CANCELLED_NAMES or (
        raw_state == "post" and type_doc.get("completed") is False
    ):
        return BoutOutcome("cancelled", None, None, None, None, None)
    result = status_doc.get("result")
    if winner_a is True and winner_b is not True:
        winner = "a"
    elif winner_b is True and winner_a is not True:
        winner = "b"
    else:
        winner = None
    return BoutOutcome(
        state=state,
        round=_int(status_doc.get("period")),
        clock=_text(status_doc.get("displayClock")),
        winner=winner,
        method=normalise_method(result),
        method_detail=_text(_dict(result).get("description")),
    )


def _judges(linescores_doc: dict | None) -> tuple[int, ...]:
    scored: list[tuple[int, int]] = []
    for item in _list(_dict(linescores_doc).get("items")):
        for ls in _list(_dict(item).get("linescores")):
            ls = _dict(ls)
            value, order = _int(ls.get("value")), _int(ls.get("order"))
            if value is not None:
                scored.append((order if order is not None else 0, value))
    return tuple(v for _, v in sorted(scored, key=lambda p: p[0]))


def parse_stats(
    statistics_doc: dict | None, linescores_doc: dict | None
) -> FighterBoutStats | None:
    known: dict[str, int | None] = {field: None for field in _KNOWN_STATS.values()}
    extra: dict = {}
    for cat in _list(_dict(_dict(statistics_doc).get("splits")).get("categories")):
        for stat in _list(_dict(cat).get("stats")):
            stat = _dict(stat)
            name, value = stat.get("name"), _float(stat.get("value"))
            if not isinstance(name, str) or value is None:
                continue
            if name in _KNOWN_STATS:
                known[_KNOWN_STATS[name]] = int(round(value))
            else:
                extra[name] = value
    judges = _judges(linescores_doc)
    if not known["total_strikes_attempted"] and not known["knockdowns"]:
        # ESPN lists empty stat blocks for some old fights.
        if not judges:
            return None
        return FighterBoutStats(**{f: None for f in known}, extra={}, judges=judges)
    return FighterBoutStats(**known, extra=extra, judges=judges)


def parse_odds(odds_doc: dict | None, fighter_a_id: str, fighter_b_id: str) -> list[OddsLine]:
    lines: list[OddsLine] = []
    for item in _list(_dict(odds_doc).get("items")):
        item = _dict(item)
        away, home = _dict(item.get("awayAthleteOdds")), _dict(item.get("homeAthleteOdds"))
        by_fighter: dict[str, int] = {}
        for side in (away, home):
            fid, line = _ref_id(side.get("athlete")), _int(side.get("moneyLine"))
            if fid is not None and line is not None:
                by_fighter[fid] = line
        source = _text(_dict(item.get("provider")).get("name"))
        if source and str(fighter_a_id) in by_fighter and str(fighter_b_id) in by_fighter:
            lines.append(
                OddsLine(source, by_fighter[str(fighter_a_id)], by_fighter[str(fighter_b_id)])
            )
    return lines


def parse_fighter(doc: dict | None) -> FighterProfile | None:
    if not isinstance(doc, dict) or doc.get("id") is None:
        return None
    name = _text(doc.get("fullName")) or _text(doc.get("displayName"))
    if not name:
        return None
    dob = None
    raw_dob = _text(doc.get("dateOfBirth"))
    if raw_dob:
        try:
            dob = date.fromisoformat(raw_dob[:10])
        except ValueError:
            dob = None
    return FighterProfile(
        provider_id=str(doc["id"]),
        name=name,
        date_of_birth=dob,
        height_in=_float(doc.get("height")),
        reach_in=_float(doc.get("reach")),
        weight_lb=_float(doc.get("weight")),
        stance=_text(_dict(doc.get("stance")).get("text")),
        country=_text(doc.get("citizenship")),
        gender=_text(doc.get("gender")),
    )
