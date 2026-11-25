# UFC Phase 4 — Picks Game Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Visitors pick the winner and the method of every open fight on a UFC card, the pick is final and locks at the start of its part of the card by the server clock, picks are graded after the fight (winner and method 5 points, winner 2), and players see their picks and a per-card and per-year leaderboard. The model's call is served only after the player has picked, or to everyone once the fight is locked, and only when a public model is configured (production has none today).

**Architecture:** Backend first, as its own pull request (Tasks 1–7): small data-quality fixes; one pure rules module (`backend/app/ufc_rules.py`) that owns the lock, the scoring and the model's pick, shared by the API and the pipeline; one model-call module (`backend/app/ufc_model.py`) that is the only place a model field is built and that applies the reveal rule; a picks router (`backend/app/api/ufc_picks.py`) copied from football's `league_score_predictions.py` (device-first identity, same-origin check, rate limit, first pick final); a grading pass (`pipeline/sports/ufc_picks.py`) run by `ufc-refresh.yml`, reconciling like `ufc_predict.py`. Then the frontend (Tasks 8–13): a picks context per page, the pick control on the fight page, pick status on card rows, "My picks" and the leaderboard, all against the deployed API.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2, Pydantic v2, pytest (in-memory SQLite). Next.js App Router, TypeScript, Tailwind, Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-25-ufc-section-design.md` (sections 4.3, 5.1–5.5, 6, 8, 10–14). Mock-ups: `~/Projects/fw-ufc-spike/design/ufc-on-finalwhistle.html` (`class="ph"`: the card with pick lines, the fight page with "Your pick", the leaderboard numbers). Where the spec and this plan differ, this plan wins: it applies the owner's decisions of 2026-11-25 (winner and method both required, no odds, everything free, server-side reveal, model public only through `ufc_public_model`) and the rulings at the end.

**Pull requests:** Tasks 1–7 are the backend pull request (no migration; it can merge and deploy on its own, and nothing visible changes while `ufc_public_model` is empty). Tasks 8–13 are the frontend pull request, built and checked against the deployed production API. The frontend pull request merges only after the backend one is live (otherwise the pick control shows its error state).

## Global Constraints

- The repository is public (`javohir73/FinalWhistle`): no secrets, tokens, `.env` values, database URLs or personal data in code, tests, logs, commits or PR bodies. Pipeline logs are counts only (no fighter names, handles or device ids).
- Words: "bout" and "event" in code, data and API; "fight" and "card" in everything a visitor reads. Fighters are named by their full stored name, never shortened. Every UFC page carries `FinalWhistle is not affiliated with the UFC.` (already rendered by `app/ufc/layout.tsx`; do not add it again); no copy or metadata says "official"; no UFC logo, no photos.
- Nothing reads as betting advice: no odds, prices, bookmaker names or links, no "bet", "lock of the day", "sure thing", no prizes or entry fees. Picks API responses that carry the model's call also carry `disclaimer: "For analytics and entertainment only. Not betting advice."` (football's `_DISCLAIMER`).
- Scoring copy, exactly and everywhere it appears: `Winner and method 5 points, winner 2.` The rule line under the pick control is `Winner and method 5 points, winner 2. A locked pick is final.`
- Existing design tokens and `frontend/components/ui` primitives only. No new colours, fonts or shadows. Fighter marks stay monograms (`FighterMark`).
- Football and NRL behaviour must not change. The only shared files touched: `backend/app/main.py` (router, no-store rule), `backend/app/api/nrl_user_tips.py` (one more reassign loop in `claim_device_tips`), `backend/app/schemas/__init__.py` (new classes, one new field on UFC schemas), `frontend/lib/sports.ts` (UFC entry only), `frontend/lib/reveal.ts` (one mapping), `frontend/lib/api.ts` (one UFC fetcher), `.github/workflows/ufc-refresh.yml`, and the UFC nav tests. Every football and NRL test stays green unchanged.
- Never run `npm install`; never edit `package.json` or `package-lock.json` (`frontend/node_modules` and `.venv` are shared symlinks).
- Time zones: every time shown is in the viewer's zone through `useTimezone()` (lower-case times via `kickoffTimeLower`, dates via `kickoffDate`, zone via `tzAbbrev`). Tests set `localStorage.setItem("pp:timezone", JSON.stringify({ tz, confirmed: true }))` and must pass under any machine zone (the gate runs them under `TZ=UTC` and `TZ=America/Los_Angeles`).
- The lock is decided by the server clock only. A client clock may close a control early for display; it never opens one.
- An App Router `page.tsx` exports only the page component and recognised route fields (`metadata`, `generateMetadata`, `revalidate`, `dynamic`, `generateStaticParams`); helpers live in a sibling module. No `loading.tsx` above a layout that can call `notFound()`. `next build` is part of the final gate.
- API errors use the existing envelope: `HTTPException(status, detail={"code": ..., "message": ...})`, rewritten by `backend/app/main.py` to `{"error": {"code", "message"}}`. Tests and the frontend read `error.code`.
- No migration. `ufc_picks` (model `UfcPick`) already has every column this phase needs. The Alembic head pinned by `HEAD_REVISION = "1f2e3d4c5b6a"` in `backend/tests/test_billing_had_subscription_migration.py` must not change.
- Tests never touch the network. Python gate per task: `.venv/bin/python -m pytest <files> -p no:cacheprovider -o addopts="" -q`. Frontend gate per task: `cd frontend && npm run typecheck && npm run lint && npx jest <paths>`. Full suites run in Task 13.
- Stage explicit paths (never `git add -A`). One commit per task, conventional message (`feat(ufc): …` / `fix(ufc): …`), ending with the Co-Authored-By line your harness specifies. Do not push.

## Review Focus

1. **A pick that arrives after the start, from a stale page or a fast device clock.** The server refuses it with 422 `fight_locked` at exactly the lock instant and after; the control closes on that answer and on its own clock tick, without a reload, and never spends more attempts. Tests: Task 4 `test_submit_at_or_after_lock_is_refused`, Task 9 `closes when the server says the fight is locked` and `closes by the clock without a reload`.
2. **Signing in after picking.** The sign-in claim merges the device's player row into the account and deletes it; without a UFC loop the delete fails on the `ufc_picks` foreign key (Postgres) or picks vanish. Tests: Task 4 `test_claim_moves_ufc_picks_to_the_account` and `test_claim_merge_keeps_the_accounts_pick_and_drops_the_device_duplicate`.
3. **The opponent is replaced after the player picked.** The old pick is void and says so on the card and the fight page, the new fight is open to pick, and the void pick never scores. Tests: Task 5 `test_mine_lists_a_pick_on_a_changed_bout_with_its_current_replacement`, Task 6 `test_voids_draw_no_contest_cancelled_and_changed`, Task 10 `shows a notice for a pick on a changed fight`.
4. **Two taps or two tabs.** The second submit gets 409 `pick_finalized`, the first pick stays exactly as saved, and the page shows the saved pick instead of the controls. Tests: Task 4 `test_second_pick_is_refused_and_the_first_stays`, `test_concurrent_first_pick_keeps_the_first`; Task 9 `shows the saved pick after a 409`.
5. **Prelims locked, main card still open.** Each fight locks at its own part of the card: on the same page prelims rows read "Picks closed" while main-card rows still offer "Pick winner", and a result corrected later (overturned to a no contest) re-grades the picks. Tests: Task 10 `locks each part of the card on its own`, Task 6 `test_an_overturned_result_is_regraded`.

---

### Task 1: Data quality — impossible measurements and placeholder fighters

**Files:**
- Create: `backend/app/ufc_rules.py` (this task adds only `is_placeholder_name`; Task 2 adds the rest)
- Modify: `pipeline/sports/ufc_espn_parse.py` (`parse_fighter`), `backend/app/api/ufc.py` (`_tape_side`, `fighter_detail`)
- Test: `pipeline/sports/ufc_espn_parse_test.py`, `backend/tests/test_ufc_rules.py` (create), `backend/tests/test_ufc_api.py`

**Interfaces:**
- Consumes: `FighterProfile` (`pipeline/sports/ufc_provider.py`), `UfcTapeSideOut`, `UfcFighterDetailOut`.
- Produces:

```python
# backend/app/ufc_rules.py
def is_placeholder_name(name: str | None) -> bool   # True for None, blank, "TBA", "Opponent TBA" (any case, trimmed, any inner whitespace)
# backend/app/api/ufc.py (private)
def _measure(value: float | None) -> float | None   # None when None or <= 0
def _stance(value: str | None) -> str | None        # None when it has no letter; else trimmed
```

Rules:
- Placeholder pattern: `re.compile(r"^(opponent\s+)?tba$", re.IGNORECASE)` on the trimmed name, the same rule as the frontend's `isTba`.
- `parse_fighter`: `height_in` and `reach_in` are None when the feed value is 0 or less; `stance` is None when the text has no letter (`"--"`, `"-"`, whitespace). `upsert_fighter` keeps skipping None, so stored zeros stay in the table; the API masks them.
- `_tape_side` and `fighter_detail` pass height, reach and stance through `_measure` / `_stance`.
- `GET /api/ufc/fighters/{slug}` answers 404 `{"code": "not_found", "message": "No UFC fighter with that name"}` (the existing message) when the fighter is a placeholder.

- [ ] **Step 1: Write the failing tests.**

```python
# pipeline/sports/ufc_espn_parse_test.py
@pytest.mark.parametrize("height,reach", [(0, 0), (-1, 0.0), (0.0, -3)])
def test_parse_fighter_treats_non_positive_measurements_as_unknown(height, reach):
    p = parse_fighter({"id": 1, "fullName": "Opponent TBA", "height": height, "reach": reach})
    assert (p.height_in, p.reach_in) == (None, None)

def test_parse_fighter_keeps_real_measurements():            # height 75, reach 80 → 75.0, 80.0

@pytest.mark.parametrize("stance", ["--", "-", " ", ""])
def test_parse_fighter_treats_a_stance_without_letters_as_unknown(stance):
    assert parse_fighter({"id": 1, "fullName": "X Y", "stance": {"text": stance}}).stance is None
    # "Orthodox" stays "Orthodox"

# backend/tests/test_ufc_rules.py
@pytest.mark.parametrize("name,expected", [
    ("TBA", True), ("tba", True), (" Opponent TBA ", True), ("opponent   tba", True), ("", True), (None, True),
    ("Shara Magomedov", False), ("Tbarra Silva", False), ("Opponent", False),
])
def test_is_placeholder_name(name, expected):
    assert is_placeholder_name(name) is expected

# backend/tests/test_ufc_api.py (use the file's _fighter/_event/_bout helpers)
def test_tape_and_fighter_hide_impossible_measurements(client):
    # fighter "Opponent Q" stored with height_in 0, reach_in 0, stance "--" on a scheduled bout
    tape = c.get(f"/api/ufc/bouts/{bout_id}").json()["tape"]["b"]
    assert (tape["height_in"], tape["reach_in"], tape["stance"]) == (None, None, None)
    body = c.get(f"/api/ufc/fighters/{slug}").json()
    assert (body["height_in"], body["reach_in"], body["stance"]) == (None, None, None)

@pytest.mark.parametrize("name", ["TBA", "Opponent TBA"])
def test_fighter_detail_is_404_for_a_placeholder(client, name):
    r = c.get(f"/api/ufc/fighters/{slug}")
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_espn_parse_test.py backend/tests/test_ufc_rules.py backend/tests/test_ufc_api.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail (`ufc_rules` missing, zeros served, placeholder 200).
- [ ] **Step 3: Implement** the rules above.
- [ ] **Step 4: Run** the same command — expected: all pass.
- [ ] **Step 5: Commit** `fix(ufc): unknown is unknown — no zero heights, no "--" stance, no placeholder fighter pages`.

### Task 2: Shared rules — the lock, the score and the model's pick

