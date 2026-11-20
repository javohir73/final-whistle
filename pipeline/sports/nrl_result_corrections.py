"""Reviewed corrections to the fixturedownload NRL feed.

fixturedownload.com is a third-party mirror. The 2026-11-20 model audit
(docs/experiments/2026-11-20-nrl-model-audit/AUDIT.md) reconciled all ten
seasons against NRL.com's own draw data and found exactly two kinds of error:
three final scores that differ from the official result, and the whole 2017
finals series missing. Each entry below was confirmed against NRL.com and,
independently, against the Wikipedia season pages.

This is deliberately a short, hand-reviewed list, not a second feed: add an
entry only with two independent sources, and record them in the audit trail.

If the feed ever publishes a MISSING_ROWS match itself under different
round/match numbers, remove it from MISSING_ROWS AND delete the hand-added
row from the database first: stored finished rows are immutable, so the
feed's copy would otherwise be stored alongside it and counted twice.
"""
from __future__ import annotations

# (season, round, home, away) -> official (home score, away score).
SCORE_CORRECTIONS: dict[tuple[int, int, str, str], tuple[int, int]] = {
    (2018, 7, "Rabbitohs", "Raiders"): (42, 22),   # feed: 42-18
    (2019, 17, "Panthers", "Titans"): (24, 2),     # feed: 21-2
    (2026, 27, "Sharks", "Storm"): (20, 24),       # feed: 20-23
}

# Finished matches the feed does not carry at all, in the feed's own row shape.
# 2017: the feed stops at round 26 (match 192); the finals follow the numbering
# the feed itself uses for 2018 onward (one round per finals week).
MISSING_ROWS: dict[int, list[dict]] = {
    2017: [
        {"MatchNumber": 193, "RoundNumber": 27, "DateUtc": "2017-09-08 09:55:00Z", "Location": "Allianz Stadium",
         "HomeTeam": "Roosters", "AwayTeam": "Broncos", "HomeTeamScore": 24, "AwayTeamScore": 22},
        {"MatchNumber": 194, "RoundNumber": 27, "DateUtc": "2017-09-09 06:10:00Z", "Location": "AAMI Park",
         "HomeTeam": "Storm", "AwayTeam": "Eels", "HomeTeamScore": 18, "AwayTeamScore": 16},
        {"MatchNumber": 195, "RoundNumber": 27, "DateUtc": "2017-09-09 09:40:00Z", "Location": "Allianz Stadium",
         "HomeTeam": "Sea Eagles", "AwayTeam": "Panthers", "HomeTeamScore": 10, "AwayTeamScore": 22},
        {"MatchNumber": 196, "RoundNumber": 27, "DateUtc": "2017-09-10 06:10:00Z", "Location": "Allianz Stadium",
         "HomeTeam": "Sharks", "AwayTeam": "Cowboys", "HomeTeamScore": 14, "AwayTeamScore": 15},
        {"MatchNumber": 197, "RoundNumber": 28, "DateUtc": "2017-09-15 09:55:00Z", "Location": "Suncorp Stadium",
         "HomeTeam": "Broncos", "AwayTeam": "Panthers", "HomeTeamScore": 13, "AwayTeamScore": 6},
        {"MatchNumber": 198, "RoundNumber": 28, "DateUtc": "2017-09-16 09:40:00Z", "Location": "ANZ Stadium",
         "HomeTeam": "Eels", "AwayTeam": "Cowboys", "HomeTeamScore": 16, "AwayTeamScore": 24},
        {"MatchNumber": 199, "RoundNumber": 29, "DateUtc": "2017-09-22 09:55:00Z", "Location": "AAMI Park",
         "HomeTeam": "Storm", "AwayTeam": "Broncos", "HomeTeamScore": 30, "AwayTeamScore": 0},
        {"MatchNumber": 200, "RoundNumber": 29, "DateUtc": "2017-09-23 09:40:00Z", "Location": "Allianz Stadium",
         "HomeTeam": "Roosters", "AwayTeam": "Cowboys", "HomeTeamScore": 16, "AwayTeamScore": 29},
        {"MatchNumber": 201, "RoundNumber": 30, "DateUtc": "2017-10-01 08:15:00Z", "Location": "ANZ Stadium",
         "HomeTeam": "Storm", "AwayTeam": "Cowboys", "HomeTeamScore": 34, "AwayTeamScore": 6},
    ],
}


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def apply_corrections(year: int, rows: list[dict]) -> tuple[list[dict], set[tuple[int, int]]]:
    """Return (rows with reviewed corrections applied, corrected (round, match_no) keys).

    Pure: `rows` is never mutated. A score is corrected only on a row the feed
    already reports as finished. A missing row is appended only while the feed
    still lacks that (round, match_no) and that pairing in that round, so the
    feed publishing the match itself later can never create a duplicate.
    """
    out: list[dict] = []
    corrected: set[tuple[int, int]] = set()
    for row in rows:
        # A malformed row (non-dict, non-int round or match number) is passed
        # through untouched for parse_row to skip; it must never raise here.
        if not isinstance(row, dict) or not _is_int(row.get("RoundNumber")) or not _is_int(row.get("MatchNumber")):
            out.append(row)
            continue
        key = (year, row["RoundNumber"], row.get("HomeTeam"), row.get("AwayTeam"))
        fix = SCORE_CORRECTIONS.get(key)
        finished = row.get("HomeTeamScore") is not None and row.get("AwayTeamScore") is not None
        if fix is not None and finished and (row["HomeTeamScore"], row["AwayTeamScore"]) != fix:
            row = {**row, "HomeTeamScore": fix[0], "AwayTeamScore": fix[1]}
            corrected.add((row["RoundNumber"], row["MatchNumber"]))
        out.append(row)

    if year not in MISSING_ROWS:
        return out, corrected
    valid = [r for r in out if isinstance(r, dict) and _is_int(r.get("RoundNumber")) and _is_int(r.get("MatchNumber"))]
    numbers = {(r["RoundNumber"], r["MatchNumber"]) for r in valid}
    pairings = {(r["RoundNumber"], frozenset((r.get("HomeTeam"), r.get("AwayTeam")))) for r in valid}
    max_round = max((r["RoundNumber"] for r in valid), default=0)
    for extra in MISSING_ROWS.get(year, []):
        if extra["RoundNumber"] <= max_round:
            continue  # the feed now carries this stage of the season itself
        if (extra["RoundNumber"], extra["MatchNumber"]) in numbers:
            continue
        if (extra["RoundNumber"], frozenset((extra["HomeTeam"], extra["AwayTeam"]))) in pairings:
            continue
        out.append(dict(extra))
    return out, corrected
