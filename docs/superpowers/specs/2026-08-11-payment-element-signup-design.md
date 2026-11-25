> Retired 2026-11-25: Premium was removed and everything is free. Kept for history.

# Payment Element signup (in-page subscribe)

Status: approved design (2026-08-11)
Sequence: ships after `2026-08-11-premium-discovery-design.md`.
Supersedes the redirect half of `2026-08-11-premium-subscriptions-design.md`;
the webhook, entitlement and Customer Portal decisions there still stand.

## Problem

Subscribing currently redirects to Stripe's hosted Checkout at
`checkout.stripe.com` and back. The founder wants the payment form rendered
in FinalWhistle's own design, on `/premium`, with no redirect.

## Principles

- **Do not disturb the webhook or entitlement rules.** `apply_event`,
  `apply_subscription_object`, `is_premium` and `reconcile_if_stale` went
  through four review rounds that found real defects (the resubscribe rebind,
  the dunning-driven revocation). This change must leave their assumptions —
  above all *a Stripe subscription exists only after a card is collected* —
  exactly as they are.
- Card data still never touches this server: Payment Element renders inside
  Stripe's own iframes, so PCI scope is unchanged from hosted Checkout.
- Env-gated off by default, same as today.
- Error detail shape stays `{"code", "message"}`; the global handler wraps it
  as `{"error": {...}}` on the wire.

## Chosen architecture: collect the card first

The subscription is created **after** the card is confirmed, via a
SetupIntent. The alternative — creating the subscription up front with
`payment_behavior: "default_incomplete"` and driving the form from its
`pending_setup_intent` — was rejected for two reasons specific to this
codebase:

1. **It grants access before payment details exist.** With a trial, nothing
   is due today, so the subscription is created in `trialing` state the
   moment the form opens. The existing webhook would write a row and
   `is_premium` would return true — meaning anyone could open the form, close
   the tab, and hold 7 days of Premium without ever entering a card.
2. **It burns the trial on abandonment.** The existing anti-abuse rule grants
   the trial only when no prior `Subscription` row exists. An abandoned
   attempt would leave a row, so the user's next genuine attempt would be
   charged from day one.

Collecting the card first reproduces hosted Checkout's semantics exactly, so
neither problem arises and no downstream logic changes.

## Backend

### `POST /api/billing/setup-intent` (new)

Auth required, `require_same_origin`, billing-enabled gate.

1. 409 `already_subscribed` if `is_premium(sub)` — same rule the checkout
   endpoint uses today.
2. Ensure a Stripe Customer exists: reuse `sub.stripe_customer_id` when
   present, else create one (`email=user.email`,
   `metadata.user_id=str(user.id)`) and persist it on the `Subscription` row,
   creating the row with status `incomplete` if there isn't one.
   *This row is not an entitlement:* `is_premium` returns false for
   `incomplete`, and the trial guard is being changed (below) so its presence
   cannot burn a trial.
3. Create a SetupIntent: `customer`, `usage="off_session"`,
   `automatic_payment_methods={"enabled": True}` (this is what makes Apple
   Pay / Google Pay appear), `metadata.user_id`.
4. Return `{"client_secret": ...}` only.

### `POST /api/billing/subscribe` (new)

Auth required, `require_same_origin`, billing-enabled gate.
Body: `{"plan": "monthly"|"annual", "setup_intent_id": str}`.

1. **Ownership check (security-critical).** Retrieve the SetupIntent from
   Stripe by id and reject unless *both*: its `customer` equals this user's
   stored `stripe_customer_id`, and its `status` is `succeeded`. Without this,
   a caller could pass another user's SetupIntent id and attach that person's
   card. Failure → 403 `setup_intent_invalid`.
2. **Idempotency.** If the user already has an entitling subscription
   (`is_premium`), return success describing it rather than creating a
   second one. This makes the retry path after a dropped connection safe.
3. Create the Subscription: `customer`, `items=[{"price": <plan price id>}]`,
   `default_payment_method` taken from the retrieved SetupIntent,
   `metadata={"user_id": str(user.id)}`, and `trial_period_days=7` **only for
   a first-time subscriber** (see the trial-guard change below).
4. Apply the result immediately via the existing
   `apply_subscription_object(db, dict(subscription))` and commit, so the UI
   can flip to Premium without polling. The webhook re-applies the same object
   moments later; that path is already idempotent.
5. Return `{"status": <stripe status>, "premium": <bool>}`.

### Trial-guard change (required by this design)

Today the guard is "no `Subscription` row ⇒ grant trial". Step 2 of
`setup-intent` now creates a row (to hold `stripe_customer_id`) *before* any
subscription exists, which would make every user look like a returning
subscriber and silently deny all trials.

