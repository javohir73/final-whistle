/** Leaderboard: premium rows get a small supporter badge next to the display
 *  name; non-premium rows get nothing. Badge renders purely from
 *  `row.premium` — no client-side entitlement derivation. */
import { render, screen, waitFor } from "@testing-library/react";
import { getLeaderboard } from "@/lib/api";
import type { LeaderboardRow } from "@/lib/types";

jest.mock("@/lib/api");
const mockGetLeaderboard = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/components/leagueTips/LeagueYouVsAi", () => ({
  LeagueYouVsAi: ({ league }: { league: string }) => <div data-testid="league-record">{league}</div>,
}));
jest.mock("@/components/leagueTips/LeagueTipsLeaderboard", () => ({
  LeagueTipsLeaderboard: ({ league, seasonOnly }: { league: string; seasonOnly: boolean }) => (
    <div data-testid="league-board">{`${league}-${seasonOnly}`}</div>
  ),
}));
jest.mock("@/components/nrl/YouVsAi", () => ({ YouVsAi: () => <div data-testid="nrl-record" /> }));
jest.mock("@/components/nrl/NrlTipsLeaderboard", () => ({
  NrlTipsLeaderboard: ({ season, seasonOnly }: { season: number; seasonOnly: boolean }) => (
    <div data-testid="nrl-board">{`${season}-${seasonOnly}`}</div>
  ),
}));

import { LeaderboardClient } from "./LeaderboardClient";

const ROWS: LeaderboardRow[] = [
  {
    rank: 1,
    display_name: "Ada",
    champion: null,
    total_points: 12,
    percentile: null,
    updated_at: null,
    premium: true,
  },
  {
    rank: 2,
    display_name: "Grace",
    champion: null,
    total_points: 9,
    percentile: null,
    updated_at: null,
    premium: false,
  },
];

describe("LeaderboardClient — supporter badge", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn: jest.fn() });
    // Background refresh (useFetch keeps polling in via the mocked module) —
    // resolve with the same rows so it never surfaces a stray unhandled error.
    mockGetLeaderboard.mockResolvedValue(ROWS);
  });

  it("shows a supporter badge on premium rows only", async () => {
    render(<LeaderboardClient initialRows={ROWS} />);
    expect(screen.getByLabelText("Premium supporter")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Premium supporter")).toHaveLength(1);
    // Flush the background refresh (useFetch always re-fetches once, even when
    // seeded) so its state update lands inside this test's act(), not after.
    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalled());
  });

  it("shows no badge at all when no rows are premium", async () => {
    const rows = ROWS.map((r) => ({ ...r, premium: false }));
    mockGetLeaderboard.mockResolvedValue(rows);
    render(<LeaderboardClient initialRows={rows} />);
    expect(screen.queryByLabelText("Premium supporter")).not.toBeInTheDocument();
    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalled());
  });

  it("shows La Liga's own record and season board without fetching World Cup brackets", async () => {
    render(<LeaderboardClient competition="laliga" />);

    expect(screen.getByTestId("league-record")).toHaveTextContent("laliga");
    expect(screen.getByTestId("league-board")).toHaveTextContent("laliga-true");
    expect(screen.queryByText(/Public brackets ranked/i)).toBeNull();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "La Liga" })).toHaveAttribute(
      "href",
      "/leaderboard?competition=laliga",
    );
  });

  it("shows NRL's own record and an honest empty season when no round is loaded", () => {
    render(<LeaderboardClient competition="nrl" nrlSeason={null} />);

    expect(screen.getByTestId("nrl-record")).toBeInTheDocument();
    expect(screen.queryByTestId("nrl-board")).toBeNull();
    expect(screen.getByText(/NRL season leaderboard is not available yet/i)).toBeInTheDocument();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });
});
