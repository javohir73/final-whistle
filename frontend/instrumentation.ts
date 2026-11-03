import type { Instrumentation } from "next";

/** Server-side error capture through the Next.js instrumentation hook.
 *
 *  `register()` runs once per server runtime (nodejs, edge) at boot and
 *  initializes the Sentry SDK; `onRequestError` reports every uncaught error
 *  from server components, route handlers, server actions and middleware with
 *  its route context. Before this file existed, server render errors reached
 *  nobody: the browser only ever sees a sanitized message plus a `digest`
 *  (which app/error.tsx tags on its own report, so the two events join up).
 *
 *  Both hooks are no-ops unless a DSN is configured -- SENTRY_DSN, or the
 *  browser's NEXT_PUBLIC_SENTRY_DSN so one Vercel variable turns on both. With
 *  no DSN the SDK is never even imported. No DSN value lives in this repo: set
 *  it in the Vercel project settings. */
function serverDsn(): string | undefined {
  return process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined;
}

/** Same redaction as SentryInit's scrubClientSecrets (kept inline: that module
 *  is a client component). Stripe client secrets ride on the 3DS return URL.
 *  Also anchored at the start, because Sentry's `query_string` has no "?". */
function scrub(value: string): string {
  return value.replace(/((?:^|[?&])(?:setup|payment)_intent_client_secret=)[^&#]*/gi, "$1[redacted]");
}

const PRIVATE_HEADERS = new Set(["cookie", "set-cookie", "authorization"]);

export async function register(): Promise<void> {
  const dsn = serverDsn();
  if (!dsn) return;
  if (process.env.NEXT_RUNTIME !== "nodejs" && process.env.NEXT_RUNTIME !== "edge") return;
  const Sentry = await import("@sentry/nextjs");
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_ENV ?? "production",
    tracesSampleRate: 0, // errors only, like the browser SDK
    initialScope: {
      tags: { model_version: process.env.NEXT_PUBLIC_MODEL_VERSION ?? "unknown" },
    },
    beforeSend(event) {
      // The session cookie and auth headers never leave the server.
      const request = event.request;
      if (request) {
        delete request.cookies;
        if (request.headers) {
          for (const name of Object.keys(request.headers)) {
            if (PRIVATE_HEADERS.has(name.toLowerCase())) delete request.headers[name];
          }
        }
        if (typeof request.url === "string") request.url = scrub(request.url);
        if (typeof request.query_string === "string") {
          request.query_string = scrub(request.query_string);
        }
      }
      const nextjs = event.contexts?.nextjs as { request_path?: unknown } | undefined;
      if (nextjs && typeof nextjs.request_path === "string") {
        nextjs.request_path = scrub(nextjs.request_path);
      }
      return event;
    },
  });
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (!serverDsn()) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, request, context);
  } catch {
    /* monitoring must never turn one error into two */
  }
};
