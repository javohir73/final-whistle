/** /match/:id is a competition lookup (the embed backlink and every share
 *  since June point here). It must 308 a club match to its own competition --
 *  the old static redirect sent every id to /football/wc26/..., a soft 404
 *  for club matches (live: /match/198 -> blank "Match — FinalWhistle").
 *
 *  The match-centre render tests that used to live here exercised
 *  MatchPageContent through this route; the route no longer renders it, so
 *  they belong with the match-centre owner (scoped /football/{comp}/match). */
import { notFound, permanentRedirect } from "next/navigation";
import { headers } from "next/headers";
import { getMatchSummaryServer } from "@/lib/api";
import type { MatchSummary } from "@/lib/types";
import LegacyMatchLookupPage, { metadata } from "./page";
import LegacyMatchLookupLayout from "./layout";

jest.mock("next/headers", () => ({ headers: jest.fn(), cookies: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
}));
jest.mock("@/lib/api", () => ({ getMatchSummaryServer: jest.fn(), getTeamServer: jest.fn() }));

const mockSummary = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;
const mockHeaders = headers as jest.MockedFunction<typeof headers>;

const summary = (competition?: string) =>
  ({ match_id: 198, competition }) as unknown as MatchSummary;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const layoutProps = (id: string) => ({ children: null, ...params(id) });

beforeEach(() => {
  mockHeaders.mockResolvedValue(new Headers() as unknown as Awaited<ReturnType<typeof headers>>);
});
afterEach(() => jest.clearAllMocks());

it.each([
  ["epl", "/football/epl/match/198"],
  ["laliga", "/football/laliga/match/198"],
  ["ucl", "/football/ucl/match/198"],
  ["wc26", "/football/wc26/match/198"],
])("308s a %s match to %s", async (competition, href) => {
  mockSummary.mockResolvedValue(summary(competition));
  await expect(LegacyMatchLookupLayout(layoutProps("198"))).rejects.toThrow(
    `NEXT_REDIRECT 308 ${href}`,
  );
  expect(permanentRedirect).toHaveBeenCalledWith(href);
});

it("keeps the embed's utm_source across the redirect", async () => {
  mockHeaders.mockResolvedValue(
    new Headers({ "x-fw-legacy-search": "?utm_source=embed" }) as unknown as Awaited<
      ReturnType<typeof headers>
    >,
  );
  mockSummary.mockResolvedValue(summary("epl"));
  await expect(LegacyMatchLookupLayout(layoutProps("198"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/epl/match/198?utm_source=embed",
  );
});

it("falls back to today's WC26 path when the backend has no competition field", async () => {
  mockSummary.mockResolvedValue(summary(undefined));
  await expect(LegacyMatchLookupLayout(layoutProps("1"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/wc26/match/1",
  );
});

it("falls back to the WC26 path when the lookup fails", async () => {
  mockSummary.mockRejectedValue(new Error("API 502"));
  await expect(LegacyMatchLookupLayout(layoutProps("1"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/wc26/match/1",
  );
});

it("is a real 404 when the backend has no such match", async () => {
  mockSummary.mockResolvedValue(null);
  await expect(LegacyMatchLookupLayout(layoutProps("999999"))).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalled();
  expect(permanentRedirect).not.toHaveBeenCalled();
});

it("runs the same lookup from the page, which never renders content", async () => {
  mockSummary.mockResolvedValue(summary("bundesliga"));
  await expect(LegacyMatchLookupPage(params("198"))).rejects.toThrow(
    "NEXT_REDIRECT 308 /football/bundesliga/match/198",
  );
});

it("is never indexed", () => {
  expect(metadata.robots).toEqual({ index: false, follow: true });
});