The guard therefore moves from "has a row" to "has ever had a Stripe
subscription": grant the trial only when the row's `stripe_subscription_id`
is null **and** the row has never held one. A new nullable column
`had_subscription` (boolean, default false, set true whenever
`apply_subscription_object` binds a `stripe_subscription_id`) records this
durably, since the id itself is rebound over a subscriber's lifetime.

This needs a migration (`subscriptions.had_subscription`) and must chain off
the live alembic head at implementation time — do not hardcode a revision id
from this document.

### `POST /api/billing/checkout-session` (kept, deprecated)

Left in place for one release as a rollback path: if Payment Element
misbehaves in production, reverting is a frontend change rather than a
redeploy of billing logic. Marked deprecated in its docstring. Removed by the
in-page management spec.

### Unchanged

`portal-session`, `/api/billing/webhook`, `app/billing.py`'s entitlement and
event-application logic, and the premium markets endpoint. Subscription
management stays on the hosted Customer Portal until its own spec.

## Frontend

New dependencies: `@stripe/stripe-js`, `@stripe/react-stripe-js`.
New public env var: `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (a `pk_…` key —
publishable by design, unlike the secret key). Absent ⇒ the in-page form does
not render and the page falls back to the existing hosted-checkout button, so
a half-configured deploy degrades instead of breaking.

### `components/PremiumCheckout.tsx` (new)

Owns everything Stripe: the `<Elements>` provider, `<PaymentElement>`, the
submit handler and the post-confirm call. `PremiumClient` keeps plan
selection and reveals this component inline beneath the plan cards
(`layout: inline, same page` — no modal, no route change), passing the chosen
plan.

Flow:

1. On mount (or on plan selection), `POST /api/billing/setup-intent` → client
   secret → mount `<Elements>`.
2. Submit → `stripe.confirmSetup({ elements, redirect: "if_required",
   confirmParams: { return_url } })`.
3. On success → `POST /api/billing/subscribe` with the plan and
   `setup_intent.id` → `refresh()` from `useAuth()` → success state.

### 3D Secure

Cards requiring a bank challenge cannot complete inline: `confirmSetup`
redirects to the issuer and returns to
`/premium?setup_intent=…&setup_intent_client_secret=…&redirect_status=…`.
On mount, `PremiumCheckout` detects those query params and resumes at step 3
(the card is already confirmed; only the `subscribe` call remains). The plan
choice must survive that round trip — it is carried in the `return_url` query
string, since component state does not survive a redirect.

### Theming

Stripe's Appearance API takes concrete colour values, but this project's
design tokens are bare HSL triples (`--win: 82 61% 52%`), unusable directly.
`PremiumCheckout` reads the computed token values from the document at
runtime, wraps them into `hsl(...)`, and builds the appearance object — and
recomputes when the Daylight/Floodlight theme changes, or the embedded form
visibly clashes with the surrounding page. Matching the site's design is the
entire point of this change, so this is a requirement, not polish.

## Error handling

- **Card declined / validation:** render Stripe's returned `error.message`
  inline; the form stays mounted and resubmittable.
- **Card saved but `subscribe` failed** (tab closed, network drop): the user
  has a saved card and no subscription. `subscribe` is idempotent and the
  ownership check passes on retry, so the page detects this state and offers
  to finish — no duplicate charge is possible because no subscription was
  created.
- **Stripe API failure:** the existing `_billing_unavailable()` helper → 503
  `billing_unavailable`, surfaced through `friendlyAuthError`.
- **Already premium:** 409 `already_subscribed`, page shows the managed state.
- **Publishable key missing:** in-page form hidden, hosted-checkout button
  shown instead.

## Testing

Backend (pytest):

- `setup-intent`: 503 when billing off, 401 anonymous, 409 when already
  premium, creates-and-persists the customer id, reuses an existing one.
- `subscribe`: **rejects a SetupIntent belonging to another user's customer**
  and one whose status is not `succeeded` (the security cases); idempotent
  when already premium; trial granted to a first-timer and withheld from a
  returning subscriber; the row written eagerly matches what the webhook
  would have written for the same object.
- Trial-guard change: a row that exists only to hold `stripe_customer_id`
  (never bound to a subscription) still receives the trial — the regression
  the `had_subscription` column exists to prevent.
- Migration applies cleanly on top of the live head.

Frontend (jest, Stripe mocked):

- Success, decline, and 3DS-return paths.
- Renders nothing / falls back when the publishable key is absent.
- Appearance object is rebuilt on theme change.

Manual, Stripe test mode, before any live flip: `4242 4242 4242 4242`
(success), `4000 0025 0000 3155` (3DS challenge), `4000 0000 0000 9995`
(decline).

## Non-goals

- In-page cancel, card update, and invoice history — the next spec; the
  hosted Portal continues to serve those.
- Stripe Link promotion.
- Any change to entitlement rules, the webhook, the markets endpoint, or the
  premium UI surfaces other than `/premium` itself.
