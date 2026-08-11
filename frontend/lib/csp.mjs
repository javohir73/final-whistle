// Content-Security-Policy. 'unsafe-inline' is needed for Next's inline bootstrap
// + styled JSX; flagcdn is the flag image host. The backend is reached through the
// same-origin /backend-api proxy, so connect-src needs 'self' plus only the
// third parties that talk to the browser directly (Sentry, Stripe — below).
// next.config.mjs applies it in production only, so dev HMR (eval + websockets)
// keeps working.
//
// `frame-ancestors` is the caller's argument because it differs by route:
// everywhere except /embed it's 'none' (nothing may iframe us); on /embed it's
// '*' since /embed/[matchId] is the partner-embeddable prediction card and must
// be iframeable anywhere.
//
// Lives here rather than inline in next.config.mjs so it can be unit-tested:
// the config itself can't be imported from jest (its `const __dirname` collides
// with the CJS injection), and a CSP typo is now a total outage for in-page
// signup that no other test would catch — Stripe.js is mocked everywhere.

// Stripe hosts the in-page Payment Element needs (docs.stripe.com/security/guide
// #content-security-policy). Without these the element cannot mount at all: the
// card fields live in js.stripe.com iframes, a 3D Secure challenge opens in
// hooks.stripe.com, and confirmation calls api.stripe.com directly from the
// browser. Listed unconditionally because headers() has no per-request view of
// the billing gate; they permit nothing until Stripe.js is actually loaded,
// which only happens when NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is set.
const STRIPE_SCRIPT = "https://js.stripe.com";
const STRIPE_FRAME = "https://js.stripe.com https://hooks.stripe.com https://m.stripe.network";
const STRIPE_CONNECT = "https://api.stripe.com https://m.stripe.network https://q.stripe.com";

/** @param {string} frameAncestors */
export function buildCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "img-src 'self' data: https://flagcdn.com https://*.stripe.com",
    `script-src 'self' 'unsafe-inline' ${STRIPE_SCRIPT}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    `connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io ${STRIPE_CONNECT}`,
    `frame-src 'self' ${STRIPE_FRAME}`,
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}
