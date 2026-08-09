# Daylight surface sweep verification

Artifact date: 2026-08-09

Final audit date: 2026-08-10 (Australia/Sydney)

Branch: `codex/light-theme-sweep`

Verified implementation commit: `e1229e9e7458044b735990df9068b58062962275`

## Result

The production-mode Daylight audit exercised 35 route patterns at `375×844` and
`1280×800`: 70/70 route-viewport checks were audited with no unavailable routes,
navigation failures, error boundaries, redirect failures, or measured contrast
failures. Loading, empty, error, and disabled FeatureHero states were safely forced
at both widths: 8/8 checks, with no declared-stop contrast failures.

This is not a claim that every continuously interpolated gradient pixel was
mathematically measured. The sound audit policy records 6,214 deduplicated Daylight
exemptions: 6,213 text records over continuous gradients whose declared stops pass
but whose intermediate Oklab colours require rendered-pixel evidence, and one mobile
navigation label intersecting an image. All 70 route-viewport screenshots and all
eight state screenshots were reviewed; no visual legibility or layout defect was
found. The machine-readable ledger retains the exact route, viewport, selector,
foreground, background, reason, and screenshot path for every exemption.

Floodlight computed styles are unchanged. Comparing the after capture with the
preserved baseline produced `darkDiffs: []` and `darkStyleDiffs: 0`. The improved
resolver also reports 310 pre-existing Floodlight declared-stop contrast failures;
that is expanded audit coverage over unchanged styles, not a regression and not a
clean Floodlight contrast result.

## Audit environment

- Production Next build at `http://127.0.0.1:3000`.
- Read-only API: `NEXT_PUBLIC_API_URL=https://pitchprophet-api.onrender.com`.
- Dynamic representatives: football match `/football/wc26/match/1`, group
  `/football/wc26/groups/1`, football team `/football/wc26/team/1`, NRL match
  `/nrl/match/2026/23/165`, NRL round `/nrl/round/23`, and NRL team `/nrl/team/1`.
- Forced-state representative: `/nrl/match/2026/24/173`.
- No write request, deployment, production mutation, push, or pull request occurred.

The final evidence files are intentionally untracked under
`frontend/output/playwright/light-theme-sweep/`:

| Artifact | SHA-256 |
|---|---|
| `dark-before.json` | `23ea923813770a21ecb72643a92618bd973034c5644132d6ee225231f6787d37` |
| `light-after-fix2.json` | `738502713d3413d3b728601e0afc3673cfc71782f3ec48e16c9442ebac2bb23e` |
| `dark-after-fix2.json` | `36e9f6f5ac32160de9e5bba560070c8e93e570497c1a130b9497b6765f81d5a3` |
| `state-results-fix2.json` | `125cb92698d68cbe86ddd8e2c3f21ba126f50e9d2f9345fe1668368c6589be20` |
| P0 screenshot manifest (18 files) | `ca121ffe8809ee50ab38cd39ac65caadc793371d99ad108c70478839fcbb8af2` |
| P1/P2 screenshot manifest (52 files) | `6274b99189205a2959ee5e19d8fe6ec3bd30aa4c71a3b39829a06cacb8d99830` |
| State screenshot manifest (8 files) | `7d7fda1175194cec137302386d115c227e4ad8a2a2d18b913216d6a645643356` |

## Route inventory

- P0 (9): `/`, `/matches`, `/match/[id]`, `/football/[comp]`,
  `/football/[comp]/fixtures`, `/football/[comp]/match/[id]`,
  `/football/[comp]/standings`, `/nrl`, `/nrl/matches`.
- P1 (13): `/play`, `/tips`, `/leaderboard`, `/record`, `/brackets`,
  `/football/[comp]/bracket`, `/groups`, `/groups/[id]`, `/team/[id]`,
  `/nrl/ladder`, `/nrl/round/[n]`, `/nrl/match/[season]/[round]/[no]`,
  `/nrl/team/[id]`.
