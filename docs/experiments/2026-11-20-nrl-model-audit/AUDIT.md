# NRL model audit — 2026-11-20

Scope: the NRL winner model (`nrl-elo-v0.1`, `ml/sports/nrl/params.json`), the NRL score model
(`nrl-score-v0.1-shadow`), and the data and forecast recording around them. The football audit is a
separate document (`docs/experiments/2026-11-20-football-model-audit/`).

Everything here was done on a local copy. Nothing was committed, pushed, deployed or written to
production. Branch `audit/nrl-model-2026-11`, cut from `main` at `5b5012a`.

## Recommendation

**Keep the winner model (`nrl-elo-v0.1`) as it is. Do not refit yet.** A wider-grid refit was
0.0015 better on log loss over eight held-out seasons, with a 95% interval of −0.0065 to +0.0035,
and better in only 4 of 8 seasons. That fails the gate written in section 5a before it was run.
Neither upgrade passed either: one was worse than the refit, and the other earns "collect more
evidence" against the incumbent under the pre-set rules, which means recorded, not shipped.

**Change four things around the model**, all built and tested locally (section 6):

1. Serve the winner model's margin instead of the score model's. The score model's margin is what
   users see today; it is 0.43 points worse (interval +0.14 to +0.71) and points against the site's
   own win-probability favourite in 216 of 852 matches.
2. Correct three wrong final scores and add the nine missing 2017 finals, through a short reviewed
   corrections list in the ingest.
3. Make the backtest gate follow the calendar. It was hard-coded to 2023–2025 and never scored 2026.
4. Apply the off-season rating reset before a new season's first predictions. Serving skipped it
   until round 1 had been played, which the independent review of this audit found (section 2).

**The largest forecasting loss this season was operational, not statistical.** Four finals matches
got no prediction at all because GitHub Actions was blocked from 11 to 30 September (section 3).
Separately, seven predictions were made before an earlier result had been ingested (section 2); I
did not establish how many of those seven the outage caused.

**Market comparison is blocked** (section 5): there is no licensed NRL odds archive. It needs a
decision on a data source.

## 1. Data reconciliation

Sources, all fetched 2026-11-20:

| Source | What | Rows |
| --- | --- | --- |
| fixturedownload.com feed (`pipeline.sports.nrl_ingest --seasons 2017 2026`) | what the pipeline ingests | 2,017 |
| Production database, via `GET /api/nrl/matches?season=YYYY` | what the site serves | 2,017 |
| NRL.com draw data (`fetch_official_results.py`) | official results | 2,026 full-time |
| Wikipedia season pages | third source for disputed rows only | — |

Data cutoff: 2026-10-04 (2026 grand final). Every season 2017–2026 is complete; nothing is scheduled.

**Feed vs production: identical.** Same 2,017 matches; no difference in teams, scores, status,
kickoff or venue. The Actions outages left no hole in the results.

**Feed vs official results: 2,016 of 2,017 feed matches match an official result**, with no kickoff
more than an hour apart. The differences:

| Finding | Feed | NRL.com | Wikipedia | Action |
| --- | --- | --- | --- | --- |
| 2018 R7 Rabbitohs v Raiders | 42–18 | 42–22 | 42–22 | corrected |
| 2019 R17 Panthers v Titans | 21–2 | 24–2 | 24–2 | corrected |
| 2026 R27 Sharks v Storm | 20–23 | 20–24 | 20–24 | corrected |
| 2017 finals series, 9 matches | absent (feed stops at round 26) | present | present | added |
| 2018 grand final home side | Storm (6–21) | Roosters (21–6) | Roosters listed first | **not changed** |

None of the three score errors changes a winner. The 2018 grand final was at a neutral venue; the
feed gives the home-advantage term to the wrong side for that one match. Swapping the teams on an
existing row is a larger change than a score fix and is left as an open item.

**Internal checks on the feed:** no duplicates, no finished match without a score, no two matches
sharing a kickoff, 5 draws in ten seasons. One team identity split: `Tigers` (2017–2018) and
`Wests Tigers` (2019–). The evaluation harness merges them; the serving replay does not. The effect
on 2026 predictions is below 0.00001 in win probability, so serving was left alone.

