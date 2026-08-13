# Competition-card Branding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn all six platform-home competition links into fully branded Graphic split cards and replace the shared World Cup identity with the owner-supplied black, white, and trophy-gold mark.

**Architecture:** `PlatformHome` will pass each registry accent into one reusable `.competition-card` CSS contract, with a geometry-only modifier for the wide NRL card. `globals.css` will own invariant card inks, the solid accent/base layers, hover/focus/reduced-motion behavior, while `CompetitionLogo` will apply a World Cup-only centered square crop so the unchanged registry path updates every shared-logo consumer.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS plus component-layer CSS, Jest, Testing Library, Playwright browser QA.

## Global Constraints

- Apply the selected **Graphic split** direction to the five football cards and the large NRL card.
- Every card must be fully tournament-colored at rest; hover and focus add emphasis but never supply identity.
- Source every card color from the competition registry's existing `accentVar`; do not add per-card hexadecimal values to React.
- Preserve existing card copy, routes, responsive grid, typography hierarchy, and whole-card link semantics.
- Change World Cup from placeholder indigo to trophy gold while keeping Floodlight lime as the sole action color.
- Preserve the owner-supplied 682×398 PNG byte-for-byte at `frontend/public/competitions/wc26.png`; crop it only in presentation.
- Other competition marks remain `object-contain`; World Cup alone uses a centered `object-cover` square crop.
- Primary and supporting card copy must remain invariant light ink in Floodlight and Daylight and measure at least 4.5:1 on the dark copy field.
- Keyboard `:focus-visible` keeps the global lime outline and gets card emphasis equivalent to hover.
- Precise-pointer hover may lift the card 5–7 px; touch has no hover dependency; reduced motion removes every card transform without removing color or focus.
- No backend, database, prediction, billing, navigation-route, or competition data behavior changes.

---

### Task 1: Shared branded-card component contract

**Files:**
- Create: `frontend/components/__tests__/platformHome.competitionCards.test.tsx`
- Modify: `frontend/components/PlatformHome.tsx`

**Interfaces:**
- Consumes: `COMPETITIONS[id].accentVar: string`, where each value is a CSS token name such as `--accent-epl`.
- Produces: six links with `data-competition-card=<CompetitionId>`, class `.competition-card`, inline `--competition-card-accent: var(--accent-*)`, `.competition-card__copy`, and `.competition-card__arrow`; the NRL link also has `.competition-card--wide`.

- [ ] **Step 1: Write the failing home-card component test**

```tsx
import { render } from "@testing-library/react";
import { PlatformHome } from "@/components/PlatformHome";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

const competitionIds: CompetitionId[] = [
  "epl",
  "laliga",
  "bundesliga",
  "ucl",
  "wc26",
  "nrl",
];

describe("PlatformHome competition cards", () => {
  it("gives every competition the shared branded treatment and registry accent", () => {
    const { container } = render(<PlatformHome />);

    for (const id of competitionIds) {
      const card = container.querySelector(`[data-competition-card="${id}"]`);
      expect(card).toHaveClass("competition-card");
      expect(card).toHaveAttribute(
        "style",
        expect.stringContaining(
          `--competition-card-accent: var(${COMPETITIONS[id].accentVar})`,
        ),
      );
      expect(card?.querySelector(".competition-card__copy")).toBeInTheDocument();
      expect(card?.querySelector(".competition-card__arrow")).toBeInTheDocument();
    }

    expect(container.querySelectorAll("[data-competition-card]")).toHaveLength(6);
    expect(container.querySelector('[data-competition-card="nrl"]')).toHaveClass(
      "competition-card--wide",
    );
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `cd frontend && npm test -- --runInBand components/__tests__/platformHome.competitionCards.test.tsx`

Expected: FAIL because no link exposes `data-competition-card`, `.competition-card`, the shared custom property, or its child hooks.

- [ ] **Step 3: Add the typed CSS-property adapter and shared hooks**

In `PlatformHome.tsx`, import `CSSProperties`, add this helper, and apply its result to all six links:

```tsx
type CompetitionCardStyle = CSSProperties & {
  "--competition-card-accent": string;
};

