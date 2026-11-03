/** Server-side competition resolution: the cookie/geo default for pages that
 *  are already dynamic, the /match/:id + /team/:id lookups, and the scoped
 *  /football/{comp}/match|team guards. */
import { notFound, permanentRedirect, redirect } from "next/navigation";
import { cookies, headers } from "next/headers";
import { getMatchServer, getMatchSummaryServer, getTeamServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import {
  SCOPED_GUARD_BUDGET_MS,
  guardScopedMatch,
  guardScopedTeam,
  legacyMatchTarget,
  legacyTeamTarget,
  readServerCompetition,
  redirectLegacyMatch,
  redirectLegacyTeam,
} from "@/lib/competitionServer";
import type { MatchSummary, Prediction, TeamProfile } from "@/lib/types";

jest.mock("next/headers", () => ({ cookies: jest.fn(), headers: jest.fn() }));
jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
  redirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 307 ${url}`);
  }),
}));
jest.mock("@/lib/api", () => ({
  getMatchServer: jest.fn(),
  getMatchSummaryServer: jest.fn(),
  getTeamServer: jest.fn(),
}));
jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn(async () => ({})) }));

const mockHeaders = headers as jest.MockedFunction<typeof headers>;
const mockCookies = cookies as jest.MockedFunction<typeof cookies>;
const mockPrediction = getMatchServer as jest.MockedFunction<typeof getMatchServer>;
const mockSummary = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;
const mockTeam = getTeamServer as jest.MockedFunction<typeof getTeamServer>;
const mockTournament = getCompetitionTournament as jest.MockedFunction<
  typeof getCompetitionTournament
>;

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

/** A payload with the field (possibly null) or, with no argument, without it
 *  (an older backend). */
function summary(...competition: [string | null] | []): MatchSummary {
  const base = { match_id: 198, teams: { home: "Arsenal", away: "Spurs" } };
  return (competition.length ? { ...base, competition: competition[0] } : base) as MatchSummary;
}
function profile(...competition: [string | null] | []): TeamProfile {
  const base = { team: { id: 7, name: "Arsenal" } };
  return (competition.length ? { ...base, competition: competition[0] } : base) as TeamProfile;
}

beforeEach(() => withRequest({}));
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

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

describe("legacy lookups: permanent only when the backend names the competition", () => {
  it("308s a club match to the competition the backend names", async () => {
    mockSummary.mockResolvedValue(summary("epl"));
    await expect(legacyMatchTarget("198")).resolves.toEqual({
      href: "/football/epl/match/198",
      permanent: true,
    });
    // Asked without a competition filter: the lookup must not presume one.
    expect(mockSummary).toHaveBeenCalledWith("198");
  });

  it("keeps old World Cup shares on the archive, permanently", async () => {
    mockSummary.mockResolvedValue(summary("wc26"));
    await expect(legacyMatchTarget("1")).resolves.toEqual({
      href: "/football/wc26/match/1",
      permanent: true,
    });
  });

  it("guesses WC26 only TEMPORARILY when the payload has no competition field", async () => {
    mockSummary.mockResolvedValue(summary());
    await expect(legacyMatchTarget("5")).resolves.toEqual({
      href: "/football/wc26/match/5",
      permanent: false,
    });
  });

  it("guesses WC26 only TEMPORARILY when the backend errors (e.g. mid-deploy)", async () => {
    mockSummary.mockRejectedValue(new Error("API 503"));
    await expect(legacyMatchTarget("5")).resolves.toEqual({
      href: "/football/wc26/match/5",
      permanent: false,
    });
  });

  it.each([null, "seriea", "nrl", 42])(
    "is a 404 when the backend answers competition %p (nothing we serve)",
    async (competition) => {
      mockSummary.mockResolvedValue(summary(competition as string | null));
      await expect(legacyMatchTarget("5")).resolves.toBeNull();
    },
  );

  it("is a 404 when the backend says the match does not exist", async () => {
    mockSummary.mockResolvedValue(null);
    await expect(legacyMatchTarget("999999")).resolves.toBeNull();
  });

  it("is a 404 for a non-numeric id without asking the backend", async () => {
    await expect(legacyMatchTarget("brazil-v-serbia")).resolves.toBeNull();
    expect(mockSummary).not.toHaveBeenCalled();
  });

  it("resolves teams the same way", async () => {
    mockTeam.mockResolvedValue(profile("laliga"));
    await expect(legacyTeamTarget("7")).resolves.toEqual({
      href: "/football/laliga/team/7",
      permanent: true,
    });
    expect(mockTeam).toHaveBeenCalledWith("7");
    mockTeam.mockResolvedValue(profile());
    await expect(legacyTeamTarget("7")).resolves.toEqual({
      href: "/football/wc26/team/7",
      permanent: false,
    });
    mockTeam.mockResolvedValue(profile(null));
    await expect(legacyTeamTarget("7")).resolves.toBeNull();
  });
});

describe("redirectLegacyMatch / redirectLegacyTeam", () => {
  it("issues a 308 when the backend named the competition", async () => {
    mockSummary.mockResolvedValue(summary("bundesliga"));
    await expect(redirectLegacyMatch("198")).rejects.toThrow(
      "NEXT_REDIRECT 308 /football/bundesliga/match/198",
    );
    expect(permanentRedirect).toHaveBeenCalledTimes(1);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("issues a 307 for the WC26 guess, never a permanent move", async () => {
    mockTeam.mockRejectedValue(new Error("API 502"));
    await expect(redirectLegacyTeam("7")).rejects.toThrow("NEXT_REDIRECT 307 /football/wc26/team/7");
    expect(permanentRedirect).not.toHaveBeenCalled();
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

  it("is a real notFound() for an explicit competition: null", async () => {
    mockTeam.mockResolvedValue(profile(null));
    await expect(redirectLegacyTeam("7")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
    expect(permanentRedirect).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("guardScopedMatch (/football/{comp}/match/{id})", () => {
  it("lets the page render a match that is in this competition", async () => {
    mockPrediction.mockResolvedValue({ match_id: 198 } as Prediction);
    mockSummary.mockResolvedValue(summary("epl"));
    await expect(guardScopedMatch("epl", "198")).resolves.toBeUndefined();
    expect(mockPrediction).toHaveBeenCalledWith("198", "epl");
    expect(mockSummary).toHaveBeenCalledWith("198", "epl");
  });

  it("starts the page's tournament fetch alongside the check", async () => {
    mockPrediction.mockResolvedValue({ match_id: 198 } as Prediction);
    mockSummary.mockResolvedValue(summary("epl"));
    await guardScopedMatch("epl", "198");
    expect(mockTournament).toHaveBeenCalledWith("epl");
  });

  it("keeps a just-drawn tie with a summary but no prediction (the pending view)", async () => {
    mockPrediction.mockResolvedValue(null);
    mockSummary.mockResolvedValue(summary("wc26"));
    await expect(guardScopedMatch("wc26", "76")).resolves.toBeUndefined();
  });

  it("308s a club id under /football/wc26/ to the competition the backend names", async () => {
    mockPrediction.mockResolvedValue(null);
    mockSummary.mockImplementation(async (_id, comp) => (comp ? null : summary("epl")));
    await expect(guardScopedMatch("wc26", "198")).rejects.toThrow(
      "NEXT_REDIRECT 308 /football/epl/match/198",
    );
    expect(mockSummary).toHaveBeenLastCalledWith("198");
  });

  it("404s when the unscoped lookup names no other competition", async () => {
    mockPrediction.mockResolvedValue(null);
    for (const unscoped of [null, summary(null), summary(), summary("wc26")]) {
      mockSummary.mockImplementation(async (_id, comp) => (comp ? null : unscoped));
      // summary("wc26") under wc26 would be a loop: still a 404.
      await expect(guardScopedMatch("wc26", "198")).rejects.toThrow("NEXT_NOT_FOUND");
    }
    expect(permanentRedirect).not.toHaveBeenCalled();
  });

  it("does not turn a backend error into a 404 (the page decides)", async () => {
    mockPrediction.mockRejectedValue(new Error("API 503"));
    mockSummary.mockResolvedValue(null);
    await expect(guardScopedMatch("epl", "198")).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("falls through to the page when the backend is slower than the budget", async () => {
    jest.useFakeTimers();
    mockPrediction.mockReturnValue(new Promise(() => {}));
    mockSummary.mockReturnValue(new Promise(() => {}));
    const guarded = guardScopedMatch("epl", "198");
    await jest.advanceTimersByTimeAsync(SCOPED_GUARD_BUDGET_MS);
    await expect(guarded).resolves.toBeUndefined();
    expect(notFound).not.toHaveBeenCalled();
  });

  it.each(["nrl", "seriea", "bogus"])("404s an unwired competition (%s) without a fetch", async (comp) => {
    await expect(guardScopedMatch(comp, "1")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockPrediction).not.toHaveBeenCalled();
  });

  it("404s a non-numeric id without a fetch", async () => {
    await expect(guardScopedMatch("epl", "arsenal-v-spurs")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockSummary).not.toHaveBeenCalled();
  });
});

describe("guardScopedTeam (/football/{comp}/team/{id})", () => {
  it("lets the page render a team in this competition", async () => {
    mockTeam.mockResolvedValue(profile("laliga"));
    await expect(guardScopedTeam("laliga", "7")).resolves.toBeUndefined();
    expect(mockTeam).toHaveBeenCalledWith("7", "laliga");
    expect(mockTournament).toHaveBeenCalledWith("laliga");
  });

  it("308s a club under /football/wc26/ to its own competition", async () => {
    mockTeam.mockImplementation(async (_id, comp) => (comp ? null : profile("epl")));
    await expect(guardScopedTeam("wc26", "339")).rejects.toThrow(
      "NEXT_REDIRECT 308 /football/epl/team/339",
    );
  });

  it("404s when the team has no other competition either", async () => {
    mockTeam.mockResolvedValue(null);
    await expect(guardScopedTeam("wc26", "7")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("does not turn a backend error into a 404", async () => {
    mockTeam.mockRejectedValue(new Error("API 500"));
    await expect(guardScopedTeam("epl", "7")).resolves.toBeUndefined();
  });

  it("falls through to the page when the backend is slower than the budget", async () => {
    jest.useFakeTimers();
    mockTeam.mockReturnValue(new Promise(() => {}));
    const guarded = guardScopedTeam("epl", "7");
    await jest.advanceTimersByTimeAsync(SCOPED_GUARD_BUDGET_MS);
    await expect(guarded).resolves.toBeUndefined();
  });

  it("404s junk without a fetch", async () => {
    await expect(guardScopedTeam("bogus", "7")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(guardScopedTeam("epl", "Argentina")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mockTeam).not.toHaveBeenCalled();
  });
});
