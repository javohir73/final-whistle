"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import {
  createCheckoutSession,
  createPortalSession,
  friendlyAuthError,
} from "@/lib/session";

type Plan = "monthly" | "annual";

const FEATURES = [
  "Full correct-score probability grid for every match",
  "Over/under lines, BTTS and Asian handicap probabilities",
  "Supporter badge on the leaderboard",
  "Early access to new competitions and features",
];

/** /premium — pricing, checkout and portal entry points. Amounts below are
 *  copy only: the backend derives the price from the `plan` string via
 *  Stripe Price IDs, never from a number sent by the client. */
export function PremiumClient() {
  const { user, loading, openSignIn, refresh } = useAuth();
  const [plan, setPlan] = useState<Plan>("monthly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const params = useSearchParams();
  const justPaid = params.get("checkout") === "success";

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
      const { url } = await createCheckoutSession(p);
      window.location.assign(url);
    } catch (e) {
      setError(friendlyAuthError(e));
      setBusy(false);
    }
  }, []);

  const onBuy = () => {
    if (!user) {
      openSignIn({ mode: "signup", onSuccess: () => startCheckout(plan) });
      return;
    }
    void startCheckout(plan);
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
        {FEATURES.map((f) => (
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
                $4.99<span className="text-sm font-normal text-muted">/month</span>
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
                $39.99<span className="text-sm font-normal text-muted">/year</span>
              </div>
              <div className="mt-1 text-xs font-semibold text-lime-deep">2 months free</div>
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
