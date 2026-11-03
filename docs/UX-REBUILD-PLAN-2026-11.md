# FinalWhistle — UX rebuild plan (November 2026)

Status: ACTIVE (Phase 0 implemented, awaiting merge) · Branch: `fable/ux-rebuild` · Author: Claude (Fable 5.1) for Javo · Date: 2026-11-03

Evidence: six parallel audits (live screenshots at 390 px and 1440 px, information
architecture, core match flow, design system, code health, engagement loop) run on
2026-11-03 against the live site and `main` (9c1e2a3). Raw reports and 40 screenshots
are referenced in §9. Every "live" claim below was re-checked by hand with curl.

---

## 0. Verdict in one paragraph

**Do not rebuild from scratch. Rebuild the shell, the play loop and the match
centre on the stack we have.** The engine, data pipeline, auth, tips scoring, PWA
and native shell all work and are covered by 1,225 passing tests. What fails users
is not the visual design (Floodlight is coherent and attractive) but four things
that sit on top of it: the weekly play loop is broken in production, the navigation
model changes shape as you move around and is still anchored to a World Cup that
ended in July, the match page buries the one action we want (your pick) under four
copies of the same probability, and nothing brings anyone back. A from-scratch
rewrite would spend months re-creating what works and would not touch the real
causes. A focused rebuild of three surfaces, in four phases, does.

## 1. What the audits found (the short version)

### 1.1 Usage today (live `/api/retention`, 2026-11-03)
| Measure | Value |
|---|---|
| Devices since 19 July | 204 |
| Daily active devices, October | 0–4 |
| D1 retention, every cohort since mid-October | 0% |
| Season tip participants (EPL / La Liga / Bundesliga / NRL) | 4 / 0 / 1 / 3 |
| Leaderboards ever rendered a row | never (hidden below 10 participants) |

### 1.2 The loop is broken (all confirmed live)
1. **Play opens on a matchweek you cannot play.** The backend picks the matchweek of
   the earliest match still marked `scheduled`. Ghost fixtures from August (duplicate
   team rows: `Getafe`×2, `Malaga`×2, `SV Elversberg`/`SV 07 Elversberg`) are still
   `scheduled`, so EPL opens on MW9 (all played), **La Liga on MW2, Bundesliga on
   MW1**. A La Liga fan sees only locked games and has to tap "next" about ten times.
   The health endpoint has been reporting these 20 stale rows for weeks.
2. **The most visible pick does not count.** "Make your pick" on every competition
   home leads to a home/draw/away pick stored only in `localStorage`
   (`lib/useMatchPicks.ts`). It is never scored or ranked. The game that does count
   (scoreline tips, 5 pts exact / 2 pts result) lives only under `/play`.
3. **Leaderboards are always empty.** `_LEADERBOARD_MIN_PARTICIPANTS = 10` in both
   tips APIs; the biggest board has 4 players.
4. **No reason to come back.** No push, email digest or Telegram reminder; no results
   recap; no single "my picks" view; favourites are names in browser storage read by
   one World Cup page.

### 1.3 Navigation and stale state (confirmed live)
- The bottom bar swaps between **three different tab sets** (platform pages, football
  competitions, NRL). "Home" means two things. "You" opens the finished World Cup
  bracket leaderboard ("No public brackets yet").
- `DEFAULT_COMPETITION = "wc26"`: `/tips`, `/record`, `/retention`, auth pages all show
  World Cup tabs. `/tips` shows Premier League tips with WC26 chrome.
- `/match/:id` (the embed backlink, every share since June, the default card link)
  308s to `/football/wc26/match/:id` and lands on a blank soft-404 for any club match.
- `/football/epl/bracket` serves the World Cup bracket. `/nrl/leaderboard` serves the
  World Cup bracket leaderboard. `/football` is a 404.
- `/nrl` promotes the 4 October Grand Final as "Tonight's feature · Make your pick".
  The manifest and root share image describe a Champions League bracket. `/retention`
  (showing 0% D1) is public and indexable.

