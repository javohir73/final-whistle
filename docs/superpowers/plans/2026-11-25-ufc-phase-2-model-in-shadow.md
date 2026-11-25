# UFC Phase 2 — The Model, in Shadow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two versioned UFC models (`ufc-elo-v0.1` and `ufc-form-v0.2`) write a winner probability, method probabilities and up to three plain-English reasons for every scheduled bout before it locks, grade themselves after the bout, and an offline walk-forward harness reports on held-out years whether the model clears the gate. Nothing is visible to visitors.

**Architecture:** Pure model code in `ml/sports/ufc/` works on an in-memory `History` of finished bouts: an Elo replay, one chronological walk that builds leak-free, antisymmetric feature snapshots, a no-intercept logistic model, method rates by weight class, and templated reasons. `pipeline/sports/ufc_history.py` is the only code that reads the tables into that `History`. `pipeline/sports/ufc_predict.py` (generate, grade) and `pipeline/sports/ufc_evaluate.py` (harness) both call the same walk, so the code that is evaluated is the code that predicts.

**Tech Stack:** Python 3.12, SQLAlchemy 2, numpy 2.2.1 and scikit-learn 1.6.0 (both already in `backend/requirements.txt` and installed in `.venv`; no new dependency), pytest with the root `conftest.py` `db_session` fixture.

**Spec:** `docs/superpowers/specs/2026-11-25-ufc-section-design.md` (sections 5.3, 6, 8.1, 9.1, 11). Previous plan: `docs/superpowers/plans/2026-11-25-ufc-phase-1-data-foundation.md`.

## Global Constraints

- Additive only. No migration: the nine `ufc_*` tables exist. Do not change football or NRL code, tables or tests. The only existing files this plan modifies: `.github/workflows/ufc-refresh.yml`, `backend/app/config.py`, `.env.example`.
- `ml/sports/ufc/` is pure: it imports nothing from `app` or `pipeline` and never touches a database or the network.
- Fighter "a" and "b" are the feed's listing order (a won 55.8% of 2022–2026 bouts). Nothing may learn from the position: every model input is antisymmetric (swapping a and b negates it) and the logistic model has no intercept.
- Every feature for a bout uses only finished bouts whose `scheduled_utc` is strictly earlier than that bout's `scheduled_utc`. Bouts sharing a timestamp never see each other's results.
- Model versions, exactly: `ufc-elo-v0.1`, `ufc-form-v0.2`. Method vocabulary for predictions, exactly: `ko_tko`, `submission`, `decision`.
- Predictions are append-only, `is_shadow=True` on every row, never written at or after the bout's lock time.
- Lock time of a bout: the earlier of `locked_at` and `scheduled_utc` when both are set, whichever is set otherwise, `None` when neither is. Not "`locked_at` if set": `ufc_results.apply_outcome` stamps `locked_at` with the time a refresh first sees the bout live or final, which is after the scheduled start, so taking it alone would let a row written after the start count.
- All datetimes are timezone-aware UTC in Python. SQLite returns them naive; normalise with `pipeline.sports.ufc_ingest._utc` before comparing.
- Brier for a two-outcome bout is the single-number form `(1 − p_actual)²`, the form the spike's 0.2432 baseline uses; log loss is `−ln(max(1e-15, p_actual))`.
- No CLI or workflow step prints or logs row contents (names, probabilities of a single bout); counts and aggregates only. The repository is public.
- Match the surrounding code: module docstring explaining the why, `from __future__ import annotations`, `log = logging.getLogger(__name__)`, tests co-located as `*_test.py`.
- Tests never touch the network and use the in-memory `db_session` fixture or pure `History` objects built with the test kits from Task 1, so expected values are computable by hand.
- `.venv` is a shared symlink: never install anything.
- Test gate per task: `.venv/bin/python -m pytest <the task's test files> -p no:cacheprovider -o addopts="" -q`; the whole Python suite once in Task 9.
- Commit after each task, staging explicit paths only, conventional message `feat(ufc): …`, ending with the Co-Authored-By line your own harness specifies. Do not push.

## Review Focus

1. **Leakage from a fighter's later bouts or from the bout's own stats.** Adding a later bout, or changing the bout's own result or stats, must leave its snapshot unchanged. (Task 2: `test_later_bouts_do_not_change_an_earlier_snapshot`, `test_own_result_and_stats_do_not_enter_own_snapshot`)
2. **Listing-order leakage.** Relabelling a and b on every bout must negate every feature and give exactly `1 − p`; a training set where a always wins with no real signal must fit to 0.5. (Task 2: `test_relabelling_listing_order_negates_features`; Task 3: `test_fit_cannot_learn_listing_order`; Task 6: `test_mirrored_bout_gets_the_mirrored_probability`)
3. **A prediction written at or after lock**, including the case where `locked_at` is stamped later than `scheduled_utc`. (Task 6: `test_no_prediction_at_or_after_lock`; Task 7: `test_row_written_after_scheduled_start_never_counts`)
4. **Two bouts on the same day for one fighter, and an event whose bouts all share one scheduled time.** The second bout must not see the first one's result. (Task 1: `test_bouts_sharing_a_time_are_rated_as_one_batch`; Task 2: `test_same_time_bouts_do_not_see_each_other`)
5. **A fighter whose only prior bouts were draws or no contests.** Not a debutant (fight count and layoff known), form and finish rate missing with their indicators set, Elo moved by the draw only. (Task 2: `test_only_draws_and_no_contests_before`)
6. **A rematch.** The second meeting sees the first meeting's result and stats, never its own. (Task 2: `test_rematch_sees_only_the_first_meeting`)
7. **Grading the wrong row.** Draws, no contests, cancelled and changed bouts are skipped; each model version is graded once from its own counting row. (Task 7)

---

### Task 1: History loader, test kits and the Elo rating

**Files:**
- Create: `ml/sports/ufc/__init__.py` (empty docstring module)
- Create: `ml/sports/ufc/history.py`
- Create: `ml/sports/ufc/elo.py`
- Create: `ml/sports/ufc/testkit.py` (pure helper; not a test file)
- Create: `pipeline/sports/ufc_history.py`
- Create: `pipeline/sports/ufc_testkit.py` (DB helper; not a test file)
- Test: `ml/sports/ufc/elo_test.py`, `pipeline/sports/ufc_history_test.py`

**Interfaces:**
- Consumes: `UfcBout`, `UfcFighter`, `UfcBoutStat`, `UfcEvent` from `app.models`; `_utc`, `slugify` from `pipeline.sports.ufc_ingest`.
- Produces, in `ml/sports/ufc/history.py` (dataclasses `frozen=True`):

```python
class StatLine:     sig_landed: int | None; td_landed: int | None
class FighterInfo:  fighter_id: int; name: str; date_of_birth: date | None; height_in: float | None; reach_in: float | None
class BoutRecord:   bout_id: int; when: datetime; fighter_a: int; fighter_b: int
                    winner: str | None          # "a" | "b" | None
                    method: str | None; weight_class: str | None; scheduled_rounds: int | None
                    end_round: int | None; end_clock: str | None
                    stats_a: StatLine | None; stats_b: StatLine | None
                    finished: bool              # False for a bout being predicted
class History:      bouts: tuple[BoutRecord, ...]   # finished only, sorted by order_key
                    fighters: Mapping[int, FighterInfo]
def order_key(b: BoutRecord) -> tuple[datetime, int]          # (when, bout_id)
def batches(bouts: Iterable[BoutRecord]) -> Iterator[list[BoutRecord]]   # consecutive runs of equal `when`, input must be sorted
def fight_minutes(b: BoutRecord) -> float | None
```

- Produces, in `ml/sports/ufc/elo.py`:

