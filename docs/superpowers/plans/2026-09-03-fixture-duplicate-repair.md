# Fixture Duplicate Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Safely consolidate the football-data.org duplicate domestic fixtures and teams created during the 2026-09-02 provider cutover while preserving the original match IDs and every dependent record.

**Architecture:** A standalone repair module discovers only cross-provider duplicates with the same tournament, kickoff, orientation, and newly canonicalized team names. It reparents dependent rows to the original non-football-data match/team, copies authoritative fixture state, and deletes the duplicate inside one transaction; dry-run is the default and executes through a savepoint before rolling back. A dedicated manual GitHub workflow exposes separate dry-run and apply modes so production impact is observable before mutation.

**Tech Stack:** Python 3.12, SQLAlchemy 2, pytest, GitHub Actions YAML.

**Spec:** Production evidence from refresh run `33581656266`: La Liga created 74 and Bundesliga 34 extra matches after the football-data.org cutover; public responses showed paired canonical/provider rows at identical kickoffs.

## Global Constraints

- Preserve the existing API-Football match ID as the survivor.
- Restrict candidates to literal aliases introduced by commit `0e98b9c`.
- Never fuzzy-match teams or fixtures.
- Reparent dependent records; abort and roll back on ambiguity or an unresolvable uniqueness conflict.
- Dry-run is the default and leaves the database byte-for-byte unchanged.
- Applying the repair requires an explicit `--apply` and a manual workflow input.
- Do not alter ML parameters, served/shadow model selection, or prediction contents.

---

### Task 1: Transactional duplicate-match repair

**Files:**
- Create: `pipeline/repair_fixture_duplicates.py`
- Create: `pipeline/repair_fixture_duplicates_test.py`

**Interfaces:**
- Consumes: SQLAlchemy `Session`, model metadata, and `normalize_team_name(str) -> str`.
- Produces: `repair_fixture_duplicates(db: Session, *, apply: bool = False) -> RepairReport` and CLI `python -m pipeline.repair_fixture_duplicates [--apply]`.

- [ ] **Step 1: Write failing tests for discovery and dry-run**

Create fixtures containing one legacy API-Football match and one football-data match at the same kickoff, with `Málaga CF`/`RC Deportivo La Coruña` labels. Assert the report selects the legacy ID, counts one duplicate, and that dry-run leaves both matches, teams, predictions, and user score picks unchanged.

- [ ] **Step 2: Run the dry-run tests and verify RED**

Run: `.venv/bin/python -m pytest pipeline/repair_fixture_duplicates_test.py -q`

Expected: import failure because `pipeline.repair_fixture_duplicates` does not exist.

- [ ] **Step 3: Implement exact candidate discovery and savepoint rollback**

Add a frozen `RepairReport` dataclass containing `dry_run`, `matches_merged`, `teams_merged`, `survivor_match_ids`, and `removed_match_ids`. Group matches by `(tournament_id, kickoff_utc, normalized_home, normalized_away)`, accept exactly one football-data donor plus exactly one non-football-data survivor, and limit team donors to the four literal alias spellings. Execute dry-run mutations in a nested transaction and always roll it back.

- [ ] **Step 4: Write failing tests for dependency preservation and ambiguity**

Attach served and shadow `Prediction` rows plus `LeagueScorePrediction` and `MatchPick` rows to the donor. Assert apply reparents them to the survivor, copies final score/provider identity, deletes the donor, and leaves prediction payload fields unchanged. Add ambiguous three-match and conflicting unique-user-row cases that must raise and roll back the entire repair.

- [ ] **Step 5: Implement fail-closed dependency reparenting**

Use SQLAlchemy metadata to enumerate foreign keys targeting `matches.id` and `teams.id`. For each dependent row, replace the donor ID with the survivor ID. Where the replacement would collide with an existing unique generated/junction row, keep the survivor row and delete only the duplicate generated row; for user-authored or unknown conflicts, raise `DuplicateRepairError`. Flush before deleting the donor and allow any database constraint failure to abort the outer transaction.

