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

/** Breadcrumb data fields that hold a URL: history navigation {from, to} and
 *  fetch/xhr {url}. */
const BREADCRUMB_URL_FIELDS = ["url", "from", "to"] as const;

/** Redact client secrets from a breadcrumb's URL fields and message, in place.
 *  The 3DS return URL reaches breadcrumbs too -- the history crumb recorded
 *  when the reader leaves /premium, and fetch/xhr crumbs made from it -- and
 *  every event carries its breadcrumbs. */
export function scrubBreadcrumb<T extends { data?: { [key: string]: unknown }; message?: string }>(
  crumb: T,
): T {
  if (crumb.data) {
    for (const field of BREADCRUMB_URL_FIELDS) {
      const value = crumb.data[field];
      if (typeof value === "string") crumb.data[field] = scrubClientSecrets(value);
    }
  }
  if (typeof crumb.message === "string") crumb.message = scrubClientSecrets(crumb.message);
  return crumb;
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
          beforeBreadcrumb: (breadcrumb) => scrubBreadcrumb(breadcrumb),
          beforeSend(event) {
            const request = event.request;
            if (request) {
              if (typeof request.url === "string") request.url = scrubClientSecrets(request.url);
              // The first page after a full-reload exit from /premium carries
              // the 3DS return URL as its Referer.
              const headers = request.headers;
              if (headers) {
                for (const name of Object.keys(headers)) {
                  if (name.toLowerCase() === "referer") headers[name] = scrubClientSecrets(headers[name]);
                }
              }
            }
            // Belt and braces for any crumb that reached the event without
            // passing through beforeBreadcrumb.
            event.breadcrumbs?.forEach((crumb) => scrubBreadcrumb(crumb));
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