- P2 (13): `/about`, `/methodology`, `/privacy`, `/terms`, `/retention`,
  `/research/market-benchmark`, `/nrl/record`, `/nrl/origin`, `/nrl/run-home`,
  `/nrl/tips`, `/nrl/leaderboard`, `/reset-password`, `/verify-email`.

## Route and viewport matrix

Every route-viewport has one or more conservative exemptions, so the status is
`manual review`, not an unqualified automated pass. `Failures` is the measured
declared-stop failure count. `Records` is the per-route exemption count before the
top-level ledger deduplicates canonical aliases.

| Tier | Pattern | Representative | Viewport | Status | Failures | Records |
|---|---|---|---:|---|---:|---:|
| P0 | `/` | `/` | 375×844 | manual review | 0 | 24 |
| P0 | `/` | `/` | 1280×800 | manual review | 0 | 24 |
| P0 | `/matches` | `/football/wc26/fixtures` | 375×844 | manual review | 0 | 5 |
| P0 | `/matches` | `/football/wc26/fixtures` | 1280×800 | manual review | 0 | 5 |
| P0 | `/match/[id]` | `/football/wc26/match/1` | 375×844 | manual review | 0 | 56 |
| P0 | `/match/[id]` | `/football/wc26/match/1` | 1280×800 | manual review | 0 | 56 |
| P0 | `/football/[comp]` | `/football/wc26` | 375×844 | manual review | 0 | 57 |
| P0 | `/football/[comp]` | `/football/wc26` | 1280×800 | manual review | 0 | 57 |
| P0 | `/football/[comp]/fixtures` | `/football/wc26/fixtures` | 375×844 | manual review | 0 | 5 |
| P0 | `/football/[comp]/fixtures` | `/football/wc26/fixtures` | 1280×800 | manual review | 0 | 5 |
| P0 | `/football/[comp]/match/[id]` | `/football/wc26/match/1` | 375×844 | manual review | 0 | 56 |
| P0 | `/football/[comp]/match/[id]` | `/football/wc26/match/1` | 1280×800 | manual review | 0 | 56 |
| P0 | `/football/[comp]/standings` | `/football/epl/standings` | 375×844 | manual review | 0 | 87 |
| P0 | `/football/[comp]/standings` | `/football/epl/standings` | 1280×800 | manual review | 0 | 87 |
| P0 | `/nrl` | `/nrl` | 375×844 | manual review | 0 | 104 |
| P0 | `/nrl` | `/nrl` | 1280×800 | manual review | 0 | 104 |
| P0 | `/nrl/matches` | `/nrl/matches` | 375×844 | manual review | 0 | 195 |
| P0 | `/nrl/matches` | `/nrl/matches` | 1280×800 | manual review | 0 | 195 |
| P1 | `/play` | `/play` | 375×844 | manual review | 0 | 225 |
| P1 | `/play` | `/play` | 1280×800 | manual review | 0 | 225 |
| P1 | `/tips` | `/tips` | 375×844 | manual review | 0 | 133 |
| P1 | `/tips` | `/tips` | 1280×800 | manual review | 0 | 133 |
| P1 | `/leaderboard` | `/leaderboard` | 375×844 | manual review | 0 | 18 |
| P1 | `/leaderboard` | `/leaderboard` | 1280×800 | manual review | 0 | 18 |
| P1 | `/record` | `/record` | 375×844 | manual review | 0 | 51 |
| P1 | `/record` | `/record` | 1280×800 | manual review | 0 | 51 |
| P1 | `/brackets` | `/football/wc26/bracket` | 375×844 | manual review | 0 | 153 |
| P1 | `/brackets` | `/football/wc26/bracket` | 1280×800 | manual review | 0 | 153 |
| P1 | `/football/[comp]/bracket` | `/football/wc26/bracket` | 375×844 | manual review | 0 | 153 |
| P1 | `/football/[comp]/bracket` | `/football/wc26/bracket` | 1280×800 | manual review | 0 | 153 |
| P1 | `/groups` | `/football/wc26/groups` | 375×844 | manual review | 0 | 193 |
| P1 | `/groups` | `/football/wc26/groups` | 1280×800 | manual review | 0 | 193 |
| P1 | `/groups/[id]` | `/football/wc26/groups/1` | 375×844 | manual review | 0 | 63 |
| P1 | `/groups/[id]` | `/football/wc26/groups/1` | 1280×800 | manual review | 0 | 63 |
| P1 | `/team/[id]` | `/football/wc26/team/1` | 375×844 | manual review | 0 | 98 |
| P1 | `/team/[id]` | `/football/wc26/team/1` | 1280×800 | manual review | 0 | 98 |
| P1 | `/nrl/ladder` | `/nrl/ladder` | 375×844 | manual review | 0 | 111 |
| P1 | `/nrl/ladder` | `/nrl/ladder` | 1280×800 | manual review | 0 | 111 |
| P1 | `/nrl/round/[n]` | `/nrl/round/23` | 375×844 | manual review | 0 | 91 |
| P1 | `/nrl/round/[n]` | `/nrl/round/23` | 1280×800 | manual review | 0 | 91 |
| P1 | `/nrl/match/[season]/[round]/[no]` | `/nrl/match/2026/23/165` | 375×844 | manual review | 0 | 151 |
| P1 | `/nrl/match/[season]/[round]/[no]` | `/nrl/match/2026/23/165` | 1280×800 | manual review | 0 | 151 |
| P1 | `/nrl/team/[id]` | `/nrl/team/1` | 375×844 | manual review | 0 | 190 |
| P1 | `/nrl/team/[id]` | `/nrl/team/1` | 1280×800 | manual review | 0 | 190 |
| P2 | `/about` | `/about` | 375×844 | manual review | 0 | 20 |
| P2 | `/about` | `/about` | 1280×800 | manual review | 0 | 20 |
| P2 | `/methodology` | `/methodology` | 375×844 | manual review | 0 | 176 |
| P2 | `/methodology` | `/methodology` | 1280×800 | manual review | 0 | 176 |
| P2 | `/privacy` | `/privacy` | 375×844 | manual review | 0 | 19 |
| P2 | `/privacy` | `/privacy` | 1280×800 | manual review | 0 | 19 |
| P2 | `/terms` | `/terms` | 375×844 | manual review | 0 | 16 |
| P2 | `/terms` | `/terms` | 1280×800 | manual review | 0 | 16 |
| P2 | `/retention` | `/retention` | 375×844 | manual review | 0 | 170 |
| P2 | `/retention` | `/retention` | 1280×800 | manual review | 0 | 170 |
| P2 | `/research/market-benchmark` | `/research/market-benchmark` | 375×844 | manual review | 0 | 1 |
| P2 | `/research/market-benchmark` | `/research/market-benchmark` | 1280×800 | manual review | 0 | 1 |
| P2 | `/nrl/record` | `/nrl/record` | 375×844 | manual review | 0 | 9 |
| P2 | `/nrl/record` | `/nrl/record` | 1280×800 | manual review | 0 | 9 |
| P2 | `/nrl/origin` | `/nrl/origin` | 375×844 | manual review | 0 | 68 |
| P2 | `/nrl/origin` | `/nrl/origin` | 1280×800 | manual review | 0 | 68 |
| P2 | `/nrl/run-home` | `/nrl/run-home` | 375×844 | manual review | 0 | 457 |
| P2 | `/nrl/run-home` | `/nrl/run-home` | 1280×800 | manual review | 0 | 457 |
| P2 | `/nrl/tips` | `/nrl/tips` | 375×844 | manual review | 0 | 138 |
| P2 | `/nrl/tips` | `/nrl/tips` | 1280×800 | manual review | 0 | 137 |
| P2 | `/nrl/leaderboard` | `/nrl/leaderboard` | 375×844 | manual review | 0 | 18 |
| P2 | `/nrl/leaderboard` | `/nrl/leaderboard` | 1280×800 | manual review | 0 | 18 |
| P2 | `/reset-password` | `/reset-password` | 375×844 | manual review | 0 | 4 |
| P2 | `/reset-password` | `/reset-password` | 1280×800 | manual review | 0 | 4 |
| P2 | `/verify-email` | `/verify-email` | 375×844 | manual review | 0 | 4 |
| P2 | `/verify-email` | `/verify-email` | 1280×800 | manual review | 0 | 4 |

