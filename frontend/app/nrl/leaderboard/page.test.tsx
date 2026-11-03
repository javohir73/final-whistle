/** /nrl/leaderboard renders the NRL board. It used to re-export /leaderboard
 *  and, with no ?competition=, showed the World Cup bracket leaderboard. */
import NrlLeaderboardPage, { metadata } from "./page";
import { getLeaderboardServer, getNrlTipsheetServer } from "@/lib/api";
import { readServerCompetition } from "@/lib/competitionServer";
import type { NrlTipsheet } from "@/lib/types";

jest.mock("@/lib/api", () => ({
  getLeaderboardServer: jest.fn(),
  getNrlTipsheetServer: jest.fn(),
}));
jest.mock("@/lib/competitionServer", () => ({ readServerCompetition: jest.fn() }));
jest.mock("@/app/leaderboard/LeaderboardClient", () => ({ LeaderboardClient: () => null }));

afterEach(() => jest.clearAllMocks());

it("renders the NRL board with the current NRL season", async () => {
  (getNrlTipsheetServer as jest.Mock).mockResolvedValue({ season: 2026 } as NrlTipsheet);
  const element = await NrlLeaderboardPage();
  expect(element.props.competition).toBe("nrl");
  expect(element.props.nrlSeason).toBe(2026);
  // Never the World Cup bracket board, and no request read (static-capable).
  expect(getLeaderboardServer).not.toHaveBeenCalled();
  expect(readServerCompetition).not.toHaveBeenCalled();
});

it("has its own NRL metadata and canonical", () => {
  expect(String(metadata.title)).toMatch(/^NRL/);
  expect(metadata.alternates?.canonical).toBe("/nrl/leaderboard");
});