Output: `audit_data.out.txt`.

## 2. Live versus replay

Production holds 76 graded NRL predictions, all `nrl-elo-v0.1`, from 2026-07-09 (round 19) to the
grand final.

| | n | Log loss | Brier | Accuracy |
| --- | --- | --- | --- | --- |
| Live, as stored in production | 76 | 0.6589 | 0.4532 | 64.47% |
| Replay, using results known when each prediction was created | 76 | 0.6589 | 0.4532 | 64.47% |
| Replay, using every result before kickoff | 76 | 0.6575 | 0.4519 | 64.47% |

- **All 76 live probabilities and margins reproduce exactly** (difference under 1e-9) from a local
  replay of the feed with the shipped parameters. The public record (`/api/nrl/model/record`) is
  reproduced to four decimals. The serving path does what the code says.
- **Seven of the 76 were stale at kickoff**: they were created before an earlier result had been
  ingested. The largest shift was 0.06 in home-win probability. Cost: 0.0014 log loss on this sample.
- Lead time from prediction to kickoff: median 20 hours, range 0.6 to 208 hours. None was created
  after kickoff.
- **Limit of this check, found in review:** the 76 predictions start at round 19, so they could not
  show a defect in round 1. There is one. `_current_elos` applies the off-season regression only
  when a finished match of the new season appears, so predictions made before round 1 is played use
  last season's closing ratings. The tuner and both backtests regress first. The reviewer measured
  the gap with the shipped parameters: 0.04–0.06 in home-win probability on average for round 1, up
  to 0.11, in each season 2019–2026. It would have applied to the 2027 opener. Fixed in section 6.
  It does not affect the candidate comparison, where every recipe is scored the same way.

## 3. Forecast recording

**Four finals matches have no prediction**, so they are missing from the public record, which
reports 76 evaluated matches without saying that 80 were played in that period:

| Round | Match | Kickoff (UTC) |
| --- | --- | --- |
| 29 (finals week 2) | Roosters v Sharks | 2026-09-19 09:50 |
| 29 | Warriors v Knights | 2026-09-20 06:05 |
| 30 (finals week 3) | Dolphins v Roosters | 2026-09-25 09:50 |
| 30 | Panthers v Knights | 2026-09-27 06:00 |

Cause, verified from the Actions run history: every `nrl-refresh` run from 2026-09-11 to 2026-09-29
failed without starting, with the account-billing message. Runs succeeded up to 09-10 and again from
10-01. This is the same monthly exhaustion of the 2,000 free Actions minutes that stopped all
workflows on 17 October and 16 November. The fix for that is on branch `fix/actions-minutes-budget`,
not here. A frozen prediction cannot be backfilled after kickoff, by design.

## 4. Current model on the existing harness

Commands in section 8. Corrected data, seasons 2023–2026, 852 matches, parameters tuned per fold
by the existing recipe.

| Gate (from `docs/NRL-EVALUATION.md`) | Model | Baseline | Paired difference (95% interval) | Result |
| --- | --- | --- | --- | --- |
| Winner log loss vs Elo-favourite | 0.6748 | 0.6903 | −0.0156 (−0.0370, +0.0057) | FAIL: interval crosses zero; better in 3 of 4 seasons |
| Margin MAE vs Elo margin | 14.62 | 14.17 | +0.45 (+0.14, +0.75) | FAIL: worse in 4 of 4 seasons |
| Total MAE vs rolling mean | 11.00 | 11.19 | −0.20 (−0.41, +0.02) | FAIL: under the 5% bar |
| Scoreline MAE vs rolling | 9.14 | 9.30 | −0.16 (−0.29, −0.04) | FAIL: under the 5% bar; margin regression |

Reading:
- The winner model is clearly better than "always home" (0.7072) and better than the favourite
  baseline on the point estimate, but four seasons do not prove it at 95%. In 2026 alone it tied the
  favourite baseline on log loss (0.6730 vs 0.6728) while beating it on Brier (0.4697 vs 0.4770).
- The simple gate in `pipeline.sports.nrl_backtest` passes (2 of 3 seasons). Before this audit it
  was hard-coded to 2023–2025 and had never scored 2026.