### 1.4 Match centre and fixtures
- The predicted score (`1–0`) sits in the real-score slot at 40 px, captioned "most
  likely score"; on finished matches the real score takes the same slot.
- The win/draw/away bar is drawn up to **four times**, the predicted score three
  times, plus a confidence ring. On a 390 px phone the fold lands inside the second
  copy. "Your prediction" is the eighth block down.
- Honesty gaps: "KO" axis label before kickoff; "Full time" inferred from stale
  `in_play`; estimated live minutes shown as exact; "Model updated" can show a global
  timestamp; the World Cup hub still runs a fake 3.4 s "AI calculating" animation.
- "Why X?" lists reasons that argue **against** the pick with a green "+" (reasons
  carry no polarity).
- **Mobile standings table is broken**: numbers render over team names at 390 px
  (EPL table and NRL ladder). Desktop is fine.
- NRL and football match pages, fixture lists, heroes and "why" sections are forked
  code with different designs. Every finished NRL row shows a "90 MIN" chip.

### 1.5 Design system and engineering
- Tokens are used (~94% of colour refs) but the set has drifted: 33 colour tokens,
  59 token+opacity combos, 26 button styles, 11 LIVE indicators, 17 `<h1>` recipes,
  4 different "black" backgrounds across web / OG / icon / Capacitor.
- Light theme: ~46 text uses below AA (`text-loss` 3.5:1, `text-gold` 2.6:1,
  `text-win` 1.8:1). Dark: LIVE pill and ConfidenceBadge Low at 4.4:1.
- `npm audit`: 4 critical / 5 high (next < 15.5.28 RCE advisory, Capacitor < 8.4.3,
  Sentry < 10.77); CI runs `npm audit || true`.
- Sentry has no DSN in production, so client errors are not captured.
- Every `/football/[comp]/*` route is dynamic, `private, no-store`, 0.45–0.85 s TTFB.
- The match page ships 240 kB because recharts renders a sorted bar list.
- Three fetch helpers; `useFetch` polls every 30 s in hidden tabs; raw error strings
  reach users.

### 1.6 What is good and must be kept
Floodlight palette and type; the hub hero card; reveal-the-model-after-you-pick;
anonymous play with one `TipPlayer` identity across sports; "Called it / Model
missed" verdicts; the honest-caveat copy; methodology's calibration evidence; the
NRL post-match stats; share pages with OG images; the service-worker app shell.

## 2. Principles for the rebuild

1. **One shell.** The same five tabs in the same order on every route. Only the
   competition scope changes, and it is always visible and one tap from switching.
2. **The pick is the product.** Every "make your pick" leads to the scored game. The
   pick sits directly under the model's call. The loop closes with points, a recap
   and a share.
3. **Say each thing once.** One hero, one labelled call, one "why". No repeated bars.
4. **Honest time and honest labels.** LIVE, FT and KO only when confirmed. Estimates
   say "est.". Every timestamp names its subject and zone.
5. **Sport differences live in adapters and config, not forked pages.**
6. **Archive, don't delete.** WC26 keeps its URLs and its record, under "Past
   tournaments". Nothing that was shared stops resolving.
7. **Ship behind measurement.** Sentry on, Web Vitals on, an event taxonomy for the
   loop, before and after.

## 3. Target experience

### 3.1 Navigation
Mobile bottom bar and desktop link row, identical on every route except `/embed`,
scoped to the **current competition**:

| # | Label | Destination |
|---|---|---|
| 1 | Home | `{compBase}` (competition overview) |
| 2 | Fixtures | `{compBase}/fixtures` (NRL: `/nrl/matches` until the slug move) |
| 3 | Table / Ladder / Groups | `{compBase}/standings` (NRL `/nrl/ladder`, WC26 `/groups`) |
| 4 | Play | `/play?competition={comp}` (NRL `/nrl/tips`) |
| 5 | My picks | `/leaderboard?competition={comp}` (your record vs the model, leaderboard, settings) |