The deduplicated exemption totals are P0 1,061, P1 2,954, and P2 2,199. The
single media exemption is the `Home` mobile-nav label on `/nrl/tips` at 375×844,
whose midpoint intersects `/clubs/nrl/warriors.svg`; its evidence is
`manual/375x844/nrl-tips.png`. The other 6,213 records are continuous-gradient
interpolation exemptions.

## State coverage

| State | 375×844 | 1280×800 | Evidence |
|---|---|---|---|
| Loading | manual review; 0 declared-stop failures | manual review; 0 declared-stop failures | Local GET interception held live, scorer, and team-profile requests. |
| Empty | manual review; 0 declared-stop failures | manual review; 0 declared-stop failures | Scorers returned `[]`; the intentionally absent section was confirmed. |
| Error | manual review; 0 declared-stop failures | manual review; 0 declared-stop failures | Local 503s exposed both client error messages. |
| Disabled FeatureHero | manual review; 0 declared-stop failures | manual review; 0 declared-stop failures | Daylight opacity 1; primary 9.571:1 and secondary 16.968:1/15.740:1. Floodlight opacity remains 0.6. |

Other server-component loading and error boundaries were not claimed as rendered:
holding them would require replacing the application document/RSC response or
disrupting the shared read API. The safe client-island representative above covers
the state classes without making an external write.

