# Runbook: provider-cutover duplicate fixture repair

**Tool:** `pipeline/repair_fixture_duplicates.py` (undo: `pipeline/repair_fixture_duplicates_undo.py`)
**Workflow:** `.github/workflows/repair-fixture-duplicates.yml` (manual dispatch only)
**Scripts:** `scripts/fixture_repair_backup.sh`, `scripts/fixture_repair_restore.sh`,
`scripts/fixture_repair_writers.sh`
**Tests:** `pipeline/repair_fixture_duplicates_test.py`, `…_cli_test.py`, `…_workflow_test.py`,
`pipeline/fixture_repair_scripts_test.py`

Written for the owner. Every step that touches production or GitHub settings is
stop-gated (`CLAUDE.md`): it happens only after an explicit "go". Commands run on the
MacBook, in the project folder (`~/Projects/Final Whistle`), the only machine holding
`.env`. Anything where a typing mistake could do damage is a script; nothing below asks
you to paste a database URL or password.

## What went wrong

API-Football lapsed on 2026-08-18 and football-data.org took over league fixtures on
2026-09-02. Three promoted clubs had no name alias, so they were created a second
time: Real Racing Club de Santander (id 647, original Racing Santander 406),
RC Deportivo La Coruña (648, original Deportivo La Coruna 375) and SV 07 Elversberg
(649, original SV Elversberg 437). Every one of their fixtures got a second row:
about 74 in La Liga and 34 in the Bundesliga. Since then:

- the old (API-Football) rows are frozen at their 18 Aug state; some still read
  "scheduled" and got a new prediction every day, long after the match was played;
- the new (football-data) rows have the real kickoffs, results, predictions and
  grades, and may have user picks;
- matches that finished on both copies (16–17 Aug) are in the results history twice,
  so club ratings count them twice.

## What the repair does, in short

For each fixture it merges the new copy into the old one (the old match id is kept),
then merges each duplicate club into the original club. It never deletes a user's
pick or a grade unless you say which copy to keep, and it refuses whenever it cannot
prove a merge is right.

Before its first write, apply writes the evidence file to disk: every deleted row in
full, every re-pointed row (old and new value), every survivor's row before the merge,
every history row it corrected, and the old learning-chain counter. JSON columns are
kept as stored, so a JSON `null` and an empty (SQL NULL) value stay distinct. The undo
tool uses only that file. On the rehearsal's production-shaped Postgres copies,
including one where the JSON columns hold JSON `null` as production does, apply
followed by undo gave back every row with identical content (compared with Postgres'
own `md5(row::text)`; only the internal row versions differ, as they must).

**Links that stop working.** The new copies' match ids (the ones users have opened
since 2 Sep) no longer exist after the repair, so their match pages show "not found".
The summary lists them under `match_ids_that_stop_existing`. A redirect is possible
cheaply but is not built: a small file mapping each of those ids to the kept id (taken
from the evidence) plus about ten lines in `backend/app/api/matches.py` that look an
unknown id up in it before returning 404. Say if you want it.

## Every way the dry run can stop, and the way forward

The dry run lists each problem under `BLOCKING:` in the log, with the exact input to
use. Each answer goes in the workflow's `acknowledge` box as `<kind>:<match id>`
(several separated by spaces), only after you have checked that match yourself.

