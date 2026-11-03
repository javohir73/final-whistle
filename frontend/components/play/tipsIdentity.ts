"use client";

import { useEffect, useState } from "react";

/** Device-side copies of confirmed tips, keyed per league/matchweek and per
 *  NRL season/round. The match page's pick card (components/match) reads and
 *  writes the league one under the same prefix. */
export const LEAGUE_TIPS_CACHE_PREFIX = "finalwhistle:league-tips:v1:";
export const NRL_TIPS_CACHE_PREFIX = "finalwhistle:nrl-tips:v1:";

/** Fired when whose tips this device shows may have changed: a sign-in claim
 *  merged the device's picks into an account (the device's own player row can
 *  be deleted in that merge). Tips surfaces re-read the server on it. */
export const TIPS_IDENTITY_EVENT = "finalwhistle:tips-identity-changed";

/** Drop every local tips cache so nothing shows a pick the server no longer
 *  holds for this device. Returns how many entries were removed. */
export function clearLocalTipsCaches(): number {
  if (typeof window === "undefined") return 0;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && (key.startsWith(LEAGUE_TIPS_CACHE_PREFIX) || key.startsWith(NRL_TIPS_CACHE_PREFIX))) {
        keys.push(key);
      }
    }
    keys.forEach((key) => window.localStorage.removeItem(key));
    return keys.length;
  } catch {
    return 0; // storage unavailable — nothing cached to go stale
  }
}

export function announceTipsIdentityChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(TIPS_IDENTITY_EVENT));
}

/** A counter that bumps on every TIPS_IDENTITY_EVENT: add it to a tips
 *  fetch effect's dependencies to re-read the server when it changes. */
export function useTipsIdentityVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1);
    window.addEventListener(TIPS_IDENTITY_EVENT, bump);
    return () => window.removeEventListener(TIPS_IDENTITY_EVENT, bump);
  }, []);
  return version;
}
