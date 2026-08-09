# Light-theme Surface Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Daylight a verified, WCAG-AA-supported theme on every P0, P1, and P2 route listed in the approved PRD without changing the Floodlight dark theme.

**Architecture:** Keep theme-aware UI on the existing semantic CSS tokens, repair the three measured register failures at their owning components, and enforce that boundary with a Jest raw-colour source guard. Add a Playwright-powered audit command that discovers dynamic route identifiers, measures rendered contrast at both required viewports, records unavailable states, and captures/compares representative dark computed styles.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, Jest/Testing Library, Playwright Core with installed Chrome.

## Global Constraints

- Daylight is supported across all P0, P1, and P2 routes in `docs/PRD-LIGHT-THEME-SWEEP.md`.
- Normal-size body text must meet WCAG AA contrast of at least 4.5:1 on its actual rendered surface.
- Floodlight dark-theme CSS token values and computed styles must remain unchanged.
- `TimelineSpine.tsx` remains visually unchanged because its rails already pass contrast.
- Club/competition brands, embeds/share cards, Open Graph output, manifest/metadata values, generated assets, and image masks retain their deliberate fixed palettes.
- Dark remains the default; do not add `prefers-color-scheme` behavior.
- Do not add a screenshot-regression framework; screenshots created by the one-time P0 audit are evidence artifacts only.
- Production changes follow red-green-refactor: each affected behavior is demonstrated by a failing test before implementation.

---

## File Structure

| File | Responsibility |
|---|---|
| `frontend/scripts/theme-audit-lib.cjs` | Pure colour parsing, compositing, contrast, WCAG threshold, and dark-snapshot comparison helpers. |
| `frontend/scripts/theme-audit-lib.test.ts` | Unit tests for hand-derived colour ratios and dark-style diff behavior. |
| `frontend/scripts/theme-audit.mjs` | Real-browser route discovery, Daylight contrast audit, P0 screenshots, and dark computed-style capture/compare. |
| `frontend/package.json` | Exposes the audit as `npm run audit:theme`. |
| `frontend/app/global-error.test.tsx` | Proves all visible crash-boundary text clears 4.5:1 against its self-contained surface. |
| `frontend/app/global-error.tsx` | Keeps the standalone crash page legible without depending on the root layout or global stylesheet. |
| `frontend/components/FeatureImportanceChart.test.tsx` | Proves the chart passes semantic theme ink into Recharts. |
| `frontend/components/FeatureImportanceChart.tsx` | Replaces raw grey chart ink with the existing muted token. |
| `frontend/app/leaderboard/LeaderboardClient.tsx` | Replaces the failing one-off pitch-panel copy colour with invariant light ink. |
| `frontend/lib/__tests__/themeColorGuard.test.ts` | Scans theme-aware production sources and fails on raw hex outside documented fixed-palette paths. |
| `docs/LIGHT-THEME-SWEEP-2026-08-09.md` | Auditable route/viewport results, exclusions, unreachable states, contrast results, and dark comparison. |
| `docs/PRD-LIGHT-THEME-SWEEP.md` | Corrects the stale crash-page register row and records the completed verification outcome. |

---

### Task 1: Build the browser audit and capture the pre-change dark baseline

**Files:**
- Create: `frontend/scripts/theme-audit-lib.cjs`
- Create: `frontend/scripts/theme-audit-lib.test.ts`
- Create: `frontend/scripts/theme-audit.mjs`
- Modify: `frontend/package.json`
- Artifact: `frontend/output/playwright/light-theme-sweep/dark-before.json` (ignored, do not commit)