- The per-fold tuner picked `k = 24`, the smallest value on its grid, in 7 of 8 folds. The grid is
  truncated on that side. That is what the refit candidate tests.
- The score model is correctly unpromoted. Its total and scoreline are hidden behind
  `NRL_SCORE_MODEL_PROMOTED`. **Its margin is not hidden**: `predicted_margin` is served by
  `/api/nrl/matches/{id}` and quoted in the preview text.

## 5. Market comparison — blocked

Production has no NRL closing-line archive (`market_source: None` in the harness inventory, 0%
coverage in every season). The prediction-market capture covers "only thin NRL coverage" per its
own workflow notes, and the public API exposes no NRL prices for the 76 graded matches.

What would unblock it: a decision on a historical odds source. A free public archive of NRL closing
odds exists (aussportsbetting.com), but its terms for use by a commercial product have not been
checked, and `docs/NRL-EVALUATION.md` requires a licensed source. I did not download it. Until
then, "is the model better than the market" is unanswered for NRL; the harness already has the slot
for market rows and reports them only above 70% pre-kickoff coverage.

## 5a. Decision criteria (written before any candidate was run)

Written 2026-11-20 after the data checks (sections 1–3) and one run of the existing harness
(section 4), and **before** any refit or upgrade candidate was fitted or scored.

**What is already known at this point, and so cannot be called blind:** the existing harness,
run on 2023–2026, shows the per-fold tuner choosing `k = 24` (the smallest value on its grid) and
`season_regress = 0.35` (the largest) in all four folds, and shows the score model's margin losing
to the plain Elo margin in 4 of 4 seasons. Those two observations are why a wider-grid refit and a
margin fix are on the candidate list. No candidate's performance has been seen.

### Protocol

- Data: fixturedownload.com results 2017–2026 (2,017 finished matches), `Tigers` merged into
  `Wests Tigers`, cutoff 2026-10-04 (grand final). Reconciled in sections 1–2.
- Nested walk-forward. For each test season `T` in 2019…2026 a recipe may use only seasons `< T`
  to choose parameters, then predicts season `T` match by match, updating ratings after each result.
  8 test seasons, 1,612 matches. *(Erratum, added after the run: the count is 1,624. Nothing else in this section was changed after the candidates were run.)*
- Primary metric: three-way log loss. Secondary: Brier, accuracy, expected calibration error (ECE,
  10 equal-width bins on the home-win probability).
- Uncertainty: paired differences, 10,000 bootstrap resamples of `(season, round)` clusters,
  seed 2026 — the harness's own `cluster_bootstrap_ci`.

### Recipes

| Id | What it is |
| --- | --- |
| R0 | The incumbent recipe: `ml.sports.nrl.backtest.tune` (train ≤ T−2, validate on T−1, its built-in grid). Its fold for T = 2026 **is** the shipped `nrl-elo-v0.1` parameter set. |
| R1 | Refit, same model: coordinate descent on the pooled walk-forward log loss of every season before `T` except the first (burn-in), on a wider grid — `k` 8…44, `home_adv` 15…80, `margin_mult_cap` 1.0…3.0, `season_regress` 0.15…0.65. `p_draw` is not searched: it is the draw rate of the seasons before `T`, floored at 0.004. |
| R2 | Upgrade: R1 plus one probability-sharpness parameter τ (prediction-time only; the rating update is unchanged), searched on 0.8…1.3. |
| R4 | Upgrade: R1 with the margin multiplier damped by the pre-match rating gap (`mult × 2.2 / (0.001·|gap| + 2.2)`), no new parameter. |

Not attempted, declared now: a venue-aware home advantage (R3). The feed has 90 venue strings with
sponsor renames (three names for Jubilee Stadium alone); it needs a venue alias table first.

### Gates

**Refit (R1 replaces the shipped parameters)** — all four:
1. pooled Δ log loss (R1 − R0) over 2019–2026 is negative and its 95% interval's upper bound is ≤ 0;
2. R1 is better than R0 in at least 5 of the 8 seasons;
3. on 2026 alone, R1 is not worse than the shipped parameters by more than 0.002;
4. pooled ECE is not worse than R0's by more than 0.01.