function competitionCardStyle(accentVar: string): CompetitionCardStyle {
  return { "--competition-card-accent": `var(${accentVar})` };
}
```

For every football link, replace the neutral `glass card-hover` classes and thin top rule with `competition-card`; set `data-competition-card={id}` and `style={competitionCardStyle(competition.accentVar)}`. Add `.competition-card__arrow` to the arrow shell and `.competition-card__copy` to the region and description while keeping all visible text and routes unchanged.

For NRL, reuse the same props and hooks, add `.competition-card--wide`, remove its thin left rule, and apply `.competition-card__copy` to season/description plus `.competition-card__arrow` to the existing “Open NRL” affordance.

- [ ] **Step 4: Run the focused test and confirm the green state**

Run: `cd frontend && npm test -- --runInBand components/__tests__/platformHome.competitionCards.test.tsx`

Expected: PASS with six branded links and an NRL wide modifier.

- [ ] **Step 5: Commit the component contract**

```bash
git add frontend/components/PlatformHome.tsx frontend/components/__tests__/platformHome.competitionCards.test.tsx
git commit -m "feat(home): share competition card branding hooks"
```

### Task 2: Owner-supplied World Cup identity

**Files:**
- Modify: `frontend/components/__tests__/competitionLogo.test.tsx`
- Modify: `frontend/components/CompetitionLogo.tsx`
- Replace: `frontend/public/competitions/wc26.png`

**Interfaces:**
- Consumes: `COMPETITIONS.wc26.logoSrc === "/competitions/wc26.png"` and the existing `competition`, `size`, `className`, and `labelled` props.
- Produces: World Cup `<img>` classes `object-cover object-center p-0`; every other competition retains `object-contain p-[4%]`; the public asset has SHA-256 `4c18cc1d14e4fdf3e6aa2e1ec4b066f945a6943cbb807b9cce6c919d166999e4`.

- [ ] **Step 1: Extend the logo test with crop, semantics, and asset-integrity assertions**

```tsx
import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";

