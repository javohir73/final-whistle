# Runbook: provider-cutover duplicate fixture repair

**Tool:** `pipeline/repair_fixture_duplicates.py`
**Workflow:** `.github/workflows/repair-fixture-duplicates.yml` (manual dispatch only)
**Tests:** `pipeline/repair_fixture_duplicates_test.py`, `pipeline/repair_fixture_duplicates_workflow_test.py`

Written for the owner. Every step that touches production or GitHub settings is
stop-gated (`CLAUDE.md`): it happens only after an explicit "go". Commands are run on
the MacBook, from the project folder (`~/Projects/Final Whistle`), which is the only
machine holding `.env`.

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
prove a merge is right. The evidence file it writes holds every deleted row in full,
every re-pointed row (old and new value), every survivor's row before the merge, every
history row it corrected, and the old learning-chain counter: enough to reverse the
repair by hand (tested on Postgres: the reversal gives back the database
byte-for-byte).

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
| no twin / twin in another tournament / ambiguous group / legacy fixture with no twin | it cannot find exactly one old and one new copy | `exclude:<id>` for each fixture named, which leaves it, its picks/predictions and its duplicate club untouched and lists it under `fixture_groups_left_for_manual_handling` |
| matchweek A vs B | the two copies say different rounds | `matchweek-mismatch:<id>` if it is the same match, else `exclude:<id> exclude:<other id>` |
| kickoffs N days apart (limit 14) | a big reschedule, or a wrong pair | `kickoff-gap:<id>` if it is the same match, else exclude both |
| different final scores and one is graded | the two copies disagree on the result | check the real result; `score-mismatch:<id>` keeps the new copy's result; else exclude both |
| kept grade records X but the match is Y / graded prediction would have to be dropped / grade points outside the pair | a published grade cannot survive the merge as it is | choose the conflict policy that keeps the grade on the copy whose state is kept, or `regrade:<id>` (deletes that match's grades, listed in full; the next refresh grades the frozen prediction against the real result), or exclude both |
| conflicts (`CONFLICTS: match_picks: N …`) | the same user has something on both copies | a policy, below |
| alias table / not exactly one club to one club | a code problem, not a data one | stop; it needs a code fix |

If you exclude anything, the club involved is kept, and every later dry run shows the
excluded fixtures again (it says "not ready") until they are dealt with by hand. Pass
the same `exclude:` items to the dry run after apply to confirm nothing else is left.

**Conflict policy** (`on_conflict`): `keep-donor` keeps the row on the new copy,
which is what users have been looking at since 2 Sep; `keep-survivor` keeps the row on
the old copy. You can choose per table, e.g. `match_picks=keep-donor`. For grades,
keep the grade on the copy whose match state is kept (`state_source` in the evidence;
usually the new copy, i.e. `prediction_results=keep-donor`).

## Before you start (once)

1. **The approval gate.** Create the `production-database` environment with you as
   required reviewer and only `main` allowed to deploy, before the first apply (the
   apply job refuses to run if either is missing):

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

2. **The evidence key.** This repository is public, so its workflow logs and
   artifacts are readable by anyone. The log only shows the summary (clubs, counts,
   fixture ids). The full evidence file (it contains users' picks) is uploaded only
   encrypted, to a certificate whose private key stays on the MacBook:

   ```sh
   mkdir -p ~/fw-backups/repair-key && chmod 700 ~/fw-backups ~/fw-backups/repair-key
   cd ~/fw-backups/repair-key
   openssl req -x509 -newkey rsa:4096 -nodes -keyout repair-evidence.key \
     -out repair-evidence.crt -subj /CN=fw-repair-evidence -days 60
   chmod 600 repair-evidence.key
   gh variable set REPAIR_EVIDENCE_CERT --repo javohir73/final-whistle < repair-evidence.crt
   cd -
   ```

   To read an evidence artifact later:

   ```sh
   gh run download <run id> --repo javohir73/final-whistle --dir evidence-<run id>
   openssl smime -decrypt -binary -inform DER \
     -inkey ~/fw-backups/repair-key/repair-evidence.key \
     -in evidence-<run id>/*/repair-evidence.json.p7m -out repair-evidence-<run id>.json
   ```

   Keep the decrypted file and the key off the repository.

3. **Málaga check.** The PR also adds a `Málaga CF` → `Malaga` alias, with no
   matching merge. That is intended: production has only "Malaga" (id 377) and no
   "Málaga CF" club (checked 2026-11-20 on `/api/teams`), so there is nothing to
   repair; the alias only makes the existing match explicit. Confirm that this is
   still true:

   ```sh
   curl -s https://pitchprophet-api.onrender.com/api/teams \
     | python3 -c "import json,sys; print([t['name'] for t in json.load(sys.stdin) if 'laga' in t['name']])"
   ```

   Expected: `['Malaga']`. Anything else: stop and ask.

## The repair, step by step

Pick a window with **no La Liga, Bundesliga or Champions League match in play** and
about two hours free.

1. **Migrate, then pause every scheduled writer.** The repair checks that the
   database schema is up to date and refuses otherwise, but it never migrates; the
   only migration path is `refresh.yml`. So run one normal refresh first, wait for it
   to succeed, then pause:

   ```sh
   gh workflow run refresh.yml --repo javohir73/final-whistle
   gh run watch --repo javohir73/final-whistle $(gh run list --repo javohir73/final-whistle \
     --workflow refresh.yml --limit 1 --json databaseId --jq '.[0].databaseId')
   for w in refresh.yml odds-snapshots.yml market-intel.yml shadow-record.yml \
            refresh-players.yml refresh-live.yml nrl-refresh.yml nrl-live-refresh.yml; do
     gh workflow disable "$w" --repo javohir73/final-whistle
   done
   gh workflow list --repo javohir73/final-whistle --all
   ```

   All eight must show `disabled_manually`. `keep-warm` and `smoke` only read and can
   stay on. If an external cron service (for example cron-job.org) calls
   `/api/internal/refresh-live`, pause it too. The live API itself still writes (user
   picks, live scores), which is why the window matters.

   Why pause before merging: the first refresh after the merge uses the new aliases,
   re-points the new copies at the original clubs and re-inserts about 35 finished
   fixtures into the results history under the original club (measured 1 → 2 rows per
   match on that first refresh, then stable at 2). Every refresh until the repair would
   then compute club ratings with those matches counted twice, and predictions frozen
   from those ratings can never be corrected. The repair still gets the right answer if
   it happens (tested), but avoid it.

   The repair shares a lock (`production-database`) with `refresh.yml` only; that is
   why the others must be paused by hand.

2. **Merge the PR** (go required). It contains no database migration, so the schema
   stays at head.

3. **Dry run.** Actions → repair-fixture-duplicates → Run workflow, `apply` unticked,
   everything else empty. The dry run never commits. It plans, then runs the plan once
   inside a savepoint and rolls it back to prove it works. That trial holds the same
   row locks apply would for a few seconds (about 90 database statements; measured
   about 5 s at 50 ms per statement). The tool waits at most 5 s for any lock and
   60 s for any one statement, and Postgres ends its transaction if it sits idle for
   30 s (for example if the runner dies). Other connections that want a row the repair
   has locked wait until the repair finishes (measured worst case 3.4 s). If one of them
   changes such a row first, the repair stops and writes nothing. Untick `trial` to plan
   only.

   The job is red ("not ready") until every blocking item is answered; that is
   expected on the first run. The log shows the plain summary, then `BLOCKING:`,
   `WARNING:` and `CONFLICTS:` lines. Check:

   - `clubs_merged`: exactly the three clubs above, each into its original.
   - `fixtures_merged`: about 74 La Liga and 34 Bundesliga.
   - every `BLOCKING:` and `WARNING:` line (table above).
   - `fixtures_with_different_final_scores`: look each one up on a results site.
   - `public_record`: how the published AI record changes (before → after).
   - `user_picks_deleted`, `league_score_predictions_deleted` (and how many of those
     were already scored), `…_becoming_scoreable`, `matches_gradeable_at_next_refresh`,
     `history_rows_dropped`, `history_rows_corrected`, `match_ids_that_stop_existing`.

   Fill in `on_conflict` / `acknowledge` and run the dry run again until it prints
   `status: ready`, `ready_to_apply: true` and a `digest:` line. Download and decrypt
   that run's evidence (above) and keep it.

4. **Back up, immediately before applying** (after the last dry run, nothing in
   between). Assume Render's free Postgres has no point-in-time recovery: this file is
   the only way back. On the MacBook, in the project folder:

   ```sh
   set -u
   # The URL in .env is Render's EXTERNAL url with SQLAlchemy's "+psycopg2" in the
   # scheme; pg_dump ignores such a url and silently dumps a local database, so strip it.
   PGURL="$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1 | tr -d "\"'" \
     | sed 's#^postgresql+psycopg2://#postgresql://#')"
   test -n "$PGURL" || echo "DATABASE_URL not found in .env"
   case "$PGURL" in *.render.com*) echo "external url: ok" ;; *) echo "NOT Render's external url: stop" ;; esac
   psql "$PGURL" -Atc "select current_database(), (select count(*) from matches)"
   SERVER_MAJOR=$(( $(psql "$PGURL" -Atc "show server_version_num") / 10000 ))
   LOCAL_MAJOR=$(pg_dump --version | sed -E 's/^[^0-9]*([0-9]+).*/\1/')
   echo "server $SERVER_MAJOR, local pg_dump $LOCAL_MAJOR"   # local must be >= server
   ```

   If the local `pg_dump` is older, `brew install postgresql@<server major>` and put
   `/opt/homebrew/opt/postgresql@<server major>/bin` first in `PATH`. Then:

   ```sh
   BACKUP_DIR=~/fw-backups; mkdir -p "$BACKUP_DIR" && chmod 700 "$BACKUP_DIR"
   DUMP="$BACKUP_DIR/finalwhistle-before-repair-$(date -u +%Y%m%dT%H%MZ).dump"
   pg_dump --format=custom --no-owner --no-acl --dbname="$PGURL" --file="$DUMP" && echo "dump ok: $DUMP"
   pg_restore --list "$DUMP" > "$DUMP.toc" && echo "dump readable"
   echo "tables with data: $(grep -c 'TABLE DATA' "$DUMP.toc"), ordinary tables in database: $(psql "$PGURL" -Atc \
     "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")"
   DUMP_MATCHES=$(pg_restore --data-only --table=matches --file=- "$DUMP" \
     | sed -n '/^COPY /,/^\\\.$/p' | grep -vc -e '^COPY ' -e '^\\\.$')
   echo "matches in dump: $DUMP_MATCHES, live: $(psql "$PGURL" -Atc 'select count(*) from matches')"
   echo "$DUMP" > "$BACKUP_DIR/LATEST"
   ```

   All of: "dump ok", "dump readable", the two table counts equal, the two `matches`
   counts equal (and in the hundreds). Never put the dump in the repository or upload
   it anywhere. (These commands were rehearsed against a local Postgres 16 copy.)

5. **Apply within the hour.** Run the workflow with `apply` ticked, the same
   `on_conflict` and `acknowledge` values, and `expected_digest` set to the last dry
   run's `digest:` line. It waits for your approval (the environment). It replans and
   refuses (writing nothing) if anything differs from the dry run: another commit,
   other inputs, or any change to a row it would touch. If it refuses, run the dry run
   again, take a new backup, and use the new digest. Download, decrypt and keep the
   apply run's evidence: it is the record of every change.

6. **Check and resume.**
   - Run the dry run once more (with the same `exclude:` items, if any): it must say
     `status: nothing to repair`.
   - Re-enable the writers and run a refresh:

     ```sh
     for w in refresh.yml odds-snapshots.yml market-intel.yml shadow-record.yml \
              refresh-players.yml refresh-live.yml nrl-refresh.yml nrl-live-refresh.yml; do
       gh workflow enable "$w" --repo javohir73/final-whistle
     done
     gh workflow run refresh.yml --repo javohir73/final-whistle
     ```

     The refresh grades the matches in `matches_gradeable_at_next_refresh` and
     recomputes club ratings from the corrected history. Re-enable any external cron.
   - `GET https://pitchprophet-api.onrender.com/api/health`: the stuck La Liga and
     Bundesliga fixtures are gone. The 14 orphaned Champions League play-off fixtures
     will still be reported; they are a separate problem.
   - Open one merged fixture's match page and check the result and the shown
     prediction.

## Restore from the backup

Only if the repair has to be undone wholesale. It replaces the whole database with the
dump: **everything written after the dump is lost** (picks, predictions, live scores,
grades made since). The next refresh re-ingests fixtures and results; lost user picks
cannot be recovered.

1. Pause every writer (step 1's loop), any external cron, and preferably suspend the
   API (Render dashboard → pitchprophet-api → Suspend) so nothing writes during the
   restore.
2. Restore. Everything runs in one transaction: if any statement fails, nothing changes.

   ```sh
   set -u
   PGURL="$(sed -n 's/^DATABASE_URL=//p' .env | tail -n 1 | tr -d "\"'" \
     | sed 's#^postgresql+psycopg2://#postgresql://#')"
   DUMP="$(cat ~/fw-backups/LATEST)"
   pg_restore --list "$DUMP" > /dev/null && echo "dump readable: $DUMP"
   { echo "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
     pg_restore --no-owner --no-acl --file=- "$DUMP"; } \
     | PGOPTIONS='-c client_min_messages=warning' \
       psql --single-transaction --set ON_ERROR_STOP=1 --quiet --dbname="$PGURL" > /dev/null \
     && echo "restore committed" || echo "restore failed: nothing was changed"
   ```

   `pg_restore --clean` does not work on this schema (it cannot drop the partitioned
   price-tick table's inherited constraints), hence the schema replacement. If the
   database user is not allowed to drop the `public` schema, the restore fails with
   nothing changed; then restore into a new Render database instead.
3. Confirm: the `matches` count equals the dump's (the `DUMP_MATCHES` command in step
   4), `select count(*) from teams where name in ('Real Racing Club de Santander',
   'RC Deportivo La Coruña','SV 07 Elversberg')` is 3 again, and
   `select version_num from alembic_version` is unchanged.
4. Resume: un-suspend the API, re-enable the writers (step 6's loop), run a refresh,
   check `/api/health`.

To undo only the repair's own changes and keep later writes, the evidence file is
enough: re-insert the deleted rows (merged clubs first, then restore each survivor's
pre-merge row, re-insert the merged-away fixtures, point every row in `moved_rows`
back to its `old` value, re-insert the remaining deleted rows parents first, put back
`changed_rows` old values and `covered_finished_before`). The repository's test
`test_h1_evidence_alone_is_enough_to_undo_the_repair` and the rehearsal script
`undo.py` do exactly this; ask for it to be run rather than doing it by hand.

## Not handled

- Match ids inside JSON history (`venue_market.mapping_history`,
  `resolution_context`) are not rewritten; `venue_market.canonical_event_id` is.
- Predictions already made from double-counted ratings stay as they are
  (predictions are never edited after the fact).