**Upgrade (R2 or R4)** — the same four tests against R1 (against R0 if R1 fails its gate), and the
upgrade must pass them itself; a tie goes to the simpler model.

**Collect more evidence** — the point estimate favours the candidate and tests 2–4 pass, but the
interval in test 1 crosses zero. The candidate is recorded, not shipped.

**Keep** — anything else.

**Score-model margin.** No new criterion: `docs/NRL-EVALUATION.md` already sets the margin gate
(≥ 5% lower MAE than the Elo margin, most seasons, interval not above zero). If the score model
fails it, the audit checks whether anything user-visible depends on that margin.

Multiplicity: three candidates are compared with unadjusted 95% intervals. R1 is the primary,
pre-declared comparison; R2 and R4 are secondary and are read with that in mind.

### Addendum to the criteria — margin source (written before computing it)

The harness compares the score model's margin only with the winner model's built-in margin
(`expected_margin` = 0.045 × rating gap including home advantage). There is a third option already
in the repo and currently unused by serving: the fitted line in `ml/models/nrl_model_params.json`
(`nrl-elo-v0.2`, slope and intercept fitted by least squares). Before computing it: the built-in
Elo margin is the default replacement; the fitted line is preferred only if, refitted on seasons
before each test season, its MAE is lower than the built-in margin's with a paired 95% interval
entirely below zero over 2023–2026.

## 5b. Candidate results

Corrected data, 2019–2026, 1,624 matches. Output: `candidates.out.txt`, `results.json`. The same
run on the uncorrected feed is in `candidates.uncorrected.out.txt`; the verdicts are the same.

Log loss by season:

| Season | n | R0 incumbent recipe | R1 refit | R2 refit + sharpness | R4 refit + damped margin |
| --- | --- | --- | --- | --- | --- |
| 2019 | 201 | 0.6824 | 0.6840 | 0.6819 | 0.6815 |
| 2020 | 169 | 0.6122 | 0.6284 | 0.6284 | 0.6296 |
| 2021 | 201 | 0.5393 | 0.5446 | 0.5446 | 0.5442 |
| 2022 | 201 | 0.5987 | 0.5885 | 0.5885 | 0.5956 |
| 2023 | 213 | 0.6618 | 0.6530 | 0.6530 | 0.6595 |
| 2024 | 213 | 0.6760 | 0.6770 | 0.6770 | 0.6758 |
| 2025 | 213 | 0.6883 | 0.6805 | 0.6825 | 0.6855 |
| 2026 | 213 | 0.6730 | 0.6676 | 0.6718 | 0.6666 |
| **Pooled** | 1,624 | **0.6430** | **0.6415** | 0.6421 | 0.6434 |

Pooled secondary metrics: accuracy R0 66.1%, R1 65.8%; Brier R0 0.4356, R1 0.4361; ECE R0 0.026,
R1 0.017.

Gates:

| Comparison | Δ log loss (95% interval) | Seasons better | 2026 vs shipped | Verdict |
| --- | --- | --- | --- | --- |
| R1 − R0 (primary) | −0.0015 (−0.0065, +0.0035) | 4 of 8 | −0.0054 | **FAIL** (tests 1 and 2) |
| R2 − R1 | +0.0006 (−0.0004, +0.0016) | 1 of 8 | — | FAIL |
| R4 − R1 | +0.0019 (+0.0001, +0.0036) | 4 of 8 | — | FAIL (worse than R1) |
| R2 − R0 | −0.0009 (−0.0058, +0.0039) | 5 of 8 | −0.0013 | collect more evidence |
| R4 − R0 | +0.0004 (−0.0043, +0.0052) | 6 of 8 | −0.0064 | FAIL |

Reading:
- **No candidate qualifies.** The refit's edge (0.0015) is about a third of its interval's
  half-width (0.005). Resolving a difference that small at this variance would take roughly ten
  times the matches that exist.
- R2 against the incumbent is "collect more evidence" by the rules as written, and that is its
  verdict. My reading, made after seeing the results and so not part of the gate: the sharpness
  parameter settles at 1.0 (no change) when fitted on all ten seasons, although the 2025 and 2026
  folds chose 0.9. It is recorded and not shipped either way.
