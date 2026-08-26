# Free Football Data Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Restore fixtures and delayed results for EPL, La Liga, Bundesliga, and Champions League through football-data.org while preserving API-Football, immutable prediction receipts, source provenance, and fail-loud monitoring.

**Architecture:** Both providers normalize into one immutable NormalizedFixture contract before persistence. The league runner selects the scheduled fixture source independently of the live/enrichment provider, records every competition attempt in FixtureFeedStatus, commits each competition atomically, completes successful competitions, and exits non-zero after a partial failure. Match.provider_last_updated remains the upstream freshness stamp; one new deferred fixture_provider column records provenance.

**Tech Stack:** Python 3.12, requests, SQLAlchemy 2, Alembic, FastAPI, pytest, GitHub Actions.

**Spec:** docs/superpowers/specs/2026-08-26-free-football-data-fallback-design.md

## Global Constraints

- Build in an isolated worktree from current origin/main, never in the dirty current checkout.
- Cherry-pick approved spec commit aadeee7 into the isolated branch before implementation.
- Preserve pitchprophet production resource names.
- Keep api_football as the default. Merging code must not activate the fallback.
- Never scrape HTML, use undocumented endpoints, or fabricate enrichment.
- Missing odds, injuries, lineups, events, and live minute must be reported unsupported, not checked-and-empty.
- Fixture refresh must not mutate or delete Prediction rows.
- At most one retry per competition: no more than eight football-data.org calls per run.
- Production migration, configuration, refresh, merge, and deploy remain stop-gated.
- Final verification is make test.

## File Map

- New pipeline/ingest/fixture_contract.py: normalized fixture and capabilities.
- New pipeline/ingest/football_data.py: fetch, retry, validation, normalization.
- New pipeline/ingest/fixture_feed_status.py: durable status transitions.
- New backend/alembic/versions/a9b4c7d2e601_fixture_feed_provenance.py: schema.
- New scripts/validate_health.py: smoke validator.
- Modify provider adapter, league persistence/registry/runner, models, health, workflows, examples, reliability docs, and adjacent tests.

---

### Task 1: Make provider tests hermetic

**Files:**
- Modify: conftest.py
- Modify: backend/tests/conftest.py
- Test: backend/tests/test_lineups_api.py
- Test: pipeline/compute_club_elo_test.py

**Interfaces:**
- Consumes: app.config.settings and requests.sessions.Session.request.
- Produces: cleared provider credentials and a hard failure for unmocked requests traffic.

- [ ] **Step 1: Reproduce the leak**

Run:

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  backend/tests/test_lineups_api.py::test_stored_lineups_are_returned_without_external_call \
  pipeline/compute_club_elo_test.py::test_persists_fitted_home_advantage_onto_the_tournament_row -vv
~~~

Expected: an external API-Football attempt or developer-.env dependency.

- [ ] **Step 2: Write the failing guard test**

Add:

~~~python
def test_network_guard_contract(_block_external_requests):
    with pytest.raises(AssertionError, match="unmocked external HTTP"):
        requests.get("https://example.invalid/provider-test")
~~~

Run the single test. Expected: fixture-not-found error.

- [ ] **Step 3: Implement the guard**

Add to root conftest.py:

~~~python
import requests


@pytest.fixture(autouse=True)
def _clear_external_provider_credentials(monkeypatch):
    from app.config import settings

    monkeypatch.setattr(settings, "api_football_api_key", "")
    monkeypatch.setattr(settings, "football_data_api_key", "")


@pytest.fixture(autouse=True)
def _block_external_requests(monkeypatch):
    def blocked(_session, method, url, **_kwargs):
        raise AssertionError(f"unmocked external HTTP: {method} {url}")

    monkeypatch.setattr(requests.sessions.Session, "request", blocked)
~~~

Also pin both provider keys to empty strings in backend/tests/conftest.py.

- [ ] **Step 4: Verify**

Run the guard and two original tests. Expected: 3 passed, no external call.

