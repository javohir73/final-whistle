# Competition-card branding and World Cup identity

**Status:** approved design
**Date:** 2026-08-12
**Source:** owner-provided visual direction and World Cup 2026 raster mark

## Outcome

The platform-home competition cards become fully branded surfaces rather than
neutral glass cards with a thin accent line. The selected direction is
**Graphic split**: every card is visibly colored at rest, with a dark
tournament-color base and a solid diagonal accent field. Hover and keyboard
focus add motion and depth; they do not supply the color identity.

The football cards and the large NRL card use the same visual system. The
owner-provided FIFA World Cup 2026 trophy mark replaces the existing World Cup
placeholder everywhere the shared competition logo renders.

## Confirmed decisions

- Use the Graphic split direction selected in the visual prototype.
- Color is present before hover on mouse, touch, keyboard, and reduced-motion
  devices.
- Include the large NRL card in the same system, using the existing teal
  competition accent.
- Replace the World Cup mark globally, not only on the platform home.
- Give World Cup a black, white, and trophy-gold identity instead of the
  placeholder indigo identity.
- Preserve the existing card content, routes, grid, typography, and page
  hierarchy. This is a competition-identity treatment, not a home-page
  redesign.

## Visual design

### Resting state

Each card owns a `--competition-card-accent` value sourced from the existing
competition registry's `accentVar`. The shared treatment derives:

- a dark, saturated base by mixing the accent with the Floodlight canvas;
- a solid diagonal accent field occupying the upper/leading part of the card;
- a subtle brand-tinted border and inset highlight;
- invariant light primary text and translucent light supporting text;
- a small translucent circular surface behind the arrow.

The diagonal field must not cross behind small supporting copy at a brightness
that reduces readability. The title and description sit primarily on the dark
base; the logo sits on the solid accent field.

Competition identity remains token-driven:

| Competition | Card identity |
|---|---|
| Premier League | purple |
| La Liga | coral |
| Bundesliga | red |
| UEFA Champions League | UEFA blue |
| World Cup 2026 | trophy gold over a near-black base |
| NRL | teal |

The World Cup `--accent-wc26` token changes from placeholder indigo to trophy
gold. Existing low-opacity consumers such as the competition overlay and
eyebrow inherit the corrected identity without becoming gold action controls.
Floodlight lime remains the platform's sole action color.

### Hover and focus

On devices that support precise hover, the card:

- lifts approximately 5–7 px;
- gains a slightly brighter border and tournament-colored shadow;
- increases saturation/brightness modestly;
- expands/rotates the diagonal field a few degrees;
- raises and slightly scales the logo;
- moves the arrow to the right and strengthens its circular surface.

Keyboard `:focus-visible` receives the same emphasis while retaining the
global high-contrast lime focus outline. The effect must not depend on pointer
hover, and `:focus` without `:focus-visible` must not introduce a persistent
mouse-click treatment.

Touch devices receive the complete resting design and no synthetic hover-only
state. The existing global `prefers-reduced-motion` guard disables transforms
and transitions; branded colors remain unchanged.

### Daylight theme

Competition cards remain colored in Daylight rather than turning into white
glass panels. Their palette is an intentionally invariant brand surface, like
the existing pitch panels. Primary and supporting copy use card-specific light
ink rather than the page's Daylight foreground/muted tokens.

All normal-size copy must measure at least 4.5:1 against every part of its
effective background. Interactive boundaries and the keyboard focus indicator
must meet the 3:1 non-text contrast requirement. If a bright accent cannot
support light copy, geometry—not a weaker text color—keeps copy on the darker
field.

## Component architecture

### Shared card treatment

`frontend/components/PlatformHome.tsx` keeps ownership of the home-page content
and route list. It applies one reusable `.competition-card` treatment to both
the football links and NRL link and passes the registry accent through a typed
CSS custom property.

The NRL variant keeps its existing responsive wide layout but uses the same
background layers, border, arrow, and interaction semantics. A narrow modifier
may adjust diagonal-field geometry for the horizontal card; it must not fork
the palette or interaction system.