```python
@dataclass(frozen=True)
class EloParams: version: str = "ufc-elo-v0.1"; k: float = 60.0; history_from: int = 2016
                 decay: float = 0.0; scale: float = 400.0; start: float = 1500.0
def win_prob(r_a: float, r_b: float, scale: float = 400.0) -> float
class EloState:
    def __init__(self, params: EloParams) -> None
    def rating(self, fighter_id: int, at: datetime) -> float     # decayed to `at`
    def apply(self, batch: Sequence[BoutRecord]) -> None          # one batch of equal `when`
def elo_probs(history: History, params: EloParams) -> dict[int, float]   # bout_id -> pre-bout p_a, every finished bout
def final_ratings(history: History, params: EloParams, at: datetime) -> dict[int, float]   # fighters with ≥1 applied bout
```

- Produces, in `ml/sports/ufc/testkit.py`: `history(rows: Sequence[tuple], fighters: Mapping[str, Mapping] | None = None) -> History` and `parse_row(row) -> dict`; fighter ids are 1, 2, … by first appearance of the name, bout ids 1, 2, … by row order, `FighterInfo.name` is the given name.
- Produces, in `pipeline/sports/ufc_testkit.py`: `build(db: Session, rows: Sequence[tuple], fighters: Mapping[str, Mapping] | None = None) -> Built` where `Built` has `fighters: dict[str, UfcFighter]` and `bouts: list[UfcBout]` (row order). Uses `parse_row`.
- Produces, in `pipeline/sports/ufc_history.py`: `to_record(bout: UfcBout, stats: Mapping[int, UfcBoutStat] | None = None) -> BoutRecord` and `load_history(db: Session) -> History`.

Row format shared by both kits: `(when, a_name, b_name, winner, method[, extra])`.
- `when`: `"YYYY-MM-DD"` means 03:00 UTC that day; `"YYYY-MM-DDTHH:MM"` is that UTC time.
- `winner`: `"a"`, `"b"` or `None`; `method` one of the phase 1 vocabulary or `None`.
- `extra` keys (all optional): `status` (default `"finished"` when `winner` or `method` is set, else `"scheduled"`), `weight_class` (default `"Lightweight"`), `rounds` (default 3), `end_round`, `end_clock`, `stats_a` / `stats_b` as `(sig_landed, td_landed)`, `event` (event name; default one event per distinct `when` date string), `locked_at` (ISO string).
- `fighters` maps a name to any of `dob` (ISO date), `height`, `reach`.
- The DB kit creates `UfcEvent`, `UfcFighter` (provider `"espn"`, provider ids `"f<n>"`), `UfcBout` (provider bout ids `"b<n>"`), and `UfcBoutStat` rows, then flushes.

Rules:
- `load_history` reads bouts with `status == "finished"`, `scheduled_utc` not null and `fighter_a_id != fighter_b_id`; draws and no contests are included (`winner None`). `scheduled`, `live`, `cancelled` and `changed` rows are excluded. Stats are attached by `(bout_id, fighter_id)`. Every fighter referenced is in `fighters`.
- `fight_minutes`: decision → `scheduled_rounds * 5` (rounds `None` → 3); otherwise `(end_round − 1) * 5 + m + s/60` from `end_clock` `"m:ss"`; `None` when `end_round` or `end_clock` is missing or unparsable. Rounds are taken as five minutes.
- Elo, per batch (all bouts with the same `when`, applied in `order_key` order): only bouts with `when.year >= history_from` are applied. Effective rating at `t`: `start + (r − start) * (1 − decay) ** (years since that fighter's last applied bout)`, years = days / 365.25; a fighter never seen is `start`. Every bout in a batch is scored from the pre-batch effective ratings; after the batch each fighter's stored rating is its pre-batch effective rating plus the sum of its updates `k * (s − p)` from that batch, and its last date becomes the batch time. `s` is 1/0 for a win/loss, 0.5 for a `draw`; `no_contest`, `dq` without winner and any bout with `winner None` and method other than `draw` change nothing. A DQ with a winner is a win.

- [ ] **Step 1: Write failing tests** in `ml/sports/ufc/elo_test.py`:

```python
def test_first_bout_and_an_upset():         # k=80, history_from=1993
    h = history([("2020-01-01", "A", "B", "a", "decision"), ("2020-02-01", "A", "C", "b", "ko_tko")])
    probs = elo_probs(h, EloParams(k=80, history_from=1993))
    assert probs[1] == 0.5 and probs[2] == pytest.approx(0.557312, abs=1e-6)
    r = final_ratings(h, EloParams(k=80, history_from=1993), at=datetime(2020, 3, 1, tzinfo=timezone.utc))
    assert r[1] == pytest.approx(1495.415, abs=1e-3) and r[3] == pytest.approx(1544.585, abs=1e-3) and r[2] == 1460.0

def test_bouts_sharing_a_time_are_rated_as_one_batch():
    h = history([("2020-01-01", "A", "B", "a", "ko_tko"), ("2020-01-01", "A", "C", "a", "submission")])
    assert elo_probs(h, EloParams(k=80, history_from=1993)) == {1: 0.5, 2: 0.5}
    # final: A 1580, B 1460, C 1460

def test_draw_moves_unequal_ratings_and_no_contest_moves_nothing():
    # A beats B (A 1540), then A draws C: p_A = 0.557312 → A = 1540 + 80*(0.5-0.557312) = 1535.415
    # a no_contest between B and C afterwards leaves both unchanged

def test_decay_pulls_an_idle_fighter_back():  # decay=0.5: A 1540 after 2020-01-01; rating(A, 2022-01-01) ≈ 1510.0 (abs 0.05)
def test_history_from_ignores_older_bouts():  # history_from=2021, only a 2020 bout → final_ratings == {}
def test_win_prob_is_antisymmetric():         # for 20 pairs in [1200, 1800]: win_prob(a,b) + win_prob(b,a) == approx(1, abs=1e-12)
```

and in `pipeline/sports/ufc_history_test.py`:

```python
def test_loads_only_finished_bouts_in_time_order(db_session):
    # rows: finished 2020-02-01, finished 2020-01-01, draw 2020-03-01 (winner None, method "draw"),
    #       cancelled, changed, scheduled → load_history returns 3 bouts, dates ascending, the draw included
def test_times_are_utc_aware(db_session):       # every BoutRecord.when.tzinfo is not None
def test_stats_are_attached_to_the_right_side(db_session):  # stats_a=(50, 3), stats_b=(30, 1) → StatLine(50, 3) on a, (30, 1) on b
def test_fighter_profiles_come_along(db_session):          # fighters={"A": {"dob": "1990-01-01", "reach": 76}} → History.fighters[id].reach_in == 76.0
def test_fight_minutes():                       # decision 3 rounds → 15.0; ko_tko R2 "4:58" → 9.9667 (abs 1e-3); end_clock None → None
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ml/sports/ufc/elo_test.py pipeline/sports/ufc_history_test.py -p no:cacheprovider -o addopts="" -q` — expected: import errors.
- [ ] **Step 3: Implement** the six files. `load_history` does one query for bouts, one for their stats, one for fighters (no per-bout queries).
- [ ] **Step 4: Run** the same command — expected: all pass.
- [ ] **Step 5: Commit** `feat(ufc): history loader, test kits and an Elo rating replay`.

### Task 2: The feature builder

**Files:**
- Create: `ml/sports/ufc/features.py`
- Test: `ml/sports/ufc/features_test.py`

**Interfaces:**
- Consumes: `History`, `BoutRecord`, `batches`, `fight_minutes`, `order_key` (Task 1); `EloParams`, `EloState`, `win_prob` (Task 1).
- Produces:

```python
FEATURES: tuple[str, ...] = (
    "elo_diff", "elo_diff_x_five", "elo_diff_x_womens",
    "age_diff", "age_missing", "reach_diff", "reach_missing", "height_diff", "height_missing",
    "layoff_diff", "debut", "fights_diff",
    "win3_diff", "win5_diff", "form_missing", "finish_diff", "finish_missing",
    "sig_str_diff", "td_diff", "stats_missing",
)
@dataclass(frozen=True)
class FighterFacts: rating: float; age_years: float | None; reach_in: float | None; height_in: float | None
                    layoff_days: int | None; ufc_fights: int
                    wins3: tuple[int, int] | None; wins5: tuple[int, int] | None   # (won, of)
                    finish_rate: float | None; sig_str_pm: float | None; td_p15: float | None
@dataclass(frozen=True)
class Snapshot:     bout_id: int; when: datetime; p_elo: float
                    x: Mapping[str, float]          # every name in FEATURES
                    a: FighterFacts; b: FighterFacts
def snapshots(history: History, elo: EloParams, targets: Sequence[BoutRecord] = ()) -> dict[int, Snapshot]
def flip(s: Snapshot) -> Snapshot                   # a and b swapped, x negated, p_elo -> 1 - p_elo
```

`snapshots` walks `history.bouts` plus `targets` merged in `order_key` order, batch by batch: every bout in a batch gets its snapshot from the state before the batch; then the batch's finished bouts update the Elo state and the per-fighter prior lists. Targets never update state. It returns a snapshot for every finished bout and every target. `FighterFacts` are computed at the bout's `when`.

Per-fighter facts (from that fighter's prior bouts, i.e. all finished bouts with an earlier `when`, regardless of `history_from`):
- `rating`: `EloState.rating(id, when)`; `p_elo = win_prob(rating_a, rating_b, elo.scale)`.
- `age_years`: `(when.date() − date_of_birth).days / 365.25`, `None` without a date of birth.
- `layoff_days`: days from the latest prior bout (any outcome) to `when`; `None` with no prior bout.
- `ufc_fights`: number of prior bouts, any outcome.
- `wins3` / `wins5`: over the latest 3 / 5 prior bouts with `winner` set (draws and no contests are skipped, not counted as losses): `(wins, n)`; `None` when there is none.
- `finish_rate`: prior wins by `ko_tko` or `submission` divided by all prior wins; `None` with no prior win.
- `sig_str_pm`: over prior bouts where both stat lines have `sig_landed` and `td_landed` and `fight_minutes > 0`: `Σ(own sig − opponent sig) / Σ minutes`; `td_p15`: `15 * Σ(own td − opponent td) / Σ minutes`; both `None` when no such bout.

Feature values (`d` is a − b; `m_x` is 1 when the value is missing for that fighter, else 0; every indicator is `m_b − m_a`, so it is antisymmetric):
- `elo_diff = rating_a − rating_b`; `elo_diff_x_five = elo_diff` if `scheduled_rounds == 5` else 0; `elo_diff_x_womens = elo_diff` if `weight_class` lower-cased starts with `"women"` else 0. (Weight class and rounds are the same for both fighters, so they enter only through these products; a bare symmetric term would need an intercept.)
- `age_diff`, `reach_diff`, `height_diff`: the difference when both are known, else `0.0`; `age_missing`, `reach_missing`, `height_missing` the indicators.
- `layoff_diff = log1p(min(days_a, 1095)) − log1p(min(days_b, 1095))` when both have a prior bout, else 0; `debut` = indicator of "no prior bout".
- `fights_diff = log1p(n_a) − log1p(n_b)`.
- `win3_diff`, `win5_diff`: difference of `won/of` when both known, else 0; `form_missing` = indicator of "no prior bout with a winner".
- `finish_diff`: difference when both known, else 0; `finish_missing` its indicator.
- `sig_str_diff`, `td_diff`: difference when both known, else 0; `stats_missing` = indicator of "no prior bout with usable stats".

- [ ] **Step 1: Write failing tests** with `testkit.history(...)` and `EloParams(k=80, history_from=1993)`:

```python
def test_profile_differences():
    # fighters A dob 1990-01-01 reach 76 height 72; B dob 1995-01-01 reach 70 height 71; one bout 2020-01-01
    x = snapshots(h, P)[1].x
    assert x["age_diff"] == pytest.approx(5.0, abs=0.01) and x["reach_diff"] == 6.0 and x["height_diff"] == 1.0
    assert x["age_missing"] == x["reach_missing"] == x["height_missing"] == 0.0

def test_missing_profile_is_neutral_with_an_indicator():   # B has no dob → age_diff 0.0, age_missing 1.0; mirrored bout → -1.0
def test_debutant_against_a_veteran():
    # A won twice before (2019-01-01 v B, 2019-07-01 v C, both decisions with stats), D debuts on 2020-01-01
    x = snapshots(h, P)[3].x                        # bout 3 = A v D
    assert x["debut"] == 1.0 and x["layoff_diff"] == 0.0 and x["fights_diff"] == pytest.approx(math.log(3))
    assert x["form_missing"] == 1.0 and x["win3_diff"] == 0.0 and x["stats_missing"] == 1.0

def test_form_windows_and_finish_rate():
    # A's prior results oldest→newest: W(ko_tko) W(submission) L W(decision) → newest-first W L W W
    s = snapshots(h, P)[target_id]
    assert s.a.wins3 == (2, 3) and s.a.wins5 == (3, 4) and s.a.finish_rate == pytest.approx(2 / 3)

def test_striking_and_takedown_differentials():
    # prior decision, 3 rounds: A stats (50, 3), opponent (30, 1)
    assert s.a.sig_str_pm == pytest.approx(20 / 15) and s.a.td_p15 == pytest.approx(2.0)

def test_context_products():                    # 5 rounds → elo_diff_x_five == elo_diff; "Women's Flyweight" → elo_diff_x_womens == elo_diff; else 0.0

def test_relabelling_listing_order_negates_features():
    # the same 8-bout history twice, the second with a/b swapped (and winner/stats swapped) on every bout
    for bid in range(1, 9):
        assert swapped[bid].x == {k: -v for k, v in original[bid].x.items()}   # exact, -0.0 == 0.0
        assert swapped[bid].p_elo == pytest.approx(1 - original[bid].p_elo, abs=1e-12)
    assert flip(original[5]).x == swapped[5].x

def test_later_bouts_do_not_change_an_earlier_snapshot():
    # snapshot of bout 3 from a 3-bout history equals bout 3's snapshot from the same history + 4 later bouts for both fighters

def test_own_result_and_stats_do_not_enter_own_snapshot():
    # bout 3 as a win for a with stats (90, 5) vs a loss for a with stats (0, 0): identical snapshot for bout 3

def test_same_time_bouts_do_not_see_each_other():
    # tournament night: "2020-01-01T03:00" A beats B, "2020-01-01T03:00" A beats C
    s = snapshots(h, P)[2]
    assert s.a.ufc_fights == 0 and s.a.rating == 1500.0 and s.x["debut"] == 0.0   # both debut → 1 - 1

def test_only_draws_and_no_contests_before():
    # A: draw with B, then no contest with C, then the target v D (D has one prior win, by ko_tko, over E)
    s = snapshots(h, P)[target_id]
    assert s.a.ufc_fights == 2 and s.a.layoff_days is not None and s.x["debut"] == 0.0
    assert s.a.wins3 is None and s.x["form_missing"] == -1.0 and s.x["win3_diff"] == 0.0   # m_b - m_a = 0 - 1
    assert s.a.finish_rate is None and s.b.finish_rate == 1.0 and s.x["finish_missing"] == -1.0
    assert s.a.rating == pytest.approx(1500.0)      # the draw at equal ratings moved nothing

def test_rematch_sees_only_the_first_meeting():
    # 2020-01-01 A beats B with stats (40, 0)/(20, 0); 2021-01-01 rematch, B wins with stats (10, 0)/(60, 4)
    s = snapshots(h, P)[2]
    assert s.a.wins3 == (1, 1) and s.b.wins3 == (0, 1) and s.a.rating == pytest.approx(1540.0, abs=1e-9)
    assert s.a.sig_str_pm == pytest.approx(20 / 15)

def test_targets_are_predicted_from_all_earlier_history():   # a scheduled BoutRecord (finished=False) after the last bout gets a snapshot; adding it changes no finished bout's snapshot
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ml/sports/ufc/features_test.py -p no:cacheprovider -o addopts="" -q` — expected: import error.
- [ ] **Step 3: Implement `snapshots` and `flip`.** Keep a per-fighter list of prior-bout summaries (when, won/lost/draw/nc, method, own and opponent stat lines, minutes); compute facts on demand. The whole history (about 9,500 bouts) must walk in a few seconds.
- [ ] **Step 4: Run** the test file — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): leak-free antisymmetric feature snapshots`.

### Task 3: The logistic model, its parameter file and fitting

**Files:**
- Create: `ml/sports/ufc/model.py`
- Create: `ml/sports/ufc/params.py`
- Create: `ml/sports/ufc/params.json`
- Test: `ml/sports/ufc/model_test.py`, `ml/sports/ufc/params_test.py`

**Interfaces:**
- Consumes: `FEATURES`, `Snapshot` (Task 2); `EloParams` (Task 1).
- Produces, in `model.py`:

```python
@dataclass(frozen=True)
class FormParams: version: str; features: tuple[str, ...]; weights: tuple[float, ...]
                  means: tuple[float, ...]; scales: tuple[float, ...]; c: float
                  train_from: date; train_to: date; fitted_on: date; n_bouts: int
