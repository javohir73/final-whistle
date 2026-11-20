/** NRL tips page -- server component (SSR) output. NrlTipsPlaySection (the
 *  Slice 2 beat-the-AI client half: device id, auth context, network calls)
 *  is stubbed here -- it has its own dedicated tests -- so this file stays
 *  focused on what the server component itself renders. */
import { render, screen } from "@testing-library/react";
import NrlTipsPage from "./page";
import { getNrlTipsheetServer } from "@/lib/api";
import type { NrlTipsheet } from "@/lib/types";
import { nrlStartLabel } from "@/lib/nrlTips";

jest.mock("@/lib/api");
const mockTipsheet = getNrlTipsheetServer as jest.MockedFunction<typeof getNrlTipsheetServer>;

jest.mock("@/components/nrl/NrlTipsPlaySection", () => ({
  NrlTipsPlaySection: ({ season, round }: { season: number; round: number }) => (
    <div data-testid="play-section">{`${season}-${round}`}</div>
  ),
}));

const fixtures: NrlTipsheet = {
  season: 2026,
  round: 2,
  matches: [{
    // Relative kickoff so the round stays "open" whenever the suite runs.
    id: 5, match_no: 1, kickoff_utc: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    venue: "AAMI Park", home: "Storm", away: "Eels",
    home_team_id: 1, away_team_id: 2, score_home: null, score_away: null,
    status: "scheduled",
    prediction: {
      p_home: 0.6, p_draw: 0.01, p_away: 0.39, expected_margin: 3.0,
      model_version: "nrl-elo-v0.1", created_at: "2026-03-01T00:00:00+00:00",
      is_shadow: true, pick: "home", pick_confidence: 0.6,
    },
  }],
  record: {
    evaluated_matches: 12, winner_accuracy: 0.75, winner_accuracy_ci95: [0.45, 0.92],
    avg_log_loss: 0.52, avg_brier: 0.31, best_streak: 4, last_updated: "2026-07-20T10:00:00+00:00",
  },
  worst_miss: {
    season: 2026, round: 1, home: "Storm", away: "Eels", score_home: 12, score_away: 24,
    pick: "home", pick_team: "Storm", pick_probability: 0.8, winner: "away", winner_team: "Eels",
  },
  disclaimer: "For analytics and entertainment only. Not betting advice.",
};

afterEach(() => jest.resetAllMocks());

it("in season: the My tips heading, the round, and the play section for that round", async () => {
  mockTipsheet.mockResolvedValue(fixtures);
  render(await NrlTipsPage());

  expect(screen.getByRole("heading", { level: 1, name: "My tips" })).toBeInTheDocument();
  expect(screen.getByText("NRL · 2026 season · Round 2")).toBeInTheDocument();
  expect(mockTipsheet).toHaveBeenCalledWith();
  expect(screen.getByTestId("play-section")).toHaveTextContent("2026-2");
});

it("never prints the model's call for an open match in the server HTML", async () => {
  mockTipsheet.mockResolvedValue(fixtures);
  const { container } = render(await NrlTipsPage());
  expect(container.textContent).not.toMatch(/60%|Pick: Storm/);
});

it("calls notFound() when no NRL data is loaded yet", async () => {
  mockTipsheet.mockResolvedValue(null);
  await expect(NrlTipsPage()).rejects.toThrow();
});

it("off-season: one empty state, a link to the record, no play section and no reminder", async () => {
  mockTipsheet.mockResolvedValue({
    ...fixtures,
    round: 31,
    matches: [{
      ...fixtures.matches[0], kickoff_utc: "2026-10-04T08:30:00+00:00",
      status: "finished", score_home: 19, score_away: 18,
    }],
  });
  render(await NrlTipsPage());

  expect(screen.getByRole("heading", { name: "Tips reopen for Round 1 in March 2027" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "See how the model went in 2026" })).toHaveAttribute("href", "/nrl/record");
  expect(screen.queryByTestId("play-section")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /remind/i })).not.toBeInTheDocument();
});

it("pre-season: says when Round 1 starts and opens the round for tips", async () => {
  const opener = new Date(Date.now() + 100 * 86_400_000).toISOString();
  mockTipsheet.mockResolvedValue({
    ...fixtures,
    season: 2027,
    round: 1,
    matches: [{ ...fixtures.matches[0], kickoff_utc: opener, status: "scheduled" }],
  });
  render(await NrlTipsPage());

  expect(screen.getByText(new RegExp(`Round 1 starts ${nrlStartLabel(opener)}`))).toBeInTheDocument();
  expect(screen.getByTestId("play-section")).toHaveTextContent("2027-1");
});
