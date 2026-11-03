/** Server-only competition resolution. Kept apart from lib/competitionPrefs.ts
 *  (which client components and the edge middleware import) because it pulls
 *  in next/headers and the backend fetchers.
 *
 *  Calling readServerCompetition() makes a route dynamic (it reads the
 *  request), so only call it from pages that are dynamic anyway -- never from
 *  the root layout, which would switch off ISR for every route. */
import { cookies, headers } from "next/headers";
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { getMatchServer, getMatchSummaryServer, getTeamServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
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
  isWiredFootballCompetition,
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
 * Which competition does a football id belong to? The backend's match summary
 * and team profile carry `competition` ("epl", "wc26", ... or null for none).
 * ------------------------------------------------------------------------- */

/** What the backend said about an id's competition:
 *  - named: a wired football competition -- a definitive, permanent answer;
 *  - none: the id doesn't exist, or exists with no competition we serve
 *    (`competition: null`, or one with no /football page) -- a 404;
 *  - unknown: we couldn't tell (error, timeout, or an older payload without
 *    the field) -- never treated as permanent. */
type Lookup =
  | { kind: "named"; competition: CompetitionId }
  | { kind: "none" }
  | { kind: "unknown" };

async function lookupCompetition(
  fetchRecord: () => Promise<{ competition?: unknown } | null>,
): Promise<Lookup> {
  let record: { competition?: unknown } | null;
  try {
    record = await fetchRecord();
  } catch {
    return { kind: "unknown" };
  }
  if (record === null) return { kind: "none" };
  if (record.competition === undefined) return { kind: "unknown" };
  const competition = asFootballCompetition(record.competition);
  return competition ? { kind: "named", competition } : { kind: "none" };
}

/* ----------------------------------------------------------------------------
 * /match/:id and /team/:id: every share since June, the partner embed's
 * backlink and the old default card links point here. They used to 308
 * straight to /football/wc26/..., a soft 404 for every club id. Now they ask
 * the backend which competition the id belongs to.
 * ------------------------------------------------------------------------- */

/** Where unscoped ids went before this lookup existed -- the guess when the
 *  backend can't say, so a failure is never worse than the old behaviour. */
const LEGACY_COMPETITION: CompetitionId = "wc26";

/** Where a legacy URL goes: permanent only when the backend named the
 *  competition. A guess is a temporary 307, so a backend deploy or an older
 *  payload never teaches crawlers or browsers a permanent wrong move. */
export type LegacyTarget = { href: string; permanent: boolean } | null;

function legacyTarget(found: Lookup, href: (c: CompetitionId) => string): LegacyTarget {
  if (found.kind === "none") return null;
  if (found.kind === "named") return { href: href(found.competition), permanent: true };
  return { href: href(LEGACY_COMPETITION), permanent: false };
}

/** The scoped target for a legacy /match/:id, or null for a 404. */
export async function legacyMatchTarget(id: string): Promise<LegacyTarget> {
  if (!/^\d+$/.test(id)) return null;
  const found = await lookupCompetition(() => getMatchSummaryServer(id));
  return legacyTarget(found, (c) => footballMatchHref(c, id));
}

/** The scoped target for a legacy /team/:id, or null for a 404. */
export async function legacyTeamTarget(id: string): Promise<LegacyTarget> {
  if (!/^\d+$/.test(id)) return null;
  const found = await lookupCompetition(() => getTeamServer(id));
  return legacyTarget(found, (c) => footballTeamHref(c, id));
}

/** The original request's query string, forwarded by middleware.ts. */
async function legacySearch(): Promise<string> {
  const search = (await headers()).get(LEGACY_SEARCH_HEADER) ?? "";
  return search.startsWith("?") ? search : "";
}

async function redirectTo(target: LegacyTarget): Promise<never> {
  if (!target) notFound();
  const href = target.href + (await legacySearch());
  if (target.permanent) permanentRedirect(href);
  redirect(href);
}

/** Throws Next's redirect to the scoped match page (308 when the backend
 *  named the competition, 307 for the WC26 guess), or a real 404. Call it
 *  from the segment's layout: the page sits inside loading.tsx's Suspense
 *  boundary, where a redirect would stream as a 200 with a meta refresh. */
export async function redirectLegacyMatch(id: string): Promise<never> {
  return redirectTo(await legacyMatchTarget(id));
}

/** Team twin of redirectLegacyMatch. */
export async function redirectLegacyTeam(id: string): Promise<never> {
  return redirectTo(await legacyTeamTarget(id));
}

/* ----------------------------------------------------------------------------
 * /football/{comp}/match/{id} and /team/{id} guards, called from the segment
 * layouts so a 404 or redirect is decided before loading.tsx streams (a
 * page-level notFound() behind that boundary is a soft 404: HTTP 200).
 * Request-free on purpose: these routes are ISR, and reading the request
 * here would make every one of them dynamic.
 * ------------------------------------------------------------------------- */

/** How long a guard waits on the backend before letting the page stream
 *  anyway. Past it, the page (and its loading skeleton) takes over and still
 *  enforces its own 404 -- a slow backend degrades to the old streaming
 *  behaviour instead of a blank screen. Only a definitive answer blocks. */
export const SCOPED_GUARD_BUDGET_MS = 2500;

const TIMED_OUT = Symbol("timed out");

async function withinBudget<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), SCOPED_GUARD_BUDGET_MS);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** The id is definitively not in `comp`. Months of links point at
 *  /football/wc26/... for club ids (the old static redirect), so ask once
 *  without a competition: 308 to the competition the backend names, else a
 *  real 404. Never redirects to the same competition (no loop). */
