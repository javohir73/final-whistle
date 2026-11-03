/** A wrong-competition (or unknown) match id under /football/{comp}/match/
 *  must be a REAL 404. The page's own notFound() runs inside this segment's
 *  loading.tsx Suspense boundary, so it streamed as HTTP 200 + noindex (a soft
 *  404; live on /football/wc26/match/198, a Premier League id). The guard in
 *  the segment layout decides before anything streams, and only on the
 *  backend's definitive answer -- a transient error never becomes a 404. */
import { notFound } from "next/navigation";
import { getMatchServer, getMatchSummaryServer } from "@/lib/api";
import type { MatchSummary, Prediction } from "@/lib/types";
import CompMatchLayout from "./layout";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  permanentRedirect: jest.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT 308 ${url}`);
  }),
  redirect: jest.fn(),
}));
jest.mock("next/headers", () => ({ headers: jest.fn(), cookies: jest.fn() }));
jest.mock("@/lib/api", () => ({
  getMatchServer: jest.fn(),
  getMatchSummaryServer: jest.fn(),
  getTeamServer: jest.fn(),
}));
jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn(async () => ({})) }));

const mockPrediction = getMatchServer as jest.MockedFunction<typeof getMatchServer>;
const mockSummary = getMatchSummaryServer as jest.MockedFunction<typeof getMatchSummaryServer>;

const layout = (comp: string, id: string) =>
  CompMatchLayout({ children: "match centre", params: Promise.resolve({ comp, id }) });

afterEach(() => jest.clearAllMocks());

it("renders the page (and its loading skeleton) for a match in this competition", async () => {
  mockPrediction.mockResolvedValue({ match_id: 198 } as Prediction);
  mockSummary.mockResolvedValue({ match_id: 198 } as MatchSummary);
  await expect(layout("epl", "198")).resolves.toBe("match centre");
  // Asked with the URL's competition, so the backend can reject a foreign id;
  // the page's identical calls reuse these (request memoisation).
  expect(mockPrediction).toHaveBeenCalledWith("198", "epl");
  expect(mockSummary).toHaveBeenCalledWith("198", "epl");
  expect(notFound).not.toHaveBeenCalled();
});

it("keeps a just-drawn tie with no prediction yet (the page's pending view)", async () => {
  mockPrediction.mockResolvedValue(null);
  mockSummary.mockResolvedValue({ match_id: 76 } as MatchSummary);
  await expect(layout("wc26", "76")).resolves.toBe("match centre");
});

it("308s a club match requested under /football/wc26/ to its own competition", async () => {
  // Months of links point here: the old static /match/:id redirect sent every
  // id to the World Cup space. The right page is one lookup away.
  mockPrediction.mockResolvedValue(null);
  mockSummary.mockImplementation(async (_id, comp) =>
    comp ? null : ({ match_id: 198, competition: "epl" } as MatchSummary),
  );
  await expect(layout("wc26", "198")).rejects.toThrow("NEXT_REDIRECT 308 /football/epl/match/198");
});

it("404s an id the backend has nowhere (all lookups 404)", async () => {
  mockPrediction.mockResolvedValue(null);
  mockSummary.mockResolvedValue(null);
  await expect(layout("wc26", "999999")).rejects.toThrow("NEXT_NOT_FOUND");
});

it("does not turn a backend error into a 404 (the page decides)", async () => {
  mockPrediction.mockRejectedValue(new Error("API 503"));
  mockSummary.mockResolvedValue(null);
  await expect(layout("epl", "198")).resolves.toBe("match centre");
  mockPrediction.mockResolvedValue(null);
  mockSummary.mockRejectedValue(new Error("API 503"));
  await expect(layout("epl", "198")).resolves.toBe("match centre");
  expect(notFound).not.toHaveBeenCalled();
});

it.each(["nrl", "seriea", "bogus"])("404s an unwired competition segment (%s) without a fetch", async (comp) => {
  await expect(layout(comp, "1")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockPrediction).not.toHaveBeenCalled();
});

it("404s a non-numeric id without a fetch (the backend would 422)", async () => {
  await expect(layout("epl", "arsenal-v-spurs")).rejects.toThrow("NEXT_NOT_FOUND");
  expect(mockSummary).not.toHaveBeenCalled();
});
