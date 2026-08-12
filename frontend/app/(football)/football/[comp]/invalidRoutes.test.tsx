/** Invalid competition-scoped routes must 404, not soft-200.
 *
 *  Context: the sitemap used to advertise every match and team id under
 *  /football/wc26/..., including Premier League ones once the league pipeline
 *  went live. The pages themselves already reject those — the backend 404s when
 *  ?competition= does not match the match's tournament, and the wrapper 404s an
 *  unwired competition segment — but nothing pinned that behaviour, so a
 *  refactor could quietly turn a crawler-visible 404 into a soft-200 with
 *  another competition's data.
 *
 *  app/sitemap.test.ts covers the other half (we no longer publish those URLs).
 */
import { notFound } from "next/navigation";

jest.mock("next/navigation", () => ({
  notFound: jest.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

const mockGetMatch = jest.fn();
const mockGetSummary = jest.fn();
jest.mock("@/lib/api", () => ({
  getMatchServer: (...a: unknown[]) => mockGetMatch(...a),
  getMatchSummaryServer: (...a: unknown[]) => mockGetSummary(...a),
}));

import CompStandingsPage from "./standings/page";
import CompMatchDetailPage from "./match/[id]/page";

afterEach(() => jest.clearAllMocks());

const expectNotFound = async (p: Promise<unknown>) => {
  await expect(p).rejects.toThrow("NEXT_NOT_FOUND");
  expect(notFound).toHaveBeenCalled();
};

describe("unwired competition segments", () => {
  it.each(["nrl", "seriea", "bogus", "wc22"])(
    "404s /football/%s/match/1",
    async (comp) => {
      await expectNotFound(
        CompMatchDetailPage({ params: Promise.resolve({ comp, id: "1" }) }) as Promise<unknown>,
      );
      // Never reached the API — the segment itself is invalid.
      expect(mockGetMatch).not.toHaveBeenCalled();
    },
  );

  it("404s /football/nrl/standings — NRL keeps its own namespace", async () => {
    await expectNotFound(
      CompStandingsPage({ params: Promise.resolve({ comp: "nrl" }) }) as Promise<unknown>,
    );
  });
});

describe("wrong-competition match ids", () => {
  it("404s a club match requested under /football/wc26/...", async () => {
    // This is the exact URL shape the old sitemap published. The backend 404s
    // on the competition mismatch, so both fetches come back null.
    mockGetMatch.mockResolvedValue(null);
    mockGetSummary.mockResolvedValue(null);

    await expectNotFound(
      CompMatchDetailPage({
        params: Promise.resolve({ comp: "wc26", id: "9001" }),
      }) as Promise<unknown>,
    );
  });

  it("passes the URL's competition to the API so the backend can reject it", async () => {
    // Without this argument the backend cannot tell the fixture is foreign, and
    // the page would happily render a Premier League match at a World Cup URL.
    mockGetMatch.mockResolvedValue(null);
    mockGetSummary.mockResolvedValue(null);

    await expect(
      CompMatchDetailPage({
        params: Promise.resolve({ comp: "epl", id: "5" }),
      }) as Promise<unknown>,
    ).rejects.toThrow();

    expect(mockGetMatch).toHaveBeenCalledWith("5", "epl");
  });
});

describe("standings format gating", () => {
  it("404s /football/wc26/standings — WC26's tables live at /groups", async () => {
    // The sitemap must not publish it either; see sitemap.test.ts.
    await expectNotFound(
      CompStandingsPage({ params: Promise.resolve({ comp: "wc26" }) }) as Promise<unknown>,
    );
  });
});
