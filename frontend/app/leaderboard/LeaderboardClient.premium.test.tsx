/** Leaderboard: premium rows get a small supporter badge next to the display
 *  name; non-premium rows get nothing. Badge renders purely from
 *  `row.premium` — no client-side entitlement derivation. */
import { act, render, screen, waitFor } from "@testing-library/react";
import { getLeaderboard } from "@/lib/api";
import type { LeaderboardRow } from "@/lib/types";

jest.mock("@/lib/api");
const mockGetLeaderboard = getLeaderboard as jest.MockedFunction<typeof getLeaderboard>;

const mockUseAuth = jest.fn();
jest.mock("@/components/AuthProvider", () => ({ useAuth: () => mockUseAuth() }));
jest.mock("@/lib/leagueTips", () => ({
  getLeagueTipsSummary: jest.fn(() => new Promise(() => {})),
  getMyLeagueTips: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/components/leagueTips/LeagueTipsLeaderboard", () => ({
  LeagueTipsLeaderboard: ({ league, view }: { league: string; view?: string }) => (
    <div data-testid="league-board">{`${league}-${view}`}</div>
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
    render(<LeaderboardClient competition="wc26" initialRows={ROWS} />);
    expect(screen.getByLabelText("Premium supporter")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Premium supporter")).toHaveLength(1);
    // Flush the background refresh (useFetch always re-fetches once, even when
    // seeded) so its state update lands inside this test's act(), not after.
    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalled());
  });

  it("shows no badge at all when no rows are premium", async () => {
    const rows = ROWS.map((r) => ({ ...r, premium: false }));
    mockGetLeaderboard.mockResolvedValue(rows);
    render(<LeaderboardClient competition="wc26" initialRows={rows} />);
    expect(screen.queryByLabelText("Premium supporter")).not.toBeInTheDocument();
    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalled());
  });

  it("shows La Liga's own season board without fetching World Cup brackets", async () => {
    render(<LeaderboardClient competition="laliga" />);
    await act(async () => {});

    expect(screen.getByTestId("league-board")).toHaveTextContent("laliga-season");
    expect(screen.queryByText(/Public brackets ranked/i)).toBeNull();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { level: 1, name: "Leaderboard" })).toBeInTheDocument();
    expect(screen.getByText(/^La Liga · \d{4}–\d{2}$/)).toBeInTheDocument();
  });

  it("shows NRL's own record and an honest empty season when no round is loaded", async () => {
    render(<LeaderboardClient competition="nrl" nrlSeason={null} />);
    await act(async () => {});

    expect(screen.getByTestId("nrl-record")).toBeInTheDocument();
    expect(screen.queryByTestId("nrl-board")).toBeNull();
    expect(screen.getByText(/NRL season leaderboard is not available yet/i)).toBeInTheDocument();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });
});

describe("LeaderboardClient — scoped to a competition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: null, loading: false, openSignIn: jest.fn() });
    mockGetLeaderboard.mockResolvedValue(ROWS);
  });

  it("defaults to a league -- never the finished World Cup bracket", async () => {
    render(<LeaderboardClient />);
    await act(async () => {});

    expect(screen.getByTestId("league-board")).toHaveTextContent("epl");
    expect(screen.queryByText(/brackets/i)).toBeNull();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });

  it("names the competition in the landmark, states the scoring, and links to this week's matches", async () => {
    render(<LeaderboardClient competition="bundesliga" />);
    await act(async () => {});

    expect(screen.getByRole("region", { name: "Leaderboard · Bundesliga" })).toBeInTheDocument();
    expect(screen.getByText(/Exact score 5 points, right result 2\. Everyone plays against the model\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pick this week’s matches" })).toHaveAttribute(
      "href",
      "/football/bundesliga",
    );
  });

  it("labels the World Cup board as a past tournament's bracket leaderboard", async () => {
    render(<LeaderboardClient competition="wc26" initialRows={ROWS} />);

    expect(screen.getByRole("region", { name: "Leaderboard · World Cup 2026" })).toBeInTheDocument();
    expect(screen.getByText("World Cup 2026 · Past tournament")).toBeInTheDocument();
    await waitFor(() => expect(mockGetLeaderboard).toHaveBeenCalled());
  });

  it("handles a competition with no pick game without borrowing another's board", async () => {
    render(<LeaderboardClient competition="ucl" />);
    await act(async () => {});

    expect(screen.getByRole("heading", { name: "Picks are not open for this competition" })).toBeInTheDocument();
    expect(screen.queryByTestId("league-board")).toBeNull();
    expect(mockGetLeaderboard).not.toHaveBeenCalled();
  });
});
