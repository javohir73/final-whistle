# Live reliability & SLOs (engine roadmap, Phase 3)

The in-play engine reprices every match from the CURRENT score/minute/card state.
This doc formalizes the service levels it targets and the self-healing that was
already built to meet them — Phase 3's "reliability engineering: uptime SLOs,
feed-failure fallbacks (self-healing live state already exists — formalize it)."

## Latency budget: state change → new price < 5s

The re-price itself is a pure, stdlib Poisson-grid transform of values already
stored on the frozen prediction (`lambda_home`, `lambda_away`, `rho`) plus live
state. It is **sub-millisecond**:

| Measure (200 varied live-state snapshots, `time.perf_counter`) | Value |
|---|---|
| Mean per re-price | **0.19 ms** |
| Worst per re-price | **0.36 ms** |
| Budget (roadmap SLO) | 5000 ms |

Guarded by `backend/tests/test_live_latency.py` (asserts < 25 ms/call and < 1 s
for 200 calls — a >10⁴× margin on the 5s SLO). So the *computation* is never the
bottleneck.

The **user-visible** freshness is instead bounded by the data-refresh cadence:
a live score reaches the client on the next poll after ingestion. Stated
honestly, the SLO is **"< 5s from the latest successful score fetch to the
new price"**, which the math meets trivially; end-to-end freshness is the poll
cycle below (~60s worst case on the free tier), not the pricing.

## Live match state SLOs

- **Uptime:** 99.5% during active match dates — live state is available.
- **Freshness:** ≥ 90% of live scores reflected within ~2 minutes of provider
  availability (bounded by the 60s live-refresh rate limit + poll + network).
- **Post-results chain:** completes < 15 minutes after the final whistle
  (retry-with-backoff guarantees no finished match is orphaned).

## Self-healing already in place

These mechanisms exist in code and are what make the SLOs above achievable
without new infrastructure:

- **Monotonic freshness guard** (`pipeline/ingest/live_scores.py`): every match
  carries `provider_last_updated`; an incoming snapshot older than the stored one
  is ignored, and match state only ever moves `scheduled → in_play → finished`
  (never un-finished/un-lived from a lagging cache node). The DB stays consistent
  under provider lag.
- **Minute estimation** (`estimate_minute` / `_derive_period`): the free tier
  gives no live clock, so the minute is estimated from kickoff and the period
  label (HT / 2nd half / ET / PENS) is derived — the UI always shows a sensible
  clock (±2–3 min) even with no minute feed.
- **Opportunistic refresh** (`backend/app/live_refresh.py:maybe_refresh_live`):
  board/summary traffic and the every-minute `/api/live/ping` cron both schedule
  a rate-limited (60s), live-window-guarded refresh as a background task, so
  scores stay fresh during match windows without blocking any request.
- **Chain retry backoff** (`chain_status.py`, `LearningChainStatus`): the
  post-results learning chain records each attempt/failure and is retried with a
  ~10-minute backoff; `/api/health` surfaces `learning_chain` (pending,
  last_success_at, last_error) so a stuck chain is observable.
- **Cache invalidation:** a successful refresh (or chain completion) clears the
  per-match summary cache, so a stale price never outlives a score update.

## Feed-failure fallback

If the provider fetch fails (down / key expired / network error): the failure is
logged, the DB is left unchanged, and the score stays frozen at the last
successful fetch. Polling keeps retrying on the next 60s window, and the
post-results chain still runs off the last-seen score when the match finishes.
The in-play markets endpoint degrades gracefully: if the live clock/state is
unusable (extra-time, shootout, or no estimable minute), `GET
/v1/markets/{id}?live=1` falls back to the frozen pre-match markets
(`is_live: false`) rather than erroring.

## In-play market benchmark — blocked on a live odds feed

Phase 3's "benchmark vs in-play market snapshots" is **blocked on external
data**: neither the free live provider (football-data.org, match state only) nor
the pre-match odds source (api-sports `/odds`, populated ~48h pre-kickoff)
exposes in-play prices, and sharp live feeds (Pinnacle/Betfair) require a
commercial licence. Until such a feed is available, the model can only be
benchmarked against the **closing line** (the 90-minute snapshot, Phase 0/2).
When a live feed is obtained, capture in-play snapshots (minute-stamped) and
compare the re-priced W/D/L at minute *m* against the market at minute *m*.

