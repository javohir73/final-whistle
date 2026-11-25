> Retired 2026-11-25: Premium was removed and everything is free. Kept for history.

# FinalWhistle Premium — fan subscription tier

Status: approved design (2026-08-11)
Decisions locked with the founder: fan-facing premium tier first; premium
includes advanced markets, simulators, deep model intel, and perks/early
access; pricing $4.99/month or $39.99/year with a 7-day free trial; Stripe
hosted checkout; purchase is web-only at launch.

## Problem

FinalWhistle has no monetization surface. The PRD reserved "a clean path to
ads or a premium analyst tier later" (tasks/prd-wc26-prediction-platform.md
§600) and the engine roadmap shipped the pricing machinery — derived markets
behind `/v1/markets` (backend/app/api/markets.py) — with no fan-facing UI.
This spec adds a paid subscription ("FinalWhistle Premium") without touching
the free product or the platform's trust posture.

## Principles

- Nothing free today becomes paid. Match probabilities, headline scorelines,
  the "why" panel, explainability, the model record pages, tips, leaderboards,
  and the NRL run-home simulator (grandfathered for the 2026 season) all stay
  free. Premium is additive.
- The analytics framing and disclaimers are unchanged: model probabilities,
  "not betting advice", no affiliate links, no betting framing (PRD §489,
  §600-601 posture holds for the premium tier).
- Web-only purchase. The Capacitor shells are not in the stores yet, so no
  Apple IAP dependency now. Revisit when an iOS submission is real.
- Billing is env-gated like every other integration in this repo: with no
  `STRIPE_SECRET_KEY` configured, no billing surface renders and the site
  behaves exactly as today.

## Billing approach

Stripe Checkout (hosted) plus the Stripe Customer Portal. Card data never
touches our servers; the portal provides cancel/upgrade/invoice management
with no custom UI; Stripe test mode makes the flow testable in CI. Tax:
launch without Stripe Tax, revisit once there is real revenue (registration
thresholds are far away at current volume). The merchant-of-record
alternative (Paddle/Lemon Squeezy) was considered and declined: ~5%+ fees to
outsource tax admin we do not yet need.

Two Stripe Prices (monthly $4.99, annual $39.99) under one Product, both
with a 7-day trial, referenced by env-configured price IDs — never hardcoded.

## Design

### Data model

New `subscriptions` table (Alembic migration):

- `id`, `user_id` (FK users, unique — one subscription row per user)
- `stripe_customer_id`, `stripe_subscription_id` (unique, indexed)
- `status` (str: Stripe's own vocabulary — `trialing`, `active`, `past_due`,
  `canceled`, etc.), `plan` (`monthly` | `annual`)
- `current_period_end` (tz-aware datetime), `created_at`, `updated_at`

The migration follows the house sequencing rule (CLAUDE.md): merge the
migration, dispatch `refresh.yml`, confirm success, and only then let the
dependent code path serve — behind the stop gate.

### Entitlement

One resolver, `is_premium(user) -> bool`, in the backend: true when the
subscription status is `trialing` or `active`, or `past_due` within a 7-day
grace window; a canceled subscription keeps premium until
`current_period_end`. Server-side enforcement on every premium endpoint —
the frontend gate is presentation, not security. `GET /api/auth/me` gains a
`premium: bool` field so the frontend renders from one source of truth.

Subscribing requires an account (existing first-party auth). Anonymous
device users see "create an account to go premium" — the same account
upgrade path the tips claim flow already uses.

### Billing endpoints

- `POST /api/billing/checkout-session` (auth required): creates a Stripe
  Checkout session for the chosen price, `success_url`/`cancel_url` back to
  the app; reuses the stored `stripe_customer_id` when present.
- `POST /api/billing/portal-session` (auth required): returns a Customer
  Portal URL.
- `POST /api/billing/webhook`: raw-body signature verification
  (`STRIPE_WEBHOOK_SECRET`), idempotent by Stripe event id (processed ids
  recorded in a `billing_events` table created by the same migration;
  replays are no-ops). Handles `checkout.session.completed`,
  `customer.subscription.updated`, `customer.subscription.deleted`, and
  `invoice.payment_failed` by upserting the subscription row from the event
  payload. Unknown event types are acknowledged and ignored.

### Premium content — Phase A

Advanced markets panel on the football match detail page: full correct-score
probability grid, over/under lines, BTTS, and Asian handicap. A new consumer
endpoint, `GET /api/matches/{id}/markets` (entitlement-checked), reuses
the same pricing internals that serve `/v1/markets` — no new math, no new
model surface, frozen pre-kickoff basis identical to the B2B API. Plus the
supporter badge: a small premium marker on leaderboard rows for subscribed
accounts.

### Frontend

- `/premium` pricing page: monthly/annual toggle, trial copy, feature list,
  FAQ, and the standard disclaimer block. Hidden (404) when billing is not
  configured, controlled by a public env flag mirroring the backend gate.
- `PremiumGate` component: for free users renders a teaser (blurred/sample
  markets grid) with an upgrade CTA; for premium users renders children.
- Account menu: "Manage subscription" linking to the portal session.
- Checkout return states: success (poll `/api/auth/me` until `premium`
  flips, then thank-you) and cancel (return to `/premium` unchanged).

## Phasing

- Phase A (this spec's implementable scope): migration, webhook + billing
  endpoints, entitlement resolver, `/premium` page, `PremiumGate`, advanced
  markets panel, supporter badge.
- Phase B (separate plan): deep model intel — market-intel panel, extended
  probability history.
- Phase C (separate plan): the football league run-home simulator ships as
  premium; NRL run-home stays free through the 2026 season.
- Early access thereafter is policy via the entitlement flag, not new code.

## Error handling

- Webhook processing is idempotent and returns 2xx only after the row is
  durably updated; Stripe retries otherwise. Signature failures return 400
  and log to Sentry.
- Missed webhooks self-heal: on `/api/auth/me`, if the local row is stale
  past its period end, re-fetch the subscription from Stripe once and
  reconcile (bounded, cached; no Stripe call on the hot path otherwise).
- Stripe API downtime degrades to free-tier rendering with the upgrade CTA
  disabled — never a hard error on public pages.
- `past_due` shows a "payment issue" banner during the grace window.

## Testing

- pytest: webhook handler against fixture events for the four handled types
  plus a replayed duplicate and a bad signature; entitlement resolver across
  every status/period-end combination; premium endpoint returns 403 for
  free users and 200 for premium; billing endpoints require auth.
- Jest/RTL: `PremiumGate` free/premium/unconfigured states; pricing page
  renders both prices and the trial copy.
- End-to-end against Stripe test mode (checkout → webhook → premium flips)
  before any production flip. Full suites (`make test`) as the final gate.
- Production rollout (live keys, migration dispatch, deploy) is stop-gated.

## Non-goals

- No B2B pricing tiers (the `/v1` API-key gate stays as-is).
- No Apple/Google IAP.
- No change to free surfaces, the tips loop, leaderboard scoring, or the
  model/pipeline.
- No ads.
- No friends-league premium hooks — the social loop stays free.

## Open items (decide at implementation or later)

- Terms/privacy updates and a refund policy page: copy drafted during
  Phase A, founder reviews before the production flip.
- Stripe Tax: off at launch; revisit at real revenue.
- iOS IAP strategy: decide when an App Store submission is scheduled.
