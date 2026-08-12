"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import { STRIPE_PUBLISHABLE_KEY } from "@/lib/constants";
import {
  createCheckoutSession,
  createPortalSession,
  friendlyAuthError,
} from "@/lib/session";
import { PREMIUM_FEATURES, PREMIUM_PRICING, annualSavingLabel } from "@/lib/premium";
import { COMPETITIONS, type CompetitionId } from "@/lib/sports";

type Plan = "monthly" | "annual";

/** Split out of this route's chunk.
 *
 *  loadStripe() was already deferred to first use, but @stripe/stripe-js and
 *  @stripe/react-stripe-js were STATIC imports — so the SDK shipped in the
 *  /premium chunk and every visitor who merely read the pricing page paid for
 *  it, including the ones who never opened the form. `payOpen` is false until
 *  someone clicks, and now the bundle follows the same gate.
 *
 *  ssr:false because the component reads getComputedStyle at mount to build
 *  Stripe's Appearance object from our design tokens; there is no server-side
 *  equivalent, and it renders nothing useful before hydration anyway. */
const PremiumCheckout = dynamic(
  () => import("@/components/PremiumCheckout").then((m) => m.PremiumCheckout),
  {
    ssr: false,
    loading: () => (
      <p role="status" className="text-sm text-muted">
        Loading secure payment form…
      </p>
    ),
  },
);

/** /premium — pricing, checkout and portal entry points. Amounts below are
 *  copy only: the backend derives the price from the `plan` string via
 *  Stripe Price IDs, never from a number sent by the client. */
