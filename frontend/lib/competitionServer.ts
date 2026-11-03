/** Server-only competition resolution. Kept apart from lib/competitionPrefs.ts
 *  (which client components and the edge middleware import) because it pulls
 *  in next/headers and the backend fetchers.
 *
 *  Calling readServerCompetition() makes a route dynamic (it reads the
 *  request), so only call it from pages that are dynamic anyway -- never from
 *  the root layout, which would switch off ISR for every route. */
import { cookies, headers } from "next/headers";
import { notFound, permanentRedirect } from "next/navigation";
import { getMatchSummaryServer, getTeamServer } from "@/lib/api";
import {
  COMPETITION_COOKIE,
  COMPETITION_HEADER,
  LEGACY_SEARCH_HEADER,
  parseCompetition,
  resolveCompetition,
} from "@/lib/competitionPrefs";
import {
  asFootballCompetition,
  footballMatchHref,
  footballTeamHref,
  type CompetitionId,
} from "@/lib/sports";

/** The visitor's current competition for an unscoped page: middleware's
 *  resolved `x-fw-comp` header, else (middleware did not run) the same
 *  cookie -> geo -> EPL resolution it would have done. */
export async function readServerCompetition(): Promise<CompetitionId> {
  const h = await headers();
  const exposed = parseCompetition(h.get(COMPETITION_HEADER));
  if (exposed) return exposed;
  const jar = await cookies();
  return resolveCompetition({
    cookie: jar.get(COMPETITION_COOKIE)?.value,
    country: h.get("x-vercel-ip-country"),
  });
}

/* ----------------------------------------------------------------------------
 * /match/:id and /team/:id: every share since June, the partner embed's
 * backlink and the old default card links point here. They used to 308
 * straight to /football/wc26/..., a soft 404 for every club id. Now they ask
 * the backend which competition the id belongs to.
 * ------------------------------------------------------------------------- */

/** Where unscoped ids went before this lookup existed. Used whenever the
 *  backend can't say (older backend without `competition`, an unknown value,
 *  a transient error), so a failure is never worse than the old behaviour. */
const LEGACY_COMPETITION: CompetitionId = "wc26";

/** The competition for a looked-up record; null means the backend said 404. */
async function lookupCompetition(
  fetchRecord: () => Promise<{ competition?: unknown } | null>,
): Promise<CompetitionId | null> {
  let record: { competition?: unknown } | null;
  try {
    record = await fetchRecord();
  } catch {
    return LEGACY_COMPETITION;
  }
  if (record === null) return null;
  return asFootballCompetition(record.competition) ?? LEGACY_COMPETITION;
}

/** The scoped URL for a legacy /match/:id, or null for a 404. */
export async function legacyMatchHref(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const competition = await lookupCompetition(() => getMatchSummaryServer(id));
  return competition && footballMatchHref(competition, id);
}

/** The scoped URL for a legacy /team/:id, or null for a 404. */
export async function legacyTeamHref(id: string): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const competition = await lookupCompetition(() => getTeamServer(id));
  return competition && footballTeamHref(competition, id);
}

/** The original request's query string, forwarded by middleware.ts. */
async function legacySearch(): Promise<string> {
  const search = (await headers()).get(LEGACY_SEARCH_HEADER) ?? "";
  return search.startsWith("?") ? search : "";
}

async function redirectTo(href: string | null): Promise<never> {
  if (!href) notFound();
  permanentRedirect(href + (await legacySearch()));
}

/** Throws Next's 308 to the scoped match page, or a real 404. Call it from
 *  the segment's layout: the page sits inside loading.tsx's Suspense boundary,
 *  where a redirect would stream as a 200 with a meta refresh instead. */
export async function redirectLegacyMatch(id: string): Promise<never> {
  return redirectTo(await legacyMatchHref(id));
}

/** Team twin of redirectLegacyMatch. */
export async function redirectLegacyTeam(id: string): Promise<never> {
  return redirectTo(await legacyTeamHref(id));
}
