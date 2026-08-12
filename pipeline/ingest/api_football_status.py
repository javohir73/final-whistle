"""Canonical API-Football fixture-status mapping.

Both the structure loader and the live adapter consume ``status.short``. Keep
one table so a provider value cannot mean two different lifecycle states on
the daily and minute-by-minute paths (notably ABD, which means abandoned).
"""

API_FOOTBALL_TO_INTERNAL = {
    "TBD": "scheduled", "NS": "scheduled",
    "1H": "in_play", "2H": "in_play", "ET": "in_play", "P": "in_play", "LIVE": "in_play",
    "HT": "in_play", "BT": "in_play",
    "FT": "finished", "AET": "finished", "PEN": "finished",
    "AWD": "finished", "WO": "finished",
    "SUSP": "suspended", "INT": "suspended", "ABD": "suspended",
    "PST": "postponed",
    "CANC": "cancelled",
}

INTERNAL_TO_FOOTBALL_DATA = {
    "scheduled": "TIMED",
    "in_play": "IN_PLAY",
    "finished": "FINISHED",
    "suspended": "SUSPENDED",
    "postponed": "POSTPONED",
    "cancelled": "CANCELLED",
}


def internal_status(short: str | None) -> str | None:
    return API_FOOTBALL_TO_INTERNAL.get(short)


def football_data_status(short: str | None) -> str | None:
    status = internal_status(short)
    return INTERNAL_TO_FOOTBALL_DATA.get(status) if status else None
