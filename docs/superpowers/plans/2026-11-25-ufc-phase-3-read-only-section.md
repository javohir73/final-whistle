# UFC Phase 3 — Read-only Section Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors can open `/ufc` and see the next UFC card, every card's fights and results, one fight in detail, a fighter's record and fights, and the list of upcoming and past cards, in the site's existing football look. No model output, picks, odds or live polling.

**Architecture:** First, a small fix to the phase 1 pipeline (postponed is not cancelled; a feed-cancelled bout can come back; the results job's exit code). Then a public read-only API in one new router, `backend/app/api/ufc.py`, with Pydantic schemas and batched queries (fighters and records loaded once per response, never per bout). Then the frontend: UFC joins the competition registry as a third sport, server pages fetch through `lib/api.ts` like the NRL pages, and client views render bout rows with the shared `FixtureRow` and the viewer's time zone. Backend tasks (1–3) can merge and deploy before any frontend task; the frontend is previewed locally against the production API.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, pytest (in-memory SQLite). Next.js App Router, TypeScript, Tailwind, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-25-ufc-section-design.md` (sections 2, 3, 5.1, 5.2, 5.5, 8.3, 8.4, 8.5, 9.1, 10, 11). The approved phone mock-ups are in `~/Projects/fw-ufc-spike/design/ufc-on-finalwhistle.html` (the card page and the fight page, without "Your pick", "The model's call" and the market). Where this plan and the spec differ, this plan wins (it follows the owner's brief: `enabled: true`, `hasTips: false`, tabs Card and Events only).

## Global Constraints

- Additive only. Football and NRL behaviour does not change. Do not edit `frontend/lib/reveal.ts`. No migration: the `ufc_*` tables exist.
- `frontend/node_modules` and `.venv` are shared symlinks: never run `npm install`, never edit `package.json` or `package-lock.json`.
- Tests never touch the network (the Python root `conftest.py` blocks requests; frontend tests mock `@/lib/api` or `global.fetch`).
- No model fields, odds, ratings or picks in any UFC response or page. No Open Graph images in this plan.
- Words: "bout" and "event" in code, data and API; "fight" and "card" in everything a visitor reads.
- Design system only: `frontend/components/ui` primitives and existing tokens. No new colours, fonts or shadows. Fighter marks are round monograms of initials (no photos, no flags). Times: the viewer's local time via `useTimezone()`, lower-case via `kickoffTimeLower(iso, tz)` from `components/match/matchPageData.ts` (e.g. `5:00 am`). Dates: `kickoffDate(iso, tz)` from `lib/datetime.ts` (e.g. `Sun 6 Dec`).
- Phone first: every screen works at 390 px with no horizontal page scroll, then at 1024 and 1440.
- Every UFC page carries the line `FinalWhistle is not affiliated with the UFC.` and no metadata says "official".
- Python gate per task: `.venv/bin/python -m pytest <files> -p no:cacheprovider -o addopts="" -q`. Frontend gate per task: `cd frontend && npm run typecheck && npm run lint && npx jest <paths>`. The full suites run once, in Task 11.
- Stage with explicit paths. Commit after each task with a conventional message (`feat(ufc): …` / `fix(ufc): …`), ending with the Co-Authored-By line your own harness specifies. Do not push.

- API errors use the app's existing envelope: raise `HTTPException(404, detail={"code": ..., "message": ...})` and the global handler in `backend/app/main.py` rewrites it to `{"error": {"code": ..., "message": ...}}`. Tests and the frontend read `error.code`, never `detail.code`.

## Review Focus

1. A card with zero bouts (the feed lists the event before its fights): the API returns `segments: []`, `bout_count: 0`, `main_event: null`, and the card page shows "The fights for this card have not been announced yet." instead of an empty box. (Tasks 2 and 7)
2. A fighter still named "TBA" (ESPN gives no name until the profile fetch): monogram `?`, the name "TBA", no link to a fighter page, and no crash in initials or result lines. (Tasks 5, 6 and 8)
3. Unknown tale-of-the-tape values: a row is omitted when both sides are unknown, one unknown side shows `–`, and a fight with nothing known says "Measurements for these fighters are not available yet." (Tasks 3 and 8)
4. Very long names at 390 px: the bout row wraps inside its column and the fight hero keeps both names inside the viewport. (Tasks 6 and 8)
5. A cancelled bout: struck-through names, a "Cancelled" chip, no result, and the internal `cancelled by feed` marker never reaches a response. (Tasks 2 and 6)
6. A draw or a no contest: no muted loser, box `DRAW` / `NC`, result line "Draw (majority), round 3, 5:00" / "No contest (accidental eye poke), round 1, 2:10", and the fighter table shows "Draw" / "No contest" chips. (Tasks 3, 5 and 9)
7. An event slug, fight id or fighter slug that does not exist: a real HTTP 404 (decided in the segment layout, before `loading.tsx` streams a 200), and malformed ids never reach the API. (Tasks 7, 8 and 9)

---

### Task 1: Pipeline fixes — postponed bouts, un-cancel, results exit code

**Files:**
- Modify: `pipeline/sports/ufc_espn_parse.py` (`parse_outcome`, `_CANCELLED_NAMES` at line 27, docstring)
- Modify: `pipeline/sports/ufc_ingest.py` (module docstring; new `reinstate_feed_cancelled`; call it from `ingest_window`)
- Modify: `pipeline/sports/ufc_results.py` (module docstring; `ResultsSummary`; `refresh_results`; `main`)
- Test: `pipeline/sports/ufc_espn_parse_test.py`, `pipeline/sports/ufc_ingest_test.py`, `pipeline/sports/ufc_results_test.py`

**Interfaces:**
- Consumes: `BoutOutcome`, `UfcProvider`, `EventCard` (`ufc_provider.py`); `current_bout`, `_bout_values`, `_utc`, `FEED_CANCELLED`, `IngestSummary.bouts_reinstated` (`ufc_ingest.py`).
- Produces:

```python
# ufc_ingest.py
def reinstate_feed_cancelled(
    db: Session, provider: UfcProvider, card: EventCard, now: datetime, summary: IngestSummary
) -> int   # rows returned to "scheduled"; does not commit

# ufc_results.py
@dataclass
class ResultsSummary: ...existing fields...; bouts_failed: int = 0   # failures of due (results) bouts only
```

Rules:
- `parse_outcome`: a status whose `type.name` is `STATUS_POSTPONED` returns `BoutOutcome("pre", None, None, None, None, None)` whatever its `state` or `completed`. This check runs before the cancellation check. `_CANCELLED_NAMES` keeps only `STATUS_CANCELED`.
- `reinstate_feed_cancelled`: for each `BoutCard` on the card, the current row (`current_bout`) qualifies when all hold: status `cancelled`; `method_detail == FEED_CANCELLED`; `locked_at is None`; the same unordered fighter pair (by provider fighter id, as `_apply_bout` compares); the card's `scheduled_utc` (normalised with `_utc`) is not None and later than `now`. Only for a qualifying row call `provider.fetch_outcome(card.provider_id, bout)`. If the outcome is not None and its state is `"pre"`: status `scheduled`, `method_detail = None`, card fields set from `_bout_values(bout)`, `summary.bouts_reinstated += 1`. Anything else leaves the row alone.
- `ingest_window` calls it right after `upsert_event`, inside the same per-event `try` (so a failure rolls back that event only). `upsert_event` stays database-only.
- `refresh_results`: in the per-bout loop, an exception on a due bout (`results is True`) increments both `failed` and `bouts_failed`; an exception on an upcoming-odds bout, the roll-up or profiles increments `failed` only.
- `main()`: exit 1 only when `bouts_failed > 0 and bouts_failed >= checked` (a due bout failed and none succeeded). Update its docstring.

- [ ] **Step 1: Write the failing tests.**

In `ufc_espn_parse_test.py`, delete `test_postponed_status_parses_as_cancelled` and add:

```python
@pytest.mark.parametrize("state,completed", [("pre", None), ("post", False), ("post", None)])
def test_postponed_status_is_not_a_cancellation(state, completed):
    out = parse_outcome(_cancelled_status("STATUS_POSTPONED", state=state, completed=completed), None, None)
    assert out == BoutOutcome("pre", None, None, None, None, None)

def test_canceled_status_is_still_cancelled():
    assert parse_outcome(_cancelled_status("STATUS_CANCELED"), None, None).state == "cancelled"
```

In `ufc_ingest_test.py`, add a stub provider and these tests (`NOW`, `T0`, `_bout`, `_card` already exist there; `T0` is after `NOW`):

```python
class _OutcomeProvider:
    """Serves one card and a fixed outcome; records fetch_outcome calls."""
    name = "espn"
    def __init__(self, card, outcome): self.card, self.outcome, self.outcome_calls = card, outcome, []
    def list_event_ids(self, start, end): return [self.card.provider_id]
    def fetch_event(self, event_id): return self.card
    def fetch_outcome(self, event_id, bout): self.outcome_calls.append(bout.provider_id); return self.outcome
    def fetch_stats(self, event_id, bout): return {}
    def fetch_odds(self, event_id, bout): return []
    def fetch_fighter(self, fighter_id): return None

PRE = BoutOutcome("pre", None, None, None, None, None)
LATER = T0 + timedelta(hours=1)

def _feed_cancel(db, when=T0):           # ingest the card, then mark b1 as the results job does
    upsert_event(db, "espn", _card(_bout(when=when)), now=NOW); db.commit()
    row = current_bout(db, "espn", "b1"); row.status, row.method_detail = "cancelled", "cancelled by feed"; db.commit()
    return row

def test_feed_cancelled_bout_returns_when_the_feed_says_pre(db_session):
    _feed_cancel(db_session)
    p = _OutcomeProvider(_card(_bout(when=LATER)), PRE)
    summary = ingest_window(db_session, p, date(2026, 12, 1), date(2026, 12, 31), now=NOW)
    row = current_bout(db_session, "espn", "b1")
    assert (row.status, row.method_detail, _utc(row.scheduled_utc)) == ("scheduled", None, LATER)
    assert summary.bouts_reinstated == 1 and p.outcome_calls == ["b1"]

def test_feed_cancelled_bout_stays_cancelled_while_the_feed_says_cancelled(db_session):
    _feed_cancel(db_session)
    ingest_window(db_session, _OutcomeProvider(_card(_bout()), BoutOutcome("cancelled", None, None, None, None, None)),
                  date(2026, 12, 1), date(2026, 12, 31), now=NOW)
    row = current_bout(db_session, "espn", "b1")
    assert (row.status, row.method_detail) == ("cancelled", "cancelled by feed")

def test_none_outcome_leaves_it_cancelled(db_session):            # outcome None → still cancelled, marker kept

def test_past_feed_cancelled_bout_is_not_rechecked(db_session):
    _feed_cancel(db_session)
    p = _OutcomeProvider(_card(_bout(when=NOW - timedelta(hours=1))), PRE)
    ingest_window(db_session, p, date(2026, 11, 1), date(2026, 12, 31), now=NOW)
    assert p.outcome_calls == [] and current_bout(db_session, "espn", "b1").status == "cancelled"

def test_locked_feed_cancelled_bout_is_not_reinstated(db_session):  # locked_at set → outcome_calls == [], still cancelled

def test_new_opponent_on_a_feed_cancelled_bout_is_a_new_revision(db_session):
    _feed_cancel(db_session)
    p = _OutcomeProvider(_card(_bout(b=("3", None))), PRE)
    ingest_window(db_session, p, date(2026, 12, 1), date(2026, 12, 31), now=NOW)
    old, new = db_session.query(UfcBout).order_by(UfcBout.revision).all()
    assert (old.status, old.method_detail, new.status, new.revision) == ("cancelled", "cancelled by feed", "scheduled", 1)
    assert p.outcome_calls == []
```

The existing `test_feed_cancelled_bout_still_on_the_card_is_not_reinstated` (an `upsert_event`-only call) stays and must still pass.

In `ufc_results_test.py`, replace the five assertions of `test_results_main_exit_codes` with:

```python
    assert run(ResultsSummary(checked=3, failed=3, bouts_failed=3)) == 1
    assert run(ResultsSummary(checked=1, failed=4, bouts_failed=1)) == 1
    assert run(ResultsSummary(checked=0, failed=1, bouts_failed=0)) == 0   # quiet day, a profile or odds step failed
    assert run(ResultsSummary(checked=3, failed=5, bouts_failed=2)) == 0   # one due bout succeeded
    assert run(ResultsSummary(checked=0, failed=0)) == 0
```

and add:

```python
def test_upcoming_odds_failure_is_not_a_bout_failure(db_session):
    # one scheduled bout 2 days after AFTER_CARD (use _bare_bout); provider.fetch_odds raises RuntimeError
    summary = refresh_results(db_session, provider, now=AFTER_CARD)
    assert (summary.failed, summary.bouts_failed, summary.checked) == (1, 0, 0)

def test_due_bout_failure_counts_as_a_bout_failure(db_session):
    # one scheduled bout 1 hour before AFTER_CARD; provider.fetch_outcome raises RuntimeError
    assert (summary.checked, summary.bouts_failed) == (1, 1)
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_espn_parse_test.py pipeline/sports/ufc_ingest_test.py pipeline/sports/ufc_results_test.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail (postponed parses as cancelled; no reinstatement; `bouts_failed` unknown).
- [ ] **Step 3: Implement** the rules above. Update the three module docstrings so none still says a postponed bout is cancelled, and so `ufc_ingest.py` explains the un-cancel path.
- [ ] **Step 4: Run** the same command, then `.venv/bin/python -m pytest pipeline/sports -k ufc -p no:cacheprovider -o addopts="" -q` — expected: all pass.
- [ ] **Step 5: Commit** `fix(ufc): postponed is not cancelled, feed-cancelled bouts can return, quiet days exit 0`.

### Task 2: API — card list, next card, card detail

**Files:**
- Create: `backend/app/api/ufc.py`
- Modify: `backend/app/schemas/__init__.py` (append the `Ufc*` classes), `backend/app/main.py` (import `ufc` in the `from app.api import (...)` block and `app.include_router(ufc.router)` after `nrl_user_tips`)
- Test: `backend/tests/test_ufc_api.py`

**Interfaces:**
- Consumes: `UfcEvent`, `UfcBout`, `UfcFighter`, `UfcBoutStat` from `app.models`; `get_db`.
- Produces (schemas, all `BaseModel`; datetimes are timezone-aware UTC):

```python
class UfcRecordOut:       wins: int; losses: int; draws: int; no_contests: int
class UfcFighterMiniOut:  slug: str; name: str; country: str | None; record: UfcRecordOut | None
class UfcMainEventOut:    fighter_a: UfcFighterMiniOut; fighter_b: UfcFighterMiniOut
class UfcResultOut:       winner: Literal["a", "b"] | None; method: str | None; method_detail: str | None
                          end_round: int | None; end_clock: str | None
class UfcBoutSummaryOut:  id: int; card_order: int | None; weight_class: str | None; scheduled_rounds: int | None
                          is_title: bool | None; scheduled_utc: datetime | None; status: str
                          fighter_a: UfcFighterMiniOut; fighter_b: UfcFighterMiniOut; result: UfcResultOut | None
class UfcSegmentOut:      key: str; label: str; scheduled_utc: datetime | None; bouts: list[UfcBoutSummaryOut]
class UfcEventSummaryOut: slug: str; name: str; status: str; first_bout_utc: datetime | None
                          last_bout_utc: datetime | None; venue: str | None; bout_count: int
                          main_event: UfcMainEventOut | None
class UfcEventDetailOut(UfcEventSummaryOut): segments: list[UfcSegmentOut]
class UfcEventsOut:       events: list[UfcEventSummaryOut]
```

- Produces (in `ufc.py`, used by Task 3):

```python
router = APIRouter(prefix="/api/ufc", tags=["ufc"])
FEED_CANCELLED = "cancelled by feed"            # must equal pipeline.sports.ufc_ingest.FEED_CANCELLED
UPCOMING_GRACE = timedelta(hours=24)
def _utc(dt: datetime | None) -> datetime | None                       # attach UTC to SQLite's naive values
def records_for(db: Session, fighter_ids: Iterable[int]) -> dict[int, UfcRecordOut]   # ONE query
def fighter_minis(db: Session, fighter_ids: Iterable[int]) -> dict[int, UfcFighterMiniOut]  # ≤ 2 queries
def bout_summary(bout: UfcBout, minis: dict[int, UfcFighterMiniOut]) -> UfcBoutSummaryOut
def public_card(db: Session, slug: str) -> UfcEvent | None             # is_card events only
```

Endpoints and rules:
- `GET /events?when=upcoming|past&limit=20&offset=0` → `UfcEventsOut`. `when` is a `Literal` (anything else 422), `limit` 1–50, `offset` ≥ 0. Only `is_card` events; `cancelled` events are in neither list. Let `end = coalesce(last_bout_utc, first_bout_utc)`. Upcoming: status `scheduled` or `live` and (`end` is null or `end >= now - UPCOMING_GRACE`), ordered `first_bout_utc` ascending, nulls last, then `id`. Past: status `finished`, or status `scheduled`/`live` with `end < now - UPCOMING_GRACE`; ordered `first_bout_utc` descending, then `id` descending.
- `GET /events/next` (declared before `/events/{slug}`) → `UfcEventDetailOut` of the first upcoming card (same rule and order); else the most recent finished card; else 404 `{"code": "no_events", "message": "No UFC cards are loaded yet"}`.
- `GET /events/{slug}` → `UfcEventDetailOut`; a missing slug or a non-card event (Contender Series) is 404 `{"code": "not_found", "message": "No UFC card with that name"}`.
- `bout_count`: bouts not `cancelled` or `changed`. `main_event`: the bout with the lowest `card_order` among those (nulls last, then id); null when there is none.
- Segments: rows with status `changed` are never returned; `cancelled` rows are. Group by `segment` (null → key `"other"`, label `"Fights"`); label is the first non-null `segment_label` in the group, else the key; `scheduled_utc` is the earliest bout time in the group. Order: key `"main"` first, then `scheduled_utc` descending (nulls last), then key. Bouts by `card_order` ascending (nulls last), then id.
- `result` is set only when status is `finished`; its `method_detail` is None when it equals `FEED_CANCELLED`.
- Records: a fighter's stored `finished` bouts on `is_card` events. Win when `winner` is their side, loss when it is the other side, draw when `method == "draw"`, no contest when `method == "no_contest"`. A fighter with no counted bout has `record: null`. `records_for` is one statement over a `union_all` of the a-side and b-side rows, grouped by fighter:

```python
def side(fighter_col, me, them):
    return (select(fighter_col.label("fighter_id"),
                   case((UfcBout.winner == me, 1), else_=0).label("w"),
                   case((UfcBout.winner == them, 1), else_=0).label("l"),
                   case((UfcBout.method == "draw", 1), else_=0).label("d"),
                   case((UfcBout.method == "no_contest", 1), else_=0).label("nc"))
            .join(UfcEvent, UfcEvent.id == UfcBout.event_id)
            .where(UfcBout.status == "finished", UfcEvent.is_card.is_(True), fighter_col.in_(ids)))
u = union_all(side(UfcBout.fighter_a_id, "a", "b"), side(UfcBout.fighter_b_id, "b", "a")).subquery()
rows = db.execute(select(u.c.fighter_id, func.sum(u.c.w), func.sum(u.c.l), func.sum(u.c.d), func.sum(u.c.nc))
                  .group_by(u.c.fighter_id))
```

- One card response issues a fixed number of queries: the event, its bouts, the fighters (one `IN` query), the records (one query). A list response loads all main-event fighters and records for the page in one batch each.
- No caching code: `main.py`'s middleware already gives every public `GET /api/*` `public, max-age=60, stale-while-revalidate=300`.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_ufc_api.py`. Copy the `client` fixture from `backend/tests/test_sports_api.py`, but keep the engine so the query-count test can listen on it (`yield TestClient(app), TestingSession, engine`). A `_seed(db, now)` helper builds, relative to `now = datetime.now(timezone.utc)`:
  - fighters: Jiří Procházka (`jiri-prochazka`, born 1992-10-14, 75 in, reach 80 in, Orthodox, Czech Republic), Navajo Stirling, Aljamain Sterling, Kevin Vallejos, Israel Adesanya, Shara Magomedov (no date of birth, height, reach or stance), Mateusz Rębecki, Elves Brener, Abdul Hussein, and one fighter named `TBA` (slug `tba-5300001`);
  - `ufc-fight-night-adesanya-vs-magomedov` (scheduled, +10 days): main segment (`main` / `Main Card`, +10 d 18:00) with Adesanya v Magomedov (order 1, 5 rounds, Middleweight), a `changed` bout (order 2) and a feed-cancelled bout (order 3, `method_detail = "cancelled by feed"`); prelims (`prelims1` / `Prelims`, 3 h earlier) with Rębecki v Brener (order 12) and Hussein v TBA (order 14);
  - `ufc-fight-night-prochazka-vs-stirling` (finished, −4 days): Procházka v Stirling (b, `ko_tko`, `Punch`, round 2, `4:58`), Sterling v Vallejos (b, `decision`, `Decision - Unanimous`, 3, `5:00`), Rębecki v Hussein (`draw`, winner None, `Majority`, 3, `5:00`);
  - `ufc-300-...` (finished, −40 days): Procházka v Vallejos (a, `submission`, round 1, `3:01`), Stirling v Brener (`no_contest`, `Accidental eye poke`, round 1, `2:10`);
  - `dwcs-...` (Contender Series, `is_card=False`, finished, −20 days): Procházka v Brener (a wins);
  - a stale card (status `scheduled`, first and last bout −10 days, two bouts);
  - `ufc-empty-card-...` (scheduled, first and last bout time +24 days, no bouts).

```python
def test_upcoming_is_soonest_first_cards_only(client):
    body = c.get("/api/ufc/events", params={"when": "upcoming"}).json()
    assert [e["slug"] for e in body["events"]] == [ADESANYA, EMPTY]        # no stale card, no DWCS
    first = body["events"][0]
    assert first["bout_count"] == 3 and first["main_event"]["fighter_a"]["name"] == "Israel Adesanya"

def test_past_is_most_recent_first_and_includes_a_stale_card(client):
    # [PROCHAZKA, STALE, UFC300]: stale card (−10 d) sits between −4 d and −40 d; no DWCS

def test_paging_and_bounds(client):
    assert slugs(c.get("/api/ufc/events", params={"when": "past", "limit": 1, "offset": 1})) == [STALE]
    assert c.get("/api/ufc/events", params={"when": "soon"}).status_code == 422
    assert c.get("/api/ufc/events", params={"when": "past", "limit": 51}).status_code == 422

def test_next_is_the_soonest_upcoming_card(client):   assert c.get("/api/ufc/events/next").json()["slug"] == ADESANYA
def test_next_falls_back_to_the_latest_result(client): # seed without the two future cards → PROCHAZKA
def test_next_is_404_when_nothing_is_loaded(client):
    r = c.get("/api/ufc/events/next")
    assert r.status_code == 404 and r.json()["error"]["code"] == "no_events"

def test_card_segments_and_order(client):
    d = c.get(f"/api/ufc/events/{ADESANYA}").json()
    assert [(s["key"], s["label"]) for s in d["segments"]] == [("main", "Main Card"), ("prelims1", "Prelims")]
    assert [b["card_order"] for b in d["segments"][0]["bouts"]] == [1, 3]      # changed row (2) absent
    assert [b["card_order"] for b in d["segments"][1]["bouts"]] == [12, 14]

def test_cancelled_rows_are_served_without_the_feed_marker(client):
    cancelled = bout_by_order(d, 3)
    assert cancelled["status"] == "cancelled" and cancelled["result"] is None
    assert "cancelled by feed" not in r.text

def test_result_only_when_finished(client):
    ko = bout_by_order(fin, 1)
    assert ko["result"] == {"winner": "b", "method": "ko_tko", "method_detail": "Punch", "end_round": 2, "end_clock": "4:58"}
    assert bout_by_order(up, 1)["result"] is None
    assert bout_by_order(fin, 3)["result"]["winner"] is None and bout_by_order(fin, 3)["result"]["method"] == "draw"

def test_records_count_stored_card_fights_only(client):
    mini = bout_by_order(fin, 1)["fighter_a"]                        # Procházka: L (−4 d), W (UFC 300); DWCS win ignored
    assert mini["record"] == {"wins": 1, "losses": 1, "draws": 0, "no_contests": 0}
    assert bout_by_order(fin, 1)["fighter_b"]["record"] == {"wins": 1, "losses": 0, "draws": 0, "no_contests": 1}
    assert bout_by_order(up, 1)["fighter_b"]["record"] is None       # Magomedov: no stored history

def test_card_with_zero_bouts(client):
    d = c.get(f"/api/ufc/events/{EMPTY}").json()
    assert (d["segments"], d["bout_count"], d["main_event"]) == ([], 0, None)

def test_unknown_and_non_card_slugs_are_404(client):
    for slug in ("no-such-card", DWCS):
        r = c.get(f"/api/ufc/events/{slug}")
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"

def test_card_query_count_does_not_grow_with_bouts(client):
    # count before_cursor_execute on the engine for GET ADESANYA (5 rows) and for a seeded 12-bout card
    assert small == big and big <= 6

def test_datetimes_are_utc(client):
    for v in (d["first_bout_utc"], d["segments"][0]["scheduled_utc"], d["segments"][0]["bouts"][0]["scheduled_utc"]):
        assert datetime.fromisoformat(v.replace("Z", "+00:00")).utcoffset() == timedelta(0)

def test_public_cache_header(client):
    assert c.get("/api/ufc/events", params={"when": "upcoming"}).headers["cache-control"] == \
        "public, max-age=60, stale-while-revalidate=300"

def test_no_model_odds_or_pick_fields(client):
    banned = {"p_a", "p_b", "prediction", "predictions", "odds", "moneyline_a", "moneyline_b", "pick", "picks", "rating"}
    # walk every key of /events (both), /events/next and /events/{slug} responses: none in banned

def test_feed_marker_matches_the_pipeline():
    from pipeline.sports.ufc_ingest import FEED_CANCELLED as PIPELINE
    from app.api.ufc import FEED_CANCELLED
    assert FEED_CANCELLED == PIPELINE
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_api.py -p no:cacheprovider -o addopts="" -q` — expected: 404s for every `/api/ufc` route (router not registered).
- [ ] **Step 3: Add the schemas and `ufc.py`** with the rules above (module docstring: read-only, public, no model fields until phase 4; why records are one grouped query). Register the router in `main.py`.
- [ ] **Step 4: Run** the test file — expected: pass. Then `.venv/bin/python -m pytest backend/tests/test_sports_api.py backend/tests/test_health.py -p no:cacheprovider -o addopts="" -q` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): public API for card lists, the next card and card detail`.

### Task 3: API — fight detail and fighter detail

**Files:**
- Modify: `backend/app/api/ufc.py`, `backend/app/schemas/__init__.py`
- Test: `backend/tests/test_ufc_api.py` (append; reuse `_seed`)

**Interfaces:**
- Consumes: Task 2's `records_for`, `fighter_minis`, `bout_summary`, `_utc`, `FEED_CANCELLED`, the `Ufc*Out` schemas.
- Produces:

```python
class UfcEventRefOut:     slug: str; name: str; first_bout_utc: datetime | None
class UfcSegmentRefOut:   key: str; label: str
class UfcTapeSideOut:     age: int | None; height_in: float | None; reach_in: float | None; stance: str | None
class UfcTapeOut:         a: UfcTapeSideOut; b: UfcTapeSideOut
class UfcStatLineOut:     knockdowns, sig_strikes_landed, sig_strikes_attempted, total_strikes_landed,
                          total_strikes_attempted, takedowns_landed, takedowns_attempted,
                          submission_attempts, reversals, control_seconds: int | None   # ten fields
