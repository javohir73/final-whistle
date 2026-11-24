# UFC section — design

Status: draft for the owner's approval, 2026-11-25. Nothing in this document is built.
Evidence for the data choices lives in a spike outside the repo (`~/Projects/fw-ufc-spike`, README there).

## 1. Intent

Add UFC as FinalWhistle's third sport, after football and NRL. A visitor opens the next
fight card, picks a winner for each bout, and only then sees what the model thinks and
why. During the card the page follows each bout live. Afterwards every pick and every
model call is graded in public.

Why UFC: a card almost every week all year, a fan base that already plays pick'em, and
a gap in what exists. Three prediction sites and several pick'em apps were reviewed on
2026-11-25. None of them updates during a fight, none grades forward-only picks against
the betting market, and the one with the largest stated hit rate (82%) publishes no
calibration. FinalWhistle's existing habits (pick, then reveal; a plain-English why; a
public record) are the differentiator. We are not inventing a new product for UFC; we
are bringing the existing one to a sport where nobody does it this way.

## 2. Goals, non-goals, anti-goals

Goals
- A `/ufc` section that feels like the rest of the site: same layout, same components,
  same pick-then-reveal rule.
- A winner probability for every bout on a UFC card, with reasons in plain English.
- A picks game per card with a leaderboard, playable without an account (same device-id
  identity as NRL tips).
- Live card mode: which bout is on, round, clock, and each result as it lands.
- A public record page: the model's graded calls, its calibration, and how it compares
  with the betting market on the same fights.

Non-goals (this design)
- Other promotions (PFL, ONE, Bellator). Contender Series bouts are stored because they
  feed fighter ratings, but they get no card pages.
- A probability that moves during a fight. Decided after the two live recordings
  (section 9); not promised here.
- Prop markets, parlays, fantasy salaries, push notifications, fighter news.
- Any change to football or NRL tables, endpoints or pages.

Anti-goals (would make it a failure even if it works)
- Showing a model number before the model has passed its gate, or showing an accuracy
  claim that is not forward-only and reproducible.
- Leaking the model's call for an open bout to someone who has not picked.
- A UFC page that breaks or shows stale "live" data silently when the feed fails.
- Looking like an official UFC product, or reading like a tipping service for bettors.

## 3. Constraints

- Free data. The owner chose the free route on 2026-11-25. The source is ESPN's public
  JSON feeds: undocumented, unlicensed for this use, liable to change or block.
- Repo rules (`CLAUDE.md`): stop gate before production, money, destructive or outward
  actions; migrations reach the production database through `refresh.yml` before the
  code that needs them; the repo is public.
- A new vertical is additive: do not modify football or NRL files beyond the shared
  registries listed in section 8 (recipe from `docs/superpowers/plans/2026-07-09-nrl-vertical.md`).
- Models ship shadow-first and predictions are append-only and frozen at lock, as for
  football and NRL.
- No secrets live on the Mac mini. The ESPN feeds need none.
- "UFC" is someone else's trade mark and fighter photos are someone else's property.

## 4. Approaches considered

### 4.1 Where the data comes from

| Option | What it gives | Cost | Why / why not |
| --- | --- | --- | --- |
| **ESPN public feeds (chosen)** | Cards, bout order, weight class, live round and clock, winner, method, ~42 fight stats per fighter, judges' scores, a bookmaker moneyline in recent years, every event since 1993, fighter date of birth, height, reach, stance | Free, no key | One source for history and live, so one set of ids. Unlicensed and undocumented: must sit behind a swappable provider |
| UFCalendar API | Same breadth plus round-by-round stats and result webhooks; terms allow commercial display | US$19–49 a month | The fallback if ESPN blocks us. Its publisher is also a competitor |
| balldontlie | Fights, totals, per-bookmaker odds | US$10–40 a month | No round data, no published display terms |
| Sportradar / SportsDataIO | Official strike-by-strike | Quote only | Out of reach for now |

Checked on 2026-11-25: ESPN returned the 5 Dec card (14 bouts), the full result of the
21 Nov main event (KO/TKO, punch, round 2, 4:58), stats for a finished bout, and events
for every sampled year from 1993 to 2026.

### 4.2 How a fight is stored

