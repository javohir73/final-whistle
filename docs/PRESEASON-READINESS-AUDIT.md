# Pre-season readiness audit

Audited 12 August 2026. This is the launch hand-off for the football league
season surfaces; it deliberately does not authorize a merge, production
deploy, paid-plan change, or production refresh.

## Readiness verdict

The application changes in PR #254 are release-ready. The complete local gate
passes, the optimized frontend build succeeds, production dependency audits
report no known vulnerabilities, and browser checks cover the smallest
supported phone width through desktop.

The platform is not operationally launch-ready until the PR is merged and
deployed, its live smoke checks pass, and the provider allowance is confirmed
healthy on launch day.

## Closed in PR #254

- Provider auth/quota failures can no longer look like successful empty
  refreshes. Complete and partial live-provider failures return 503 (successful
  leagues still commit); systemic odds failure exits non-zero.
- Postponed, cancelled, and suspended fixtures can retain their real status
  instead of being flattened to scheduled. Picks lock consistently and
  stale-match health checks no longer flag ordinary postponements as feed
  outages. The behavior is rollout-gated until the tolerant frontend is live.
- League score tips withhold the model score until a user explicitly locks a
  first pick or the fixture locks. That first pick is final on the server, so a
  player cannot reveal the model and then copy it into an edited prediction.
- League standings show a neutral pre-season table and the complete football
  columns. Qualification/relegation zones stay hidden until results exist.
- Competition context survives Play, You, Premium, hosted Checkout, and return
  navigation. Only the selected Play competition mounts its data-fetching UI.
- Confirmed venue name/city now ingest without erasing previously known values;
  unknown venues and absent market data are labelled honestly.
- Match status, bracket parity, premium gating, and structured-event data have
  regression coverage.
- Production dependencies were upgraded within the current major versions.

## Verified gate

| Check | Result |
|---|---|
| Python suite | 3,083 passed |
| Frontend suite | 168 suites / 1,153 tests passed |
| TypeScript | clean |
| Lint | exit 0; one pre-existing NRL hook warning |
| Optimized Next.js build | passed |
| npm production audit | 0 vulnerabilities |
| Python dependency audit | 0 vulnerabilities |
| Browser widths | 320, 390, 768, and 1,280 px; no horizontal overflow |
| Browser competition isolation | EPL and NRL request only their selected tips endpoints |

## Operational evidence and risks

### Provider allowance

The production API key reported an active API-Football **Pro** plan with a
7,500-request daily allowance during the audit. The audit probe observed 37
requests used and confirmed that player/top-scorer data was reachable.

However, the 11 August manual production refresh exhausted the daily allowance
for all four league-structure calls. The deployed code treated that run as
green; PR #254 fixes the false-green behavior, but it cannot prevent other jobs
or users of the same key from consuming the shared allowance.

The weekly player refresh is the dominant known consumer: its 20-tick shape is
approximately 1,670 calls when 50 squads and 40 players per tick are processed.
Live refresh self-gates outside match windows; odds snapshotting is bounded to
40 calls per pass and five lifetime attempts per match.

Owner actions before launch:

1. Confirm the Pro subscription remains active through opening weekend.
2. Check the shared key's daily usage immediately before the first live window.
3. Investigate any unexpected consumers if the allowance approaches its cap.
4. After deployment, confirm quota/auth failures turn the scheduled job red and
   `/api/health` reports the degraded data state.

Plan and rate-limit references checked during the audit:

- <https://www.api-football.com/pricing>
- <https://www.api-football.com/news/post/how-ratelimit-works>
- <https://www.api-football.com/news/post/how-to-optimize-api-sports-calls-and-quota-usage>

### Provisional kickoff marker

API-Football's `TBD` fixture state is still normalized to scheduled, so the UI
cannot distinguish a confirmed kickoff from a provisional time without storing
new information. This should be a migration-only PR first, followed by an
explicitly approved production `refresh.yml`, and only then dependent UI/API
code. Guessing from a placeholder timestamp would violate the platform's
honesty rule.

### Repository visibility

Repository instructions describe this project as private, while GitHub reported
`javohir73/FinalWhistle` as public during the audit. No visibility setting was
changed. The owner should resolve that policy mismatch separately.

## Launch sequence still required

1. Review PR #254 and wait for all CI/preview checks to pass.
2. Obtain explicit owner approval to merge (the repository stop gate).
3. Merge to `main` and let Render/Vercel deploy.
4. Verify the frontend deploy and smoke the status-tolerant fixture, tips, and
   bracket surfaces while `PRESERVE_MATCH_STOP_STATUSES` remains false.
5. Enable `PRESERVE_MATCH_STOP_STATUSES=true` in Render and verify the
   production API health endpoint. This production configuration change stays
   behind the owner stop gate.
6. Smoke EPL home, fixtures, standings, a match page, Play, You, and Premium on
   mobile and desktop; repeat the selected-competition and hidden-score checks.
7. Watch the first scheduled refresh and the first live match window for
   provider failures, stale scores, and allowance consumption.
