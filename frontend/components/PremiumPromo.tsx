"use client";

/** The home page's Premium section. Promotion only — nothing here fetches, and
 *  the prices are copy (the backend resolves the real amounts from Stripe Price
 *  IDs). Hidden for a viewer who already subscribes, hidden while the session
 *  check is still pending rather than flashing the promo and retracting it, and
 *  hidden entirely when billing is off — the same rule every other premium
 *  surface follows. */
import { useAuth } from "@/components/AuthProvider";
import { BILLING_ENABLED } from "@/lib/constants";
import { PREMIUM_FEATURES, PREMIUM_PRICING } from "@/lib/premium";
import { Button, Card, CheckIcon, Note } from "@/components/ui";

export function PremiumPromo() {
  const { user, loading } = useAuth();
  if (!BILLING_ENABLED || loading || user?.premium) return null;

  return (
    <Card pad className="mt-8">
      <div className="text-notes font-medium text-muted">Premium</div>
      <h2 className="mt-1 text-h2 font-semibold text-ink">Every market the model prices</h2>
      <Note className="mt-2 max-w-prose">
        The analyst tier, on every match. Everything free today stays free.
      </Note>

      <ul className="mt-5 grid gap-3 sm:grid-cols-2">
        {PREMIUM_FEATURES.map((feature) => (
          <li key={feature} className="flex items-start gap-2.5">
            <CheckIcon className="mt-1 shrink-0 text-brand" />
            {feature}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button href="/premium">See what&rsquo;s included</Button>
        <Note>
          ${PREMIUM_PRICING.monthly.toFixed(2)}/month or $
          {PREMIUM_PRICING.annual.toFixed(2)}/year · 7-day free trial
        </Note>
      </div>
    </Card>
  );
}