export function PremiumClient() {
  const { user, loading, openSignIn, refresh } = useAuth();
  const params = useSearchParams();
  const rawCompetition = params.get("competition");
  const competition: CompetitionId =
    rawCompetition && rawCompetition in COMPETITIONS
      ? (rawCompetition as CompetitionId)
      : "epl";
  const rawReturnTo = params.get("returnTo");
  const competitionBase = COMPETITIONS[competition].basePath;
  const safeReturnTo =
    rawReturnTo &&
    rawReturnTo.length <= 512 &&
    /^[A-Za-z0-9/_-]+$/.test(rawReturnTo) &&
    (rawReturnTo === competitionBase || rawReturnTo.startsWith(`${competitionBase}/`))
      ? rawReturnTo
      : null;
  const returnTo = safeReturnTo ?? competitionBase;
  const hasContext = Boolean(rawCompetition || rawReturnTo);
  const checkoutContext = useMemo(
    () => (hasContext ? { competition, returnTo } : undefined),
    [competition, hasContext, returnTo],
  );
  // Payment Element needs a publishable key; without one the page keeps the
  // hosted-Checkout redirect, so a half-configured deploy degrades quietly.
  const inPage = Boolean(STRIPE_PUBLISHABLE_KEY);
  // Both survive a 3D Secure round trip only because they are in the URL:
  // Stripe appends setup_intent/redirect_status, and the plan rides along in
  // the return_url PremiumCheckout builds.
  const [plan, setPlan] = useState<Plan>(params.get("plan") === "annual" ? "annual" : "monthly");
  const [payOpen, setPayOpen] = useState(inPage && Boolean(params.get("setup_intent")));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The in-page form unmounts the instant /me reports premium, so its success
  // message has to be the page's — hence the same banner the redirect uses.
  const [subscribed, setSubscribed] = useState(false);
  const justPaid = params.get("checkout") === "success" || subscribed;

  // After the Stripe redirect the webhook may land a beat later than the user:
  // poll /me a few times until the premium flag flips.
  useEffect(() => {
    if (!justPaid || user?.premium) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      refresh();
      if (tries >= 5) clearInterval(t);
    }, 2000);
    return () => clearInterval(t);
  }, [justPaid, user?.premium, refresh]);

  const startCheckout = useCallback(async (p: Plan) => {
    setBusy(true);
    setError(null);
    try {
      const { url } = checkoutContext
        ? await createCheckoutSession(p, checkoutContext)
        : await createCheckoutSession(p);
      window.location.assign(url);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  }, [checkoutContext]);

  // In-page: reveal the form beneath the plan cards. Otherwise: redirect out.
  const start = useCallback(() => {
    if (inPage) setPayOpen(true);
    else void startCheckout(plan);
  }, [inPage, plan, startCheckout]);

  const onBuy = () => {
    if (!user) {
      openSignIn({ mode: "signup", onSuccess: start });
      return;
    }
    start();
  };

  const onManage = async () => {
    setBusy(true);
    setError(null);
    try {
      const { url } = await createPortalSession();
      window.location.assign(url);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  };

  return (
    <div className="fade-up mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-display text-4xl font-extrabold tracking-tight">
          FinalWhistle <span className="text-lime-deep">Premium</span>
        </h1>
        <p className="mt-3 text-muted">
          The analyst tier — every market our model prices, on every match.
          Everything free today stays free.
        </p>
      </header>

      {justPaid && (
        <div
          role="status"
          className="glass rounded-2xl bg-win/[0.06] p-4 text-sm ring-1 ring-win/25"
        >
          {user?.premium
            ? "You're Premium. Enjoy the full markets."
            : "Payment received — activating your membership…"}
          {hasContext && (
            <Link
              href={returnTo}
              className="ml-2 font-semibold text-lime-deep underline underline-offset-2"
            >
              Back to {COMPETITIONS[competition].label}
            </Link>
          )}
        </div>
      )}

      {user?.premium_status === "past_due" && (
        <div
          role="status"
          className="rounded-2xl border border-draw/30 bg-draw/10 p-4 text-sm text-amber-ink"
        >
          <span className="font-semibold">There&rsquo;s a payment issue</span> with your
          subscription — your membership stays active for a few days while you
          update your card.{" "}
          <button
            type="button"
            onClick={() => void onManage()}
            className="font-bold underline underline-offset-2"
          >
            Update payment method
          </button>
        </div>
      )}

      <ul className="grid gap-2.5 sm:grid-cols-2">
        {PREMIUM_FEATURES.map((f) => (
          <li key={f} className="flex items-start gap-2 text-sm">
            <span aria-hidden className="mt-0.5 font-bold text-lime-deep">✓</span>
            {f}
          </li>
        ))}
      </ul>

      {!user?.premium && (
        <div>
          <div role="radiogroup" aria-label="Billing period" className="grid grid-cols-2 gap-3">
            <button
              type="button"
              role="radio"
              aria-checked={plan === "monthly"}
              onClick={() => setPlan("monthly")}
              className={`rounded-2xl border p-4 text-left transition ${
                plan === "monthly"
                  ? "border-win/60 bg-win/15 text-foreground"
                  : "border-border bg-surface-2/50 text-muted hover:border-win/40 hover:text-foreground"
              }`}
            >
              <div className="font-display text-2xl font-extrabold text-foreground">
                ${PREMIUM_PRICING.monthly.toFixed(2)}
                <span className="text-sm font-normal text-muted">/month</span>
              </div>
              <div className="mt-1 text-xs text-muted">Billed monthly</div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={plan === "annual"}
              onClick={() => setPlan("annual")}
              className={`rounded-2xl border p-4 text-left transition ${
                plan === "annual"
                  ? "border-win/60 bg-win/15 text-foreground"
                  : "border-border bg-surface-2/50 text-muted hover:border-win/40 hover:text-foreground"
              }`}
            >
              <div className="font-display text-2xl font-extrabold text-foreground">
                ${PREMIUM_PRICING.annual.toFixed(2)}
                <span className="text-sm font-normal text-muted">/year</span>
              </div>
              <div className="mt-1 text-xs font-semibold text-lime-deep">
                {annualSavingLabel()}
              </div>
            </button>
          </div>
        </div>
      )}

      <div>
        {user?.premium ? (
          <button
            type="button"
            onClick={() => void onManage()}
            disabled={busy}
            className="min-h-[44px] w-full rounded-xl bg-win px-4 py-3 text-sm font-bold text-pitch transition hover:brightness-110 disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Please wait…" : "Manage subscription"}
          </button>
        ) : payOpen ? (
          <PremiumCheckout
            plan={plan}
            checkoutContext={checkoutContext}
            onActivated={() => setSubscribed(true)}
          />
        ) : (
          <button
            type="button"
            onClick={onBuy}
            disabled={busy || loading}
            className="min-h-[44px] w-full rounded-xl bg-win px-4 py-3 text-sm font-bold text-pitch transition hover:brightness-110 disabled:opacity-50 sm:w-auto"
          >
            {busy ? "Please wait…" : "Start free trial"}
          </button>
        )}
        <p className="mt-2.5 text-xs text-muted">
          7-day free trial, cancel anytime. Payments handled by Stripe.
        </p>
        {error && <p className="mt-2 text-sm text-loss">{error}</p>}
      </div>

      <p className="text-label leading-snug text-muted">
        For analytics and entertainment only. Not betting advice.
      </p>
    </div>
  );
}
