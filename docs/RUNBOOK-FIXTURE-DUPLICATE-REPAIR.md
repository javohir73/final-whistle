# Runbook: provider-cutover duplicate fixture repair

**Tool:** `pipeline/repair_fixture_duplicates.py`
**Workflow:** `.github/workflows/repair-fixture-duplicates.yml` (manual dispatch only)
**Tests:** `pipeline/repair_fixture_duplicates_test.py`, `pipeline/repair_fixture_duplicates_workflow_test.py`

## What went wrong

API-Football lapsed on 2026-08-18 and football-data.org took over league fixtures on
2026-09-02. Promoted clubs with no alias (Real Racing Club de Santander, RC Deportivo
La Coruña, SV 07 Elversberg, plus Málaga CF) were created as new clubs, and each of
their fixtures got a second Match row: 74 in La Liga and 34 in the Bundesliga. Since
then:

- the legacy (API-Football) rows are frozen at their 18 Aug state; some still read
  `scheduled` and keep receiving a new prediction every day, long after kickoff;
- the football-data rows carry the real kickoffs, results, predictions and grades,
  and may have user picks;
- matches that finished on both copies (16–17 Aug) are in `historical_matches`
  twice, so club Elo counts them twice.

## What the repair does

For every duplicate club it merges the football-data copy of each fixture (the
**donor**) into the legacy copy (the **survivor**, whose id is kept so links and
picks keep working), then merges the duplicate club into the original club.

- **Pairing** is by identity: same tournament, same oriented (home, away) canonical
  club pair, one football-data row and one legacy row. Current team ids and kickoff
  are not used, so a moved kickoff still pairs and the plan is the same before and
  after an alias-aware refresh. Matchweek breaks a tie. Anything still ambiguous
  stops the tool with the row ids; nothing is written.
- **Fixture state** comes from the donor, except that a finished survivor is never
  un-finished by an unfinished donor (the ingest rule). Provider identity always
  moves to the survivor so the next refresh reconciles it by fixture id.
- **Dependent rows** (predictions, grades, picks, score predictions, lineups, odds,
  validation rows, market snapshots, venue markets) move to the survivor. Rows that
  would break a unique constraint are **conflicts** (see below).
- **Derived duplicates are dropped automatically and listed in full** in the
  evidence: a second `historical_matches` row for the same real match; a second
  `odds` row for the same phase (the stale copy's is dropped); a second
  `probability_snapshots` row for the same day; the duplicate club's regenerable
  rows (`group_teams`, `standings`, `team_stats`, `team_tournament_state`,
  `tournament_odds`); and predictions that would change which prediction reads as
  frozen.
- **Frozen = graded.** On the merged row (kickoff K): predictions from the stale copy
  created after K are dropped; for each kept grade, predictions from the other copy
  in the same basis created at or before K that sort after the graded prediction are
  dropped. A graded prediction is never dropped or edited, and no prediction is
  created; if one would have to go, the plan is **blocked**. After the merge the tool
  checks `_frozen_prediction`, `latest_prediction` and the shadow frozen selection
  against every kept grade and rolls back if any disagree.
- **The duplicate club is deleted last**, after a check that nothing references it or
  the donor matches any more. Every check failure rolls the whole transaction back.

## Conflicts and choosing a policy

A conflict is a pair of rows, one on each copy, that cannot both live on the merged
match: `match_picks (user_id, match_id)`, `league_score_predictions (match_id,
player_id)`, `prediction_results (match_id, is_shadow)`, `match_lineups (match_id,
side)`, `bracket_group_picks (bracket_id, match_id)`. Each is listed with the table,
the key, and both rows in full (for picks: both picks and their `updated_at`).

Apply refuses while any conflict is unresolved. Resolving one deletes a user's data,
so it is the owner's decision; the tool only makes it explicit:

| Policy | Keeps | Typical reason |
|---|---|---|
| `keep-donor` | the row on the football-data copy | it is the copy users have seen and acted on since 2 Sep; for a pick, usually the later `updated_at` |
| `keep-survivor` | the row on the legacy copy | the legacy row predates the cutover and should stand |

Pass one policy for every table (`keep-donor`) or per table
(`match_picks=keep-donor prediction_results=keep-survivor`). A per-table entry wins.
Every deleted row (and any child row, e.g. a deleted lineup's players) is written to
the evidence with the reason `conflict_loser:<policy>`.

## Operating sequence

Each step that touches production is stop-gated (`CLAUDE.md`): show the summary,
wait for "go".

1. **Merge the PR** (aliases + repair tool). The daily refresh may run after this.
   With the new aliases it re-points the football-data rows at the original clubs,
   and the repair still finds the same pairs and ends with the same result (tested:
   `test_end_to_end_on_a_production_shaped_database[True]`). One cost: each refresh in
   this window re-syncs every finished football-data fixture into
   `historical_matches` under the original club, so those matches count twice in club
   Elo until the repair runs. The repair removes the extra rows; keep the window short.
2. **Dry run.** Dispatch `repair-fixture-duplicates` with `apply=false`, empty
   `expected_digest`, empty `on_conflict`. The workflow applies migrations, asserts
   the schema is at Alembic head, plans, executes once inside a savepoint to prove
   the plan, rolls back, and uploads `repair-evidence.json`. The log prints the
   evidence summary, then `digest: <hex>` and `ready_to_apply: true|false`.
3. **A human reads the evidence** and checks:
   - `team_mappings`: only the expected clubs, each mapped to the right original.
   - `tournament_counts` and `matches_merged`: about 74 La Liga and 34 Bundesliga.
   - `match_mappings`: per pair, both statuses and scores, `kickoff_delta_seconds`,
     `state_source` (should be `donor` except where the legacy row was finished and
     the donor was not), and any `score_mismatch: true` (both finished with
     different results; investigate before applying).
   - `blocking`: must be empty. `warnings`: read each one.
   - `conflicts`: decide a policy (above).
   - `dropped_counts` / `deleted_rows`: `historical_matches` should equal the
     number of real matches recorded twice; `predictions` should be stale-copy rows
     after kickoff or rows outranking a graded one; no surprises elsewhere.
   - `moved_counts`: dependent rows that will follow the merge.
   - `trial`: must be `ok`.
4. **If there are conflicts**, dispatch the dry run again with `on_conflict` set
   (for example `match_picks=keep-donor`). Repeat step 3 on the new evidence until it
   prints `ready_to_apply: true`. The digest changes with the policy.
5. **Apply.** Dispatch with `apply=true`, the same `on_conflict` value, and
   `expected_digest` set to the `digest:` line from step 4, on the same commit. The
   tool replans and refuses if the digest differs: another commit, another policy,
   or data that changed since the dry run (a refresh in between adds predictions, so
   a scheduled refresh landing between the two runs makes apply refuse; just repeat
   steps 2–5). Apply also refuses without a digest, with unresolved conflicts, or
   with a blocked plan. Keep the evidence artifact; it is the record of every row
   deleted.
6. **Verify.** Dispatch the dry run once more: it must report `matches_merged: 0`,
   `teams_merged: 0` and no deleted rows (the repair is idempotent). Then let the
   next refresh run (it recomputes club Elo from `historical_matches`), and check
   `GET /api/health` and a merged fixture's match page.

## Not handled

- Match ids inside JSON (`venue_market.mapping_history`, `resolution_context`) are
  history and are not rewritten; `venue_market.canonical_event_id` is.
- Predictions already served from inflated Elo during the window stay as they are
  (predictions are append-only).
- Required reviewers on the workflow need a GitHub environment, which cannot be set
  from repository files; see the workflow header.
