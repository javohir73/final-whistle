/** /nrl/record -- server component output: season total, finals series with
 *  the model's call per match, the rail ladder; an empty state before grading. */
import { render, screen } from "@testing-library/react";
import NrlRecordPage from "./page";
import { getNrlLadderServer, getNrlMatchesServer, getNrlRecordServer } from "@/lib/api";
import type { NrlMatch, NrlMatchesResponse, NrlRecord } from "@/lib/types";

jest.mock("@/lib/api");
const mockRecord = getNrlRecordServer as jest.MockedFunction<typeof getNrlRecordServer>;
const mockMatches = getNrlMatchesServer as jest.MockedFunction<typeof getNrlMatchesServer>;
const mockLadder = getNrlLadderServer as jest.MockedFunction<typeof getNrlLadderServer>;

const record: NrlRecord = {
  evaluated_matches: 76, winner_accuracy: 0.6447, winner_accuracy_ci95: [0.5326, 0.743],
  avg_log_loss: 0.6589, avg_brier: 0.4532, best_streak: 6, last_updated: "2026-10-04T08:00:00Z",
  model_version: "nrl-elo-v0.1", disclaimer: "",
};
const pred = (p: number) => ({ p_home: p, p_draw: 0.01, p_away: 0.99 - p, expected_margin: 3, model_version: "v", created_at: null, is_shadow: true });
const m = (id: number, sh: number, sa: number, p: number | null): NrlMatch => ({
  id, match_no: id, kickoff_utc: "2026-09-12T06:00:00Z", venue: "Accor Stadium", home: `H${id}`, away: `A${id}`,
  home_team_id: id, away_team_id: id + 50, score_home: sh, score_away: sa, status: "finished", prediction: p == null ? null : pred(p),
});
const season: NrlMatchesResponse = {
  season: 2026, disclaimer: "",
  rounds: [
    { round: 27, matches: Array.from({ length: 8 }, (_, i) => m(100 + i, 10, 8, null)) },
    { round: 28, matches: [m(1, 10, 20, 0.61), m(2, 26, 16, 0.62), m(3, 10, 8, 0.6), m(4, 19, 12, 0.61)] },
    { round: 29, matches: [m(5, 46, 10, null), m(6, 10, 12, null)] },
    { round: 30, matches: [m(7, 20, 36, null), m(8, 14, 22, null)] },
    { round: 31, matches: [m(9, 19, 18, 0.64)] },
  ],
};

beforeEach(() => mockLadder.mockResolvedValue(null));
afterEach(() => jest.resetAllMocks());

it("renders the season total from the record endpoint", async () => {
  mockRecord.mockResolvedValue(record);
  mockMatches.mockResolvedValue(season);
  render(await NrlRecordPage());
  expect(screen.getByRole("heading", { level: 1, name: "The model’s record" })).toBeInTheDocument();
  expect(screen.getByText(/Last updated 4 October 2026/)).toBeInTheDocument();
  expect(screen.getByText("of winners called, 49 of 76")).toBeInTheDocument();
  expect(screen.getByText("53–74%")).toBeInTheDocument();
  expect(screen.getByText("Model version nrl-elo-v0.1. Average log loss 0.659.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "NRL" })).toHaveAttribute("href", "/nrl");
});

it("lists the finals by stage with the model's verdict, and says where it made no call", async () => {
  mockRecord.mockResolvedValue(record);
  mockMatches.mockResolvedValue(season);
  render(await NrlRecordPage());
  for (const stage of ["Finals week one", "Semi-finals", "Preliminary finals", "Grand Final"]) {
    expect(screen.getByRole("heading", { name: stage })).toBeInTheDocument();
  }
  expect(screen.getAllByText("Called it")).toHaveLength(4);
  expect(screen.getAllByText("Missed")).toHaveLength(1);
  expect(screen.getAllByText("No call")).toHaveLength(4);
  expect(screen.getByText("The model made no call on the semi-finals or preliminary finals.")).toBeInTheDocument();
});

it("shows an empty state before anything is graded", async () => {
  mockRecord.mockResolvedValue({ ...record, evaluated_matches: 0, winner_accuracy: null });
  mockMatches.mockResolvedValue(null);
  render(await NrlRecordPage());
  expect(screen.getByRole("heading", { name: "Grading starts soon" })).toBeInTheDocument();
});
