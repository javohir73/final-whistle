/** App-wide constants. App name is a single source of truth
 *  (PRD Resolved Decision #5 — name finalized as "FinalWhistle"). */
export const APP_NAME = "FinalWhistle";

/** Canonical site origin — used for metadataBase, canonical URLs, OG images. */
export const SITE_URL = "https://fifa-wc26-prediction.vercel.app";

/** FinalWhistle Premium — billing UI gate. Mirrors the backend's env gate:
 *  unset/false => no premium surface renders anywhere. */
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";

/** Stripe publishable key for the in-page Payment Element — a `pk_…` key, which
 *  is public by design (unlike the secret key, which never leaves the backend).
 *  Absent => the in-page form does not render and /premium falls back to hosted
 *  Checkout, so a half-configured deploy degrades instead of breaking. */
export const STRIPE_PUBLISHABLE_KEY =
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "";