class UfcStatsOut:        a: UfcStatLineOut; b: UfcStatLineOut
class UfcJudgesOut:       a: list[int]; b: list[int]
class UfcBoutDetailOut(UfcBoutSummaryOut): event: UfcEventRefOut; segment: UfcSegmentRefOut; tape: UfcTapeOut
                          stats: UfcStatsOut | None; judges: UfcJudgesOut | None
class UfcOpponentOut:     slug: str; name: str; country: str | None
class UfcFighterEventOut: slug: str; name: str; date: datetime | None      # the event's first_bout_utc
class UfcFighterBoutOut:  id: int; event: UfcFighterEventOut; opponent: UfcOpponentOut
                          outcome: Literal["win", "loss", "draw", "no_contest"] | None; method: str | None
                          end_round: int | None; end_clock: str | None; weight_class: str | None
                          status: str; scheduled_utc: datetime | None
class UfcFighterDetailOut: slug: str; name: str; country: str | None; date_of_birth: date | None; age: int | None
                          height_in: float | None; reach_in: float | None; stance: str | None
                          record: UfcRecordOut | None; bouts: list[UfcFighterBoutOut]
def age_on(born: date | None, when: datetime) -> int | None   # whole years
```

Rules:
- `GET /bouts/{bout_id}` (int path): 404 `{"code": "not_found", "message": "No UFC fight with that id"}` when the row is missing, has status `changed`, or its event is not a card. Segment ref uses the same null rule as Task 2 (`"other"` / `"Fights"`).
- Tape age: `age_on(date_of_birth, scheduled_utc or now)`. Stats: set only when the bout is `finished` and both fighters have a `UfcBoutStat` row; otherwise null. Judges: set only when both rows have non-empty `judges` lists; otherwise null.
- `GET /fighters/{slug}`: 404 `{"code": "not_found", "message": "No UFC fighter with that name"}`. `age` is `age_on(date_of_birth, now)`. `bouts`: every bout of this fighter on a card event, status not `changed`, ordered `scheduled_utc` descending with nulls first, then id descending (so upcoming fights come first). `outcome` is set only for `finished` rows, with the same rule as records (a finished bout with no winner and a method other than draw or no contest is null). Opponents load in one `IN` query; events in one `IN` query.
- Both endpoints issue a bounded number of queries (no per-bout or per-fighter query).

- [ ] **Step 1: Write the failing tests:**

```python
def test_ko_fight_has_result_stats_and_no_judges(client):
    # add two UfcBoutStat rows for Procházka v Stirling: a = 0 kd, 26/48 total, 23 sig landed, 18 s control; no judges
    d = c.get(f"/api/ufc/bouts/{ko_id}").json()
    assert d["event"]["slug"] == PROCHAZKA and d["segment"] == {"key": "main", "label": "Main Card"}
    assert d["stats"]["a"]["control_seconds"] == 18 and d["stats"]["a"]["total_strikes_attempted"] == 48
    assert set(d["stats"]["a"]) == {"knockdowns", "sig_strikes_landed", "sig_strikes_attempted", "total_strikes_landed",
        "total_strikes_attempted", "takedowns_landed", "takedowns_attempted", "submission_attempts", "reversals", "control_seconds"}
    assert d["judges"] is None