- [ ] **Step 5: Commit**

~~~bash
git add conftest.py backend/tests/conftest.py
git commit -m "test: block unmocked provider traffic"
~~~

---

### Task 2: Normalize both providers

**Files:**
- Create: pipeline/ingest/fixture_contract.py
- Create: pipeline/ingest/football_data.py
- Create: pipeline/ingest/fixture_sources_test.py
- Modify: pipeline/ingest/api_football.py

**Interfaces:**
- Produces: NormalizedFixture, capabilities_for, normalize_league_fixture, normalize_fixture, fetch_football_data_fixtures.
- Consumes: app.match_status.internal_status and provider_errors classes.

- [ ] **Step 1: Write parser tests**

Use complete literal payloads. Primary assertion:

~~~python
def test_football_data_fixture_normalizes_current_result():
    raw = {
        "id": 991,
        "utcDate": "2026-08-28T18:30:00Z",
        "status": "FINISHED",
        "matchday": 1,
        "stage": "REGULAR_SEASON",
        "lastUpdated": "2026-08-28T21:02:03Z",
        "homeTeam": {"id": 5, "name": "Borussia Dortmund"},
        "awayTeam": {"id": 11, "name": "FC Bayern München"},
        "score": {
            "duration": "REGULAR",
            "fullTime": {"home": 2, "away": 1},
            "regularTime": {"home": 2, "away": 1},
        },
    }
    got = normalize_fixture(raw, preserve_stopped_statuses=True)
    assert got.provider == "football_data"
    assert got.fixture_id == 991
    assert (got.status, got.score_home, got.score_away) == ("finished", 2, 1)
    assert got.matchweek == 1
    assert got.round_label == "REGULAR_SEASON"
    assert got.upstream_updated_at.isoformat() == "2026-08-28T21:02:03+00:00"
~~~

Add tests for API-Football contract parity, malformed rows, null score, extra-time regulation score, venue, postponed/cancelled/suspended, UCL LEAGUE_STAGE, capabilities, one retry for timeout/429/5xx, Retry-After, and no retry for 401/403/malformed/empty/mismatched competition.

- [ ] **Step 2: Run red**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest pipeline/ingest/fixture_sources_test.py -vv
~~~

Expected: import failure for missing modules.

- [ ] **Step 3: Implement contract**

Create:

~~~python
from dataclasses import dataclass
from datetime import datetime
from typing import Literal

FixtureProvider = Literal["api_football", "football_data"]


@dataclass(frozen=True, slots=True)
class NormalizedFixture:
    provider: FixtureProvider
    fixture_id: int
    home_name: str
    away_name: str
    kickoff_utc: datetime
    status: str
    score_home: int | None
    score_away: int | None
    matchweek: int | None
    score_home_90: int | None
    score_away_90: int | None
    venue_name: str | None
    venue_city: str | None
    round_label: str | None
    upstream_updated_at: datetime | None
    home_provider_id: int | None
    away_provider_id: int | None
~~~

capabilities_for("football_data") returns delayed_results and false for odds, injuries, lineups, events, live_minute. API-Football returns live and true for those fields.

- [ ] **Step 4: Implement adapters**

API-Football normalization preserves current status, AET/PEN, round, team IDs, venue, and update timestamp.

football_data.py calls /v4/competitions/{code}/matches with season. MAX_ATTEMPTS is 2. Validate returned competition code and non-empty matches. Map 401/403 to ProviderAuthError, 429 to ProviderQuotaError, other invalid payloads to ProviderError. Retry timeout, 429, and 5xx once. Tests inject the sleeper.

- [ ] **Step 5: Verify**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/fixture_sources_test.py pipeline/ingest/api_football_test.py \
  backend/tests/test_provider_probe.py -vv
~~~

- [ ] **Step 6: Commit**

~~~bash
git add pipeline/ingest/fixture_contract.py pipeline/ingest/football_data.py \
  pipeline/ingest/fixture_sources_test.py pipeline/ingest/api_football.py