## Failures found and resolved

The first valid Daylight run found 110 measurable solid-surface failures. They were
the disclaimer warning, action CTAs, host and medium chips, scorebug outcome labels,
and Origin year/disclaimer copy. Semantic inks removed all 110 while preserving each
original Floodlight literal. The upgraded declared-stop resolver then exposed 604
additional measurable failures previously hidden among gradient deferrals: P0 152,
P1 382, and P2 70. Those grouped into disabled controls; gold, muted and NRL copy;
loss/draw/gold wash chips; result inks; and invariant pitch-panel copy/chips. The
resolver reduced the final measured failure count to zero.

The final semantic contrast tests exercise the actual canvas, solid fill, card
gradient endpoints, nested washes, and invariant pitch stops. Daylight before/after
ratios below are calculated on those tested surfaces. Floodlight values in the
middle column are the original shipped values and remain exact; therefore every
Floodlight before/after pair and contrast ratio is unchanged. The empty computed-
style diff is the browser proof rather than an assertion by eye.

| Token or inline colour | Floodlight before = after | Daylight before → after | Tested Daylight contrast before → after |
|---|---|---|---:|
| `--crash-muted` | `#6b7c71` | `#6b7c71` → `#59685f` | 4.138 → 5.501 on `#f6f8f3` |
| `--pitch-copy` | `#a9c7b4` | `#a9c7b4` → `#a9c7b4` (explicit invariant) | 7.304–9.863 → 7.304–9.863 on pitch stops |
| `--feature-chart-ink` | `#8b95a7` | `#8b95a7` → `#657185` | 2.799–3.020 → 4.576–4.936 on canvas/card |
| `--amber-ink` | `38 94% 58%` | `43 82% 33%` → `43 82% 29%` | 3.867 measured → 4.775 on the actual host-chip wash |
| `--action-ink` | `156 33% 6%` | background ink `96 23% 96%` → `150 38% 9%` | 1.639 → 9.623 on win |
| `--draw-ink` | `38 94% 58%` | draw `41 78% 51%` → `43 82% 29%` | 1.998 → 5.042 on canvas |
| `--loss-ink` | `351 90% 64%` | loss `350 84% 62%` → `350 84% 45%` | 3.278 → 4.979 on canvas |
| `--lime-deep-ink` | `0 0% 0%` | black → `96 23% 96%` | 3.254 → 5.983 on deep lime |
| `--origin-disclaimer` | `0 0% 100% / 0.4` | white/40 → `140 8% 38%` | 1.031 → 5.415 on canvas |
| `--disabled-opacity` | `0.6` | `0.6` → `1` | primary ~3.20–3.25 → 9.571; secondary ~4.39 → 15.740–16.968 |
| `--disabled-opacity-40` | `0.4` | `0.4` → `1` | picker 1.738–1.747 → 5.242–5.455; reset 2.461–2.494 → 15.732–17.012 |
| `--gold-ink` | `42 62% 48%` | `42 62% 48%` → `42 72% 27%` | 2.431–2.628 → 6.061–6.554 on card stops |
| `--muted-solid` | `129 10% 62% / 0.7` | muted/70 → opaque `140 8% 38%` | 2.941–3.072 → 5.401–5.841 on card stops |
| `--loss-wash-ink` | `351 90% 64%` | loss `350 84% 62%` → `350 84% 41%` | 2.633–2.939 → 4.643–5.182 on direct/nested washes |
| `--gold-wash-ink` | `38 94% 58%` | amber `43 82% 33%` → `43 82% 27%` | 3.602–3.862 → 4.971–5.329 on washes |
| `--accent-nrl-ink` | `174 60% 40%` | `174 60% 40%` → `174 60% 28%` | 2.544–2.733 → 4.702–5.052 on NRL washes |
| `--pitch-accent-ink` | `84 78% 55%` | lime-deep `108 56% 27%` → `84 78% 55%` | 2.064–2.787 → 8.751–11.816 on pitch stops |
| `--pitch-loss-ink` | `351 90% 64%` | loss `350 84% 62%` → `351 90% 69%` | 3.768–5.088 → 4.613–6.229 on pitch stops |
| `--pitch-foreground-ink` | `120 14% 96%` | foreground `150 38% 9%` → `120 14% 96%` | 1.057–1.277 → 12.263–16.559 on pitch stops |
| `--pitch-muted-ink` | `129 10% 62%` | muted `140 8% 38%` → `129 10% 62%` | 2.281–3.080 → 5.266–7.110 on pitch stops |
| `--pitch-subtle-ink` | `0 0% 100% / 0.45` | white/45 → white/70 | 3.948–4.481 → 7.324–9.174 on pitch stops |
| `--pitch-chip` with `--pitch-muted-ink` | `144 19% 10% / 0.7` | light surface-2/70 + Daylight muted → invariant dark chip + pitch muted | 2.632–2.848 → 6.309–6.848 |