FORM_VERSION = "ufc-form-v0.2"
def contributions(params: FormParams, x: Mapping[str, float]) -> dict[str, float]   # w_i * x_i / scale_i per feature
def predict_form(params: FormParams, x: Mapping[str, float]) -> float               # p_a = sigmoid(sum of contributions)
def fit_form(xs: Sequence[Mapping[str, float]], a_won: Sequence[int], c: float, *,
             train_from: date, train_to: date, fitted_on: date) -> FormParams
```

- Produces, in `params.py`:

```python
@dataclass(frozen=True)
class UfcParams: elo: EloParams; form: FormParams | None
DEFAULT_PARAMS_FILE: Path          # ml/sports/ufc/params.json
def load_params(path: Path | None = None) -> UfcParams
def save_params(params: UfcParams, path: Path | None = None) -> None
```

Rules:
- `fit_form` augments: each bout contributes `(x, y)` and `(−x, 1 − y)`. Means are the column means of the augmented matrix; they are zero by construction, the function asserts `abs(mean) < 1e-9` and stores `0.0`. Scales are the population standard deviations of the augmented columns; a scale below `1e-9` is stored as `1.0`. Fit `sklearn.linear_model.LogisticRegression(fit_intercept=False, C=c, solver="lbfgs", max_iter=2000)` on the scaled matrix (the L2 penalty is sklearn's default). `predict_form` divides by the scale and never subtracts the mean, so `predict_form(−x) == 1 − predict_form(x)` up to float rounding.
- `params.json` layout:

```json
{
  "elo": {"version": "ufc-elo-v0.1", "k": 60.0, "history_from": 2016, "decay": 0.0, "scale": 400.0, "start": 1500.0},
  "form": {"version": "ufc-form-v0.2", "features": ["elo_diff", "..."], "weights": [], "means": [], "scales": [],
           "c": 1.0, "train_from": "YYYY-MM-DD", "train_to": "YYYY-MM-DD", "fitted_on": "YYYY-MM-DD", "n_bouts": 0}
}
```

- `load_params` falls back per section. Elo: a missing or malformed `elo` section, or a missing/corrupt file, gives `EloParams()` (k 60, history from 2016, no decay: the spike's best 2016 setting). Form: `None` when the section is missing or malformed, when `features` differs from `FEATURES` (a stale file), when the list lengths differ, or when any mean is not 0. There are no default form weights: without a fitted section the form model does not run (Task 6 then writes Elo rows only). This is documented in the module docstring.
- The `params.json` committed in this task holds the `elo` section only. Task 8 overwrites it with tuned and fitted values.

- [ ] **Step 1: Write failing tests:**

```python
def test_prediction_is_antisymmetric():          # random weights/scales (seeded), 50 random x: predict(x) + predict(-x) == approx(1, abs=1e-12)
def test_zero_input_is_a_coin_flip():            assert predict_form(params, {f: 0.0 for f in FEATURES}) == 0.5
def test_contributions_add_up_to_the_logit():    # sum(contributions) == approx(logit(predict_form))
def test_hand_computed_prediction():
    # weights 1.0 on elo_diff, scale 100 on elo_diff, others weight 0 scale 1; x elo_diff=100 → p == approx(1/(1+e^-1)) = 0.731059
def test_fit_finds_the_signal():
    # 400 bouts, elo_diff ∈ {-200, +200}; a wins 80% when elo_diff > 0, 20% when < 0 (deterministic counts) → elo_diff weight > 0,
    # predict at +200 between 0.7 and 0.9
def test_fit_cannot_learn_listing_order():
    # 200 bouts, every x all zeros, a won every one → every weight == approx(0, abs=1e-9); predict == 0.5
def test_fit_records_window_and_zero_means():    # means all 0.0, train_from/train_to/fitted_on/n_bouts as passed, features == FEATURES
```

and in `params_test.py`:

```python
def test_missing_file_gives_default_elo_and_no_form(tmp_path):   assert load_params(tmp_path / "nope.json") == UfcParams(EloParams(), None)
def test_round_trip(tmp_path):                   # save then load equals the original, dates included
def test_stale_feature_list_drops_form(tmp_path):    # features list missing one name → form None, elo kept
def test_nonzero_mean_drops_form(tmp_path):
def test_corrupt_json_falls_back(tmp_path):      # "{" → defaults
def test_shipped_file_loads():                   assert load_params().elo.version == "ufc-elo-v0.1"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ml/sports/ufc/model_test.py ml/sports/ufc/params_test.py -p no:cacheprovider -o addopts="" -q` — expected: import errors.
- [ ] **Step 3: Implement** both modules and write the elo-only `params.json` with `save_params`.
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): no-intercept logistic form model and its parameter file`.

### Task 4: Method probabilities

**Files:**
- Create: `ml/sports/ufc/methods.py`
- Test: `ml/sports/ufc/methods_test.py`

**Interfaces:**
- Consumes: `BoutRecord` (Task 1).
- Produces:

```python
METHODS = ("ko_tko", "submission", "decision")
FALLBACK_RATES = {"ko_tko": 0.35, "submission": 0.18, "decision": 0.47}   # 2022–2026 holdout shares from the spike
WINDOW_YEARS = 10
ALPHA = 50.0
def weight_group(weight_class: str | None) -> str | None
@dataclass(frozen=True)
class MethodTable:
    def probs(self, weight_class: str | None, scheduled_rounds: int | None) -> dict[str, float]
def method_table(bouts: Iterable[BoutRecord], start: datetime, end: datetime) -> MethodTable   # bouts with start <= when < end
def method_pick(probs: Mapping[str, float]) -> str
```

Rules:
- Counted bouts: finished, `winner` set, `method` in `METHODS`. DQ, draw, no contest and `other` are not counted.
- `weight_group`: strip and lower-case; `"catchweight"` and `"catch weight"` → `"catch weight"`, the same with a `"women's "` prefix kept; empty or `None` → `None`.
- Group key: `(weight_group, scheduled_rounds or 3)`.
- Overall rates `q_m`: shares of the counted bouts in the window; `FALLBACK_RATES` when the window has none.
- Group probability: `(n_g,m + ALPHA * q_m) / (N_g + ALPHA)`. A `None` weight group or an unseen group has `N_g = 0`, which gives the overall rates. The three values sum to 1.
- `method_pick`: the largest probability; exact ties resolve in the order `decision`, `ko_tko`, `submission`.
- The same probabilities are stored for both models and describe how the bout ends given that the predicted winner wins (v0.2 does not condition on the fighters).