**Interfaces:**
- Produces: `parseCssColor(value: string): [number, number, number, number] | null`
- Produces: `composite(foreground: RGBA, background: RGBA): RGBA`
- Produces: `contrastRatio(foreground: RGBA, background: RGBA): number`
- Produces: `wcagThreshold(fontSizePx: number, fontWeight: number): 3 | 4.5`
- Produces: `diffDarkStyles(before: DarkSnapshot, after: DarkSnapshot): DarkStyleDiff[]`
- Produces CLI: `npm run audit:theme -- <baseUrl> --theme <light|dark> [--output <path>] [--compare <path>] [--screenshots-p0]`
- Consumes later: Task 3 uses the CLI output and Task 4 uses `--compare` against `dark-before.json`.

- [ ] **Step 1: Write failing unit tests for contrast and dark-style comparison**

Create `frontend/scripts/theme-audit-lib.test.ts` with independently derived expectations:

```ts
const {
  parseCssColor,
  composite,
  contrastRatio,
  wcagThreshold,
  diffDarkStyles,
} = require("./theme-audit-lib.cjs");

it("parses browser rgb and rgba colours", () => {
  expect(parseCssColor("rgb(15, 33, 23)")).toEqual([15, 33, 23, 1]);
  expect(parseCssColor("rgba(255, 255, 255, 0.7)")).toEqual([255, 255, 255, 0.7]);
  expect(parseCssColor("transparent")).toEqual([0, 0, 0, 0]);
});

it("measures the known crash-page failure and corrected value", () => {
  const canvas = [246, 248, 243, 1];
  expect(contrastRatio([107, 124, 113, 1], canvas)).toBeCloseTo(4.138, 2);
  expect(contrastRatio([89, 104, 95, 1], canvas)).toBeCloseTo(5.501, 2);
});

it("composites translucent text before measuring it", () => {
  expect(composite([255, 255, 255, 0.7], [13, 36, 24, 1])).toEqual([
    182.4, 189.3, 185.7, 1,
  ]);
});

it("uses WCAG large-text thresholds only at the defined boundary", () => {
  expect(wcagThreshold(17, 400)).toBe(4.5);
  expect(wcagThreshold(18, 400)).toBe(3);
  expect(wcagThreshold(14, 700)).toBe(3);
  expect(wcagThreshold(13, 700)).toBe(4.5);
});

it("reports only changed computed dark properties", () => {
  const before = { "/": { "body:0": { color: "rgb(243, 246, 243)", backgroundColor: "rgb(10, 20, 16)" } } };
  const after = { "/": { "body:0": { color: "rgb(243, 246, 243)", backgroundColor: "rgb(11, 20, 16)" } } };
  expect(diffDarkStyles(before, after)).toEqual([{
    route: "/",
    key: "body:0",
    property: "backgroundColor",
    before: "rgb(10, 20, 16)",
    after: "rgb(11, 20, 16)",
  }]);
});
```

- [ ] **Step 2: Run the helper test and verify RED**

Run: `cd frontend && npm test -- scripts/theme-audit-lib.test.ts --runInBand`

Expected: FAIL because `./theme-audit-lib.cjs` does not exist.

- [ ] **Step 3: Implement the pure audit helpers**

Create `frontend/scripts/theme-audit-lib.cjs` with these exact exports and rules:

```js
function parseCssColor(value) {
  if (value === "transparent") return [0, 0, 0, 0];
  const match = value.match(/^rgba?\(\s*([\d.]+)[, ]+\s*([\d.]+)[, ]+\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3]), match[4] == null ? 1 : Number(match[4])]
    : null;
}

function composite([r, g, b, a], [br, bg, bb, ba]) {
  const outA = a + ba * (1 - a);
  if (outA === 0) return [0, 0, 0, 0];
  return [
    (r * a + br * ba * (1 - a)) / outA,
    (g * a + bg * ba * (1 - a)) / outA,
    (b * a + bb * ba * (1 - a)) / outA,
    outA,
  ];
}

function channel(value) {
  const v = value / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance([r, g, b]) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(foreground, background) {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function wcagThreshold(fontSizePx, fontWeight) {
  return fontSizePx >= 18 || (fontSizePx >= 14 && fontWeight >= 700) ? 3 : 4.5;
}

function diffDarkStyles(before, after) {
  const diffs = [];
  for (const [route, entries] of Object.entries(before)) {
    for (const [key, properties] of Object.entries(entries)) {
      for (const [property, value] of Object.entries(properties)) {
        const next = after[route]?.[key]?.[property];
        if (next !== value) diffs.push({ route, key, property, before: value, after: next });
      }
    }
  }
  return diffs;
}

module.exports = { parseCssColor, composite, contrastRatio, wcagThreshold, diffDarkStyles };
```