- A bias worth knowing, found in review: R1, R2 and R4 start their search from the shipped
  parameters, which were tuned with 2024–2025 data. That is mild hindsight in the earlier folds and
  it favours the refit. The refit failed anyway, so "keep" is the conservative reading.
- Not a gate result, noted after the fact: the refit lost in the three earliest folds, when it had
  two to four seasons to fit on, and won three of the last four. That is what one would expect if the
  wider grid only pays off with more history. It is a reason to rerun this exact comparison after the
  2027 season, not a reason to ship now.
- For the record, the parameters R1 would ship for 2027: `k` 16, `home_adv` 45, `margin_mult_cap`
  3.0, `season_regress` 0.45, `p_draw` 0.004 (shipped: 24, 45, 1.8, 0.35, 0.008). Not applied.

### Margin source

Corrected data, 2023–2026, 852 matches, shipped winner parameters. Output: `margin_check.out.txt`.

| Margin | MAE | Bias | Picks the winner | Points against the win-probability favourite |
| --- | --- | --- | --- | --- |
| Winner model's built-in margin | 14.19 | −0.25 | 63.1% | 0 of 852 |
| Fitted line (`nrl-elo-v0.2` form, refitted per fold) | 14.25 | −0.05 | 63.0% | 17 of 852 |
| Score model (served today) | 14.62 | +0.08 | 59.8% | 216 of 852 |

- Score model − built-in: +0.43 MAE (+0.14, +0.71), worse in all four seasons.
- Fitted line − built-in: +0.06 (−0.03, +0.15). Not better, so by the addendum the built-in margin
  is the replacement.
- This check uses the shipped parameters for every season, which slightly favours the built-in
  margin in 2023–2025. The leak-free harness in section 4 reaches the same conclusion
  independently (+0.45, interval +0.14 to +0.75, worse in 4 of 4 seasons).
- `ml/models/nrl_model_params.json` (`nrl-elo-v0.2`) is read by nothing in the serving path since
  the score model replaced it in July; `predict_margin_total` has no callers. Left in place.

## 6. What was changed locally

| File | Change |
| --- | --- |
| `pipeline/sports/nrl_predict.py` | `predicted_margin` now comes from the winner model (`expected_margin`). Total and scoreline still come from the score model and stay hidden behind the promotion flag. A fixture in a later season than the last finished match is predicted from regressed ratings. |
| `pipeline/sports/nrl_result_corrections.py` (new) | Reviewed list: three score corrections and the nine 2017 finals rows. Pure function `apply_corrections`. |
| `pipeline/sports/nrl_ingest.py` | `main()` applies the corrections; `upsert_season` rewrites a stored final score only for a row carrying a reviewed correction. Every other finished row stays immutable. |
| `pipeline/sports/nrl_backtest.py` | Held-out seasons are the three most recent completed seasons in the database, not a fixed tuple. |
| `pipeline/sports/nrl_evaluate.py` | The loader labels SQLite's naive kickoffs as UTC, so the harness runs on a local copy. No effect on PostgreSQL. |
| Tests | `nrl_result_corrections_test.py` (new), `nrl_backtest_test.py` (new), additions to `nrl_ingest_test.py`, `nrl_predict_test.py`, `nrl_evaluate_test.py`. |

Verification:
- The new margin test, the season-reset test and the SQLite-loader test each fail on the previous
  code and pass on the new code.
- A malformed feed row passes through the corrections untouched; it cannot abort the ingest (a
  review finding, fixed and tested).
- The corrections were run against a fresh database (2,026 matches) and against a copy shaped like
  production (2,017 matches with the wrong scores): the second run created the nine finals and
  logged exactly three corrections; a third run changed nothing.
- Full Python suite from the worktree: see the PR description for the final run.
- Not run: the frontend checks (no frontend file changed).

What these changes do when shipped — each needs a "go":
- **Merging is the production write.** There is no separate step: the next scheduled `nrl-refresh`
  run ingests with the corrections, creating 9 rows for 2017 and updating 3 scores.
- Rating effect, measured by the reviewer with the shipped parameters: Storm +3.5 and Sharks −3.1
  Elo points, and at most 0.009 in home-win probability across all pairings.
