# PRD — Light-theme surface sweep

**Status:** approved · **Author:** Claude (Opus 5) · **Date:** 2026-08-07
**Owner:** pete@degail.com · **Related:** PR #242 (token orphan), PR #244 (toggle)

---

## 1. Summary

The Daylight theme shipped behind a user-facing toggle in #244. It was verified
on **two surfaces out of forty-one**. This PRD covers sweeping the remaining
thirty-nine, fixing what breaks, and leaving behind a check that stops the
theme silently rotting as new pages land.

This is closing a gap I opened, not new product work.

## 2. Context — why this exists

Three PRs this week made light mode real:

| PR | What it did |
|---|---|
| #242 | Fixed the one orphan literal in `.glass`, which made every card fade to black under Daylight |
| #243 | Consolidated 225 arbitrary type sizes into a named scale |
| #244 | Added the header toggle, the no-flash boot script, and raised `--muted` to clear WCAG AA |

**What was actually verified in a browser: `/methodology` and `/football/[comp]/fixtures`.** Everything else is inference from "the token fix was systemic." That inference is reasonable and probably right — but a reader who flips the toggle sees all forty-one surfaces, and "probably right" is not a standard this platform has otherwise accepted.

The measurable risk is concrete rather than theoretical: colours hardcoded outside the token system cannot follow the theme. Section 5 lists the ones that fail, with numbers.

## 3. Goals

1. Every route renders legibly under Daylight — no invisible text, no dark-on-dark or light-on-light.
2. Body text meets **WCAG AA (4.5:1)** in light mode, matching the floor the dark theme already clears.
3. Dark mode is **byte-identical** afterwards. This sweep must not become a redesign of the shipped theme.
4. A regression check exists so surface #42 doesn't quietly reintroduce the problem.

## 4. Non-goals

- Redesigning Daylight's palette. Token values change **only** where a measured contrast failure forces it.
- Touching dark mode's appearance at all.
- Theming the deliberately fixed-palette surfaces (§5.3).
- Auto-adopting `prefers-color-scheme`. Dark stays the default; that decision stands.
- Adding a screenshot/visual-regression harness. Out of proportion here — see §8.

## 5. Scope

### 5.1 Surface inventory — 41 routes

| Tier | Routes | Why this tier |
|---|---|---|
| **P0 — high traffic, data-dense** (9) | `/`, `/matches`, `/match/[id]`, `/football/[comp]`, `/football/[comp]/fixtures`✅, `/football/[comp]/match/[id]`, `/football/[comp]/standings`, `/nrl`, `/nrl/matches` | Where readers actually spend time; densest use of cards, chips, tables |
| **P1 — feature surfaces** (13) | `/play`, `/tips`, `/leaderboard`, `/record`, `/brackets`, `/football/[comp]/bracket`, `/groups`, `/groups/[id]`, `/team/[id]`, `/nrl/ladder`, `/nrl/round/[n]`, `/nrl/match/...`, `/nrl/team/[id]` | Real usage, more forgiving layouts |
| **P2 — static / low traffic** (12) | `/about`, `/methodology`✅, `/privacy`, `/terms`, `/retention`, `/research/market-benchmark`, `/nrl/record`, `/nrl/origin`, `/nrl/run-home`, `/nrl/tips`, `/nrl/leaderboard`, `/reset-password`, `/verify-email` | Mostly prose on tokens; lowest risk |
| **Excluded** (4) | `/embed/[matchId]`, `/nrl/tips/share/...`, `/tips/share/...`, OG image routes | Fixed-palette by design — §5.3 |

✅ = already verified.

### 5.2 Known risk register — measured, not guessed

Contrast of each hardcoded colour against the Daylight canvas (`#f4f7f2`):