def test_decision_has_judges(client):    # Sterling v Vallejos rows with judges [27,28,27] / [30,29,30]
    assert d["judges"] == {"a": [27, 28, 27], "b": [30, 29, 30]}

def test_tape_and_age_at_fight_time(client):
    # Procházka v Stirling scheduled (−4 d); set it to 2026-11-21T18:00Z for this test
    assert d["tape"]["a"] == {"age": 34, "height_in": 75.0, "reach_in": 80.0, "stance": "Orthodox"}
    assert up["tape"]["b"] == {"age": None, "height_in": None, "reach_in": None, "stance": None}   # Magomedov
    assert up["stats"] is None and up["judges"] is None

def test_age_on():
    assert age_on(date(1992, 10, 14), datetime(2026, 10, 13, tzinfo=timezone.utc)) == 33
    assert age_on(date(1992, 10, 14), datetime(2026, 10, 14, tzinfo=timezone.utc)) == 34
    assert age_on(None, datetime(2026, 1, 1, tzinfo=timezone.utc)) is None

def test_stats_null_when_one_side_is_missing(client):      # only fighter a's row stored → stats is None
def test_fight_404s(client):                                # 999999, the changed row's id, the DWCS bout id → 404 not_found

def test_fighter_profile_record_and_history(client):
    d = c.get("/api/ufc/fighters/jiri-prochazka").json()
    assert d["record"] == {"wins": 1, "losses": 1, "draws": 0, "no_contests": 0}
    assert [b["outcome"] for b in d["bouts"]] == ["loss", "win"]           # newest first; DWCS absent
    assert d["bouts"][0]["opponent"] == {"slug": "navajo-stirling", "name": "Navajo Stirling", "country": None}
    assert d["bouts"][0]["method"] == "ko_tko" and d["bouts"][0]["end_round"] == 2

def test_fighter_upcoming_first_and_cancelled_kept(client):
    # Rębecki: upcoming Brener (scheduled, outcome None) first, then the draw; Stirling's bouts include the no contest
    assert [b["outcome"] for b in rebecki["bouts"]] == [None, "draw"]
    assert "no_contest" in [b["outcome"] for b in stirling["bouts"]]

