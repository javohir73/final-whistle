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
import { Button, Card, CardHead, CheckIcon, Note, PageHead } from "@/components/ui";

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
      <p role="status" className="text-notes text-muted">
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

  const planClass = (on: boolean) =>
    `rounded-card border p-5 text-left transition-colors ${
      on ? "border-brand bg-brand-soft" : "border-line bg-ground hover:border-line-strong"
    }`;

  return (
    <div>
      <PageHead
        eyebrow="FinalWhistle"
        title="Premium"
        sub="The analyst tier: every market the model prices, on every match. Everything free today stays free."
      />

      <div className="flex max-w-[760px] flex-col gap-6">
        {justPaid && (
          <div role="status" className="rounded-card border border-brand bg-brand-soft px-5 py-4 text-ink">
            {user?.premium
              ? "You're Premium. Enjoy the full markets."
              : "Payment received — activating your membership…"}
            {hasContext && (
              <Link
                href={returnTo}
                className="ml-2 font-semibold text-brand underline underline-offset-[3px]"
              >
                Back to {COMPETITIONS[competition].label}
              </Link>
            )}
          </div>
        )}

        {user?.premium_status === "past_due" && (
          <div role="status" className="rounded-card border border-miss/30 bg-miss-soft px-5 py-4 text-ink">
            <span className="font-semibold text-miss">There&rsquo;s a payment issue</span> with your
            subscription. Your membership stays active for a few days while you
            update your card.{" "}
            <button
              type="button"
              onClick={() => void onManage()}
              className="font-semibold text-brand underline underline-offset-[3px]"
            >
              Update payment method
            </button>
          </div>
        )}

        <Card pad>
          <CardHead title="What you get" />
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {PREMIUM_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5">
                <CheckIcon className="mt-1 shrink-0 text-brand" />
                {f}
              </li>
            ))}
          </ul>
        </Card>

        {!user?.premium && (
          <div role="radiogroup" aria-label="Billing period" className="grid grid-cols-2 gap-3">
            <button
              type="button"
              role="radio"
              aria-checked={plan === "monthly"}
              onClick={() => setPlan("monthly")}
              className={planClass(plan === "monthly")}
            >
              <div className="text-2xl font-semibold text-ink">
                ${PREMIUM_PRICING.monthly.toFixed(2)}
                <span className="text-notes font-normal text-muted">/month</span>
              </div>
              <div className="mt-1 text-notes text-muted">Billed monthly</div>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={plan === "annual"}
              onClick={() => setPlan("annual")}
              className={planClass(plan === "annual")}
            >
              <div className="text-2xl font-semibold text-ink">
                ${PREMIUM_PRICING.annual.toFixed(2)}
                <span className="text-notes font-normal text-muted">/year</span>
              </div>
              <div className="mt-1 text-notes font-semibold text-brand">
                {annualSavingLabel()}
              </div>
            </button>
          </div>
        )}

        <div>
          {user?.premium ? (
            <Button onClick={() => void onManage()} disabled={busy} className="w-full sm:w-auto">
              {busy ? "Please wait…" : "Manage subscription"}
            </Button>
          ) : payOpen ? (
            <PremiumCheckout
              plan={plan}
              checkoutContext={checkoutContext}
              onActivated={() => setSubscribed(true)}
            />
          ) : (
            <Button onClick={onBuy} disabled={busy || loading} className="w-full sm:w-auto">
              {busy ? "Please wait…" : "Start free trial"}
            </Button>
          )}
          <Note className="mt-3">7-day free trial, cancel anytime. Payments handled by Stripe.</Note>
          {error && <p className="mt-2 text-notes text-miss">{error}</p>}
        </div>

        <Note>For analytics and entertainment only. Not betting advice.</Note>
      </div>
    </div>
  );
}
