// Content-Security-Policy. 'unsafe-inline' is needed for Next's inline bootstrap
// + styled JSX; flagcdn is the flag image host. The backend is reached through the
// same-origin /backend-api proxy, so connect-src needs 'self' plus only the
// third party that talks to the browser directly (Sentry).
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
// with the CJS injection).

/** @param {string} frameAncestors */
export function buildCsp(frameAncestors) {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    `frame-ancestors ${frameAncestors}`,
    "form-action 'self'",
    "img-src 'self' data: https://flagcdn.com",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "connect-src 'self' https://*.ingest.sentry.io https://*.ingest.us.sentry.io https://*.ingest.de.sentry.io",
    "frame-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
  ].join("; ");
}