def test_fighter_without_history(client):
    d = c.get("/api/ufc/fighters/shara-magomedov").json()
    assert (d["record"], d["age"], d["date_of_birth"]) == (None, None, None) and len(d["bouts"]) == 1

def test_fighter_404(client):                   # "nobody" → 404 not_found
def test_detail_query_counts_are_bounded(client): # bout detail ≤ 7 statements; fighter detail ≤ 6, equal for 2 and 8 bouts
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_api.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail with 404.
- [ ] **Step 3: Implement** both endpoints and the schemas.
- [ ] **Step 4: Run** the test file — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): public API for one fight and one fighter`.

### Task 4: Registry and shell — UFC as a third sport

**Files:**
- Modify: `frontend/lib/sports.ts`, `frontend/lib/competitionPrefs.ts`, `frontend/components/CompetitionLogo.tsx`, `frontend/components/CompetitionOverlay.tsx`, `frontend/components/SiteSearch.tsx`, `frontend/app/play/page.tsx`, `frontend/app/leaderboard/page.tsx`, `frontend/app/globals.css` (three tokens beside the `--accent-nrl*` lines 67, 97, 103)
- Test: `frontend/__tests__/sports.test.ts`, `frontend/lib/competitionPrefs.test.ts`, `frontend/components/__tests__/competitionLogo.test.tsx`, `frontend/components/__tests__/clubCrestCoverage.test.ts`, `frontend/components/__tests__/competitionOverlay.test.tsx`, `frontend/components/__tests__/siteSearch.test.tsx`, `frontend/components/__tests__/bottomNav.test.tsx`, `frontend/app/play/page.test.tsx`, `frontend/app/leaderboard/page.test.tsx`. `lib/__tests__/daylightSemanticContrast.test.ts` enumerates the registry and must pass unchanged once the tokens exist.

**Interfaces:**
- Produces, in `lib/sports.ts`:

```ts
export type SportId = "football" | "nrl" | "ufc";
export type CompetitionId = "epl" | "laliga" | "bundesliga" | "ucl" | "wc26" | "nrl" | "ufc";
// Competition: logoSrc: string | null  (null = no logo file; CompetitionLogo draws a text mark)
//              format: "league" | "knockout" | "cards"
// CompetitionLinks.tableLabel: "Table" | "Ladder" | "Groups" | "Events"
COMPETITIONS.ufc = { id: "ufc", sport: "ufc", label: "UFC", shortLabel: "UFC", logoSrc: null, basePath: "/ufc",
  accentVar: "--accent-ufc", format: "cards", hasBracket: false, hasGroups: false, hasTips: false, enabled: true,
  archived: false, recordPath: null, terms: { fixtures: "Fights", standings: "Rankings" }, zones: [] }
```

- Produces, in `lib/competitionPrefs.ts`: `export function canRemember(id: CompetitionId): boolean` — false for UFC (`COMPETITIONS[id].sport === "ufc"`), true otherwise. UFC has no picks game or leaderboard yet, and `/`, `/play` and `/leaderboard` open on the remembered competition, so UFC is never written to `fw_comp`.

Rules:
- `competitionInPathname`: `/ufc` and `/ufc/...` → `"ufc"` (checked beside NRL); `/ufcx` → null.
- `competitionLinks("ufc")` = `{ home: "/ufc", fixtures: "/ufc/events", table: "/ufc/events", tableLabel: "Events", picks: "/play", picksLabel: "My picks", leaderboard: "/leaderboard", bracket: null }` (the account menu's "My picks" then goes to the football picks hub). `tableTabLabel("ufc")` = `"Events"`.
- `navTabsFor("ufc")`: two tabs, reusing existing ids so `NavIcon` needs no change: `{ id: "matches", label: "Card", href: "/ufc", activeExact: "/ufc", activePrefixes: ["/ufc/event", "/ufc/fight", "/ufc/fighter"] }` and `{ id: "table", label: "Events", href: "/ufc/events", activePrefixes: ["/ufc/events"] }`. Football and NRL tabs are unchanged.
- `globals.css`: `--accent-ufc`, `--accent-ufc-ink` and `--accent-ufc-boundary` with exactly the values of the matching `--accent-nrl*` tokens (aliases of the brand green and line colour, not new colours).
- `CompetitionLogo`: `competitionLogoSrc(id): string | null`. When null, render the existing round `Monogram` from `components/ClubBadge.tsx` with `initials="UFC"`, `shape="round"`, the same `size`, label = the competition label, `decorative` passed through, wrapped in the same `span[data-competition-logo]` box. Every other competition renders exactly as today.
- `CompetitionOverlay`: add the section `{ heading: "Mixed martial arts", includes: (c) => c.sport === "ufc" && !c.archived }` after "Rugby league"; `choose()` writes the cookie only when `canRemember(id)` (the analytics event still fires).
- `competitionToRemember(fromPath, fromQuery)` returns null when the competition it would return cannot be remembered.
- `SiteSearch`: when `COMPETITIONS[current].sport === "ufc"`, `pageItems` and `goToItems` build the competition's own pages from `navTabsFor(current)` (`Card` → `/ufc`, `Events` → `/ufc/events`, context `"UFC"`) and `loadMatches("ufc")` resolves to `[]` without fetching. Football and NRL lists are unchanged.
- `/play` and `/leaderboard`: when the resolved competition is `"ufc"` (a crafted `?competition=ufc` or an old cookie), `redirect("/ufc")`.

- [ ] **Step 1: Write the failing tests.**

`__tests__/sports.test.ts` (add; and change the loop in "links every table tab to a route that exists" to expect `/ufc/events` for UFC):

```ts
it("gives UFC its own namespace", () => {
  expect(competitionInPathname("/ufc")).toBe("ufc");
  expect(competitionInPathname("/ufc/fight/12")).toBe("ufc");
  expect(competitionInPathname("/ufcx")).toBeNull();
  expect(isWiredCompetition("ufc")).toBe(true);
  expect(isWiredFootballCompetition("ufc")).toBe(false);
  expect(competitionsForSport("ufc").map((c) => c.id)).toEqual(["ufc"]);
  expect(COMPETITIONS.ufc).toMatchObject({ format: "cards", hasTips: false, logoSrc: null, archived: false,
    recordPath: null, terms: { fixtures: "Fights", standings: "Rankings" } });
});
it("gives UFC two tabs, Card and Events", () => {
  expect(navTabsFor("ufc").map((t) => [t.id, t.label, t.href])).toEqual([["matches", "Card", "/ufc"], ["table", "Events", "/ufc/events"]]);
  const [card, events] = navTabsFor("ufc");
  for (const p of ["/ufc", "/ufc/event/x-2026-12-05", "/ufc/fight/1", "/ufc/fighter/jiri-prochazka"]) expect(isNavTabActive(card, p)).toBe(true);
  expect(isNavTabActive(card, "/ufc/events")).toBe(false);
  expect(isNavTabActive(events, "/ufc/events")).toBe(true);
  expect(competitionLinks("ufc")).toEqual({ home: "/ufc", fixtures: "/ufc/events", table: "/ufc/events",
    tableLabel: "Events", picks: "/play", picksLabel: "My picks", leaderboard: "/leaderboard", bracket: null });
});
```

`competitionPrefs.test.ts`: `canRemember("ufc") === false`, `canRemember("nrl") === true`; `competitionToRemember("ufc", null)` and `competitionToRemember(null, "ufc")` are null; existing cases unchanged.

`competitionLogo.test.tsx`: `render(<CompetitionLogo competition="ufc" size={32} />)` → `[data-competition-logo="ufc"]` contains no `img`, has text `UFC` and `role="img"` named `UFC`; with `decorative` it is `aria-hidden`.

`clubCrestCoverage.test.ts`: the "competition logos" `it.each` and the `files` list skip ids whose `competitionLogoSrc` is null, and a new assertion says UFC is the only one: `expect(ids.filter((id) => competitionLogoSrc(id) === null)).toEqual(["ufc"])`.

`competitionOverlay.test.tsx`: groups `["Football", "Rugby league", "Mixed martial arts", "Past tournaments"]`; "each with its logo" checks `[data-competition-logo]` on every row instead of `img`; choosing UFC keeps the previous cookie (`readCompetitionCookie()` unchanged) and still tracks `competition_switch` once.

`siteSearch.test.tsx`: `pageItems("ufc").filter((p) => p.context === "UFC").map((p) => [p.label, p.href])` equals `[["Card", "/ufc"], ["Events", "/ufc/events"]]`; `goToItems("ufc").slice(0, 2)` the same; existing NRL and football assertions unchanged.

`bottomNav.test.tsx`: `renderAt("/ufc/fight/1")` → hrefs `["/ufc", "/ufc/events"]`, the `Card` tab current.

`play/page.test.tsx`: `await expect(play({ competition: "ufc" })).rejects.toThrow("NEXT_REDIRECT /ufc")`. `leaderboard/page.test.tsx`: mock `next/navigation` as the play test does; resolved competition `"ufc"` → rejects with `NEXT_REDIRECT /ufc`.

- [ ] **Step 2: Run** `cd frontend && npx jest __tests__/sports.test.ts lib/competitionPrefs.test.ts components/__tests__/competitionLogo.test.tsx components/__tests__/clubCrestCoverage.test.ts components/__tests__/competitionOverlay.test.tsx components/__tests__/siteSearch.test.tsx components/__tests__/bottomNav.test.tsx app/play/page.test.tsx app/leaderboard/page.test.tsx lib/__tests__/daylightSemanticContrast.test.ts` — expected: the new assertions fail.
- [ ] **Step 3: Implement** the rules above. Comment the UFC branches in the house style (why UFC is not remembered; why it reuses the `matches`/`table` tab ids).
- [ ] **Step 4: Run** `cd frontend && npm run typecheck && npm run lint` and the same jest command, plus `npx jest components/__tests__/siteNav.test.tsx components/__tests__/nav.responsive.test.tsx components/__tests__/accountMenu.test.tsx lib/__tests__/competitionServer.test.ts middleware.test.ts` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): add UFC to the competition registry, switcher and nav`.

### Task 5: Types, fetchers, display helpers and shared test fixtures

**Files:**
- Create: `frontend/lib/ufcTypes.ts`, `frontend/lib/ufcDisplay.ts`, `frontend/components/ufc/fixtures.testutil.ts`
- Modify: `frontend/lib/api.ts` (after the NRL server fetchers, ~line 250)
- Test: `frontend/lib/ufcDisplay.test.ts`

**Interfaces:**
- Produces, `lib/ufcTypes.ts` (mirrors Tasks 2–3 exactly; ISO strings for datetimes):

