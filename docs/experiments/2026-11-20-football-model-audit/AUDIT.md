# Football model audit — 2026-11-20

Working document for the post-restart audit of the served football models
(`poisson-elo-club-v0.3` for EPL / La Liga / Bundesliga, `poisson-elo-ucl-v0.2`
for the Champions League, both built on the `poisson-elo-v0.6` engine in
`ml/models/model_params.json`). Question: **keep, refit, upgrade, or collect
more evidence** — per competition — and implement locally whatever the
evidence supports.

Ground rules, inherited from `docs/MODEL-EXPERIMENTS.md`: decision criteria are
written down before any candidate is scored (section 2) and are not moved
afterwards; anything decided after seeing a result is labelled **post-hoc**;
odds are a benchmark only, never a label or feature; intervals are clustered.

Nothing in this audit leaves the machine: no commit, push, PR, deploy,
production write or model replacement. Worktree
`/Users/lobster/Projects/fw-football-audit`, branch
`audit/football-model-2026-11`, based on `origin/main` @ `5b5012a`
(2026-11-03, PR #266).

---

## 1. Inputs, cutoffs and provenance

| Input | Source | Captured (UTC) | Notes |
|---|---|---|---|
| Production fixtures + latest served prediction | `GET /api/matches/upcoming?competition={epl,laliga,bundesliga,ucl}` | 2026-11-20 ~01:25 | public, read-only |
| Production prediction history (every non-shadow row, `generated_at`) | `GET /api/predictions/{match_id}` for every finished or past-kickoff fixture (495 matches) | 2026-11-20 01:27–01:45 | 0.4 s spacing; 63 returned `404 no_prediction` |
| Production health | `GET /api/health` | 2026-11-20 ~01:25 | |
| Results + closing odds | `https://football-data.co.uk/mmz4281/{season}/{E0,SP1,D1}.csv`, seasons 1617…2627 | 2026-11-20 ~01:27 | 2627 = season to date; sha256 below |

Raw downloads live in `data/raw/football-audit-2026-11/` (git-ignored by the
repo's `data/raw/*` rule). They are not committed; the sha256 of the three
in-season files pins exactly what was scored:

```
d598a5f681e1a9a4acf9dad9fb203b68da6f67e2d195678dbe99e95fbba14593  E0_2627.csv  (100 matches)
b4c9a5cc1139f30dbd1026679c360de4626ce97fe64ae62ff1ff8ba3af0b7828  SP1_2627.csv (119 matches)
85b5ff5199866f452016473e927ff2431c05c7b2ae045b5edd3b7f5bb5847d2a  D1_2627.csv  (81 matches)
```

football-data.co.uk revises files in place (D0 found all 27 pinned captures
had drifted), so a later download may not reproduce these numbers byte for
byte. The 2627 files carry **no Pinnacle (`PSC*`) columns**; the closing
families present are `AvgC`, `MaxC`, `B365C`, `BFEC` (Betfair Exchange) and
several single books.

UCL has no football-data.co.uk file. Its results come from the production API
only, so UCL can be graded but cannot be reconciled against an independent
source or benchmarked against a market here.

---

## 2. Pre-registered decision criteria (written before any candidate was scored)

> **Provenance, stated plainly (added after review).** "Written before any
> candidate was scored" describes my working order in this session: this
> section was written, and its implementation details appended, before
> `candidates.py` first ran. Nothing in the file history evidences that —
> nothing here is committed, so there is no timestamped record a reader can
> check. Treat the ordering as an assertion by the author, not as audited fact.

### 2.1 Holdout

The **2026-27 season to date** is the holdout, as the ledger promised ("the
fresh holdout is the live 2026-27 season"). Every 2026-27 domestic match in the
football-data.co.uk files above, kickoff ≤ 2026-11-19, is scored. Nothing in
2026-27 is used to fit, select or tune any candidate. Seasons 2016-17…2025-26
are training data for every candidate (2025-26 was consumed as a confirmation
holdout in July; it is now ordinary history).

### 2.2 Candidates (fixed list, per domestic league)

| ID | Candidate | Fitted on |
|---|---|---|
| **C0** | Served parameters as replayed from public data: `poisson-elo-v0.6` engine (`beta` 0.0021, `rho` −0.06, international segmented calibrator) + the league's `pipeline/leagues.py` overrides (EPL `base` 1.30, Bundesliga `base` 1.44, La Liga none) and served `home_advantage` (60/80/60). No odds anchoring, no availability offsets (neither can be replayed from public data, and neither has had a live data source since 2026-08-18). | — (control) |
| **R1** | Refit of the same structure: per league, `home_adv` (grid 20–120 step 10) and `base` (1.10–1.80 step 0.02, on O/U 2.5 log loss), then `beta` (0.0010–0.0035 step 0.0001) and `rho` (−0.20–0.00 step 0.01) on 1X2 log loss, then the segmented calibrator refitted with equal-count q3 edges (the T1.6 `refit_q3` method). Grids are the pre-registered club-program grids. | 2016-17…2025-26, in-sample |
| **U1** | Upgrade: dynamic Dixon–Coles team-strength model (per-team attack and defence + home effect, Poisson GLM, exponentially time-decayed likelihood, ridge-shrunk to the league mean, `rho` −0.06), refitted before every matchweek on all matches strictly before it. Motivation: the model sits ~0.03 nats behind the closing line in all three leagues (Finding 1, D0), and Elo collapses attack and defence into one number. The decay half-life is selected from {90, 180, 365} days on the 2025-26 season (walk-forward, weekly refits); the ridge strength is fixed at 1.0 before any run. | ≤ the day before each scored matchweek |

Implementation details fixed before the first run:

- Ratings for C0 and R1 are a leak-free chronological Elo replay over
  2016-17…2026-27 (`ml.evaluation.club_walkforward.replay`, which delegates to
  the production `update_ratings`), so every 2026-27 match is priced from
  every result before it ("fresh" ratings — the model as designed).
- R1's in-sample fit loss excludes 2016-17 as Elo burn-in (every club starts
  at 1500 there). Coordinate order: `home_adv` → `base` → `beta` → `rho`, one
  pass, each at the previous steps' winners; calibrator fitted last on the
  uncalibrated triples of 2017-18…2025-26 (`club_calibration.fit_segmented`,
  `min_bucket` 200).
- U1: matches older than 4 half-lives are dropped from a fit; a club with no
  match in the fit window takes the mean attack/defence of the three fitted
  clubs with the lowest attack − defence (promoted-club prior). Refits happen
  once per ISO week on all matches dated before that week's Monday.

No other candidate may be added after the first scoring run without a
**post-hoc** label.

### 2.3 Metrics and intervals

- **Gate metric:** paired per-match Δ 1X2 log loss (candidate − C0) on the
  2026-27 holdout. Negative = candidate better.
- **Guard metric:** paired Δ O/U 2.5 log loss.
- **Interval:** bootstrap (2,000 resamples, seed 12345) resampling whole
  **matchweeks** (ISO calendar week of the match date), per league. Declared
  limitation, as in the July confirmation: matchweek clustering ignores
  season-level correlation and is anti-conservative; with one partial season
  there is no honest alternative.
- **Multiplicity:** two candidates per league → Bonferroni k=2, i.e. a 97.5%
  interval for the ship decision. The nominal 95% interval is also reported.
- **Market benchmark (not a gate):** de-vigged closing odds, family `AvgC`
  (market average closing: the repo's first-preference closing family in
  `pipeline/ingest/football_data.ODDS_FAMILIES`; `PSC` does not exist in
  2026-27 files), proportional de-vig. Sensitivity: `BFEC` (exchange closing,
  lowest margin) and Shin de-vig.

### 2.4 Decision rules (per league)

1. **UPGRADE** — U1's Bonferroni interval on Δ 1X2 lies entirely below 0 **and**
   U1's O/U Δ interval does not lie entirely above 0. → build a local release
   candidate.
2. **REFIT** — rule 1 fails, and the same test passes for R1. → build a local
   release candidate of the refitted parameters.
3. **COLLECT MORE EVIDENCE** — neither passes, but some candidate's point
   estimate favours it by ≥ 0.005 nats on 1X2 (a size the club program treated
   as material), or the live record cannot be trusted as a fair measure of the
   served model (live-vs-replay gap not explained by known causes). → keep
   serving C0, name the re-run date and the sample it needs.
4. **KEEP** — otherwise.
5. Data-quality and forecast-recording defects that make the live record
   untrustworthy are fixed locally regardless of rules 1–4: they are not model
   changes and do not go through the gate.
6. UCL: no market, no independent results source, and no public history to
   replay. It can be graded live only; it cannot earn REFIT or UPGRADE in this
   audit.

---

## 3. Data reconciliation (production API vs football-data.co.uk, 2026-27)

Source: `reconcile.py` → `reconcile_results.json`, `reconcile.out.txt`.
Every football-data.co.uk 2026-27 match with kickoff ≤ 2026-11-19 was matched
to production rows on the oriented canonical team pair.

| League | fd.co.uk matches | Prod rows (finished / scheduled) | Team names in prod | Missing in prod | Wrong score | Kickoff off by >30 min | fd matches with duplicate prod rows |
|---|---|---|---|---|---|---|---|
| EPL | 100 | 380 (100 / 280) | 20 | 0 | 0 | 0 | 0 |
| La Liga | 119 | **454** (121 / 333) | **22** | 0 | 0 | 0 | **24** |
| Bundesliga | 81 | **340** (81 / 259) | **19** | 0 | 0 | 0 | **9** |

Results that did land are right: no missing match, no wrong score, no wrong
kickoff in 300 domestic matches. The defects are all identity defects.

**D1 — duplicate club entities after the provider cutover (verified).**
football-data.org spells three promoted clubs differently from API-Football,
and `pipeline/team_mapping.py` on `main` has no alias for them, so the
2026-09-02 cutover created new `Team` rows and a full second fixture list for
each:

| Canonical club (API-Football) | football-data.org name | Duplicate fixtures |
|---|---|---|
| Racing Santander | Real Racing Club de Santander | 38 |
| Deportivo La Coruna | RC Deportivo La Coruña | 38 (74 for La Liga after the shared pair) |
| SV Elversberg | SV 07 Elversberg | 34 |

Consequences, each verified from the public payloads:

- 31 legacy rows (La Liga 22, Bundesliga 9) sit `scheduled` forever, kickoffs
  23 Aug – 8 Nov: their results arrive on the duplicate row instead.
- 2 matches were ingested **twice** as finished (Racing–Villarreal 16 Aug,
  Deportivo–Elche 17 Aug; legacy #487/#490 and duplicate #1261/#1262). Both
  copies feed `sync_finished_matches_to_history`, so Villarreal and Elche each
  got two Elo updates from one draw.
- Production rated the duplicate "RC Deportivo La Coruña" from the 1500 cold
  start instead of Deportivo's 2016-18 history (~1391–1422): ~+100 Elo on 7
  graded matches (section 6).
- The production frontend lists both fixture copies.

PR #265 ("Fix provider cutover fixture duplicates", open since 2026-09-06, CI
green, mergeable) adds exactly these three aliases plus `málaga cf` and a
dry-run-first transactional repair that keeps the legacy match ids. It was not
re-implemented here. Merging it and applying the repair against production
is a stop-gate action (section 10).

**D5 — 14 UCL play-off fixtures orphaned (verified).** UCL play-off ties of
18–26 Aug (e.g. #1249 Fenerbahçe–Lyon) were created by API-Football, which
lapsed on 18 Aug before their results; football-data.org does not carry
qualifying rounds. They stay `scheduled` for good, their results never reached
the Elo history, and they were re-predicted after kickoff on every run (D2).

**D4 — `/api/health` under-reported the stuck fixtures (verified, fixed
locally).** Health said "20 match(es) still scheduled". The true count is
**45** (La Liga 22 + Bundesliga 9 + UCL 14, matching the per-feed
`stale_scheduled_match_count`). The detail counted a row list capped at 20.
Because that one capped list was ordered by kickoff, 20 older stuck fixtures
could also push a newer stuck `in_play` match out of it and suppress the
`stale_live_match` degradation altogether.

## 4. Forecast recording

### 4.1 Finished matches with no pre-kickoff prediction

Of 495 past-kickoff fixtures, 63 returned `404 no_prediction`. All 63 are
explained:

| Group | Rows | Why |
|---|---|---|
| UCL qualifiers, July | 56 | Played before the UCL was activated on 2026-08-01. Expected, not a defect. |
| Domestic duplicate rows (D1) that finished before the cutover created them | 7 | #1261–#1266 (La Liga), #1335 (Bundesliga). Two are second copies of matches graded on the legacy row. **Five are real matches missing from the record** (La Liga 23, 24, 28, 30 Aug; Bundesliga 29 Aug): their pre-kickoff prediction sits on the legacy row, which never finishes. PR #265's repair re-parents these. |

`learning_loop.evaluate_finished_predictions` logs these again on every run
(skipping is not persisted), which explains the repeated "finished match N has
no pre-kickoff prediction; skipping" warnings in the daily log.

Every graded domestic row (295) is a `poisson-elo-club-v0.3` row generated
before kickoff, as the learning loop requires.

### 4.2 Production rows written after kickoff (D2 — verified, fixed locally)

| | Fixtures | Production rows after kickoff |
|---|---|---|
| EPL | 1 | 1 |
| La Liga | 26 | 783 |
| Bundesliga | 9 | 303 |
| UCL | 15 | 855 |
| **Total** | **51** | **1,942** |

`generate_predictions` selects on `status == "scheduled"` only; `_write_prediction`
guards on status only. A fixture whose result has not landed (D1 legacy rows,
D5 orphans, any delayed result) is re-predicted on every daily run and every
post-results chain. Evaluation is protected (`_frozen_prediction` filters
`created_at <= kickoff`), but the API serves the newest row as the match's
prediction, so these fixtures showed post-kickoff numbers.

### 4.3 Frozen predictions were days old (D3 — verified; root cause blocked)

| League | Graded | Median lead (kickoff − frozen row) | Max | Frozen > 48 h before kickoff | Frozen before a result of either club |
|---|---|---|---|---|---|
| EPL | 100 | 129 h | 488 h | 61 | 46 |
| La Liga | 115 | 106 h | 488 h | 70 | 55 |
| Bundesliga | 80 | 145 h | 485 h | 44 | 29 |

Frozen rows cluster on the last day predictions were written before a gap:
49 on 18 Aug, 66 on 11 Sep, 89 on 11 Oct (11 Sep's rows exist although that
day's scheduled run is recorded as failed — the failure came after the
prediction step, or the rows came from the post-results chain). GitHub's run history for `refresh.yml` (read via
`gh run list` / the jobs API, read-only) gives the cause:

59 of the 93 days from 19 Aug to 19 Nov had no successful scheduled refresh:

| Days | Count | Cause recorded by GitHub |
|---|---|---|
| 19–22 Aug, 1–4 Sep (manual success on 2 Sep), 11 Sep | 8 | Job ran and failed. 19–22 Aug follow the API-Football lapse; 3 Sep failed on football-data.org "fixture list contains a malformed row" for La Liga; the 11 Sep log could not be read (GitHub unreachable from this machine at the time) |
| 23–31 Aug, 12–30 Sep, 12–31 Oct, 17–19 Nov | 51 | Job never started: "recent account payments have failed or your spending limit needs to be increased" |

The billing block is much larger than the known-outage list given at the start
of this audit (17–31 Oct and from 16 Nov): it also covers 23–31 Aug, 12–30 Sep
and 12–16 Oct. The measured accuracy
cost of the stale ratings is nil (section 6), but the public record now states
forecasts that were up to 20 days old, and nothing in `/api/health` showed it
(the fixture-feed staleness check is the only signal). A forecast-age gauge was
added locally (section 9).

## 5. Live grading and market comparison

Source: `reconcile.py`. Model = the frozen pre-kickoff production row.
Market = `AvgC` closing, proportional de-vig, on the same matches (every graded
domestic match has `AvgC`). Δ = model − market per-match log loss, matchweek
(ISO week) clustered bootstrap, 95%.

| League | n | Model 1X2 LL | Brier | Top-pick accuracy | Market 1X2 LL | Δ vs `AvgC` | Δ vs `BFEC` | Δ vs `AvgC`, Shin |
|---|---|---|---|---|---|---|---|---|
| EPL | 100 | 1.0457 | 0.6274 | 47.0% | 1.0108 | +0.0349 [−0.0094, +0.0794] | +0.0357 [−0.0092, +0.0792] | +0.0347 [−0.0102, +0.0788] |
| La Liga | 115 | 0.9483 | 0.5602 | 53.9% | 0.9046 | **+0.0437 [+0.0109, +0.0812]** | +0.0509 [+0.0193, +0.0871] | +0.0472 [+0.0143, +0.0850] |
| Bundesliga | 80 | 0.9713 | 0.5794 | 55.0% | 0.9608 | +0.0105 [−0.0183, +0.0414] | +0.0122 [−0.0127, +0.0413] | +0.0102 [−0.0155, +0.0394] |

The model is behind the closing line in all three leagues, by about as much as
the July audit found offline (+0.028 to +0.033). Only La Liga's gap is
distinguishable from zero on this sample. Column choice and de-vig method do
not change any conclusion.

Calibration in the large (descriptive, `descriptives.py`): the served model
over-prices the home side in EPL (mean P(home) 0.450 vs 0.420 realised, market
0.428) and La Liga (0.462 vs 0.426, market 0.443), and under-prices the away
side in both.

**UCL** (no market, no independent results): 92 graded (20 qualifying, 72
league phase), 1X2 LL 0.870, Brier 0.508, accuracy 75%. League phase LL 0.840
against 0.920 for its own in-sample base rate, so the model carries real skill.
One flag (post-hoc observation, not a decision input): the league phase
produced 7 draws in 72 (9.7%) against a mean predicted draw probability of
24.0% (~17 expected; about 2.8 SD low). Watch it; 72 matches cannot separate a
draw-rate miscalibration from luck.

## 6. Live vs replay

Source: `replay.py` → `replay_results.json`, `replay.out.txt`; La Liga
decomposition `replay_d1.py` → `replay_d1_results.json`, `replay_d1.out.txt`.
`asof` = C0 on Elo replayed only from results that had kicked off ≥ 2 h before
the frozen row was generated (production's information set). `fresh` = C0 on
Elo from every result before kickoff.

Declared: the 2 h result lag (`RESULT_LAG`) is an analysis choice made while
writing `replay.py`; it was not pre-registered. It decides only which results
count as "known" for the as-of replay. EPL and Bundesliga reproduce production
to within 1e-4 with it, which is the check that it is not distorting anything
there.

| League | n | Live LL | As-of replay LL | Fresh replay LL | live − asof | asof − fresh (staleness cost) | Elo in prod reasons vs replay |
|---|---|---|---|---|---|---|---|
| EPL | 100 | 1.0457 | 1.0457 | 1.0421 | **0.0000** (max \|Δp\| ≤ 0.0001) | +0.0036 [−0.0085, +0.0187] | 88/88 within 5 Elo |
| La Liga | 115 | 0.9483 | 0.9433 | 0.9527 | +0.0050 [−0.0102, +0.0195] | −0.0094 [−0.0168, −0.0022] | 78/93 within 5; 7 off by >25, all the D1 Deportivo duplicate (canonical-identity replay; see claim 3) |
| Bundesliga | 80 | 0.9713 | 0.9713 | 0.9789 | **0.0000** (max \|Δp\| ≤ 0.0001) | −0.0076 [−0.0164, +0.0000] | 75/75 within 5 Elo |

What this establishes:

1. **EPL and Bundesliga replay to within 1e-4.** The repo's own model code,
   fed only public football-data.co.uk results, reproduces every EPL and
   Bundesliga live forecast with max \|Δp\| ≤ 1e-4 per probability (the
   stored probabilities are rounded to 4 dp) and the production Elo in every
   reasons string. So the July offline↔live parity holds for those leagues,
   and offline evaluation of the served model is trustworthy without
   production access. It does **not** hold for La Liga without modelling D1
   (claim 3).
2. **Odds anchoring and availability: no effect on any graded EPL/Bundesliga
   row; a probable effect on 8 early La Liga rows.** `use_odds` (w_odds 0.35)
   and `use_availability` are on in `model_params.json`. In EPL and the
   Bundesliga no frozen row differs from the pure-Elo replay. In La Liga 8 rows
   frozen 15–18 Aug and 2 Sep still differ after D1 is modelled (claim 3).
   For 7 of the 8 production's printed Elo pair equals the replay's (the
   eighth, Elche–Barcelona frozen 18 Aug, prints Elche at 1469 against the
   replay's 1488 — unexplained), so the difference sits in the lambda layer — the layer odds anchoring and
   availability offsets act on, both live before the 18 Aug lapse. That is
   consistent with, not a demonstration of, those adjustments: the stored
   odds/injury rows are not public.
3. **La Liga's gap: mostly the D1 identity defect, including knock-on to
   matches without a duplicate club; the rest sits on 8 pre-cutover rows.**
   *(Corrected after review: the first version said "La Liga's gap is D1",
   pointing only at the Deportivo-duplicate rows. That was unsupported: of the
   +0.570 nats total live − asof, only 0.054 came from the 18 rows with a
   duplicate club, and 47 of the 58 rows differing by > 0.001 had none.)*
   `replay_d1.py` replays La Liga with production's identities — from the
   2026-09-02 cutover run onward, every 2026-27 result of Racing and Deportivo
   on the 1500-cold-start duplicate entity, both copies of the two
   double-ingested 16/17 Aug results in the history, and each frozen row
   pricing the entity its fixture carries:

   | Rows | n | live − asof, canonical identities (nats, total) | live − asof, production identities (nats, total) |
   |---|---|---|---|
   | with a duplicate club | 18 | +0.054 | −0.0002 |
   | without | 97 | +0.516 | +0.248 |
   | all | 115 | +0.570 | +0.248 |

   With production identities, every row frozen after 2 Sep reproduces within
   0.001, duplicate or not: the non-duplicate gap from 6 Sep onward was the
   knock-on of D1 (opponents' ratings moved by the duplicate entities'
   results and by the double-counted draws), now demonstrated rather than
   suspected. The remaining +0.248 nats sit on 7 rows frozen 15–18 Aug plus
   one on 2 Sep, explained only as in claim 2 (consistent with odds
   anchoring/availability, not demonstrated). Net on the record: D1 and
   these adjustments together made La Liga's live log loss +0.0050 per match
   different from the canonical replay — not distinguishable from zero.
4. **Stale ratings did not cost accuracy this season.** EPL +0.0036 (noise);
   La Liga and Bundesliga stale ratings scored *better* than fresh (La Liga
   nominally credible). Post-hoc observation only: in-season Elo moves at K=30
   may be noisier than useful. Not a new candidate here — T1.7 (`k_factor`) was
   not credible in July, and testing it now would be selection on the holdout.

## 7. Candidate results (pre-registered, 2026-27 holdout)

Source: `candidates.py` → `candidates_results.json`, `candidates.out.txt`;
fitted configs frozen in `r1_params.json` and `frozen_candidates.json`.

Fitted values:

| League | R1 `home_adv` | R1 `base` | R1 `beta` | R1 `rho` | R1 calibrator edges (q3) | U1 half-life (2025-26 LL by half-life 90/180/365 d) |
|---|---|---|---|---|---|---|
| EPL (served 60 / 1.30 / 0.0021 / −0.06) | 40 | 1.32 | 0.0018 | 0.00 | 79.3, 190.8 | 365 d (1.0450 / 1.0354 / 1.0299) |
| La Liga (served 80 / 1.20 / 0.0021 / −0.06) | 60 | 1.18 | 0.0018 | 0.00 | 75.1, 175.4 | 365 d (0.9976 / 0.9851 / 0.9790) |
| Bundesliga (served 60 / 1.44 / 0.0021 / −0.06) | 30 | 1.46 | 0.0016 | −0.04 | 74.6, 169.2 | 365 d (0.9971 / 0.9872 / 0.9778) |

Log loss on the holdout (n = 100 / 119 / 81, every 2026-27 match to 19 Nov):

| League | C0 1X2 | R1 1X2 | U1 1X2 | Market 1X2 | C0 O/U | R1 O/U | U1 O/U | Market O/U |
|---|---|---|---|---|---|---|---|---|
| EPL | 1.0421 | 1.0291 | 1.0380 | 1.0108 | 0.7014 | 0.6972 | 0.7036 | 0.6931 |
| La Liga | 0.9557 | 0.9510 | 0.9391 | 0.9064 | 0.6851 | 0.6940 | 0.6552 | 0.6278 |
| Bundesliga | 0.9863 | 0.9739 | 0.9925 | 0.9696 | 0.6342 | 0.6384 | 0.6196 | 0.5914 |

Paired deltas vs C0 (negative = candidate better), matchweek-clustered:

| League | Candidate | Δ 1X2 [95%] | Δ 1X2 [97.5%, Bonferroni k=2] | Δ O/U [95%] | Gate |
|---|---|---|---|---|---|
| EPL | R1 | −0.0130 [−0.0369, +0.0111] | [−0.0397, +0.0144] | −0.0042 [−0.0120, +0.0032] | not cleared (within noise) |
| EPL | U1 | −0.0041 [−0.0769, +0.0724] | [−0.0838, +0.0870] | +0.0022 [−0.0365, +0.0443] | not cleared |
| La Liga | R1 | −0.0047 [−0.0200, +0.0099] | [−0.0224, +0.0112] | +0.0089 [−0.0008, +0.0180] | not cleared |
| La Liga | U1 | −0.0166 [−0.0617, +0.0320] | [−0.0670, +0.0370] | −0.0299 [−0.0771, +0.0251] | not cleared |
| Bundesliga | R1 | −0.0125 [−0.0438, +0.0201] | [−0.0507, +0.0232] | +0.0042 [−0.0085, +0.0163] | not cleared |
| Bundesliga | U1 | +0.0062 [−0.0491, +0.0507] | [−0.0567, +0.0562] | −0.0146 [−0.0950, +0.0710] | not cleared |
| Pooled (league×week clusters) | R1 | −0.0096 [−0.0242, +0.0037] | [−0.0261, +0.0057] | +0.0033 [−0.0027, +0.0091] | secondary, not cleared |
| Pooled | U1 | −0.0063 [−0.0401, +0.0276] | [−0.0457, +0.0321] | −0.0151 [−0.0480, +0.0198] | secondary, not cleared |

**No candidate clears the gate in any league. Every difference is within
noise.** Against the market, no candidate closes the gap (section 5 numbers
hold for every candidate; La Liga stays credibly behind on both markets).

Reading, kept to what the numbers support:

- R1 favours itself on 1X2 in all three leagues (−0.005 to −0.013), driven by
  a lower `home_adv` (40/60/30), a lower `beta` and the q3 calibrator recut. It
  agrees with the calibration-in-the-large finding (home over-priced), which is
  the kind of corroboration worth re-testing, not shipping on.
- U1 is noisier (95% CI width 1.6–3.1× R1's: EPL 3.1, La Liga 3.1,
  Bundesliga 1.6; first version said ~5×). Its O/U point estimates are
  favourable in La Liga and Bundesliga, the two leagues where C0's totals sit
  credibly behind the market — but see 7.1: U1 as registered is defective, so
  its result is not evidence about a Dixon–Coles upgrade either way.
- Grid edges (declared after review): R1's `rho` = 0.00 in EPL and La Liga is
  the upper edge of the pre-registered grid (−0.20…0.00), and U1's half-life
  365 d is the top of {90, 180, 365} in every league. An edge pick means the
  optimum may lie outside the grid; the grids were not widened after the fact.

Sample sizes (`descriptives.py`, assuming today's point estimate is the true
effect and the SE shrinks as 1/√n):

| Comparison | n now | n where the 95% CI just excludes 0 (≈ 50% power — not decision-grade) | n for 80% power at the Bonferroni gate |
|---|---|---|---|
| EPL R1 | 100 | 342 (≈ matchweek 34, mid-to-late April 2027) | 846 (more than two seasons) |
| Bundesliga R1 | 81 | 530 | 1,310 |
| La Liga U1 | 119 | 944 | 2,334 |
| Pooled R1 | 300 | 643 (≈ late January 2027) | 1,591 (more than the 1,066 domestic matches in a season) |

*(Corrected after review: the first version presented the middle column as
"the sample a decision needs" and dated EPL 340 to March.)* Honest reading:
if R1's true effect is about −0.01 nats, one season of holdout cannot decide
it at conventional power. A decision will need either the full season plus
an accepted lower bar, or two seasons.

### 7.1 Post-hoc: U1 is defective for promoted clubs; corrected candidate U2 registered (not scored)

*(Added after review; verified.)* U1's ridge (strength 1.0, toward the league
mean) barely shrinks a club with one or two matches in its fit window, and the
promoted-club prior applies only at zero matches. Re-running U1's own fit
before the week of Coventry–Hull (29 Aug): Hull have one 2026-27 match in the
window (their earlier top-flight seasons are beyond 4 half-lives), and their
attack − defence is **0.968**, above Arsenal's 0.959 and Manchester City's
0.836. U1 prices Coventry–Hull **0.07 / 0.19 / 0.74** against C0's 0.59 / 0.27 /
0.14; U1's seven largest disagreements with C0 in the EPL are all
Hull or Coventry matches (max \|Δp\| 0.60, 0.49, 0.37, 0.35, 0.29, 0.27,
0.27).

Consequences:

- U1's recorded result stands as pre-registered (not cleared), but it tests a
  defective implementation. **It is not evidence against a Dixon–Coles
  upgrade.**
- `candidates.py --frozen` re-scores the same defective U1. At the next
  checkpoint report it for the record only.

Registered now, **post-hoc**, spec frozen in `frozen_candidates.json` →
`U2_spec`, **not scored on the 2026-27 holdout today**:

- **U2**: same Poisson team-strength model as U1 (μ, home, per-club attack and
  defence; exponentially decayed likelihood; matches older than 4 half-lives
  dropped; `rho` −0.06; no calibrator), with a proper per-club prior instead
  of the global ridge:
  - penalty τ/2 · Σ (θ − target)² per club parameter, **τ = 10** (in decayed
    match-weight units: about ten full-weight matches before the data
    dominate), fixed, not tuned;
  - target (0, 0) (league mean) for a club that played in this division in
    the previous season; for any other club (promoted or returning), the mean
    attack/defence of the three clubs with the lowest attack − defence in a
    fit made at the end of the previous season;
  - half-life selected on 2025-26 (walk-forward, weekly refits) from
    **{365, 540, 730} d** — widened because 365 d was U1's grid edge — by
    1X2 log loss, never using 2026-27.
- Scored for the first time at the next checkpoint, alongside R1 and U1,
  under the same gate. Being post-hoc, a pass at that first look earns at most
  "collect more evidence / shadow"; a ship decision needs the season-end look.

## 8. Recommendation

| Competition | Decision | Deciding numbers | Rule |
|---|---|---|---|
| **EPL** (`poisson-elo-club-v0.3`) | **Collect more evidence**; keep C0 serving | R1 Δ 1X2 −0.0130 [−0.0397, +0.0144] (Bonferroni) | 2.4 rule 3 (point estimate ≥ 0.005 favourable, CI straddles 0) |
| **La Liga** (`poisson-elo-club-v0.3`) | **Collect more evidence**; keep C0 serving; repair D1 first | U1 Δ 1X2 −0.0166 [−0.0670, +0.0370]; R1 −0.0047 [−0.0224, +0.0112]; live record distorted by the D1 duplicate clubs and their knock-on to other matches (§6 claim 3) | rule 3 (both clauses) |
| **Bundesliga** (`poisson-elo-club-v0.3`) | **Collect more evidence**; keep C0 serving | R1 Δ 1X2 −0.0125 [−0.0507, +0.0232] | rule 3 |
| **UCL** (`poisson-elo-ucl-v0.2`) | **Collect more evidence**; keep serving | 92 graded, LL 0.870; no market or replay possible here; draw-rate flag (7/72 vs ~17 expected) | rule 6 |
| **WC26** (`poisson-elo-v0.6`) | **Keep** (out of scope) | No served international matches since the tournament; the club leagues inherit its `beta`/`rho`/calibrator, which R1 re-tests per league | — |

The re-run is cheap and needs no production access for EPL and the
Bundesliga, because the replay reproduces production there (La Liga needs D1
modelled, `replay_d1.py`): at the winter break re-download the 2026-27 files
and run `candidates.py --frozen`, which scores the configs frozen today
instead of refitting them, and score U2 per its frozen spec. Treat the winter
look (pooled ≈ 640 matches, ≈ 50% power) as a progress check; the decision
look is season end, and per 7 even that may be underpowered for a −0.01 nat
effect. Two looks at the same holdout inflate the false-positive rate; the
winter look therefore does not ship anything on its own. Do not refit R1 or
re-select U1 before then — that would spend the holdout twice.

## 9. Changes made locally (uncommitted, worktree `audit/football-model-2026-11`)

No model parameter, version string, served/shadow selection or calibrator
changed. The changes are forecast-recording and data-quality fixes the audit
supports (rule 5).

| Defect | Change | Files |
|---|---|---|
| D2 post-kickoff prediction rows (writes) | `generate_predictions(..., kickoff_after=None, clock=None)`: when `kickoff_after` is set, a `scheduled` fixture is skipped once its kickoff is ≤ `max(kickoff_after, clock())`, checked **as the pass reaches each match** (post-review: the first version filtered once against the run-start time, so a fixture kicking off mid-pass could still be priced after its whistle and, with Postgres's transaction-start `created_at`, be graded). Skips are logged and counted as `matches_skipped_past_kickoff`. Wall clock passed by every production entry point: `run_pipeline.main()` → WC and league prediction steps; `live_refresh.maybe_run_post_results_chain` and `POST /api/internal/recompute` (`internal._now`, post-review) → `run_tracked_post_results_chain` → `run_post_results_chain` → `_regenerate_tournament_predictions`, all of which forward `kickoff_after` and `clock`. Default `None` keeps the status-only rule. | `pipeline/generate_predictions.py`, `pipeline/run_pipeline.py`, `pipeline/learning_loop.py`, `backend/app/live_refresh.py`, `backend/app/api/internal.py` |
| D2 post-kickoff prediction rows (reads; post-review) | `serializers.created_by_kickoff()`: one predicate, "row created at or before its match's kickoff, or kickoff NULL", the rule grading already uses. Applied to every football read that presents "the match's prediction": `serializers.latest_prediction` (so `/api/matches/{id}`, `/summary`, markets, premium markets, goalscorers, intel), the `/api/matches/upcoming` board query, `/api/predictions/{id}` history, and `/api/matches/{id}/prob-history`. The 1,942 existing post-kickoff rows stop being served without touching production data. Decided behaviour: a started or finished match with **only** post-kickoff rows has **no** served prediction (404 `no_prediction` on detail and predictions endpoints, `probabilities: null` on the board and summary, empty prob-history), matching grading. In production today no such match exists (all 51 fixtures with post-kickoff rows also have pre-kickoff ones), so nothing currently shown disappears. NRL reads (`SportPrediction`) are untouched. | `backend/app/serializers.py`, `backend/app/api/matches.py`, `backend/app/api/predictions.py`, `backend/app/api/prob_history.py` |
| D3 invisible stale forecasts | `/api/health` → `coverage.with_stale_prediction`: imminent (48 h) fixtures whose latest production row is older than 36 h (`PREDICTION_STALE_HOURS`). A gauge like the venue/market gaps; it does not flip `data_status`. | `backend/app/data_freshness.py` |
| D4 health under-count | `stuck_counts()` gives uncapped per-status counts; each degradation now carries `count` and its own capped row list, so stuck fixtures can no longer hide a stuck live match. | `backend/app/data_freshness.py` |
| Latent D1 recurrence | football-data.co.uk aliases `santander` → Racing Santander, `elversberg` → SV Elversberg (the 2026-27 SP1/D1 spellings), so a future 2026-27 history backfill does not create two more duplicate clubs. Complements PR #265, which covers the football-data.org spellings. | `pipeline/team_mapping.py` |

Tests: `pipeline/generate_predictions_test.py` (3, one with a clock pinned
mid-pass), `pipeline/learning_loop_test.py` (1), `pipeline/run_pipeline_test.py`
(1), `backend/tests/test_live_refresh.py` (1, plus one exact-kwargs assertion
updated), `backend/tests/test_api_endpoints.py` (recompute test now pins
`internal._now`; new test that recompute skips started fixtures),
`backend/tests/test_served_prediction_kickoff.py` (5, new: latest_prediction,
board, detail/summary, predictions history, prob-history — each verified to
fail without the read-path change), `backend/tests/test_data_freshness.py` (6),
`pipeline/team_mapping_test.py` (2 parametrised cases).

Existing tests adjusted for the read rule: four fixtures seed the June 2026
WC structure and write predictions at wall-clock time (November), i.e. after
those kickoffs; under the new rule they had only post-kickoff rows. They now
date the seeded rows 2026-06-01 (`test_api_endpoints.py`,
`test_knockout_advance.py`, `test_odds_comparison.py`,
`test_card_events_serializer.py`). This changes test data, not assertions.

Frontend (checked by reading, not by running — `frontend/node_modules` is
absent on this machine and was not installed): `MatchSummary.probabilities` /
`predicted_score` are already typed nullable (`lib/types.ts`), and the match
page treats a 404 from `/api/matches/{id}` (`getServer` returns null) by
rendering `PredictionPending` with the real scoreboard. No type or crash
issue. One copy issue: for a **finished** match with no pre-kickoff prediction
that view says "Model prediction on the way … check back soon"
(`components/MatchScoreboard.tsx`). Already true today for the 7 duplicate
rows and 56 July UCL qualifiers; not changed here (frontend tests could not be
run). Suggested follow-up: status-aware copy ("No pre-match prediction was
recorded for this match").

## 10. Blocked, and what would unblock it

| Item | Blocked on | Unblock |
|---|---|---|
| D1 repair (duplicate clubs/fixtures, 5 real matches missing from the record, double Elo credit) | Merging PR #265 and running its repair against the production DB (stop gate: shipping + production write) | Javo's "go" to merge #265, dry-run the repair workflow, review its evidence, then apply |
| D3 root cause (no successful refresh on 59 of 93 days since 19 Aug, 51 of them billing) | GitHub Actions billing: "recent account payments have failed or your spending limit needs to be increased" (spending decision) | Javo fixes billing/spending limit or moves the schedule (see the separate `fix/actions-minutes-budget` work) |
| D5 orphaned UCL play-offs (14) | Results are not in football-data.org; marking or back-filling them is a production write | Decide: enter the 14 results by hand, or mark the rows as provider-orphaned |
| Odds anchoring / availability / market intel | No odds or injuries source since 18 Aug (API-Football lapsed); `/api/health` shows 20/20 imminent fixtures without market intel | A paid odds/injuries source (spending decision). Until then the served model is effectively pure Elo |
| Shipping this audit's fixes | Commit/PR/merge/deploy are outside this session's remit | Review the diff, then the normal branch → PR → CI → "go" path |

Not verified (stated rather than guessed):

- UCL results were not reconciled against an independent source (none
  public), and UCL could not be replayed (its history comes from API-Football).
- The production DB's `historical_matches` contents were not read. The D1
  identity model (duplicate entities from the 2 Sep cutover, both copies of the
  16/17 Aug draws) is supported indirectly: with it, `replay_d1.py`
  reproduces every La Liga frozen row after 2 Sep within 0.001. That is strong
  circumstantial evidence, not a read of the table.
- 8 early La Liga rows (15–18 Aug, 2 Sep) differ from every replay by up to
  0.066 in a probability; attributed to odds anchoring / availability by
  elimination only. One of them also shows a 19-Elo difference on Elche that
  is unexplained.
- The `+baseline` twin and shadow records (`shadow_progress.pairs: 409`) are
  behind an internal token and were not read.
- football-data.co.uk revises files in place; the 2016-17…2025-26 captures used
  for R1 were not checked against `pipeline/data/club_data_manifest.json`
  (D0 already found that manifest drifted). R1's fit is pinned by
  `frozen_candidates.json` instead.
- No Pinnacle closing odds exist in the 2026-27 files, so the sharpest-book
  benchmark the July work used is unavailable; `BFEC` (exchange) is the
  closest substitute and agrees with `AvgC`.

## 11. Reproduction

Python: `/Users/lobster/Projects/fw-actions-minutes/.venv/bin/python` (main's
requirements; numpy 2.2.1, scipy 1.18.1, pandas 2.2.3). Run from the worktree
root. The audit scripts are not under `pytest.ini`'s test paths.

```bash
# 1. captures (once; git-ignored)
D=data/raw/football-audit-2026-11
mkdir -p $D/api $D/fdcuk
curl -s https://pitchprophet-api.onrender.com/api/health -o $D/api/health.json
for c in epl laliga bundesliga ucl; do
  curl -s "https://pitchprophet-api.onrender.com/api/matches/upcoming?competition=$c" -o $D/api/upcoming_$c.json
done
# per-match history for every finished / past-kickoff fixture (0.4 s spacing):
#   GET /api/predictions/{match_id} -> $D/api/pred_history/{match_id}.json
for s in 1617 1718 1819 1920 2021 2122 2223 2324 2425 2526 2627; do
  for d in E0 SP1 D1; do
    curl -sL "https://football-data.co.uk/mmz4281/$s/$d.csv" -o $D/fdcuk/${d}_$s.csv
  done
done

# 2. analysis
export PYTHONPATH=backend:.:docs/experiments/2026-11-20-football-model-audit
PY=/Users/lobster/Projects/fw-actions-minutes/.venv/bin/python
$PY docs/experiments/2026-11-20-football-model-audit/reconcile.py     # sections 3-5
$PY docs/experiments/2026-11-20-football-model-audit/replay.py        # section 6
$PY docs/experiments/2026-11-20-football-model-audit/replay_d1.py     # section 6 claim 3 (La Liga, production identities)
$PY docs/experiments/2026-11-20-football-model-audit/candidates.py    # section 7 (fits R1, selects U1)
$PY docs/experiments/2026-11-20-football-model-audit/candidates.py --frozen   # re-runs: score frozen configs
$PY docs/experiments/2026-11-20-football-model-audit/descriptives.py  # calibration-in-the-large, UCL, sizing
```

Configuration scored: C0 = `pipeline.leagues.club_params_for(code)` on this
worktree (`poisson-elo-v0.6` params from `ml/models/model_params.json` plus
league overrides), home advantage 60/80/60, K = `ml.ratings.elo.k_factor`
(30 for every club competition). Cutoff: kickoffs ≤ 2026-11-19. Bootstrap
2,000 resamples, seed 12345.

Determinism (re-checked after review, from the final scripts): both modes were
re-run after the last edit to `candidates.py`. `candidates_results.json` /
`candidates.out.txt` (fit mode) and `candidates_results_frozen.json` /
`candidates_frozen.out.txt` (`--frozen`) agree on every reported metric and
interval (0 differences, excluding the fit-trace fields), and the refitted R1
equals the frozen R1 parameters and calibrator. The first version of this
section claimed this without saving the frozen output, after `candidates.py`
had been modified; that claim is now evidenced.

Test results: see section 12.

## 12. Verification

Full Python suite from the worktree root, after every change in section 9:

```
$ /Users/lobster/Projects/fw-actions-minutes/.venv/bin/python -m pytest -p no:warnings -o addopts=""
...
worker/streaming_test.py .................                               [100%]

======================= 3339 passed in 106.81s (0:01:46) =======================
```

After the review fixes (C1–C3, A1–A4), same command:

```
worker/streaming_test.py .................                               [100%]

======================= 3346 passed in 114.93s (0:01:54) =======================
```

Frontend code untouched; its suite was not run (`frontend/node_modules` absent
on this machine, not installed). See section 9 for what was checked by reading. Nothing committed, pushed,
deployed or written to production.
