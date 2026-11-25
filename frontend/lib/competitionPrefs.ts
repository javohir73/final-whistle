/** The visitor's current competition, remembered across visits in the
 *  `fw_comp` cookie so the server (middleware.ts, server pages) and the client
 *  shell (SiteNav/BottomNav/CompetitionOverlay) read the same value.
 *
 *  Resolution, everywhere: URL -> fw_comp cookie -> country (AU/NZ -> NRL)
 *  -> EPL. Never WC26 as a default (it is an archive since July 2026).
 *
 *  Pure + SSR/edge-safe at module level: nothing touches `window` or
 *  `document` until a client-only function is called, and every storage
 *  access is wrapped (Safari private mode throws on access, not just write).
 *  Replaces the CompetitionOverlay's localStorage pin (`fw_pinned_comp`),
 *  which only reordered the switcher list and was invisible to the server;
 *  migratePinnedCompetition() carries an existing pin over once. */
import {
  COMPETITIONS,
  DEFAULT_COMPETITION,
  isCompetitionId,
  type CompetitionId,
} from "@/lib/sports";

export const COMPETITION_COOKIE = "fw_comp";
/** One year, in seconds. */
export const COMPETITION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
/** Request header middleware.ts sets to the resolved competition so server
 *  components that are already dynamic can read it (lib/competitionServer.ts). */
export const COMPETITION_HEADER = "x-fw-comp";
/** Request header middleware.ts sets on legacy /match/:id and /team/:id
 *  requests, carrying the original query string. Those lookups redirect from
 *  a layout (outside the segment's loading.tsx Suspense boundary, so the 308
 *  is a real one) and layouts cannot see searchParams -- this keeps
 *  ?utm_source=embed and the like across the redirect. */
export const LEGACY_SEARCH_HEADER = "x-fw-legacy-search";
/** Dispatched on window whenever this module writes or clears the cookie, so
 *  useSyncExternalStore subscribers (the shell) re-read it. */
export const COMPETITION_CHANGE_EVENT = "fw:competition-change";

const LEGACY_PIN_KEY = "fw_pinned_comp";

/** An untrusted string (cookie, query, header) as a CompetitionId, or null. */
export function parseCompetition(value: string | null | undefined): CompetitionId | null {
  return value && isCompetitionId(value) ? value : null;
}

/** Location default: the NRL for Australia and New Zealand, else the EPL. */
export function competitionForCountry(country: string | null | undefined): CompetitionId {
  const code = country?.trim().toUpperCase();
  return code === "AU" || code === "NZ" ? "nrl" : DEFAULT_COMPETITION;
}

/** Whether a competition may be written to the fw_comp cookie. UFC has no
 *  picks game or leaderboard yet, and "/", "/play" and "/leaderboard" open on
 *  the remembered competition, so remembering UFC would strand a visitor on
 *  pages that redirect them away. */
export function canRemember(id: CompetitionId): boolean {
  return COMPETITIONS[id].sport !== "ufc";
}

/** What a URL should make the remembered competition, or null when it should
 *  change nothing. The competition a path names -- unless the registry marks
 *  it archived: old World Cup shares and four months of search traffic land on
 *  /football/wc26/..., and browsing an archive is not choosing it (one visit
 *  used to scope the whole shell to the finished tournament for a year). An
 *  explicit `?competition=` on an unscoped route is a choice and counts, as do
 *  the switcher and its "Set as default" star (they write the cookie
 *  themselves). A competition that canRemember() refuses (UFC) never counts.
 *  Shared by middleware.ts and CompetitionProvider. */
export function competitionToRemember(
  fromPath: CompetitionId | null,
  fromQuery: CompetitionId | null,
): CompetitionId | null {
  if (fromPath) return COMPETITIONS[fromPath].archived || !canRemember(fromPath) ? null : fromPath;
  return fromQuery && canRemember(fromQuery) ? fromQuery : null;
}

/** Everything after the URL: cookie -> country -> EPL. Callers check the URL
 *  (competitionInPathname / `?competition=`) first. */
export function resolveCompetition({
  cookie,
  country,
}: {
  cookie?: string | null;
  country?: string | null;
}): CompetitionId {
  return parseCompetition(cookie) ?? competitionForCountry(country);
}

/* ---- client-only below: every function guards `document`/`window` ---- */

export function readCompetitionCookie(): CompetitionId | null {
  if (typeof document === "undefined") return null;
  const prefix = `${COMPETITION_COOKIE}=`;
  for (const part of document.cookie.split(";")) {
    const entry = part.trim();
    if (entry.startsWith(prefix)) return parseCompetition(entry.slice(prefix.length));
  }
  return null;
}

function setCookie(value: string, maxAge: number): void {
  if (typeof document === "undefined") return;
  const secure = typeof location !== "undefined" && location.protocol === "https:";
  document.cookie =
    `${COMPETITION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax` +
    (secure ? "; Secure" : "");
  window.dispatchEvent(new Event(COMPETITION_CHANGE_EVENT));
}

export function writeCompetitionCookie(id: CompetitionId): void {
  setCookie(id, COMPETITION_COOKIE_MAX_AGE);
}

export function clearCompetitionCookie(): void {
  setCookie("", 0);
}

/** useSyncExternalStore subscription: this tab's writes, plus a refocus
 *  (another tab, or a Set-Cookie from middleware, may have changed it). */
export function subscribeCompetitionCookie(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(COMPETITION_CHANGE_EVENT, onChange);
  window.addEventListener("focus", onChange);
  return () => {
    window.removeEventListener(COMPETITION_CHANGE_EVENT, onChange);
    window.removeEventListener("focus", onChange);
  };
}

/** One-time move of the old localStorage star into the cookie, run on the
 *  first client load. The star was an explicit choice, so on an unscoped
 *  route it beats whatever middleware inferred (geo) on this first request;
 *  on a competition route the URL wins (it always does). The key is removed
 *  either way so this never runs twice. */
export function migratePinnedCompetition(urlCompetition: CompetitionId | null): void {
  if (typeof window === "undefined") return;
  let pinned: string | null = null;
  try {
    pinned = window.localStorage.getItem(LEGACY_PIN_KEY);
    if (pinned !== null) window.localStorage.removeItem(LEGACY_PIN_KEY);
  } catch {
    return; // private-mode / disabled storage: nothing we can migrate
  }
  const id = parseCompetition(pinned);
  if (id && !urlCompetition) writeCompetitionCookie(id);
}