- [ ] **Step 4: Run the helper test and verify GREEN**

Run: `cd frontend && npm test -- scripts/theme-audit-lib.test.ts --runInBand`

Expected: 5 tests PASS.

- [ ] **Step 5: Implement the real-browser audit command**

Create `frontend/scripts/theme-audit.mjs`. It must:

- launch installed Chrome through `playwright-core`;
- parse `baseUrl`, `--theme`, `--output`, `--compare`, and `--screenshots-p0`;
- set `fw_theme` with `context.addInitScript` before navigation;
- discover representative football match/team/group and NRL match/team/round paths from real listing links;
- audit the 35 explicitly listed P0/P1/P2 route patterns in the PRD, using the matching `/football/wc26/` canonical targets for redirected legacy WC26 routes while retaining the legacy paths as separate redirect-health entries;
- never substitute fake ID `1`; mark a dynamic route `unavailable` when discovery returns no real link;
- visit 375×844 and 1280×800;
- collect visible leaf text elements, computed `color`, font size/weight, opacity, and the nearest resolvable solid ancestor background;
- composite translucent foregrounds and ancestor opacity before calling `contrastRatio`;
- report `manualReview` for text over gradients/images or without a resolvable solid background;
- report `failures` where the measured ratio is below `wcagThreshold`;
- for dark runs, capture `color`, `backgroundColor`, `borderColor`, `backgroundImage`, `boxShadow`, `fill`, and `stroke` from the first three matches of `body`, `header`, `main`, `.glass`, `.panel-pitch`, `.text-muted`, `.bg-surface`, and `button` on `/`, the representative football fixtures/match/standings routes, `/nrl`, and the representative NRL match;
- write deterministic JSON when `--output` is supplied;
- use `diffDarkStyles` and exit 1 when `--compare` finds any difference;
- save P0 screenshots under `output/playwright/light-theme-sweep/<theme>/<viewport>/` only when `--screenshots-p0` is supplied;
- exit 1 on contrast failures, dark diffs, navigation failures, or an app error boundary; unavailable dynamic states remain explicit in JSON but do not crash the process.

Add to `frontend/package.json`:

```json
"audit:theme": "node scripts/theme-audit.mjs"
```

- [ ] **Step 6: Start the local app against the read-only production API**

Run in a persistent terminal from `frontend`:

```bash
NEXT_PUBLIC_API_URL=https://pitchprophet-api.onrender.com npm run dev
```

Expected: Next reports a local URL and serves `/` successfully. This performs external GETs only.

- [ ] **Step 7: Capture the pre-change dark baseline**

Run:

```bash
cd frontend
npm run audit:theme -- http://localhost:3000 --theme dark --output output/playwright/light-theme-sweep/dark-before.json
```

Expected: JSON is written with representative P0 computed styles. Record any pre-existing navigation or unavailable-state entries; do not edit application components yet.

- [ ] **Step 8: Commit the audit tooling**

Run:

```bash
git add frontend/package.json frontend/scripts/theme-audit-lib.cjs frontend/scripts/theme-audit-lib.test.ts frontend/scripts/theme-audit.mjs
git commit -m "test: add reproducible theme route audit"
```

---

### Task 2: Repair the known register and install the raw-colour guard