- No graded prediction is rewritten and no winner changes, so the public record is unchanged. One
  already-graded row (2026 R27 Sharks v Storm) keeps a stored margin error computed from the old
  20–23 score, one point off; grading is append-only and does not regrade.
- The 2026 ladder points difference moves by one for Storm and Sharks, to the official figure.
- The margin change alters a served number (`predicted_margin`) and the preview sentence for every
  future NRL prediction. Win probabilities do not change, except for a new season's pre-round-1
  predictions, which now use reset ratings.
- If `NRL_SCORE_MODEL_PROMOTED` is ever turned on, the hidden scoreline (score model) would sit next
  to a margin from the winner model and could contradict it. The flag is off. A note is in
  `backend/app/config.py`: reconcile the two before promoting. The model version string is unchanged
  because the winner model is unchanged; say so if a version bump is wanted for the margin source.

## 7. Open items

| Item | Blocked on |
| --- | --- |
| Market comparison | A licensed or permitted NRL odds source (section 5) |
| Refit decision | More data: rerun `candidates.py` unchanged after the 2027 season |
| Venue-aware home advantage (R3) | A venue alias table: 90 venue strings with sponsor renames |
| 2018 grand final home/away orientation | A decision to edit team sides on an existing production row |
| State of Origin predictions skip the same season reset (`origin_predict.py`) | A separate small fix; three matches a year |
| If the feed ever publishes the 2017 finals itself under other numbers, they would be stored twice | Remove them from `MISSING_ROWS` and delete the hand-added rows first (noted in the module) |
| `Tigers` / `Wests Tigers` merge in the serving replay | Nothing; effect is below 0.00001, left for consistency work |
| Public record omits unpredicted matches (76 shown, 80 played) | A product decision on showing coverage in `/api/nrl/model/record` |
| Stale and missing predictions | The Actions budget fix (`fix/actions-minutes-budget`) and an NRL live trigger that does not depend on Actions |

## 8. Reproduce

Python 3.12 with `backend/requirements.txt`. From the repo root:

```bash
A=artifacts/nrl_backtests/audit-2026-11-20      # ignored by git
E=docs/experiments/2026-11-20-nrl-model-audit
export PYTHONPATH=backend:.

# 1. Local database from the public feed (with the reviewed corrections)
export DATABASE_URL="sqlite:///$PWD/$A/nrl_corrected.db"
python -c "from app.db import engine; from app.models import Base; Base.metadata.create_all(engine)"
python -m pipeline.sports.nrl_ingest --seasons 2017 2026
# (nrl.db in the outputs is the same build made before the corrections existed)

# 2. Production snapshot and official results (read-only)
for y in $(seq 2017 2026); do curl -s "https://pitchprophet-api.onrender.com/api/nrl/matches?season=$y" -o $A/prod/matches-$y.json; done
curl -s https://pitchprophet-api.onrender.com/api/nrl/model/record -o $A/prod/model-record.json
python $E/fetch_official_results.py --out $A/official --seasons 2017 2026

# 3. Reconciliation and live-versus-replay (against the uncorrected build)
python $E/audit_data.py --db $A/nrl.db --prod $A/prod --official $A/official/official_results.json

# 4. Existing harness and gate
python -m pipeline.sports.nrl_backtest
python -m pipeline.sports.nrl_evaluate --from-season 2023 --to-season 2026 --model-version nrl-score-v0.1-shadow

# 5. Candidates and margin source
python $E/candidates.py --db $A/nrl_corrected.db
python $E/margin_check.py --db $A/nrl_corrected.db \
  --predictions artifacts/nrl_backtests/nrl-score-v0.1-shadow-2023-2026-6347c5ee60c6/predictions.jsonl

# 6. Tests
python -m pytest -p no:warnings -o addopts=""
```

Configuration: shipped winner parameters `k` 24, `home_adv` 45, `margin_mult_cap` 1.8,
`season_regress` 0.35, `margin_slope` 0.045, `p_draw` 0.008; score model `NrlScoreParams()` defaults;
bootstrap 10,000 samples, seed 2026, clustered by `(season, round)`. Harness dataset fingerprint on
corrected data: `6347c5ee60c6`.