```ts
export type UfcBoutStatus = "scheduled" | "live" | "finished" | "cancelled";
export type UfcEventStatus = "scheduled" | "live" | "finished" | "cancelled";
export type UfcMethod = "ko_tko" | "submission" | "decision" | "dq" | "draw" | "no_contest" | "other";
export interface UfcRecord { wins: number; losses: number; draws: number; no_contests: number }
export interface UfcFighterMini { slug: string; name: string; country: string | null; record: UfcRecord | null }
export type UfcOpponent = Omit<UfcFighterMini, "record">;
export interface UfcResult { winner: "a" | "b" | null; method: UfcMethod | null; method_detail: string | null; end_round: number | null; end_clock: string | null }
export interface UfcBoutSummary { id: number; card_order: number | null; weight_class: string | null; scheduled_rounds: number | null;
  is_title: boolean | null; scheduled_utc: string | null; status: UfcBoutStatus; fighter_a: UfcFighterMini; fighter_b: UfcFighterMini; result: UfcResult | null }
export interface UfcSegment { key: string; label: string; scheduled_utc: string | null; bouts: UfcBoutSummary[] }
export interface UfcEventSummary { slug: string; name: string; status: UfcEventStatus; first_bout_utc: string | null; last_bout_utc: string | null;
  venue: string | null; bout_count: number; main_event: { fighter_a: UfcFighterMini; fighter_b: UfcFighterMini } | null }
export interface UfcEventDetail extends UfcEventSummary { segments: UfcSegment[] }
export interface UfcEventsResponse { events: UfcEventSummary[] }
export interface UfcTapeSide { age: number | null; height_in: number | null; reach_in: number | null; stance: string | null }
export interface UfcStatLine { knockdowns: number | null; sig_strikes_landed: number | null; sig_strikes_attempted: number | null;
  total_strikes_landed: number | null; total_strikes_attempted: number | null; takedowns_landed: number | null;
  takedowns_attempted: number | null; submission_attempts: number | null; reversals: number | null; control_seconds: number | null }
export interface UfcBoutDetail extends UfcBoutSummary { event: { slug: string; name: string; first_bout_utc: string | null };
  segment: { key: string; label: string }; tape: { a: UfcTapeSide; b: UfcTapeSide };
  stats: { a: UfcStatLine; b: UfcStatLine } | null; judges: { a: number[]; b: number[] } | null }
export interface UfcFighterBout { id: number; event: { slug: string; name: string; date: string | null }; opponent: UfcOpponent;
  outcome: "win" | "loss" | "draw" | "no_contest" | null; method: UfcMethod | null; end_round: number | null; end_clock: string | null;
  weight_class: string | null; status: UfcBoutStatus; scheduled_utc: string | null }
export interface UfcFighterDetail { slug: string; name: string; country: string | null; date_of_birth: string | null; age: number | null;
  height_in: number | null; reach_in: number | null; stance: string | null; record: UfcRecord | null; bouts: UfcFighterBout[] }
```

- Produces, `lib/api.ts` (all through the existing `getServer`: `null` on 404, throws otherwise):

```ts
getUfcNextEventServer(): Promise<UfcEventDetail | null>                                   // /api/ufc/events/next, revalidate 120
getUfcEventServer(slug: string): Promise<UfcEventDetail | null>                           // encodeURIComponent(slug), 120
getUfcEventsServer(when: "upcoming" | "past", limit = 20, offset = 0): Promise<UfcEventsResponse | null>   // 300
getUfcBoutServer(id: number | string): Promise<UfcBoutDetail | null>                      // 120
getUfcFighterServer(slug: string): Promise<UfcFighterDetail | null>                       // 300
```

- Produces, `lib/ufcDisplay.ts` (pure; copy lives here so every page says the same thing):

```ts
export const TBA = "TBA";
export function isTba(f: { name: string }): boolean
export function fighterInitials(name: string): string        // first letter of first and last word; one word → first two letters; TBA → "?"
export function recordText(r: UfcRecord | null): string | null   // "24-6-0"; with no contests "24-6-0, 1 NC"
export function methodLabel(m: UfcMethod | null): string | null  // ko_tko "KO/TKO", submission "Submission", decision "Decision",
                                                                  // dq "Disqualification", draw "Draw", no_contest "No contest", other "Other"
export function methodDetailText(detail: string | null): string | null   // lower-case; strips a leading "decision" and " - "
export function resultBoxText(r: UfcResult): string           // see table below
export function resultLine(b: Pick<UfcBoutSummary, "status" | "result" | "fighter_a" | "fighter_b">): string | null
export function methodRoundText(method: UfcMethod | null, endRound: number | null): string | null   // "KO/TKO · R2", "Decision"
export function segmentTitle(label: string): string           // "Main Card" → "Main card", "Early Prelims" → "Early prelims"
export function heightText(inches: number | null): string | null   // 76 → "6′ 4″" (U+2032, space, U+2033), rounded to the inch
export function reachText(inches: number | null): string | null    // 80 → "80″", 74.5 → "74.5″"
export function controlTimeText(seconds: number | null): string    // 18 → "0:18", 312 → "5:12", null → "–"
export function mainEventId(event: UfcEventDetail): number | null   // lowest card_order among bouts not cancelled, nulls last
export function boutSubLine(b: UfcBoutSummary, isMainEvent: boolean): string
      // [weight_class ?? "Weight class to be confirmed", is_title ? "title fight" : isMainEvent ? "main event" : null,
      //  scheduled_rounds ? `${n} rounds` : null].filter(Boolean).join(" · ")
export function eventStatusNote(e: UfcEventDetail, tz: string): string
      // scheduled: "Main card starts 5:00 am. Times are in your local time." (time of segment "main", else
      //   first_bout_utc: "Starts 2:00 am. Times are in your local time.", else "Start time to be confirmed.")
      // live: "Live now"; finished: "Finished"; cancelled: "This card was cancelled."
export const eventHref = (slug: string) => `/ufc/event/${slug}`;
export const boutHref = (id: number) => `/ufc/fight/${id}`;
export const fighterHref = (slug: string) => `/ufc/fighter/${slug}`;
export const ABOUT_NOTE = "Cards, results and fight stats for every UFC event, with times in your local time. Predictions and a picks game are coming to these pages.";
export const NOT_AFFILIATED = "FinalWhistle is not affiliated with the UFC.";
```

`resultBoxText`: `ko_tko` → `KO R{n}`; `submission` → `SUB R{n}`; `decision` → `DEC`; `dq` → `DQ R{n}`; `draw` → `DRAW`; `no_contest` → `NC`; `other` or null → `R{n}`, or `–` with no round. `R{n}` parts drop to the bare word when `end_round` is null (`KO`, `SUB`, `DQ`).

`resultLine` (null unless status is `finished`); `{W}` is the winner's full name, `{d}` is `methodDetailText(...)`, `{rc}` is `, round {r}, {clock}` (clock part omitted when null; whole part omitted when the round is null):
- winner and `ko_tko`: `{W} won by KO/TKO ({d}){rc}`; `submission`: `{W} won by submission ({d}){rc}`; `decision`: `{W} won by decision ({d})`; `dq`: `{W} won by disqualification{rc}`; any other method: `{W} won{rc}`. The ` ({d})` part is omitted when `{d}` is null.
- `draw`: `Draw ({d}){rc}`; `no_contest`: `No contest ({d}){rc}`.
- no winner and any other method: `Result to be confirmed`.

