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