The crash page's fixed primary and button pairs did not need a colour change:
`#0f2117` on `#f6f8f3` is 15.709:1, and `#123723` on `#8fd633` is 7.413:1.

## Human review

All 18 P0 captures were checked at both widths for readable primary/muted copy,
chips, score labels, tables, unintended dark surfaces, horizontal overflow, and
clipping:

- `/`, `/matches`, `/match/[id]`, `/football/[comp]`,
  `/football/[comp]/fixtures`, `/football/[comp]/match/[id]`,
  `/football/[comp]/standings`, `/nrl`, and `/nrl/matches`: pass at 375×844 and
  1280×800.
- All 52 P1/P2 route-viewport captures and all eight state captures were also
  reviewed: no additional visual defect found.
- A fixed mobile navigation bar can appear mid-image in stitched full-page captures;
  this is Playwright stitching behaviour, not page displacement.

## Raw-colour guard allowlist

The TypeScript-lexer guard rejects raw hex colours in production `app`,
`components`, and `lib` paths except these documented fixed palettes:

| Path | Reason |
|---|---|
| `app/global-error.tsx` | Self-contained root crash boundary; global CSS is unavailable. |
| `app/embed/[matchId]/page.tsx` | Partner embed has an explicit fixed palette. |
| `app/layout.tsx` | Browser chrome and pre-paint boot values must be literal. |
| `app/manifest.ts` | PWA manifest colour is static by specification. |
| `components/AICalculationReveal.tsx` | CSS mask colour is alpha-only, not visible ink. |
| `components/AccountMenu.tsx` | Initials sit on invariant dark `bg-pitch`. |
| `components/ClubBadge.tsx` | Club and competition brand colours. |
| `components/EmbedPredictionCard.tsx` | Share card has an explicit fixed palette. |
| `lib/og.tsx` | Open Graph renderer has an explicit fixed palette. |
| `lib/theme.ts` | Browser theme-colour metadata requires literal values. |