## Scheduled league fixture fallback

The daily pipeline can source fixtures and results for all active club
competitions from football-data.org when API-Football is unavailable:

| Internal code | football-data.org code |
|---|---|
| `epl` | `PL` |
| `laliga` | `PD` |
| `bundesliga` | `BL1` |
| `ucl` | `CL` |

This is a `delayed_results` fallback, not a real-time enrichment source. It does
not provide this application's odds, injuries, lineups, events, or authoritative
live minute. Those capabilities are reported as unsupported, never as successful
empty data.

The free plan is limited to 10 requests per minute. The pipeline stays within
that envelope by fetching competitions sequentially, making one fixture request
per competition, and using bounded retry/backoff that honours `Retry-After`.
Each competition commits independently, so one failed feed is visible in health
without discarding successful competitions.

### Activation and rollback

The safe default is `LEAGUE_FIXTURE_PROVIDER=api_football`. To activate the
fallback, add the GitHub Actions secret `FOOTBALL_DATA_API_KEY`, then set the
repository variable `LEAGUE_FIXTURE_PROVIDER=football_data`. The refresh workflow
passes both values to the pipeline. Do not put either credential in source or
logs.

The provenance/status migration (`a9b4c7d2e601`) must reach production before
code that writes fixture-feed status is served. Because Render has no pre-deploy
step, the guarded order is: merge the migration, explicitly dispatch
`refresh.yml` and confirm `alembic upgrade head`, then deploy dependent code.
Never activate the provider before that sequence completes.

Rollback is configuration-only: set `LEAGUE_FIXTURE_PROVIDER=api_football` after
confirming its entitlement is restored, run the refresh, and require `/api/health`
to return liveness `ok`, `data_status: ok`, zero missing predictions, and `ok`
fixture feeds for all four competition codes. Keep the stored provenance and
status rows; provider-aware reconciliation switches existing matches back without
discarding history.

Changing production secrets or repository variables, dispatching the production
refresh/migration, merging, and deploying are stop-gated operations. They require
an explicit human `go`; local validation must not perform them.

### Manual results for fixtures no provider covers

football-data.org does not carry Champions League qualifying, so fixtures
created by API-Football before it lapsed (2026-08-18) can never be finished by
a feed. They sit `scheduled` forever: shown as unplayed, counted as
`stale_fixture` in `/api/health`, their frozen predictions never graded, and
club Elo never learns from them. `pipeline/ingest/manual_results.py` holds a
short, hand-reviewed list of results for exactly these matches. The daily
league pipeline applies it after each competition's fixture ingest and before
its history sync (summary step `manual_results`), so the match is graded and
replayed in the same run.

When to add an entry:

- Only for a match no configured provider covers. Never to correct or
  pre-empt a provider: if a feed can deliver the result, fix the feed.
- Only with two independent sources that agree on the score (for UEFA
  matches: UEFA's official Full Time Report and Wikipedia). Cite them in the
  module docstring.
- Record the final score (after extra time, never counting shootout kicks)
  and the score at the end of normal time, keyed by league code, home name,
  away name and UTC kickoff date. Names must resolve through
  `pipeline/team_mapping.py`; never add a database id.

What the step guarantees: it only fills a match that is `scheduled` with no
score and has kicked off; it skips, with a warning naming the entry, any entry
whose names do not resolve or that matches zero or several fixtures; a second
run is a no-op. Applied rows carry `fixture_provider = 'manual'`, so they are
queryable (`SELECT ... WHERE fixture_provider = 'manual'`). A provider result
always wins: if a feed later delivers the match, its ingest overwrites the
manual row, and a different score is logged as an ERROR (`DISAGREES`). The
prediction already graded from the manual score is append-only and is not
regraded automatically; after review, delete that `prediction_results` row so
the learning loop regrades it, correct or delete the match's
`historical_matches` row (it keeps the hand-entered score, and a provider
kickoff on a different date would add a second row and count the match twice in
the rating replay), and remove the entry from the list.
