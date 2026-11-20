# Runbook: provider-cutover duplicate fixture repair

**Tool:** `pipeline/repair_fixture_duplicates.py` (undo: `pipeline/repair_fixture_duplicates_undo.py`)
**Workflow:** `.github/workflows/repair-fixture-duplicates.yml` (manual dispatch only)
**Scripts:** `scripts/fixture_repair_backup.sh`, `scripts/fixture_repair_restore.sh`,
`scripts/fixture_repair_writers.sh`
**Tests:** `pipeline/repair_fixture_duplicates_test.py`, `…_cli_test.py`, `…_workflow_test.py`,
`pipeline/fixture_repair_scripts_test.py`

Written for the owner. Every step that touches production or GitHub settings is
stop-gated (`CLAUDE.md`): it happens only after an explicit "go". Commands run on the
MacBook, the only machine holding `.env`, from a clean checkout of merged `main` (step 0
below), never from the existing project folder, which is on an old branch with
uncommitted work and does not have these scripts. Anything where a typing mistake could
do damage is a script; nothing below asks you to paste a database URL or password.

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
followed **immediately** by undo gave back every row with identical content (compared
with Postgres' own `md5(row::text)`; only the internal row versions differ, as they
must). The undo is only for that situation; see "Undo only the repair".

**What `trial: applying…` in an evidence file means.** Apply writes the full evidence
to disk before its first change, with `trial` set to `applying: written before the
first write`, and rewrites it with `trial: applied` after the commit. If you see
`applying` (for example after the runner died), the evidence is still complete; it
just cannot tell whether the commit happened. Run a dry run: `nothing to repair` means
it did; otherwise nothing was written. The undo never trusts that field: it checks the
database itself.

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
| kept grade records X but the match is Y / graded prediction would have to be dropped / grade points outside the pair | a published grade cannot survive the merge as it is | **Recommended: `regrade:<id>`**: it deletes that match's grades (listed in full in the evidence) and the next refresh grades the frozen prediction against the real result. Exclude both only if you are not sure the two copies are the same match |
| conflicts (`CONFLICTS: match_picks: N …`) | the same user has something on both copies | a policy, below |
| session timezone is not UTC | history keys would not match the refresh | stop and ask |
| alias table / not exactly one club to one club | a code problem, not a data one | stop; it needs a code fix |

`exclude` leaves the fixture exactly as it is: its row, its picks and predictions, its
grades, its history rows, and the duplicate club it belongs to (the club is kept so the
excluded fixtures still have their clubs). After an apply with exclusions you are left
with those fixtures still as two rows each, and the duplicate club still present. A
later dry run **with the same `exclude:` items** says `status: nothing to repair`;
**without them** it offers to merge exactly those fixtures (`status: ready`, or the
same blocking line as before if the reason has not gone away). To finish them later:
check each one by hand, fix the cause or decide it is the same match (and give the
acknowledgement the blocking line asks for), then dry-run without the `exclude:` items
and apply as usual. An acknowledgement that matches nothing is listed under `WARNING:`
(for pair decisions, use the id of the kept, older copy that the blocking line names).

**Conflict policy** (`on_conflict`). Use this, exactly, unless the dry run tells you
otherwise:

```
match_picks=keep-donor league_score_predictions=keep-donor match_lineups=keep-survivor prediction_results=keep-survivor
```

Every rehearsal ran with it, and on production-shaped data it gives `status: ready`
without further decisions. What each part means for users:

- `match_picks=keep-donor`: when someone picked both copies of a match, the pick they
  made on the copy they have been looking at since 2 Sep stays; the older one goes.
- `league_score_predictions=keep-donor`: the same for score predictions in the league
  game, so their game score follows what they saw.