**Files:**
- Create: `frontend/app/global-error.test.tsx`
- Create: `frontend/lib/__tests__/themeColorGuard.test.ts`
- Modify: `frontend/app/global-error.tsx`
- Modify: `frontend/app/leaderboard/LeaderboardClient.tsx`
- Modify: `frontend/components/FeatureImportanceChart.tsx`
- Modify: `frontend/components/FeatureImportanceChart.test.tsx`

**Interfaces:**
- Consumes: existing `--muted` semantic token from `frontend/app/globals.css`.
- Produces: Recharts axis and value-label `fill: "hsl(var(--muted))"`.
- Produces: pitch-panel supporting copy expressed as `text-white/70` on the intentionally dark `panel-pitch` surface.
- Produces: standalone crash muted ink `#59685f`, measured at 5.50:1 on its fixed `#f6f8f3` canvas.
- Produces: a path-reason allowlist guard for deliberate fixed palettes; any other raw hex in app/components/lib fails Jest.

- [ ] **Step 1: Write the failing crash-boundary contrast test**

Create `frontend/app/global-error.test.tsx`:

```tsx
import { renderToStaticMarkup } from "react-dom/server";
import GlobalError from "./global-error";

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}
function luminance(values: number[]): number {
  const [r, g, b] = values.map((value) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [high, low] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}

it("keeps every crash-page text pair above the 4.5:1 floor", () => {
  const html = renderToStaticMarkup(
    <GlobalError error={new Error("boom")} reset={jest.fn()} />,
  );
  const document = new DOMParser().parseFromString(html, "text/html");
  const body = document.body;
  const paragraph = document.querySelector("p") as HTMLParagraphElement;
  const button = document.querySelector("button") as HTMLButtonElement;

  expect(ratio(body.style.color, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(paragraph.style.color, body.style.background)).toBeGreaterThanOrEqual(4.5);
  expect(ratio(button.style.color, button.style.background)).toBeGreaterThanOrEqual(4.5);
});
```

- [ ] **Step 2: Extend the chart test to require semantic ink**

Change the existing Recharts mock so `YAxis` and `LabelList` expose the received fill values:

```tsx
LabelList: ({ style }: any) => React.createElement("i", { "data-testid": "chart-value-ink", "data-fill": style.fill }),
YAxis: ({ tick }: any) => React.createElement("i", { "data-testid": "chart-axis-ink", "data-fill": tick.fill }),
```

Add to the rendering test:

```tsx
expect(screen.getByTestId("chart-axis-ink")).toHaveAttribute("data-fill", "hsl(var(--muted))");
expect(screen.getByTestId("chart-value-ink")).toHaveAttribute("data-fill", "hsl(var(--muted))");
```

- [ ] **Step 3: Write the failing raw-colour guard**

Create `frontend/lib/__tests__/themeColorGuard.test.ts`. Recursively scan production `.ts`/`.tsx` files under `app`, `components`, and `lib`; exclude `*.test.*`; strip line and block comments before matching `/#[\da-fA-F]{3,8}\b/g`. The complete path allowlist and reasons are:

```ts
const FIXED_PALETTE_PATHS: Record<string, string> = {
  "app/global-error.tsx": "self-contained root crash boundary; global CSS is unavailable",
  "app/embed/[matchId]/page.tsx": "partner embed has an explicit fixed palette",
  "app/layout.tsx": "browser chrome and pre-paint boot values must be literal",
  "app/manifest.ts": "PWA manifest colour is static by specification",
  "components/AICalculationReveal.tsx": "CSS mask colour is alpha-only, not visible ink",
  "components/AccountMenu.tsx": "initials sit on invariant dark bg-pitch",
  "components/ClubBadge.tsx": "club and competition brand colours",
  "components/EmbedPredictionCard.tsx": "share card has an explicit fixed palette",
  "lib/og.tsx": "Open Graph renderer has an explicit fixed palette",
  "lib/theme.ts": "browser theme-color meta requires literal values",
};
```

The final assertion is:

```ts
expect(violations).toEqual([]);
```