- [ ] **Step 1: Write failing tests:**

```python
def test_shrunk_group_rates():
    # window: 100 counted bouts overall (30 ko_tko, 20 submission, 50 decision); 10 of them are ("lightweight", 3): 6 ko, 1 sub, 3 dec
    p = table.probs("Lightweight", 3)
    assert p["ko_tko"] == pytest.approx(21 / 60) and p["submission"] == pytest.approx(11 / 60) and p["decision"] == pytest.approx(28 / 60)
def test_unknown_class_gets_overall_rates():     # probs(None, 3) == {"ko_tko": 0.3, "submission": 0.2, "decision": 0.5}
def test_empty_window_uses_fallback():           # method_table([], ...).probs("Lightweight", 3) == FALLBACK_RATES
def test_window_is_half_open():                  # a bout exactly at `end` is excluded; one exactly at `start` included
def test_draws_dq_and_no_contests_not_counted():
def test_catchweight_spellings_merge():          assert weight_group("Catchweight") == weight_group("Catch Weight") == "catch weight"
def test_rounds_none_is_three():                 # probs("Lightweight", None) == probs("Lightweight", 3)
def test_pick_and_its_tie_order():
    assert method_pick({"ko_tko": 0.4, "submission": 0.2, "decision": 0.4}) == "decision"
    assert method_pick({"ko_tko": 0.4, "submission": 0.4, "decision": 0.2}) == "ko_tko"
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ml/sports/ufc/methods_test.py -p no:cacheprovider -o addopts="" -q` — expected: import error.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): method probabilities by weight class and rounds`.

### Task 5: Reasons

**Files:**
- Create: `ml/sports/ufc/reasons.py`
- Test: `ml/sports/ufc/reasons_test.py`

**Interfaces:**
- Consumes: `Snapshot`, `FighterFacts` (Task 2); `contributions` (Task 3).
- Produces:

```python
GROUPS: tuple[tuple[str, tuple[str, ...]], ...]   # order below; also the tie order
MIN_CONTRIBUTION = 0.05                            # logit units
def display_names(name_a: str, name_b: str) -> tuple[str, str]
def form_reasons(name_a: str, name_b: str, snap: Snapshot, contribs: Mapping[str, float], p_a: float) -> list[str]
def elo_reasons(name_a: str, name_b: str, snap: Snapshot, p_a: float) -> list[str]
```

Groups (name: features): `rating`: elo_diff, elo_diff_x_five, elo_diff_x_womens; `age`: age_diff, age_missing; `reach`: reach_diff, reach_missing; `height`: height_diff, height_missing; `activity`: layoff_diff, debut; `experience`: fights_diff; `form`: win3_diff, win5_diff, form_missing; `finishing`: finish_diff, finish_missing; `striking`: sig_str_diff, stats_missing; `wrestling`: td_diff.

Selection rule:
- `p_a == 0.5`, or either name is `"TBA"` → `[]`. Otherwise W is the side with the larger probability, L the other; `sign = +1` if W is a else `−1`.
- Group score = `sign * Σ contribs[f]` over its features. Keep groups with score `> MIN_CONTRIBUTION`, sort by score descending (ties: `GROUPS` order), render each in turn, skip a group whose template condition fails, stop at three sentences.
- Display names: the last whitespace-separated token of each name; the full names when the two tokens are equal.
- Numbers 1 to 10 as words (`one` … `ten`), larger as digits. `n` is the rounded absolute difference; a template whose `n` rounds to 0 is skipped.

Templates (W and L are display names; facts from `snap.a` / `snap.b` by side):

| Group | Condition | Sentence |
| --- | --- | --- |
| rating | W's rating > L's | `"{W} is rated higher, {rW} to {rL}."` (ratings rounded to integers) |
| age | both ages known | W younger: `"{W} is {n} year(s) younger."`; W older: `"{W} is {n} year(s) older."` |
| reach | both known, W's longer | `"{W} has a {n}-inch reach advantage."` |
| height | both known, W taller | `"{W} is {n} inch(es) taller."` |
| activity | L debuts, W does not | `"{L} is making a UFC debut."` |
| activity | neither debuts, L's layoff ≥ 365 days | `"{L} has not fought for {m} months."` (`m = layoff_days // 30`, digits) |
| activity | neither debuts, W's layoff < L's | `"{W} has fought more recently."` |
| experience | W has more UFC fights | `"{W} has {nW} UFC fights to {L}'s {nL}."` (digits) |
| form | W's `wins5` known and its rate exceeds L's (or L's is unknown) | `"{W} has won {k} of their last {n} fights."` (words) |
| finishing | W's finish rate known and > L's (or L's unknown) | `"{W} has finished {pct}% of their wins."` (integer percent) |
| striking | W's `sig_str_pm` > 0 and > L's (or L's unknown) | `"{W} lands {x} more significant strikes a minute than they absorb."` (one decimal) |
| wrestling | W's `td_p15` > 0 and > L's (or L's unknown) | `"{W} averages {x} more takedowns than they concede per 15 minutes."` (one decimal) |

Activity takes the first row whose condition holds. "year(s)" and "inch(es)" are singular for one.

`elo_reasons`: `[rating sentence]` when `abs(p_a − 0.5) >= 0.01` and the rating condition holds, else `[]`.

- [ ] **Step 1: Write failing tests** with hand-built `Snapshot` objects and contribution dicts:

```python
def test_examples_from_the_brief():
    # a = "Umar Magomedov", age 28; b = "Israel Adesanya", age 33, reach +7 on b; contribs favour a on age (0.30), b on reach (−0.20), p_a 0.6
    assert form_reasons(...) == ["Magomedov is five years younger."]
    # same with p_a 0.4 and contribs age +0.04, reach −0.25 → ["Adesanya has a seven-inch reach advantage."]
def test_at_most_three_largest_first():          # five qualifying groups with scores 0.5, 0.4, 0.3, 0.2, 0.1 → three sentences in that order
def test_small_contributions_give_no_reason():   # all |score| <= 0.05 → []
def test_contribution_against_the_winner_is_ignored():   # reach favours L by 0.4 → no reach sentence
def test_missing_values_skip_the_template():     # age group score 0.3 from age_missing only (ages None) → no age sentence, next group used
def test_coin_flip_and_tba_give_none():          # p_a 0.5 → []; name "TBA" → []
def test_same_surname_uses_full_names():         assert display_names("Bruno Silva", "Rafael Silva") == ("Bruno Silva", "Rafael Silva")
def test_singular_units():                       # one-year age gap → "is one year younger."; one-inch height → "is one inch taller."
def test_debut_and_layoff_sentences():           # L debut → "X is making a UFC debut."; L layoff 400 days → "X has not fought for 13 months."
def test_elo_reason():                           # ratings 1560 v 1500, p_a 0.586 → ["A is rated higher, 1560 to 1500."]; p_a 0.505 → []
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest ml/sports/ufc/reasons_test.py -p no:cacheprovider -o addopts="" -q` — expected: import error.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): templated reasons from the largest factors`.

### Task 6: Generate predictions (append-only, frozen at lock)

**Files:**
- Create: `pipeline/sports/ufc_predict.py`
- Test: `pipeline/sports/ufc_predict_test.py`

**Interfaces:**
- Consumes: `load_history`, `to_record` (Task 1); `snapshots` (Task 2); `UfcParams`, `load_params`, `predict_form`, `contributions` (Task 3); `method_table`, `WINDOW_YEARS` (Task 4); `form_reasons`, `elo_reasons` (Task 5); `final_ratings` (Task 1); `build` from `pipeline/sports/ufc_testkit.py` in tests.
- Produces:

```python
@dataclass
class GenerateSummary: candidates: int = 0; written: int = 0; locked_skipped: int = 0; ratings_updated: int = 0
def lock_time(bout: UfcBout) -> datetime | None
def generate(db: Session, params: UfcParams | None = None, now: datetime | None = None) -> GenerateSummary
```

Rules:
- `lock_time`: the earlier of `_utc(locked_at)` and `_utc(scheduled_utc)` when both are set; whichever is set otherwise; `None` when neither.
- Ratings: `final_ratings(history, params.elo, at=now)`; set `UfcFighter.rating` where it differs from the stored value by more than `1e-9`. Fighters without an applied bout keep their stored rating. The model never reads this column back.
- Candidates: bouts with `status == "scheduled"`, `scheduled_utc` not null and `now < lock_time(bout)`. Bouts that are scheduled but at or past lock count in `locked_skipped`.
- One `snapshots(history, params.elo, targets=[to_record(b) for b in candidates])` call; one `method_table(history.bouts, now − 10 years, now)` (10 years = `timedelta(days=round(365.25 * WINDOW_YEARS))`).
- Per candidate, the Elo row: `p_a = snap.p_elo`, reasons `elo_reasons`. The form row, only when `params.form` is not `None`: `p_a = predict_form(params.form, snap.x)`, reasons `form_reasons(..., contributions(params.form, snap.x), p_a)`. Both rows: `p_b = 1 − p_a`, `method_probs = table.probs(weight_class, scheduled_rounds)`, `is_shadow=True`, `created_at=now` (set explicitly, not the server default), `model_version` from the params.
- `_write_prediction(db, bout, version, p_a, method_probs, reasons, now) -> bool`: HARD GUARD inside it: returns False unless `bout.status == "scheduled"` and `lock_time(bout)` is not `None` and `now < lock_time(bout)`. Writes when there is no row for `(bout_id, model_version)`, or the latest one (by `created_at`, then `id`) differs: `|p_a − latest.p_a| > 1e-9`, any method probability differs by more than `1e-9` or a key differs, or `reasons` differs.
- One commit at the end of `generate`. Logging: counts only.

- [ ] **Step 1: Write failing tests** (all with `params = UfcParams(EloParams(k=80, history_from=1993), FORM)` where `FORM` is a hand-made `FormParams` with weight 1.0 on `elo_diff`, scale 100, zero elsewhere, and `NOW = 2026-12-01T00:00Z`):

```python
def test_writes_one_row_per_model_for_an_open_bout(db_session):
    # history: A beats B 2026-01-01; scheduled A v C at 2026-12-05T18:00
    s = generate(db_session, params, now=NOW)
    rows = rows_for(c_bout)
    assert s.written == 2 and {r.model_version for r in rows} == {"ufc-elo-v0.1", "ufc-form-v0.2"}
    elo = row("ufc-elo-v0.1"); assert elo.p_a == pytest.approx(0.557312, abs=1e-6) and elo.p_b == pytest.approx(1 - elo.p_a)
    form = row("ufc-form-v0.2"); assert form.p_a == pytest.approx(1 / (1 + math.exp(-0.4)))   # elo_diff 40 / scale 100
    assert all(r.is_shadow for r in rows) and set(elo.method_probs) == {"ko_tko", "submission", "decision"}
    assert sum(elo.method_probs.values()) == pytest.approx(1.0) and len(form.reasons) <= 3
    assert _utc(elo.created_at) == NOW

def test_second_run_writes_nothing(db_session):              # written == 0, row count unchanged
def test_an_intervening_result_writes_a_new_row(db_session): # A fights and loses to D on 2026-11-15 (added after the first run) → 2 more rows; first rows untouched
def test_no_prediction_at_or_after_lock(db_session):
    # bout at NOW exactly → none; bout at NOW + 1 day with locked_at = NOW - 1 min → none;
    # status "live" with a future time → none; summary.locked_skipped == 2
def test_replaced_opponent_predicts_only_the_new_revision(db_session):   # old row "changed", revision 1 "scheduled" → rows only on revision 1
def test_without_form_params_only_elo_rows(db_session):      # UfcParams(EloParams(...), None) → one row
def test_ratings_are_written_to_fighters(db_session):        # after A beats B: A.rating == 1540.0, B.rating == 1460.0; untouched fighter stays 1500.0
def test_mirrored_bout_gets_the_mirrored_probability(db_session):
    # two scheduled bouts, A v C and C v A, at the same future time → p_a of one == approx(1 - p_a of the other, abs=1e-12), both models
def test_bout_without_a_time_is_not_predicted(db_session):   # scheduled_utc None → no row, no error
```

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_predict_test.py -p no:cacheprovider -o addopts="" -q` — expected: import error.
- [ ] **Step 3: Implement `lock_time`, `_write_prediction` and `generate`.**
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): shadow predictions written before lock, append-only`.

### Task 7: Grade, and the CLI

**Files:**
- Modify: `pipeline/sports/ufc_predict.py` (add `grade`, `main`)
- Test: `pipeline/sports/ufc_predict_test.py` (add tests)

**Interfaces:**
- Consumes: `lock_time` (Task 6); `UfcPredictionResult`.
- Produces: `grade(db: Session) -> int` (result rows written) and `main(argv: list[str] | None = None) -> int` — `python -m pipeline.sports.ufc_predict --generate --grade` (argparse; neither flag → `ap.error`; `SessionLocal`; generate before grade; on an exception in one step log it without row contents, roll back, continue to the next step; return 0).

Rules:
- Graded bouts: `status == "finished"` and `winner in ("a", "b")` (a DQ win counts). Draws, no contests, and every non-finished status are skipped.
- For each such bout and each `model_version` among its predictions: skip if a `UfcPredictionResult` exists for `(bout_id, model_version)`; the counting row is the latest by `created_at`, then `id`, among rows with `_utc(created_at) <= lock_time(bout)`; none → skip (and a bout whose `lock_time` is `None` is skipped).
- `prob_assigned` = the row's `p_a` if a won else `p_b`; `winner_correct = prob_assigned > 0.5` (a 0.5 call is not correct); `log_loss = −ln(max(1e-15, prob_assigned))`; `brier = (1 − prob_assigned) ** 2`.
- One commit at the end.

- [ ] **Step 1: Write failing tests:**

```python
def test_grades_the_latest_row_at_or_before_lock(db_session):
    # bout scheduled T; rows (elo) at T-2d p_a 0.6, at T-1d p_a 0.7, at T+1h p_a 0.9 (inserted directly); a wins
    assert grade(db_session) == 1
    r = result(); assert r.prob_assigned == pytest.approx(0.7) and r.winner_correct is True
    assert r.log_loss == pytest.approx(0.356675, abs=1e-6) and r.brier == pytest.approx(0.09) and r.prediction_id == row_t_minus_1d.id
def test_row_written_after_scheduled_start_never_counts(db_session):
    # locked_at = T + 30 min (as ufc_results stamps it); only row at T + 10 min → nothing graded
def test_each_model_is_graded_once(db_session):     # elo and form rows → 2 results; second grade() → 0
def test_draw_no_contest_cancelled_changed_are_skipped(db_session):
def test_dq_win_is_graded(db_session):              # method "dq", winner "b" → graded with p_b
def test_coin_flip_call_is_not_correct(db_session): # p_a 0.5, a wins → winner_correct False, log_loss == approx(0.693147)
def test_cli_requires_a_flag():                     # main([]) raises SystemExit
```

- [ ] **Step 2: Run** the test file — expected: the new tests fail.
- [ ] **Step 3: Implement `grade` and `main`.** `main` follows `pipeline/sports/nrl_predict.py`'s CLI shape and logs only counts.
- [ ] **Step 4: Run** — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): grade shadow predictions from the row that counted at lock`.

### Task 8: The evaluation harness, its report, and the first fitted parameters

**Files:**
- Create: `pipeline/sports/ufc_evaluate.py`
- Test: `pipeline/sports/ufc_evaluate_test.py`
- Modify (by running the harness, Step 6): `ml/sports/ufc/params.json`
- Create (by running the harness, Step 6): `docs/UFC-EVALUATION.md`

**Interfaces:**
- Consumes: Tasks 1–4 (`load_history`, `snapshots`, `elo_probs`, `fit_form`, `predict_form`, `method_table`, `method_pick`, `save_params`, `UfcParams`); `UfcOddsSnapshot`, `UfcBout`.
- Produces:

```python
ELO_GRID = {"k": (40.0, 60.0, 80.0, 100.0, 120.0), "history_from": (1993, 2005, 2010, 2016), "decay": (0.0, 0.1, 0.2)}
FORM_GRID = {"window_years": (3, 5, 8), "c": (0.1, 1.0, 10.0)}
GATE_BRIER = 0.235
def implied(moneyline: int) -> float | None
def devig(ml_a: int, ml_b: int) -> float | None
def market_probs(db: Session) -> dict[int, float]                 # bout_id -> market p_a
@dataclass(frozen=True)
class Scored: n: int; accuracy: float; brier: float; log_loss: float
def score(pairs: Sequence[tuple[float, int]]) -> Scored | None     # (p_a, 1 if a won)
def calibration(pairs: Sequence[tuple[float, int]]) -> list[tuple[str, int, float, float]]   # (bucket, n, mean said, favourite won)
def picks_points(p_a: float, method_pick: str, winner: str, method: str | None) -> int
def gate(log_loss_by_year: Mapping[int, float], n_by_year: Mapping[int, int], pooled_brier: float) -> tuple[bool, str]
def tune_elo(history: History, tune_years: tuple[int, int]) -> EloParams
def choose_form_settings(history: History, snaps: Mapping[int, Snapshot], validation_year: int) -> tuple[int, float]
def run(db: Session, first_holdout: int = 2022, tune_years: tuple[int, int] = (2018, 2021),
        validation_year: int = 2021, params_path: Path | None = None, now: datetime | None = None) -> dict
def render_report(payload: dict) -> str
def main(argv: list[str] | None = None) -> int
```

CLI: `PYTHONPATH=backend:. .venv/bin/python -m pipeline.sports.ufc_evaluate --db <sqlalchemy url> --out <report.md> [--first-holdout 2022] [--write-params]`. It builds its own engine from `--db` (never `app.db`), on PostgreSQL pins a read-only transaction the way `nrl_evaluate._read_only_snapshot` does, writes nothing to the database, makes no network call, prints the gate lines and the report path, and returns 0 whether the gate passes or not. `--write-params` passes `params_path=DEFAULT_PARAMS_FILE`. The report never contains the database URL or any local path.

Protocol (`run`):
1. `history = load_history(db)`. Scored bouts are those with `winner` set; draws and no contests stay in the history and are never scored.
2. `tune_elo`: for every grid point (iteration order k, then history_from, then decay, each ascending), `elo_probs` and log loss over scored bouts with `when.year` in `tune_years` inclusive; the lowest wins; an exact tie keeps the earlier grid point. Uses no bout from `first_holdout` on.
3. `snaps = snapshots(history, elo)` once.
4. `choose_form_settings`: for each `(window_years W, c)` in grid order, fit on scored bouts with year in `[validation_year − W, validation_year − 1]`, log loss on `validation_year`; lowest wins, ties keep the earlier point.
5. Held-out years: every year from `first_holdout` to the latest year with a scored bout. For held-out year `T`, fit the form model on scored bouts with year in `[T − W, T − 1]` (`train_from = Jan 1 of T − W`, `train_to = Dec 31 of T − 1`), predict every scored bout in `T`. Elo predictions are `snaps[id].p_elo`. The method table for year `T` is `method_table(history.bouts, Jan 1 of T − 10, Jan 1 of T)`.
6. Baselines per year and pooled: coin flip (`p_a = 0.5`, accuracy reported as 50.0%) and "higher rating at 50/50" (`p_a = 0.5`, accuracy = share of bouts the higher pre-bout Elo rating won, equal ratings counted wrong).
7. Market subset: bouts in `market_probs`. `market_probs` takes, per bout and source, the latest `UfcOddsSnapshot` with `taken_at <= scheduled_utc`; a snapshot whose moneyline is not ≤ −100 or ≥ +100 on both sides is ignored; `implied(+x) = 100/(x+100)`, `implied(−x) = x/(x+100)`; `devig = ia/(ia + ib)`; the bout's market `p_a` is the plain mean over sources. On that subset report market, Elo and form side by side.
8. Method: method-pick accuracy over scored bouts whose method is in `METHODS` (pick == actual, regardless of the winner call). Picks game per model: `picks_points` summed over scored bouts, reported as total and points per fight: 5 when the winner call is right and the method pick equals the actual method, 2 when only the winner is right (a DQ or `other` win can earn 2 at most), 0 otherwise; `p_a == 0.5` is no call and scores 0.
9. Accuracy: share of bouts where `p_a > 0.5` and a won, or `p_a < 0.5` and b won; `p_a == 0.5` counts wrong. Calibration: bucket the favourite probability `max(p, 1 − p)` by `min(int(fav * 20), 19)` into `"50–55"` … `"95–100"`; per bucket `n`, mean favourite probability, share the favourite won.
10. Gate per model: take the three most recent held-out years with at least 100 scored bouts; PASS when the model's log loss is below `ln 2 = 0.693147` (coin flip, and equally the 50/50 baseline, whose log loss is the same by definition) in at least two of them, and its pooled Brier over all held-out years is `<= 0.235`; fewer than three such years → FAIL with that reason. The line reads exactly `GATE ufc-form-v0.2: PASS (log loss below 0.6931 in 2 of 3: 2024 2025 2026; pooled Brier 0.2310 <= 0.235)` with the values filled in, `FAIL` and the failing reason otherwise.
11. When `params_path` is set: fit the form model with the chosen `(W, c)` on scored bouts with `now − W years <= when < now`, `fitted_on = now.date()`, and `save_params(UfcParams(elo, form), params_path)`.

Report sections, in order: title and generation date with git commit; protocol paragraph (steps above in prose, including that 2026 is a partial year); data counts (bouts, scored bouts, fighters, years, bouts with a price); chosen Elo parameters and form settings; per model a table year | fights | accuracy | Brier | log loss, plus pooled; baselines table; market comparison table per year and pooled; pooled calibration table per model; method-pick accuracy; picks-game score; the gate lines; the exact commands from Step 6 under "How to reproduce" with `<raw dir>` and `<db file>` placeholders.

- [ ] **Step 1: Write failing tests:**

```python
def test_implied_and_devig():
    assert implied(150) == pytest.approx(0.4) and implied(-200) == pytest.approx(2 / 3)
    assert devig(150, -200) == pytest.approx(0.375) and devig(50, -200) is None
def test_market_uses_latest_snapshot_before_start_averaged_over_sources(db_session):
    # bout at T; DraftKings (150, -200) at T-2h, DraftKings (300, -400) at T+1h (ignored); Other (100, -100) at T-1d
    assert market_probs(db_session)[bout.id] == pytest.approx((0.375 + 0.5) / 2)
def test_score_by_hand():
    s = score([(0.8, 1), (0.4, 0)])
    assert (s.n, s.accuracy) == (2, 1.0) and s.brier == pytest.approx(0.1) and s.log_loss == pytest.approx(0.366985, abs=1e-6)
def test_calibration_buckets():                 # (0.52, 1) and (0.3, 0) → buckets "50–55" (fav 0.52, won 1.0) and "70–75" (fav 0.7, won 1.0)
def test_picks_points():
    assert picks_points(0.7, "decision", "a", "decision") == 5 and picks_points(0.7, "ko_tko", "a", "decision") == 2
    assert picks_points(0.3, "decision", "a", "decision") == 0 and picks_points(0.5, "decision", "a", "decision") == 0
    assert picks_points(0.7, "decision", "a", "dq") == 2
def test_gate():
    ok, line = gate({2024: 0.68, 2025: 0.70, 2026: 0.69}, {2024: 500, 2025: 500, 2026: 400}, 0.234); assert ok
    assert not gate({2024: 0.68, 2025: 0.70, 2026: 0.69}, {...}, 0.236)[0]
    assert not gate({2024: 0.70, 2025: 0.70, 2026: 0.69}, {...}, 0.20)[0]
    assert not gate({2025: 0.60, 2026: 0.60}, {2025: 500, 2026: 500}, 0.20)[0]          # fewer than three years
def test_tune_elo_picks_the_lowest_log_loss_and_breaks_ties_early():
    # monkeypatch ELO_GRID to two k values that give identical probabilities on a history where every bout is a debut pairing → the first is chosen
def test_run_end_to_end_without_writing(db_session, tmp_path):
    # seeded synthetic history (random.Random(7)): 16 fighters with hidden skill, 60 bouts a year 2014–2024, winner drawn from
    # logistic(skill difference), every bout with stats, a price on half of the 2022–2024 bouts
    counts_before = table_counts(db_session)
    payload = run(db_session, first_holdout=2022, tune_years=(2017, 2019), validation_year=2020, params_path=tmp_path / "p.json")
    assert table_counts(db_session) == counts_before
    assert sorted(payload["years"]) == [2022, 2023, 2024]
    assert payload["models"]["ufc-elo-v0.1"]["pooled"]["n"] == scored_from_2022 == payload["models"]["ufc-form-v0.2"]["pooled"]["n"]
    assert payload["market"]["n"] == priced_from_2022
    report = render_report(payload)
    assert "GATE ufc-elo-v0.1:" in report and "GATE ufc-form-v0.2:" in report and "sqlite" not in report
    assert load_params(tmp_path / "p.json").form is not None
def test_cli_writes_the_report(tmp_path):       # a file SQLite DB made with Base.metadata.create_all + the synthetic history; main(["--db", url, "--out", str(out)]) == 0 and out exists
```

The keys `payload["years"]`, `payload["models"][version]["pooled"]["n"]` and `payload["market"]["n"]` are the payload contract the tests rely on; the rest of the payload shape is the implementer's.

- [ ] **Step 2: Run** `.venv/bin/python -m pytest pipeline/sports/ufc_evaluate_test.py -p no:cacheprovider -o addopts="" -q` — expected: import error.
- [ ] **Step 3: Implement** `ufc_evaluate.py`.
- [ ] **Step 4: Run** — expected: pass. Then `.venv/bin/python -m pytest ml/sports/ufc pipeline/sports -k ufc -p no:cacheprovider -o addopts="" -q` — expected: pass.
- [ ] **Step 5: Commit** `feat(ufc): walk-forward evaluation harness with market comparison and gate`.
- [ ] **Step 6: Run it on the real history.** The spike's raw download lives outside the repo at `~/Projects/fw-ufc-spike/history/raw` (ask the controller if it is missing; never copy it into the repo). The Alembic chain does not run on SQLite, so the throwaway database's tables are created with `Base.metadata.create_all`:

```bash
cd <worktree>
export PYTHONPATH=backend:.
DB="sqlite:///${TMPDIR:-/tmp}/ufc-history.db"
rm -f "${TMPDIR:-/tmp}/ufc-history.db"
.venv/bin/python -c "import sys; from sqlalchemy import create_engine; import app.models; from app.db import Base; Base.metadata.create_all(create_engine(sys.argv[1]))" "$DB"
DATABASE_URL="$DB" .venv/bin/python -m pipeline.sports.ufc_backfill --raw ~/Projects/fw-ufc-spike/history/raw --to 2026-11-25
.venv/bin/python -m pipeline.sports.ufc_evaluate --db "$DB" --out docs/UFC-EVALUATION.md --write-params
```

Expected: the backfill logs `failed=0` and about 9,500 finished bouts; the evaluation prints two `GATE` lines. Sanity check before committing: the Elo rows for 2022 on should land near the spike's numbers (accuracy 56–59%, Brier 0.240–0.244), and the market subset near 2,330 bouts with Brier near 0.205. If the Elo numbers are far off, stop and report instead of committing. Whatever the gate says, commit the report and the parameters; the gate result goes in the commit message body.
- [ ] **Step 7: Run** `.venv/bin/python -m pytest ml/sports/ufc/params_test.py -p no:cacheprovider -o addopts="" -q` — expected: pass with the new file (`load_params().form` is not `None`).
- [ ] **Step 8: Commit** `docs(ufc): first walk-forward evaluation and fitted parameters` with `git add docs/UFC-EVALUATION.md ml/sports/ufc/params.json`.

### Task 9: Workflow wiring, the public-model setting, and the full suite

**Files:**
- Modify: `.github/workflows/ufc-refresh.yml` (one step after the results step)
- Modify: `backend/app/config.py` (after `ufc_provider`)
- Modify: `.env.example` (after `UFC_PROVIDER=espn`)
- Test: `pipeline/sports/ufc_predict_test.py` (add tests)

**Interfaces:**
- Consumes: `main` of `pipeline/sports/ufc_predict.py` (Task 7).
- Produces: setting `ufc_public_model: str = ""` with the comment `# Which UFC model version is shown to visitors; empty means none. Nothing reads it yet (phase 4).`; `.env.example` lines `# Which UFC model is public (empty = none; shadow only until the gate passes).` and `UFC_PUBLIC_MODEL=`.

Workflow step, appended after "Record UFC results, stats and odds (idempotent)":

```yaml
      - name: Predict and grade UFC bouts (shadow, idempotent)
        # Additive layer: a model failure must not fail the data refresh.
        continue-on-error: true
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          PYTHONPATH: backend:.
        run: python -m pipeline.sports.ufc_predict --generate --grade
```

- [ ] **Step 1: Write failing tests:**

```python
def test_workflow_predicts_after_results():
    steps = yaml.safe_load(WORKFLOW.read_text())["jobs"]["ufc-refresh"]["steps"]
    runs = [s.get("run", "") for s in steps]
    i_results = next(i for i, r in enumerate(runs) if "ufc_results" in r)
    i_predict = next(i for i, r in enumerate(runs) if "ufc_predict --generate --grade" in r)
    assert i_predict == i_results + 1 and steps[i_predict]["continue-on-error"] is True
def test_public_model_setting_defaults_to_none():
    from app.config import Settings
    assert Settings(_env_file=None).ufc_public_model == ""
def test_env_example_lists_the_setting():       assert "UFC_PUBLIC_MODEL=" in (ROOT / ".env.example").read_text()
```

- [ ] **Step 2: Run** the test file — expected: the three new tests fail.
- [ ] **Step 3: Make the three edits.**
- [ ] **Step 4: Run** the test file — expected: pass. Then `grep -rn "ufc_public_model" backend pipeline ml` — expected: only `backend/app/config.py` and the test.
- [ ] **Step 5: Run the whole Python suite:** `.venv/bin/python -m pytest -p no:cacheprovider -o addopts="" -q` — expected: no failures; paste the summary line in the report.
- [ ] **Step 6: Commit** `feat(ufc): predict and grade in the daily refresh; UFC_PUBLIC_MODEL setting`.
