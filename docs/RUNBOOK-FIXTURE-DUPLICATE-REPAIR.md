# Runbook: provider-cutover duplicate fixture repair

**Tool:** `pipeline/repair_fixture_duplicates.py`
**Workflow:** `.github/workflows/repair-fixture-duplicates.yml` (manual dispatch only)
**Tests:** `pipeline/repair_fixture_duplicates_test.py`, `pipeline/repair_fixture_duplicates_workflow_test.py`

Written for the owner. Every step that touches production is stop-gated
(`CLAUDE.md`): it happens only after an explicit "go".

## What went wrong

API-Football lapsed on 2026-08-18 and football-data.org took over league fixtures on
2026-09-02. Three promoted clubs had no name alias, so they were created a second
time: Real Racing Club de Santander (id 647, original Racing Santander 406),
RC Deportivo La Coruña (648, original Deportivo La Coruna 375) and SV 07 Elversberg
(649, original SV Elversberg 437). Every one of their fixtures got a second row:
about 74 in La Liga and 34 in the Bundesliga. Since then:

- the old (API-Football) rows are frozen at their 18 Aug state; some still read
  "scheduled" and get a new prediction every day, long after the match was played;
- the new (football-data) rows have the real kickoffs, results, predictions and
  grades, and may have user picks;
- matches that finished on both copies (16–17 Aug) are in the results history twice,
  so club ratings count them twice.

## What the repair does, in short

For each fixture it merges the new copy into the old one (the old match id is kept, so
links keep working), then merges each duplicate club into the original club. It refuses
to run whenever it cannot prove a merge is right, and it never deletes a user's pick
or a grade unless you tell it which copy to keep. Every row it deletes is written to
the evidence file in full.

It stops (lists the problem under `blocking`) when:

- a fixture of a duplicate club has no twin to merge into;
- the two copies have different matchweeks;
- the two kickoffs are more than 14 days apart (normal reschedules move a match
  within its weekend or, for cup and European congestion, within two weeks; anything
  bigger is a postponement or a wrong pair, so a person must confirm it);
- both copies finished with different scores and one of them is graded;
- a grade it would keep does not match the result the merged match shows;
- a graded prediction would have to be deleted.

The last two cannot be overridden. The first three and the score mismatch can be
confirmed per match with an acknowledgement (below), after you have checked it.

## Before you start

1. **Back up the database** from the MacBook (the only machine that holds
   `DATABASE_URL`). Assume Render's free Postgres has no point-in-time recovery: this
   file is the only way back.

   ```sh
   pg_dump -Fc "$DATABASE_URL" -f finalwhistle-before-repair-$(date +%Y%m%d-%H%M).dump
   pg_restore -l finalwhistle-before-repair-*.dump | head   # must list tables, no error
   ```

   Keep the file outside the repository (never commit it, never upload it anywhere
   public).

2. **Pause the scheduled writers** before merging, and pick a window with no
   La Liga, Bundesliga or Champions League match in play:

   ```sh
   gh workflow disable refresh.yml
   gh workflow disable odds-snapshots.yml
   ```

   Why: the first refresh after the merge uses the new aliases, re-points the new
   copies at the original clubs and re-inserts about 35 finished fixtures into the
   results history under the original club. From then until the repair, every refresh
   computes club ratings with those matches counted twice, and predictions frozen
   from those ratings can never be corrected. Measured: the duplicate history rows go
   1 → 2 on the first refresh and stay at 2 on later ones, so the damage is that
   first refresh plus every prediction made while it stands. The repair still gets
   the right answer if a refresh does run (tested), but avoid it.

   The repair shares the `production-database` lock only with `refresh.yml`.
   `odds-snapshots` (hourly), `market-intel` (daily), `refresh-live` (every two hours)
   and the live API also write to the database. Any of them changing a row the repair
   touches makes the digest differ, and apply then refuses: that is safe, but it means
   running the dry run again. In a quiet window with the two workflows paused this
   should not happen.

## Steps

3. **Merge the PR** (go required).

