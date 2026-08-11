"use client";

import { useEffect } from "react";

/** Redact Stripe client secrets out of a captured URL.
 *
 *  After a 3D Secure challenge Stripe returns the browser to
 *  /premium?setup_intent=…&setup_intent_client_secret=…, and the browser SDK
 *  attaches the full request URL — query string included — to every event it
 *  captures. That return page is exactly where errors are most likely, and
 *  Stripe classes client secrets as sensitive, so they must not reach a
 *  third-party monitoring service. Kept as a plain string rewrite: it has to
 *  work for a relative URL as well as an absolute one, and never throw inside
 *  beforeSend. */
export function scrubClientSecrets(url: string): string {
  return url.replace(
    /([?&](?:setup|payment)_intent_client_secret=)[^&#]*/gi,
    "$1[redacted]",
  );
}

/** Initializes Sentry browser error tracking — only when NEXT_PUBLIC_SENTRY_DSN
 *  is configured (safe no-op otherwise). Loaded lazily so the SDK stays out of
 *  the main bundle until it's actually used. Captures client runtime errors;
 *  backend errors are tracked separately via the FastAPI Sentry integration. */
export function SentryInit() {
  useEffect(() => {
    const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
    if (!dsn || typeof window === "undefined") return;
    const w = window as unknown as { __sentryInited?: boolean };
    if (w.__sentryInited) return;
    w.__sentryInited = true;
    import("@sentry/nextjs")
      .then((Sentry) => {
        Sentry.init({
          dsn,
          environment: process.env.NEXT_PUBLIC_ENV ?? "production",
          tracesSampleRate: 0, // errors only
          beforeSend(event) {
            const url = event.request?.url;
            if (event.request && typeof url === "string") {
              event.request.url = scrubClientSecrets(url);
            }
            return event;
          },
        });
        Sentry.setTag("model_version", process.env.NEXT_PUBLIC_MODEL_VERSION ?? "unknown");
      })
      .catch(() => {
        /* never let monitoring break the app */
      });
  }, []);
  return null;
}
