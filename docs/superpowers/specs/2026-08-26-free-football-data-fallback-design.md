# Free Football Data Fallback — Design Specification

## Context

FinalWhistle's production league pipeline currently depends on API-Football
for 2026-27 fixtures and results. The configured subscription has reverted to
the Free plan, which cannot access the current season, so production stopped
advancing on 2026-08-18. Purchasing a new subscription is deferred.

The repository already contains a football-data.org v4 adapter for the live
score path. football-data.org's free tier covers the Premier League, La Liga,
Bundesliga, and UEFA Champions League, including fixtures and delayed results.
It does not provide the odds, injuries, lineups, or official live-minute depth
that FinalWhistle obtained from API-Football.

This specification covers the first recovery subproject only: restore a
trustworthy fixture-and-result spine from a documented free API. Shadow-model
reporting, prediction-horizon regeneration, model-record provenance, and the
remaining observability recommendations are separate follow-on subprojects.

## Goals

1. Ingest current-season fixtures and delayed results for EPL (`PL`), La Liga
   (`PD`), Bundesliga (`BL1`), and Champions League (`CL`) from
   football-data.org.
2. Preserve the existing API-Football integration for later reactivation.
3. Keep source identity and fetch freshness visible in storage and health
   output.
4. Prevent absent enrichment data from being mistaken for valid empty data.
5. Preserve immutable pre-kickoff prediction receipts and append-only grading.
6. Isolate competition failures so one bad response does not block the other
   competitions.
7. Keep the free-tier request volume below football-data.org's documented
   limit of 10 requests per minute.

## Non-goals

- Scraping HTML pages or undocumented endpoints.
- Fabricating odds, injuries, lineups, cards, scorers, or live minutes.
- Replacing the market-odds feed.
- Activating vNext or changing model parameters.
- Replaying production data, changing production environment variables,
  merging, or deploying without the repository stop gate.
- Solving every recommendation from the 2026-08-26 inspection in one change.

## Source decision

Use football-data.org as the sole temporary fixture/result source for all four
competitions.

Rejected alternatives:

- OpenLigaDB is useful for Bundesliga, but mixing it with a second source would
  create inconsistent identifiers and freshness semantics, and its results are
  community-maintained.
- Website scraping is brittle, difficult to test, and creates avoidable terms
  and redistribution risk.
- Unofficial JSON endpoints provide no stable contract or provenance guarantee.

## Architecture

### 1. Provider-neutral fixture contract

Create a small normalized fixture value object owned by the ingestion layer.
It contains:

- source provider (`football_data` or `api_football`)
- provider fixture ID
- home and away team names
- kickoff UTC
- normalized status
- home and away score, when known
- matchweek, when known
- upstream `lastUpdated`, when supplied

Both provider adapters convert their native payloads into this contract before
league-structure persistence. `league_structure` no longer parses an
API-Football-shaped dictionary directly. Existing team-name normalization and
roster-audit behavior remains unchanged.

### 2. Competition registry

Each entry in `pipeline.leagues.LEAGUES` gains a football-data.org competition
code. Champions League uses the same registry/runner contract but retains its
existing UCL model parameters and tournament identity.

The fixture source is selected independently from `LIVE_PROVIDER`.
`LIVE_PROVIDER` continues to describe the web application's in-play endpoint;
the scheduled league pipeline uses a new fixture-source setting whose safe
default remains `api_football`. This avoids silently changing existing local
or production behavior merely by merging code.

### 3. Persistence and provenance

Each `Match` stores the fixture source and the upstream last-updated timestamp.
The existing provider fixture ID remains scoped by tournament, so IDs from two
providers cannot collide across competitions.

Switching a competition from one provider to another matches an existing row
by normalized home team, normalized away team, and kickoff proximity before
creating a new row. A matched row adopts the new provider ID and source. This
prevents duplicate fixtures when API-Football is reactivated later.

Provider refreshes may update schedule, status, and score fields. They must not
update or delete existing `Prediction` snapshots. Finished-match mirroring into
`HistoricalMatch` stays idempotent on date and team IDs, and learning-loop
grading remains append-only under its existing uniqueness rules.

The provenance columns require an Alembic migration. The migration and
dependent application code must follow the repository's production migration
sequence and remain unshipped until separately approved.

### 4. Failure and data-quality policy