| Option | Trade-off |
| --- | --- |
| Reuse `sport_matches` / `sport_predictions` with `sport="ufc"`, fighters as `sport_teams` | Gets predictions, grading and tips tables for free. But the shape is a team match: home/away, integer scores, a three-way `p_home/p_draw/p_away`, an identity of `(season, round, match_no)` that a reshuffled card breaks, tips graded on margin. Every UFC rule would be an exception inside NRL code |
| **Dedicated `ufc_*` tables, shared identity only (chosen)** | Clean fit: event → bouts, two fighters, method, round, time, cancellations and replacements. Zero risk to football and NRL. Costs a second, small grading module. Reuses `tip_players` so one person is one player across sports |
| Generalise the sport tables first, then add UFC | The right end state, and the NRL plan deferred it "until two sports exist to generalize from". Doing it now would put a refactor of live NRL code in front of the feature |

### 4.3 When picks lock

| Option | Trade-off |
| --- | --- |
| Whole card locks at the first bout | Simple, cannot be gamed. Someone arriving for the main card can no longer pick it |
| Each bout locks when the feed says it started | Friendliest. But the lock would depend on a feed whose delay we have not measured; a pick could land after the opening bell |
| **Each bout locks at its scheduled time in the feed, which is its card segment's start; and immediately if the feed shows it live or finished (chosen)** | The main card stays open through the prelims. A segment never starts before its broadcast time, so the clock rule is safe on its own, and the feed rule only ever locks earlier |

Lock details. A bout's lock time is its scheduled time in the feed. If every bout on a
card carries the same time, they all lock then. If the feed moves a scheduled bout's
time, the lock moves with it, earlier or later, until the bout locks. Once a bout has
locked, by the clock or because the feed showed it live, it never reopens. The 5 Dec
2026 card carries two times (prelims 15:00 UTC, main card 18:00 UTC), which match its
two segments; older events in the feed carry one time for the whole card.

## 5. The product

### 5.1 Pages

| Route | Job | Key content |
| --- | --- | --- |
| `/ufc` | The next card. The section's home | Event name, local start time, countdown to the next lock; bouts grouped Main card / Prelims / Early prelims; a pick control on every open bout; rail: your picks for this card, the model's record, upcoming cards |
| `/ufc/event/[slug]` | Any card, in any state | Same body as `/ufc`. Upcoming: pick. Live: live strip at the top. Finished: results, your score, the model's score |
| `/ufc/fight/[id]` | One bout | Hero with both fighters; pick control; the model's call (after the reveal rule allows); tale of the tape; the market; after the fight: result, method, fight stats, judges' scores |
| `/ufc/fighter/[slug]` | One fighter | Record, age, height, reach, stance, rating and its history, every UFC bout with result and the model's call |
| `/ufc/events` | Schedule and results | Upcoming cards, then past cards by month |
| `/ufc/rankings` | The model's ratings by division | Our own ratings, labelled as such. Not the official rankings |
| `/ufc/picks` | Play the current card in one pass | One bout per step, summary and share at the end |
| `/ufc/leaderboard` | Players | This card, and the calendar year |
| `/ufc/record` | The model in public | Graded calls, hit rate, Brier score, calibration table, model versus market on the same fights |

Navigation tabs for the sport: Card, Events, Rankings, Picks, Leaderboard, Record.

Anything that is model output (the call, ratings, the rankings page, a fighter's rating
history, the record page) appears only once a model is public. Until then those tabs and
blocks are absent, not empty.

### 5.2 The states of a bout

`scheduled → locked → live → finished`, plus `cancelled` and `changed`.

| State | What the visitor sees | Pick | Model call |
| --- | --- | --- | --- |
| Scheduled, not picked | Fighters, weight class, scheduled rounds, lock time | Open | Hidden |
| Scheduled, picked | Their pick, editable until lock | Open | Shown to this player only |
| Locked | "Picks closed" | Closed | Shown to everyone |
| Live | Round and clock, "Live" chip | Closed | Shown |
| Finished | Winner, method, round, time; their pick right or wrong | Graded | Graded |
| Draw or no contest | Result as it is | Void: no points for anyone | Void: not counted in the record |
| Cancelled | Struck through, "Bout cancelled" | Void | Void |
| Changed (an opponent was replaced) | New bout; a note says the earlier bout was replaced | Earlier picks void; new picks open until lock | New prediction |

### 5.3 The picks game

- One pick per bout: the winner (required) and how they win (optional): KO/TKO,
  Submission or Decision.
- Scoring: 1 point for the winner. 1 bonus point for the method, only when the winner is
  right. A disqualification win counts for the winner and for no method.
