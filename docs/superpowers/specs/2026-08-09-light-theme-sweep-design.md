# Light-theme surface sweep design

**Status:** approved
**Date:** 2026-08-09
**Source requirements:** `docs/PRD-LIGHT-THEME-SWEEP.md`

## Outcome

Daylight becomes a supported theme across every P0, P1, and P2 route in the PRD. The work fixes only demonstrated theme defects, keeps the Floodlight dark theme unchanged, and adds a regression check that prevents new raw colour literals from entering theme-aware UI without an explicit exemption.

## Decisions

- Use the PRD's full-sweep approach: known register fixes first, then P0, P1, and P2 verification.
- Treat both themes as supported across all in-scope routes.
- Leave `TimelineSpine.tsx` unchanged because its rails pass contrast; visual-weight changes are redesign work.
- Keep fixed-palette brand, embed/share, manifest, Open Graph, mask, and generated-asset code outside the themed-component guard.
- Verify now, then re-check newly introduced live-match states after league openers if their UI differs from the states covered in this sweep.
- Do not add a screenshot-regression framework or adopt `prefers-color-scheme`.

## Architecture

### Theme-safe colour ownership

Theme-aware application components must express foregrounds and surfaces through the existing semantic token system. Recharts SVG attributes may consume resolved CSS custom properties when literal SVG attributes cannot use Tailwind classes. The root crash boundary remains self-contained because it can render without the application layout or global stylesheet; its inline palette must select a complete, legible light or dark set without depending on unavailable styles.

### Register fixes

The known failing or marginal colours are handled at their point of ownership:

- `app/global-error.tsx` supplies a complete self-contained crash palette whose foreground and secondary copy clear 4.5:1 in either selected theme.
- `app/leaderboard/LeaderboardClient.tsx` replaces the one-off panel copy colour with an existing semantic colour that is correct on the intentionally dark `panel-pitch` surface.
- `components/FeatureImportanceChart.tsx` sources axis and value-label ink from a theme-aware semantic value rather than a raw grey.
- `components/TimelineSpine.tsx` receives no visual change.

No global Daylight palette value changes unless browser measurement finds a token-level failure shared by multiple routes. Any such change must be covered by a contrast test and must not alter the dark `:root` value.

### Raw-colour regression boundary

A Jest source scan covers `frontend/app`, `frontend/components`, and theme-aware files under `frontend/lib`. It reports raw hexadecimal colour literals unless the file is explicitly allowlisted for one of these reasons:

- club or competition brand colours;
- fixed-palette embed/share or Open Graph rendering;
- PWA manifest, metadata boot values, generated assets, or image masks;
- tests that intentionally assert exact palette values.

The allowlist is path-based and documented in the test. The check fails with the offending relative file and literal so a future contributor can either move the colour to a token or justify a narrow exemption.

## Browser sweep

The existing Playwright route sweep is extended or accompanied by a focused theme audit that:

1. discovers representative identifiers for dynamic routes from listing pages;
2. visits every P0, P1, and P2 route at 375 by 844 and 1280 by 800;
3. forces Daylight before the page paints;
4. inspects visible text/background pairs and reports normal-size text below 4.5:1;
5. records route, viewport, selector, foreground, background, and measured ratio for each failure;
6. captures a stable set of computed dark-theme properties on representative P0 surfaces before production edits and compares the same properties afterward.

Unavailable data-dependent routes or states are reported explicitly rather than counted as verified. Human review covers all reachable P0 pages for hierarchy, crowding, invisible content, and accidentally dark panels; automated contrast measurement covers every reachable in-scope route.

## Error handling

- Browser navigation, API, and missing-data failures are recorded per route and do not silently disappear from the sweep summary.
- Elements whose effective background cannot be determined are reported for manual review rather than treated as passing.
- The raw-colour scan uses a deliberately narrow allowlist; an unexpected literal fails with actionable output.
- The crash boundary never relies on the failing application layout to obtain theme colours.

## Testing

Implementation follows red-green-refactor cycles:

- component/source tests first demonstrate each registered literal or contrast failure;
- contrast helpers prove all changed normal-size text meets at least 4.5:1 on its actual surface;
- the raw-hex guard first fails on the current register and then passes after the fixes and documented exclusions;
- focused Jest tests run after each change;
- final verification runs `npm run typecheck`, `npm run lint`, and `npm test` from `frontend`;
- the browser sweep runs at both required viewport widths and produces an auditable result for each reachable route;
- the final diff confirms no dark-theme token or literal was altered unintentionally.

Existing baseline warnings from `next lint`, workspace-root inference, React `act(...)`, and one hook dependency are outside this sweep unless a changed file introduces a new warning.