`fixtures.testutil.ts` exports realistic payloads typed with `lib/ufcTypes.ts`, built from the phase 1 recorded data (`pipeline/sports/testdata/ufc/README.md`), shared by every later frontend test:
- `UPCOMING_EVENT: UfcEventDetail` — `ufc-fight-night-adesanya-vs-magomedov-2026-12-05`, scheduled, first bout `2026-12-05T15:00:00Z`, `bout_count: 4` (the cancelled bout does not count); segments `main` / `Main Card` (`2026-12-05T18:00:00Z`: Israel Adesanya v Shara Magomedov, order 1, Middleweight, 5 rounds, records 24-6-0 and null; Max Holloway v a fighter named `TBA` with slug `tba-5300001`, order 2; a cancelled bout, order 3, Jalin Turner v Bobby Green) and `prelims1` / `Prelims` (`2026-12-05T15:00:00Z`: Mateusz Rębecki v Elves Brener, order 12; Abdul Hussein v Maximiliano Bartholomew Wolfeschlegelsteinhausen, order 14).
- `FINISHED_EVENT: UfcEventDetail` — `ufc-fight-night-prochazka-vs-stirling-2026-11-21`, finished, one `main` segment: Jiří Procházka v Navajo Stirling (b, `ko_tko`, `Punch`, 2, `4:58`), Aljamain Sterling v Kevin Vallejos (b, `decision`, `Decision - Unanimous`, 3, `5:00`), Dan Hooker v Brian Ortega (draw, `Majority`, 3, `5:00`), and a no contest (`Accidental eye poke`, round 1, `2:10`).
- `EMPTY_EVENT` (scheduled, `segments: []`, `bout_count: 0`, `main_event: null`), `UPCOMING_LIST: UfcEventSummary[]` (four cards, the first equal to `UPCOMING_EVENT`'s summary, one with `main_event: null`), `PAST_LIST`.
- `KO_BOUT` and `DECISION_BOUT: UfcBoutDetail` (stats from the README: a 0 knockdowns, 26 of 48 total, 23 significant landed, 18 s control; judges 27, 28, 27 / 30, 29, 30), `SCHEDULED_BOUT` (Adesanya v Magomedov; tape a `{age: 37, height_in: 76, reach_in: 80, stance: "Switch"}`, b `{age: null, height_in: 74, reach_in: null, stance: "Orthodox"}`), `UNKNOWN_TAPE_BOUT` (the TBA bout, both tapes all null).
- `FIGHTER: UfcFighterDetail` (Jiří Procházka, Czech Republic, 1992-10-14, 34, 75 in, 80 in, Orthodox, record 1-1-0; bouts newest first: one upcoming, the KO loss, a submission win), `FIGHTER_NO_HISTORY` (Shara Magomedov, record null; date of birth, age, height, reach and stance null; one upcoming bout), `FIGHTER_DRAW_NC` (bouts with outcomes `draw` and `no_contest`).

- [ ] **Step 1: Write the failing tests** in `lib/ufcDisplay.test.ts`:

```ts
it("makes initials", () => {
  expect(fighterInitials("Israel Adesanya")).toBe("IA");
  expect(fighterInitials("Jiří Procházka")).toBe("JP");
  expect(fighterInitials("Mateusz Rębecki")).toBe("MR");
  expect(fighterInitials("Shara")).toBe("SH");
  expect(fighterInitials("TBA")).toBe("?");
});
it("prints records", () => {
  expect(recordText({ wins: 24, losses: 6, draws: 0, no_contests: 0 })).toBe("24-6-0");
  expect(recordText({ wins: 9, losses: 2, draws: 1, no_contests: 1 })).toBe("9-2-1, 1 NC");
  expect(recordText(null)).toBeNull();
});
it.each([
  [{ winner: "b", method: "ko_tko", method_detail: "Punch", end_round: 2, end_clock: "4:58" }, "KO R2"],
  [{ winner: "a", method: "submission", method_detail: null, end_round: 1, end_clock: "3:01" }, "SUB R1"],
  [{ winner: "b", method: "decision", method_detail: "Decision - Unanimous", end_round: 3, end_clock: "5:00" }, "DEC"],
  [{ winner: null, method: "draw", method_detail: "Majority", end_round: 3, end_clock: "5:00" }, "DRAW"],
  [{ winner: null, method: "no_contest", method_detail: null, end_round: 1, end_clock: "2:10" }, "NC"],
  [{ winner: "a", method: "ko_tko", method_detail: null, end_round: null, end_clock: null }, "KO"],
] as const)("boxes %o as %s", (r, text) => expect(resultBoxText(r)).toBe(text));
it("writes result lines", () => {
  const [ko, dec, draw, nc] = FINISHED_EVENT.segments[0].bouts;
  expect(resultLine(ko)).toBe("Navajo Stirling won by KO/TKO (punch), round 2, 4:58");
  expect(resultLine(dec)).toBe("Kevin Vallejos won by decision (unanimous)");
  expect(resultLine(draw)).toBe("Draw (majority), round 3, 5:00");
  expect(resultLine(nc)).toBe("No contest (accidental eye poke), round 1, 2:10");
  expect(resultLine(UPCOMING_EVENT.segments[0].bouts[0])).toBeNull();
});
it("formats the tape", () => {
  expect(heightText(76)).toBe("6′ 4″"); expect(heightText(75)).toBe("6′ 3″"); expect(heightText(null)).toBeNull();
  expect(reachText(80)).toBe("80″"); expect(reachText(74.5)).toBe("74.5″");
  expect(controlTimeText(18)).toBe("0:18"); expect(controlTimeText(312)).toBe("5:12"); expect(controlTimeText(null)).toBe("–");
});
it("titles segments and sub-lines", () => {
  expect(segmentTitle("Main Card")).toBe("Main card"); expect(segmentTitle("Early Prelims")).toBe("Early prelims");
  expect(boutSubLine(UPCOMING_EVENT.segments[0].bouts[0], true)).toBe("Middleweight · main event · 5 rounds");
  expect(mainEventId(UPCOMING_EVENT)).toBe(UPCOMING_EVENT.segments[0].bouts[0].id);
  expect(mainEventId(EMPTY_EVENT)).toBeNull();
});
it("states the card's status in local time", () => {
  expect(eventStatusNote(UPCOMING_EVENT, "Australia/Sydney")).toBe("Main card starts 5:00 am. Times are in your local time.");
  expect(eventStatusNote({ ...UPCOMING_EVENT, status: "live" }, "UTC")).toBe("Live now");
  expect(eventStatusNote(FINISHED_EVENT, "UTC")).toBe("Finished");
});
it("writes method and round for the fighter table", () => {
  expect(methodRoundText("ko_tko", 2)).toBe("KO/TKO · R2"); expect(methodRoundText("decision", 3)).toBe("Decision");
  expect(methodRoundText(null, null)).toBeNull();
});
```

- [ ] **Step 2: Run** `cd frontend && npx jest lib/ufcDisplay.test.ts` — expected: fails (module missing).
- [ ] **Step 3: Implement** the three files and the five fetchers.
- [ ] **Step 4: Run** `cd frontend && npm run typecheck && npm run lint && npx jest lib/ufcDisplay.test.ts __tests__/api.test.ts` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): payload types, server fetchers and display helpers`.

### Task 6: Bout row building blocks

**Files:**
- Modify: `frontend/components/ui/FixtureRow.tsx`, `frontend/components/ui/index.ts`
- Create: `frontend/components/ufc/FighterMark.tsx`, `frontend/components/ufc/BoutRow.tsx`
- Test: `frontend/components/ui/__tests__/ui.test.tsx` (extend `describe("FixtureRow")`), `frontend/components/ufc/BoutRow.test.tsx`

**Interfaces:**
- Consumes: `lib/ufcDisplay.ts`, `lib/ufcTypes.ts`, fixtures (Task 5); `Monogram` from `components/ClubBadge.tsx`; `kickoffTimeLower`.
- Produces:

```ts
// FixtureRow.tsx (additive; absent flags render exactly as today)
export type FixtureSide = { name: string; crest?: ReactNode; muted?: boolean; struck?: boolean };
export function ResultBox({ children, className }: { children: ReactNode; className?: string })  // the ink box, text content
// components/ufc
export function FighterMark({ name, size = 26, decorative = true }: { name: string; size?: number; decorative?: boolean })
export function BoutRow({ bout, tz, isMainEvent }: { bout: UfcBoutSummary; tz: string; isMainEvent: boolean })
```

Rules:
- `muted` adds `font-normal text-muted` to that side's name; `struck` adds `line-through text-muted`. `ResultBox` uses the same box classes as `ScoreBox` (`bg-ink text-white`) with `text-notes`.
- `FighterMark`: `Monogram` with `shape="round"` and `initials={fighterInitials(name)}`.
- `BoutRow` → `FixtureRow` with: `href = boutHref(bout.id)`; `left = boutSubLine(bout, isMainEvent)` with `leftOnPhone`; sides `{ name, crest: <FighterMark name … /> }`.
  - scheduled: `kickoff = scheduled_utc ? kickoffTimeLower(scheduled_utc, tz) : "TBC"`; label `"{A} v {B}, {time}"`.
  - live: `centre = <KickoffBox>Live</KickoffBox>`; label `"{A} v {B}, live now"`.
  - finished: `centre = <ResultBox>{resultBoxText(result)}</ResultBox>`; the loser's side `muted` (no muted side for a draw, no contest or no winner); label `"{A} v {B}. {resultLine}"`.
  - cancelled: both sides `struck`; no centre text (FixtureRow's dash); `right = <Chip>Cancelled</Chip>`; label `"{A} v {B}, cancelled"`.

- [ ] **Step 1: Write the failing tests.** In `ui.test.tsx`: a plain side's name class contains `font-semibold` and not `text-muted`; `muted` → contains `font-normal` and `text-muted`, not `font-semibold`; `struck` → contains `line-through`; `ResultBox` renders `KO R2` with class `bg-ink`.

`BoutRow.test.tsx` (fixtures from Task 5; pin `localStorage["pp:timezone"]` as `components/matchweek/__tests__/MatchweekView.test.tsx` does, here with `"Australia/Sydney"` and `tz` passed explicitly):

```tsx
it("shows a scheduled fight with local time and the main-event line", () => {
  render(<BoutRow bout={main} tz="Australia/Sydney" isMainEvent />);
  expect(screen.getByRole("link", { name: "Israel Adesanya v Shara Magomedov, 5:00 am" })).toHaveAttribute("href", `/ufc/fight/${main.id}`);
  expect(screen.getByText("Middleweight · main event · 5 rounds")).toBeInTheDocument();
});
it("boxes a knockout and mutes the loser", () => {
  render(<BoutRow bout={ko} tz="UTC" isMainEvent />);
  expect(screen.getByText("KO R2")).toHaveClass("bg-ink");
  expect(screen.getByText("Jiří Procházka").className).toContain("text-muted");
  expect(screen.getByText("Navajo Stirling").className).not.toContain("text-muted");
  expect(screen.getByRole("link", { name: /Navajo Stirling won by KO\/TKO \(punch\), round 2, 4:58/ })).toBeInTheDocument();
});
it("mutes nobody on a draw or a no contest", () => { /* DRAW and NC boxes; neither name has text-muted */ });
it("strikes through a cancelled fight", () => {
  render(<BoutRow bout={cancelled} tz="UTC" isMainEvent={false} />);
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
  expect(screen.getByText("Jalin Turner").className).toContain("line-through");
  expect(screen.queryByText(/\d:\d\d (am|pm)/)).toBeNull();
});
it("draws a TBA opponent as ?", () => { /* Monogram text "?" and the name "TBA" */ });
it("keeps a very long name inside its column", () => {
  render(<BoutRow bout={longName} tz="UTC" isMainEvent={false} />);
  const name = screen.getByText("Maximiliano Bartholomew Wolfeschlegelsteinhausen");
  expect(name.className).toContain("break-words"); expect(name.className).toContain("min-w-0");
});
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ui/__tests__/ui.test.tsx components/ufc/BoutRow.test.tsx` — expected: new tests fail.
- [ ] **Step 3: Implement.** Export `ResultBox` from `components/ui/index.ts`.
- [ ] **Step 4: Run** the frontend gate with those two paths plus `components/matchweek components/__tests__/fixtureStatusConsumers.test.tsx` — expected: pass (football rows unchanged).
- [ ] **Step 5: Commit** `feat(ufc): bout row on the shared fixture row, with fighter monograms`.

### Task 7: Card pages — `/ufc` and `/ufc/event/[slug]`

**Files:**
- Modify: `frontend/lib/ufcDisplay.ts` (the three guards below), `frontend/lib/ufcDisplay.test.ts`
- Create: `frontend/components/ufc/UfcCardView.tsx` (client), `frontend/app/ufc/layout.tsx`, `frontend/app/ufc/page.tsx`, `frontend/app/ufc/loading.tsx`, `frontend/app/ufc/event/[slug]/layout.tsx`, `frontend/app/ufc/event/[slug]/page.tsx`, `frontend/app/ufc/event/[slug]/loading.tsx`
- Test: `frontend/components/ufc/UfcCardView.test.tsx`, `frontend/app/ufc/layout.test.tsx`, `frontend/app/ufc/page.test.tsx`, `frontend/app/ufc/loading.test.tsx`, `frontend/app/ufc/event/[slug]/page.test.tsx`, `frontend/app/ufc/event/[slug]/layout.test.tsx`, `frontend/app/ufc/event/[slug]/loading.test.tsx`

**Interfaces:**
- Consumes: Task 5 fetchers and helpers, Task 6 `BoutRow`.
- Produces: `UfcCardView({ event, upcoming }: { event: UfcEventDetail; upcoming: UfcEventSummary[] })`; `export function isEventSlug(s: string): boolean` in `lib/ufcDisplay.ts` (`/^[a-z0-9-]{1,220}$/`), used by later tasks' guards too, with `isFighterSlug` (`/^[a-z0-9-]{1,140}$/`) and `isBoutId` (`/^\d{1,9}$/`).

Layout and copy (mirrors `MatchweekView`):
- `PageHead`: eyebrow `UFC · {kickoffDate(first_bout_utc, tz)}` (just `UFC` without a time), title = event name, sub = `eventStatusNote(event, tz)`.
- `PageLayout` → `Main`: one `<Card flush aria-label={segmentTitle(label)}>` per segment, starting with `<DayBand as="h2" className="flex justify-between gap-3">` holding the segment title and, when known, its local start time in `font-normal text-muted`; then a `BoutRow` per bout (`isMainEvent` from `mainEventId`). With no segments: one `<Card pad>` with `<Note>The fights for this card have not been announced yet.</Note>`.
- `Rail aria-label="More"`: "Upcoming cards" (`CardHead`), up to three of `upcoming` excluding this event's slug; each a `TextLink` to `eventHref(slug)` with the event name and a `Note` `{kickoffDate} · {A} v {B}` (just the date when `main_event` is null); the card is omitted when the list is empty. Then "About these pages" with `<Note>{ABOUT_NOTE}</Note>`.
- `app/ufc/layout.tsx` renders `children` then `<p className="mt-8 text-notes text-muted">{NOT_AFFILIATED}</p>`.
- `app/ufc/page.tsx`: `revalidate = 120`. `Promise.all([getUfcNextEventServer().catch(() => undefined), getUfcEventsServer("upcoming", 4).catch(() => null)])`. `undefined` (feed error) → `PageHead` eyebrow `UFC`, title `UFC`, then `EmptyState` title "Fight cards are unavailable right now", body "We could not reach the fight feed. Try again in a minute."; `null` (no events) → `EmptyState` title "No UFC cards yet", body "Fight cards appear here as soon as they are announced.", action `<Button href="/">Go to the home page</Button>`.
- `app/ufc/event/[slug]/layout.tsx`: `notFound()` when `!isEventSlug(slug)` or when `getUfcEventServer(slug)` resolves `null` (a real 404, decided before `loading.tsx` streams; the page's identical fetch is memoised). A thrown fetch lets the page render. `page.tsx`: `revalidate = 120`, `generateStaticParams` returns `[]` (as `app/nrl/team/[id]/page.tsx`), `null` → `notFound()`, thrown → the same "unavailable" `EmptyState` with title "This card is unavailable right now".
- Metadata: `/ufc` → title `UFC fight cards and results — FinalWhistle`, description `The next UFC card fight by fight, with start times in your local time, results and fighter records.` `/ufc/event/[slug]` (`generateMetadata`) → title `{event name} — fight card and results | FinalWhistle`, description `{A} v {B} and the full card: {n} fights, start times and results.` (without a main event: `The full card: {n} fights, start times and results.`); unknown slug → title `UFC card — FinalWhistle`. Titles use `APP_NAME`.
- `loading.tsx` files follow `app/nrl/loading.tsx`: `SkeletonScreen label="Loading…"` with a head block, two flush-card placeholders of three rows, and a rail block.

- [ ] **Step 1: Write the failing tests** (pin `pp:timezone` to `Australia/Sydney`):

```tsx
// UfcCardView.test.tsx
it("heads the card with its local day and main card time", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
  expect(screen.getByText("UFC · Sun 6 Dec")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: UPCOMING_EVENT.name })).toBeInTheDocument();
  expect(screen.getByText("Main card starts 5:00 am. Times are in your local time.")).toBeInTheDocument();
});
it("groups fights by segment, main card first", () => {
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(
    expect.arrayContaining(["Main card5:00 am", "Prelims2:00 am"]));
  // the Main card heading precedes the Prelims heading in document order
});
it("says when no fights are announced", () => {
  render(<UfcCardView event={EMPTY_EVENT} upcoming={[]} />);
  expect(screen.getByText("The fights for this card have not been announced yet.")).toBeInTheDocument();
  expect(screen.queryByText("Upcoming cards")).toBeNull();
});
it("lists up to three other upcoming cards and the note about predictions", () => {
  // rail links: 3, none to the current slug; ABOUT_NOTE present
});
it("shows results on a finished card", () => { /* "Finished", "KO R2", "DEC", "DRAW", "NC" */ });