| The dry run says | What it means | Ways forward |
|---|---|---|
| no twin / twin in another tournament / ambiguous group / legacy fixture with no twin | it cannot find exactly one old and one new copy | `exclude:<id>` for each fixture named |
| partial exclusion | you excluded one copy of a pair but not the other | exclude both, or neither |
| matchweek A vs B | the two copies say different rounds | `matchweek-mismatch:<id>` if it is the same match, else exclude both |
| kickoffs N days apart (limit 14) | a big reschedule, or a wrong pair | `kickoff-gap:<id>` if it is the same match, else exclude both |
| different final scores and one is graded | the two copies disagree on the result | check the real result; `score-mismatch:<id>` keeps the new copy's result; else exclude both |
| kept grade records X but the match is Y / graded prediction would have to be dropped / grade points outside the pair | a published grade cannot survive the merge as it is | the conflict policy that keeps the grade on the copy whose state is kept, or `regrade:<id>` (deletes that match's grades, listed in full; the next refresh grades the frozen prediction against the real result), or exclude both |
| conflicts (`CONFLICTS: match_picks: N …`) | the same user has something on both copies | a policy, below |
| session timezone is not UTC | history keys would not match the refresh | stop and ask |
| alias table / not exactly one club to one club | a code problem, not a data one | stop; it needs a code fix |

`exclude` leaves the fixture exactly as it is: its row, its picks and predictions, its
grades, its history rows, and the duplicate club it belongs to. Every later dry run
shows it again ("not ready") until it is dealt with by hand; pass the same `exclude:`
items to see whether anything else is left. An acknowledgement that matches nothing is
listed under `WARNING:` (for pair decisions, use the id of the kept, older copy that the
blocking line names).

**Conflict policy** (`on_conflict`): `keep-donor` keeps the row on the new copy,
which is what users have been looking at since 2 Sep; `keep-survivor` keeps the row on
the old copy. You can choose per table, e.g. `match_picks=keep-donor`. For grades,
keep the grade on the copy whose match state is kept (`state_source` in the evidence;
usually the new copy, i.e. `prediction_results=keep-donor`).

## Before you start (once)

1. **The approval gate.** Create the `production-database` environment with you as
   required reviewer and only `main` allowed to deploy, before the first apply. The
   apply job checks both and refuses to run if either is missing.

   ```sh
   REVIEWER_ID=$(gh api users/javohir73 --jq .id)
   gh api -X PUT repos/javohir73/final-whistle/environments/production-database --input - <<JSON
   {"reviewers": [{"type": "User", "id": $REVIEWER_ID}],
    "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
   JSON
   gh api -X POST repos/javohir73/final-whistle/environments/production-database/deployment-branch-policies \
     -f name=main -f type=branch
   gh api repos/javohir73/final-whistle/environments/production-database \
     --jq '{rules: [.protection_rules[].type], branches: .deployment_branch_policy}'
   ```

   The last command must show `required_reviewers` and a non-null branch policy. In
   the browser: repository → Settings → Environments → New environment
   `production-database` → Required reviewers: add javohir73 → Deployment branches and
   tags: "Selected branches and tags", add `main`. Leave "Prevent self-review" off,
   or you cannot approve your own run.

2. **The evidence key.** The repository is public, so workflow logs and artifacts are
   readable by anyone. The log only shows the summary (clubs, counts, fixture ids, and
   error classes; never row values, host names or user names). The full evidence file
   (it contains users' picks) is uploaded only encrypted, to a certificate whose private
   key stays on the MacBook. The apply job test-encrypts with it before it starts.

   ```sh
   mkdir -p ~/fw-backups/repair-key && chmod 700 ~/fw-backups ~/fw-backups/repair-key
   ( cd ~/fw-backups/repair-key \
     && openssl req -x509 -newkey rsa:4096 -nodes -keyout repair-evidence.key \
          -out repair-evidence.crt -subj /CN=fw-repair-evidence -days 60 \
     && chmod 600 repair-evidence.key )
   gh variable set REPAIR_EVIDENCE_CERT --repo javohir73/final-whistle \
     < ~/fw-backups/repair-key/repair-evidence.crt
   ```

   To read an evidence artifact (set `RUN_ID` to the run's number from its URL):

   ```sh
   RUN_ID=1234567890
   gh run download "$RUN_ID" --repo javohir73/final-whistle --dir "evidence-$RUN_ID"
   openssl smime -decrypt -binary -inform DER \
     -inkey ~/fw-backups/repair-key/repair-evidence.key \
     -in "evidence-$RUN_ID"/*/repair-evidence.json.p7m -out "repair-evidence-$RUN_ID.json"
   ```

   Keep the decrypted file and the key out of the repository.

3. **Pre-flight checks.**
   - Production's timezone, server version and counts (prints, changes nothing; fails
     if the session timezone is not UTC, because the repair computes history keys in
     UTC and the refresh's sync uses the session timezone):

     ```sh
     scripts/fixture_repair_backup.sh --info
     ```

   - Málaga. The PR also adds a `Málaga CF` → `Malaga` alias, with no matching merge.
     That is intended: production has only "Malaga" (id 377) and no "Málaga CF" club
     (checked 2026-11-20), so there is nothing to repair; the alias only makes the
     existing match explicit. Confirm that it is still true (expected `['Malaga']`):

     ```sh
     curl -s https://pitchprophet-api.onrender.com/api/teams \
       | python3 -c "import json,sys; print([t['name'] for t in json.load(sys.stdin) if 'laga' in t['name']])"
     ```

## The repair, step by step

Pick a window with **no La Liga, Bundesliga or Champions League match in play** and
about two hours free.

1. **Migrate, then pause every scheduled writer.** The repair checks that the database
   schema is up to date and refuses otherwise, but never migrates; the only migration
   path is `refresh.yml`. So run one normal refresh first and wait for its real result,
   then pause:

   ```sh
   scripts/fixture_repair_writers.sh refresh   # dispatches refresh.yml, waits, fails if it fails
   scripts/fixture_repair_writers.sh pause     # disables all eight writers and verifies
   ```

   `keep-warm` and `smoke` only read and stay on. If an external cron service (for
   example cron-job.org) calls `/api/internal/refresh-live`, pause it too. The live API
   itself still writes (user picks, live scores), which is why the window matters.

   Why pause before merging: the first refresh after the merge uses the new aliases,
   re-points the new copies at the original clubs and re-inserts about 35 finished
   fixtures into the results history under the original club (measured 1 → 2 rows per
   match on that first refresh, then stable at 2). Every refresh until the repair would
   then compute club ratings with those matches counted twice, and predictions frozen
   from those ratings can never be corrected. The repair still gets the right answer if
   it happens (tested), but avoid it. The repair shares a lock (`production-database`)
   with `refresh.yml` only; that is why the others are paused.

2. **Merge the PR** (go required). It contains no database migration.

3. **Dry run.** Actions → repair-fixture-duplicates → Run workflow, `apply` unticked,
   everything else empty. The dry run never commits. It plans, then runs the plan once
   inside a savepoint and rolls it back to prove it works. On the rehearsal copy that is
   150 database statements in all (148 for apply), 87 of them while holding row locks (about 5 s at
   50 ms per statement). The tool waits at most 5 s for any lock and 60 s for any one
   statement, and Postgres ends its transaction after 30 s idle (for example if the
   runner dies). A connection that wants a row the repair has locked waits until the
   repair finishes (measured worst case 3.7 s at 50 ms per statement). If such a
   connection changes a row first, the repair stops and writes nothing. Untick `trial`
   to plan only.

   The job is red ("not ready") until every blocking item is answered; that is expected
   on the first run. The log shows the plain summary, then `BLOCKING:`, `WARNING:` and
   `CONFLICTS:` lines. Check:

   - `clubs_merged`: exactly the three clubs above, each into its original.
   - `fixtures_merged`: about 74 La Liga and 34 Bundesliga.
   - every `BLOCKING:` and `WARNING:` line (table above).
   - `fixtures_with_different_final_scores`: look each one up on a results site.
   - `public_record`: how the published AI record changes (before → after).
   - `user_picks_deleted`, `league_score_predictions_deleted` (and how many of those
     were already scored), `…_becoming_scoreable`, `matches_gradeable_at_next_refresh`,
     `history_rows_dropped`, `history_rows_corrected`, `match_ids_that_stop_existing`.

   Fill in `on_conflict` / `acknowledge` and run the dry run again until it prints
   `status: ready`, `ready_to_apply: true` and a `digest:` line.

   **Prove the key works before any apply:** download and decrypt this dry run's
   evidence (Before you start, 2). If it does not decrypt, stop: fix the certificate
   and key first.

4. **Back up, immediately before applying** (after the last dry run, nothing in
   between). Assume Render's free Postgres has no point-in-time recovery: this file is
   the only way back.

   ```sh
   scripts/fixture_repair_backup.sh
   ```

   It reads the URL from `.env` without showing it, insists on Render's external host,
   checks the local `pg_dump` is at least the server's version, dumps to
   `~/fw-backups/finalwhistle-<db>-<UTC time>.dump`, converts the whole dump back to
   SQL to prove it is readable, and compares its table count and `matches` count with
   the live database. It also writes a sidecar `….dump.meta.json` (host, database,
   versions, timezone, counts, sha256), which the restore script requires. It ends with
   `backup ok`; anything else is a failure. If it says the local `pg_dump` is too old,
   install the server's major version (the message names it; 16 in this example) and put
   it first in `PATH` in the same terminal:
   `brew install postgresql@16 && export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"`. Never put the dump in the repository
   or upload it anywhere.

5. **Apply within the hour.** Run the workflow with `apply` ticked, the same
   `on_conflict` and `acknowledge` values, and `expected_digest` set to the last dry
   run's `digest:` line. It waits for your approval (the environment). It replans and
   refuses (writing nothing) if anything differs from the dry run: another commit,
   other inputs, or any change to a row it would touch. If it refuses, run the dry run
   again, take a new backup, and use the new digest. Download, decrypt and keep the
   apply run's evidence: it is the record of every change and what the undo needs. It
   is uploaded even if the apply step fails.

6. **Check and resume.**
   - Run the dry run once more (with the same `exclude:` items, if any): it must say
     `status: nothing to repair`.
   - Resume the writers and run a refresh:

     ```sh
     scripts/fixture_repair_writers.sh resume
     scripts/fixture_repair_writers.sh refresh
     ```

     The refresh grades the matches in `matches_gradeable_at_next_refresh` and
     recomputes club ratings from the corrected history. Re-enable any external cron.
   - `GET https://pitchprophet-api.onrender.com/api/health`: the stuck La Liga and
     Bundesliga fixtures are gone. The 14 orphaned Champions League play-off fixtures
     will still be reported; they are a separate problem.
   - Open one merged fixture's match page and check the result and the shown
     prediction.

## Undo only the repair (keeps everything written since)

From the decrypted apply evidence. It refuses unless that repair is applied to the
database it connects to, and it reports first and writes nothing without
`--confirm-database`:

```sh
PYTHONPATH=backend:. python -m pipeline.repair_fixture_duplicates_undo \
  --evidence-file "repair-evidence-$RUN_ID.json"
DB_NAME=the_name_it_printed   # replace with the database name the first command printed
PYTHONPATH=backend:. python -m pipeline.repair_fixture_duplicates_undo \
  --evidence-file "repair-evidence-$RUN_ID.json" --confirm-database "$DB_NAME"
```

Everything runs in one transaction. A row written after the repair that collides with
one being restored (for example a new pick on a restored fixture) makes it refuse with
nothing changed. Pause the writers first (step 1).

## Restore from the backup (replaces the whole database)

Only if the repair has to be undone wholesale and the undo above cannot be used.
**Everything written after the backup is lost** (picks, predictions, live scores,
grades made since). The next refresh re-ingests fixtures and results; lost user picks
cannot be recovered.

1. Pause the writers (`scripts/fixture_repair_writers.sh pause`), any external cron,
   and preferably suspend the API (Render dashboard → pitchprophet-api → Suspend).
2. Restore:

   ```sh
   scripts/fixture_repair_restore.sh "$(cat ~/fw-backups/LATEST)"
   ```

   It changes nothing unless the dump matches its sidecar's sha256, the local
   `pg_restore` converts the whole dump with every table and every `matches` row, the
   target in `.env` is the recorded host and database (checked on the server too), and
   you type the database name. Then it replaces the schema and loads the dump in one
   transaction (any error: nothing changes), and compares the table count, `matches`
   count and schema revision with the sidecar. Only `restore committed and verified`
   means success. (`pg_restore --clean` cannot be used: it fails on the partitioned
   price-tick table's inherited constraints.) If the database user may not drop the
   `public` schema, it fails with nothing changed; then restore into a new Render
   database instead.
3. Resume: un-suspend the API, `scripts/fixture_repair_writers.sh resume`,
   `scripts/fixture_repair_writers.sh refresh`, check `/api/health`.

The backup and restore scripts were rehearsed against a local Postgres 16 copy,
including an unreadable dump, a truncated dump, a forged sidecar, the wrong host, the
wrong database and a wrong confirmation: each refused and left the target untouched.

## Not handled

- Match ids inside JSON history (`venue_market.mapping_history`,
  `resolution_context`) are not rewritten; `venue_market.canonical_event_id` is.
- Predictions already made from double-counted ratings stay as they are
  (predictions are never edited after the fact).