Judgment call: the fifth tab is **My picks**, not **Record**. The product's loop is
"beat the model", so the user's own standing earns the tab; the model's record is
one tap away on the competition home, the Play header and the avatar menu. Phase 2
adds a per-competition Record page and revisits this.

The **competition chip** (crest + caret) appears in the header on every route,
including `/`, `/play` and `/leaderboard`. The switcher shows Football · Rugby league
· Past tournaments; its star means "Set as default" and writes an `fw_comp` cookie
the server can read. Current competition resolves: URL → `fw_comp` cookie → country
(AU/NZ → NRL) → EPL. Never WC26.

### 3.2 First run (new device, lands on `/`)
Above the fold: "Beat the model at the Premier League" with a chip row to switch
league, a live line ("Matchweek 11 · 10 fixtures · locks Fri 20:00 · model this
season: X% winners"), and the next fixture as a real card with the model's win
probability and a score stepper. **No decisions before the first pick.** After the
pick: "You 2–1 · Model 1–1 · 9 more this week →".

### 3.3 Returning (device has picks or a default competition)
`/` becomes "Your week": open picks across followed competitions ordered by kickoff
with the deadline, the last graded matchweek as a recap card (You N – Model M · rank ·
streak · Share), and the model's record line. The "Football" and "Home" tabs land on
the user's competition, not EPL by default.

### 3.4 Match centre (both sports, one component set)
Order: top bar (← Fixtures · "EPL · Matchweek 11" · Share) → **MatchHero** (status line,
crests, "vs" or the real score, venue; inside it the **model's call**: one sentence,
one labelled bar that sums to 100, chips for most-likely score and confidence tier)
→ **Your pick** (the scored game: scoreline stepper for leagues, winner + margin for
NRL, W/D/L for knockouts; lock time; after FT, your points) → **Why** (for/against by
team, model inputs behind a disclosure) → Forecast & market (only with history) →
Goals & scorers → Lineups → footer with this match's own timestamp. A sticky section
index replaces the Overview/Lineups tabs. Mobile ASCII wireframe: audit
`match-flow.md` §6.3.

### 3.5 Fixtures (one view for both sports)
Group by round then day; rows show time only, labelled probability triple with
short codes, and a **my-pick chip** (✓ 2–1 or "Pick"); ★ My teams filter; smart
default tab (Live → Upcoming → Results, so the off-season never opens on an empty
tab); poll only while something is live or within 10 minutes of a kickoff.

## 4. Phased plan

Effort: S ≤ 1 day · M 2–5 days · L > 1 week (Claude-compressed, calendar time is less).
Each phase is a PR or a small set of PRs behind the stop gate.

### Phase 0 — Unbreak the loop and the leaks (SHIPPED on `fable/ux-rebuild`, PR pending)
Backend
- [x] `_current_matchweek` / `_current_round`: ignore `scheduled` rows whose kickoff is
      in the past (status lag or ghost); choose the earliest matchweek with an
      in-play or not-yet-kicked-off match; fall back to the latest played. Tests. (S)
- [x] `_LEADERBOARD_MIN_PARTICIPANTS` → 1 in both tips APIs, and the model is always
      a ranked row (`is_model: true`) so one player still gets "You #1 of 2". (S)
- [x] `competition` field on match summary and team profile responses so the
      frontend can resolve `/match/:id` and `/team/:id` to the right competition. (S)
- [ ] (NOT in this PR, stop-gated) Pipeline follow-up (separate PR, stop-gated because it touches prod data):
      dedupe the ghost fixtures and team aliases; fail the refresh when any
      `scheduled` row is > 3 h past kickoff. (S)

Frontend — navigation and leaks
- [x] One template-driven 5-tab bar (§3.1), icons looked up by id, chip on every route. (M)
- [x] `DEFAULT_COMPETITION` → `epl`; `fw_comp` cookie + geo default; middleware writes
      the cookie on competition routes; overlay star = "Set as default". (S)
- [x] `/match/:id`, `/team/:id` become competition lookups (redirect to the right
      `/football/{comp}/…`, WC26 fallback), replacing the static redirects. Default
      card/hero/embed links use `footballMatchHref()`. (S)
- [x] `/football/{comp}/bracket` and `/groups` 404 unless the competition has them;
      `/nrl/leaderboard` renders the NRL board; `/tips` → `/play`; `/leaderboard`
      defaults to the current competition; `/football` hub page; `/retention` noindex. (S)
- [x] Competition overlay: focus trap, labelled star, no repeated codes. (S)

Frontend — the loop
- [x] Picker safety net: if the loaded matchweek has no pickable match, jump to the
      next one and say so. (S)
- [x] League match pages get the **real scoreline pick** (`POST /tips/submit`) under
      the model's call; browser-only W/D/L retired for leagues (kept for knockouts). (M)
- [x] Leaderboards render the model row; weekly/season boards never hide. (S)
- [x] Tips submit counts as engagement (install prompt); device claim runs on every
      sign-in from `AuthProvider`. (S)
- [x] Stale state: NRL off-season home ("2026 season complete · back March 2027 ·
      play EPL meanwhile"); manifest/OG/install-prompt copy platform-neutral; World
      Cup under "Past tournaments" in Play and the switcher; `RetentionBridge` and the
      fake "AI calculating" reveal removed; EPL hub "Also on" shows the current window. (S)

Frontend — match centre honesty (P0 subset of §3.4)
- [x] Predicted score out of the real-score slot; one labelled bar summing to 100;
      ring → tier chip; "KO" → "Latest · date" before kickoff; "Result pending"
      instead of inferred FT; estimated minutes say "est."; this match's own
      `generated_at`; NRL `stage` fix (no "90 MIN" on every row); postponed mapped
      through. (S–M)

Frontend — visual and platform quick wins
- [x] Mobile standings/ladder table layout fix. (S)
- [x] Contrast: ConfidenceBadge Low → muted; LIVE wash ink; daylight `text-loss` /
      `text-gold` / `text-win` → ink variants; no `text-muted/50`. (S)
- [x] Forms: visible labels and `role="alert"` on auth/reset; focus trap on
      DeleteAccountModal; toast above the tab bar. (S)
- [x] Security bumps (next 15.5.28, Capacitor 8.6, Sentry 10.78, sharp) and a real
      `npm audit --audit-level=high` gate in CI. (S)
- [x] Sentry capture in `error.tsx` / `global-error.tsx` + `instrumentation.ts`; Web
      Vitals via `@vercel/speed-insights`; loop events (`tips_submit`, `pick_submit`,
      `competition_switch`, `recap_viewed`, `share`). (S)
- [x] recharts off the critical path (CSS bars for feature importance; dynamic
      CalibrationChart). Match page 240 kB → ~130 kB. (S)
- [x] Capacitor: suppress the install prompt in the native shell; background colour
      = `#0a1410`. Service worker: 4 s network timeout with cache fallback, bounded
      caches. (S)
- [x] ISR on `/football/[comp]/fixtures|standings|team|match` (`revalidate` 60 s). (S)

Acceptance: La Liga/Bundesliga Play opens on the current matchweek; a club match
shared as `/match/:id` resolves; the same five tabs on `/`, `/play`, `/football/epl/…`,
`/nrl/…`; a scoreline pick submitted from an EPL match page appears in `/play` and on
the leaderboard with the model row; mobile table readable; `npm audit` clean at high.

### Phase 1 — Stable shell, finished (1 week)
- `/profile` (picks and record per competition, following, settings, account) and
  the avatar menu; `/leaderboard` → `/profile`.
- Unified slugs: `fixtures`, `table`, `record`, `play` under every competition;
  `/nrl/matches` → `/nrl/fixtures`, `/nrl/ladder` → `/nrl/table`; redirect table in
  audit `ia-nav.md` §6.5; sitemap, canonicals and OG routes move together; `/about`
  folds into `/methodology`.
- Move shared page implementations out of `app/match`, `app/matches`, `app/groups`,
  `app/team`, `app/brackets` into `features/`; delete shadowed legacy pages and the
  dead `SPORTS` registry.
- Copy: one canonical label per concept (`ia-nav.md` §6.4): "the model" in body copy,
  "Beat the model" as the game name, "La Liga" with a space, one title format.

### Phase 2 — Core loop and match centre (2–3 weeks)
- `MatchHero`, `MatchWhy`, `ForecastCard`, `GoalsCard`, `MatchPick` (sport adapters);
  section index; `MatchLiveProvider` shared by hero and pick so pickability flips
  at kickoff without reload. NRL match page moves onto the same skeleton.
- `FixturesView` shared by both sports with my-pick chips, ★ My teams, smart default
  tab, live-gated polling; `MatchCard` split into `FixtureRow` and `MatchSummaryCard`;
  favourite star out of the link.
- `GET /api/tips/me`: open picks across competitions, deadlines, graded recaps,
  rank, cross-sport streak. `/` becomes "Your week" for returning devices; first-run
  home per §3.2.
- Club-league model record (`/football/{comp}/record`, `model_record` filtered by
  ledger) shown in the picker header and after each pick.
- Results recap card with Share as the primary action; Telegram/WhatsApp share
  targets; share-page CTA back into the open matchweek.
- Follow clubs and leagues (`{competition, team_id}`), picker orders followed clubs
  first; sign-up prompt after the third pick; editable handle (`PATCH /api/tips/me/handle`).

### Phase 3 — Design-system consolidation, accessibility, performance (2 weeks, can overlap)
- `design/tokens.json` → `globals.css` + `tailwind.config.ts` + `lib/tokens.ts` so OG,
  embed, icon, manifest and Capacitor share one palette; legacy names aliased.
- Semantic families: outcome (home/draw/away), result (win/draw/loss), status
  (live/upcoming/final/halted), confidence, delta, feedback, highlight. Type scale
  24 → 8 steps + 4 numerals with line-heights; 11 px floor; radii 11 → 5.
- Primitives, in migration order: Icon, TeamCrest, Pill/StatusPill,
  ConfidenceIndicator, ProbabilityTriplet/Meter, Button/IconButton; then Card,
  Section, PageHeader, SegmentedControl, Empty/Error/InlineNotice, Skeleton; then
  TeamRow, Stat and the feature merges (Leaderboard, YouVsAi, ClaimDevice, FormStrip).
- Lint guardrails (no arbitrary colour/spacing, no raw palette, no `text-*/alpha`),
  a `/dev/primitives` page with an axe + contrast snapshot in CI.
- One data layer (`request()` with timeout and typed errors; `useFetch` with stale
  time, hidden-tab pause, live-gated polling); generated API types from
  `/openapi.json`; Next 16 + ESLint flat config before the sweep; Tailwind 4 with it.
- Decisions that need Javo's eye first: draw colour amber → neutral; wider desktop
  grid; Capacitor safe-area strategy; one name for the model.

### Phase 4 — Reach (after Phase 2 lands)
- Telegram reminder bot (the channel marketing already uses): Friday "7 open picks,
  locks 20:00", Monday "You 12 – Model 9". `tip_player_channels` table, cron. (M)
- Weekly email digest once a real domain exists and is verified for sending. (M)
- Web push (PWA + Capacitor), which the store listing also needs. (L)
- Friends leagues (`tip_groups`, invite link, group board). (M–L)
- Domain + store re-skin for club leagues; the `fifa-wc26-prediction` origin cannot
  anchor a brand, send email, or be renamed without a native release. (L, mostly
  non-engineering)

## 5. Engineering notes

- **Builder/reviewer lane** per CLAUDE.md: Opus builds, a fresh Opus reviews, Fable
  for architecture and anything stop-gated.
- **Tests** are the gate: `make test`, `npm run typecheck && npm run lint && npm test`.
  Phase 0 adds backend tests for matchweek resolution, leaderboard reveal and the
  competition field; frontend tests for nav scoping, lookup redirects, the picker
  safety net, the match-page pick and table layout.
- **Caching**: ISR + `revalidate` on competition routes; the client keeps polling
  live summaries. Watch `x-vercel-cache` after deploy.
- **Migrations**: none in Phase 0. Phase 2's `tip_player_channels` and follows need
  the `refresh.yml` sequence (migration first, then code).
- **Native shell** loads the live origin, so every nav change reaches installed apps
  on deploy; run the 390 px QA sweep inside the shell before each release.

## 6. Metrics (instrumented in Phase 0, read weekly)
- First visits with ≥ 1 scored pick in-session.
- Picks per active player per matchweek.
- Week-over-week return rate (device present in consecutive matchweeks).
- D1 / D7 by device (existing `/api/retention`), reminder opt-in, shares per recap.
- Core Web Vitals per route; match page JS ≤ 150 kB.

## 7. Decisions for Javo
1. Fifth tab: **My picks** (recommended, implemented) vs **Record**.
2. Slug for standings: keep `standings` (EPL pages have SEO since August) vs move to
   `table` everywhere. Recommended: keep `standings`, apply it to NRL and WC26 too.
3. Draw colour amber → neutral grey (frees amber for "upcoming"/"warning").
4. The World Cup "bridge" email list promised one mid-August email: send one honest
   "your league has started" email, or delete the list.
5. Keep-warm for the Render API (cron ping is free; a paid instance is a spend).
6. Domain purchase, which also unblocks email reminders and the store re-skin.
7. "First pick reveals the model's scoreline" is now cosmetic on league match pages,
   because the hero chip (and fixture cards) already show the most likely score.
   Either hide the chip until the user picks, or drop the reveal framing.
8. Ghost fixtures (duplicate team rows) still sit in the database: the API and the
   picker now ignore them, but standings/health need the stop-gated pipeline dedupe.

## 8. Sequencing and ownership (this branch)
Five parallel tracks, each with exclusive file ownership, each running its own
tests and committing only its own paths:
- **A** backend loop fixes · **B** navigation and routing · **C1** match centre
  honesty + real pick · **C2** play loop, leaderboards, stale state · **D** visual,
  a11y, security, perf, PWA.
Then a fresh-context review, the full test gate, and a PR with this plan.

**Outcome (2026-11-03):** all five tracks landed; two fresh-context reviews
(backend/routing/SW and match-centre/loop/visual) found no blockers, 5 Highs and
8 Mediums, all fixed on the branch (notably: the model's leaderboard row now
waits for human grading and picks grade in the post-results chain; an archived
competition is never persisted as the default; ISR-cached match pages re-ask for
a result; the render clock is shared between server and client; tips resolve to
the signed-in account on every device). Gate at HEAD: backend 859 passed; frontend
typecheck + lint clean, 1,930 jest tests passed, `npm audit --omit=dev
--audit-level=high` clean, production build green with `/football/[comp]/
{fixtures,standings,match,team}` as ISR; match page 240 kB → ~148 kB first-load JS.
Pre-existing failures in `pipeline/run_calibrator_benchmark_test.py` reproduce on
a clean `main` and are untouched here.

**Deploy sequencing note:** the frontend's `/match/:id` and `/team/:id` lookups
read the new `competition` field; until the Render backend is deployed they fall
back to a temporary (307) WC26 guess, so deploy or let both auto-deploy from
`main` together and verify `GET /api/matches/198/summary` carries
`"competition": "epl"` before trusting the lookups.

## 9. Evidence
Audit reports (local, not committed): `scratchpad/audit/{live-ux,ia-nav,match-flow,
design-system,code-health,engagement}.md`, `shots/*.png` (40 screenshots, mobile
and desktop, with `-fold` crops), `crops/epl-standings-zoom.png`,
`crops/nrl-ladder-zoom.png`. Prior heuristic audit: `DESIGN-IS-2026-09-09/`
(13 of its 14 items were still open on 2026-11-03; this plan closes them).