// lib/ufcDisplay.test.ts: isEventSlug("ufc-300-2024-04-13") true, isEventSlug("../etc") false; isBoutId("12") true, isBoutId("1e3") false; isFighterSlug("Bad Slug!") false
// app/ufc/layout.test.tsx: renders children and "FinalWhistle is not affiliated with the UFC."
// app/ufc/page.test.tsx (jest.mock("@/lib/api")):
it("renders the next card", async () => { mockNext.mockResolvedValue(UPCOMING_EVENT); render(await UfcHomePage()); /* event name heading */ });
it("says there are no cards yet", async () => { mockNext.mockResolvedValue(null); /* "No UFC cards yet" + home link */ });
it("says the feed is down", async () => { mockNext.mockRejectedValue(new Error("502")); /* "Fight cards are unavailable right now" */ });
it("has honest metadata", () => { expect(metadata.title).toBe("UFC fight cards and results — FinalWhistle"); expect(JSON.stringify(metadata)).not.toMatch(/official/i); });
// app/ufc/event/[slug]/layout.test.tsx:
it("404s an unknown slug before the page streams", async () => {
  mockEvent.mockResolvedValue(null);
  await expect(EventLayout({ children: null, params: Promise.resolve({ slug: "no-such-card" }) })).rejects.toThrow();
});
it("404s a malformed slug without calling the API", async () => { /* "../etc" → rejects; mockEvent not called */ });
// app/ufc/event/[slug]/page.test.tsx: renders FINISHED_EVENT; generateMetadata title
//   "UFC Fight Night: Procházka vs. Stirling — fight card and results | FinalWhistle"; null → notFound (rejects)
// loading tests: one status "Loading…", skeleton blocks present (as app/nrl/loading.test.tsx)
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc/UfcCardView.test.tsx app/ufc` — expected: fail (modules missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): the card page and the section home`.

### Task 8: Fight page — `/ufc/fight/[id]`

**Files:**
- Create: `frontend/components/ufc/FightHero.tsx`, `frontend/components/ufc/TaleOfTheTape.tsx`, `frontend/components/ufc/FightStats.tsx` (exports `FightStatsCard` and `JudgesCard`), `frontend/components/ufc/UfcFightView.tsx` (client), `frontend/app/ufc/fight/[id]/layout.tsx`, `page.tsx`, `loading.tsx`
- Test: `frontend/components/ufc/FightHero.test.tsx`, `TaleOfTheTape.test.tsx`, `FightStats.test.tsx`, `frontend/app/ufc/fight/[id]/page.test.tsx`, `layout.test.tsx`, `loading.test.tsx`

**Interfaces:**
- Consumes: Tasks 5–7 (`isBoutId`, fixtures, `FighterMark`, `ResultBox`, helpers).
- Produces: `FightHero({ bout, tz }: { bout: UfcBoutDetail; tz: string })`, `TaleOfTheTape({ bout }: { bout: UfcBoutDetail })`, `FightStatsCard({ bout })`, `JudgesCard({ bout })`, `UfcFightView({ bout }: { bout: UfcBoutDetail })`.

Layout and copy (mirrors `MatchHero` and `MatchView`):
- `UfcFightView`: `BackLink` to `eventHref(bout.event.slug)` labelled with the event name; `FightHero`; then, in `Main className="max-w-[900px]"`, `TaleOfTheTape`; for a finished fight `FightStatsCard`; `JudgesCard` when `judges` is set.
- `FightHero`: a `Card` laid out like `MatchHero` (`grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]`, names `break-words [hyphens:auto]`), `h1.sr-only` `{A} v {B}`, eyebrow `UFC · {kickoffDate} · {segmentTitle(segment.label)}`. Each side: `FighterMark` size 60, the full name as a link to `fighterHref(slug)` (plain text, no link, for a TBA fighter), and `recordText(record)` beneath when known. Centre: scheduled → local time big plus `kickoffDate` small; live → `Live`; finished → `ResultBox` with `resultBoxText`; cancelled → `Cancelled`. Below the grid: `boutSubLine(bout, false)` without the main-event word, and for a finished fight a `<p>` with `resultLine(bout)`.
- `TaleOfTheTape`: `CardHead` "Tale of the tape"; a table of rows `value a | label | value b` for Age (whole number), Height (`heightText`), Reach (`reachText`), Stance; an unknown side prints `–`; a row with both sides unknown is omitted; no rows → `<Note>Measurements for these fighters are not available yet.</Note>`. Column heads are the two names.
- `FightStatsCard` (finished only): `CardHead` "Fight stats"; rows Knockdowns; Significant strikes (`{landed} of {attempted}`); Total strikes; Takedowns; Submission attempts; Reversals; Control time (`controlTimeText`). A null count is `–`; landed known with attempted null prints just the landed number. `stats` null → `<Note>Fight stats are not available yet.</Note>`.
- `JudgesCard`: `CardHead` "Judges' scorecards"; rows `Judge 1 … n` with `{a}–{b}`.
- Route: `layout.tsx` 404s when `!isBoutId(id)` or the fetch resolves null; `page.tsx` `revalidate = 120`, `generateStaticParams` `[]`, error → `EmptyState` "This fight is unavailable right now" / "We could not reach the fight feed. Try again in a minute."
- Metadata: title `{A} v {B} — {event name} | FinalWhistle`; description, scheduled: `{weight class} fight over {n} rounds. The tale of the tape now, the result and fight stats once it is over.`; finished: `{resultLine}. Fight stats and the tale of the tape.`; unknown → `UFC fight — FinalWhistle`.

- [ ] **Step 1: Write the failing tests:**

