"""The vocabulary of ``Match.status``, in one place.

Until now the column held three values — scheduled / in_play / finished — and
both ingest paths flattened the provider's *deliberate stops* into
``scheduled``: football-data's POSTPONED / CANCELLED / SUSPENDED and
api-football's PST / CANC / ABD / SUSP / INT all landed there.

That flattening is what made the new freshness detector unsafe. A fixture
postponed for weather stays in the DB as ``scheduled`` with its ORIGINAL
kickoff, so four hours later app/data_freshness declares it impossible and
/api/health goes degraded — permanently, because nothing will ever move it.
An ordinary postponement would have pinned smoke red until someone deleted the
row. The detector was right that the state was impossible; the status model was
lying to it.

Three values are therefore preserved rather than flattened. The column is a
plain ``String(20)``, so this needs no migration — only that every consumer
agrees on what the new values mean, which is why the sets below exist instead
of another round of scattered string comparisons.

Rows written before this change still read ``scheduled`` for a postponed
fixture. That is the pre-existing state, not a regression: the next ingest pass
corrects them, because both status maps are applied unconditionally on every
upsert.
"""
from __future__ import annotations

SCHEDULED = "scheduled"
IN_PLAY = "in_play"
FINISHED = "finished"
POSTPONED = "postponed"
CANCELLED = "cancelled"
SUSPENDED = "suspended"

#: The provider has told us this fixture is not proceeding as listed. The
#: distinction that matters for monitoring: an old kickoff on one of these is a
#: FACT we ingested, not a feed that stopped reaching us.
DELIBERATE_STOP = frozenset({POSTPONED, CANCELLED, SUSPENDED})

#: Still expected to be played at its listed kickoff. The freshness detector
#: measures staleness against exactly this set.
AWAITING_KICKOFF = frozenset({SCHEDULED})

#: Not yet a final result. SUSPENDED belongs here: an abandoned match can be
#: resumed or awarded days later, so it must stay a candidate for live refresh.
UNRESOLVED = frozenset({SCHEDULED, IN_PLAY, SUSPENDED, POSTPONED})

#: Picks and tips may still be submitted or edited.
#:
#: POSTPONED stays open, which preserves today's behaviour exactly (it used to
#: read as ``scheduled``): the fixture has not kicked off, so a pick on it is
#: still meaningful once it is rescheduled.
#:
#: CANCELLED and SUSPENDED now lock, which is a deliberate CHANGE and a bug fix
#: in both cases — a cancelled match will never be played, and a suspended one
#: has already kicked off, so leaving picks open let someone submit against a
#: match in progress. Both move in the safe direction: locking can never let a
#: result be gamed.
OPEN_FOR_PICKS = frozenset({SCHEDULED, POSTPONED})

#: Statuses whose live state can still change, for the refresh candidate query.
#: POSTPONED and SUSPENDED are included so a reinstated or resumed fixture is
#: seen again — excluding them would strand it in its stopped state forever.
LIVE_CANDIDATE = frozenset({SCHEDULED, IN_PLAY, SUSPENDED, POSTPONED})


def is_locked(status: str) -> bool:
    """Are picks closed for a fixture in this status?"""
    return status not in OPEN_FOR_PICKS


def is_deliberate_stop(status: str) -> bool:
    """Did the provider deliberately stop this fixture (vs. our feed going quiet)?"""
    return status in DELIBERATE_STOP


#: schema.org eventStatus for each of ours. Used by the match page's
#: SportsEvent markup — a postponed fixture must say so rather than continue
#: advertising a start time that has passed.
SCHEMA_EVENT_STATUS = {
    POSTPONED: "https://schema.org/EventPostponed",
    CANCELLED: "https://schema.org/EventCancelled",
}
