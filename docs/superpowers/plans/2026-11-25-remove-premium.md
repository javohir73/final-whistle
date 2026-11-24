# Remove Premium Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything on FinalWhistle is free and visible to every visitor, signed in or not. Nobody can start a new subscription. Anyone who already subscribed can still reach Stripe's portal to manage or cancel.

**Architecture:** The one piece of paid content, the full match markets panel on football match pages, becomes a public endpoint and an ungated panel that still obeys the pick-then-reveal rule. Every upsell surface is deleted. The three endpoints that start a subscription answer 410. The Stripe webhook, the portal endpoint, the `subscriptions` and `billing_events` tables and their migrations stay exactly as they are, so existing subscribers' state keeps syncing.

**Tech Stack:** FastAPI, SQLAlchemy, pytest; Next.js, React, TypeScript, Jest.

**Spec:** the owner's instruction of 2026-11-25: "remove the premium section from the platform so everything is free and visible for all users". Background on what was gated: `docs/superpowers/specs/2026-08-11-premium-subscriptions-design.md`.

## Global Constraints

- No migration, no table or column dropped, no change to `backend/app/billing.py`'s webhook handling (`apply_event`, `apply_subscription_object`, `record_event_once`, `reconcile_if_stale`), no change to `POST /api/billing/webhook`.
- `POST /api/billing/portal-session` keeps working for a user who has a subscription row.
- `UserOut.premium` and `premium_status` stay in `/api/auth/me` (the account menu uses them to offer "Manage subscription").
- The reveal rule is unchanged: on an open fixture the markets panel appears only where `MatchView` already allows detail (`showDetail`). This plan must not make the model's numbers visible earlier than today.
- Do not run `npm install`, and do not edit `frontend/package.json` or `frontend/package-lock.json`: `frontend/node_modules` is a symlink shared with other worktrees. Removing the unused `@stripe/*` packages is a follow-up, to be listed in the report.
- Leave `frontend/lib/csp.mjs`, `SentryInit.tsx`, `SpeedInsightsMount.tsx` and `instrumentation.ts` alone.
- The retired-endpoint response, exactly: HTTP 410 with `{"detail": {"code": "premium_retired", "message": "FinalWhistle Premium has been retired. Everything on the site is free."}}`.
- Match the surrounding code. Commit after each task with explicit paths (never `git add -A`), message ending with the Co-Authored-By line your own harness specifies for commits. Do not push.
- Gates: Python `.venv/bin/python -m pytest -q`; frontend `cd frontend && npm run typecheck && npm run lint && npm test`.

## Review Focus