No owner-forbidden component or fixed-palette route changed in this sweep.

## Floodlight comparison and baseline warnings

The baseline file was not regenerated: its SHA-256 remained
`23ea923813770a21ecb72643a92618bd973034c5644132d6ee225231f6787d37`.
The final 70-check Floodlight capture compared six sampled P0 style surfaces and
returned exactly:

```text
darkDiffs: []
darkStyleDiffs: 0
navigationFailures: 0
errorBoundaries: 0
```

The upgraded audit exits non-zero in Floodlight because it now sees 310 unchanged,
pre-existing declared-stop failures: P0 78, P1 202, P2 30. They occur on `/nrl`
(46), `/nrl/matches` (32), `/play` (80), `/tips` (80), football team (2), NRL match
(28), NRL team (12), `/nrl/origin` (2), and `/nrl/run-home` (28). It also records
6,042 endpoint-safe continuous-gradient exemptions. These findings are a separate
Floodlight remediation concern; this Daylight corrective sweep intentionally did
not redesign them.

The final frontend gate retains only known non-failing baseline notices: one
`react-hooks/exhaustive-deps` warning in `LiveMatchProvider.tsx:106`, Next lint and
multiple-lockfile notices, and existing React `act(...)` warnings in unrelated async
tests. No warning originates from a changed file.

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| 1. All in-scope routes legible at both widths | Met with documented manual review | 70/70 production checks and 70/70 screenshots reviewed; 8/8 forced-state checks and screenshots reviewed; no visual defect found. |
| 2. Body text at least 4.5:1 or exempt | Met with explicit exemptions | Zero measurable declared-stop failures. The 6,214 exact exemptions are retained in JSON: 6,213 continuous-gradient records and one URL-image record, all visually reviewed. |
| 3. Floodlight unchanged | Met | Preserved baseline SHA above; `darkDiffs: []`, `darkStyleDiffs: 0`. The 310 pre-existing Floodlight failures are reported separately and are not described as clean. |
| 4. New-token tests, including revert failure | Met | Focused tests assert exact Floodlight originals and tested Daylight surfaces. A targeted mutation of Daylight `--disabled-opacity-40` from `1` to `0.4` failed on the exact value assertion; restoring `1` passed all eight semantic tests, including the compact-control 4.5:1 checks. Earlier task reports retain the other RED/GREEN evidence. |
| 5. No new raw hex in themed paths | Met | Lexer-based guard passes with the fixed-palette allowlist above. |
| 6. Frontend gate | Met | Fresh fix-round run: typecheck exit 0; lint exit 0 with the documented baseline warning; Jest 145/145 suites and 943/943 tests passed in 45.567 s. |
