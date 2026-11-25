> Retired 2026-11-25: Premium was removed and everything is free. Kept for history.

# Premium discovery & promotion

Status: approved design (2026-08-11)
Sequence: ships first — independent of, and prior to, the Payment Element
signup spec (`2026-08-11-payment-element-signup-design.md`).

## Problem

FinalWhistle Premium is live in production but effectively undiscoverable.
There is **no link to `/premium` anywhere in the site navigation**. The only
two routes to the page are:

- the blurred `PremiumGate` teaser on football match detail pages, and
- the "Manage subscription" item in the account menu — which renders only for
  users who are *already* subscribers.

A signed-out visitor browsing fixtures, standings or the leaderboard has no
path to the pricing page at all. This is a discoverability defect first and a
marketing gap second, and it is independent of how checkout itself works:
`/premium` is already live, so this can ship on its own.

## Principles

- **Match the house voice.** The platform's credibility rests on not
  overclaiming ("probabilities are published with their uncertainty — not as
  promises"). Premium copy states what you get and what it costs. No urgency
  tactics, countdowns, or fake scarcity.
- **Never sell to an existing subscriber.** Both surfaces hide when the
  viewer is already premium.
- **Stay invisible when billing is off.** Both surfaces are gated on
  `BILLING_ENABLED`, so an unconfigured deploy looks exactly as it did before
  Premium existed — the same rule every other premium surface follows.
- Additive only: no existing nav entry, section, or route changes behaviour.

## Design

### 1. Home page section

A new `PremiumPromo` component rendered on the platform home
(`components/PlatformHome.tsx`), placed **after** the "Think you can beat the
model?" pitch panel (the `panel-pitch` section) and **before** the closing
"Probabilities are published with their uncertainty" line. This follows the
page's existing section rhythm: Explore → Play → Premium → closing note.

Content:

- Eyebrow: `Premium` (the `text-label` uppercase treatment used by the other
  sections)
- Heading: what the tier is, in one line
- The four benefits already listed on `/premium`, kept verbatim so the two
  pages cannot drift:
  - Full correct-score probability grid for every match
  - Over/under lines, BTTS and Asian handicap probabilities
  - Supporter badge on the leaderboard
  - Early access to new competitions and features
- Price line: `$4.99/month or $39.99/year · 7-day free trial`
- CTA: a link to `/premium` labelled `See what's included`

The benefit list is defined once and imported by both this component and
`PremiumClient`, so the home page and the pricing page cannot describe the
tier differently.

### 2. Persistent header link

A `Premium` link in `SiteNav`, rendered **alongside `ThemeToggle` and
`AuthButton`** rather than inside either nav-link registry.

This placement is deliberate. The header's link row is built from two
different sources: `PLATFORM_LINKS` for platform routes, and
`COMPETITIONS[<id>].navLinks` for competition routes. Adding "Premium" to
`PLATFORM_LINKS` would make it vanish the moment a visitor opens
`/football/epl` — i.e. on most of the site's traffic. Rendering it as a
persistent element outside both registries means it appears on every route,
requires no change to either registry, and leaves the deliberately-capped
five-tab mobile `BottomNav` untouched.

`BottomNav` is not modified. Its five-tab cap is an existing design decision
with its own regression tests; the header link covers mobile.

### Visibility rules (both surfaces)

Render only when **all** hold:

- `BILLING_ENABLED` is true
- the viewer is not already premium (`user?.premium` is falsy)

The auth-loading state renders nothing rather than flashing the promo and
retracting it — `useAuth()` exposes `loading` for exactly this.

## Error handling

Neither surface fetches data: benefits and prices are static copy, and the
premium flag comes from the existing `useAuth()` context. There is no request
to fail. If `useAuth()` has no user yet, the surfaces render as they do for a
signed-out visitor, which is the correct state for an anonymous viewer.

## Testing

- `PremiumPromo`: renders benefits, price and CTA when billing is on and the
  viewer is free; renders nothing when `BILLING_ENABLED` is false; renders
  nothing for a premium user; renders nothing while auth is loading.
- `SiteNav`: the Premium link is present on a platform route (`/`) **and** on
  a competition route (`/football/epl`) — the latter is the regression that
  motivated the placement decision; absent when billing is off; absent for a
  premium viewer.
- `BottomNav`: existing five-tab assertions must still pass unchanged.
- Full frontend suite (`typecheck`, `jest`, `lint`) green.

## Non-goals

- No signup-moment prompt, leaderboard nudge, or record-page nudge (both were
  considered and deliberately left out to keep the promotion restrained).
- No changes to `BottomNav`, the nav registries, or the mobile tab cap.
- No changes to `/premium` itself, checkout, entitlement, or the backend.
- No analytics/experimentation framework for the promo — if conversion
  measurement is wanted later it is its own piece of work.
