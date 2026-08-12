"use client";

/** The home page's Premium section. Promotion only — nothing here fetches, and
 *  the prices are copy (the backend resolves the real amounts from Stripe Price
 *  IDs). Hidden for a viewer who already subscribes, hidden while the session
 *  check is still pending rather than flashing the promo and retracting it, and
 *  hidden entirely when billing is off — the same rule every other premium
 *  surface follows. */
import Link from "next/link";
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import { PREMIUM_FEATURES, PREMIUM_PRICING } from "@/lib/premium";

export function PremiumPromo() {
  const { user, loading } = useAuth();
  if (!BILLING_ENABLED || loading || user?.premium) return null;

  return (
    <section className="glass mt-8 rounded-2xl p-6 sm:p-8">
      <p className="text-label font-bold uppercase tracking-[0.14em] text-lime-deep">
        Premium
      </p>
      <h2 className="mt-1 max-w-xl font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
        Every market the model prices
      </h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
        The analyst tier, on every match. Everything free today stays free.
      </p>

      <ul className="mt-5 grid gap-2.5 sm:grid-cols-2">
        {PREMIUM_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm">
            <span aria-hidden className="mt-0.5 font-bold text-lime-deep">✓</span>
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Link
          href="/premium"
          className="inline-flex min-h-[44px] items-center rounded-xl bg-win/15 px-4 font-display text-sm font-bold text-lime-deep ring-1 ring-win/30 transition hover:bg-win/25"
        >
          See what&rsquo;s included
        </Link>
        <p className="text-sm text-muted">
          ${PREMIUM_PRICING.monthly.toFixed(2)}/month or $
          {PREMIUM_PRICING.annual.toFixed(2)}/year · 7-day free trial
        </p>
      </div>
    </section>
  );
}
