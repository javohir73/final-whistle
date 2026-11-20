/** NRL club profile page tests — server component (SSR) output. */
import { render, screen } from "@testing-library/react";
import NrlTeamPage from "./page";
import { getNrlLadderServer, getNrlMatchesServer, getNrlTeamServer } from "@/lib/api";
import type { NrlMatch, NrlMatchesResponse, NrlTeamProfile } from "@/lib/types";

jest.mock("@/lib/api");
const mockTeam = getNrlTeamServer as jest.MockedFunction<typeof getNrlTeamServer>;
const mockMatches = getNrlMatchesServer as jest.MockedFunction<typeof getNrlMatchesServer>;
const mockLadder = getNrlLadderServer as jest.MockedFunction<typeof getNrlLadderServer>;

const profile: NrlTeamProfile = {
  season: 2026,
  team: { id: 16, name: "Warriors", elo_rating: 1573.4 },
  ladder: {
    rank: 3, team_id: 16, name: "Warriors", played: 15,
    wins: 10, draws: 0, losses: 5, points: 20, diff: 168,
  },
  summary: {
    played: 15, wins: 10, draws: 0, losses: 5,
    points_for: 390, points_against: 222,
    avg_for: 26.0, avg_against: 14.8, avg_margin: 11.2,
    home: { wins: 6, draws: 0, losses: 2 },
    away: { wins: 4, draws: 0, losses: 3 },
    streak: { result: "W", length: 3 },
    biggest_win: {
      id: 5201, round: 7, match_no: 52, kickoff_utc: null, venue: null,
      opponent: "Titans", opponent_id: 6, was_home: true,
      score_for: 44, score_against: 6, result: "W", model_called: null,
    },
    biggest_loss: {
      id: 5202, round: 2, match_no: 12, kickoff_utc: null, venue: null,
      opponent: "Storm", opponent_id: 5, was_home: false,
      score_for: 10, score_against: 32, result: "L", model_called: null,
    },
  },
  results: [
    {
      id: 5203, round: 18, match_no: 130, kickoff_utc: "2026-07-04T09:35:00+00:00",
      venue: "Go Media Stadium", opponent: "Broncos", opponent_id: 1,
      was_home: true, score_for: 24, score_against: 12, result: "W",
      model_called: true,
    },
    {
      id: 5204, round: 17, match_no: 121, kickoff_utc: "2026-06-27T07:00:00+00:00",
      venue: "Suncorp Stadium", opponent: "Dolphins", opponent_id: 4,
      was_home: false, score_for: 20, score_against: 18, result: "W",
      model_called: null,
    },
  ],
  upcoming: [
    {
      id: 5205, round: 19, match_no: 134, kickoff_utc: "2026-07-10T10:00:00+00:00",
      venue: "Campbelltown Sports Stadium", opponent: "Wests Tigers",
      opponent_id: 17, was_home: false, win_prob: 0.672,
    },
  ],
  model: { graded: 8, called: 6, accuracy: 0.75 },
  disclaimer: "For analytics and entertainment only. Not betting advice.",
};

const params = (id = "16") => Promise.resolve({ id });

const m = (id: number, home: string, away: string, hid: number, aid: number, sh: number | null, sa: number | null,
  status: string, kickoff: string, p_home?: number): NrlMatch => ({
  id, match_no: id, kickoff_utc: kickoff, venue: "Accor Stadium", home, away, home_team_id: hid, away_team_id: aid,
  score_home: sh, score_away: sa, status,
  prediction: p_home == null ? null : { p_home, p_draw: 0.01, p_away: 0.99 - p_home, expected_margin: 3,
    model_version: "nrl-elo-v0.1", created_at: null, is_shadow: true },
});
const regular = Array.from({ length: 8 }, (_, i) => m(100 + i, "A", "B", 1, 2, 10, 8, "finished", "2026-08-01T08:00:00Z"));
/** A complete season: a full regular round, then the finals (4, 2, 2, 1). */
function completeSeason(): NrlMatchesResponse {
  return {
    season: 2026,
    disclaimer: "",
    rounds: [
      { round: 27, matches: regular },
      { round: 28, matches: [
        m(1, "Warriors", "Dolphins", 16, 18, 16, 26, "finished", "2026-09-12T06:05:00Z", 0.54),
        m(2, "Rabbitohs", "Knights", 3, 14, 10, 20, "finished", "2026-09-11T09:50:00Z", 0.61),
        m(3, "Sharks", "Cowboys", 1, 2, 26, 16, "finished", "2026-09-12T09:50:00Z", 0.62),
        m(4, "Panthers", "Roosters", 8, 12, 19, 12, "finished", "2026-09-13T06:05:00Z", 0.61),
      ] },
      { round: 29, matches: [
        m(5, "Roosters", "Sharks", 12, 1, 46, 10, "finished", "2026-09-19T09:50:00Z"),
        m(6, "Warriors", "Knights", 16, 14, 10, 12, "finished", "2026-09-20T06:05:00Z"),
      ] },
      { round: 30, matches: [
        m(7, "Dolphins", "Roosters", 18, 12, 20, 36, "finished", "2026-09-25T09:50:00Z"),
        m(8, "Panthers", "Knights", 8, 14, 14, 22, "finished", "2026-09-27T06:00:00Z"),
      ] },
      { round: 31, matches: [m(9, "Roosters", "Knights", 12, 14, 19, 18, "finished", "2026-10-04T08:30:00Z", 0.64)] },
    ],
  };
}
const roosters: NrlTeamProfile = {
  ...profile,
  team: { id: 12, name: "Roosters", elo_rating: 1600 },
  ladder: { rank: 2, team_id: 12, name: "Roosters", played: 28, wins: 19, draws: 0, losses: 9, points: 38, diff: 164 },
};