- Card leaderboard ranks by points, then correct winners, then earlier final pick time.
  The year leaderboard sums cards.
- You versus the model compares winners only (your correct winners against the model's),
  because the model has no method pick until phase 6. Your method bonus is shown as
  yours alone.
- On leaderboards the model is a reference line labelled "FinalWhistle model", showing
  winner points, not counted as a participant and not ranked. It becomes a ranked row,
  as on the NRL boards, once it makes method picks.
- Identity and submission follow `backend/app/api/nrl_user_tips.py`: a device id creates
  the `tip_players` row, an account is an optional later claim, the server clock decides
  the lock, with the same same-origin check and rate limit. As in NRL, a pick can be
  changed until lock even after the model's call has been revealed to that player.
- No prizes, no entry fee, no bookmaker links.

### 5.4 Reveal rule

The existing rule in `frontend/lib/reveal.ts` applies unchanged in meaning: on an open
bout the model's call stays hidden until the viewer has a locked pick for that bout;
once the bout is locked, live, finished or cancelled, everyone sees it. UFC adds a pick
game id (`ufc_picks`) and maps its states onto the rule.

For UFC the rule is also enforced on the server from day one (section 8.3): public
endpoints never carry model fields for an open bout. The frontend rule then decides
presentation, not secrecy.

The market's implied chance is treated exactly like the model's call: hidden on an open
bout until the viewer has picked it, and stripped by the same server function. It would
anchor the picker just as the model does, and one rule is simpler than two.

### 5.5 Look and feel

Direction G, unchanged: white ground, ink text, the deep-green brand colour, 16px card
radius, 1px lines, no shadows, Instrument Sans, existing `components/ui` primitives.

- The bout row is the fixture row with different words: fighter | mark | time or result
  | mark | fighter. `FixtureRow` already takes arbitrary `crest`, `centre` and `right`
  nodes, so it is reused as is.
- No photos and no UFC logo. A fighter's mark is their national flag (the existing flag
  component) or, where no flag exists, a monogram disc. The section's label is the
  plain text "UFC".
- Result box: where football shows `2–1`, a finished bout shows the method and round,
  e.g. `KO R2` or `DEC`, in the ink box, with the winner's name in the weight it has in
  football for the winning side.
- The method pick is a three-way `Segmented` control under the winner pick.
- Times are the viewer's local time, lower-case, as the kickoff helper already prints
  them. A card is labelled by the viewer's local day.
- Phone first: every screen is designed at 390px and checked at 1024 and 1440, as the
  redesign was.
- Words: "bout" in data and code; "fight" in everything a visitor reads.

## 6. The model

- `ufc-elo-v0.1`: an Elo rating per fighter over every stored bout since 1993, giving a
  winner probability for each bout. Two outcomes only; draws and no contests are void.
- Fitting uses recent years (the last ten or so); ratings use the full history so a
  veteran is not treated as a debutant. The training window is chosen by test on a
  2022–2026 holdout, not by assumption. Results of that test are appended to the spike
  when the history download finishes.
- `ufc-form-v0.2` (later): logistic model on top of the rating: age gap, reach gap,
  layoff, recent form, striking and grappling differentials. Every feature must be
  computed from fights strictly before the bout; career averages are the classic leak.
- Method probabilities (later): KO/TKO, Submission, Decision from weight class,
  scheduled rounds and both fighters' finishing history.
- The "why": templated sentences from the largest factors, as `preview_text` does for
  NRL. No generated prose.
- `is_shadow` keeps the meaning it has elsewhere in the repo: a row the public pages
  never read. Which model is public is one setting, `UFC_PUBLIC_MODEL` (empty means
  none), so going public is a configuration change and needs no data rewrite.
- The public record counts every call the public model made at or before a bout's lock,
  including calls it made while still in shadow, and states the date counting began.
  Backtest figures are shown apart from it and labelled as a backtest.
- Shadow first. A model goes public when, on walk-forward evaluation, it beats both
  "pick the higher-rated fighter at 50/50 confidence" and a coin flip on log loss in two
  of the three most recent years, and two live cards have been predicted before lock
  and graded clean. Going public is a stop-gate decision.
- The market is the benchmark, not the opponent to beat. The record page shows model
  and market side by side on the same fights. A model that is honestly a little worse
  than the market is publishable; a model with an inflated record is not.

## 7. Live