it("uses the owner-supplied World Cup mark with a centered square crop", () => {
  const { container } = render(
    <CompetitionLogo competition="wc26" size={40} labelled />,
  );
  const image = container.querySelector('[data-competition-logo="wc26"] img');

  expect(image).toHaveAttribute("src", "/competitions/wc26.png");
  expect(image).toHaveAttribute("alt", "World Cup 2026 logo");
  expect(image).toHaveClass("object-cover", "object-center", "p-0");
  expect(image).not.toHaveClass("object-contain");

  const bytes = readFileSync(join(process.cwd(), "public/competitions/wc26.png"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "4c18cc1d14e4fdf3e6aa2e1ec4b066f945a6943cbb807b9cce6c919d166999e4",
  );
});
```

Keep the existing EPL assertion and strengthen it to require `object-contain p-[4%]` and forbid `object-cover`.

- [ ] **Step 2: Run the focused test and confirm the red state**

Run: `cd frontend && npm test -- --runInBand components/__tests__/competitionLogo.test.tsx`

Expected: FAIL because World Cup still uses `object-contain` and the current public asset hash differs.

- [ ] **Step 3: Replace the public asset byte-for-byte**

Copy `/var/folders/l6/c33b_xjj6k5f0b9dl2xn_4b40000gn/T/codex-clipboard-92105d8e-4447-47cc-a9d6-213cb7b5b6a3.png` to `frontend/public/competitions/wc26.png`, then verify:

```bash
shasum -a 256 frontend/public/competitions/wc26.png
```

Expected: `4c18cc1d14e4fdf3e6aa2e1ec4b066f945a6943cbb807b9cce6c919d166999e4`.

- [ ] **Step 4: Implement the World Cup-only presentation crop**

Replace the fixed image class in `CompetitionLogo.tsx` with:

```tsx
className={cn(
  "h-full w-full drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]",
  competition === "wc26"
    ? "object-cover object-center p-0"
    : "object-contain p-[4%]",
)}
```

Do not change the registry path or accessible-name behavior.

- [ ] **Step 5: Run the focused test and confirm the green state**

Run: `cd frontend && npm test -- --runInBand components/__tests__/competitionLogo.test.tsx`

Expected: PASS, including the exact asset checksum.

- [ ] **Step 6: Commit the global identity replacement**

```bash
git add frontend/components/CompetitionLogo.tsx frontend/components/__tests__/competitionLogo.test.tsx frontend/public/competitions/wc26.png
git commit -m "feat(brand): use supplied World Cup identity"
```

### Task 3: Graphic split surfaces, motion, and contrast

**Files:**
- Create: `frontend/components/__tests__/competitionCardStyles.test.ts`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `.competition-card`, `.competition-card--wide`, `.competition-card__copy`, `.competition-card__arrow`, `[data-competition-logo]`, and inline `--competition-card-accent` from Task 1.
- Produces: invariant tokens `--competition-card-base`, `--competition-card-ink`, `--competition-card-copy`; trophy-gold `--accent-wc26`; solid at-rest card/base layers; precise-pointer hover; focus-visible parity; explicit reduced-motion transform neutralization.

- [ ] **Step 1: Write a source contract and contrast test**

Create a test that reads `app/globals.css`, extracts named rule blocks, parses the three new invariant HSL tokens, and asserts:

```ts
expect(root).toMatch(/--accent-wc26:\s*42 72% 52%/);
expect(root).toMatch(/--competition-card-base:\s*150 34% 8%/);
expect(root).toMatch(/--competition-card-ink:\s*120 14% 96%/);
expect(root).toMatch(/--competition-card-copy:\s*126 14% 82%/);

expect(rule(".competition-card {")).toContain(
  "color-mix(in hsl, hsl(var(--competition-card-accent)) 18%, hsl(var(--competition-card-base)))",
);
expect(rule(".competition-card::before {")).toContain(
  "background: hsl(var(--competition-card-accent))",
);
expect(rule(".competition-card--wide::before {")).toContain("clip-path");
expect(rule(".competition-card__copy {")).toContain(
  "color: hsl(var(--competition-card-copy))",
);
expect(css).toContain("@media (hover: hover) and (pointer: fine)");
expect(css).toContain(".competition-card:hover");
expect(css).toContain(".competition-card:focus-visible");
expect(css).toContain("@media (prefers-reduced-motion: reduce)");
expect(css).toMatch(/\.competition-card:hover,[\s\S]*?transform:\s*none/);
```

Use the HSL-to-sRGB and WCAG luminance helpers already established in `frontend/lib/__tests__/daylightSemanticContrast.test.ts` to assert both `--competition-card-ink` and `--competition-card-copy` are at least 4.5:1 against `--competition-card-base`.

- [ ] **Step 2: Run the style test and confirm the red state**

Run: `cd frontend && npm test -- --runInBand components/__tests__/competitionCardStyles.test.ts`

Expected: FAIL because the card selectors/tokens do not exist and World Cup is still indigo.

- [ ] **Step 3: Add invariant card tokens and trophy-gold World Cup accent**

In `:root`, change World Cup to `--accent-wc26: 42 72% 52%` and add:

```css
--competition-card-base: 150 34% 8%;
--competition-card-ink: 120 14% 96%;
--competition-card-copy: 126 14% 82%;
```

Do not override these tokens in `.theme-daylight`; the branded cards deliberately remain invariant surfaces.

- [ ] **Step 4: Implement the Graphic split card layer in `@layer components`**

Add the following component layer. The football polygon ends before the body copy begins; the fixed-width NRL polygon sits behind its 64 px logo without painting the copy field bright.

```css
.competition-card {
  position: relative;
  isolation: isolate;
  color: hsl(var(--competition-card-ink));
  background: color-mix(
    in hsl,
    hsl(var(--competition-card-accent)) 18%,
    hsl(var(--competition-card-base))
  );
  border: 1px solid hsl(var(--competition-card-accent) / 0.52);
  box-shadow:
    inset 0 1px 0 hsl(var(--competition-card-ink) / 0.08),
    0 16px 38px -24px hsl(var(--competition-card-accent) / 0.62);
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    border-color 0.24s ease,
    box-shadow 0.24s ease,
    filter 0.24s ease;
}

.competition-card::before {
  content: "";
  position: absolute;
  z-index: -2;
  inset: -2px;
  background: hsl(var(--competition-card-accent));
  clip-path: polygon(0 0, 100% 0, 62% 28%, 0 47%);
  transform-origin: top left;
  transition: transform 0.3s cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}

.competition-card::after {
  content: "";
  position: absolute;
  z-index: -1;
  inset: 0;
  border: 1px solid hsl(var(--competition-card-ink) / 0.08);
  border-radius: inherit;
  box-shadow: inset 0 -42px 64px hsl(var(--competition-card-base) / 0.24);
  pointer-events: none;
}

.competition-card > * {
  position: relative;
  z-index: 1;
}

.competition-card--wide::before {
  clip-path: polygon(0 0, 116px 0, 96px 100%, 0 100%);
}

.competition-card__copy {
  color: hsl(var(--competition-card-copy));
}

.competition-card__arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 2rem;
  min-height: 2rem;
  padding: 0.4rem;
  border: 1px solid hsl(var(--competition-card-ink) / 0.16);
  border-radius: 999px;
  color: hsl(var(--competition-card-ink));
  background: hsl(var(--competition-card-base) / 0.58);
  transition:
    transform 0.28s cubic-bezier(0.22, 1, 0.36, 1),
    background-color 0.24s ease,
    border-color 0.24s ease;
}

