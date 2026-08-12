/** FinalWhistle Premium — what the tier includes, written once.
 *  Both the pricing page (app/premium/PremiumClient.tsx) and the home-page
 *  promo (components/PremiumPromo.tsx) render this list, so the front door and
 *  the pricing page cannot end up describing the tier differently. Copy only:
 *  the entitlement itself is enforced by the backend. */
export const PREMIUM_FEATURES = [
  "Full correct-score probability grid for every match",
  "Over/under lines, BTTS and Asian handicap probabilities",
  "Supporter badge on the leaderboard",
  "Early access to new competitions and features",
];

/** Listed prices, in USD. Single source for every surface that quotes them. */
export const PREMIUM_PRICING = { monthly: 4.99, annual: 39.99 } as const;

/** What the annual plan actually saves against twelve monthly payments.
 *
 *  Derived rather than written down. The pricing page used to claim
 *  "2 months free", which is simply not what these numbers say: twelve months
 *  at $4.99 is $59.88, the annual plan is $39.99, so the saving is $19.89 —
 *  33%, or very nearly FOUR months. The hardcoded claim understated the
 *  discount and was still wrong, which is the worst of both. Computing it here
 *  means changing a price updates the claim instead of silently invalidating
 *  it. */
export function annualSaving(): { saved: number; percent: number; twelveMonths: number } {
  const twelveMonths = PREMIUM_PRICING.monthly * 12;
  const saved = twelveMonths - PREMIUM_PRICING.annual;
  return {
    twelveMonths: Number(twelveMonths.toFixed(2)),
    saved: Number(saved.toFixed(2)),
    percent: Math.round((saved / twelveMonths) * 100),
  };
}

/** "Save 33% · $19.89 a year" — the annual card's subtitle. */
export function annualSavingLabel(): string {
  const { saved, percent } = annualSaving();
  return `Save ${percent}% · $${saved.toFixed(2)} a year`;
}