- [ ] **Step 6: Verify the repair module GREEN**

Run: `.venv/bin/python -m pytest pipeline/repair_fixture_duplicates_test.py pipeline/team_mapping_test.py pipeline/ingest/league_structure_test.py -q`

Expected: all pass.

- [ ] **Step 7: Commit the repair module**

Run: `git add pipeline/repair_fixture_duplicates.py pipeline/repair_fixture_duplicates_test.py && git commit -m "fix: repair provider cutover duplicates"`

### Task 2: Manual production workflow

**Files:**
- Create: `.github/workflows/repair-fixture-duplicates.yml`
- Create: `pipeline/repair_fixture_duplicates_workflow_test.py`

**Interfaces:**
- Consumes: `DATABASE_URL` secret and the repair CLI.
- Produces: manual workflow input `apply` (boolean, default `false`); dry-run uploads no data and apply requires the explicit true value.

- [ ] **Step 1: Write a failing workflow contract test**

Parse the YAML and assert `workflow_dispatch.inputs.apply.default` is `false`, the job has no schedule/push trigger, the command omits `--apply` when false, includes it only when true, and uses the existing `DATABASE_URL` secret.

- [ ] **Step 2: Run the workflow test and verify RED**

Run: `.venv/bin/python -m pytest pipeline/repair_fixture_duplicates_workflow_test.py -q`

Expected: failure because the workflow file does not exist.

- [ ] **Step 3: Add the manual workflow**

Create a single-job workflow using checkout and setup-python, install the same backend requirements as `refresh.yml`, run the repair in dry-run mode by default, and gate the `--apply` command with `${{ inputs.apply }}`. Do not run the full pipeline in this workflow.

- [ ] **Step 4: Verify workflow GREEN and parse YAML**

Run: `.venv/bin/python -m pytest pipeline/repair_fixture_duplicates_workflow_test.py -q`

Expected: pass.

- [ ] **Step 5: Commit the workflow**

Run: `git add .github/workflows/repair-fixture-duplicates.yml pipeline/repair_fixture_duplicates_workflow_test.py && git commit -m "ci: add guarded fixture repair workflow"`

### Task 3: Full verification, review, and guarded rollout

**Files:**
- Modify only if review finds a defect in the files above.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: reviewed PR, successful production dry-run, explicit apply run, normal refresh, and verified `/api/health`.

- [ ] **Step 1: Run repository gates**

Run: `make test`

Run: `cd frontend && npm run typecheck && npm run lint && npm test`

Expected: Python and frontend suites pass; only documented pre-existing warnings remain.

- [ ] **Step 2: Obtain a fresh independent review**

Have a fresh reviewer inspect exact matching, transaction rollback, dependent-row preservation, workflow safety, and shadow/served prediction non-mutation. Resolve every blocker and rerun affected tests.

- [ ] **Step 3: Push and open the PR**

Push `codex/provider-name-reconciliation-hotfix`, open a private PR, and babysit CI and review threads until green.

- [ ] **Step 4: Stop before merge**

Present the actual diff, tests, CI, repair safety rules, and expected dry-run behavior. Wait for explicit `go` before merging because main auto-deploys.

- [ ] **Step 5: Run production dry-run**

After deploy, dispatch `repair-fixture-duplicates.yml` with `apply=false`. Record the exact match/team counts and IDs; if they differ from the proven pattern or report ambiguity/conflicts, do not apply.

- [ ] **Step 6: Stop before production apply**

Present the dry-run output and wait for explicit `go`, because apply deletes duplicate rows and is irreversible.

- [ ] **Step 7: Apply, refresh, and verify**

Dispatch with `apply=true`, then run `refresh.yml`. Verify workflow success, `/api/health`, zero domestic stale scheduled fixtures, no duplicated public match pairs, zero missing predictions, and intact shadow progress.