async function redirectToOwnCompetition(
  comp: CompetitionId,
  fetchUnscoped: () => Promise<{ competition?: unknown } | null>,
  href: (c: CompetitionId) => string,
): Promise<never> {
  const found = await withinBudget(lookupCompetition(fetchUnscoped));
  if (found !== TIMED_OUT && found.kind === "named" && found.competition !== comp) {
    permanentRedirect(href(found.competition));
  }
  notFound();
}

const unknown = () => undefined;

/** Returns when /football/{comp}/match/{id} should render; otherwise throws
 *  Next's 404, or a 308 to the match's own competition. 404 only when the
 *  backend definitively has neither a prediction nor a summary for the id in
 *  this competition -- the page's own rule (a summary alone is its pending
 *  view). The page repeats these calls; request memoisation answers them. */
export async function guardScopedMatch(comp: string, id: string): Promise<void> {
  // Match ids are integers (the backend 422s anything else).
  if (!isWiredFootballCompetition(comp) || !/^\d+$/.test(id)) notFound();
  // The page needs this next; starting it here keeps it parallel with the
  // check instead of queued behind it (memoised for the page).
  void getCompetitionTournament(comp);
  const scoped = await withinBudget(
    Promise.all([
      getMatchServer(id, comp).catch(unknown),
      getMatchSummaryServer(id, comp).catch(unknown),
    ]),
  );
  // Too slow, found, or unknown (a call failed): the page decides.
  if (scoped === TIMED_OUT || scoped[0] !== null || scoped[1] !== null) return;
  await redirectToOwnCompetition(comp, () => getMatchSummaryServer(id), (c) =>
    footballMatchHref(c, id),
  );
}

/** Team twin of guardScopedMatch: 404 (or 308 to the team's own
 *  competition) when the backend says the team isn't in this one. */
export async function guardScopedTeam(comp: string, id: string): Promise<void> {
  if (!isWiredFootballCompetition(comp) || !/^\d+$/.test(id)) notFound();
  void getCompetitionTournament(comp);
  const profile = await withinBudget(getTeamServer(id, comp).catch(unknown));
  if (profile !== null) return;
  await redirectToOwnCompetition(comp, () => getTeamServer(id), (c) => footballTeamHref(c, id));
}
