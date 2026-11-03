/** Server-side competition resolution: the cookie/geo default for pages that
 *  are already dynamic, and the /match/:id + /team/:id lookups. */
import { notFound, permanentRedirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getMatchSummaryServer, getTeamServer } from "@/lib/api";
import {
  legacyMatchHref,
  legacyTeamHref,
  readServerCompetition,
  redirectLegacyMatch,
  redirectLegacyTeam,
} from "@/lib/competitionServer";
import type { MatchSummary, TeamProfile } from "@/lib/types";

jest.mock("next/headers", () => ({ cookies: jest.fn(), headers: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
}));
jest.mock("@/lib/api", () => ({
  getMatchSummaryServer: jest.fn(),
  getTeamServer: jest.fn(),
}));

const mockHeaders = headers as jest.MockedFunction<typeof headers>;
const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockSummary = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;
const mockTeam = getTeamServer as jest.MockedFunction<typeof getTeamServer>;

function withRequest({
  header = {},
  cookie,
}: {
  header?: Record<string, string>;
  cookie?: string;
}) {
  const h = new Headers(header);
  mockHeaders.mockResolvedValue(h as unknown as Awaited<ReturnType<typeof headers>>);
  mockCookies.mockResolvedValue({
    get: (name: string) => (name === "fw_comp" && cookie ? { name, value: cookie } : undefined),
  } as unknown as Awaited<ReturnType<typeof cookies>>);
}

const summary = (competition?: string | null) =>
  ({ match_id: 198, teams: { home: "Arsenal", away: "Spurs" }, competition }) as unknown as MatchSummary;
const profile = (competition?: string | null) =>
  ({ team: { id: 7, name: "Arsenal" }, competition }) as unknown as TeamProfile;

beforeEach(() => withRequest({}));
afterEach(() => jest.clearAllMocks());

describe("readServerCompetition", () => {
  it("trusts middleware's resolved x-fw-comp header first", async () => {
    withRequest({ header: { "x-fw-comp": "laliga", "x-vercel-ip-country": "AU" }, cookie: "nrl" });
    await expect(readServerCompetition()).resolves.toBe("laliga");
  });

  it("falls back to the cookie, then geo, then the EPL (never WC26)", async () => {
    withRequest({ cookie: "ucl", header: { "x-vercel-ip-country": "AU" } });
    await expect(readServerCompetition()).resolves.toBe("ucl");
    withRequest({ header: { "x-vercel-ip-country": "NZ" } });
    await expect(readServerCompetition()).resolves.toBe("nrl");
    withRequest({});
    await expect(readServerCompetition()).resolves.toBe("epl");
  });

  it("ignores tampered values", async () => {
    withRequest({ header: { "x-fw-comp": "toString" }, cookie: "__proto__" });
    await expect(readServerCompetition()).resolves.toBe("epl");
  });
});

describe("legacyMatchHref (/match/:id)", () => {
  it("resolves a club match to its own competition", async () => {
    mockSummary.mockResolvedValue(summary("epl"));
    await expect(legacyMatchHref("198")).resolves.toBe("/football/epl/match/198");
    // Asked without a competition filter: the lookup must not presume one.
    expect(mockSummary).toHaveBeenCalledWith("198");
  });

  it("keeps old World Cup shares on the archive", async () => {
    mockSummary.mockResolvedValue(summary("wc26"));
    await expect(legacyMatchHref("1")).resolves.toBe("/football/wc26/match/1");
  });

  it.each([undefined, null, "seriea", "nrl", 42])(
    "falls back to the WC26 path when the field is %p (older backend / unknown)",
    async (competition) => {
      mockSummary.mockResolvedValue(summary(competition as string | null | undefined));
      await expect(legacyMatchHref("5")).resolves.toBe("/football/wc26/match/5");
    },
  );

  it("falls back to the WC26 path when the backend errors", async () => {
    mockSummary.mockRejectedValue(new Error("API 503"));
    await expect(legacyMatchHref("5")).resolves.toBe("/football/wc26/match/5");
  });

  it("is a 404 when the backend says the match does not exist", async () => {
    mockSummary.mockResolvedValue(null);
    await expect(legacyMatchHref("999999")).resolves.toBeNull();
  });

  it("is a 404 for a non-numeric id without asking the backend", async () => {
    await expect(legacyMatchHref("brazil-v-serbia")).resolves.toBeNull();
    expect(mockSummary).not.toHaveBeenCalled();
  });
});

describe("legacyTeamHref (/team/:id)", () => {
  it("resolves a club to its own competition", async () => {
    mockTeam.mockResolvedValue(profile("laliga"));
    await expect(legacyTeamHref("7")).resolves.toBe("/football/laliga/team/7");
    expect(mockTeam).toHaveBeenCalledWith("7");
  });

  it("falls back to the WC26 path without the field or on error", async () => {
    mockTeam.mockResolvedValue(profile(undefined));
    await expect(legacyTeamHref("7")).resolves.toBe("/football/wc26/team/7");
    mockTeam.mockRejectedValue(new Error("API 500"));
    await expect(legacyTeamHref("7")).resolves.toBe("/football/wc26/team/7");
  });

  it("is a 404 when the team does not exist", async () => {
    mockTeam.mockResolvedValue(null);
    await expect(legacyTeamHref("7")).resolves.toBeNull();
  });
});

describe("redirectLegacyMatch / redirectLegacyTeam", () => {
  it("issues a permanent (308) redirect to the scoped page", async () => {
    mockSummary.mockResolvedValue(summary("bundesliga"));
    await expect(redirectLegacyMatch("198")).rejects.toThrow(
      "NEXT_REDIRECT 308 /football/bundesliga/match/198",
    );
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
  });

  it("keeps the original query string (e.g. the embed's utm_source)", async () => {
    withRequest({ header: { "x-fw-legacy-search": "?utm_source=embed" } });
    mockSummary.mockResolvedValue(summary("epl"));
    await expect(redirectLegacyMatch("198")).rejects.toThrow(
      "NEXT_REDIRECT 308 /football/epl/match/198?utm_source=embed",
    );
  });

  it("drops a forwarded value that is not a query string", async () => {
    withRequest({ header: { "x-fw-legacy-search": "//evil.example" } });
    mockTeam.mockResolvedValue(profile("epl"));
    await expect(redirectLegacyTeam("7")).rejects.toThrow("NEXT_REDIRECT 308 /football/epl/team/7");
  });

  it("is a real notFound() when the backend 404s", async () => {
    mockTeam.mockResolvedValue(null);
    await expect(redirectLegacyTeam("7")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
  });
});