git commit -m "feat: normalize league fixture providers"
~~~

---

### Task 3: Persist provenance and reconcile switches

**Files:**
- Create: backend/alembic/versions/a9b4c7d2e601_fixture_feed_provenance.py
- Modify: backend/app/models/__init__.py
- Modify: pipeline/ingest/league_structure.py
- Modify: pipeline/ingest/club_results.py
- Modify: their tests.

**Interfaces:**
- Consumes: NormalizedFixture.
- Produces: Match.fixture_provider, FixtureFeedStatus, provider-neutral loader, caller-owned transactions.

- [ ] **Step 1: Write failing tests**

Test football-data source/timestamp persistence; preserve Team.provider_team_id; switch one existing API-Football match to football-data without duplication; reject an ambiguous repeated UCL pair; leave seeded Prediction rows unchanged; roll back structure and history together when commit=False.

- [ ] **Step 2: Run red**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/league_structure_test.py pipeline/ingest/club_results_test.py -vv
~~~

- [ ] **Step 3: Add migration**

Revision a9b4c7d2e601, down revision f110d3725491:

~~~python
def upgrade() -> None:
    op.add_column(
        "matches",
        sa.Column("fixture_provider", sa.String(length=32), nullable=True),
    )
    op.create_table(
        "fixture_feed_status",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("competition_code", sa.String(length=24), nullable=False),
        sa.Column("tournament_name", sa.String(length=120), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True)),
        sa.Column("last_success_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_at", sa.DateTime(timezone=True)),
        sa.Column("last_error_kind", sa.String(length=32)),
        sa.Column("last_error", sa.String(length=500)),
        sa.Column("fixture_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("latest_upstream_updated_at", sa.DateTime(timezone=True)),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.UniqueConstraint(
            "competition_code",
            name="uq_fixture_feed_status_competition",
        ),
    )


def downgrade() -> None:
    op.drop_table("fixture_feed_status")
    op.drop_column("matches", "fixture_provider")
~~~

Map Match.fixture_provider deferred=True. Map FixtureFeedStatus exactly.

- [ ] **Step 4: Convert persistence**

Add keyword parameters fixture_source="api_football", competition_code=None, commit=True to load_league_structure.

fetch_league_fixtures is the only selection boundary. Reconcile in order: same source+provider ID; unique oriented team pair; among repeated pairs kickoff within 48 hours; raise FixtureReconciliationError if still ambiguous; create only with no candidate. Preserve API-Football team IDs when the source is football-data.

Set fixture_provider, provider_fixture_id, and provider_last_updated on accepted updates. Never touch Prediction relationships.

- [ ] **Step 5: Add transaction switches**

Add commit=True to structure load and sync_finished_matches_to_history:

~~~python
if commit:
    db.commit()
else:
    db.flush()
~~~

- [ ] **Step 6: Verify**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/league_structure_test.py pipeline/ingest/club_results_test.py \
  backend/tests/test_lineups_api.py -vv
~~~

- [ ] **Step 7: Commit**

~~~bash
git add backend/alembic/versions/a9b4c7d2e601_fixture_feed_provenance.py \
  backend/app/models/__init__.py pipeline/ingest/league_structure.py \
  pipeline/ingest/league_structure_test.py pipeline/ingest/club_results.py \
  pipeline/ingest/club_results_test.py
git commit -m "feat: persist fixture feed provenance"
~~~

---

### Task 4: Select source and fail partial runs

**Files:**
- Create: pipeline/ingest/fixture_feed_status.py
- Create: pipeline/ingest/fixture_feed_status_test.py
- Modify: backend/app/config.py
- Modify: pipeline/leagues.py and tests
- Modify: pipeline/run_pipeline.py and league tests

**Interfaces:**
- Produces: league_fixture_provider, football_data_code, record_attempt, record_success, record_failure, PartialLeagueRefreshError.

- [ ] **Step 1: Write failing tests**

