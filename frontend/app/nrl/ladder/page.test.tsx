/** /nrl/ladder -- server component (SSR) output. */
import { render, screen, within } from "@testing-library/react";
import NrlLadderPage from "./page";
import { getNrlLadderServer, getNrlMatchesServer } from "@/lib/api";
import type { LadderResponse, NrlMatchesResponse } from "@/lib/types";

jest.mock("@/lib/api");
const mockLadder = getNrlLadderServer as jest.MockedFunction<typeof getNrlLadderServer>;
const mockMatches = getNrlMatchesServer as jest.MockedFunction<typeof getNrlMatchesServer>;

afterEach(() => jest.resetAllMocks());

const row = (rank: number, name: string, extra: Partial<LadderResponse["rows"][number]> = {}) => ({
  rank, team_id: rank, name, played: 24, wins: 14, draws: 0, losses: 10, points: 28, diff: 40, ...extra,
});

const ladder: LadderResponse = {
  season: 2026,
  rows: [
    row(1, "Storm", { diff: 120 }),
    ...Array.from({ length: 7 }, (_, i) => row(i + 2, `Club ${i + 2}`)),
    row(9, "Cowboys", { diff: -94 }),
  ],
  disclaimer: "For analytics and entertainment only. Not betting advice.",
};

const kick = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
function fixtures(open: boolean): NrlMatchesResponse {
  const m = (id: number, k: string, status: string) => ({
    id, match_no: id, kickoff_utc: k, venue: null, home: "A", away: "B", home_team_id: 1, away_team_id: 2,
    score_home: status === "finished" ? 10 : null, score_away: status === "finished" ? 8 : null, status, prediction: null,
  });
  return {
    season: 2026,
    rounds: open
      ? [{ round: 1, matches: [m(1, kick(-3), "finished"), m(2, kick(2), "scheduled")] }]
      : [{ round: 31, matches: [m(1, kick(-40), "finished")] }],
    disclaimer: "",
  };
}

it("renders the final ladder: header set, signed diff with a real minus, finals marker", async () => {
  mockLadder.mockResolvedValue(ladder);
  mockMatches.mockResolvedValue(fixtures(false));

  render(await NrlLadderPage());

  expect(screen.getByRole("heading", { level: 1, name: "Ladder" })).toBeInTheDocument();
  expect(screen.getByText(/The final 2026 ladder/)).toBeInTheDocument();
  expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toEqual([
    "Position", "Club", "P", "W", "L", "Diff", "Pts",
  ]);
  expect(screen.getByRole("link", { name: "Storm" })).toHaveAttribute("href", "/nrl/team/1");
  expect(screen.getByText("+120")).toBeInTheDocument();
  expect(screen.getByText("−94")).toBeInTheDocument();
  expect(screen.getByText("Finals")).toBeInTheDocument();
  // Crests sit beside the printed name -> decorative.
  const cowboys = screen.getByRole("link", { name: "Cowboys" });
  expect(within(cowboys).queryByRole("img")).not.toBeInTheDocument();
  // No run home once the season is over.
  expect(screen.queryByRole("link", { name: /run home/i })).not.toBeInTheDocument();
});

it("adds a D column only when a club has drawn, and the run-home link in season", async () => {
  mockLadder.mockResolvedValue({ ...ladder, rows: [row(1, "Storm", { draws: 1 })] });
  mockMatches.mockResolvedValue(fixtures(true));

  render(await NrlLadderPage());

  expect(screen.getAllByRole("columnheader").map((c) => c.textContent)).toContain("D");
  expect(screen.getByRole("link", { name: "Predict the run home" })).toHaveAttribute("href", "/nrl/run-home");
});

it("calls notFound() when the ladder can't load", async () => {
  mockLadder.mockResolvedValue(null);
  mockMatches.mockResolvedValue(null);
  await expect(NrlLadderPage()).rejects.toThrow();
});
