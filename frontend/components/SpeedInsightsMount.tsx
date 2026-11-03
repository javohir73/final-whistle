"use client";

import { SpeedInsights } from "@vercel/speed-insights/next";
import { scrubClientSecrets } from "@/components/SentryInit";

/** Core Web Vitals (LCP, INP, CLS, FCP, TTFB) per route via Vercel Speed
 *  Insights -- the before/after baseline the UX rebuild is measured against.
 *  Mount once in the root layout. The script is served same-origin by Vercel
 *  (/_vercel/speed-insights), so the production CSP needs no change; locally it
 *  only logs in debug mode.
 *
 *  Each vital carries the page URL, and the 3DS return to /premium carries a
 *  Stripe client secret in its query string, so URLs are scrubbed exactly as
 *  they are for Sentry before anything is sent. */
export function SpeedInsightsMount() {
  return <SpeedInsights beforeSend={(event) => ({ ...event, url: scrubClientSecrets(event.url) })} />;
}