Assert codes epl=PL, laliga=PD, bundesliga=BL1, ucl=CL; default source api_football; source-specific key selection. Simulate La Liga failure and prove the other three commit and generate predictions before a final PartialLeagueRefreshError names laliga.

Status tests prove attempt commits before fetch, success clears current errors, failure preserves prior success, text truncates at 500, capabilities persist.

- [ ] **Step 2: Run red**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/fixture_feed_status_test.py pipeline/leagues_test.py \
  pipeline/run_pipeline_league_test.py -vv
~~~

- [ ] **Step 3: Add config and registry**

Add league_fixture_provider="api_football" and league_fixture_api_key property selecting the correct existing key. Reject any source outside api_football/football_data at the call boundary.

Add football_data_code to LeagueConfig and four registry rows. Add LEAGUE_STAGE to UCL group prefixes without removing League Stage.

- [ ] **Step 4: Implement status writers**

Each writer upserts by competition_code and commits. Attempt sets last_attempt_at. Success clears error fields, stores counts/latest upstream/capabilities. Failure preserves last success, classifies ProviderError.kind or error, truncates message.

- [ ] **Step 5: Integrate runner**

Per competition: record attempt; load structure commit=False; mirror history commit=False; commit; record success. On failure: rollback; record failure; collect; continue.

Keep API-Football systemic auth/quota short-circuit. For football-data, bound and attempt all four. After downstream work for successful competitions, raise:

~~~python
class PartialLeagueRefreshError(RuntimeError):
    def __init__(self, failures: list[dict]):
        self.failures = failures
        names = ", ".join(row["competition_code"] for row in failures)
        super().__init__(f"league fixture refresh failed for: {names}")
~~~

- [ ] **Step 6: Verify**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/fixture_feed_status_test.py pipeline/leagues_test.py \
  pipeline/run_pipeline_league_test.py pipeline/run_pipeline_test.py -vv
~~~

- [ ] **Step 7: Commit**

~~~bash
git add backend/app/config.py pipeline/leagues.py pipeline/leagues_test.py \
  pipeline/ingest/fixture_feed_status.py pipeline/ingest/fixture_feed_status_test.py \
  pipeline/run_pipeline.py pipeline/run_pipeline_league_test.py
git commit -m "feat: run fixture feeds per competition"
~~~

---

### Task 5: Expose feed health

**Files:**
- Modify: backend/app/data_freshness.py and tests
- Modify: backend/app/main.py
- Modify: backend/tests/test_health.py

**Interfaces:**
- Produces: fixture_feed_health and /api/health.fixture_feeds.

- [ ] **Step 1: Write failing tests**

Test ok/delayed capabilities, never_run, empty, stale after 36 hours, and failed when error is newer than success. Assert all expected codes appear and any non-ok feed adds data_status degradation kind fixture_feed.

- [ ] **Step 2: Run red**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  backend/tests/test_data_freshness.py backend/tests/test_health.py -vv
~~~

- [ ] **Step 3: Implement projection**

Return provider, mode, attempt/success/error timestamps, error, fixture count, upstream timestamp, capabilities, status. Status priority: never_run; empty; failed; stale; ok. Append one fixture_feed degradation with all non-ok competitions. Preserve existing stuck-match and coverage shapes.

- [ ] **Step 4: Wire route**

Expose fixture_feeds. Before migration, keep liveness ok, expose unavailable, and set data_status unknown; never claim unreadable status is healthy.

- [ ] **Step 5: Verify and commit**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  backend/tests/test_data_freshness.py backend/tests/test_health.py -vv
git add backend/app/data_freshness.py backend/tests/test_data_freshness.py \
  backend/app/main.py backend/tests/test_health.py
git commit -m "feat: report fixture feed health by competition"
~~~

---

### Task 6: Enforce health and document operations

**Files:**
- Create: scripts/validate_health.py and test
- Modify: refresh.yml, smoke.yml, .env.example, docs/RELIABILITY.md

