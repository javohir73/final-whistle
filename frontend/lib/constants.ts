/** App-wide constants. App name is a single source of truth
 *  (PRD Resolved Decision #5 — name finalized as "FinalWhistle"). */
export const APP_NAME = "FinalWhistle";

/** Canonical site origin — used for metadataBase, canonical URLs, OG images. */
export const SITE_URL = "https://fifa-wc26-prediction.vercel.app";

/** FinalWhistle Premium — billing UI gate. Mirrors the backend's env gate:
 *  unset/false => no premium surface renders anywhere. */
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === "true";