- Trigger: `ufc-live-refresh.yml` copies `nrl-live-refresh.yml`: a cron every 15
  minutes through Saturday and Sunday UTC, each run polling about once a minute by
  POSTing `/api/internal/ufc-refresh-live` with the recompute token, and exiting at once
  when the server reports nothing live or within 45 minutes. The repo is public, so the
  idle runs cost nothing. A card outside the weekend needs the dispatch below.
- GitHub starts this repo's scheduled runs late and drops some, so the workflow also
  takes `workflow_dispatch`. The scheduler that already runs on the Mac mini (outside
  the repo, using the mini's existing `gh` login, no new secret) dispatches it during a
  card's window, as it does for the NRL live workflow.
- The endpoint asks the provider for the card's one-call scoreboard, then for status
  (and stats) of the bout in progress and of bouts finished in the last 30 minutes,
  and writes `ufc_live_state`. About one to five upstream calls per poll.
- Pages poll `/api/ufc/events/{id}/live` every 20–30 seconds while a card is live, as
  the NRL `LiveMatchProvider` does.
- A finished bout is graded on the spot (result, picks, model) and re-checked by the
  next daily refresh, which is the authority.
- Stale rule: if the last successful poll is older than 5 minutes during a card window,
  the live strip says "Live updates are delayed" with the time of the last update, and
  the page keeps the last known state. No spinner, no silent freeze.
- A live in-fight probability is a separate, later decision (section 9).

## 8. Technical design

### 8.1 Data model (one additive migration)

| Table | Holds | Notes |
| --- | --- | --- |
| `ufc_fighters` | name, slug, date of birth, height, reach, stance, country, rating, provider id | Unique on `(provider, provider_fighter_id)` |
| `ufc_events` | name, slug, first and last bout time, venue, status, provider id, `is_card` | `is_card=false` for Contender Series |
| `ufc_bouts` | event, order on card, segment, weight class, scheduled rounds, title flag, fighter A and B, lock time, status, winner, method, method detail, end round, end time, provider id, `replaced_by` | Unique on `(provider, provider_bout_id, revision)`, never the order on the card. `revision` starts at 0. If either fighter changes on a provider bout id, the current row is closed as `changed` and a new row is created with the next revision. Whether ESPN reuses the bout id on a replacement is not known; this key is right either way |
| `ufc_bout_stats` | per bout per fighter totals, judges' totals | Written after the bout |
| `ufc_odds_snapshots` | bout, source, both prices, taken at | Append-only |
| `ufc_predictions` | bout, model version, `p_a`, `p_b`, method probabilities (nullable), reasons, `is_shadow`, created at | Append-only. The row that counts is the latest one created at or before the bout's lock time |
| `ufc_prediction_results` | prediction, winner correct, probability assigned, log loss, Brier | Written by grading |
| `ufc_picks` | bout, player (`tip_players.id`), winner side, method (nullable), created, updated, points (nullable until graded) | Unique `(bout, player)`. Rejected at or after lock by the server clock |
| `ufc_live_state` | bout, state, round, clock, updated at, source time | One row per bout, overwritten |

"A" and "B" are the provider's listing order. The order is not neutral (the bigger name
tends to come first), so nothing may learn from it; the model input is symmetrised.

### 8.2 Pipeline (`pipeline/sports/ufc_*`, `ml/sports/ufc/`)

- `ufc_provider.py`: a `UfcProvider` protocol (`list_events`, `fetch_event`,
  `fetch_bout_result`, `fetch_bout_stats`, `fetch_fighter`, `fetch_live`, `fetch_odds`),
  an `EspnUfcProvider`, and a `RecordedUfcProvider` that replays files. The spike's raw
  downloads and live recordings become the test fixtures. Chosen by `UFC_PROVIDER`
  (default `espn`), as `LEAGUE_FIXTURE_PROVIDER` chooses the football source.
- `ufc_ingest.py`: upcoming cards and changes; `ufc_results.py`: results, stats, judges;
  `ufc_backfill.py`: one-off load of history; `ufc_predict.py --generate --grade`;
  `ufc_picks.py --grade`; `ufc_live_poll.py`.
- Upstream manners: a browser-like user agent, at most a few requests a second in
  backfill and about one poll a minute live, backoff on 403/429, and a hard stop rather
  than a retry storm.
- Workflows: `ufc-refresh.yml` (daily, and twice on fight day) and
  `ufc-live-refresh.yml` (dispatch only). Both follow the NRL workflows' shape.

### 8.3 API (`backend/app/api/ufc*.py`, all new)