1. A logged-out visitor on a finished football match gets the full markets numbers (API 200 with no cookie; panel rendered with billing off and no user).
2. On an open fixture with no locked pick, the markets panel is not rendered.
3. A user with a subscription row can still open the Stripe portal from the account menu; the webhook tests still pass untouched.
4. An old link to `/premium` (bookmarks, Stripe's stored return URL) lands on the home page instead of a 404.
5. `POST /api/billing/setup-intent`, `/subscribe` and `/checkout-session` answer 410 before touching Stripe, with billing configured or not, signed in or not.

---

### Task 1: Backend — markets for everyone, no new subscriptions

**Files:**
- Modify: `backend/app/api/premium_markets.py`, `backend/app/api/billing.py`, `backend/app/api/leaderboard.py`, `backend/app/schemas/__init__.py`, `backend/app/main.py`
- Test: `backend/tests/test_premium_markets_api.py`, `backend/tests/test_billing_api.py`, `backend/tests/test_billing_payment_element.py`, `backend/tests/test_leaderboard_api.py`

**Interfaces:**
- Produces: `GET /api/matches/{match_id}/markets` with no authentication and the same 200 and 404 bodies as today; `LeaderboardRowOut` without a `premium` field.

- [ ] **Step 1: Rewrite the markets tests first.** In `test_premium_markets_api.py`: an anonymous request (no cookie) for a match with a scoreline prediction returns 200 with the markets; a signed-in user without a subscription returns 200; the three 404 cases (`not_found`, `no_prediction`, `markets_unavailable`) are unchanged; no test expects 401 or 403. Run it — expected: the anonymous and free-user cases fail.
- [ ] **Step 2: Make the endpoint public.** Remove the `get_current_user` dependency, the subscription lookup and the 403 from `premium_markets.py`; rename the handler `match_markets`; rewrite the module docstring to say the markets are free for everyone since 2026-11-25 and that the frontend's reveal rule decides when they are shown. Keep the module name and the router prefix.
- [ ] **Step 3: Let it be cached like other public match data.** In `backend/app/main.py` remove the rule that excludes `/api/matches/*/markets` from shared caching (and its comment); keep the `/api/billing` rule. If a test pins the old cache header for this path, update it to the header other public `/api/matches/...` GETs get.
- [ ] **Step 4: Retire the three sign-up endpoints, tests first.** Replace the tests for `POST /api/billing/setup-intent`, `/subscribe` and `/checkout-session` in `test_billing_api.py` and `test_billing_payment_element.py` with: each returns 410 `premium_retired` when billing is configured and the user is signed in; each returns 410 when billing is not configured; each returns 410 when signed out; and none of them calls the `stripe` module (patch it and assert not called). Tests of `/portal-session`, `/webhook`, entitlement, reconcile and models stay as they are. Then make the three handlers return the 410 as their first statement, delete the code beneath it, and delete helpers, schemas (`CheckoutSessionIn`, `SetupIntentOut`, `SubscribeIn`, `SubscribeOut`) and imports that nothing else uses. `BillingUrlOut` stays for the portal.
- [ ] **Step 5: Portal return URL.** In `/portal-session`, `return_url` becomes `f"{settings.public_base_url}/"`; update the test that pins it.
- [ ] **Step 6: Leaderboard.** Remove `premium` from `LeaderboardRowOut` and from `backend/app/api/leaderboard.py`; replace the "premium supporter flag" test with one asserting the row has no `premium` key.
- [ ] **Step 7: Run** `.venv/bin/python -m pytest -q` — expected: no failures. **Commit** `feat: make match markets free and retire premium sign-up`.

### Task 2: Frontend — one free panel, no upsell

**Files:**
- Create: `frontend/components/MatchMarkets.tsx`, `frontend/components/MatchMarkets.test.tsx`
- Delete: `frontend/components/PremiumMarkets.tsx`, `PremiumMarkets.test.tsx`, `PremiumMarkets.gating.test.tsx`, `PremiumGate.tsx`, `PremiumGate.test.tsx`, `PremiumPromo.tsx`, `PremiumPromo.test.tsx`, `PremiumCheckout.tsx`, `PremiumCheckout.test.tsx`, `frontend/app/premium/PremiumClient.tsx`, `frontend/app/premium/PremiumClient.payment.test.tsx`, `frontend/lib/premium.ts`, `frontend/lib/__tests__/premiumPricing.test.ts`, `frontend/components/__tests__/siteNav.premium.test.tsx`, `frontend/app/leaderboard/LeaderboardClient.premium.test.tsx`
- Modify: `frontend/app/premium/page.tsx`, `frontend/app/premium/page.test.tsx`, `frontend/components/match/MatchView.tsx`, `frontend/components/SiteNav.tsx`, `frontend/app/layout.tsx`, `frontend/app/sitemap.ts`, `frontend/app/leaderboard/LeaderboardClient.tsx`, `frontend/lib/session.ts`, `frontend/lib/types.ts`, `frontend/lib/constants.ts`, and any test that referenced a removed thing

**Interfaces:**
- Consumes: the public `GET /api/matches/{id}/markets` from Task 1.
- Produces: `MatchMarkets({ matchId, home, away })`, and `getMatchMarkets(matchId)` with the type `MatchMarketsPayload` in `frontend/lib/session.ts` (renamed from `getPremiumMarkets` / `PremiumMarkets`).

- [ ] **Step 1: Write `MatchMarkets.test.tsx` first:** with no signed-in user and `NEXT_PUBLIC_BILLING_ENABLED` unset, the component fetches `/api/matches/42/markets` and renders the "Full match markets" card with real numbers from the mocked payload; while loading, or when the fetch fails, it renders nothing; when `matchId` changes it clears the old numbers before the new ones arrive; it never renders "Premium", "Go Premium" or a blurred teaser. Run it — expected: fails, no such module.
- [ ] **Step 2: Create `MatchMarkets.tsx`** from `PremiumMarkets.tsx`: keep `MarketsBody` and the per-fixture state reset; fetch for every viewer; drop `BILLING_ENABLED`, `useAuth`, `PremiumGate`, `MarketsTeaser` and the `competition` / `returnTo` props. Rename the session helper and type as given above. Delete the files listed under Delete.
- [ ] **Step 3: `MatchView.tsx`** renders `<MatchMarkets>` exactly where `<PremiumMarkets>` was, under the same `showDetail` condition. Add or update a `MatchView` (or `MatchPageContent`) test: an open fixture with no locked pick does not render the markets card; a finished one does.
- [ ] **Step 4: `/premium` becomes a redirect.** `frontend/app/premium/page.tsx` is a server component that calls `permanentRedirect("/")`; `page.test.tsx` asserts that and nothing else.
- [ ] **Step 5: Remove the upsell surfaces:** `PremiumNavLink` and its use in `SiteNav.tsx` (and the `compact={BILLING_ENABLED}` argument: pass what the overlay did when billing was off, or drop the prop if nothing else sets it); the footer "Premium" link in `layout.tsx`; `/premium` in `sitemap.ts`; the supporter star and `premium` field in `LeaderboardClient.tsx` and `lib/types.ts`; `createCheckoutSession`, `createSetupIntent`, `subscribe` and their types in `lib/session.ts`; `STRIPE_PUBLISHABLE_KEY` in `lib/constants.ts`. Keep `BILLING_ENABLED`, `createPortalSession`, `user.premium` and the account menu's "Manage subscription" item unchanged.
- [ ] **Step 6: Fix every test that referenced something removed** (search the frontend for `Premium`, `premium`, `STRIPE_PUBLISHABLE_KEY`, `/premium`): delete assertions about removed surfaces, and add one assertion each that the header has no Premium link, the footer has none, and the sitemap has no `/premium` URL. Keep `AccountMenu.premium.test.tsx` passing unchanged.
- [ ] **Step 7: Run** `cd frontend && npm run typecheck && npm run lint && npm test` — expected: all pass, no new warnings. **Commit** `feat(frontend): show match markets to everyone and remove premium upsell`.

### Task 3: Documentation

**Files:**
- Modify: `DEPLOYMENT.md`, `README.md`, `.env.example`, `frontend/.env.example`, and the first lines of `docs/superpowers/specs/2026-08-11-premium-subscriptions-design.md`, `2026-08-11-premium-discovery-design.md`, `2026-08-11-payment-element-signup-design.md`

- [ ] **Step 1:** In `DEPLOYMENT.md`, replace the billing rollout text with a short section "Premium (retired 2026-11-25)": everything is free; the three sign-up endpoints answer 410; `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ANNUAL` and `NEXT_PUBLIC_BILLING_ENABLED` matter only while existing subscribers remain, for the portal and the webhook; `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is no longer read; cancelling existing subscriptions is done in the Stripe dashboard and is the owner's decision.
- [ ] **Step 2:** Bring `README.md` and both `.env.example` files in line with that (comments only; keep the variable names that are still read). Put one line at the top of each of the three premium specs: `> Retired 2026-11-25: Premium was removed and everything is free. Kept for history.`
- [ ] **Step 3: Run** `.venv/bin/python -m pytest -q` once more and **commit** `docs: record that premium is retired`.
