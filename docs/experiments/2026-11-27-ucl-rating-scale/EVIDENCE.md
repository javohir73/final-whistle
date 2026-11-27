# UCL rating scale: offline experiment (2026-11-27)

Served model under test: `poisson-elo-ucl-v0.2` (engine `poisson-elo-v0.6`,
UCL overrides base 1.44, HA 60). Research only: no production reads beyond the
saved public payload, no writes, no deploys.

## 0. What serving actually does (code reading, before any scoring)

The brief's reading was: "EPL / La Liga / Bundesliga clubs get their domestic
Elo; every other club gets a UCL-only Elo." **The code does not do that.**

- `pipeline/run_pipeline.py` (predictions loop) passes
  `base_strengths = club_elo_ratings(db, competition="UEFA Champions League", home_advantage=60)`
  into `generate_predictions` for the `ucl` code.
- `pipeline/learning_loop.effective_elos(base_ratings=...)`: when a map is
  supplied it is used for EVERY team, `base_ratings.get(team.id, 1500.0)`.
  The comment says so explicitly: falling back to `Team.elo_rating` "can leak
  whichever domestic/cross-border replay persisted last". So **every** UCL
  club, Arsenal and Bayern included, is rated by the UCL-only replay
  (2018-19..2025-26 editions incl. qualifiers from API-Football, plus the
  2026-27 finished UCL matches mirrored by `sync_finished_matches_to_history`),
  cold start 1500. Clubs with no UCL row sit at 1500.
- `owns_served_rating: False` only decides who writes the shared
  `teams.elo_rating` column that `/api/teams` shows. It does not feed UCL
  forecasts.
- The learning-loop `elo_delta` adds nothing for club matches: every finished
  club fixture is mirrored into `historical_matches`, and
  `_already_in_history` skips any (date, pair) already there.
- Other served layers: the international segmented calibrator
  (`model_params.json`) applies; odds anchoring needs stored odds (none for
  UCL, see the 2026-11-20 audit); availability and suspension offsets can nudge
  individual matches and cannot be reproduced offline.

So the "two incompatible scales mixed" mechanism is not how serving forms a
UCL rating. The diagnosis's symptom (big-3 clubs out-earning their expected
points, weak-league clubs under-earning) is still a valid target: under a
UCL-only scale it reads as **missing league-strength information**, not as
scale mixing. The protocol below tests both readings empirically: the control
is whichever reproduces the served 2026-27 probabilities better.

## 1. Frozen protocol (written and committed before any candidate was scored)

### Data (raw files outside the repo, not committed)
- UCL main stage 2011-12..2025-26: openfootball/champions-league `cl.txt`
  (CC0). football.json lacks 2020-21..2023-24 and 2025-26, so the `.txt`
  source is used for every season. 90-minute scores (`a.e.t.` lines use the
  bracketed regulation score).
- UCL qualifiers: openfootball `clq.txt`, which exists only for 2024-25 and
  2025-26. Earlier qualifiers are unavailable offline (serving has them from
  API-Football since 2018); this is a known control-fidelity gap.
- 2026-27: the saved served payload (`/api/matches/upcoming?competition=ucl`),
  90 qualifiers + 90 finished league-phase matches, with served probabilities.
- Domestic: football-data.co.uk `mmz4281` E0 SP1 D1 I1 F1 N1 P1 T1 B1 SC0 G1,
  2011-12..2026-27 (to ~23 Nov 2026), plus `new/AUT.csv` (2012-13 on).
- Names: explicit map in `names.py`; `load_all()` reports any covered-country
  UCL club with no domestic row.

### Scored sets
- Selection: UCL 2021-22, 2022-23, 2023-24, every match from the group stage on
  (375 matches). Walk-forward: ratings use only matches on earlier days.
- Confirmation (quarantined): UCL 2024-25 and 2025-26, league phase on (378).
  Run once, after the selection verdicts and final configs are frozen in
  `frozen.json`.
- 2026-27 league phase MD1-5 (90): descriptive only (it produced the
  hypothesis).

### Control
Rule fixed in advance: score both readings of serving on the 90 2026-27
league-phase matches and compare them with the served triples (mean absolute
probability gap). The closer one is the control.
- `CTRL_ucl_only` (code reading): one UCL-only replay per edition S from 1500
  over the 8 completed editions before S plus S so far; finals neutral in the
  replay; K 30; HA 60.