4. **Dry run.** In GitHub, Actions → repair-fixture-duplicates → Run workflow, with
   `apply` unticked and everything else empty. The dry run never commits. It checks the
   database schema is up to date (it does not migrate), plans the repair, then runs it
   once inside a savepoint and rolls it back to prove it works. For as long as that
   trial runs it holds the same row locks apply would; it gives up after waiting 5
   seconds for a lock or 60 seconds on one statement rather than hold up the site. If the site is busy, untick `trial` to plan only.

   The log starts with a plain summary; the full evidence is the
   `repair-evidence-dry-run-…` artifact. Check:

   - `clubs_merged`: exactly the three clubs above, each into its original.
   - `fixtures_merged`: about 74 La Liga and 34 Bundesliga.
   - `blocking_issues`: must be 0. The evidence lists each one under `report.blocking`.
   - `warnings`: read every one in `report.warnings` (for example, old fixtures of an
     affected club with no twin).
   - `fixtures_with_different_final_scores`: look at each one on a results site.
   - `public_record`: how the published AI record changes (graded matches, correct
     winner calls, exact scores, before → after).
   - `user_picks_deleted`, `league_score_predictions_deleted` (and how many of those
     were already scored), `…_becoming_scoreable`, `matches_gradeable_at_next_refresh`,
     `history_rows_dropped`.
   - `report.match_mappings`: per fixture, both kickoffs and the gap, both statuses and
     scores, and which copy's state is kept (`state_source`).

5. **Decide what the dry run asks you to decide**, then run the dry run again with
   those inputs until it prints `ready_to_apply: true`:

   - **Conflicts** (`on_conflict`): the same user has a pick, or a score prediction, on
     both copies of a match, or both copies have a grade. Only one can stay.
     `keep-donor` keeps the one on the new copy, which is what users have been looking
     at since 2 Sep; `keep-survivor` keeps the one on the old copy. You can choose per
     table, e.g. `match_picks=keep-donor`. For grades, keep the grade on the copy whose
     match state is kept (the evidence's `state_source`; usually the new copy, i.e.
     `prediction_results=keep-donor`). The tool will refuse any other choice that
     leaves a grade disagreeing with the shown result.
   - **Acknowledgements** (`acknowledge`), only after checking each match yourself:
     `kickoff-gap:<id>`, `score-mismatch:<id>`, `unpaired:<id>` (moves that fixture to
     the original club without merging it). Ids are the ones named in `blocking`.

6. **Apply within the hour.** Run the workflow with `apply` ticked, the same
   `on_conflict` and `acknowledge` values, and `expected_digest` set to the `digest:`
   line of the last dry run, on the same commit. The apply job waits for the
   `production-database` environment approval. It replans and refuses if anything
   differs from the dry run: another commit, other inputs, or data that changed in
   between. A refusal writes nothing; run the dry run again and use the new digest.
   Keep the `repair-evidence-apply-…` artifact: it is the record of every deleted row.

7. **Check and resume.**
   - Run the dry run once more: it must report nothing to do (0 clubs, 0 fixtures).
   - Re-enable the writers and run a refresh:

     ```sh
     gh workflow enable refresh.yml
     gh workflow enable odds-snapshots.yml
     gh workflow run refresh.yml
     ```

     The refresh grades the matches listed in `matches_gradeable_at_next_refresh` and
     recomputes club ratings from the corrected history.
   - `GET /api/health`: the stuck La Liga and Bundesliga fixtures are gone. The 14
     orphaned Champions League play-off fixtures will still be reported; they are a
     separate problem this repair does not touch.
   - Open one merged fixture's match page and check the result and the shown
     prediction.

## One-time setup for the approval gate

The apply job runs in a GitHub environment called `production-database`, which
GitHub creates the first time the job runs. Before the first apply, in the repository
on GitHub: Settings → Environments → `production-database`:

- **Required reviewers**: add yourself (and anyone else who must approve).
- **Deployment branches and tags**: "Selected branches and tags", add `main` only.

The dry-run job has no environment, so it never waits for an approval.

## Not handled

- Match ids inside JSON history (`venue_market.mapping_history`,
  `resolution_context`) are not rewritten; `venue_market.canonical_event_id` is.
- Predictions already made from double-counted ratings stay as they are
  (predictions are never edited after the fact).
