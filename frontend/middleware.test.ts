/** @jest-environment node */
/** middleware.ts: current competition = URL -> fw_comp cookie -> geo -> EPL,
 *  exposed to the server as x-fw-comp and persisted in fw_comp. */
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware";
import { LEGACY_SEARCH_HEADER } from "@/lib/competitionPrefs";

const ORIGIN = "https://fifa-wc26-prediction.vercel.app";

/** A real page load, as browsers send it (Fetch Metadata). */
const DOCUMENT = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

function request(
  path: string,
  { cookie, country, headers = DOCUMENT, method = "GET" }: {
    cookie?: string;
    country?: string;
    headers?: Record<string, string>;
    method?: string;
  } = {},
) {
  const h = new Headers(headers);
  if (cookie !== undefined) h.set("cookie", `fw_comp=${cookie}`);
  if (country) h.set("x-vercel-ip-country", country);
  return new NextRequest(new URL(path, ORIGIN), { headers: h, method });
}

/** The x-fw-comp value middleware forwards to server components. */
function exposed(res: Response): string | null {
  return res.headers.get("x-middleware-request-x-fw-comp");
}

function setCookie(res: Response): string | null {
  return res.headers.get("set-cookie");
}

describe("resolution order", () => {
  it("takes the competition from the path", () => {
    const res = middleware(request("/football/laliga/fixtures", { cookie: "nrl", country: "AU" }));
    expect(exposed(res)).toBe("laliga");
  });

  it("takes ?competition= on unscoped routes", () => {
    const res = middleware(request("/play?competition=bundesliga", { cookie: "nrl" }));
    expect(exposed(res)).toBe("bundesliga");
  });

  it("falls back to the cookie on unscoped routes", () => {
    expect(exposed(middleware(request("/", { cookie: "ucl", country: "AU" })))).toBe("ucl");
  });

  it.each([
    ["AU", "nrl"],
    ["NZ", "nrl"],
    ["GB", "epl"],
  ])("uses geo (%s -> %s) when there is no cookie", (country, comp) => {
    expect(exposed(middleware(request("/leaderboard", { country })))).toBe(comp);
  });

  it("defaults to the EPL with no signal at all, never WC26", () => {
    expect(exposed(middleware(request("/")))).toBe("epl");
  });

  it("ignores a tampered cookie or query value", () => {
    expect(exposed(middleware(request("/?competition=toString", { cookie: "__proto__" })))).toBe(
      "epl",
    );
  });
});

describe("fw_comp cookie", () => {
  it("is written on a competition route when it differs, for a year, Lax, path=/", () => {
    const cookie = setCookie(middleware(request("/nrl/ladder", { cookie: "epl" })));
    expect(cookie).toMatch(/^fw_comp=nrl;/);
    expect(cookie).toMatch(/Max-Age=31536000/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/SameSite=lax/i);
    expect(cookie).toMatch(/Secure/i);
    // The client shell reads it; never HttpOnly.
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("is left alone when it already matches", () => {
    expect(setCookie(middleware(request("/football/epl", { cookie: "epl" })))).toBeNull();
  });

  it("is not changed by an unscoped route", () => {
    expect(setCookie(middleware(request("/methodology", { cookie: "laliga", country: "AU" })))).toBeNull();
  });

  it("is seeded from geo on a first visit so the client shell can see it", () => {
    expect(setCookie(middleware(request("/", { country: "AU" })))).toMatch(/^fw_comp=nrl;/);
  });

  it("follows ?competition= on unscoped routes", () => {
    const res = middleware(request("/leaderboard?competition=wc26", { cookie: "epl" }));
    expect(setCookie(res)).toMatch(/^fw_comp=wc26;/);
  });

  it.each<Record<string, string>>([
    // The App Router's own fetches (prefetch AND client navigation look the
    // same here: Next strips Next-Router-Prefetch/RSC before middleware).
    { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" },
    // Browser speculative loads of a document.
    { ...DOCUMENT, "sec-purpose": "prefetch;prerender" },
    { ...DOCUMENT, purpose: "prefetch" },
    // No Fetch Metadata and not asking for HTML (e.g. a bare fetch()).
    { accept: "*/*" },
  ])("is not moved by a non-document request (%o)", (headers) => {
    // Otherwise a page of competition cards sets fw_comp to whichever
    // prefetch lands last. Client navigations are synced by
    // CompetitionProvider (components/TournamentProvider.tsx) instead.
    const res = middleware(request("/nrl", { cookie: "epl", headers }));
    expect(setCookie(res)).toBeNull();
    // ...though the request is still scoped for the server.
    expect(exposed(res)).toBe("nrl");
  });

  it("treats an HTML request without Fetch Metadata (older Safari, crawlers) as a page load", () => {
    const res = middleware(
      request("/nrl", { cookie: "epl", headers: { accept: "text/html,application/xhtml+xml" } }),
    );
    expect(setCookie(res)).toMatch(/^fw_comp=nrl;/);
  });

  it("is only written on GET", () => {
    expect(setCookie(middleware(request("/nrl", { cookie: "epl", method: "POST" })))).toBeNull();
  });
});

it("never redirects or rewrites", () => {
  for (const path of ["/", "/match/198", "/team/7", "/tips?league=laliga", "/football/epl"]) {
    const res = middleware(request(path));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  }
});

it("forwards a legacy lookup's query string so the 308 can keep it", () => {
  const res = middleware(request("/match/198?utm_source=embed"));
  expect(res.headers.get(`x-middleware-request-${LEGACY_SEARCH_HEADER}`)).toBe(
    "?utm_source=embed",
  );
  const plain = middleware(request("/football/epl/match/198?utm_source=embed"));
  expect(plain.headers.get(`x-middleware-request-${LEGACY_SEARCH_HEADER}`)).toBeNull();
});

describe("matcher", () => {
  const runsOn = (url: string) => unstable_doesMiddlewareMatch({ config, url });

  it.each([
    "/",
    "/play",
    "/play?competition=nrl",
    "/leaderboard",
    "/football",
    "/football/epl",
    "/football/epl/match/198",
    "/nrl",
    "/nrl/match/2026/27/1",
    "/match/198",
    "/team/7",
    "/tips",
    "/embedded-thing",
    "/apiary",
  ])("runs on page route %s", (url) => {
    expect(runsOn(url)).toBe(true);
  });

  it.each([
    "/embed",
    "/embed/198",
    "/embed/198?accent=%23ff0000",
    "/backend-api/api/health",
    "/api/anything",
    "/_next/static/chunks/main.js",
    "/_next/image?url=%2Fflags%2Fgb.png&w=64&q=75",
    "/competitions/epl.png",
    "/flags/gb.svg",
    "/clubs/arsenal.png",
    "/icon-192.png",
    "/sw.js",
    "/sitemap.xml",
    "/robots.txt",
    "/manifest.webmanifest",
    "/opengraph-image",
    "/football/epl/match/198/opengraph-image",
    "/nrl/round/27/opengraph-image",
  ])("skips %s", (url) => {
    expect(runsOn(url)).toBe(false);
  });
});