**Files:**
- Modify: `backend/app/ufc_rules.py`
- Modify: `pipeline/sports/ufc_predict.py` (import `lock_time` and `lock_expr` from `app.ufc_rules`; delete its own `lock_time` body and the inline `case` in `grade_summary`; keep the name `lock_time` importable from `ufc_predict`)
- Modify: `pipeline/sports/ufc_ingest.py` (`_apply_bout`, `upsert_event`: the sticky lock; docstrings)
- Test: `backend/tests/test_ufc_rules.py`, `pipeline/sports/ufc_predict_test.py`, `pipeline/sports/ufc_ingest_test.py`

**Interfaces:**
- Consumes: `UfcBout`, `UfcEvent`; `is_placeholder_name` (Task 1).
- Produces (all in `backend/app/ufc_rules.py`; no database access except `lock_expr`, which only builds an expression):

```python
PICK_METHODS: tuple[str, ...] = ("ko_tko", "submission", "decision")
METHOD_TIE_ORDER: tuple[str, ...] = ("decision", "ko_tko", "submission")   # == ml.sports.ufc.methods._TIE_ORDER
VOID_METHODS: tuple[str, ...] = ("draw", "no_contest")

def utc(dt: datetime | None) -> datetime | None            # naive → UTC; aware → astimezone(UTC)
def lock_time(bout: UfcBout) -> datetime | None            # min(locked_at, scheduled_utc), whichever is set
def lock_expr()                                            # SQL CASE over UfcBout with the same rule (moved from ufc_predict.grade_summary)

def pick_block(bout: UfcBout, event: UfcEvent, name_a: str | None, name_b: str | None,
               now: datetime) -> tuple[int, str, str] | None
    # None when a first pick may be accepted now; else (http status, code, message)

def call_is_public(bout: UfcBout, name_a: str | None, name_b: str | None, now: datetime) -> bool

@dataclass(frozen=True)
class PickScore:
    points: int | None
    winner_correct: bool | None
    method_correct: bool | None
    void: bool

def score_pick(winner: str, method: str | None, bout: UfcBout) -> PickScore | None   # None: not gradeable yet
def model_pick(p_a: float, method_probs: dict | None) -> tuple[str | None, str | None]  # (winner side, method)
```

Rules:
- `pick_block`, checked in this order, first match wins (exact codes and copy):
  1. bout `changed` → `(422, "fight_changed", "This fight has changed. Pick the new one on the card.")`
  2. bout or event `cancelled` → `(422, "fight_cancelled", "This fight was cancelled.")`
  3. bout status not `scheduled`, or `winner` set, or `lock_time(bout)` is None, or `now >= lock_time(bout)` → `(422, "fight_locked", "Picks for this fight have closed.")`
  4. either name is a placeholder → `(422, "opponent_tba", "Picks open once both fighters are confirmed.")`
- `call_is_public`: False when either name is a placeholder or the status is `cancelled` or `changed`; True when the status is `live` or `finished`; for `scheduled`, True only when `lock_time` is set and `now >= lock_time`; False for anything else.
- `score_pick` (the one scoring function; the grader writes it, the leaderboard scores the model with it):

| bout | pick | result |
| --- | --- | --- |
| `cancelled` or `changed` | any | `PickScore(None, None, None, True)` |
| `scheduled`, `live`, other | any | `None` |
| `finished`, winner not `a`/`b`, or method in `VOID_METHODS` | any | void, as above |
| `finished`, winner differs | any | `PickScore(0, False, False, False)` |
| `finished`, winner right, `bout.method == method` and in `PICK_METHODS` | | `PickScore(5, True, True, False)` |
| `finished`, winner right, otherwise (other method, `dq`, `other`, None) | | `PickScore(2, True, False, False)` |

- `model_pick`: winner `"a"` when `p_a > 0.5`, `"b"` when `p_a < 0.5`, None at exactly 0.5 (then method None too). Method: the key of `PICK_METHODS` with the highest probability in `method_probs`, ties broken by `METHOD_TIE_ORDER`; None when `method_probs` is None or has none of the three keys.
- Sticky lock (spec 4.3: once locked, never reopens). In `_apply_bout`, for a row that is `scheduled` with `locked_at is None` and the same pair: when `utc(current.scheduled_utc)` is set and `now >= utc(current.scheduled_utc)`, set `current.locked_at = current.scheduled_utc` and do not apply the card's fields. `upsert_event` passes its `now` to `_apply_bout`. A time moved before the start still moves (earlier or later). The new-revision path for a changed pair is unchanged.

- [ ] **Step 1: Write the failing tests.**

```python
# backend/tests/test_ufc_rules.py — build UfcBout/UfcEvent objects in memory (no session needed)
T = datetime(2026, 12, 5, 18, 0, tzinfo=timezone.utc)

def test_lock_time_is_the_earlier_of_locked_at_and_scheduled():
    assert lock_time(_b(scheduled=T)) == T
    assert lock_time(_b(scheduled=T, locked_at=T - timedelta(minutes=5))) == T - timedelta(minutes=5)
    assert lock_time(_b(scheduled=T, locked_at=T + timedelta(minutes=5))) == T
    assert lock_time(_b(scheduled=None, locked_at=None)) is None
    assert lock_time(_b(scheduled=T.replace(tzinfo=None))) == T          # SQLite hands back naive values

def test_lock_expr_matches_lock_time(db_session):     # the four cases above stored, selected through lock_expr(), equal lock_time()

@pytest.mark.parametrize("kw,now,expected", [
    ({}, T - timedelta(seconds=1), None),
    ({}, T, (422, "fight_locked", "Picks for this fight have closed.")),           # at the lock instant
    ({}, T + timedelta(hours=1), (422, "fight_locked", "Picks for this fight have closed.")),
    ({"status": "live"}, T - timedelta(hours=1), (422, "fight_locked", ...)),
    ({"status": "finished", "winner": "a"}, T - timedelta(hours=1), (422, "fight_locked", ...)),
    ({"locked_at": T - timedelta(hours=2)}, T - timedelta(hours=1), (422, "fight_locked", ...)),
    ({"scheduled": None}, T - timedelta(hours=1), (422, "fight_locked", ...)),
    ({"status": "cancelled"}, T - timedelta(hours=1), (422, "fight_cancelled", "This fight was cancelled.")),
    ({"status": "changed"}, T - timedelta(hours=1), (422, "fight_changed", "This fight has changed. Pick the new one on the card.")),
    ({"event_status": "cancelled"}, T - timedelta(hours=1), (422, "fight_cancelled", ...)),
    ({"name_b": "Opponent TBA"}, T - timedelta(hours=1), (422, "opponent_tba", "Picks open once both fighters are confirmed.")),
])
def test_pick_block(kw, now, expected): ...

@pytest.mark.parametrize("kw,now,public", [
    ({}, T - timedelta(seconds=1), False), ({}, T, True), ({"status": "live"}, T - timedelta(hours=1), True),
    ({"status": "finished", "winner": "b"}, T - timedelta(hours=1), True), ({"status": "cancelled"}, T + timedelta(hours=1), False),
    ({"status": "changed"}, T + timedelta(hours=1), False), ({"name_a": "TBA", "status": "finished"}, T, False),
])
def test_call_is_public(kw, now, public): ...

@pytest.mark.parametrize("status,winner,method,pick,expected", [
    ("finished", "b", "decision", ("b", "decision"), (5, True, True, False)),
    ("finished", "b", "ko_tko", ("b", "decision"), (2, True, False, False)),
    ("finished", "b", "decision", ("a", "decision"), (0, False, False, False)),
    ("finished", "a", "dq", ("a", "ko_tko"), (2, True, False, False)),
    ("finished", "a", "other", ("a", "submission"), (2, True, False, False)),
    ("finished", None, "draw", ("a", "decision"), (None, None, None, True)),
    ("finished", None, "no_contest", ("b", "ko_tko"), (None, None, None, True)),
    ("finished", None, None, ("b", "ko_tko"), (None, None, None, True)),
    ("cancelled", None, None, ("a", "decision"), (None, None, None, True)),
    ("changed", None, None, ("a", "decision"), (None, None, None, True)),
])
def test_score_pick_matrix(status, winner, method, pick, expected):
    assert astuple(score_pick(*pick, _b(status=status, winner=winner, method=method))) == expected

@pytest.mark.parametrize("status", ["scheduled", "live"])
def test_score_pick_waits_for_a_result(status): assert score_pick("a", "decision", _b(status=status)) is None

def test_model_pick():
    probs = {"ko_tko": 0.3, "submission": 0.2, "decision": 0.5}
    assert model_pick(0.62, probs) == ("a", "decision")
    assert model_pick(0.38, probs) == ("b", "decision")
    assert model_pick(0.5, probs) == (None, None)
    assert model_pick(0.7, {"ko_tko": 0.4, "submission": 0.2, "decision": 0.4}) == ("a", "decision")   # tie order
    assert model_pick(0.7, None) == ("a", None)

# pipeline/sports/ufc_predict_test.py
def test_lock_rule_comes_from_the_shared_rules():
    assert ufc_predict.lock_time is ufc_rules.lock_time
def test_method_tie_order_matches_the_method_model():
    assert ufc_rules.METHOD_TIE_ORDER == methods._TIE_ORDER

# pipeline/sports/ufc_ingest_test.py (existing helpers _card, _bout, T0, NOW)
def test_a_passed_start_locks_the_bout_and_stops_time_moves(db_session):
    upsert_event(db_session, "espn", _card(_bout(when=T0)), now=T0 - timedelta(days=1)); db_session.commit()
    upsert_event(db_session, "espn", _card(_bout(when=T0 + timedelta(hours=1))), now=T0 + timedelta(minutes=5))
    row = current_bout(db_session, "espn", "b1")
    assert (_utc(row.locked_at), _utc(row.scheduled_utc), row.status) == (T0, T0, "scheduled")

def test_a_time_moved_before_the_start_still_moves(db_session):
    # second upsert at now=T0 - 1h with the card at T0 + 1h → scheduled_utc T0 + 1h, locked_at None
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_rules.py pipeline/sports/ufc_predict_test.py pipeline/sports/ufc_ingest_test.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail.
- [ ] **Step 3: Implement** the rules above. `ufc_predict.py` keeps every behaviour; only the source of `lock_time` and the lock `case` moves.
- [ ] **Step 4: Run** the same command, then `.venv/bin/python -m pytest pipeline/sports -k ufc -p no:cacheprovider -o addopts="" -q` — expected: all pass.
- [ ] **Step 5: Commit** `feat(ufc): one lock, one score — shared pick rules, and a passed start never reopens`.

### Task 3: The model's call and the public reveal

**Files:**
- Create: `backend/app/ufc_model.py`
- Modify: `backend/app/schemas/__init__.py` (add `UfcModelCallOut`; add `model: UfcModelCallOut | None = None` to `UfcBoutSummaryOut`, inherited by `UfcBoutDetailOut`), `backend/app/api/ufc.py` (`_detail`, `bout_detail`, module docstring)
- Test: `backend/tests/test_ufc_model.py` (create)

**Interfaces:**
- Consumes: `lock_expr`, `lock_time`, `call_is_public`, `model_pick`, `utc` (Task 2); `settings.ufc_public_model` (`backend/app/config.py`, default `""`); `UfcPrediction`.
- Produces:

```python
# schemas
class UfcModelCallOut(BaseModel):
    model_version: str
    winner: Literal["a", "b"] | None        # model_pick
    p_a: float
    p_b: float
    method: Literal["ko_tko", "submission", "decision"] | None
    method_probs: dict[str, float] | None
    reasons: list[str]                      # reworded

# backend/app/ufc_model.py
def public_version() -> str | None                                   # settings.ufc_public_model.strip() or None
def counting_predictions(db: Session, bout_ids: list[int], version: str) -> dict[int, UfcPrediction]
def reword_reason(text: str) -> str
def call_out(pred: UfcPrediction) -> UfcModelCallOut
def calls_for(db: Session, bouts: list[UfcBout]) -> dict[int, UfcModelCallOut]
    # every bout with a counting row of the public version; NO reveal rule — callers apply it