- `match_lineups=keep-survivor`: the lineup recorded by API-Football stays (football-data
  provides no lineups, so the old copy's is the real one).
- `prediction_results=keep-survivor`: where both copies were graded, the grade made on
  the old copy stays, because it is the one made from a prediction written before
  kickoff. With `keep-donor` instead, the rehearsal produced four `BLOCKING: graded
  prediction … would have to be dropped` lines: the new copies' grades used predictions
  that sit after the merged kickoff.

Deviate only when a `BLOCKING:` line about a grade remains with this policy: answer it
with `regrade:<id>` (table above), not by changing the policy.

## Step 0: a clean checkout on the MacBook

Create a second folder beside the existing one. The existing folder
`~/Projects/Final Whistle` is not changed: no checkout, no reset, its uncommitted work
stays as it is. The writers have to be paused before the PR is merged (step 1), and the
scripts only exist on the PR's branch until then, so the folder starts at the PR's
branch and moves to merged `main` right after the merge:

```sh
git -C "$HOME/Projects/Final Whistle" fetch origin
git -C "$HOME/Projects/Final Whistle" worktree add --detach "$HOME/Projects/fw-repair-main" origin/fix/fixture-duplicate-repair-v2
cd "$HOME/Projects/fw-repair-main"
```

Right after the merge (step 2), switch it to merged `main` (nothing else in it changes):

```sh
git -C "$HOME/Projects/Final Whistle" fetch origin
git -C "$HOME/Projects/fw-repair-main" checkout --detach origin/main
```

Every command below runs from `~/Projects/fw-repair-main`. The secrets stay where they
are: the scripts and the undo read them from the original folder with
`--env-file "$HOME/Projects/Final Whistle/.env"` (keep the quotes: the folder name has
a space).

The undo (and only the undo) also needs the project's Python 3.12 environment in this
folder. Create it once:

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
```

At the very end ("Cleanup"), remove this folder again with
`git -C "$HOME/Projects/Final Whistle" worktree remove "$HOME/Projects/fw-repair-main"`.

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
   gh run download "$RUN_ID" --repo javohir73/final-whistle --dir "$HOME/fw-backups/evidence-$RUN_ID"
   openssl smime -decrypt -binary -inform DER \
     -inkey ~/fw-backups/repair-key/repair-evidence.key \
     -in "$HOME/fw-backups/evidence-$RUN_ID"/*/repair-evidence.json.p7m \
     -out "$HOME/fw-backups/repair-evidence-$RUN_ID.json"
   ```

   This keeps the decrypted file in `~/fw-backups` with the key, out of every repository.

3. **Pre-flight checks.**
   - Production's identity, size, timezone, server version, counts, and the roles other
     than the owner that hold privileges (prints, changes nothing; fails if the server's
     timezone is not UTC, because the repair computes history keys in UTC and the
     refresh's sync uses the session timezone):

     ```sh
     scripts/fixture_repair_backup.sh --info --env-file "$HOME/Projects/Final Whistle/.env"
     ```

     It needs the local `pg_dump`, `pg_restore` and `psql` to be exactly the server's
     major version, and says which `brew install postgresql@<n>` and `PATH` line to use
     if not. Note the size it prints: a restore needs about twice that free on the
     database's disk (the old and the new copy exist until the restore commits). Check
     used and available storage on the database's page in the Render dashboard
     (`pitchprophet-db`); if less than twice the size is free, stop and ask before
     applying. Note the "other roles holding privileges" line too: the restore
     re-applies those grants, and the backup records them.

   - A scratch database for proving the backup restores (the backup refuses to call
     itself verified without one). On the MacBook, with the same major version as the
     server (16 here; use the number `--info` printed):

     ```sh
     brew install postgresql@16
     "$(brew --prefix postgresql@16)/bin/initdb" -D ~/fw-scratch-pg -U scratch --auth=trust
     "$(brew --prefix postgresql@16)/bin/pg_ctl" -D ~/fw-scratch-pg -o "-p 55499 -k /tmp" -l ~/fw-scratch-pg/log start
     "$(brew --prefix postgresql@16)/bin/createdb" -h 127.0.0.1 -p 55499 -U scratch fw_restore_check
     ```

     Its address is then `postgresql://scratch@127.0.0.1:55499/fw_restore_check` (no
     password). Any other Postgres of the same version works if its database name starts
     with `fw_restore_check`; if its URL needs a password, put `DATABASE_URL=<url>` in a
     file and use `--verify-into-env <file>` instead, so the password stays off the
     command line. Stop it afterwards with
     `"$(brew --prefix postgresql@16)/bin/pg_ctl" -D ~/fw-scratch-pg stop`.

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
   scripts/fixture_repair_writers.sh pause     # records the states, disables the active writers, verifies
   ```

   `keep-warm` and `smoke` only read and stay on. If an external cron service (for
   example cron-job.org) calls `/api/internal/refresh-live`, pause it too.

   **The API itself keeps writing** (users' picks, live scores) even with every workflow
   paused. A single new pick on a merged fixture after the apply makes the undo refuse,
   which leaves the restore as the only way back, and the restore loses everything
   written since the backup. Default: **suspend the API from just before the backup
   (step 4) until the checks after apply (step 6)**, Render dashboard → `pitchprophet-api`
   → Settings → "Suspend Web Service". That is a few minutes of downtime in exchange for
   a usable undo. While it is suspended the website and the apps load but show no
   fixtures, predictions or scores and cannot save picks (their requests to the API fail).

   Why pause before merging: the first refresh after the merge uses the new aliases,
   re-points the new copies at the original clubs and re-inserts about 35 finished
   fixtures into the results history under the original club (measured 1 → 2 rows per
   match on that first refresh, then stable at 2). Every refresh until the repair would
   then compute club ratings with those matches counted twice, and predictions frozen
   from those ratings can never be corrected. The repair still gets the right answer if
   it happens (tested), but avoid it. The repair shares a lock (`production-database`)
   with `refresh.yml` only; that is why the others are paused.

2. **Merge the PR** (go required). It contains no database migration. Then move the
   step-0 folder to merged `main` (the two commands in step 0).

3. **Dry run.** Actions → repair-fixture-duplicates → Run workflow, `apply` unticked,
   everything else empty. The dry run never commits. It plans, then runs the plan once
   inside a savepoint and rolls it back to prove it works. On the production-shaped
   rehearsal copy that is 172 database statements for a dry run and 170 for apply, of
   which 86 (dry run) and 85 (apply) run after the first write, i.e. while row locks are
   held (about 5 s at 50 ms per statement). Measured on this code by
   `fw-pg-rehearsal/scripts/r8/count.sh`, which logs every statement the CLI sends. The tool waits at most 5 s for any lock and 60 s for any one
   statement, and Postgres ends its transaction after 30 s idle (for example if the
   runner dies). A connection that wants a row the repair has locked waits until the
   repair finishes (measured worst case 3.7 s at 50 ms per statement). If such a
   connection changes a row first, the repair stops and writes nothing. Untick `trial`
   to plan only.

   Use the conflict policy above in the `on_conflict` box from the first run. The job is
   red ("not ready") until every blocking item is answered. The log shows the plain summary, then `BLOCKING:`, `WARNING:` and
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

4. **Suspend the API, then back up, immediately before applying** (after the last dry
   run, nothing in between), with the scratch database running. Suspend first (Render →
   `pitchprophet-api` → Settings → "Suspend Web Service"; see step 1 for why). Assume
   Render's free Postgres has no point-in-time recovery: this file is the only way back.

   ```sh
   scripts/fixture_repair_backup.sh --pre-apply \
     --env-file "$HOME/Projects/Final Whistle/.env" \
     --verify-into postgresql://scratch@127.0.0.1:55499/fw_restore_check
   ```

   It ends with `backup ok` and one line `DUMP=…`: **copy that line somewhere safe**
   (your notes); it names the pre-apply backup, the one to restore if the repair has to
   be reversed. The same path is written to `~/fw-backups/PRE-APPLY`. Never use a backup
   taken after the apply for that.

   It ignores every `PG…` variable in your shell, `~/.pgpass` and `~/.pg_service.conf`;
   reads the URL from `.env` without showing it; refuses a URL it cannot parse cleanly,
   any scheme but `postgresql`/`postgresql+psycopg2`, and any query parameter but
   `sslmode`; insists on Render's external host; checks on the server that it reached
   the database and user named in `.env`; requires the local tools to be exactly the
   server's major version; dumps to `~/fw-backups/finalwhistle-<db>-<UTC time>.dump`;
   converts the whole dump to SQL and compares its tables and `matches` rows with the
   live database; and then **loads that SQL into the scratch database** and counts again.
   It writes a sidecar `….dump.meta.json` (identity, versions, timezone, size, counts,
   other roles' grants, sha256, `restore_rehearsed`), which the restore script requires.
   Only `backup ok` (exit 0) is a usable backup. Without a scratch database it exits 3
   with `BACKUP WRITTEN BUT NOT VERIFIED`, records `"restore_rehearsed": false` and does
   not update `LATEST` or `PRE-APPLY`; do not apply on such a backup (the restore script
   refuses it too). Never put the dump in the repository or upload it anywhere.

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
   - Decide now whether the repair stays. If it must be undone, do it now, before
     anything below (see "Undo only the repair"). Otherwise resume the API: Render →
     `pitchprophet-api` → Settings → "Resume Web Service", and check
     `/api/health` returns 200.
   - Resume the writers and run a refresh:

     ```sh
     scripts/fixture_repair_writers.sh resume    # back to exactly the states recorded at pause
     scripts/fixture_repair_writers.sh refresh
     ```

     The refresh grades the matches in `matches_gradeable_at_next_refresh` and
     recomputes club ratings from the corrected history. Re-enable any external cron.
   - `GET https://pitchprophet-api.onrender.com/api/health`: the stuck La Liga and
     Bundesliga fixtures are gone. The 14 orphaned Champions League play-off fixtures
     will still be reported; they are a separate problem.
   - Open one merged fixture's match page and check the result and the shown
     prediction.

## Undo only the repair (same window only)

Only while the window is still open: writers still paused, the API still suspended,
nothing has run against the database since the apply (no refresh, no resume). **If the
API was not suspended, any user pick on a merged fixture since the apply makes the undo
refuse, and only the restore (which loses everything since the backup) remains.**
Run it from `~/Projects/fw-repair-main` with its `.venv` (step 0), from the decrypted
apply evidence:

```sh
PYTHONPATH=backend:. .venv/bin/python -m pipeline.repair_fixture_duplicates_undo \
  --env-file "$HOME/Projects/Final Whistle/.env" \
  --evidence-file "$HOME/fw-backups/repair-evidence-$RUN_ID.json"
```

That only checks and reports. It refuses (exit 2, nothing written) unless every row the
repair touched is as the repair left it and nothing new was created on an affected
fixture or club. Precisely: every row it would re-create is absent; every fixture,
pick, prediction and history row the repair changed still has exactly the content the
repair gave it; the learning-chain counter is unchanged; and no row was created after
the repair on a merged fixture or an original club (a new pick, prediction, grade or
history row). It does not detect an existing, unrelated row that was later edited to
point at a merged fixture or an original club; nothing in the paused window does that.
Each difference is listed as table and id (never values). There is no override. If it
says the database is consistent, it prints the database name; run it again with that
name:

```sh
DB_NAME=the_name_it_printed   # replace with the name the first command printed
PYTHONPATH=backend:. .venv/bin/python -m pipeline.repair_fixture_duplicates_undo \
  --env-file "$HOME/Projects/Final Whistle/.env" \
  --evidence-file "$HOME/fw-backups/repair-evidence-$RUN_ID.json" --confirm-database "$DB_NAME"
```

It runs in one transaction with the repair's timeouts, a few statements per table, and
checks each statement touched exactly the planned number of rows; any difference rolls
everything back. It ends with `undo committed; every statement touched exactly the
planned rows`.

**After the writers have resumed or any refresh has run, the undo will refuse.** Then
the choices are: restore the backup (below; loses everything written since the dump,
including users' picks), or fix forward (a follow-up change, asked for separately).

### After a successful undo or restore: what next

The merged code (with the new aliases) is still live on `main`. Resuming the writers now
would run exactly the first-refresh behaviour step 1 warns about. Default:

1. Keep the writers paused (and the API suspended until step 3 is done, or resume it now
   if you prefer; the API does not run the refresh).
2. Confirm the duplicates are back in their pre-repair shape: run the dry run (workflow,
   `apply` unticked, same inputs as before). It must show the same summary as before the
   apply (the same three clubs, about 74 La Liga and 34 Bundesliga fixtures).
3. Revert the merge of this PR on `main`. That is a normal change through a pull request
   and needs your "go" to merge, like any merge to `main`:

   ```sh
   cd "$HOME/Projects/fw-repair-main"
   MERGE_SHA=the_merge_commit   # the PR's merge commit on main, from its GitHub page
   git fetch origin && git switch -c revert-fixture-repair origin/main
   git revert -m 1 "$MERGE_SHA"
   git push -u origin revert-fixture-repair
   gh pr create --fill --base main
   ```

4. After the revert is merged and deployed: resume the API (if still suspended), then
   `scripts/fixture_repair_writers.sh resume` and `scripts/fixture_repair_writers.sh refresh`.
   The duplicates stay as they were before this PR until a fixed version is ready.

## Restore from the backup (replaces the whole database)

Only if the repair has to be undone wholesale and the undo above cannot be used.
**Everything written after the backup is lost** (picks, predictions, live scores,
grades made since). The next refresh re-ingests fixtures and results; lost user picks
cannot be recovered. Free disk: about twice the database size (`--info` prints it).

1. Stop everything that writes:
   - `scripts/fixture_repair_writers.sh pause`, and any external cron;
   - **suspend the API (required)**: Render dashboard → `pitchprophet-api` → Settings →
     "Suspend Web Service" (near the bottom of the page). Confirm with
     `curl -s -o /dev/null -w '%{http_code}\n' https://pitchprophet-api.onrender.com/api/health`
     no longer returning 200. The restore takes exclusive locks on every table; it waits
     at most 5 seconds for them and otherwise stops with nothing changed and the message
     "suspend the API and retry".
2. Restore:

   Use the pre-apply backup: the `DUMP=…` line you copied in step 4 (or the path in
   `~/fw-backups/PRE-APPLY`), never `LATEST` and never a backup taken after the apply.

   ```sh
   DUMP=/path/from/the/DUMP/line.dump   # paste the line the pre-apply backup printed
   scripts/fixture_repair_restore.sh "$DUMP" --env-file "$HOME/Projects/Final Whistle/.env"
   ```

   It changes nothing unless: the dump matches its sidecar's sha256 and the sidecar
   says the restore was rehearsed; the local `pg_restore` and `psql` are the dump's
   server version and convert the whole dump with every table and every `matches` row;
   the target in `.env` is the recorded host, port, database and user (checked on the
   server too; every `PG…` variable in your shell is ignored); every role that held
   grants still exists; and you type the database name. Then, in one transaction, it
   replaces the `public` schema, loads the dump, puts back the schema's owner and the
   grants other roles held, and afterwards compares the table count, `matches` count,
   schema revision and schema owner with the sidecar. Only `restore committed and
   verified` means success. If it fails, it prints the last lines of the database's
   error (with any connection details removed) and nothing has changed.
   (`pg_restore --clean` is not used: it fails on the partitioned price-tick table's
   inherited constraints.)
3. Then follow "After a successful undo or restore: what next" above: keep the writers
   paused, confirm with a dry run, revert the merge, and only then resume the API (same
   Settings page, "Resume Web Service") and the writers
   (`scripts/fixture_repair_writers.sh resume` restores exactly the states recorded at
   pause; if it says the record is missing or damaged, `resume --all-active`), run a
   refresh and check `/api/health`.

The backup and restore scripts were rehearsed on two local Postgres 16 clusters, one
with password (SCRAM) authentication and a non-superuser owner like Render: a full
round trip came back identical in content and in catalogs (schema owner and grants;
a read-only role could still read `matches`), and an unreadable dump, a truncated dump,
a forged sidecar, an unrehearsed backup, the wrong host, the wrong database, a wrong
confirmation, a live connection holding a lock, decoy `PG…` variables and malformed
URLs each refused and left the target untouched.

## Cleanup after the window

The scratch database now holds a full plaintext copy of production, users' picks
included, and the dump and the decrypted evidence files are plaintext too.

- Stop the scratch server and delete its data:

  ```sh
  "$(brew --prefix postgresql@16)/bin/pg_ctl" -D ~/fw-scratch-pg stop
  rm -rf ~/fw-scratch-pg
  ```

- Keep the pre-apply dump, its `.meta.json` sidecar and the decrypted evidence in
  `~/fw-backups` on the MacBook only (never in the repository, never on the Mac mini,
  never uploaded) for 30 days after the apply, then delete them
  (`rm -r ~/fw-backups/finalwhistle-*.dump ~/fw-backups/finalwhistle-*.meta.json
  ~/fw-backups/repair-evidence-*.json ~/fw-backups/evidence-*`). Keep the key in `~/fw-backups/repair-key` until then
  too; the encrypted artifacts on GitHub expire after 90 days.
- Remove the clean checkout:
  `git -C "$HOME/Projects/Final Whistle" worktree remove "$HOME/Projects/fw-repair-main"`.

## Not handled

- Match ids inside JSON history (`venue_market.mapping_history`,
  `resolution_context`) are not rewritten; `venue_market.canonical_event_id` is.
- Predictions already made from double-counted ratings stay as they are
  (predictions are never edited after the fact).
