import { NextResponse, type NextRequest } from "next/server";
import { competitionInPathname } from "@/lib/sports";
import {
  COMPETITION_COOKIE,
  COMPETITION_COOKIE_MAX_AGE,
  COMPETITION_HEADER,
  LEGACY_SEARCH_HEADER,
  competitionForCountry,
  competitionToRemember,
  parseCompetition,
} from "@/lib/competitionPrefs";

/** The unscoped /match/:id and /team/:id lookups (lib/competitionServer.ts). */
const LEGACY_LOOKUP = /^\/(?:match|team)\/[^/]+$/;

/** A path no route matches: rewriting to it renders the app's not-found page
 *  with a real 404 status. */
export const NOT_FOUND_PATH = "/_fw/not-found";

/** /nrl/team/<id> takes integer ids. app/nrl/loading.tsx wraps every /nrl/*
 *  segment, so not even a layout's notFound() lands before streaming starts:
 *  a junk id streamed as HTTP 200 + noindex, and ISR cached one such page per
 *  junk path. The check needs no data, so it lives here. */
const NRL_TEAM_JUNK = /^\/nrl\/team\/(?!\d+$)[^/]+$/;

/** Only a real page load may move the visitor's competition. The App
 *  Router's prefetches and client navigations both arrive as fetch()es, and
 *  Next strips its own markers (Next-Router-Prefetch, RSC, _rsc) before
 *  middleware runs, so the two cannot be told apart here -- and a page of
 *  competition cards would otherwise set fw_comp to whichever prefetch landed
 *  last. Client navigations are synced by CompetitionProvider instead.
 *  Browsers label documents via Fetch Metadata; without it (older Safari,
 *  crawlers) a request that asks for HTML counts as a page load. */
function isPageLoad(request: NextRequest): boolean {
  const h = request.headers;
  const purpose = `${h.get("sec-purpose") ?? ""} ${h.get("purpose") ?? ""}`;
  if (/prefetch|prerender/i.test(purpose)) return false;
  const dest = h.get("sec-fetch-dest");
  if (dest) return dest === "document";
  return (h.get("accept") ?? "").includes("text/html");
}

/** Current competition, resolved once per request: URL (path, then
 *  `?competition=`) -> fw_comp cookie -> x-vercel-ip-country (AU/NZ -> NRL)
 *  -> EPL. Never WC26 by default.
 *
 *  - Exposes the result to server components as the `x-fw-comp` request
 *    header (lib/competitionServer.ts readServerCompetition).
 *  - Keeps the fw_comp cookie in step on page loads: written when a URL names
 *    a different competition (except an archived one reached by its path --
 *    see competitionToRemember), and seeded from geo on a first visit so the
 *    client shell (which cannot see the geo header) scopes AU/NZ visitors to
 *    the NRL on prerendered pages too. 1 year, SameSite=Lax, path=/,
 *    readable by JS.
 *
 *  Never redirects (no redirect chain starts here); the only rewrite sends a
 *  junk NRL club id to a real 404. */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, searchParams, search } = request.nextUrl;
  if (NRL_TEAM_JUNK.test(pathname)) {
    return NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));
  }
  const stored = parseCompetition(request.cookies.get(COMPETITION_COOKIE)?.value);
  const fromPath = competitionInPathname(pathname);
  const fromQuery = parseCompetition(searchParams.get("competition"));
  const fallback = stored ?? competitionForCountry(request.headers.get("x-vercel-ip-country"));
  const resolved = fromPath ?? fromQuery ?? fallback;
  const remember = competitionToRemember(fromPath, fromQuery) ?? fallback;

  const headers = new Headers(request.headers);
  headers.set(COMPETITION_HEADER, resolved);
  // Only middleware may supply it: a client-sent copy would otherwise reach
  // the lookup's redirect target (lib/competitionServer.ts).
  headers.delete(LEGACY_SEARCH_HEADER);
  if (search && LEGACY_LOOKUP.test(pathname)) headers.set(LEGACY_SEARCH_HEADER, search);
  const response = NextResponse.next({ request: { headers } });

  if (remember !== stored && request.method === "GET" && isPageLoad(request)) {
    response.cookies.set({
      name: COMPETITION_COOKIE,
      value: remember,
      maxAge: COMPETITION_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
    });
  }
  return response;
}

export const config = {
  // Pages only. Excluded: build assets, the image optimiser, API routes, the
  // same-origin backend proxy, the partner embed (its own iframe-able header
  // rule in next.config.mjs stays untouched), any path with a file extension
  // (public/ assets, sitemap.xml, robots.txt, sw.js, the manifest) and the
  // generated OG/Twitter image routes.
  matcher: [
    "/((?!_next/static|_next/image|api(?:/|$)|backend-api(?:/|$)|embed(?:/|$)|(?:.*/)?[^/]*\\.[^/]+$|(?:.*/)?(?:opengraph|twitter)-image).*)",
  ],
};