The fetcher validates that a successful response contains the requested
competition and a non-empty current-season fixture list. HTTP 200 with an API
error, an unexpected competition, or an implausibly empty in-season response is
a failed competition refresh—not a valid empty season.

Each competition refresh runs in its own transaction boundary. On failure, its
partial writes roll back and the remaining competitions continue. The overall
run reports partial failure and exits non-zero after all competitions have been
attempted, so CI cannot present a degraded refresh as green.

Football-data.org free results are delayed. The platform reports them as
`delayed_results`; it never presents them as live scores. Existing database
data remains available during an outage, with its last successful fetch time
visible.

### 5. Optional enrichment behavior

Fixture/result success is independent of odds, injuries, lineups, cards,
scorers, and official live minutes. With football-data.org fallback active:

- missing optional data is recorded as `unavailable_for_provider`
- empty provider responses remain distinguishable from unsupported features
- prediction features use their existing no-signal paths
- public explanations do not claim enrichment was checked when it was not

No synthetic or scraped enrichment values enter model features or evaluation.

### 6. Health and operations

Extend health output with one row per configured competition:

- competition code and tournament name
- fixture provider
- provider mode (`delayed_results` or `live`)
- last attempted and last successful fetch timestamps
- fixture count
- stale scheduled/finished mismatch count
- latest upstream update timestamp
- optional-data capability flags
- status and sanitized failure reason

Overall `data_status` is degraded if any active competition is stale, failed,
or has no current-season fixtures. Smoke verification must parse this status
rather than checking HTTP 200 alone.

### 7. Scheduling and quota

One league pipeline pass performs one competition-match request per active
competition. Requests execute sequentially with enough spacing to remain below
10 calls per minute, including retries. Retry only transient timeouts, HTTP
429, and 5xx responses, using bounded backoff and honoring `Retry-After`.
Authentication, entitlement, malformed-payload, and validation errors do not
retry blindly.

The existing daily refresh remains the first scheduled entry point. Increasing
cadence is a later production decision based on observed delay and runtime; it
is not included in this implementation.

## Data flow

1. The league runner resolves an active competition and fixture source.
2. The football-data.org adapter fetches that competition's current matches.
3. The adapter validates and normalizes the payload.
4. `league_structure` reconciles teams and fixtures, then commits that
   competition atomically.
5. Finished matches mirror idempotently into club history.
6. Elo replay, prediction generation, and grading run through their existing
   paths.
7. The run records per-competition attempt/success/failure telemetry.
8. Health and smoke verification expose and enforce the resulting freshness.

## Testing strategy

Implementation follows test-driven development.

- Pure adapter tests cover football-data.org status, score, matchweek,
  timestamp, and malformed-payload normalization.
- Contract tests feed equivalent API-Football and football-data.org fixtures
  through the provider-neutral persistence layer.
- Reconciliation tests prove a provider switch updates one match instead of
  creating a duplicate.
- Receipt tests prove fixture/result refresh does not mutate frozen prediction
  snapshots.
- Transaction tests prove one competition rolls back while others complete and
  the command still reports failure.
- Capability tests distinguish unsupported enrichment from checked-but-empty.
- Health tests cover healthy, stale, unsupported, and partial-failure states.
- Workflow tests execute the smoke validator against representative health
  JSON rather than asserting workflow source text.
- Network access is blocked by default in the test suite so missing mocks fail
  immediately instead of reaching a real provider.
- The final gate is the repository's real `make test` command.

## Rollout sequence

1. Implement and verify on an isolated branch based on current `origin/main`.
2. Open a PR and require green CI.
3. Stop with the migration/application/configuration diff and wait for `go`.
4. Merge the migration without enabling the fallback.
5. Dispatch the production migration workflow and verify it succeeds.
6. Merge/deploy the dependent code.
7. Configure the football-data.org token and fixture source.
8. Dispatch one production refresh and verify all competition health rows,
   stale-match repair, prediction coverage, and append-only grading.

Steps 3-8 face production or external systems and remain behind explicit
approval. This specification authorizes local implementation only.

## Success criteria

- Local tests demonstrate all four competition codes normalize and persist.
- A provider switch cannot duplicate a fixture or mutate prediction receipts.
- One failed competition cannot erase or block successful competition updates.
- Health identifies provider, freshness, capability gaps, and partial failure
  per competition.
- Smoke verification fails on degraded data even when `/api/health` returns
  HTTP 200.
- No test performs an unmocked external network request.
- API-Football remains available as a selectable provider.