**Interfaces:**
- Produces: validate(payload) errors and CLI exit status.

- [ ] **Step 1: Write failing validator tests**

Healthy payload has liveness ok, data_status ok, prediction missing 0, and four fixture feeds ok. Add tests for degraded data, missing UCL, failed Bundesliga, bad liveness, and missing predictions.

- [ ] **Step 2: Run red**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest scripts/validate_health_test.py -vv
~~~

- [ ] **Step 3: Implement validator**

EXPECTED_COMPETITIONS is epl/laliga/bundesliga/ucl. Read JSON from stdin or first file argument. Print exact errors to stderr and return 1 on errors.

- [ ] **Step 4: Wire workflows safely**

refresh.yml passes FOOTBALL_DATA_API_KEY from the same-named secret and LEAGUE_FIXTURE_PROVIDER from the same-named repository variable, defaulting to api_football.

smoke.yml checks out the repository, fetches health once with retries, and runs python scripts/validate_health.py against the saved JSON. Keep page, redirect, payload, and NRL checks.

- [ ] **Step 5: Document**

.env.example adds empty FOOTBALL_DATA_API_KEY and LEAGUE_FIXTURE_PROVIDER=api_football. RELIABILITY documents codes, delayed results, unsupported enrichment, quota, migration-first rollout, activation values, rollback, and stop gates.

- [ ] **Step 6: Verify and commit**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest scripts/validate_health_test.py -vv
ruby -e 'require "yaml"; YAML.load_file(".github/workflows/refresh.yml"); YAML.load_file(".github/workflows/smoke.yml")'
git add scripts/validate_health.py scripts/validate_health_test.py \
  .github/workflows/refresh.yml .github/workflows/smoke.yml \
  .env.example docs/RELIABILITY.md
git commit -m "ops: enforce fixture feed health"
~~~

---

### Task 7: Full verification and stop-gated handoff

**Files:** Verify all Task 1-6 files. Do not change external or production state.

- [ ] **Step 1: Verify migration head**

~~~bash
cd backend && ../.venv/bin/alembic heads
~~~

Expected: exactly a9b4c7d2e601.

- [ ] **Step 2: Run focused tests**

~~~bash
PYTHONPATH=backend:. .venv/bin/python -m pytest \
  pipeline/ingest/fixture_sources_test.py \
  pipeline/ingest/fixture_feed_status_test.py \
  pipeline/ingest/league_structure_test.py \
  pipeline/ingest/club_results_test.py \
  pipeline/run_pipeline_league_test.py \
  backend/tests/test_data_freshness.py backend/tests/test_health.py \
  scripts/validate_health_test.py -vv
~~~

- [ ] **Step 3: Run real gate**

~~~bash
make test
~~~

Expected: all Python and frontend gates exit 0. Report exact failures.

- [ ] **Step 4: Audit**

~~~bash
git diff --check origin/main...HEAD
git status --short
git log --oneline origin/main..HEAD
~~~

- [ ] **Step 5: Fresh Opus review**

Give a fresh Opus reviewer the spec, plan, diff, and full output. Process findings using receiving-code-review and rerun affected tests.

- [ ] **Step 6: Stop before outward/production actions**

Report schema, behavior, tests, review, migration-first sequence, required secret/variable, and rollback. Wait for explicit go before push/PR if outward, and always before migration, merge, configuration, refresh, or deploy.

## Self-Review Record

- Coverage: source, four competitions, provider preservation, provenance, immutable receipts, isolated failures, quota, unsupported enrichment, health, smoke, tests, rollout.
- Scope: shadow ledgers, prediction horizons, model-record provenance, and model changes remain follow-on subprojects.
- Types: NormalizedFixture, fixture_provider, FixtureFeedStatus, league_fixture_provider, football_data_code, status writers, fixture_feed_health, PartialLeagueRefreshError are consistent.
- Current main: extends provider_last_updated, provider errors, data_status, and smoke rather than duplicating them.
