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

type SentryModule = typeof import("@sentry/nextjs");

/** The one in-flight load + init of the browser SDK, shared by <SentryInit/>
 *  and the error boundaries. */
let sentryLoad: Promise<SentryModule | null> | null = null;

/** Lazily loads and initializes Sentry browser error tracking -- only when
 *  NEXT_PUBLIC_SENTRY_DSN is configured. Resolves to null when monitoring is
 *  off (no DSN baked into the build) or the SDK chunk fails to load, so callers
 *  treat null as "drop it" and a missing DSN can never throw. The SDK stays out
 *  of the main bundle until it's actually used. Captures client runtime
 *  errors; server errors go through instrumentation.ts (onRequestError) and
 *  the backend through the FastAPI Sentry integration. */
export function loadSentry(): Promise<SentryModule | null> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn || typeof window === "undefined") return Promise.resolve(null);
  sentryLoad ??= import("@sentry/nextjs")
    .then((Sentry) => {
      const w = window as unknown as { __sentryInited?: boolean };
      if (!w.__sentryInited) {
        w.__sentryInited = true;
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
      }
      return Sentry;
    })
    .catch(() => null); // never let monitoring break the app
  return sentryLoad;
}

/** Report an error that reached a React error boundary (app/error.tsx,
 *  app/global-error.tsx). Fire-and-forget: a no-op without a DSN, and it never
 *  throws, so the fallback UI always renders. global-error replaces the root
 *  layout (and with it <SentryInit/>), which is why this initializes on demand.
 *  A server-rendered error reaches the client as a sanitized message plus a
 *  `digest`; tagging the digest ties the report to the server-side event that
 *  onRequestError captured with the full stack. */
export function captureClientError(error: Error & { digest?: string }): void {
  void loadSentry().then((Sentry) => {
    try {
      Sentry?.captureException(
        error,
        error.digest ? { tags: { digest: error.digest } } : undefined,
      );
    } catch {
      /* monitoring must never break the error page */
    }
  });
}

/** Initializes Sentry once per page load (see loadSentry). */
export function SentryInit() {
  useEffect(() => {
    void loadSentry();
  }, []);
  return null;
}