| Endpoint | Returns |
| --- | --- |
| `GET /api/ufc/events?when=upcoming\|past` | Card list |
| `GET /api/ufc/events/{slug}` | Card with bouts. Model fields only for bouts that are locked or later |
| `GET /api/ufc/events/{slug}/live` | Live state of every bout, last update time |
| `GET /api/ufc/bouts/{id}` | One bout, stats and judges when finished; same model rule |
| `GET /api/ufc/fighters/{slug}` | Profile and bout history |
| `GET /api/ufc/rankings?division=` | Model ratings |
| `GET /api/ufc/model/record` | Graded record, calibration, model versus market |
| `POST /api/ufc/picks/submit` | Upsert a pick; 409 after lock |
| `GET /api/ufc/picks/mine?event=` | The player's picks, and the model's call for the bouts they have picked |
| `GET /api/ufc/picks/leaderboard?event=\|year=` | Leaderboards |
| `POST /api/internal/ufc-refresh-live` | Token-guarded poll, as the NRL one |

The model-field rule is one function used by every UFC endpoint and covered by its own
test: open bout and no locked pick from this player means no probability, no reasons,
no implied pick anywhere in the response.

### 8.4 Frontend

- `frontend/lib/sports.ts`: add `"ufc"` to `SportId` and `CompetitionId`, and a `ufc`
  entry in `COMPETITIONS` (`format: "cards"`, which widens the current
  `"league" | "knockout"` type, `hasTips: true`, `enabled: false` until
  launch, `recordPath: "/ufc/record"`, `terms: { fixtures: "Fights", standings: "Rankings" }`).
- `frontend/lib/reveal.ts`: `pickGameFor("ufc") → "ufc_picks"`.
- `frontend/app/ufc/**` for the routes in 5.1; `frontend/components/ufc/**` for
  `BoutRow` (a thin wrapper over `FixtureRow`), `FighterMark`, `BoutPick`, `MethodPick`,
  `UfcModelCallCard`, `TaleOfTheTape`, `LiveCardStrip`, `UfcYouVsAi`; `frontend/lib/ufc*.ts`
  for types, display helpers and the live hook.
- Open Graph images for a card and for a shared pick sheet, following the NRL ones. A
  public image never shows the model's call for an open bout.
- Every new component ships with a co-located test, as the NRL ones do.

### 8.5 Shared files this touches

`frontend/lib/sports.ts`, `frontend/lib/reveal.ts`, the sport switcher's tests,
`backend/app/models/__init__.py` (new classes only), `backend/app/api/internal.py` (one
new route), `backend/app/main.py` (router registration, and UFC feed age in the health
report), `backend/app/config.py` (`UFC_PROVIDER`, `UFC_PUBLIC_MODEL`), `.env.example`,
and, outside the repo, the Mac mini scheduler's job list. Nothing else outside new files.

## 9. Open evidence (the spike)

| Question | How it is answered | When |
| --- | --- | --- |
| Is the history complete enough to train on? | Coverage table by year from the full download | 2026-11-25 |
| Does a plain rating model clear the gate, and how far is it from the market? | Walk-forward Elo on a 2022–2026 holdout, scored against ESPN's moneyline on the same fights; history from 1993, 2005 and 2016 compared | 2026-11-25 |
| Does ESPN answer from GitHub Actions and from Render, not only from a home connection? | A read-only probe workflow and one probe request from the API host. Everything so far ran from the Mac mini | First task of phase 1 |
| How fast does the feed move during a fight? Do stats update mid-fight or only after? | A recorder on the Mac mini captures the 5 Dec and 12–13 Dec cards at about 14-second intervals | 2026-12-13 |

The third answer matters most for the build: the daily job and the backfill run in
GitHub Actions and the live endpoint calls the feed from Render. If the feed refuses
those addresses, the choice is the paid feed or a collector on the mini that posts to
the API, and phase 1 stops for the owner's decision before anything else is built.

The fourth answer decides whether an in-fight probability is worth designing. If the
feed only moves between rounds, the live product is status and results, which this
design already covers.

## 10. Build order

Each phase ends in a pull request with the test gate green. Sizes are rough estimates
for the usual builder-plus-reviewer loop, not commitments.