The visual layers and motion live in `frontend/app/globals.css`, where pseudo
elements, hover-capability queries, focus-visible rules, and reduced-motion
behavior can be expressed once. No card-specific hexadecimal palette is added
to the React component.

### World Cup asset

The owner-supplied 682×398 RGBA PNG becomes the self-hosted
`frontend/public/competitions/wc26.png` asset, preserving the supplied artwork.
The source contains a wide black canvas and a stray partial mark at the lower
left edge. The shared `CompetitionLogo` component presents World Cup with a
centered `object-cover` square crop; this keeps the white “26,” gold trophy,
FIFA wordmark, and black field while excluding the stray edge. Other
competition logos retain the current transparent `object-contain` treatment.

The registry path remains `/competitions/wc26.png`, so the replacement reaches
navigation, competition overlays, Play, cards, and any future shared-logo
consumer without route-level exceptions.

The new raster is decorative wherever the surrounding link or heading already
names World Cup 2026. The existing `labelled` mode continues to expose
`World Cup 2026 logo` when a consumer explicitly requests a labelled mark.

## Files in scope

- `frontend/components/PlatformHome.tsx`
- `frontend/components/CompetitionLogo.tsx`
- `frontend/app/globals.css`
- `frontend/lib/sports.ts` (World Cup accent identity only)
- `frontend/public/competitions/wc26.png`
- focused component, source, contrast, and responsive tests

No backend, database, prediction, navigation-route, billing, or competition
data behavior changes.

## Accessibility and resilience

- The whole card remains one semantic link with its current accessible name.
- Visible color is decorative; competition name and region remain textual, so
  the cards never communicate identity by color alone.
- Keyboard focus remains obvious and receives equivalent visual emphasis.
- `prefers-reduced-motion` removes lift, field motion, logo motion, and arrow
  motion without removing color or focus indication.
- Failed logo loading degrades to the existing text-labelled card; the card
  background does not depend on image pixels.
- The layout keeps the current responsive breakpoints and must introduce no
  horizontal overflow at 320, 390, 768, or 1,280 px.

## Test strategy

Implementation follows red-green-refactor:

1. Add a platform-home component test that fails until all six cards expose the
   shared branded-card treatment and their registry-driven accent property.
2. Add a World Cup logo test that fails until the shared renderer uses the
   `/competitions/wc26.png` asset with the World Cup-only crop treatment while
   another logo remains `object-contain`.
3. Add a source/CSS contract test that fails until the treatment defines a
   solid resting background, focus-visible parity, precise-hover motion, and
   reduced-motion neutralization.
4. Add or extend semantic contrast tests for primary/supporting text on the
   darkest and brightest effective fields in both themes.
5. Run the focused Jest tests after each red-green cycle, then the complete
   frontend gate: typecheck, lint, Jest, and optimized production build.
6. Browser-QA both themes at 320, 390, 768, and 1,280 px. Verify all six resting
   colors, mouse hover, keyboard focus, reduced motion, logo cropping, and zero
   overflow. Capture at least one desktop and one phone screenshot for visual
   review.

## Acceptance criteria

- All football and NRL competition cards are fully tournament-colored before
  interaction.
- The selected Graphic split geometry is visibly consistent across vertical
  football cards and the horizontal NRL card.
- Hover/focus adds the approved lift, diagonal-field, logo, and arrow effects.
- World Cup uses black/white/gold branding and the supplied trophy mark
  everywhere the shared logo component is used.
- Both themes meet contrast requirements, touch does not depend on hover, and
  reduced-motion removes movement.
- No route, copy, competition data, or prediction behavior changes.

## Non-goals

- Recoloring match cards, standings rows, navigation bars, or competition
  pages beyond the corrected low-opacity World Cup accent consumers.
- Deriving colors dynamically from raster pixels at runtime.
- Introducing JavaScript-driven pointer animations, parallax, sound, or
  persistent hover state.
- Rebuilding or redrawing the supplied World Cup mark.
- Changing the home-page card grid, descriptions, or section order.