beforeEach(() => {
  mockMatches.mockResolvedValue(null);
  mockLadder.mockResolvedValue(null);
});
afterEach(() => jest.resetAllMocks());

it("season complete: crest + name, where the club finished, premiers, three stats", async () => {
  mockTeam.mockResolvedValue(roosters);
  mockMatches.mockResolvedValue(completeSeason());
  const { container } = render(await NrlTeamPage({ params: params("12") }));

  expect(screen.getByRole("heading", { level: 1, name: "Roosters" })).toBeInTheDocument();
  // The 64px crest beside the printed name (decorative: the h1 names the club).
  expect(container.querySelector('[data-club-logo="Roosters"] img')).toHaveAttribute("width", "64");
  expect(screen.getByText("Finished 2nd on the ladder with 38 points. 2026 premiers.")).toBeInTheDocument();
  expect(screen.getByText("19")).toBeInTheDocument();
  expect(screen.getByText("+164")).toBeInTheDocument();
  expect(screen.getByText("points difference")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ladder" })).toHaveAttribute("href", "/nrl/ladder");
});

it("season complete: lists the club's finals with the model's call on each", async () => {
  mockTeam.mockResolvedValue(roosters);
  mockMatches.mockResolvedValue(completeSeason());
  render(await NrlTeamPage({ params: params("12") }));

  const finals = screen.getByRole("region", { name: "Roosters finals" });
  expect(finals).toHaveTextContent("Finals week one");
  expect(finals).toHaveTextContent("Grand Final");
  expect(screen.getByRole("link", { name: "Roosters 19–18 Knights" })).toHaveAttribute("href", "/nrl/match/2026/31/9");
  expect(screen.getAllByText("Called it").length).toBe(2); // Panthers 61% + Roosters 64%
  expect(screen.getAllByText("No call").length).toBe(2); // semi + prelim
  // Not Warriors' games.
  expect(finals).not.toHaveTextContent("Dolphins 26");
});

it("season complete: a club outside the eight gets the 'did not play finals' card", async () => {
  mockTeam.mockResolvedValue({
    ...profile,
    team: { id: 6, name: "Dragons", elo_rating: 1400 },
    ladder: { rank: 17, team_id: 6, name: "Dragons", played: 24, wins: 5, draws: 0, losses: 19, points: 10, diff: -325 },
  });
  mockMatches.mockResolvedValue(completeSeason());
  render(await NrlTeamPage({ params: params("6") }));

  expect(screen.getByText("Dragons did not play finals in 2026.")).toBeInTheDocument();
  expect(screen.getByText("−325")).toBeInTheDocument();
});

it("in season: next matches without the model's win chance, recent results with its verdict", async () => {
  mockTeam.mockResolvedValue(profile);
  render(await NrlTeamPage({ params: params() }));

  expect(screen.getByText("3rd on the ladder with 20 points after 15 matches.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Wests Tigers v Warriors/ })).toHaveAttribute("href", "/nrl/match/2026/19/134");
  // The reveal rule: no win chance on a match still to come.
  expect(screen.queryByText(/67/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Warriors 24–12 Broncos" })).toHaveAttribute("href", "/nrl/match/2026/18/130");
  expect(screen.getByText("Model called it")).toBeInTheDocument();
  expect(screen.getByText("The model called 6 of 8 of their graded matches.")).toBeInTheDocument();
});

it("renders a sparse profile (no games yet) without the stat sections", async () => {
  mockTeam.mockResolvedValue({ ...profile, ladder: null, summary: null, results: [], upcoming: [], model: null });
  render(await NrlTeamPage({ params: params() }));

  expect(screen.getByRole("heading", { level: 1, name: "Warriors" })).toBeInTheDocument();
  expect(screen.queryByText("points difference")).not.toBeInTheDocument();
  expect(screen.queryByText(/graded/)).not.toBeInTheDocument();
});

it("calls notFound() for an unknown team", async () => {
  mockTeam.mockResolvedValue(null);
  await expect(NrlTeamPage({ params: params("9999") })).rejects.toThrow();
});

it("calls notFound() for a non-numeric id without hitting the API", async () => {
  await expect(NrlTeamPage({ params: params("storm") })).rejects.toThrow();
  expect(mockTeam).not.toHaveBeenCalled();
});