| Phase | What ships | Visible to visitors | Gate to pass | Rough size |
| --- | --- | --- | --- | --- |
| 0. Spike | History, baseline numbers, two live recordings | No | Evidence in section 9 | Running; ends 14 Dec |
| 1. Data foundation | Feed reachability probe first; then migration, provider, ingest, backfill load, daily workflow | No | Probe passes; owner's go for the migration and the first production backfill | 3–4 days |
| 2. Model in shadow | `ufc-elo-v0.1`, predictions before lock, grading, internal record | No | Two live cards predicted and graded clean | 2–3 days, then two cards of waiting |
| 3. Read-only section | `/ufc`, event, fight, fighter and events pages behind `enabled: false`, then on. No model output of any kind: no call, no ratings, no rankings page | Yes: cards, results, fight stats, fighter records | Owner's go to switch it on | 4–5 days |
| 4. Picks and reveal | Pick control, method pick, server-side reveal rule, leaderboard, record page, rankings, ratings on fighter pages, model public | Yes | Model gate (section 6) and owner's go | 4–5 days |
| 5. Live card | Live poller, live strip, on-the-spot grading, stale rule | Yes | A full card followed end to end on a preview deployment | 3–4 days |
| 6. Depth | Method probabilities, model-versus-market detail, share images, v0.2 model | Yes | Per item | Open |

Phase 3 can ship before the model is ready; phases 4 and 5 can swap if the model gate
is slow. If phase 4 arrives before the model passes, the picks game ships without a
model call and the reveal shows the market's implied chance instead; if the owner
leaves the market off (decision 3), phase 4 waits for the model. Odds snapshots are
stored either way, because the record page's benchmark needs them.

Who does what, following the model lane in `CLAUDE.md`: Opus writes each phase's plan,
Sonnet builds from it, and a fresh Opus context reviews every diff; the migration and the reveal rule get an architecture review; the design
pass is done against the screens in the design page at 390, 1024 and 1440 pixels
before a phase is called done; the owner holds every stop gate.

## 11. Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| ESPN changes or blocks the feed | No new data | Provider protocol; `UFC_PROVIDER=ufcalendar` at US$19 a month is the planned fallback; recorded fixtures keep tests independent of ESPN; health endpoint reports UFC feed age |
| ESPN refuses requests from GitHub Actions or Render | The pipeline cannot run where the database is | Probed before anything else in phase 1; fallbacks are the paid feed or a collector on the mini |
| The feed is unlicensed | A request to stop | Low request volume, no photos or logos, no resale of the data; be ready to switch provider; owner decides whether that risk is acceptable in a public repo |
| The model is no better than a coin flip near 50% | A dull or wrong product | Shadow gate; publish calibration; show the market beside it |
| A fighter is replaced or a bout moves late | Wrong picks graded | Identity by provider bout id plus fighter pair; `changed` state voids picks |
| A pick sneaks in after a bout starts | Unfair leaderboard | Lock at scheduled segment time by server clock; the feed can only lock earlier |
| The model's call leaks before a pick | The core mechanic is hollow | Server-side rule with its own test; public images and metadata never carry it |
| Cards run at 2–6 am in Australia | Low live audience there | Live is phase 5, not the launch; the picks game is played before the card |
| Betting-adjacent content | Advertising rules, tone | Probabilities, not tips; no bookmaker names, links or affiliate codes |
| The mini is off during a card | No live polling | Daily refresh still fills results; live strip says updates are delayed |

## 12. What success looks like (proposed, for the owner to adjust)

- Every card from launch has predictions written before lock and graded within a day.
- The record page shows a Brier score below 0.25 on forward-only calls, with the
  market's score beside it.
- A meaningful share of visitors to `/ufc` make at least one pick, and of those, a
  meaningful share come back for the next card. Targets to be set from the first three
  cards of real numbers; NRL's figures are the reference.
- No incident where a model call was visible on an open bout.

## 13. Decisions for the owner

1. Is an unlicensed free feed acceptable for a public launch, or only until launch, with
   the US$19 a month feed switched on when the section goes public?
2. May the design, which names the data source, be pushed to the public repo? Until
   then the branch `docs/ufc-section-design` stays local.
3. Show the bookmaker price as an implied percentage ("the market"), as football does,
   or leave the market off the UFC pages? Designed in, hidden until you pick like the
   model's call. Leaving it off also removes the phase 4 fallback.
4. Fighter marks: flags and monograms as designed, or pursue licensed photos later?

## 14. Left to the builder

Slug format, exact column types, index choices, component file split, copy for empty
and error states (in the site's existing voice), the Open Graph layouts, and test
fixture selection from the spike's recordings.