| Colour | Where | On dark | On light | Verdict |
|---|---|---:|---:|---|
| `#f6f8f3` | `global-error.tsx` background | — | — | The crash canvas, not text. Primary `#0f2117` is 15.71:1; muted ink moves from `#6b7c71` at 4.14:1 to `#59685f` at 5.50:1 in Daylight; the button pair is 7.41:1. |
| `#a9c7b4` | `leaderboard/LeaderboardClient.tsx` | 10.28 | **1.69** | **Fails** |
| `#8b95a7` | `FeatureImportanceChart.tsx` axis | 6.21 | **2.79** | **Fails** |
| `#6b7c71` | `global-error.tsx` muted | 4.24 | **4.09** | Marginal — under AA for body text |
| `#1a251d`, `#243028` | `TimelineSpine.tsx` rails | 1.18 / 1.36 | 14.65 / 12.71 | Passes, but visually heavy — review weight, not legibility |
| `#d6f5a8` | `AccountMenu.tsx` initials | 15.61 | **11.09** | **Fine** — sits on `bg-pitch`, which stays dark in both themes. Measuring it against the canvas would have been the wrong test. |

The crash page remains the highest-priority surface because it renders precisely when something has already gone wrong. Its canvas and primary ink were already legible; the measured defect was the muted copy falling below AA in Daylight.

### 5.3 Deliberately excluded, with reasons

- **`ClubBadge.tsx`** — ~70 hardcoded hex values are *club brand colours* (Arsenal `#ef0107`, Bayern `#dc052d`). Correct in both themes; theming them would be wrong.
- **`EmbedPredictionCard.tsx` / `/embed/[matchId]`** — share cards rendered for external platforms with their own backgrounds. Fixed dark palette is intentional.
- **`manifest.ts`** — PWA manifest colour is static by specification.

## 6. Acceptance criteria

1. All 41 in-scope routes rendered under `.theme-daylight` at **375px and 1280px**, and visually confirmed.
2. Every colour in §5.2 marked *Fails/Invisible/Marginal* either meets **≥ 4.5:1** or is documented as intentionally exempt with its reason.
3. **Dark mode diff is empty** — proven by computed-style comparison on a sample of P0 surfaces before and after, not by eye.
4. Frontend suite green; new tests cover each token or component changed.
5. A test asserts no *new* raw hex colour appears in themed component paths (excluding the §5.3 allowlist).

## 7. Approach

1. **Fix the register first** (§5.2) — four known failures, ahead of any sweeping. Each becomes a token or a themed utility.
2. **Sweep P0 → P1 → P2**, capturing computed background/foreground pairs per route and flagging anything under 4.5:1.
3. **Prove dark unchanged** by diffing computed styles against a pre-change capture.
4. **Land the guard** — the raw-hex allowlist test from criterion 5.

## 8. Verification method, and what it is not

Automated **contrast measurement** in the browser (the approach that found the `--muted` failure in #244 and the false alarm in §5.2), plus **human eyes** on P0.

Explicitly **not** a screenshot/visual-regression harness: it needs infrastructure this repo doesn't have, is famously flaky, and would take longer to stabilise than the sweep itself. If light mode becomes a first-class surface later, revisit.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Sweep turns into a redesign | Non-goal #1; token values change only on a measured failure |
| A fix regresses dark mode | Acceptance criterion 3 — computed-style diff, not eyeballing |
| Dynamic states (live match, error, empty) missed because they need specific data | Enumerate states per P0 surface up front; local dev can force them |
| Sweep is stale by the league openers (Aug 15/21/28) | Do it before then, or accept re-checking the new match states after |

## 10. Estimate

Roughly one focused pass: register fixes (small, four files), P0 sweep (the bulk), P1/P2 (fast — mostly prose on tokens), guard test. One PR, or two if the register fixes want to land first.

## 11. Owner decisions — resolved 2026-08-09

1. **Daylight is a supported surface.** P0, P1, and P2 receive the same legibility and contrast bar.
2. **Leave the timeline spine unchanged.** It already passes contrast; changing its visual weight would turn this corrective sweep into a redesign.
3. **Run the sweep now.** Re-check live match states after the league openers if those states introduce new themed UI.
