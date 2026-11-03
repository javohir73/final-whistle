"use client";

import { useEffect } from "react";

/** Bump together with SCHEMA in public/sw.js when the caching contract changes
 *  (a test keeps the two in step). */
const SW_SCHEMA = "4";

/** The worker's cache version: the schema plus a per-build stamp. */
export function swVersion(buildId: string | undefined): string {
  return `${SW_SCHEMA}-${buildId || "dev"}`;
}

/** Fixed at build time from NEXT_PUBLIC_BUILD_ID, which next.config.mjs
 *  injects on every build (deployment id, else commit SHA, else the build's
 *  timestamp). sw.js reads it from ?v= and names its per-deploy caches with
 *  it, so every deploy retires the last one's cached pages without anyone
 *  remembering to bump "fw-vN". Deliberately never the model version: that
 *  barely changes, and a page cache that outlives its deploy serves HTML
 *  pointing at chunks the new deployment no longer has. "dev" only appears
 *  where the config never ran (jest). */
export const SW_VERSION = swVersion(process.env.NEXT_PUBLIC_BUILD_ID);

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
