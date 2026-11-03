"use client";

import { useEffect } from "react";

/** Bump together with SCHEMA in public/sw.js when the caching contract changes
 *  (a test keeps the two in step). */
const SW_SCHEMA = "4";

/** The worker's cache version, fixed at build time: the schema plus this
 *  deploy's commit (Vercel exposes NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA to the
 *  build), else the model version. sw.js reads it from ?v= and names its
 *  per-deploy caches with it, so every deploy retires the last one's cached
 *  pages without anyone remembering to bump "fw-vN". */
export const SW_VERSION = `${SW_SCHEMA}-${
  (process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 12) ||
  process.env.NEXT_PUBLIC_MODEL_VERSION ||
  "dev"
}`;

/** Registers the service worker (production only) so the app is installable and
 *  works offline. No-op in dev to avoid stale-cache headaches during HMR.
 *
 *  Updates: a new deploy registers a new script URL (/sw.js?v=SW_VERSION),
 *  which installs a fresh worker; the browser also revalidates sw.js on
 *  navigation, and we additionally check when the app returns to the
 *  foreground — important for installed/standalone sessions that stay open for
 *  days. The worker uses skipWaiting + clients.claim, and pages are
 *  network-first, so a new version takes over cleanly without a forced reload. */
export function ServiceWorker() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      return;
    }

    let registration: ServiceWorkerRegistration | undefined;

    const register = () => {
      navigator.serviceWorker
        .register(`/sw.js?v=${encodeURIComponent(SW_VERSION)}`)
        .then((reg) => {
          registration = reg;
        })
        .catch(() => {});
    };

    // Register after the page has loaded so the SW doesn't compete with the
    // initial resource fetches.
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("load", register);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return null;
}
