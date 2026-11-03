"use client";

import { Suspense, createContext, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import type { ActiveTournament } from "@/lib/types";
import { WC26_FALLBACK } from "@/lib/tournament";
import {
  DEFAULT_COMPETITION,
  competitionInPathname,
  normalizePathname,
  type CompetitionId,
} from "@/lib/sports";
import {
  competitionToRemember,
  migratePinnedCompetition,
  parseCompetition,
  readCompetitionCookie,
  subscribeCompetitionCookie,
  writeCompetitionCookie,
} from "@/lib/competitionPrefs";
import { trackEvent } from "@/lib/analytics";

/** Defaults to the WC26 fallback (not null) — a component rendered outside
 *  the provider (e.g. in a test) still degrades to today's behavior instead
 *  of throwing, matching every other tournament-context fallback in this PR. */
const TournamentContext = createContext<ActiveTournament>(WC26_FALLBACK);

/** Makes the server-resolved active tournament (lib/tournament.ts) available
 *  to client components. The nav no longer gates on it (one five-tab template
 *  for every competition, lib/sports.ts navTabsFor). */
export function TournamentProvider({
  tournament,
  children,
}: {
  tournament: ActiveTournament;
  children: React.ReactNode;
}) {
  return (
    <TournamentContext.Provider value={tournament}>{children}</TournamentContext.Provider>
  );
}

export function useTournament(): ActiveTournament {
  return useContext(TournamentContext);
}

/* ============================================================================
 * Current competition (UX rebuild plan 2026-11 §3.1): URL -> fw_comp cookie
 * -> country -> EPL, never WC26. middleware.ts resolves it on the server and
 * keeps the cookie in step on page loads; this provider does the same for
 * client-side navigations (which may never reach the server when the route
 * is already in the router cache) and runs the one-time migration of the old
 * localStorage star.
 * ========================================================================= */

/** The server-known preference, if the layout chose to read one. null means
 *  "unknown on the server" -- the default, because reading cookies() in the
 *  root layout would make every route dynamic and switch off ISR site-wide. */
const CompetitionContext = createContext<CompetitionId | null>(null);

/** Mirrors middleware.ts for client-side navigations: a competition the URL
 *  names -- the path, else `?competition=` on an unscoped route -- becomes the
 *  remembered one, except an archived competition reached by its path
 *  (competitionToRemember). Renders nothing; isolated in its own Suspense
 *  boundary because useSearchParams() would otherwise opt prerendered pages
 *  out of static rendering. */
function UrlCompetitionSync() {
  const pathname = normalizePathname(usePathname());
  const query = useSearchParams().get("competition");
  // Only a shortcut: the migration deletes the old key, so it is one-time
  // even if this ever remounts.
  const migrated = useRef(false);

  useEffect(() => {
    const remember = competitionToRemember(
      competitionInPathname(pathname),
      parseCompetition(query),
    );
    if (!migrated.current) {
      migrated.current = true;
      migratePinnedCompetition(remember);
    }
    if (!remember) return;
    const current = readCompetitionCookie();
    if (current === remember) return; // middleware (page loads) already did it
    writeCompetitionCookie(remember);
    // A switch, not a first visit: with cookies blocked `current` stays null
    // and nothing is reported on every navigation.
    if (current) {
      trackEvent("competition_switch", { from: current, to: remember, source: "navigation" });
    }
  }, [pathname, query]);

  return null;
}

export function CompetitionProvider({
  initial = null,
  children,
}: {
  initial?: CompetitionId | null;
  children: React.ReactNode;
}) {
  return (
    <CompetitionContext.Provider value={initial}>
      {children}
      <Suspense fallback={null}>
        <UrlCompetitionSync />
      </Suspense>
    </CompetitionContext.Provider>
  );
}

/** The remembered competition. Client: the fw_comp cookie, re-read on every
 *  write. Server render and hydration: the provider's `initial`, so the HTML
 *  and the first client render always agree; React re-renders with the
 *  cookie right after hydration if they differ (no mismatch error). */
export function usePreferredCompetition(): CompetitionId | null {
  const initial = useContext(CompetitionContext);
  return useSyncExternalStore(subscribeCompetitionCookie, readCompetitionCookie, () => initial);
}

export interface CompetitionScope {
  competition: CompetitionId;
  /** True when the URL names the competition (path or `?competition=`),
   *  false when it came from the remembered preference or the default. */
  fromUrl: boolean;
}

/** The one scope rule for the shell (SiteNav, BottomNav, the switcher chip,
 *  the account menu): URL path -> `?competition=` -> remembered competition
 *  -> EPL. `queryCompetition` comes from useSearchParams() in a Suspense
 *  child (the nav components already isolate it there). */
export function useCompetitionScope(queryCompetition?: string | null): CompetitionScope {
  const pathname = normalizePathname(usePathname());
  const preferred = usePreferredCompetition();
  const fromPath = competitionInPathname(pathname);
  if (fromPath) return { competition: fromPath, fromUrl: true };
  const fromQuery = parseCompetition(queryCompetition);
  if (fromQuery) return { competition: fromQuery, fromUrl: true };
  return { competition: preferred ?? DEFAULT_COMPETITION, fromUrl: false };
}
