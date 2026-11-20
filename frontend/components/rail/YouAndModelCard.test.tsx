import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { YouAndModelCard } from "./YouAndModelCard";
import { getLeagueSeasonLeaderboard, getLeagueTipsSummary, getMyLeagueTips } from "@/lib/leagueTips";
import { getOrCreateDeviceId } from "@/lib/session";
import { useAuth } from "@/components/AuthProvider";
import type {
  LeagueSeasonLeaderboardResponse,
  LeagueTipsMineResponse,
  LeagueTipsSummaryResponse,
} from "@/lib/types";

jest.mock("@/lib/leagueTips");
jest.mock("@/components/AuthProvider", () => ({ useAuth: jest.fn() }));
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn() };
});

const mockBoard = getLeagueSeasonLeaderboard as jest.MockedFunction<typeof getLeagueSeasonLeaderboard>;
const mockSummary = getLeagueTipsSummary as jest.MockedFunction<typeof getLeagueTipsSummary>;
const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;
const mockAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const openSignIn = jest.fn();

function auth(signedIn: boolean) {
  mockAuth.mockReturnValue({
    user: signedIn ? ({ id: 1, email: "x", display_name: "X" } as never) : null,
    loading: false,
    openSignIn,
  } as unknown as ReturnType<typeof useAuth>);
}

const BOARD: LeagueSeasonLeaderboardResponse = {
  league: "epl",
  participant_count: 1,
  entries: [
    { handle: "FinalWhistle model", points: 123, exact_count: 11, matchweeks_played: 10, is_model: true },
    { handle: "Someone", points: 5, exact_count: 1, matchweeks_played: 1, is_model: false },
  ],
};

function summary(graded: boolean, points = 0): LeagueTipsSummaryResponse {
  return {
    league: "epl",
    handle: graded ? "SwiftStriker42" : null,
    matchweeks: graded ? [{ matchweek: 10, your_points: points, model_points: 9, matches_played: 3 }] : [],
    totals: { your_points: points, model_points: graded ? 9 : 0, matchweeks_played: graded ? 1 : 0 },
    current_streak: 0,
    best_streak: 0,
    best_matchweek: null,
    disclaimer: "",
  };
}

function mine(picked: boolean): LeagueTipsMineResponse {
  return {
    league: "epl",
    matchweek: 11,
    handle: null,
    disclaimer: "",
    matches: [
      {
        id: 205, home: "Newcastle United", away: "Arsenal", kickoff_utc: "2026-11-21T12:30:00Z",
        status: "scheduled", score_home: null, score_away: null, model: null,
        your_prediction: picked
          ? { predicted_home: 2, predicted_away: 1, points: null, exact: null, graded_at: null, updated_at: null }
          : null,
      },
    ],
  };
}

beforeEach(() => {
  mockDevice.mockReturnValue("device-1");
  mockBoard.mockResolvedValue(BOARD);
  auth(true);
});
afterEach(() => jest.resetAllMocks());

it("shows a fixed-height skeleton while loading", () => {
  mockBoard.mockReturnValue(new Promise(() => {}));
  mockSummary.mockReturnValue(new Promise(() => {}));
  mockMine.mockReturnValue(new Promise(() => {}));
  render(<YouAndModelCard competition="epl" />);
  expect(screen.getByTestId("you-and-model-loading")).toBeInTheDocument();
});

it("shows the viewer's real season points beside the model's once picks are graded", async () => {
  mockSummary.mockResolvedValue(summary(true, 14));
  mockMine.mockResolvedValue(mine(true));
  render(<YouAndModelCard competition="epl" />);
  expect(await screen.findByText("14")).toBeInTheDocument();
  expect(screen.getByText("123")).toBeInTheDocument();
  // Both numbers are real, so the two bars compare them.
  expect(screen.getByTestId("you-and-model-bars").children).toHaveLength(2);
  expect(screen.getByText("Points after 10 matchweeks. Exact score 5, right result 2.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See the leaderboard" })).toHaveAttribute(
    "href",
    "/leaderboard?competition=epl",
  );
  expect(screen.queryByText(/Sample/)).not.toBeInTheDocument();
});

it("shows a dash and 'points appear after full time' when picks exist but none are graded", async () => {
  mockSummary.mockResolvedValue(summary(false));
  mockMine.mockResolvedValue(mine(true));
  render(<YouAndModelCard competition="epl" />);
  expect(await screen.findByText("–")).toBeInTheDocument();
  expect(screen.queryByTestId("you-and-model-bars")).not.toBeInTheDocument();
  expect(screen.getByText(/Your points appear after full time/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Matchweek 11" })).toHaveAttribute("href", "/football/epl?mw=11");
});

it("invites a first pick when signed in with no picks", async () => {
  mockSummary.mockResolvedValue(summary(false));
  mockMine.mockResolvedValue(mine(false));
  render(<YouAndModelCard competition="epl" />);
  expect(await screen.findByText(/Make your first pick this matchweek/)).toBeInTheDocument();
  expect(screen.getByText("–")).toBeInTheDocument();
});

it("signed out with no device picks: only the model's number and a sign-in prompt", async () => {
  auth(false);
  mockSummary.mockResolvedValue(summary(false));
  mockMine.mockResolvedValue(mine(false));
  render(<YouAndModelCard competition="epl" />);
  expect(await screen.findByText("123")).toBeInTheDocument();
  expect(screen.queryByText("You")).not.toBeInTheDocument();
  expect(screen.queryByText("–")).not.toBeInTheDocument();
  // No "You" figure: no bar (a lone full-width model bar compares nothing).
  expect(screen.queryByTestId("you-and-model-bars")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign in to keep your picks across devices" }));
  expect(openSignIn).toHaveBeenCalled();
});

it("renders nothing when the leaderboard request fails", async () => {
  mockBoard.mockRejectedValue(new Error("down"));
  mockSummary.mockResolvedValue(summary(true, 14));
  mockMine.mockResolvedValue(mine(true));
  const { container } = render(<YouAndModelCard competition="epl" />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("renders nothing when the board has no model row", async () => {
  mockBoard.mockResolvedValue({ ...BOARD, entries: BOARD.entries.filter((e) => !e.is_model) });
  mockSummary.mockResolvedValue(summary(true, 14));
  mockMine.mockResolvedValue(mine(true));
  const { container } = render(<YouAndModelCard competition="epl" />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
});

it("renders nothing (and fetches nothing) for a competition without a score-pick game", () => {
  const { container } = render(<YouAndModelCard competition="ucl" />);
  expect(container).toBeEmptyDOMElement();
  render(<YouAndModelCard competition="nrl" />);
  expect(mockBoard).not.toHaveBeenCalled();
});