Each violation string must be `<relative path>:<line> <literal>`, making the failure actionable.

- [ ] **Step 4: Run all three focused tests and verify RED**

Run:

```bash
cd frontend
npm test -- app/global-error.test.tsx components/FeatureImportanceChart.test.tsx lib/__tests__/themeColorGuard.test.ts --runInBand
```

Expected failures:

- crash paragraph is approximately 4.14:1, below 4.5;
- chart axis/value labels receive `#8b95a7`, not the muted token;
- the guard reports `app/leaderboard/LeaderboardClient.tsx` and `components/FeatureImportanceChart.tsx`.

- [ ] **Step 5: Apply the minimal register fixes**

Make only these production changes:

```tsx
// app/global-error.tsx
<p style={{ fontSize: "0.875rem", color: "#59685f", maxWidth: "28rem" }}>
```

```tsx
// app/leaderboard/LeaderboardClient.tsx
<p className="mt-1.5 text-sm leading-relaxed text-white/70">
```

```tsx
// components/FeatureImportanceChart.tsx
tick={{ fontSize: 12, fill: "hsl(var(--muted))" }}
style={{ fill: "hsl(var(--muted))", fontSize: 11, fontWeight: 600 }}
```

Do not change `frontend/app/globals.css` or `TimelineSpine.tsx`; the existing `--muted` token already clears AA in both themes and no measured failure justifies a new token.

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
cd frontend
npm test -- app/global-error.test.tsx components/FeatureImportanceChart.test.tsx lib/__tests__/themeColorGuard.test.ts --runInBand
```

Expected: all focused tests PASS and the guard reports no unexpected raw hex.

- [ ] **Step 7: Run the full Jest suite before committing**

Run: `cd frontend && npm test -- --runInBand`

Expected: all suites PASS; no new warning originates from a changed file.

- [ ] **Step 8: Commit the register fixes and guard**

Run:

```bash
git add frontend/app/global-error.test.tsx frontend/app/global-error.tsx frontend/app/leaderboard/LeaderboardClient.tsx frontend/components/FeatureImportanceChart.test.tsx frontend/components/FeatureImportanceChart.tsx frontend/lib/__tests__/themeColorGuard.test.ts
git commit -m "fix: make daylight component ink theme-safe"
```

---

### Task 3: Run the full Daylight sweep and prove dark styles unchanged

**Files:**
- Read: `frontend/output/playwright/light-theme-sweep/dark-before.json`
- Create artifacts: `frontend/output/playwright/light-theme-sweep/light-results.json`
- Create artifacts: `frontend/output/playwright/light-theme-sweep/dark-after.json`
- Create artifacts: `frontend/output/playwright/light-theme-sweep/light/{mobile,desktop}/*.png`
- Modify only if a new failure is found: the exact failing component plus its focused test

**Interfaces:**
- Consumes: `audit:theme` CLI from Task 1.
- Produces: zero automated contrast failures on every reachable in-scope route/viewport.
- Produces: zero entries from `diffDarkStyles(darkBefore, darkAfter)`.
- Produces: explicit `unavailable` and `manualReview` records for honest human review.

- [ ] **Step 1: Audit Daylight at both required viewports**

With the local dev server still running, run:

```bash
cd frontend
npm run audit:theme -- http://localhost:3000 --theme light --output output/playwright/light-theme-sweep/light-results.json --screenshots-p0
```

Expected: exit 0, no WCAG failures, and one result for each reachable route at 375×844 and 1280×800. Dynamic states with no real identifier are listed under `unavailable`.

- [ ] **Step 2: Review every P0 screenshot**

Inspect the generated P0 mobile and desktop images for invisible content, unintended dark-on-dark/light-on-light text, unreadable tables/chips, overflow, and accidentally dark application surfaces. Record each reviewed route and viewport in the verification report from Task 4.

- [ ] **Step 3: Handle any newly discovered failure through a fresh red-green cycle**

If the JSON or P0 inspection finds a defect not named in Task 2, stop production editing. Add an exact subtask to this plan containing the failing route, selector, measured colours/ratio, affected file, failing focused test, and minimal fix; then run that test RED and GREEN before re-running Step 1. If there are no new failures, make no extra UI changes.

- [ ] **Step 4: Capture and compare post-change Floodlight styles**

Run:

```bash
cd frontend
npm run audit:theme -- http://localhost:3000 --theme dark --output output/playwright/light-theme-sweep/dark-after.json --compare output/playwright/light-theme-sweep/dark-before.json
```

Expected: exit 0 and `darkDiffs: []`. Any difference blocks completion and must be traced to the exact changed property before proceeding.

---

### Task 4: Record evidence and run the repository test gate

**Files:**
- Create: `docs/LIGHT-THEME-SWEEP-2026-08-09.md`
- Modify: `docs/PRD-LIGHT-THEME-SWEEP.md`

**Interfaces:**
- Consumes: light/dark JSON artifacts and P0 visual review from Task 3.
- Produces: a committed verification report mapping each acceptance criterion to evidence.

- [ ] **Step 1: Correct the stale crash-page register description**

Update the `#f6f8f3` row in the PRD: it is the crash-page background, not body text. Record that primary ink `#0f2117` already measured 15.71:1, muted ink changed from `#6b7c71` at 4.14:1 to `#59685f` at 5.50:1, and the button pair measures 7.41:1. Do not rewrite the historical context beyond correcting this factual inversion.

- [ ] **Step 2: Write the verification report from actual output**

Create `docs/LIGHT-THEME-SWEEP-2026-08-09.md` with:

- commit/branch and audit date;
- route pattern inventory grouped P0/P1/P2;
- a row per route/viewport marked `verified`, `unavailable`, or `manual review` from `light-results.json`;
- every automated contrast failure found and its resolution (zero is written as zero, not omitted);
- P0 human-review checklist results;
- raw-colour allowlist paths and reasons;
- the dark comparison result and exact number of changed properties;
- baseline warnings that pre-dated the work;
- acceptance criteria 1–5 with direct evidence or an explicit unmet status.

Do not claim unavailable dynamic states were rendered.

- [ ] **Step 3: Run formatting and source checks**

Run from the repository worktree root:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended implementation/report files plus the pre-existing untracked `DESIGN-IS-2026-08-04/` directory.

- [ ] **Step 4: Run the full frontend test gate**

Run:

```bash
cd frontend
npm run typecheck && npm run lint && npm test -- --runInBand
```

Expected: exit 0 for all three. Compare warnings with the recorded baseline: one existing hook dependency warning, workspace-root warnings, and existing React `act(...)` warnings may remain; no warning may originate from a changed file.

- [ ] **Step 5: Review the final diff against the approved design**

Run:

```bash
git diff 2607654 --stat
git diff 2607654 -- frontend/app/globals.css frontend/components/TimelineSpine.tsx
git diff 2607654 -- frontend docs/PRD-LIGHT-THEME-SWEEP.md docs/LIGHT-THEME-SWEEP-2026-08-09.md
```

Expected: no diff for `globals.css` or `TimelineSpine.tsx`; every changed production file has the focused test/guard described above; no fixed-palette excluded surface changed.

- [ ] **Step 6: Commit the verification evidence**

Run:

```bash
git add docs/PRD-LIGHT-THEME-SWEEP.md docs/LIGHT-THEME-SWEEP-2026-08-09.md
git commit -m "docs: record daylight surface verification"
```

- [ ] **Step 7: Report the exact final evidence without pushing**

Report branch name, commits, full-suite counts, audit route/viewport totals, unavailable states, manual-review items, contrast-failure count, dark computed-style diff count, and remaining baseline warnings. Do not push or open a PR until the user explicitly requests shipping; outward GitHub writes are behind the repository stop gate.