```tsx
// FightHero.test.tsx
it("links both fighters and shows their records", () => {
  render(<FightHero bout={SCHEDULED_BOUT} tz="Australia/Sydney" />);
  expect(screen.getByRole("link", { name: /Israel Adesanya/ })).toHaveAttribute("href", "/ufc/fighter/israel-adesanya");
  expect(screen.getByText("24-6-0")).toBeInTheDocument();
  expect(screen.getByText("5:00 am")).toBeInTheDocument(); expect(screen.getByText("Sun 6 Dec")).toBeInTheDocument();
});
it("does not link a TBA fighter", () => { /* UNKNOWN_TAPE_BOUT: text "TBA" present, no link named TBA, monogram "?" */ });
it("prints the result line on a finished fight", () => {
  render(<FightHero bout={KO_BOUT} tz="UTC" />);
  expect(screen.getByText("KO R2")).toBeInTheDocument();
  expect(screen.getByText("Navajo Stirling won by KO/TKO (punch), round 2, 4:58")).toBeInTheDocument();
});
it("keeps long names wrapping", () => { /* name element className contains "break-words" and "min-w-0" ancestor */ });
// TaleOfTheTape.test.tsx
it("shows known values, dashes for one unknown side, and drops all-unknown rows", () => {
  render(<TaleOfTheTape bout={SCHEDULED_BOUT} />);
  expect(rowText("Height")).toEqual(["6′ 4″", "Height", "6′ 2″"]);
  expect(rowText("Reach")).toEqual(["80″", "Reach", "–"]);
  expect(rowText("Age")).toEqual(["37", "Age", "–"]);
});
it("says so when nothing is known", () => {
  render(<TaleOfTheTape bout={UNKNOWN_TAPE_BOUT} />);
  expect(screen.getByText("Measurements for these fighters are not available yet.")).toBeInTheDocument();
});
// FightStats.test.tsx
it("compares the stats", () => { /* rows: "Total strikes" a "26 of 48"; "Control time" a "0:18"; "Knockdowns" a "0" */ });
it("says when stats are missing", () => { /* KO_BOUT with stats null → "Fight stats are not available yet." */ });
it("lists the judges", () => { /* DECISION_BOUT → "Judge 1" "27–30", "Judge 2" "28–29", "Judge 3" "27–30" */ });
// page/layout/loading tests: as Task 7 (404 for "abc" without API call, 404 for null, metadata titles,
//   no "official" in metadata, error EmptyState text)
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc app/ufc/fight` — expected: new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): the fight page with tale of the tape, stats and scorecards`.

### Task 9: Fighter page — `/ufc/fighter/[slug]`

**Files:**
- Create: `frontend/components/ufc/UfcFighterView.tsx` (client), `frontend/app/ufc/fighter/[slug]/layout.tsx`, `page.tsx`, `loading.tsx`
- Test: `frontend/components/ufc/UfcFighterView.test.tsx`, `frontend/app/ufc/fighter/[slug]/page.test.tsx`, `layout.test.tsx`, `loading.test.tsx`

**Interfaces:**
- Consumes: Tasks 5–7 (`isFighterSlug`, helpers, fixtures, `FighterMark`).
- Produces: `UfcFighterView({ fighter }: { fighter: UfcFighterDetail })`.

Layout and copy:
- `PageHead` with `leading={<FighterMark name size={48} decorative />}`, eyebrow `UFC fighter`, title = name, sub = `[country, record ? `UFC record ${recordText(record)}` : "No UFC fights on record yet"].filter(Boolean).join(" · ")`.
- `PageLayout` → `Main`: a `Card pad` "Fighter facts" with a `StatGrid` of the known values only: Age (`{age}`), Born (`date_of_birth` as `14 October 1992`, en-GB long date, UTC), Height, Reach, Stance; none known → `<Note>Height, reach and date of birth are not available yet.</Note>`.
- A `Card flush` "Fights" with `TableScroll` / `Table`: columns Date (`kickoffDate` of `scheduled_utc ?? event.date`, viewer's zone), Opponent (link to `fighterHref`, plain for TBA), Result, Event (`TextLink` to `eventHref`; this column is `hidden min-[900px]:table-cell`). The Result cell holds a chip and, under it, `methodRoundText(method, end_round)` in `text-notes text-muted`. Chips: win `<Chip tone="good">Win</Chip>`, loss `<Chip tone="miss">Loss</Chip>`, draw `Draw`, no contest `No contest`, scheduled `Upcoming`, live `<Chip tone="ok">Live</Chip>`, cancelled `Cancelled`, finished with no outcome `Result to be confirmed` (neutral unless stated). Rows keep the API order (upcoming first). No bouts → `<Note>No fights on record yet.</Note>`.
- Route guards and error state as Task 8 ("This fighter is unavailable right now"). `revalidate = 300`.
- Metadata: title `{name} — UFC record and fights | FinalWhistle`; description with a record: `{name}'s UFC record ({recordText}) and every fight we hold, with results and fight stats.`; without: `{name}'s UFC fights, upcoming and past.`; unknown → `UFC fighter — FinalWhistle`.

- [ ] **Step 1: Write the failing tests:**

```tsx
it("heads the page with country and record", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  expect(screen.getByRole("heading", { level: 1, name: "Jiří Procházka" })).toBeInTheDocument();
  expect(screen.getByText("Czech Republic · UFC record 1-1-0")).toBeInTheDocument();
  expect(screen.getByText("14 October 1992")).toBeInTheDocument();
});
it("lists fights upcoming first with result chips", () => {
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText("Upcoming")).toBeInTheDocument();
  expect(within(rows[1]).getByText("Loss")).toBeInTheDocument(); expect(within(rows[1]).getByText("KO/TKO · R2")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Win")).toBeInTheDocument();
});
it("shows draw and no contest plainly", () => { /* FIGHTER_DRAW_NC → "Draw", "No contest" chips */ });
it("works with no history", () => {
  render(<UfcFighterView fighter={FIGHTER_NO_HISTORY} />);
  expect(screen.getByText(/No UFC fights on record yet/)).toBeInTheDocument();
  expect(screen.getByText("Height, reach and date of birth are not available yet.")).toBeInTheDocument(); // when nothing known
});
// page/layout/loading tests as Task 8; layout 404s "Bad Slug!" without an API call and a null fetch.
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc/UfcFighterView.test.tsx app/ufc/fighter` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): the fighter page`.

### Task 10: Events page — `/ufc/events`

**Files:**
- Create: `frontend/components/ufc/UfcEventList.tsx` (client), `frontend/app/ufc/events/page.tsx`, `frontend/app/ufc/events/loading.tsx`
- Test: `frontend/components/ufc/UfcEventList.test.tsx`, `frontend/app/ufc/events/page.test.tsx`, `frontend/app/ufc/events/loading.test.tsx`

**Interfaces:**
- Consumes: Task 5 fetchers, helpers and fixtures.
- Produces: `UfcEventList({ title, events, emptyText, moreHref, backHref }: { title: string; events: UfcEventSummary[]; emptyText: string; moreHref: string | null; backHref: string | null })`; `export const EVENTS_PAGE = 20` and `export function offsetParam(v: string | string[] | undefined): number` (non-negative integer ≤ 10000, anything else 0) in `app/ufc/events/page.tsx`.

Rules and copy:
- `PageHead` eyebrow `UFC`, title `Events`, sub `Upcoming cards and results. Dates are in your local time.`
- Two `Card flush` sections, "Upcoming" then "Results". Each row: the event name as a link to `eventHref(slug)` (semibold), and a `Note` `{kickoffDate(first_bout_utc)} · {A} v {B} · {n} fights` (`1 fight` for one; main-event part omitted when null; date `Date to be confirmed` when null). Empty: `No upcoming cards are listed yet.` / `No results yet. Finished cards appear here.`
- Paging by offset, one list at a time: query params `up` and `past`. The page asks each list for `EVENTS_PAGE + 1` rows at its offset and shows the first 20; when the 21st exists the section ends with a `TextLink` "Show more" to the same page with that list's offset + 20 (the other param kept). When an offset is above 0 the section also shows "Back to the start" (that param removed).
- Feed error on either list → that section shows `<Note>We could not reach the fight feed. Try again in a minute.</Note>`. Searching params makes the page dynamic; no `revalidate` export.
- Metadata: title `UFC events: upcoming cards and results | FinalWhistle`, description `Every upcoming UFC card and past results, with the main event and the number of fights.`

- [ ] **Step 1: Write the failing tests:**

```tsx
it("lists cards with local date, main event and fight count", () => {
  render(<UfcEventList title="Upcoming" events={UPCOMING_LIST} emptyText="x" moreHref={null} backHref={null} />);
  expect(screen.getByRole("link", { name: UPCOMING_EVENT.name })).toHaveAttribute("href", `/ufc/event/${UPCOMING_EVENT.slug}`);
  expect(screen.getByText("Sun 6 Dec · Israel Adesanya v Shara Magomedov · 4 fights")).toBeInTheDocument(); // tz Australia/Sydney
});
it("shows the empty text", () => { /* events [] → emptyText */ });
// page.test.tsx (jest.mock("@/lib/api")):
it("asks for one extra row and offers Show more", async () => {
  mockEvents.mockImplementation(async (when) => ({ events: when === "past" ? Array.from({ length: 21 }, mkPast) : UPCOMING_LIST }));
  render(await EventsPage({ searchParams: Promise.resolve({}) }));
  expect(mockEvents).toHaveBeenCalledWith("past", 21, 0);
  expect(screen.getAllByRole("link", { name: /^UFC 3\d\d/ })).toHaveLength(20);
  expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/ufc/events?past=20");
});
it("keeps the other list's offset and offers a way back", async () => { /* ?up=20&past=40 → Show more href "/ufc/events?up=20&past=60"; "Back to the start" href "/ufc/events?up=20" */ });
it("ignores a bad offset", () => { expect(offsetParam("-3")).toBe(0); expect(offsetParam("abc")).toBe(0); expect(offsetParam("40")).toBe(40); });
it("survives a feed error in one list", async () => { /* past rejects → upcoming still listed, error note shown */ });
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc/UfcEventList.test.tsx app/ufc/events` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): the events page with upcoming cards and results`.

### Task 11: Sitemap, full suites and the visual check

**Files:**
- Modify: `frontend/app/sitemap.ts`
- Test: `frontend/app/sitemap.test.ts`, `frontend/app/sitemapCounts.test.ts`

**Interfaces:**
- Consumes: the `/api/ufc/events` shape (Task 2).
- Produces: `async function ufcEntries(): Promise<MetadataRoute.Sitemap>` in `sitemap.ts`, appended to the default export's list; `const UFC_SITEMAP_EVENTS = 20`.

Rules:
- Fetch `${API}/api/ufc/events?when=upcoming&limit=${UFC_SITEMAP_EVENTS}` with `{ next: { revalidate: 3600 } }`; never throw (non-OK, bad JSON or a body without an `events` array → no event entries).
- Entries: `/ufc` (daily, 0.8), `/ufc/events` (daily, 0.6), and `/ufc/event/{slug}` for each upcoming card (daily, 0.6), at most 20. Fight and fighter pages are not listed.

- [ ] **Step 1: Write the failing tests.** In `sitemap.test.ts`, change "always passes a competition filter to the API" to check only calls whose URL does not contain `/api/ufc/`, and add:

```ts
it("lists the UFC section and its upcoming cards", async () => {
  global.fetch = jest.fn((url: string) => Promise.resolve({ ok: true, json: async () =>
    url.includes("/api/ufc/") ? { events: [{ slug: "ufc-fight-night-adesanya-vs-magomedov-2026-12-05" }] } : [] } as Response)) as unknown as typeof fetch;
  const urls = (await sitemap()).map((e) => e.url);
  expect(urls).toEqual(expect.arrayContaining([`${SITE}/ufc`, `${SITE}/ufc/events`,
    `${SITE}/ufc/event/ufc-fight-night-adesanya-vs-magomedov-2026-12-05`]));
});
it("caps UFC card entries at 20 and asks for no more", async () => { /* 25 slugs served → 20 event URLs; the request URL contains limit=20 */ });
it("still lists the UFC index pages when the UFC feed fails", async () => { /* /api/ufc/ rejects → /ufc and /ufc/events present */ });
```

In `sitemapCounts.test.ts` add: `expect(urls.filter((u) => u.startsWith(`${SITE}/ufc`)).length).toBeGreaterThanOrEqual(2)`. The existing "emits no duplicate URLs" test must still pass.

- [ ] **Step 2: Run** `cd frontend && npx jest app/sitemap.test.ts app/sitemapCounts.test.ts` — expected: new tests fail.
- [ ] **Step 3: Implement** `ufcEntries`.
- [ ] **Step 4: Run the full suites.** `.venv/bin/python -m pytest -p no:cacheprovider -o addopts="" -q` — expected: no failures. `cd frontend && npm run typecheck && npm run lint && npm test` — expected: no failures. Paste the summary lines in the task report.
- [ ] **Step 5: Visual check against production data.** Run `cd frontend && NEXT_PUBLIC_API_URL=https://pitchprophet-api.onrender.com npm run dev` and open `/ufc`, the first card's fight page, a fighter page, `/ufc/events` and `/ufc/event/no-such-card` at 390, 1024 and 1440 px. Expected: no horizontal page scroll at 390; the card reads like the football matchweek (flush card, segment bands, centred spine); the switcher shows "Mixed martial arts → UFC" with the text mark; the tabs read Card and Events; times are local and lower-case; the unknown slug shows the site's 404 page; the not-affiliated line is under every UFC page. Production has no history yet: records are absent and nothing breaks. Report what you saw at each width, with screenshots if your harness can take them.
- [ ] **Step 6: Commit** `feat(ufc): list the UFC section in the sitemap`.
