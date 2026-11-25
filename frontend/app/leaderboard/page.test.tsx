/** /leaderboard opens on the visitor's current competition --
 *  ?competition= first, else fw_comp cookie -> geo -> EPL -- never the
 *  finished World Cup. ?competition=wc26 still reaches the bracket board. */
import LeaderboardPage, { metadata } from "./page";
import { getLeaderboardServer, getNrlTipsheetServer } from "@/lib/api";
import { readServerCompetition } from "@/lib/competitionServer";
import type { NrlTipsheet } from "@/lib/types";

jest.mock("@/lib/api", () => ({
  getLeaderboardServer: jest.fn(),
  getNrlTipsheetServer: jest.fn(),
}));
jest.mock("@/lib/competitionServer", () => ({ readServerCompetition: jest.fn() }));
const mockRedirect = jest.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT ${url}`);
});
jest.mock("next/navigation", () => ({ redirect: (url: string) => mockRedirect(url) }));
// Owned by the play-loop track; this suite only checks what the page hands it.
jest.mock("./LeaderboardClient", () => ({ LeaderboardClient: () => null }));

const mockRows = getLeaderboardServer as jest.MockedFunction<typeof getLeaderboardServer>;
const mockTipsheet = getNrlTipsheetServer as jest.MockedFunction<typeof getNrlTipsheetServer>;
const mockResolved = readServerCompetition as jest.MockedFunction<typeof readServerCompetition>;

const render = (query?: Record<string, string | string[]>) =>
  LeaderboardPage({ searchParams: Promise.resolve(query ?? {}) });

beforeEach(() => {
  mockResolved.mockResolvedValue("epl");
  mockRows.mockResolvedValue([]);
  mockTipsheet.mockResolvedValue({ season: 2026 } as NrlTipsheet);
});
afterEach(() => jest.clearAllMocks());

it("defaults to the resolved current competition, not WC26", async () => {
  mockResolved.mockResolvedValue("laliga");
  const element = await render();
  expect(element.props.competition).toBe("laliga");
  expect(mockRows).not.toHaveBeenCalled(); // no World Cup bracket fetch
});

it("defaults an AU/NZ (or NRL-cookie) visitor to the NRL board", async () => {
  mockResolved.mockResolvedValue("nrl");
  const element = await render();
  expect(element.props.competition).toBe("nrl");
  expect(element.props.nrlSeason).toBe(2026);
});

it("honours ?competition= without reading the request", async () => {
  const element = await render({ competition: "bundesliga" });
  expect(element.props.competition).toBe("bundesliga");
  expect(mockResolved).not.toHaveBeenCalled();
});

it("still serves the World Cup bracket board at ?competition=wc26", async () => {
  mockRows.mockResolvedValue([{ rank: 1 } as never]);
  const element = await render({ competition: "wc26" });
  expect(element.props.competition).toBe("wc26");
  expect(element.props.initialRows).toEqual([{ rank: 1 }]);
});

it("ignores a bogus or prototype-key ?competition=", async () => {
  for (const competition of ["bogus", "toString", "__proto__"]) {
    const element = await render({ competition });
    expect(element.props.competition).toBe("epl");
  }
});

it("takes the first of repeated ?competition= values", async () => {
  const element = await render({ competition: ["ucl", "nrl"] });
  expect(element.props.competition).toBe("ucl");
});

it("is titled as the leaderboard, competition-neutral, not a bracket board", () => {
  expect(metadata.title).toBe("Leaderboard: everyone against the model — FinalWhistle");
  for (const text of [String(metadata.title), String(metadata.description)]) {
    expect(text).not.toMatch(/bracket|world cup|wc26|premier league|nrl/i);
  }
});

it("sends UFC (a query or an old cookie) to the UFC leaderboard", async () => {
  await expect(render({ competition: "ufc" })).rejects.toThrow("NEXT_REDIRECT /ufc/leaderboard");
  mockResolved.mockResolvedValue("ufc");
  await expect(render()).rejects.toThrow("NEXT_REDIRECT /ufc/leaderboard");
});