def public_calls(db: Session, bouts: list[UfcBout], names: dict[int, str], now: datetime) -> dict[int, UfcModelCallOut]
    # calls_for, kept only where call_is_public(bout, names[a], names[b], now)
```

Rules:
- This module is the only place a `UfcModelCallOut` is built. Every UFC endpoint gets model fields from `public_calls` (anyone) or from `calls_for` filtered by the picks router's per-player rule (Task 5). The phase-2 `is_shadow` flag is not read: which version is public is the setting alone (spec 6; every phase-2 row is `is_shadow=True`).
- No public version → `{}` without querying predictions.
- Counting row: per bout, the latest `UfcPrediction` of that version with `created_at <= lock_expr()` (lock NULL → none), ordered `created_at desc, id desc`, chosen in SQL with `row_number()` exactly as football's `_model_predictions_by_match` does; `load_only` the columns `call_out` reads. One query per response however many bouts.
- `reword_reason`: a stored sentence matching `^(?P<w>.+) is rated higher, (?P<rw>\d+) to (?P<rl>\d+)\.$` becomes `"{w} is ahead on FinalWhistle's own fighter rating, {rw} to {rl}."`; every other sentence is unchanged.
- `/events/{slug}`, `/events/next` and `/bouts/{id}` fill `model` from `public_calls` (names from the minis already loaded). `/events` (list) and `/fighters/{slug}` never carry a model field (they do not use `UfcBoutSummaryOut`; keep it that way).

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_ufc_model.py` (copy `test_ufc_api.py`'s `client` fixture and helpers; times relative to `now = datetime.now(timezone.utc)`; `monkeypatch.setattr(settings, "ufc_public_model", "ufc-form-v0.2")` unless the test says empty).

```python
def _keys(obj) -> set[str]:      # every key at any depth of a JSON value

def test_no_call_when_the_setting_is_empty(client, monkeypatch):
    # setting ""; a finished bout with a form prediction made before lock
    assert all(b["model"] is None for s in detail["segments"] for b in s["bouts"])
    assert c.get(f"/api/ufc/bouts/{bid}").json()["model"] is None

def test_no_call_without_a_row_of_that_version_at_or_before_lock(client, monkeypatch):
    # live bout: a form row created 1 minute after lock, an elo row before lock → model None

def test_counting_row_is_the_latest_at_or_before_lock(client, monkeypatch):
    # rows at lock-2h (p_a .55), exactly at lock (p_a .61), lock+1m (p_a .90) → p_a == 0.61

def test_open_bout_never_carries_a_call(client, monkeypatch):
    # scheduled, lock in 1 hour, counting row with reasons ["Shara Magomedov is five years younger."]
    for r in (c.get(f"/api/ufc/events/{slug}"), c.get("/api/ufc/events/next"), c.get(f"/api/ufc/bouts/{bid}")):
        assert "five years younger" not in r.text and '"p_a"' not in r.text

@pytest.mark.parametrize("state", ["locked_by_clock", "live", "finished"])
def test_locked_bouts_carry_the_call_for_everyone(client, monkeypatch, state):
    m = c.get(f"/api/ufc/bouts/{bid}").json()["model"]
    assert m["model_version"] == "ufc-form-v0.2" and m["winner"] == "b" and m["method"] == "decision"
    assert abs(m["p_a"] + m["p_b"] - 1) < 1e-9

@pytest.mark.parametrize("kind", ["cancelled", "placeholder"])
def test_cancelled_and_placeholder_bouts_never_carry_a_call(client, monkeypatch, kind): ...
    # cancelled after its time, or "Opponent TBA" on a live bout → model None

def test_list_and_fighter_endpoints_never_carry_model_fields(client, monkeypatch):
    for path in ("/api/ufc/events?when=upcoming", "/api/ufc/events?when=past", f"/api/ufc/fighters/{slug}"):
        assert not _keys(c.get(path).json()) & {"model", "p_a", "p_b", "method_probs", "reasons"}

def test_rating_reason_is_reworded():
    assert reword_reason("Jiří Procházka is rated higher, 1560 to 1500.") == \
        "Jiří Procházka is ahead on FinalWhistle's own fighter rating, 1560 to 1500."
    assert reword_reason("Shara Magomedov is five years younger.") == "Shara Magomedov is five years younger."

def test_card_query_count_grows_by_at_most_one_with_calls(client, monkeypatch):
    # same card served with setting "" and set; count statements with the engine "before_cursor_execute" listener
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_model.py backend/tests/test_ufc_api.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail.
- [ ] **Step 3: Implement** the module and wire the three endpoints. Update `ufc.py`'s docstring: model fields appear only through `ufc_model.public_calls`.
- [ ] **Step 4: Run** the same command — expected: all pass (the phase-3 tests unchanged).
- [ ] **Step 5: Commit** `feat(ufc): the model's call, served only once a fight is locked and a public model is set`.

### Task 4: Submitting a pick

**Files:**
- Create: `backend/app/api/ufc_picks.py`
- Modify: `backend/app/schemas/__init__.py` (`UfcPickSubmitIn`, `UfcPickOut`, `UfcPickSubmitOut`), `backend/app/main.py` (import and `include_router(ufc_picks.router)` after `ufc`; no-store rule), `backend/app/api/nrl_user_tips.py` (`claim_device_tips`: a third reassign/dedupe loop)
- Test: `backend/tests/test_ufc_picks_api.py` (create)

**Interfaces:**
- Consumes: `pick_block`, `PICK_METHODS`, `score_pick`, `utc` (Task 2); `calls_for`, `call_is_public` (Tasks 2–3); from `app.api.league_score_predictions` (imported, not copied): `_DEVICE_ID_RE`, `_player_for_submit`, `_player_for_read`; `_email_action_rate_limited` (`app.api.auth`); `require_same_origin`, `client_ip`, `hash_ip` (`app.security`); `get_current_user_optional` (`app.auth`).
- Produces:

```python
router = APIRouter(prefix="/api/ufc/picks", tags=["ufc-picks"])
DISCLAIMER = "For analytics and entertainment only. Not betting advice."
SUBMIT_ACTION = "ufc_pick_submit"; SUBMIT_MAX = 120; SUBMIT_WINDOW_MIN = 60
def _now() -> datetime                                   # datetime.now(timezone.utc); the tests' clock seam
def pick_out(pick: UfcPick, bout: UfcBout) -> UfcPickOut  # used by Tasks 5 and 7

class UfcPickSubmitIn(BaseModel): device_id: str; bout_id: int; winner: str; method: str | None = None
class UfcPickOut(BaseModel):
    winner: Literal["a", "b"]; method: Literal["ko_tko", "submission", "decision"] | None
    created_at: datetime
    state: Literal["pending", "graded", "void"]
    points: int | None; winner_correct: bool | None; method_correct: bool | None
class UfcPickSubmitOut(BaseModel):
    ok: bool; handle: str; bout_id: int; pick: UfcPickOut; model: UfcModelCallOut | None; disclaimer: str

POST /api/ufc/picks/submit   (dependencies=[Depends(require_same_origin)])
```

Rules (in this order, mirroring `league_score_predictions.submit_prediction`):
1. `device_id` fails `_DEVICE_ID_RE` → 422 `invalid_device_id`, `"device_id must be a UUID v4."`
2. `winner` not in `("a", "b")` or `method` not in `PICK_METHODS` (a missing method included) → 422 `bad_pick`, `"Pick a winner and how they win: KO/TKO, submission or decision."`
3. Rate limit: `_email_action_rate_limited(db, SUBMIT_ACTION, device_id, ip_hash, SUBMIT_MAX, SUBMIT_WINDOW_MIN)` → 429 `too_many_attempts`, `"Too many attempts. Try again later."`; otherwise record an `EmailActionAttempt` and commit before any later check.
4. Bout missing, or its event is not `is_card` → 404 `bout_not_found`, `"No UFC fight with that id"`.
5. `pick_block(bout, event, name_a, name_b, _now())` → its status, code and message.
6. Player: `_player_for_submit(db, device_id, user)`. An existing `(bout, player)` pick → 409 `pick_finalized`, `"Your pick for this fight is already locked in."`; the stored pick is never changed.
7. Insert with `created_at = updated_at = _now()`; an `IntegrityError` on commit (a racing first pick) → rollback, 409 `pick_finalized`.
8. Response: the pick (`state "pending"`) and `model`: the bout's entry in `calls_for(db, [bout])` (the player has just picked, so it is theirs to see), else None.
- `pick_out`: `state` is `"void"` when `score_pick(...)` says void (live, from the bout's current status, whether or not the grader ran), `"graded"` when `graded_at` is set and `points` is not None, else `"pending"`; `points`/`*_correct` from the stored columns (None unless graded).
- `main.py`: add `_UFC_PICKS_NO_STORE_RE = re.compile(r"^/api/ufc/picks/(submit|mine|summary)$")` to the no-store chain (next to `_LEAGUE_TIPS_NO_STORE_RE`). `/api/ufc/picks/leaderboard` stays on the public 60-second path.
- `claim_device_tips`: after the league-predictions loop and before `db.delete(device_player)`, the same reassign/dedupe shape over `UfcPick` keyed by `bout_id` (the account's own pick wins; the device's duplicate is deleted). No table-existence guard: `ufc_picks` has been in production since phase 1. Not counted in `claimed_tips`.
- Account deletion needs no change: football keeps `tip_players` rows (generated handle, no personal field) when `delete_account` anonymises the user; UFC picks hang off the same row. The test below pins that deletion still succeeds with UFC picks present.

- [ ] **Step 1: Write the failing tests** in `backend/tests/test_ufc_picks_api.py`. Copy `test_league_score_predictions_api.py`'s `client` fixture (Origin header `http://localhost:3000`) and `DEVICE_A`/`DEVICE_B`; seed a card with `_fighter/_event/_bout` like `test_ufc_api.py`. Freeze the clock with `monkeypatch.setattr(ufc_picks, "_now", lambda: NOW)`.

```python
def _submit(c, bout_id, winner="b", method="decision", device=DEVICE_A, **extra):
    return c.post("/api/ufc/picks/submit", json={"device_id": device, "bout_id": bout_id, "winner": winner, "method": method, **extra})

def test_submit_open_bout_saves_and_returns_the_pick(client):
    body = _submit(c, bid).json()
    assert body["pick"] == {"winner": "b", "method": "decision", "created_at": ANY, "state": "pending",
                            "points": None, "winner_correct": None, "method_correct": None}
    assert body["model"] is None and body["handle"] and body["disclaimer"] == DISCLAIMER

def test_submit_reveals_the_counting_call_to_the_picker(client, monkeypatch):   # setting set, row before lock → model.winner "b"

def test_submit_at_or_after_lock_is_refused(client, monkeypatch):
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK)
    r = _submit(c, bid); assert (r.status_code, r.json()["error"]["code"]) == (422, "fight_locked")
    monkeypatch.setattr(ufc_picks, "_now", lambda: LOCK - timedelta(seconds=1)); assert _submit(c, bid).status_code == 200

def test_a_client_supplied_time_is_ignored(client, monkeypatch):     # _now = LOCK; extra field submitted_at = LOCK - 1h → still 422

@pytest.mark.parametrize("state,code", [("live", "fight_locked"), ("finished", "fight_locked"), ("feed_live_early", "fight_locked"),
    ("no_time", "fight_locked"), ("cancelled", "fight_cancelled"), ("event_cancelled", "fight_cancelled"),
    ("changed", "fight_changed"), ("tba", "opponent_tba"), ("opponent_tba", "opponent_tba")])
def test_submit_refused_for_every_closed_state(client, state, code):
    r = _submit(c, bid); assert (r.status_code, r.json()["error"]["code"]) == (422, code)
    assert db.query(UfcPick).count() == 0

@pytest.mark.parametrize("kind", ["missing", "contender_series"])
def test_unknown_or_non_card_bout_is_404(client, kind): ...           # error.code "bout_not_found"

def test_second_pick_is_refused_and_the_first_stays(client):
    _submit(c, bid, "b", "decision"); r = _submit(c, bid, "a", "ko_tko")
    assert (r.status_code, r.json()["error"]["code"]) == (409, "pick_finalized")
    p = db.query(UfcPick).one(); assert (p.winner, p.method) == ("b", "decision")

def test_concurrent_first_pick_keeps_the_first(client, monkeypatch):
    # first submit succeeds; then force ufc_picks._find_pick to return None → insert hits the unique key → 409, row unchanged

@pytest.mark.parametrize("winner,method", [("c", "decision"), ("", "decision"), ("a", None), ("a", "dq"), ("a", "draw"),
                                           ("a", "no_contest"), ("a", "other"), ("a", "KO")])
def test_bad_pick_rejected(client, winner, method): ...                # 422 bad_pick, nothing stored

def test_invalid_device_id_rejected(client): ...                       # 422 invalid_device_id
def test_submit_is_rate_limited(client):                                # 120 refused attempts (locked bout), the 121st → 429
def test_submit_requires_the_site_origin(client):                       # TestClient without Origin → 403 forbidden_origin
def test_signed_in_second_device_writes_to_the_accounts_player(client): # mirror test_signed_in_second_device_reads_and_writes_the_accounts_picks
def test_claim_moves_ufc_picks_to_the_account(client):                  # device picks, register, POST /api/nrl/tips/claim → pick.player_id is the account's
def test_claim_merge_keeps_the_accounts_pick_and_drops_the_device_duplicate(client):
    # account player picked bout 1 "a"; device row picked bout 1 "b" and bout 2 → claim 200; bout 1 stays "a",
    # bout 2 moved to the account, the device TipPlayer row is gone, no IntegrityError
def test_delete_account_keeps_ufc_picks_under_the_generated_handle(client):
    # register, pick, POST /api/auth/delete-account → 200; the pick and its TipPlayer remain; the handle is unchanged
def test_submit_is_never_cached(client): assert _submit(c, bid).headers["cache-control"] == "no-store"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_picks_api.py -p no:cacheprovider -o addopts="" -q` — expected: fail (router missing).
- [ ] **Step 3: Implement** the router, schemas, `main.py` wiring and the claim loop. Split `_find_pick(db, bout_id, player_id)` out (as football's `_find_prediction`) so the race test can force it.
- [ ] **Step 4: Run** the new file plus `backend/tests/test_league_score_predictions_api.py backend/tests/test_nrl_user_tips_api.py backend/tests/test_auth_api.py backend/tests/test_cache.py` — expected: all pass.
- [ ] **Step 5: Commit** `feat(ufc): lock in a pick — winner and method, first pick final, server clock`.

### Task 5: My picks for a card, and my cards

**Files:**
- Modify: `backend/app/api/ufc_picks.py`, `backend/app/schemas/__init__.py`
- Test: `backend/tests/test_ufc_picks_api.py`

**Interfaces:**
- Consumes: `pick_out`, `_now` (Task 4); `calls_for`, `call_is_public` (Tasks 2–3); `lock_time`, `score_pick`; `public_card` (`app/api/ufc.py`); `_player_for_read`.
- Produces:

```python
class UfcMyBoutOut(BaseModel):
    bout_id: int; status: str; fighter_a: str; fighter_b: str      # full names
    locks_at: datetime | None                                     # lock_time(bout)
    picks_open: bool                                              # pick_block(...) is None at _now()
    pick: UfcPickOut | None
    model: UfcModelCallOut | None
class UfcChangedPickOut(BaseModel):
    bout_id: int; fighter_a: str; fighter_b: str; pick: UfcPickOut; replaced_by_id: int | None
class UfcPicksTotalsOut(BaseModel): picked: int; graded: int; points: int; winner_method: int
class UfcMyPicksOut(BaseModel):
    event: UfcEventRefOut; handle: str | None; bouts: list[UfcMyBoutOut]
    changed_picks: list[UfcChangedPickOut]; totals: UfcPicksTotalsOut; disclaimer: str
class UfcPicksCardOut(BaseModel):
    slug: str; name: str; first_bout_utc: datetime | None; picked: int; graded: int; points: int; winner_method: int
class UfcPicksSummaryOut(BaseModel):
    handle: str | None; cards: list[UfcPicksCardOut]; totals: UfcPicksTotalsOut   # totals.picked counts every pick

GET /api/ufc/picks/mine?device_id=&event=      (event: the card slug, required, SLUG_PATTERN)
GET /api/ufc/picks/summary?device_id=
```

Rules:
- Both validate `device_id` (422 `invalid_device_id`). `mine` with an unknown or non-card slug → 404 `not_found`, `"No UFC card with that name"`.
- `mine.bouts`: every bout of the card except `changed`, ordered by `locks_at` ascending (None last), then `card_order` (None last), then id. That order is "the next fight to pick".
- `model` per bout: the bout's entry in `calls_for` when `call_is_public(...)` is true, or when this player has a pick on it and the bout is not `cancelled`/`changed` and has no placeholder; else None. Never another player's pick, count or share.
- `changed_picks`: this player's picks on the card's `changed` bouts, `replaced_by_id` followed to the newest revision (at most 5 hops; stop at a missing link), names from that old row.
- `totals` (mine, this card) and `summary` count the player's picks: `picked` all, `graded` those with state `graded`, `points` their sum, `winner_method` those with 5 points. `summary.cards`: cards where the player has at least one pick (changed ones included), newest `first_bout_utc` first; one statement for the picks joined to bouts and events.
- No player for this device (or the account) → `handle: None`, every `pick: None`, `changed_picks: []`, zero totals; `mine` still lists the card with public calls only.

- [ ] **Step 1: Write the failing tests.**

```python
def test_mine_without_a_player_lists_the_card_with_no_picks(client): ...   # handle None, picks None, picks_open True on open bouts

def test_mine_hides_the_call_on_an_open_bout_until_this_player_picks(client, monkeypatch):
    # public model set; open bouts 1 and 2 with counting rows; DEVICE_A picks bout 1
    a = _mine(c, DEVICE_A); b = _mine(c, DEVICE_B)
    assert _bout(a, 1)["model"]["winner"] == "b" and _bout(a, 2)["model"] is None
    assert _bout(b, 1)["model"] is None and _bout(b, 1)["pick"] is None          # never A's pick

def test_mine_shows_the_call_on_locked_bouts_to_everyone(client, monkeypatch): ...
def test_mine_marks_void_and_graded_picks(client):
    # pick on a cancelled bout → state "void"; on a finished draw → "void"; a graded 5 → "graded", points 5; totals (picked 3, graded 1, points 5, winner_method 1)
def test_mine_lists_a_pick_on_a_changed_bout_with_its_current_replacement(client):
    # b1 changed → b2 changed → b3 scheduled; pick on b1 → changed_picks == [{bout_id: b1, fighter_a, fighter_b, pick, replaced_by_id: b3}]
    # b1 not in bouts; b3 in bouts with pick None and picks_open True
def test_mine_reports_the_server_lock(client, monkeypatch):
    # placeholder bout → picks_open False; bout past lock → False; locks_at == lock_time ISO
def test_mine_validates_device_and_card(client): ...                        # 422 invalid_device_id; 404 not_found
def test_summary_zero_state(client): ...                                    # handle None, cards [], zero totals
def test_summary_totals_per_card_newest_first(client): ...
def test_signed_in_mine_reads_the_accounts_picks_from_a_second_device(client): ...
def test_mine_and_summary_are_never_cached(client): ...                     # Cache-Control: no-store on both
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_picks_api.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail.
- [ ] **Step 3: Implement** both endpoints. A card response is a fixed number of queries (event, bouts, fighters, this player's picks, counting predictions).
- [ ] **Step 4: Run** the same command — expected: all pass.
- [ ] **Step 5: Commit** `feat(ufc): my picks for a card and across cards, with the call only where it may be seen`.

### Task 6: Grading picks

**Files:**
- Create: `pipeline/sports/ufc_picks.py`
- Modify: `.github/workflows/ufc-refresh.yml` (one step after "Predict and grade UFC bouts")
- Test: `pipeline/sports/ufc_picks_test.py` (create)

**Interfaces:**
- Consumes: `score_pick`, `lock_time`, `utc` (Task 2); `RECONCILE_DAYS` (`pipeline/sports/ufc_predict.py`, 30); `UfcPick`, `UfcBout`.
- Produces:

```python
@dataclass
class PickGradeSummary:
    written: int = 0      # rows given a new or changed grade
    voided: int = 0       # of those, void
    reset: int = 0        # grades removed because the bout is no longer settled
    late: int = 0         # picks never graded: stamped after the lock, or no lock
def grade_picks(db: Session, now: datetime | None = None) -> PickGradeSummary
def main(argv: list[str] | None = None) -> int          # --grade; exit 1 only when grading raised
```

Rules:
- Settled bouts: `finished`, `cancelled`, `changed`. A pick is considered when its bout is settled and either it has never been graded, or the bout's `scheduled_utc` is within `RECONCILE_DAYS` of `now`. A graded pick whose bout is no longer settled (a reinstated cancelled bout) and within the window is reset: `points`, `winner_correct`, `method_correct`, `graded_at` back to NULL.
- Eligibility, as football's grader: `lock_time(bout)` set and `utc(pick.updated_at) <= lock_time(bout)`; otherwise skipped and counted in `late`, never scored zero.
- Write only when `(points, winner_correct, method_correct)` differ from what is stored or `graded_at` is NULL; then set `graded_at = now`. A void grade stores NULL points and NULL correctness with `graded_at` set. A second run with nothing changed writes nothing.
- One `begin_nested()` per bout so one bad row never stops the rest; commit once at the end. Log one line of counts.
- Workflow step, after the predict step, without `continue-on-error` (a grading failure should turn the run red):

```yaml
      - name: Grade UFC picks (idempotent)
        timeout-minutes: 5
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          PYTHONPATH: backend:.
        run: python -m pipeline.sports.ufc_picks --grade
```

- [ ] **Step 1: Write the failing tests** (`db_session` fixture; seed a card, three players and picks with `updated_at` before the lock).

```python
def test_grades_a_finished_bout_once(db_session):
    # result b by decision; picks (b, decision), (b, ko_tko), (a, decision)
    s = grade_picks(db_session, now=NOW); assert (s.written, s.voided) == (3, 0)
    assert [p.points for p in picks()] == [5, 2, 0]
    stamped = [p.graded_at for p in picks()]
    assert grade_picks(db_session, now=NOW + timedelta(hours=12)).written == 0 and [p.graded_at for p in picks()] == stamped

@pytest.mark.parametrize("case", ["draw", "no_contest", "cancelled", "changed"])
def test_voids_draw_no_contest_cancelled_and_changed(db_session, case):
    s = grade_picks(db_session, now=NOW); p = picks()[0]
    assert (p.points, p.winner_correct, p.method_correct, p.graded_at is not None) == (None, None, None, True) and s.voided == 1

def test_a_pick_stamped_after_the_lock_is_never_graded(db_session): ...    # updated_at = lock + 1s → all NULL, late == 1
def test_an_overturned_result_is_regraded(db_session):
    # graded with winner b; bout.winner = "a", method "submission" → next run written 1, points follow
def test_a_result_turned_no_contest_voids_the_grade(db_session): ...
def test_a_reinstated_bout_resets_its_void_grade(db_session): ...          # cancelled → void → status "scheduled" → reset 1, graded_at None
def test_a_result_outside_the_reconcile_window_is_left_alone(db_session): ...   # scheduled 31 days before now, graded; flip winner → unchanged
def test_an_old_ungraded_pick_is_still_graded(db_session): ...             # bout 60 days ago, never graded → graded
def test_logs_carry_counts_only(db_session, caplog): ...                   # no fighter name, handle or device id in caplog.text
def test_main_exit_codes(monkeypatch): ...                                 # success → 0; grade_picks raising → 1
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_picks_test.py -p no:cacheprovider -o addopts="" -q` — expected: fail (module missing).
- [ ] **Step 3: Implement** the module and the workflow step.
- [ ] **Step 4: Run** the same command and `.venv/bin/python -m pytest pipeline/sports -k ufc -p no:cacheprovider -o addopts="" -q` — expected: all pass.
- [ ] **Step 5: Commit** `feat(ufc): grade picks after each card, once, and again when a result changes`.

### Task 7: The leaderboard

**Files:**
- Modify: `backend/app/api/ufc_picks.py`, `backend/app/schemas/__init__.py`
- Test: `backend/tests/test_ufc_picks_api.py`

**Interfaces:**
- Consumes: `score_pick`, `model_pick`, `lock_time` (Task 2); `public_version`, `counting_predictions` (Task 3); `public_card`.
- Produces:

```python
MODEL_HANDLE = "FinalWhistle model"        # football's _MODEL_HANDLE
class UfcLeaderboardEntryOut(BaseModel):
    rank: int; handle: str; points: int; winner_method: int; graded: int; is_model: bool
class UfcLeaderboardOut(BaseModel):
    scope: Literal["card", "year"]; event: UfcEventRefOut | None; year: int | None
    participant_count: int; entries: list[UfcLeaderboardEntryOut]

GET /api/ufc/picks/leaderboard?event=<slug> | ?year=<YYYY>
```

Rules:
- Exactly one of `event` and `year`, else 422 `bad_scope`, `"Ask for one card or one year."`; `year` outside 2020–2100 → 422 `bad_scope`; unknown or non-card slug → 404 `not_found`.
- Scope: a card's bouts, or every card bout whose event's `first_bout_utc` falls in that UTC calendar year.
- Players: only picks with `graded_at` set and `points` not NULL count; a player appears with at least one such pick. `points` is the sum, `winner_method` the count of 5s, `graded` the count. `participant_count` counts players only.
- The model's row (only when `public_version()` is set): it plays every bout in scope that is `finished`, has a counting prediction, has `model_pick` winner not None, and has no eligible player pick still ungraded (football's `_awaiting_grading` rule: eligible = `updated_at <= lock`). Each such bout is scored with `score_pick(winner, method, bout)`; void bouts are skipped. The row appears only when it scored at least one bout.
- Order: points desc, `winner_method` desc, players before the model on a full tie, handle asc, then player id asc (handles are not unique). `rank` is the 1-based position.
- Never returns a device id, a player id, or any per-fight pick.

- [ ] **Step 1: Write the failing tests.**

```python
def test_card_board_lists_only_players_with_a_graded_pick(client): ...     # ungraded-only and void-only players absent; participant_count matches
def test_ties_break_by_winner_and_method_then_handle_then_age(client):
    # P1 5+0 (one 5), P2 2+2+... equal points without a 5 → P1 first; two players named "SwiftStriker7" with equal scores → older id first
def test_year_board_uses_the_cards_utc_year(client): ...                   # card at 2026-12-31T23:00Z in 2026; 2027-01-01T01:00Z in 2027
@pytest.mark.parametrize("params", [{}, {"event": E, "year": 2026}, {"year": 1999}])
def test_scope_is_one_card_or_one_year(client, params): ...                # 422 bad_scope; unknown slug → 404
def test_no_model_row_without_a_public_model(client): ...
def test_model_row_scores_settled_bouts_with_a_counting_call(client, monkeypatch):
    # bout 1 finished, graded, model right with method → 5; bout 2 finished with an eligible ungraded pick → skipped;
    # bout 3 call created after lock → skipped; bout 4 p_a 0.5 → skipped
    assert model_row["points"] == 5 and model_row["graded"] == 1
def test_model_row_ranks_below_a_tied_player(client, monkeypatch): ...
def test_board_never_exposes_devices_or_picks(client): ...                 # _keys has none of device_id, player_id, winner, method, bout_id
def test_leaderboard_is_publicly_cacheable(client): ...                    # "public, max-age=60, stale-while-revalidate=300"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest backend/tests/test_ufc_picks_api.py -p no:cacheprovider -o addopts="" -q` — expected: the new tests fail.
- [ ] **Step 3: Implement.** One statement for the players' graded picks in scope; the model's side reuses `counting_predictions`.
- [ ] **Step 4: Run** the full Python suite `.venv/bin/python -m pytest -p no:cacheprovider -o addopts="" -q` — expected: no failures. This closes the backend pull request (Tasks 1–7).
- [ ] **Step 5: Commit** `feat(ufc): per-card and per-year leaderboards from graded picks`.

---

### Task 8: Frontend plumbing — types, fetchers, the picks context, navigation

**Files:**
- Modify: `frontend/lib/ufcTypes.ts`, `frontend/lib/api.ts` (one server fetcher), `frontend/lib/sports.ts` (UFC entry, `competitionLinks`, `buildNavTabs`), `frontend/lib/reveal.ts` (one mapping)
- Create: `frontend/lib/ufcPicks.ts`, `frontend/components/ufc/UfcPicksProvider.tsx`
- Test: `frontend/lib/ufcPicks.test.ts`, `frontend/components/ufc/UfcPicksProvider.test.tsx`, `frontend/lib/reveal.test.ts`, `frontend/lib/ufcFetchers.test.ts`, `frontend/components/__tests__/bottomNav.test.tsx`, `frontend/components/__tests__/siteSearch.test.tsx`

**Interfaces:**
- Consumes: the API shapes of Tasks 3–7; `request`, `ApiError`, `getOrCreateDeviceId` (`lib/session.ts`); `useTipsIdentityVersion` (`components/play/tipsIdentity.ts`); `reportViewerHandle` (`components/play/viewerHandle.ts`); `isTba`, `localTime` (`lib/ufcDisplay.ts`); `kickoffTimeLower`, `kickoffDate`, `relativeDayLabel`, `tzAbbrev`.
- Produces:

```ts
// lib/ufcTypes.ts (mirrors the backend; `model?` optional so an older API still type-checks)
export type UfcPickMethod = "ko_tko" | "submission" | "decision";
export interface UfcModelCall { model_version: string; winner: "a" | "b" | null; p_a: number; p_b: number;
  method: UfcPickMethod | null; method_probs: Record<UfcPickMethod, number> | null; reasons: string[]; }
// UfcBoutSummary gains: model?: UfcModelCall | null
export interface UfcPick { winner: "a" | "b"; method: UfcPickMethod | null; created_at: string;
  state: "pending" | "graded" | "void"; points: number | null; winner_correct: boolean | null; method_correct: boolean | null; }
export interface UfcMyBout { bout_id: number; status: UfcBoutStatus; fighter_a: string; fighter_b: string;
  locks_at: string | null; picks_open: boolean; pick: UfcPick | null; model: UfcModelCall | null; }
export interface UfcChangedPick { bout_id: number; fighter_a: string; fighter_b: string; pick: UfcPick; replaced_by_id: number | null; }
export interface UfcPicksTotals { picked: number; graded: number; points: number; winner_method: number; }
export interface UfcMyPicksResponse { event: { slug: string; name: string; first_bout_utc: string | null }; handle: string | null;
  bouts: UfcMyBout[]; changed_picks: UfcChangedPick[]; totals: UfcPicksTotals; disclaimer: string; }
export interface UfcPickSubmitResponse { ok: true; handle: string; bout_id: number; pick: UfcPick; model: UfcModelCall | null; disclaimer: string; }
export interface UfcPicksSummaryResponse { handle: string | null; cards: (UfcPicksTotals & { slug: string; name: string; first_bout_utc: string | null })[]; totals: UfcPicksTotals; }
export interface UfcLeaderboardEntry { rank: number; handle: string; points: number; winner_method: number; graded: number; is_model: boolean; }
export interface UfcLeaderboardResponse { scope: "card" | "year"; event: { slug: string; name: string; first_bout_utc: string | null } | null;
  year: number | null; participant_count: number; entries: UfcLeaderboardEntry[]; }

// lib/ufcPicks.ts
export const UFC_PICK_METHODS: readonly UfcPickMethod[];             // ["ko_tko", "submission", "decision"]
export const UFC_SCORING = "Winner and method 5 points, winner 2.";
export const UFC_PICK_RULES = "Winner and method 5 points, winner 2. A locked pick is final.";
export function methodLabel(m: UfcPickMethod): "KO/TKO" | "Submission" | "Decision"     // control labels
export function methodWord(m: UfcPickMethod): "KO/TKO" | "submission" | "decision"     // in sentences
export function lockInLabel(name: string, m: UfcPickMethod): string     // "Lock in Shara Magomedov by decision"
export function pickedName(bout: { fighter_a: { name: string } | string; fighter_b: { name: string } | string }, side: "a" | "b"): string
export function pickLine(bout, pick): string                            // "You: Shara Magomedov, decision" (no method → "You: Shara Magomedov")
export function modelLine(bout, call: UfcModelCall): string             // "Model: Shara Magomedov 54%" | "Model: too close to call"
export function agreementLine(bout, pick, call: UfcModelCall | null): string | null
export function pickOpenByClock(bout: UfcBoutSummary, now: Date): boolean   // scheduled, time set, now < time, no isTba side
export function pickLockLine(lockIso: string, tz: string, now: Date): string
export function pickVerdict(pick: UfcPick): { label: string; tone: ChipTone | undefined } | null
export function modelVerdict(bout: UfcBoutSummary, call: UfcModelCall): { label: string; tone: ChipTone | undefined } | null
export const submitUfcPick: (body: { device_id: string; bout_id: number; winner: "a" | "b"; method: UfcPickMethod }) => Promise<UfcPickSubmitResponse>;
export const getMyUfcPicks: (device_id: string, event: string) => Promise<UfcMyPicksResponse>;
export const getUfcPicksSummary: (device_id: string) => Promise<UfcPicksSummaryResponse>;

// lib/api.ts
export const getUfcLeaderboardServer: (scope: { event: string } | { year: number }) => Promise<UfcLeaderboardResponse | null>;  // revalidate 60, [422]

// components/ufc/UfcPicksProvider.tsx ("use client")
export interface UfcPicksState {
  status: "loading" | "ready" | "error" | "no-device";
  deviceId: string | null; data: UfcMyPicksResponse | null;
  myBout(boutId: number): UfcMyBout | undefined;
  retry(): void;
  applySubmitted(res: UfcPickSubmitResponse): void;    // sets that bout's pick and model, no refetch
}
export function UfcPicksProvider({ eventSlug, children }: { eventSlug: string; children: ReactNode }): JSX.Element
export function useUfcPicks(): UfcPicksState | null     // null outside a provider
```

Copy (exact):
- `agreementLine`, with N the model's fighter and M `methodWord(call.method)`: no call or `call.winner` null → null; same winner and method → `The model agrees: N by M.`; same winner, other method → `The model also picks N, by M.`; same winner, no model method → `The model also picks N.`; other winner → `The model picks N by M.` (no method: `The model picks N.`).
- `modelLine`: `Model: N P%` with P = `Math.round(100 * max(p_a, p_b))`; winner null → `Model: too close to call`.
- `pickLockLine`: today in the viewer's zone → `Picks close at 6:00 pm GMT`; otherwise `Picks close Sat 5 Dec, 6:00 pm GMT` (`kickoffDate`, `kickoffTimeLower`, `tzAbbrev`).
- `pickVerdict`: graded 5 → `Winner and method · 5 points` (`good`); graded 2 → `Winner · 2 points` (`ok`); graded 0 → `Missed · 0 points` (`miss`); void → `Void · no points` (no tone); pending → null. `modelVerdict` gives the same labels for the model's call on a finished fight, scored with the Task 2 rule (dq/other: winner only; draw/no contest: void); null before the result.

Rules:
- `UfcPicksProvider`: one `getMyUfcPicks` per mount, again on `retry()` and on every `useTipsIdentityVersion()` bump; device id from `getOrCreateDeviceId()` after mount (null → `no-device`); reports `data.handle` and `res.handle` to `reportViewerHandle`. The first render (server and hydration) is `loading` with no data, so an open fight never renders a model call in HTML.
- `sports.ts`, UFC only: `hasTips: true`; `competitionLinks("ufc")` → `picks: "/ufc/picks"`, `picksLabel: "My picks"`, `leaderboard: "/ufc/leaderboard"`; `buildNavTabs("ufc")` → Card, Events, then `{ id: "mypicks", label: "My picks", href: "/ufc/picks", activePrefixes: ["/ufc/picks"] }`, `{ id: "leaderboard", label: "Leaderboard", href: "/ufc/leaderboard", activePrefixes: ["/ufc/leaderboard"] }`. Update the UFC comment blocks there.
- `reveal.ts`: `PickGame` gains `"ufc_picks"`; `pickGameFor("ufc")` returns it, so a generic public surface (`canRevealModelPublicly`) hides by default. If a `switch` over `PickGame` is exhaustive, add a `ufc_picks` branch that behaves as "hidden" (UFC screens never use `useModelReveal`).

- [ ] **Step 1: Write the failing tests.**

```ts
// lib/ufcPicks.test.ts
const BOUT = /* fixtures.testutil: Israel Adesanya (a) v Shara Magomedov (b) */;
it("words the lock button and the pick line with full names", () => {
  expect(lockInLabel("Shara Magomedov", "decision")).toBe("Lock in Shara Magomedov by decision");
  expect(lockInLabel("Israel Adesanya", "ko_tko")).toBe("Lock in Israel Adesanya by KO/TKO");
  expect(pickLine(BOUT, { winner: "b", method: "decision" })).toBe("You: Shara Magomedov, decision");
});
it("says how the model's call compares", () => {
  expect(agreementLine(BOUT, PICK_B_DEC, CALL_B_DEC)).toBe("The model agrees: Shara Magomedov by decision.");
  expect(agreementLine(BOUT, PICK_B_KO, CALL_B_DEC)).toBe("The model also picks Shara Magomedov, by decision.");
  expect(agreementLine(BOUT, PICK_A_SUB, CALL_B_DEC)).toBe("The model picks Shara Magomedov by decision.");
  expect(agreementLine(BOUT, PICK_A_SUB, null)).toBeNull();
  expect(agreementLine(BOUT, PICK_A_SUB, { ...CALL_B_DEC, winner: null })).toBeNull();
});
it("prints the model line", () => { /* p_b 0.537 → "Model: Shara Magomedov 54%"; winner null → "Model: too close to call" */ });
it("prints the lock line in the viewer's zone", () => {
  expect(pickLockLine("2026-12-05T18:00:00Z", "Europe/London", new Date("2026-12-05T09:00:00Z"))).toBe("Picks close at 6:00 pm GMT");
  expect(pickLockLine("2026-12-05T18:00:00Z", "Australia/Sydney", new Date("2026-12-04T09:00:00Z"))).toBe("Picks close Sun 6 Dec, 5:00 am AEDT");
});
it("is open by the clock only before the start and with two named fighters", () => { /* -1s true; at start false; "Opponent TBA" false; cancelled false */ });
it("labels verdicts", () => { /* 5 → "Winner and method · 5 points" good; 2 → "Winner · 2 points"; 0 → "Missed · 0 points"; void → "Void · no points"; pending → null */ });
it("scores the model's call like a pick", () => { /* finished b decision vs call b decision → 5 label; dq → "Winner · 2 points"; draw → void; scheduled → null */ });
it("posts the pick and reads mine with the device id", async () => { /* fetch mock: POST /backend-api/api/ufc/picks/submit body; GET .../mine?device_id=…&event=… */ });

// components/ufc/UfcPicksProvider.test.tsx (mock @/lib/ufcPicks and @/lib/session)
it("starts loading, then serves this device's picks for the card", async () => { /* getMyUfcPicks(DEVICE, "slug") once */ });
it("says no-device when storage is blocked", () => { /* getOrCreateDeviceId → null */ });
it("refetches after a sign-in claim", async () => { /* act(() => announceTipsIdentityChanged()) → second call */ });
it("applies a submitted pick without a refetch", async () => { /* applySubmitted → myBout(id).pick and .model set; one call total */ });
it("reports the handle for the leaderboard", async () => { /* reportViewerHandle called with "SwiftStriker42" */ });

// lib/reveal.test.ts
it("gives UFC its own pick game and hides open UFC fights from public surfaces", () => {
  expect(pickGameFor("ufc")).toBe("ufc_picks");
  expect(canRevealModelPublicly("ufc", "scheduled", "2099-01-01T00:00:00Z")).toBe(false);
});
// bottomNav.test.tsx: UFC hrefs → ["/ufc", "/ufc/events", "/ufc/picks", "/ufc/leaderboard"]; "My picks" current on /ufc/picks
// siteSearch.test.tsx: UFC's own pages → Card, Events, My picks, Leaderboard
// ufcFetchers.test.ts: getUfcLeaderboardServer({ event: "x" }) requests "/api/ufc/picks/leaderboard?event=x" with revalidate 60; ({ year: 2026 }) → "?year=2026"; 404 → null
```

- [ ] **Step 2: Run** `cd frontend && npx jest lib/ufcPicks.test.ts components/ufc/UfcPicksProvider.test.tsx lib/reveal.test.ts lib/ufcFetchers.test.ts components/__tests__/bottomNav.test.tsx components/__tests__/siteSearch.test.tsx` — expected: the new and changed tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `lib components/__tests__ components/ufc` — expected: pass (football and NRL nav tests unchanged).
- [ ] **Step 5: Commit** `feat(ufc): picks plumbing — types, fetchers, a picks context, My picks and Leaderboard tabs`.

### Task 9: The pick on the fight page, and the model's call card

**Files:**
- Create: `frontend/components/ufc/BoutPick.tsx`, `frontend/components/ufc/UfcModelCallCard.tsx`
- Modify: `frontend/components/ufc/FightHero.tsx` (optional `children` rendered under the result line), `frontend/components/ufc/UfcFightView.tsx` (provider, pick, call card)
- Test: `frontend/components/ufc/BoutPick.test.tsx`, `frontend/components/ufc/UfcModelCallCard.test.tsx`, `frontend/components/ufc/UfcFightView.test.tsx`

**Interfaces:**
- Consumes: Task 8 (`useUfcPicks`, `submitUfcPick`, copy helpers); `useClock`/`useHydratedNow` (`components/match/clock.ts`); `useTimezone`; `Button`, `Segmented`, `CheckIcon`, `TextLink`, `Card`, `CardHead`, `Chip`, `Note` (`components/ui`); `boutHref`, `isTba` (`lib/ufcDisplay.ts`).
- Produces:

```tsx
export function BoutPick({ bout }: { bout: UfcBoutDetail }): JSX.Element | null       // section id="pick"
export function UfcModelCallCard({ bout, call }: { bout: UfcBoutSummary; call: UfcModelCall }): JSX.Element   // Card id="model-call"
// FightHero gains children?: ReactNode; UfcFightView wraps everything in <UfcPicksProvider eventSlug={bout.event.slug}>
```

Layout and copy (football's `LeagueScorePick` with UFC words; under a hairline inside the hero, `max-w-[550px]`, heading `Your pick`):
- Open, not picked: two fighter buttons side by side (full names, `aria-pressed`), then `Segmented label="How they win"` with `KO/TKO`, `Submission`, `Decision`, then the wide button: disabled `Pick a winner and how they win` until both are chosen, then `lockInLabel(...)`, `Locking in…` while pending. Under it: `pickLockLine(...)` then `UFC_PICK_RULES`.
- After a server-accepted pick: the pick in the fighter-button style (read-only) and a status line `Locked. {agreementLine}` or, with no call, `Locked. Points land when the fight ends.`; focus moves to that line; `applySubmitted` reveals the model card, which scrolls into view (`document.getElementById("model-call")?.scrollIntoView?.({ block: "nearest" })`). Then `Next: {A} v {B}` (wide button to `/ufc/fight/{id}#pick`, the first bout in `data.bouts` with `picks_open` and no pick, other than this one), else `All picked. See my picks` → `/ufc/picks`.
- Picked, then live: `Locked. Points land when the fight ends.`; finished: the pick and `pickVerdict` chip; cancelled: `Cancelled. This pick won't be scored.`
- Not picked and closed: live or finished → render nothing (the hero carries the state); scheduled past its lock → `Picks closed when this part of the card started. You didn't pick this one.`; cancelled → `This fight was cancelled.`
- Placeholder fighter: `Picks open once both fighters are confirmed.` and no controls.
- A changed pick pointing at this fight (`changed_picks[].replaced_by_id === bout.id`): above the controls, `Your pick on {A} v {B} doesn't count because the fight changed. Pick this one.`
- States: loading → the football skeleton blocks; no-device → `Picks need your browser's storage to remember you. Allow site data to play.`; error → `Picks are unavailable right now.` and `Retry`.
- Server answers: 409 `pick_finalized` → its message, controls gone for good, `retry()`; 422 `fight_locked` → `Picks for this fight have closed.`, controls gone; `opponent_tba`/`fight_cancelled`/`fight_changed` → their messages, controls gone; anything else → its message (or `Couldn't save your pick. Check your connection and try again.`), controls stay.
- Openness: `myBout.picks_open` (server, at fetch time) AND `pickOpenByClock(bout, now)` with `now` from the page clock, so a page left open closes itself at the start.
- `UfcModelCallCard`: `CardHead` `The model's call`; the model's fighter in the weight football uses for a team, with `{P}%`; `Most likely by {methodWord}.` when a method is set; reasons as a list; `Too close to call: 50% each.` when `winner` is null; after the result, `modelVerdict` chip; foot note `Made before picks closed.` Not rendered at all without a call (no empty card, no placeholder text).
- `UfcFightView`: the call is `myBout?.model ?? bout.model ?? null`; the card sits first in `Main`, above the tale of the tape.

- [ ] **Step 1: Write the failing tests** (mock `@/lib/ufcPicks` fetchers and `@/lib/session`; `pp:timezone` set to `Europe/London`; fixture bout 2026-12-05T18:00:00Z).

```tsx
it("keeps the lock button disabled until a winner and a method are chosen", async () => {
  expect(screen.getByRole("button", { name: "Pick a winner and how they win" })).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "Shara Magomedov" }));
  expect(screen.getByRole("button", { name: "Shara Magomedov" })).toHaveAttribute("aria-pressed", "true");
  await user.click(screen.getByRole("button", { name: "Decision" }));
  expect(screen.getByRole("button", { name: "Lock in Shara Magomedov by decision" })).toBeEnabled();
  expect(screen.getByText("Winner and method 5 points, winner 2. A locked pick is final.")).toBeInTheDocument();
  expect(screen.getByText("Picks close Sat 5 Dec, 6:00 pm GMT")).toBeInTheDocument();
});
it("submits once and shows the model's agreement", async () => {
  // submitUfcPick resolves with model winner b, method decision
  expect(submitUfcPick).toHaveBeenCalledWith({ device_id: DEVICE, bout_id: 7, winner: "b", method: "decision" });
  expect(await screen.findByRole("status")).toHaveTextContent("Locked. The model agrees: Shara Magomedov by decision.");
  expect(screen.getByRole("status")).toHaveFocus();
});
it("says nothing about a model when there is no call", async () => { /* model null → "Locked. Points land when the fight ends."; queryByText(/model/i) null */ });
it("shows the saved pick after a 409", async () => { /* ApiError(409, "pick_finalized", …) → message, no fighter buttons, getMyUfcPicks called again */ });
it("closes when the server says the fight is locked", async () => { /* ApiError(422, "fight_locked") → "Picks for this fight have closed.", no controls */ });
it("closes by the clock without a reload", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-12-05T17:59:40Z"));   // controls shown
  act(() => { jest.advanceTimersByTime(30_000); });
  expect(screen.getByText("Picks closed when this part of the card started. You didn't pick this one.")).toBeInTheDocument();
});
it("waits for both fighters", () => { /* fighter_b "Opponent TBA" → "Picks open once both fighters are confirmed.", no buttons */ });
it("explains a pick voided by a changed fight", () => { /* changed_picks replaced_by_id 7 → the exact notice */ });
it("offers the next open fight, else my picks", async () => { /* link "Next: Ian Machado Garry v Shavkat Rakhmonov" → "/ufc/fight/8#pick"; none left → "All picked. See my picks" → "/ufc/picks" */ });
it("asks for storage, and offers a retry on error", () => { ... });

// UfcModelCallCard.test.tsx
it("shows the model's fighter, chance, method and reasons", () => { /* "Shara Magomedov", "54%", "Most likely by decision.", two list items, id model-call */ });
it("says when it is too close to call", () => { /* "Too close to call: 50% each." */ });
it("grades the call after the result", () => { /* finished b decision → "Winner and method · 5 points" */ });

// UfcFightView.test.tsx
it("shows no model card and no gap without a call", () => { /* queryByRole("region", { name: "The model's call" }) null; no /model/i text outside the pick */ });
it("reveals the model card once the viewer locks a pick", async () => { /* card appears after submit */ });
it("shows the public call on a locked fight to a viewer who did not pick", () => { /* bout.model set, status live → card present */ });
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc/BoutPick.test.tsx components/ufc/UfcModelCallCard.test.tsx components/ufc/UfcFightView.test.tsx` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc/fight` — expected: pass, also with `TZ=UTC` and `TZ=America/Los_Angeles` prefixed.
- [ ] **Step 5: Commit** `feat(ufc): pick a winner and how they win on the fight page, then see the model's call`.

### Task 10: Pick status on the card

**Files:**
- Create: `frontend/components/ufc/BoutPickStatus.tsx`, `frontend/components/ufc/UfcPicksRailCard.tsx`
- Modify: `frontend/components/ufc/BoutRow.tsx` (optional `right?: ReactNode`; when given it replaces the default right slot), `frontend/components/ufc/UfcCardView.tsx` (provider, rows, notices, rail card)
- Test: `frontend/components/ufc/BoutPickStatus.test.tsx`, `frontend/components/ufc/UfcPicksRailCard.test.tsx`, `frontend/components/ufc/UfcCardView.test.tsx`, `frontend/components/ufc/BoutRow.test.tsx`

**Interfaces:**
- Consumes: Task 8; `GhostButton`, `Chip`, `Note`, `Card`, `CardHead`, `TextLink`, `Button` (`components/ui`); `useAuth` (`components/AuthProvider`); `boutHref`, `eventHref`.
- Produces:

```tsx
export function BoutPickStatus({ bout, now }: { bout: UfcBoutSummary; now: Date | null }): ReactNode   // undefined → BoutRow keeps its default
export function UfcPicksRailCard({ event }: { event: UfcEventDetail }): JSX.Element
// BoutRow: right?: ReactNode
```

Rules and copy (football's `RowAction`, UFC words):
- Picks still loading → nothing (no flash). Cancelled bout → undefined (the existing "Cancelled" chip stays).
- Open (server `picks_open` when known, else `pickOpenByClock`) and not picked → `GhostButton` `Pick winner`, href `${boutHref(id)}#pick`, `aria-label` `Pick the winner of {A} v {B}`.
- Picked → two muted lines: `pickLine` and, when a call is present, `modelLine`; after grading, the `pickVerdict` chip instead of the model line.
- Not picked and closed: scheduled past its lock → `Picks closed`; live or finished with a public call → `modelLine`; otherwise nothing. Placeholder → nothing.
- Above the first segment, one `Card pad` per changed pick: `Your pick on {A} v {B} doesn't count because the fight changed.` plus, when `replaced_by_id` is set, `TextLink` `Pick the new fight` → `/ufc/fight/{id}#pick`.
- `UfcPicksRailCard` (rail, above "Upcoming cards"), `CardHead` `Your picks`:
  - no picks yet → `Pick the winner of each fight, and how they win.` and `Winner and method 5 points, winner 2.`
  - some → `{picked} of {open+picked} fights picked.` (picked counts this card's picks; the denominator excludes cancelled fights and fights closed without a pick); when `totals.graded > 0`, `{points} points from {graded} scored fights.`; links `My picks` → `/ufc/picks` and `Leaderboard` → `/ufc/leaderboard?event={slug}`
  - signed out (`useAuth().user` null) → `A free account keeps your picks across devices.` and a `GhostButton` `Sign in` calling `openSignIn()`; signed in → nothing more
  - no-device → `Picks need your browser's storage to remember you. Allow site data to play.`

- [ ] **Step 1: Write the failing tests** (mock `@/components/AuthProvider` `useAuth` → `{ user: null, openSignIn }`; mock `@/lib/ufcPicks`; fixtures with a prelims segment at 15:00Z and a main card at 18:00Z).

```tsx
it("offers a pick on an open fight", () => { /* link name "Pick the winner of Israel Adesanya v Shara Magomedov", href "/ufc/fight/7#pick" */ });
it("shows the viewer's pick, and the model only when there is a call", () => {
  expect(screen.getByText("You: Shara Magomedov, decision")).toBeInTheDocument();
  expect(screen.queryByText(/^Model:/)).toBeNull();                     // production today: no call
});
it("locks each part of the card on its own", () => {
  jest.useFakeTimers().setSystemTime(new Date("2026-12-05T16:00:00Z"));
  expect(within(prelims).getAllByText("Picks closed")).toHaveLength(PRELIM_UNPICKED);
  expect(within(main).getAllByRole("link", { name: /^Pick the winner of/ })).toHaveLength(MAIN_UNPICKED);
});
it("offers no pick on a fight with a placeholder fighter", () => { ... });
it("shows the graded verdict", () => { /* "Winner and method · 5 points" */ });
it("shows a notice for a pick on a changed fight", () => { /* exact notice text; link "Pick the new fight" → "/ufc/fight/9#pick" */ });
it("keeps the cancelled chip", () => { ... });
// UfcPicksRailCard
it("explains the game with the exact scoring copy before any pick", () => { /* "Winner and method 5 points, winner 2." */ });
it("counts picks and points", () => { /* "2 of 14 fights picked." "5 points from 1 scored fights." links /ufc/picks and /ufc/leaderboard?event=… */ });
it("invites a signed-out player to sign in, and not a signed-in one", () => { /* Sign in click → openSignIn called; user set → no button */ });
// BoutRow
it("uses a given right slot and keeps the default without one", () => { ... });
```

- [ ] **Step 2: Run** `cd frontend && npx jest components/ufc` — expected: the new tests fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc components/ui` (also under `TZ=UTC` and `TZ=America/Los_Angeles`) — expected: pass; `components/ui/ui.test.tsx` unchanged and green.
- [ ] **Step 5: Commit** `feat(ufc): pick status on every fight of the card, and your picks in the rail`.

### Task 11: My picks — `/ufc/picks`

**Files:**
- Create: `frontend/app/ufc/picks/page.tsx`, `frontend/components/ufc/UfcMyPicksView.tsx` (client)
- Test: `frontend/app/ufc/picks/page.test.tsx`, `frontend/components/ufc/UfcMyPicksView.test.tsx`

**Interfaces:**
- Consumes: `getUfcNextEventServer` (`lib/api.ts`); Tasks 8 and 10 (`UfcPicksProvider`, `BoutRow` with `right`, `BoutPickStatus`, `getUfcPicksSummary`, `pickVerdict`); `useAuth`.
- Produces: `UfcMyPicksView({ event }: { event: UfcEventDetail })`; `page.tsx` exports only the page, `metadata` and `revalidate = 120`.

Layout and copy:
- `PageHead` eyebrow `UFC`, title `My picks`, sub `Playing as {handle}.` once known, else `Pick the winner of every fight on {event.name}, and how they win.`
- Main: a flush `Card` for the next card: band with `event.name` and a link `Open the card` → `eventHref(slug)`; every fight as `BoutRow` (`showTime` true) with `right={<BoutPickStatus …/>}`. With no pick on it yet, a `Note` `You have not picked any fights yet.` and `Button` `Pick the next card` → `eventHref(slug)`.
- Below, `Past cards` from `getUfcPicksSummary` (cards other than the current one): each row `TextLink` card name → `eventHref`, `{points} points · {graded} scored fights`, and `TextLink` `Leaderboard` → `/ufc/leaderboard?event={slug}`. Absent (not empty) when there is none.
- Rail: `How it works` → `Winner and method 5 points, winner 2.`, `A locked pick is final.`, `Picks close when that part of the card starts.`; the sign-in invite of Task 10 when signed out.
- Page states: next card missing (`null`) → `EmptyState` `No UFC cards yet` / `Picks open as soon as the next card is announced.` with `Button` `All cards` → `/ufc/events`; feed error → `EmptyState` `Picks are unavailable right now` / `We could not reach the fight feed. Try again in a minute.` with `Button` `All cards`.
- Metadata: title `My UFC picks — ${APP_NAME}`; description `Pick the winner of every fight on the next UFC card, and how they win. Winner and method 5 points, winner 2.`

- [ ] **Step 1: Write the failing tests.**

```tsx
it("lists the next card's fights with pick status", async () => { /* one "Pick the winner of …" link per open fight */ });
it("greets a new player and sends them to the card", async () => { /* no picks → "You have not picked any fights yet." + link "/ufc/event/<slug>" */ });
it("shows the handle once known", async () => { /* "Playing as SwiftStriker42." */ });
it("lists past cards with points, and omits the section when there are none", async () => { ... });
it("invites a signed-out player to sign in", () => { ... });
// page.test.tsx
it("shows the empty state when no card is loaded", async () => { /* getUfcNextEventServer → null */ });
it("shows the outage state when the feed fails", async () => { /* rejects → "Picks are unavailable right now" */ });
it("never says official and carries the scoring copy in its description", () => { ... });
```

- [ ] **Step 2: Run** `cd frontend && npx jest app/ufc/picks components/ufc/UfcMyPicksView.test.tsx` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): My picks — the next card in one list, and every card you played`.

### Task 12: Leaderboard — `/ufc/leaderboard`

**Files:**
- Create: `frontend/app/ufc/leaderboard/page.tsx`, `frontend/app/ufc/leaderboard/scope.ts`, `frontend/components/ufc/UfcLeaderboardView.tsx` (client)
- Test: `frontend/app/ufc/leaderboard/page.test.tsx`, `frontend/app/ufc/leaderboard/scope.test.ts`, `frontend/components/ufc/UfcLeaderboardView.test.tsx`

**Interfaces:**
- Consumes: `getUfcLeaderboardServer`, `getUfcNextEventServer`; `getUfcPicksSummary` (to learn the viewer's handle), `getOrCreateDeviceId`; `PlayerCell`, `rowClassName`, `isViewerRow` (`components/play/leaderboardRows.tsx`, read-only reuse); `useViewerHandle`; `Segmented`, `Card`, `EmptyState`, `PageHead`.
- Produces:

```ts
// scope.ts
export type UfcBoardScope = { kind: "card"; slug: string | null } | { kind: "year"; year: number };
export function parseBoardScope(sp: { event?: string | string[]; view?: string | string[]; year?: string | string[] }, now: Date): UfcBoardScope
    // view=year → that UTC year (or the current one); event must pass isEventSlug; otherwise card with slug null (the next card)
// UfcLeaderboardView({ board, scope, nextSlug }: { board: UfcLeaderboardResponse | null; scope: UfcBoardScope; nextSlug: string | null })
```

Layout and copy:
- `PageHead` eyebrow `UFC`, title `Leaderboard`, sub the card's name or `{year}`.
- `Segmented label="Show"`: `This card` → `/ufc/leaderboard?event={slug}` and `{year}` → `/ufc/leaderboard?view=year`, the current one marked.
- A table in a flush `Card`: rank, player (`PlayerCell`: `You` and `Model` tags), points, `Winner and method` (count). The viewer's row tinted by `rowClassName`. Above it, when the viewer is on the board: `You are {rank} of {participant_count}.`
- Empty: card → `No fights on this card have been scored yet. The board fills in as results come in.`; year → `No fights have been scored in {year} yet.`; both with `Button` `Pick the next card` → `/ufc`. Unknown card (board null) → `EmptyState` `That card is not on the leaderboard` with `Button` `Leaderboard` → `/ufc/leaderboard`.
- Under the table: `Winner and method 5 points, winner 2. Ties go to more winner-and-method picks.`
- Rail: the sign-in invite when signed out.
- Metadata: title `UFC leaderboard — ${APP_NAME}`, description `Players ranked by their UFC picks, card by card and across the year. Winner and method 5 points, winner 2.`; the page is dynamic (search params); no `loading.tsx`.

- [ ] **Step 1: Write the failing tests.**

```ts
it("parses the scope", () => {
  const now = new Date("2026-12-05T00:00:00Z");
  expect(parseBoardScope({ view: "year" }, now)).toEqual({ kind: "year", year: 2026 });
  expect(parseBoardScope({ event: "ufc-fight-night-x-2026-12-05" }, now)).toEqual({ kind: "card", slug: "ufc-fight-night-x-2026-12-05" });
  expect(parseBoardScope({ event: "../x" }, now)).toEqual({ kind: "card", slug: null });
});
it("ranks players and marks the viewer and the model", () => { /* rows in order; "You" tag on SwiftStriker42; "Model" tag; "You are 2 of 3." */ });
it("explains an empty card board and an empty year", () => { /* exact empty copy for both */ });
it("says when a card is not on the board", () => { ... });
it("switches between this card and the year", () => { /* hrefs and aria-current */ });
it("shows no model row when the API sends none", () => { /* production today */ });
// page.test.tsx: default scope fetches the next card's board; ?view=year fetches { year }; metadata has no "official"
```

- [ ] **Step 2: Run** `cd frontend && npx jest app/ufc/leaderboard components/ufc/UfcLeaderboardView.test.tsx` — expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the frontend gate with `components/ufc app/ufc` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): a leaderboard per card and per year`.

### Task 13: Full suites, build and the check against production

**Files:** none new (fixes only if a check fails, in the owning task's files).

- [ ] **Step 1: Python suite.** `.venv/bin/python -m pytest -p no:cacheprovider -o addopts="" -q` — expected: no failures.
- [ ] **Step 2: Frontend suites.** `cd frontend && npm run typecheck && npm run lint && npm test`, then `TZ=UTC npx jest components/ufc app/ufc lib/ufc` and `TZ=America/Los_Angeles npx jest components/ufc app/ufc lib/ufc` — expected: no failures in any.
- [ ] **Step 3: Build.** `cd frontend && NEXT_PUBLIC_API_URL=https://pitchprophet-api.onrender.com npx next build` — expected: exit 0; `/ufc/picks` and `/ufc/leaderboard` listed.
- [ ] **Step 4: Run against production** (the backend pull request is deployed): `npx next start -p 3462`, then check `/ufc`, a fight page, `/ufc/picks`, `/ufc/leaderboard`, `/ufc/leaderboard?view=year`, `/ufc/leaderboard?event=no-such-card` at 390, 1024 and 1440 px. Expected with today's production data (no public model, no finished fights, placeholder fighters on some cards): no horizontal scroll at 390; every open fight offers "Pick winner"; placeholder fights offer nothing; no "Model" text and no empty gap anywhere; the fight page's pick control works end to end on a fresh device id (pick, "Locked. Points land when the fight ends.", a second attempt shows the saved pick); the leaderboard shows its empty-card copy; signed out, the sign-in invite shows; times read in the browser's zone. `curl -s -D - .../api/ufc/picks/mine?...` shows `cache-control: no-store`. Stop the server (kill only the PID from `lsof -ti tcp:3462`).
- [ ] **Step 5: Football and NRL unchanged.** `npx jest components/match components/matchweek components/play components/leagueTips app/play app/leaderboard app/nrl` — expected: green with no test edited outside the UFC nav assertions of Task 8.
- [ ] **Step 6: Commit** any fixes as `fix(ufc): …`; report every output above.

---

## Rulings made while planning

- Ruling: identity is device-first with an optional account (the football and NRL `tip_players` model), not sign-in-required; a signed-out visitor plays and is invited to sign in — that is how football tips work in the code (`league_score_predictions.py`) and what spec 2 and 5.3 say — cost if wrong: one `Depends(get_current_user)` on submit plus copy changes in Tasks 9–12.
- Ruling: no migration; a void grade is `graded_at` set with NULL points and correctness, and the API derives "void" live from the bout — every needed column already exists in `ufc_picks` — cost if wrong: a later `void_reason` column and a backfill from bout status.
- Ruling: draw, no contest, cancelled and changed bouts void every pick (no points, not counted); a DQ or an unclassified method (`other`) gives the right winner 2 points and never the method — spec 5.3 for DQ and the void cases; `other` follows DQ because the method cannot be checked — cost if wrong: a few picks under- or over-scored, corrected by the 30-day re-grade after a rule change.
- Ruling: a lock never reopens: the ingest stamps `locked_at = scheduled_utc` once the start has passed and stops moving that bout's time — phase 1 moved the time of any scheduled, unlocked bout, so a later time could reopen picks and a cached public call (spec 4.3) — cost if wrong: a bout postponed after its start time stays locked and unpickable.
- Ruling: cancelled bouts, changed bouts and bouts with a placeholder fighter never carry the model's call — an unlocked cancelled bout can be reinstated by the ingest, so revealing it would leak the call for a fight that reopens (spec 5.4 says cancelled reveals to everyone) — cost if wrong: a cancelled fight's call is not shown, which nobody can act on anyway.
- Ruling: a pick after the lock is 422 `fight_locked`, a second pick 409 `pick_finalized` — football's codes (`match_locked` 422, `prediction_finalized` 409); spec 8.3 says 409 after lock — cost if wrong: one status code in Task 4 and one branch in Task 9.
- Ruling: the public model's version comes only from `ufc_public_model`; `is_shadow` is ignored — phase 2 writes every row with `is_shadow=True`, and spec 6 counts calls made while in shadow — cost if wrong: none while the setting is empty.
- Ruling: the model's pick is the side with `p > 0.5` and its most likely method (ties: decision, KO/TKO, submission, as the method model); at exactly 50% it sits the fight out; without method probabilities it can earn only 2 — spec 5.3 — cost if wrong: the model's leaderboard total.
- Ruling: the model's leaderboard row appears only when a model is public and it has scored at least one fight in scope, and it never counts a fight whose players' picks are not graded yet — football's H1 rule; no empty-looking row — cost if wrong: a missing reference row on the first card after going public.
- Ruling: boards list only players with at least one graded, non-void pick; order is points, winner-and-method count, players before the model, handle, then player id — owner: count only graded picks; handles are not unique — cost if wrong: a pre-result card board is empty instead of listing zeros.
- Ruling: the year of a card is the UTC year of its first bout — one rule for every viewer — cost if wrong: a New Year's Eve card lands in the neighbouring year for some viewers.
- Ruling: grades are reconciled for 30 days after a bout (`RECONCILE_DAYS` from phase 2); never-graded picks are graded at any age — mirrors `ufc_predict._reconcile` — cost if wrong: a result corrected after a month keeps its old grade.
- Ruling: the stored sentence "{W} is rated higher, {rW} to {rL}." is reworded when served ("{W} is ahead on FinalWhistle's own fighter rating, {rW} to {rL}.") rather than in the template — rows are append-only and a template change would append a new prediction for every open bout — cost if wrong: one regex in `ufc_model.py`.
- Ruling: the identity helpers (`_player_for_submit`, `_player_for_read`, `_DEVICE_ID_RE`) are imported from `league_score_predictions.py`, not copied a third time — the account/device rules there were hardened by review (H3) and must not drift — cost if wrong: a coupling to a football module that does not change football behaviour.
- Ruling: account deletion needs no UFC change — football keeps `tip_players` rows (generated handle, no personal field) when it anonymises the user; a test pins that deletion works with UFC picks present — cost if wrong: a delete loop over `ufc_picks` in `delete_account`.
- Ruling: the sign-in claim gets a third reassign/dedupe loop for `ufc_picks` in `nrl_user_tips.claim_device_tips` (a file outside spec 8.5's list) — without it the merge path fails on the foreign key — cost if wrong: none; it is required.
- Ruling: copy uses the fighter's full name ("Lock in Shara Magomedov by decision", "You: Shara Magomedov, decision") and the row wording of spec 5.3 over the mock-up's "Your pick: …" — the site names people in full; the spec table is the later decision — cost if wrong: strings in `lib/ufcPicks.ts`.
- Ruling: the tabs read "My picks" and "Leaderboard", as football's — consistency across sports (spec 5.1 says "Picks") — cost if wrong: one label.
- Ruling: no device-side pick cache for UFC — the server is the reveal authority and one `mine` call per page is cheap — cost if wrong: a short "loading" on each visit before pick lines show.
- Ruling: `mine` requires the card slug; `mine.bouts` is ordered by lock time, then card order — "next fight to pick" is the next to lock — cost if wrong: the "Next" button's order.
- Ruling: the leaderboard returns every entry, no paging — football does the same and the player count is small — cost if wrong: paging later.
- Ruling: the picks grading step in `ufc-refresh.yml` has no `continue-on-error` — a grading failure must be visible; it is the last step — cost if wrong: a red run on a transient database error.
- Ruling: `reveal.ts` maps `ufc` to a new `ufc_picks` game — otherwise a generic public surface would treat UFC as "no pick game" and reveal — cost if wrong: none for football and NRL.

## Deferred (phase 4b)

- `/ufc/record`: graded record, hit rate, Brier score, calibration, the date counting began, backtest shown apart; its "Record" tab and `recordPath`.
- `/ufc/rankings`, ratings and rating history on fighter pages, and the model's call in a fighter's fight history.
- Model versus market on the same fights (owner: no odds this phase). When built: exclude in-play sources (any source whose name contains "live") and "Sugarhouse (New Jersey)", and hide the market's chance on an open fight by the same server rule.
- `/ufc/picks` as a one-fight-per-step flow with a summary and a share at the end; share pages and Open Graph images for a card and a pick sheet.
- "You and the model" per card (model points on My picks), streaks and best card.
- Changing the stored rating sentence at its source (`ml/sports/ufc/reasons.py`) once a model is public.
- Live strip, on-the-spot grading and the stale rule (phase 5).

## Self-review

- Spec coverage: 4.3 lock (Task 2, sticky lock; Task 4 server clock), 5.2 states (Tasks 2, 9, 10), 5.3 game (Tasks 2, 4–7, 9–12), 5.4 reveal (Tasks 3, 5, 8), 5.5 look (Tasks 9–12 reuse `FixtureRow`, `Segmented`, monograms), 6 public setting and counting row (Task 3), 8.3 endpoints `picks/submit`, `picks/mine`, `picks/leaderboard` (Tasks 4, 5, 7; `model/record` and `rankings` deferred), 8.4 frontend (Tasks 8–12), 11 risks "pick after start" and "leak" (Review Focus 1, Task 3). Market, record and rankings are deferred above with reasons.
- Type consistency: `UfcPickOut`/`UfcPick` (state, points, winner_correct, method_correct), `UfcMyBoutOut`/`UfcMyBout` (picks_open, locks_at, fighter names), `UfcModelCallOut`/`UfcModelCall`, `pick_block`, `score_pick`, `call_is_public`, `calls_for`, `public_calls`, `useUfcPicks().myBout` are named the same in every task that uses them.
