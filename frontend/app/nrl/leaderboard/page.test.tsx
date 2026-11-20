/** /nrl/leaderboard renders the NRL season board on its own page (it used to
 *  re-export /leaderboard and, with no ?competition=, showed the World Cup
 *  bracket leaderboard). */
import { render, screen } from "@testing-library/react";
import NrlLeaderboardPage, { metadata } from "./page";
import { getLeaderboardServer, getNrlTipsheetServer } from "@/lib/api";
import type { NrlTipsheet } from "@/lib/types";

jest.mock("@/lib/api", () => ({
  getLeaderboardServer: jest.fn(),
  getNrlTipsheetServer: jest.fn(),
}));
jest.mock("@/components/nrl/NrlTipsLeaderboard", () => ({
  NrlTipsLeaderboard: ({ season, seasonOnly }: { season: number; seasonOnly?: boolean }) => (
    <div data-testid="board">{`${season}-${seasonOnly ? "season" : "weekly"}`}</div>
  ),
}));

afterEach(() => jest.clearAllMocks());

const finished = {
  id: 1, match_no: 213, kickoff_utc: "2026-10-04T08:30:00+00:00", venue: "Accor Stadium",
  home: "Roosters", away: "Knights", home_team_id: 12, away_team_id: 14,
  score_home: 19, score_away: 18, status: "finished", prediction: null,
};

it("renders the NRL season board with the current NRL season, and no reminder", async () => {
  (getNrlTipsheetServer as jest.Mock).mockResolvedValue({ season: 2026, round: 31, matches: [finished] } as unknown as NrlTipsheet);
  render(await NrlLeaderboardPage());
  expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
  expect(screen.getByText("The final 2026 standings. One point for each winner tipped.")).toBeInTheDocument();
  expect(screen.getByTestId("board")).toHaveTextContent("2026-season");
  expect(screen.queryByRole("button", { name: /remind/i })).not.toBeInTheDocument();
  // Never the World Cup bracket board.
  expect(getLeaderboardServer).not.toHaveBeenCalled();
});

it("has its own NRL metadata and canonical", () => {
  expect(String(metadata.title)).toMatch(/^NRL/);
  expect(metadata.alternates?.canonical).toBe("/nrl/leaderboard");
});