.competition-card [data-competition-logo] {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 5: Add precise hover, keyboard focus, and reduced-motion behavior**

Inside the component layer, add exact hover-capability and keyboard rules:

```css
@media (hover: hover) and (pointer: fine) {
  .competition-card:hover {
    transform: translateY(-6px);
    border-color: hsl(var(--competition-card-accent) / 0.84);
    box-shadow:
      inset 0 1px 0 hsl(var(--competition-card-ink) / 0.12),
      0 22px 46px -22px hsl(var(--competition-card-accent) / 0.78);
    filter: saturate(1.08);
  }

  .competition-card:hover::before {
    transform: scale(1.055) rotate(-1.5deg);
  }

  .competition-card:hover [data-competition-logo] {
    transform: translateY(-3px) scale(1.055);
  }

  .competition-card:hover .competition-card__arrow {
    transform: translateX(4px);
    background: hsl(var(--competition-card-base) / 0.74);
    border-color: hsl(var(--competition-card-ink) / 0.28);
  }
}

.competition-card:focus-visible {
  transform: translateY(-6px);
  border-color: hsl(var(--competition-card-accent) / 0.84);
  box-shadow:
    inset 0 1px 0 hsl(var(--competition-card-ink) / 0.12),
    0 22px 46px -22px hsl(var(--competition-card-accent) / 0.78);
}

.competition-card:focus-visible::before {
  transform: scale(1.055) rotate(-1.5deg);
}

.competition-card:focus-visible [data-competition-logo] {
  transform: translateY(-3px) scale(1.055);
}

.competition-card:focus-visible .competition-card__arrow {
  transform: translateX(4px);
  background: hsl(var(--competition-card-base) / 0.74);
  border-color: hsl(var(--competition-card-ink) / 0.28);
}
```

In the existing `@media (prefers-reduced-motion: reduce)` block, add:

```css
.competition-card,
.competition-card::before,
.competition-card [data-competition-logo],
.competition-card .competition-card__arrow {
  transition: none;
}

.competition-card:hover,
.competition-card:focus-visible,
.competition-card:hover::before,
.competition-card:focus-visible::before,
.competition-card:hover [data-competition-logo],
.competition-card:focus-visible [data-competition-logo],
.competition-card:hover .competition-card__arrow,
.competition-card:focus-visible .competition-card__arrow {
  transform: none;
}
```

- [ ] **Step 6: Run focused style and component tests**

Run: `cd frontend && npm test -- --runInBand components/__tests__/competitionCardStyles.test.ts components/__tests__/platformHome.competitionCards.test.tsx components/__tests__/competitionLogo.test.tsx components/__tests__/themeTokens.test.ts lib/__tests__/daylightSemanticContrast.test.ts`

Expected: PASS; the existing theme tests confirm the new component layer does not regress shared theme tokens.

- [ ] **Step 7: Commit the visual system**

```bash
git add frontend/app/globals.css frontend/components/__tests__/competitionCardStyles.test.ts
git commit -m "feat(home): add graphic split competition cards"
```

### Task 4: Full automated and real-browser verification

**Files:**
- Modify only if verification exposes a scoped defect in the files above.
- Capture: local desktop and phone screenshots outside tracked source.

**Interfaces:**
- Consumes: the completed card and logo implementation from Tasks 1–3.
- Produces: evidence that the build, full suites, accessibility interactions, both themes, and responsive layouts are release-ready.

- [ ] **Step 1: Run the complete frontend gate**

Run:

```bash
cd frontend
npm run typecheck
npm run lint
npm test -- --runInBand
npm run build
```

Expected: all commands exit 0 with no TypeScript, ESLint, Jest, or production-build failures.

- [ ] **Step 2: Run the repository's real test gate**

Run from the worktree root: `make test`

Expected: backend/Python and frontend checks all exit 0. If an environment-only dependency prevents the wrapper, report the exact blocker and retain the independently passing frontend and Python evidence; do not claim the wrapper passed.

- [ ] **Step 3: Verify responsive rendering in a real browser**

Start the optimized local app and inspect `/` at 320, 390, 768, and 1,280 px in both Floodlight and Daylight. At every width assert `document.documentElement.scrollWidth === document.documentElement.clientWidth`, all six `[data-competition-card]` links are visible and colored at rest, and the World Cup logo shows the centered trophy/26/FIFA crop without the source image's lower-left stray mark.

- [ ] **Step 4: Verify interaction and motion preferences**

At 1,280 px, record the first card's computed `transform`, border color, shadow, logo transform, and arrow transform before and during precise hover. Tab to a card and confirm `:focus-visible`, a visible lime outline, and equivalent field/logo/arrow emphasis. Emulate `prefers-reduced-motion: reduce`, repeat hover/focus, and confirm computed transforms stay `none` while the colored background and outline remain.

- [ ] **Step 5: Capture visual proof**

Save one 1,280 px desktop screenshot containing the five football cards and one 390 px full-page screenshot containing the stacked football cards plus NRL. Inspect both images directly before declaring visual acceptance.

- [ ] **Step 6: Run a fresh review and resolve findings**

Give a fresh reviewer the approved design spec, this plan, the complete diff, and test/browser evidence. Address every verified Important or Critical finding, rerun the affected focused tests, then rerun the full frontend gate.

- [ ] **Step 7: Commit any verification fixes**

If QA changed tracked files:

```bash
git add frontend
git commit -m "fix(home): resolve competition card QA findings"
```

If no tracked files changed, do not create an empty commit.

### Task 5: Prepare the guarded integration handoff

**Files:**
- No planned source changes.

**Interfaces:**
- Consumes: green tests, reviewed diff, visual proof, and the clean feature branch.
- Produces: a pushed private branch and ready pull request; merging remains behind the repository stop gate.

- [ ] **Step 1: Confirm final branch scope**

Run:

```bash
git status --short --branch
git diff --stat origin/main...HEAD
git log --oneline origin/main..HEAD
```

Expected: only the approved design spec, implementation plan, card/logo source, exact asset, and focused tests are present; the worktree is clean.

- [ ] **Step 2: Push and open the pull request**

Push `codex/competition-card-branding` and open a non-draft pull request summarizing the Graphic split design, exact World Cup asset replacement, accessibility behavior, test results, and browser evidence.

- [ ] **Step 3: Monitor CI to green**

Wait for every required check on the pull request. Resolve verified failures and review feedback on the feature branch, push fixes, and continue until CI and review are green.

- [ ] **Step 4: Stop at the production gate**

Present the actual final diff, green CI/review evidence, screenshots, and deployment impact in plain English, then wait for the owner's explicit `go` before merging to `main`. Do not merge or deploy during this step.
