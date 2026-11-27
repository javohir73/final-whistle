# UCL unified-Elo shadows: pre-registration (2026-11-27)

Status: **shadow only. Nothing here is served, ever, by this change.** Two extra
`is_shadow=True` prediction rows per UCL match are written next to the served
`poisson-elo-ucl-v0.2` row; no API, page, grade or rating reads them except the
evaluation described below.

## What the shadows are

Offline background: [`docs/experiments/2026-11-27-ucl-rating-scale/EVIDENCE.md`](experiments/2026-11-27-ucl-rating-scale/EVIDENCE.md).
Served UCL ratings come from a UCL-only Elo replay used for every club, unknown
clubs at 1500, so a club's domestic form is invisible to the forecast. The
experiment tested candidates; two are forward-tested live because the offline
result was favourable in direction but not credible on the selection set
(C2: -0.0082 sel, CI [-0.0453, +0.0289]; C3: -0.0049 sel, CI [-0.0463, +0.0343]),
and C3's quarantined confirmation (-0.0519, CI [-0.1005, -0.0014]) could not
rescue a failed selection. The honest status is "unproven", which is what a
forward test is for.

| Tag | Ratings | Probabilities |
|---|---|---|
| `poisson-elo-ucl-v0.2+unified` (C2) | Unified Elo, below | served params and served segmented calibrator |
| `poisson-elo-ucl-v0.2+unified_cal` (C3) | the same unified ratings | raw probabilities, then the **frozen** vector scaling `t=1.2, b=[0, -0.1, -0.1]` (`ml/models/calibrators/ucl_unified_cal.json`, fitted on the 2021-22..2023-24 selection seasons, never refit) |

The unified Elo (`pipeline/ucl_unified_elo.py`) is one joint chronological
replay of twelve domestic leagues (E0 SP1 D1 I1 F1 N1 P1 T1 B1 SC0 G1 and Austria)
plus every UCL match, from 2011-07-01. K and home advantage as served (K 30,
HA 60 everywhere, no season regression). Tier seeds ENG/ESP/GER/ITA 1600,
FRA/POR 1550, NED/TUR/BEL/GRE/AUT/SCO 1500; a club first seen after its
league's opening season starts 100 lower (a promoted side); clubs from a
country with no feed enter at 1450 and their *used* rating is shrunk toward
1450 by n/(n+10). Constants are frozen in the experiment's `frozen.json` and
copied into the snapshot, which the loader refuses if they differ.

Everything else is identical to the served row: same `build_payload` path, same
tournament delta/form wrapping of the base rating, same availability, odds and
suspension layers. The base rating is the only difference (plus the
calibrator for `unified_cal`).

## Mechanics

- **Frozen snapshot** `ml/models/ucl_unified_snapshot.json`: per-club rating
  and rated-match count, per-division opening season, constants, cutoff
  (2026-07-01) and source provenance. Built offline by
  `pipeline/build_ucl_unified_snapshot.py` from the raw captures, which are not
  committed. Only derived ratings and a sha256 of each source's canonical event
  lines are stored.
- **Continuation** each pipeline run: fetch the current-season (`2627`)
  football-data.co.uk files for the twelve divisions, take the DB's UCL results
  dated on or after the cutoff (regulation-time scores, as the served history
  sync stores them), continue the identical replay (same-day domestic before UCL).
- **Identity**: DB team name to canonical key through an explicit table
  (`pipeline/ucl_unified_names.py`), no fuzzy matching. An unmapped club is
  treated as a no-feed club and listed loudly in the step output.
- **Fail closed**: any fetch, parse or snapshot problem (including a missing
  division file) makes the run skip both variants; served rows are untouched
  and byte-identical. A skipped run simply leaves no shadow row for that run.
- **Enablement** is in code: `CLUB_SHADOW_VARIANTS: "ucl:unified,ucl:unified_cal"`
  in `.github/workflows/refresh.yml`, so merging turns it on and reverting turns
  it off. No Actions variable is involved.

Data terms: openfootball is CC0. football-data.co.uk is free to download and
use per the site ("Simply download for free the available files"); the site
reserves other rights and grants no redistribution, so this repo commits only
derived ratings and hashes, never their files (see `docs/DATA-VALIDATION-PROGRAM.md`, G1).
The site asks for attribution: ratings derive in part from football-data.co.uk.

## Forward-test plan (fixed before the first shadow row exists)

- **Unit and scored set.** Every UCL 2026-27 match that kicks off *after the
  shadow's first run* (league-phase matchdays 6-8: 8-9 Dec 2026, 19-20 Jan 2027,
  27 Jan 2027, then the play-offs and knockouts). For each match and each tag,
  the row is the latest one created before kickoff; the served comparator is the
  latest pre-kickoff `poisson-elo-ucl-v0.2` row of the same match. A match enters
  a comparison only if both rows exist; the number excluded is reported, never
  silently dropped.
- **Primary metric.** 1X2 log loss of the shadow row minus the served row, per
  match, averaged. Negative favours the shadow. 90-minute result, as everywhere
  in this ledger.
- **Uncertainty.** Bootstrap 95% CI clustered by calendar matchweek (ISO week of
  kickoff), 4000 resamples (`club_walkforward.season_clustered_ci`, as the
  experiment). Expect wide intervals: roughly 54 league-phase matches plus the
  knockouts is small, and these matches are clustered in a handful of weeks.
- **Interim look.** After matchday 8 a descriptive table only (mean delta, CI,
  per-club points vs expected, extreme favourites). **No decision** is taken from
  it and nothing is changed because of it.
- **Promotion case.** Both must hold: (1) `unified_cal` has a CI **upper bound
  below 0** over the full 2026-27 forward set, and (2) `unified_cal` is not
  worse than served (mean delta <= 0) on the **2027-28 league phase**, a second,
  independent season. Promotion would still be a separate reviewed change through
  the stop gate. `unified` is diagnostic: it separates the ratings effect from
  the calibrator effect and has no promotion case of its own.
- **No retuning.** Neither shadow's seeds, constants, snapshot, calibrator or
  mapping may change during the test. A bug fix that changes any forecast restarts
  the test (new tag) and is logged here. Adding a missing name to the mapping
  table is a bug fix of that kind; the unmapped list is monitored so it can be
  done early.
- **Known limits.** One-and-a-half seasons of forward data cannot overturn a
  failed offline selection by itself, which is why (2) demands a replication.
  The DB (API-Football) feed, not the saved payload the experiment used, now
  supplies 2026-27 UCL results: both come from the same stored matches with the
  same 90-minute preference, so no divergence is expected from the source swap,
  but a provider duplicate or a result a run late would shift a rating slightly.
  Domestic results arrive from football-data.co.uk with some lag, so live
  ratings can trail a fully-updated offline replay by a few days of domestic
  matches; this is the real-time condition being tested.
