# UFC Phase 1 — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store UFC events, fights, fighters, results, fight stats and odds in new tables, filled from ESPN's public feeds through a swappable provider, with a one-off history load and a daily refresh job. Nothing is visible to visitors.

**Architecture:** New `ufc_*` tables in one additive migration. A `UfcProvider` protocol with two implementations: `EspnUfcProvider` (HTTP) and `RecordedUfcProvider` (reads raw files in the layout the spike's downloader wrote). Both share pure parsers. Ingest and results modules write the tables from provider objects; the history backfill is the same code path run over the recorded provider.

**Tech Stack:** Python 3.12, SQLAlchemy 2 (`Mapped` / `mapped_column`), Alembic, `requests`, pytest with the repo's in-memory SQLite fixtures.

**Spec:** `docs/superpowers/specs/2026-11-25-ufc-section-design.md` (sections 3, 4.2, 4.3, 8.1, 8.2, 9, 11).

## Global Constraints

- Additive only. Do not edit any football or NRL module, table or test. The only existing files this plan touches: `backend/app/models/__init__.py` (new classes appended), `backend/app/config.py`, `.env.example`.
- HTTP uses `requests`, as the NRL pipeline does. Tests never touch the network: the root `conftest.py` fails any unmocked request.
- Fighter "a" and "b" are the provider's listing order (ESPN `order` 1 and 2). Nothing may attach meaning to the position.
- Bout identity is `(provider, provider_bout_id, revision)`, never the order on the card.
- Method vocabulary, exactly: `ko_tko`, `submission`, `decision`, `dq`, `draw`, `no_contest`, `other`.
- Bout status vocabulary, exactly: `scheduled`, `live`, `finished`, `cancelled`, `changed`. Event status: `scheduled`, `live`, `finished`, `cancelled`.
- All datetimes are timezone-aware UTC in Python. SQLite hands them back naive in tests; normalise the way existing NRL code does before comparing.
- Provider calls never raise for feed trouble: log a warning and return `None` or an empty collection. Library functions that write the database may raise; each CLI catches per event, rolls back, and moves on.
- Upstream manners: header `User-Agent: Mozilla/5.0`, timeout 20 s, on HTTP 403 or 429 wait and retry at most twice, then give up for that call.
- Match the surrounding code: module docstring explaining the why, `from __future__ import annotations`, `log = logging.getLogger(__name__)`, tests co-located as `*_test.py` for pipeline code and under `backend/tests/` for models.
- Test gate for every task: `.venv/bin/python -m pytest <the task's test file> -q`, and before the final commit of the plan `.venv/bin/python -m pytest -q` (whole Python suite).
- Commit after each task with a conventional message (`feat(ufc): …`), ending with the line `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>`. Do not push.

## Review Focus

1. A fighter is replaced on an existing provider bout id: the old row must become `changed` with `replaced_by_id` set, and a new row with `revision + 1` must carry the new pair. (Task 4)
2. The feed answers 403, 429, a timeout or non-JSON: nothing is written, nothing raises, and a later good run fills in normally. (Tasks 3 and 4)
3. A draw or a no contest: both winner flags are false. The bout is `finished` with `winner` `None` and the method `draw` or `no_contest`. (Tasks 2 and 5)
4. A finished bout must never be reopened or blanked by a later feed response that shows it as not finished or without a result, and a second run of ingest, results or backfill must create no duplicate row. (Tasks 5 and 6)
5. Names: two different fighters with the same name, and names with diacritics (`Mateusz Rębecki`, `Jiří Procházka`), must each get a unique, ASCII, lower-case slug. (Task 4)
6. A bout that disappears from a card it was on becomes `cancelled`; it is not deleted. (Task 4)

---

### Task 1: Tables and migration

**Files:**
- Modify: `backend/app/models/__init__.py` (append after the last NRL model class)
- Create: `backend/alembic/versions/c7d8e9f0a1b2_add_ufc_tables.py` (`revision = "c7d8e9f0a1b2"`, `down_revision = "a9b4c7d2e601"`)
- Test: `backend/tests/test_ufc_models.py`

**Interfaces:**
- Consumes: `Base`, `TipPlayer` (`tip_players.id`) from `app.models`.
- Produces: the model classes below, importable from `app.models`. Later tasks rely on these exact attribute names.

Columns (all `id: Mapped[int]` primary keys; `updated_at` is `DateTime(timezone=True), server_default=func.now(), onupdate=func.now()` unless noted):

| Class / table | Columns |
| --- | --- |
| `UfcFighter` / `ufc_fighters` | `provider` String(20); `provider_fighter_id` String(40); `name` String(120); `slug` String(140), unique, indexed; `date_of_birth` Date, nullable; `height_in`, `reach_in`, `weight_lb` Float, nullable; `stance` String(20), nullable; `country` String(60), nullable; `gender` String(10), nullable; `rating` Float, default 1500.0; `updated_at`. Unique `(provider, provider_fighter_id)` |
| `UfcEvent` / `ufc_events` | `provider`; `provider_event_id` String(40); `name` String(200); `slug` String(220), unique, indexed; `first_bout_utc`, `last_bout_utc` DateTime(tz), nullable; `venue` String(160), nullable; `status` String(20), default `"scheduled"`; `is_card` Boolean, default True; `updated_at`. Unique `(provider, provider_event_id)` |
| `UfcBout` / `ufc_bouts` | `event_id` FK `ufc_events.id`, indexed; `provider`; `provider_bout_id` String(40); `revision` Integer, default 0; `card_order` Integer, nullable; `segment` String(20), nullable; `segment_label` String(40), nullable; `weight_class` String(60), nullable; `scheduled_rounds` Integer, nullable; `is_title` Boolean, nullable; `fighter_a_id`, `fighter_b_id` FK `ufc_fighters.id`, indexed; `scheduled_utc` DateTime(tz), nullable; `locked_at` DateTime(tz), nullable; `status` String(20), default `"scheduled"`; `winner` String(1), nullable (`"a"` or `"b"`); `method` String(20), nullable; `method_detail` String(120), nullable; `end_round` Integer, nullable; `end_clock` String(8), nullable; `replaced_by_id` FK `ufc_bouts.id`, nullable; `updated_at`. Unique `(provider, provider_bout_id, revision)` |
| `UfcBoutStat` / `ufc_bout_stats` | `bout_id` FK, indexed; `fighter_id` FK; Integer nullable: `knockdowns`, `sig_strikes_landed`, `sig_strikes_attempted`, `total_strikes_landed`, `total_strikes_attempted`, `takedowns_landed`, `takedowns_attempted`, `submission_attempts`, `reversals`, `control_seconds`; `extra` JSON, nullable; `judges` JSON, nullable. Unique `(bout_id, fighter_id)` |
| `UfcOddsSnapshot` / `ufc_odds_snapshots` | `bout_id` FK, indexed; `source` String(40); `moneyline_a`, `moneyline_b` Integer (American odds); `taken_at` DateTime(tz), server default now. Unique `(bout_id, source, moneyline_a, moneyline_b)` so an unchanged price is stored once |
| `UfcPrediction` / `ufc_predictions` | `bout_id` FK, indexed; `model_version` String(40); `p_a`, `p_b` Float; `method_probs` JSON, nullable; `reasons` JSON, nullable; `is_shadow` Boolean, default True; `created_at` DateTime(tz), server default now |
| `UfcPredictionResult` / `ufc_prediction_results` | `prediction_id` FK `ufc_predictions.id`, unique; `bout_id` FK, indexed; `model_version` String(40); `winner_correct` Boolean; `prob_assigned` Float; `log_loss` Float; `brier` Float; `evaluated_at` DateTime(tz), server default now |
| `UfcPick` / `ufc_picks` | `bout_id` FK, indexed; `player_id` FK `tip_players.id`, indexed; `winner` String(1); `method` String(20), nullable; `created_at`, `updated_at` DateTime(tz), server default now, **no** `onupdate` on either (see the comment on `UserTip.updated_at`); `points` Integer, nullable; `winner_correct`, `method_correct` Boolean, nullable; `graded_at` DateTime(tz), nullable. Unique `(bout_id, player_id)` |
| `UfcLiveState` / `ufc_live_state` | `bout_id` FK, unique, indexed; `state` String(10) (`pre`, `live`, `final`); `round` Integer, nullable; `clock` String(8), nullable; `source_updated_at` DateTime(tz), nullable; `updated_at` |

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_ufc_models.py`, using the root `conftest.py` fixture `db_session` (in-memory SQLite), as `backend/tests/test_sport_models.py` does:

```python
def test_bout_roundtrip_defaults(db_session):          # insert event + 2 fighters + bout; reload
    assert bout.status == "scheduled" and bout.revision == 0 and bout.winner is None
    assert fighter.rating == 1500.0 and event.is_card is True

def test_fighter_provider_id_is_unique(db_session):    # same (provider, provider_fighter_id) twice
    with pytest.raises(IntegrityError): ...

def test_bout_identity_allows_a_new_revision(db_session):
    # (espn, "401", 0) and (espn, "401", 1) both insert; a second (espn, "401", 1) raises IntegrityError

def test_pick_is_unique_per_bout_and_player(db_session):   # second UfcPick for same bout+player raises

def test_migration_creates_the_same_tables_as_the_models():
    # read the migration module's upgrade() table names (op.create_table calls) and assert they equal
    # {"ufc_fighters","ufc_events","ufc_bouts","ufc_bout_stats","ufc_odds_snapshots",
    #  "ufc_predictions","ufc_prediction_results","ufc_picks","ufc_live_state"}
    # and that every one of those names is in Base.metadata.tables
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_models.py -q` — expected: fails on import of `UfcBout`.
- [ ] **Step 3: Add the nine model classes** with the columns above, each with a short docstring saying what one row is.
- [ ] **Step 4: Write the migration** by hand in the style of `backend/alembic/versions/c1d2e3f4a5b6_add_sport_tables.py`: `upgrade()` creates the nine tables with their constraints and indexes in dependency order; `downgrade()` drops them in reverse.
- [ ] **Step 5: Run the test file** — expected: all pass. Then run `.venv/bin/python -m pytest backend/tests -q -k "model or schema or migration"` — expected: no new failures.
- [ ] **Step 6: Commit** `feat(ufc): add tables for events, fights, fighters, picks and predictions`.

### Task 2: Provider contract, parsers and the recorded provider

**Files:**
- Create: `pipeline/sports/ufc_provider.py` (types and protocol only)
- Create: `pipeline/sports/ufc_espn_parse.py` (pure functions over ESPN JSON)
- Create: `pipeline/sports/ufc_recorded.py` (`RecordedUfcProvider`)
- Test: `pipeline/sports/ufc_espn_parse_test.py`, `pipeline/sports/ufc_recorded_test.py`
- Fixtures (already in place, do not edit): `pipeline/sports/testdata/ufc/raw/{events,bouts,athletes}/*.json` and `pipeline/sports/testdata/ufc/README.md`, which lists every bout, fighter id, result, stat and price the tests below assert on. In the recorded layout the winner flags live in the event file (`competitions[].competitors[].winner`).

**Interfaces:**
- Produces, in `ufc_provider.py` (all dataclasses `frozen=True`):

```python
@dataclass(frozen=True)
class FighterRef:      provider_id: str; name: str | None
@dataclass(frozen=True)
class BoutCard:        provider_id: str; card_order: int | None; segment: str | None; segment_label: str | None
                       weight_class: str | None; scheduled_rounds: int | None; scheduled_utc: datetime | None
                       fighter_a: FighterRef; fighter_b: FighterRef
@dataclass(frozen=True)
class EventCard:       provider_id: str; name: str; first_bout_utc: datetime | None; last_bout_utc: datetime | None
                       venue: str | None; is_card: bool; bouts: tuple[BoutCard, ...]
@dataclass(frozen=True)
class FighterProfile:  provider_id: str; name: str; date_of_birth: date | None; height_in: float | None
                       reach_in: float | None; weight_lb: float | None; stance: str | None; country: str | None; gender: str | None
@dataclass(frozen=True)
class BoutOutcome:     state: str            # "pre" | "live" | "final"
                       round: int | None; clock: str | None
                       winner: str | None    # "a" | "b" | None
                       method: str | None; method_detail: str | None
@dataclass(frozen=True)
class FighterBoutStats: knockdowns: int | None; sig_strikes_landed: int | None; sig_strikes_attempted: int | None
                       total_strikes_landed: int | None; total_strikes_attempted: int | None
                       takedowns_landed: int | None; takedowns_attempted: int | None; submission_attempts: int | None
                       reversals: int | None; control_seconds: int | None; extra: dict; judges: tuple[int, ...]
@dataclass(frozen=True)
class OddsLine:        source: str; moneyline_a: int; moneyline_b: int

class UfcProvider(Protocol):
    name: str                                    # "espn"; stored in the tables' provider column
    def list_event_ids(self, start: date, end: date) -> list[str]: ...
    def fetch_event(self, event_id: str) -> EventCard | None: ...
    def fetch_outcome(self, event_id: str, bout: BoutCard) -> BoutOutcome | None: ...
    def fetch_stats(self, event_id: str, bout: BoutCard) -> dict[str, FighterBoutStats]: ...   # key: "a" / "b"
    def fetch_odds(self, event_id: str, bout: BoutCard) -> list[OddsLine]: ...
    def fetch_fighter(self, fighter_id: str) -> FighterProfile | None: ...
```

- Produces, in `ufc_espn_parse.py`: `parse_event(doc: dict) -> EventCard | None`, `parse_outcome(status_doc: dict | None, winner_a: bool | None, winner_b: bool | None) -> BoutOutcome | None`, `normalise_method(result: dict | None) -> str | None`, `parse_stats(statistics_doc: dict | None, linescores_doc: dict | None) -> FighterBoutStats | None`, `parse_odds(odds_doc: dict | None, fighter_a_id: str, fighter_b_id: str) -> list[OddsLine]`, `parse_fighter(doc: dict | None) -> FighterProfile | None`, `winner_flags(event_doc: dict, bout_id: str) -> tuple[bool | None, bool | None]`.
- Produces, in `ufc_recorded.py`: `RecordedUfcProvider(root: str | Path, name: str = "espn")` implementing `UfcProvider` over `root/events/<event_id>.json`, `root/bouts/<event_id>_<bout_id>.json` (keys `status`, `odds`, `competitors: {fighter_id: {statistics, linescores?}}`) and `root/athletes/<fighter_id>.json`. `list_event_ids` filters by each event file's `date`.

Parsing rules the tests pin:
- Fighter a is the competitor with `order` 1, b is `order` 2. A competition without exactly two competitors is skipped.
- `segment` is `cardSegment.name` lower-cased; `segment_label` is `cardSegment.description`; `weight_class` is `type.text`; `scheduled_rounds` is `format.regulation.periods`; `card_order` is `matchNumber`; `scheduled_utc` is the competition's `date`.
- `first_bout_utc` / `last_bout_utc` are the min and max of the bouts' times. `is_card` is False when the event name contains `Contender Series`.
- `state`: ESPN `status.type.state` `pre` → `pre`, `in` → `live`, `post` → `final`. `clock` is `displayClock`, `round` is `period`.
- `normalise_method` reads `result.name` and `result.displayName` case-insensitively: contains `no contest` or `nocontest` → `no_contest`; `draw` → `draw`; `dq` or `disq` → `dq`; `sub` → `submission`; `ko` → `ko_tko`; `dec` → `decision`; any other non-empty text → `other`; empty → `None`. Check in that order.
- `winner` is `"a"` when only a's flag is true, `"b"` when only b's is, otherwise `None`.
- Stats come from `splits.categories[].stats[]` by `name`: `knockDowns`, `sigStrikesLanded`, `sigStrikesAttempted`, `totalStrikesLanded`, `totalStrikesAttempted`, `takedownsLanded`, `takedownsAttempted`, `submissions`, `reversals`, `timeInControl` (seconds). Every other stat goes into `extra` as `{name: value}`. A fighter whose `totalStrikesAttempted` is missing or zero and who has no knockdowns returns `None` (ESPN lists empty stat blocks for some old fights).
- `judges` are the integer `value`s of `items[].linescores[]` in `order` order.
- Odds: one `OddsLine` per `items[]` entry where both `awayAthleteOdds` and `homeAthleteOdds` have a `moneyLine` and an `athlete.$ref` ending in the fighter's id; `source` is `provider.name`.
- Fighter: `fullName`, `dateOfBirth` (date part), `height`, `reach`, `weight`, `stance.text`, `citizenship`, `gender`.

- [ ] **Step 1: Write failing parser tests** against the fixture files. Exact assertions:

```python
def test_parse_event_reads_the_card():                # raw/events/600061665.json
    card = parse_event(load("events/600061665.json"))
    assert card.name == "UFC Fight Night: Procházka vs. Stirling" and card.is_card is True
    main = next(b for b in card.bouts if b.provider_id == "401922277")
    assert main.weight_class == "Light Heavyweight" and main.scheduled_rounds == 5
    assert main.card_order == 1 and main.segment == "main" and main.segment_label == "Main Card"
    assert main.fighter_a.provider_id == "3156612" and main.fighter_b.provider_id == "5216713"

def test_outcome_of_a_knockout():                     # raw/bouts/600061665_401922277.json
    out = parse_outcome(bout["status"], False, True)
    assert (out.state, out.winner, out.method, out.round, out.clock) == ("final", "b", "ko_tko", 2, "4:58")
    assert out.method_detail == "Punch"

def test_outcome_of_a_decision_has_judges():          # raw/bouts/600061665_401927850.json, fighter a = 3031559
    assert (out.method, out.winner, out.round, out.clock) == ("decision", "b", 3, "5:00")
    assert stats_a.judges == (27, 28, 27) and stats_b.judges == (30, 29, 30)

def test_draw_and_no_contest_have_no_winner():
    assert parse_outcome(status_with(name="draw", displayName="Draw"), False, False).method == "draw"
    assert parse_outcome(status_with(name="nocontest", displayName="No Contest"), False, False).method == "no_contest"
    # winner is None for both, state is "final"

def test_scheduled_bout_is_pre_with_no_result():
    pre = {"period": 0, "displayClock": "-", "type": {"state": "pre"}}
    assert parse_outcome(pre, False, False) == BoutOutcome("pre", 0, "-", None, None, None)
    assert parse_outcome(None, None, None) is None

def test_stats_split_known_fields_from_extra():       # main event 401922277, fighter a = 3156612; feed values are floats
    assert stats.knockdowns == 0 and stats.total_strikes_attempted == 48 and stats.total_strikes_landed == 26
    assert stats.sig_strikes_landed == 23 and stats.control_seconds == 18 and isinstance(stats.knockdowns, int)
    assert "sigDistanceLegStrikesLanded" in stats.extra and "totalStrikesLanded" not in stats.extra

def test_empty_stat_block_is_none():   assert parse_stats({"splits": {"categories": []}}, None) is None
def test_odds_line_for_the_main_event(): assert parse_odds(bout["odds"], "3156612", "5216713") == [OddsLine("DraftKings", 180, -218)]
def test_contender_series_is_not_a_card(): assert parse_event(doc_named("Dana White's Contender Series: Season 10, Week 1")).is_card is False
def test_malformed_documents_return_none(): assert parse_event({}) is None and parse_fighter(None) is None and parse_odds(None, "1", "2") == []
def test_fighter_profile(): # raw/athletes/3156612.json
    assert (p.name, p.date_of_birth, p.height_in, p.reach_in, p.stance) == ("Jiří Procházka", date(1992, 10, 14), 75.0, 80.0, "Orthodox")
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_espn_parse_test.py -q` — expected: import error.
- [ ] **Step 3: Implement `ufc_provider.py` and `ufc_espn_parse.py`.** Parsers are pure, take plain dicts, and return `None` or `[]` for anything malformed.
- [ ] **Step 4: Run the parser tests** — expected: pass.
- [ ] **Step 5: Write failing tests for the recorded provider:**

```python
def test_lists_events_in_a_date_window():
    p = RecordedUfcProvider(RAW)
    assert p.list_event_ids(date(2026, 11, 1), date(2026, 11, 30)) == ["600061665"]
    assert "600062700" in p.list_event_ids(date(2026, 12, 1), date(2026, 12, 31))
def test_upcoming_card_has_two_segments():
    card = p.fetch_event("600062700")
    assert {b.segment for b in card.bouts} == {"main", "prelims1"}
    assert card.first_bout_utc == datetime(2026, 12, 5, 15, 0, tzinfo=timezone.utc) and card.last_bout_utc.hour == 18
def test_fetches_through_the_same_parsers():
    card = p.fetch_event("600061665"); main = next(b for b in card.bouts if b.provider_id == "401922277")
    assert p.fetch_outcome("600061665", main).winner == "b"
    assert set(p.fetch_stats("600061665", main)) == {"a", "b"}
    assert p.fetch_fighter("3156612").name == "Jiří Procházka"
def test_missing_files_are_not_errors():
    assert p.fetch_event("nope") is None and p.fetch_fighter("nope") is None
    assert p.fetch_outcome("600062700", upcoming_bout) == BoutOutcome("pre", None, None, None, None, None)   # no bout file
    assert p.fetch_stats("600062700", upcoming_bout) == {} and p.fetch_odds("600062700", upcoming_bout) == []
```

- [ ] **Step 6: Implement `RecordedUfcProvider`**, run both test files — expected: pass.
- [ ] **Step 7: Commit** `feat(ufc): provider contract, ESPN parsers and a recorded provider`.

### Task 3: The ESPN provider

**Files:**
- Create: `pipeline/sports/ufc_espn.py`
- Modify: `pipeline/sports/ufc_provider.py` (add the factory), `backend/app/config.py`, `.env.example`
- Test: `pipeline/sports/ufc_espn_test.py`

**Interfaces:**
- Consumes: the parsers and types from Task 2.
- Produces: `EspnUfcProvider(session: requests.Session | None = None, sleep: Callable[[float], None] = time.sleep)` implementing `UfcProvider` with `name = "espn"`; `get_provider(name: str | None = None) -> UfcProvider` in `ufc_provider.py` (default: `settings.ufc_provider`; `"espn"` → `EspnUfcProvider()`; anything else raises `ValueError` naming the supported values); settings `ufc_provider: str = "espn"` and `ufc_public_model: str = ""` following the pattern of `league_fixture_provider`.

URLs (constants in the module):
- `CORE = "https://sports.core.api.espn.com/v2/sports/mma"`, `LEAGUE = CORE + "/leagues/ufc"`
- events in a window: `LEAGUE/events?dates=YYYYMMDD-YYYYMMDD&limit=200&page=N` → ids are the last path segment of each `items[].$ref`, following `pageCount`
- event: `LEAGUE/events/{event_id}`; bout: `LEAGUE/events/{event_id}/competitions/{bout_id}` (its `competitors[].winner` flags are the live source of the winner); status: `…/competitions/{bout_id}/status`; odds: `…/odds?limit=50`; stats: `…/competitors/{fighter_id}/statistics`; judges: `…/competitors/{fighter_id}/linescores`; fighter: `CORE/athletes/{fighter_id}`.
- Judges' scores are requested only when the outcome's method is `decision`.

- [ ] **Step 1: Write failing tests** with a fake session whose `get(url, headers=…, timeout=…)` returns canned responses keyed by URL (use the fixture files for bodies) and records calls:

```python
def test_fetch_event_parses_the_feed():      assert provider.fetch_event("600061665").name.startswith("UFC Fight Night")
def test_every_request_is_polite():          # each call carried headers["User-Agent"] == "Mozilla/5.0" and timeout == 20
def test_outcome_uses_live_winner_flags():   # competition doc has winner flags (False, True) → outcome.winner == "b"
def test_404_is_none_without_retry():        assert provider.fetch_fighter("0") is None and len(session.calls) == 1
def test_429_then_success_retries_once():    # first response 429, second 200 → parsed result; sleep called once with 5
def test_403_three_times_gives_up():         # returns None after 3 attempts, sleeps were [5, 15]; nothing raised
def test_timeout_and_bad_json_are_none():    # session raises requests.Timeout / body is "<html>" → None, nothing raised
def test_list_event_ids_follows_pages():     # pageCount 2 → ids from both pages, in feed order
def test_judges_only_for_decisions():        # KO bout → no linescores URL requested
def test_get_provider_default_is_espn():     assert get_provider().name == "espn"
def test_get_provider_rejects_unknown():     with pytest.raises(ValueError): get_provider("nope")
```

- [ ] **Step 2: Run the test file** — expected: import error.
- [ ] **Step 3: Implement** a private `_get_json(url) -> dict | None` holding all politeness and failure handling (retry waits are 5 s then 15 s), and the six protocol methods on top of it.
- [ ] **Step 4: Run** the test file, then `.venv/bin/python -m pytest pipeline/sports -q -k ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): ESPN provider with polite, never-raising fetches`.

### Task 4: Ingest cards

**Files:**
- Create: `pipeline/sports/ufc_ingest.py`
- Test: `pipeline/sports/ufc_ingest_test.py`

**Interfaces:**
- Consumes: `UfcProvider`, `EventCard`, `BoutCard`, `FighterRef`, `FighterProfile` (Task 2); `UfcFighter`, `UfcEvent`, `UfcBout` (Task 1); `get_provider` (Task 3).
- Produces:

```python
def slugify(text: str) -> str                                   # ASCII, lower-case, hyphens; "" → "x"
def upsert_fighter(db: Session, provider: str, ref: FighterRef, profile: FighterProfile | None = None) -> UfcFighter
def upsert_event(db: Session, provider: str, card: EventCard, now: datetime | None = None) -> UfcEvent
def current_bout(db: Session, provider: str, provider_bout_id: str) -> UfcBout | None   # highest revision
@dataclass
class IngestSummary: events: int = 0; bouts_new: int = 0; bouts_changed: int = 0; bouts_cancelled: int = 0; failed: int = 0
def ingest_window(db: Session, provider: UfcProvider, start: date, end: date, now: datetime | None = None) -> IngestSummary
def main() -> int                                                # python -m pipeline.sports.ufc_ingest --days-back 2 --days-ahead 60
```

Rules:
- Fighter slug: `slugify(name)`; if another fighter already holds it, `slugify(name) + "-" + provider_fighter_id`. A fighter known only by id gets the name `"TBA"` until a profile or a later card names them, and the slug is then recomputed once.
- Event slug: `slugify(name) + "-" + first_bout_utc date as YYYY-MM-DD`; on collision append `"-" + provider_event_id`. An event's slug never changes after creation.
- For each `BoutCard`: find `current_bout`. None → insert revision 0. Same fighter pair (a and b by provider id) → update `card_order`, `segment`, `segment_label`, `weight_class`, `scheduled_rounds`, and `scheduled_utc` only while `locked_at is None` and the status is `scheduled`. Different pair → if the current row is `scheduled`, set it to `changed`, insert a new row with `revision + 1`, and point the old row's `replaced_by_id` at it; if the current row is `live` or `finished`, leave it alone and log a warning.
- After processing a card: every bout of that event in the database with status `scheduled` whose provider bout id is absent from the card becomes `cancelled`. Never delete.
- `ingest_window`: `list_event_ids`, then `fetch_event` each; a `None` event or an exception on one event counts in `failed`, rolls back that event only, and the loop continues. Commit per event.
- This module does not touch `status` of live or finished bouts, results, stats or odds (Task 5 owns those), and never fetches fighter profiles.

- [ ] **Step 1: Write failing tests** using `RecordedUfcProvider` over the fixtures and hand-built `EventCard`s:

```python
def test_ingests_a_card():                       # 600061665 → 1 event, its fixture bout count, 2 fighters per bout; statuses "scheduled"
def test_second_run_changes_nothing():           # row counts and ids identical; summary.bouts_new == 0
def test_slugs_are_ascii_and_unique():
    assert slugify("Mateusz Rębecki") == "mateusz-rebecki" and slugify("Jiří Procházka") == "jiri-prochazka"
    # two FighterRefs ("1","Bruno Silva") and ("2","Bruno Silva") → slugs "bruno-silva" and "bruno-silva-2"
def test_replaced_fighter_makes_a_new_revision():
    # same provider bout id, fighter_b swapped → old row status "changed", replaced_by_id == new.id, new.revision == 1; summary.bouts_changed == 1
def test_removed_bout_is_cancelled_not_deleted():
def test_time_moves_until_locked():              # scheduled_utc follows the card; after locked_at is set it stays
def test_finished_bout_is_not_rewritten_by_a_changed_card():   # status "finished" + different pair in the feed → row untouched
def test_one_bad_event_does_not_stop_the_rest(): # provider returns None for one id → failed == 1, the other event ingested
def test_tba_fighter_is_named_later():           # ref with name None → "TBA"; later ref with the name → name and slug updated
```

- [ ] **Step 2: Run** — expected: import error.
- [ ] **Step 3: Implement.** `main()` follows `pipeline/sports/nrl_ingest.py`'s CLI shape (argparse, `SessionLocal`, per-item rollback, summary logged, return code 0).
- [ ] **Step 4: Run** the test file — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): ingest fight cards with replacement and cancellation handling`.

### Task 5: Results, stats and odds

**Files:**
- Create: `pipeline/sports/ufc_results.py`
- Test: `pipeline/sports/ufc_results_test.py`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces:

```python
def apply_outcome(db: Session, bout: UfcBout, outcome: BoutOutcome, now: datetime | None = None) -> bool   # True if the row changed
def record_stats(db: Session, bout: UfcBout, stats: dict[str, FighterBoutStats]) -> int                    # rows written
def record_odds(db: Session, bout: UfcBout, lines: list[OddsLine]) -> int                                  # new snapshots
def ensure_profiles(db: Session, provider: UfcProvider, limit: int = 40) -> int                             # fighters updated
def roll_up_event(db: Session, event: UfcEvent) -> None
@dataclass
class ResultsSummary: checked: int = 0; finished: int = 0; stats: int = 0; odds: int = 0; profiles: int = 0; failed: int = 0
def refresh_results(db: Session, provider: UfcProvider, now: datetime | None = None) -> ResultsSummary
def main() -> int                                                # python -m pipeline.sports.ufc_results
```

Rules:
- `apply_outcome`: `pre` → nothing. `live` → status `live`, and set `locked_at` to `now` if it is empty. `final` → status `finished`, `winner`, `method`, `method_detail`, `end_round`, `end_clock`, and `locked_at` if empty. A row already `finished` is only ever updated by another `final` outcome that carries a method; never by `pre`, `live`, or a `final` with no method. Rows in `cancelled` or `changed` are never touched.
- `record_stats` upserts by `(bout_id, fighter_id)`; `record_odds` relies on the unique constraint to skip an unchanged price.
- `refresh_results` considers bouts with status `scheduled` or `live` and `scheduled_utc <= now`, plus bouts `finished` in the last 3 days that have no stats row (ESPN posts stats late). For each: `fetch_outcome`, `apply_outcome`; when finished, `fetch_stats` and `fetch_odds`. For every bout still `scheduled` with `scheduled_utc` within the next 7 days: `fetch_odds`. Then `ensure_profiles` for fighters with no `date_of_birth`, soonest bout first. Then `roll_up_event` for every event touched.
- `roll_up_event`: `finished` when every bout not `cancelled` or `changed` is `finished` and there is at least one; `live` when any bout is `live` or some but not all are `finished`; otherwise unchanged.
- Per-bout failure: count in `failed`, roll back that bout, continue. Commit per bout.

- [ ] **Step 1: Write failing tests:**

```python
def test_knockout_is_recorded():                 # ingest 600061665, refresh_results with now after the card → main event finished, winner "b", method "ko_tko", end_round 2, end_clock "4:58"
def test_stats_and_judges_are_stored():          # decision bout: two UfcBoutStat rows, judges lists of length 3
def test_odds_snapshot_is_stored_once():         # run twice → one snapshot per source and price
def test_draw_and_no_contest_finish_without_a_winner():
def test_live_outcome_locks_the_bout():          # state "live" → status "live", locked_at set
def test_finished_is_never_reopened():           # finished row + outcome "pre" → unchanged, apply_outcome returns False
def test_finished_without_method_does_not_blank_a_result():
def test_cancelled_and_changed_rows_are_skipped():
def test_event_rolls_up_to_finished():           # and to "live" when only some bouts are done
def test_future_bouts_are_not_fetched_for_results():   # scheduled_utc > now → provider.fetch_outcome not called
def test_profiles_are_filled():                  # fighter without date_of_birth gets one from the recorded provider
def test_provider_failure_on_one_bout_is_counted_not_raised():
def test_second_run_is_a_no_op():                # summary.finished == 0 the second time, row counts unchanged
```

- [ ] **Step 2: Run** — expected: import error.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test file — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): record results, fight stats, judges and odds`.

### Task 6: History backfill and the daily job

**Files:**
- Create: `pipeline/sports/ufc_backfill.py`
- Create: `.github/workflows/ufc-refresh.yml`
- Test: `pipeline/sports/ufc_backfill_test.py`

**Interfaces:**
- Consumes: Tasks 2, 4, 5.
- Produces: `backfill(db: Session, provider: UfcProvider, start: date, end: date, now: datetime | None = None) -> BackfillSummary` (`events`, `bouts`, `finished`, `stats`, `odds`, `fighters`, `failed`) and `main()`: `python -m pipeline.sports.ufc_backfill --raw <dir> [--from 1993-01-01] [--to <today>]` (with `--raw` it uses `RecordedUfcProvider(<dir>)`; without it, `get_provider()`).

Rules:
- For each event id in the window, oldest first: `upsert_event`; then for each bout `fetch_outcome` → `apply_outcome`, `fetch_stats` → `record_stats`, `fetch_odds` → `record_odds`; then `upsert_fighter(..., profile=fetch_fighter(id))` for fighters with no date of birth; `roll_up_event`; commit. One event's failure is counted, rolled back and skipped.
- Safe to re-run and safe to interrupt: a second run over the same data writes nothing new.
- The workflow copies `.github/workflows/nrl-refresh.yml`'s structure (checkout, Python setup, install, `alembic upgrade head`, env from secrets) with: `name: UFC refresh`; triggers `workflow_dispatch` and `schedule` at `20 9 * * *` and `20 21 * * *` UTC; steps `python -m pipeline.sports.ufc_ingest --days-back 2 --days-ahead 60` then `python -m pipeline.sports.ufc_results` (the second with `continue-on-error: true`). No step prints row contents.

- [ ] **Step 1: Write failing tests:**

```python
def test_backfill_loads_a_finished_card():       # RAW fixtures, window covering Nov 2026 → event finished, main event winner "b", stats rows, fighters with date_of_birth
def test_backfill_twice_is_identical():          # all table row counts equal after the second run; second summary.finished == 0
def test_backfill_includes_an_upcoming_card_as_scheduled():   # 600062700 → bouts "scheduled", no winner
def test_backfill_survives_a_broken_event_file():             # tmp copy of RAW with one event file truncated → failed == 1, others loaded
def test_workflow_is_valid_yaml_with_both_steps():            # yaml.safe_load the workflow; "ufc_ingest" and "ufc_results" appear in run steps; triggers include workflow_dispatch and schedule
```

- [ ] **Step 2: Run** — expected: import error.
- [ ] **Step 3: Implement** the module and the workflow file.
- [ ] **Step 4: Run** the test file, then the whole Python suite: `.venv/bin/python -m pytest -q` — expected: no failures.
- [ ] **Step 5: Commit** `feat(ufc): history backfill and a daily refresh workflow`.