- `CTRL_alt` (brief's reading): as above, but clubs in E0/SP1/D1 take their
  domestic Elo (league alone, from 1500, served 10-season window plus the
  current season so far, HA 60/80/60 as served).
- Both forecast with base 1.44, beta 0.0021, rho -0.06, HA 60 on every match
  (finals too, as `_host_adv` does), and the served segmented calibrator.

### Candidates (no others will be added)
- **C1_offset**: control + one additive Elo offset δ for ENG/ESP/GER clubs (the
  brief's "domestic-sourced" group) in UCL matches. δ grid −100..+300 step 10.
  Selection: δ for season S = argmin mean 1X2 LL over scored matches of
  2014-15..S−1 under the control's ratings. Frozen δ for confirmation = argmin
  over 2014-15..2023-24.
- **C2_unified**: one joint chronological Elo replay from 2011-07-01 over all
  twelve domestic leagues plus every UCL match (main stage, available
  qualifiers, 2026-27 finished). Declared choices: K 30 (engine default for
  these competition strings), HA 60 everywhere (engine default; La Liga's
  served 80 is not used), no new-season regression (engine default). Seeds
  (the only new knobs, fixed now, not fitted): first appearance takes the
  country tier seed: ENG/ESP/GER/ITA 1600, FRA/POR 1550, NED/TUR/BEL/GRE/AUT/SCO
  1500 (tiers follow the UEFA association ranking order around 2011, the
  replay's start); a club first appearing in a league after that league's
  opening season enters 100 lower (promoted side). Clubs from countries with no
  feed enter at 1450 and their USED rating is
  `1450 + (r − 1450)·n/(n + 10)`, n = rated matches so far. Same forecast layer
  as the control.
- **C3_unified_cal**: C2 with the served (international) segmented calibrator
  replaced by a UCL-fitted global vector scaling (`fit_vector_scaling`: shared
  temperature + draw and away biases; the repo's calibrator family, global
  because three seasons cannot fill four 200-row buckets). Selection: for
  season S, fitted on raw C2 triples of the three seasons before S. Frozen for
  confirmation: fitted on the three selection seasons.

### Metrics and gate
- Primary: 1X2 log loss. Δ = candidate − control per match; 95% CI from 4000
  bootstrap resamples of ISO matchweek clusters
  (`club_walkforward.season_clustered_ci`, as `experiment_ucl_eval.py`).
- Secondary: Brier, accuracy, predicted vs observed draw rate, and
  calibration-in-the-large: actual minus expected points per team-game, split
  by rating source (ENG/ESP/GER; other covered leagues; no-feed countries).
- Gate: "credibly better" only if the CI is entirely below 0 on selection AND
  on confirmation. If several pass selection, the one with the lowest
  selection Δ is the designated config; confirmation scores every frozen
  config once, but only the designated one can be recommended.

## 2. Control fidelity (`fidelity.py` → `fidelity.out.txt`, `fidelity_results.json`)

Both readings scored on the 90 finished 2026-27 league-phase matches against
the served triples:

| Reading | mean abs prob gap | max gap | LL (offline) | LL (served) |
|---|---|---|---|---|
| `CTRL_ucl_only` (code reading) | **0.017** | 0.066 | 0.8844 | 0.8763 |
| `CTRL_alt` (brief's reading) | 0.067 | 0.198 | 0.8495 | 0.8763 |

The code reading reproduces serving four times more closely, so it is the
control. The brief's reading is refuted as a description of serving (it
would actually have scored better on these 90 matches, which is part of what
C1/C2 test).

The remaining gap has known causes, all on the offline side: serving's
history has the 2018-19..2023-24 qualifiers from API-Football, and openfootball
does not, so clubs whose rating comes mostly from qualifiers (LASK, AEK,
Viking, Bodø/Glimt, Galatasaray, Sabah) drift by up to 0.066 per outcome. The
other served layers (availability and suspension offsets) also nudge single
matches. Como and Real Betis have no UCL row at all, so both serve at the 1500
cold start, as they do offline.

Data report: 2,359 UCL rows (15 main-stage editions, 182 qualifiers from
2024-25/2025-26, 180 rows for 2026-27), 55,848 domestic rows, 187 UCL clubs.
No parse problems or dropped rows. **Every UCL club from a covered country
mapped to a domestic club**. 106 clubs come from countries with no feed and
are rated from UCL data only, by design.

## 3. Results: selection (`experiment.py select` → `selection.out.txt`, `selection_results.json`)

UCL 2021-22..2023-24, 375 matches, 45 ISO-week clusters. Δ = candidate − control
1X2 log loss (negative = better).

| Candidate | Δ LL | 95% CI | LL | Brier | Acc | Draw pred / obs | Verdict |
|---|---|---|---|---|---|---|---|
| Control | n/a | n/a | 0.9290 | 0.5472 | 0.584 | 0.230 / 0.211 | n/a |
| C1_offset (δ walk-forward 60, 20, 20) | +0.0027 | [−0.0046, +0.0103] | 0.9317 | 0.5477 | 0.584 | 0.225 / 0.211 | not credible |
| C2_unified | −0.0082 | [−0.0453, +0.0289] | 0.9208 | 0.5412 | 0.571 | 0.224 / 0.211 | not credible |
| C3_unified_cal | −0.0049 | [−0.0463, +0.0343] | 0.9240 | 0.5440 | 0.579 | 0.202 / 0.211 | not credible |

**No candidate passed selection, so `designated = null`** in `frozen.json`
(frozen and committed before confirmation ran). Frozen configs: C1 δ = +20
(fit 2014-15..2023-24); C2 as declared; C3 vector scaling t 1.2,
b = (0, −0.1, −0.1), fit on the selection seasons.

## 4. Results: confirmation, run once (`experiment.py confirm` → `confirmation.out.txt`)

UCL 2024-25 + 2025-26, 378 matches, 34 week clusters, frozen configs, no refit.

| Candidate | Δ LL | 95% CI | LL | Brier | Acc | Draw pred / obs |
|---|---|---|---|---|---|---|
| Control | n/a | n/a | 0.9890 | 0.5846 | 0.550 | 0.237 / 0.159 |
| C1_offset | +0.0014 | [−0.0029, +0.0063] | 0.9904 | 0.5847 | 0.548 | 0.234 / 0.159 |
| C2_unified | −0.0388 | [−0.0880, +0.0125] | 0.9502 | 0.5548 | 0.585 | 0.227 / 0.159 |
| C3_unified_cal | −0.0519 | [−0.1005, −0.0014] | 0.9371 | 0.5506 | 0.582 | 0.220 / 0.159 |

C3's confirmation CI excludes zero. **It still does not pass the gate**: the
gate needs selection AND confirmation, and its selection CI straddled zero.
Promoting it on this result would mean choosing on the quarantined set.
Caveat: 2025-26 was also the confirmation edition of the 2026-08-06 base fit,
so these seasons are not virgin, although base 1.44 is shared by control and
every candidate.

## 5. 2026-27 league phase, MD1-5 (descriptive; generated the hypothesis)

`experiment.py current` → `current.out.txt`, `current_results.json`. 90 matches,
only 5 week clusters, so the CIs mean little.

| Model | LL | Brier | Acc | Draw pred / obs | Δ LL vs control [95%] |
|---|---|---|---|---|---|
| Served (actual) | 0.8763 | n/a | n/a | n/a | −0.0081 (served vs offline control) |
| Control (offline) | 0.8844 | 0.5185 | 0.711 | 0.238 / 0.122 | n/a |
| C1_offset δ=20 | 0.8750 | 0.5123 | 0.733 | 0.236 / 0.122 | −0.0095 [−0.0166, −0.0023] |
| C2_unified | 0.8578 | 0.4965 | 0.656 | 0.223 / 0.122 | −0.0266 [−0.1188, +0.1123] |
| C3_unified_cal | 0.8542 | 0.4949 | 0.656 | 0.216 / 0.122 | −0.0302 [−0.1040, +0.0800] |

Points per team-game, actual minus expected:

| Source | team-games | Served | Control | C2 | C3 |
|---|---|---|---|---|---|
| ENG/ESP/GER | 70 | +0.30 | +0.32 | +0.25 | +0.26 |
| other covered league | 80 | +0.03 | +0.03 | −0.09 | −0.09 |
| no domestic feed | 30 | −0.44 | −0.48 | −0.04 | −0.09 |

The brief's diagnosis split (1.89 vs 1.58 over 70; 1.15 vs 1.25 over 110)
reproduces exactly from the served payload. Per-club detail and the seven
served ≥0.80 favourites are in `current.out.txt`. PSG–Roma (2-2): served
0.91/0.07/0.02, C2 0.67/0.22/0.11, C3 0.63/0.21/0.16. Roma's last UCL edition
inside the window was 2018-19, so serving rates them near 1500.

## 6. Calibration by rating source across all sets (actual − expected ppg)

| Set | Source | Control | C1 | C2 | C3 |
|---|---|---|---|---|---|
| Selection | ENG/ESP/GER (345 tg) | +0.05 | −0.01 | +0.13 | +0.13 |
| Selection | other covered (313) | +0.02 | +0.07 | −0.16 | −0.17 |
| Selection | no feed (92) | −0.19 | −0.15 | +0.12 | +0.04 |
| Confirmation | ENG/ESP/GER (317) | +0.05 | +0.00 | +0.08 | +0.09 |
| Confirmation | other covered (337) | +0.15 | +0.18 | −0.05 | −0.05 |
| Confirmation | no feed (102) | −0.35 | −0.33 | +0.15 | +0.11 |

## 7. Verdicts

- **C1_offset: REFUTED.** Selection Δ +0.0027 [−0.0046, +0.0103] and
  confirmation Δ +0.0014 [−0.0029, +0.0063]. Before 2026-27 the big-3 clubs
  outperformed the control by only +0.05 ppg in both blocks. The +0.32 seen
  this season is far outside its own history, so a fixed big-3 offset is not
  the fix. It helps in 2026-27 only because this season is unusual.
- **C2_unified: NOT CREDIBLE.** The direction was favourable on every set
  (−0.008, −0.039, −0.027), but no CI excludes zero. It removes the no-feed
  over-rating and overshoots it (control −0.19/−0.35 becomes C2 +0.12/+0.15),
  and it over-rates the other covered leagues in selection (−0.16). The
  hand-set tier seeds do the cross-league scaling, and a K=30 zero-sum replay
  links leagues too slowly to correct them.
- **C3_unified_cal: NOT CREDIBLE (fails selection).** Selection −0.0049
  [−0.0463, +0.0343]. Its confirmation is credibly better (−0.0519
  [−0.1005, −0.0014]), but that cannot rescue a selection failure.
- **Recommended config: none.** `poisson-elo-ucl-v0.2` stays as served.

### What the evidence does and does not support in the diagnosis
- **Wrong:** "two ratings on incompatible scales are mixed." Serving uses one
  scale (UCL-only) for every club (section 0, confirmed by fidelity).
- **Supported, and persistent:** clubs from countries with no domestic feed are
  over-rated by the UCL-only Elo: −0.19 ppg in selection, −0.35 in
  confirmation, −0.48 this season. The likely mechanism is rating earned
  against qualifier minnows (the bias grows once qualifiers are in the data),
  but that mechanism was not tested.
- **Supported, cause known:** Como and Betis are underrated because serving
  gives a club with no UCL history the 1500 cold start.
- **Not supported as a stable bias:** big-3 under-rating. It was +0.05 ppg
  historically and +0.32 in 2026-27.
- **Post-hoc, not a decision input:** in the 36-team league format, draws ran
  well below prediction: 15.9% observed vs 23.7% predicted in 2024-26, and 12.2%
  vs 23.8% in 2026-27. In the old group format the gap was 21.1% vs 23.0%.
  Separately, the served international calibrator pushes draws DOWN for big
  gaps (300+ bucket b_draw −0.2), which is part of why PSG–Roma showed 0.07.

### Next step (a new pre-registration, not an edit to this one)
A C2-family rating with data-driven cross-league scaling (league offsets
learned walk-forward from cross-border results, or a longer burn-in) plus a
UCL-fitted calibrator. Its gate should be the untouched matchdays 6-8 of
2026-27 and the 2027-28 edition. This experiment's holdouts are now consumed
for this question.

## Reproduction
```
PY=/path/to/.venv/bin/python; E=docs/experiments/2026-11-27-ucl-rating-scale
export UCL_EXP_DATA=<raw dir>  UCL_SERVED_JSON=<served payload>
PYTHONPATH=backend:. $PY $E/fidelity.py
PYTHONPATH=backend:. $PY $E/experiment.py select    # writes frozen.json
PYTHONPATH=backend:. $PY $E/experiment.py confirm   # once
PYTHONPATH=backend:. $PY $E/experiment.py current
```
Raw sources: openfootball/champions-league `<season>/cl.txt`, `clq.txt`
(CC0); football-data.co.uk `mmz4281/<yyyy>/<DIV>.csv` and `new/AUT.csv`
(not CC0, not committed).
