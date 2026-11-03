import { render, screen, waitFor, within } from "@testing-library/react";
import { NextUpStrip, nextFixtures } from "./NextUpStrip";
import { getUpcomingMatches } from "@/lib/api";
import type { MatchSummary } from "@/lib/types";

jest.mock("@/lib/api");
const mockUpcoming = getUpcomingMatches as jest.MockedFunction<typeof getUpcomingMatches>;

afterEach(() => jest.resetAllMocks());

const hours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

function match(id: number, kickoff: string, overrides: Partial<MatchSummary> = {}): MatchSummary {
  return {
    match_id: id, stage: "group", group: "Premier League", kickoff_utc: kickoff,
    venue: null, venue_city: null, venue_country: null, is_neutral: false,
    status: "scheduled", score_home: null, score_away: null, minute: null,
    period: null, injury_time: null, penalty_home: null, penalty_away: null,
    teams: { home: `Home ${id}`, away: `Away ${id}` },
    predicted_winner: null,
    probabilities: { home_win: 0.55, draw: 0.25, away_win: 0.2 },
    predicted_score: { home: 2, away: 1, probability: 0.1 },
    confidence: "Medium",
    goal_events: [],
    ...overrides,
  };
}

it("picks the next fixtures in kickoff order, skipping played and ghost rows", () => {
  const rows = nextFixtures(
    [
      match(1, hours(-72), { status: "finished", score_home: 1, score_away: 0 }),
      match(2, hours(-30)), // still "scheduled" a day after kickoff: a ghost
      match(5, hours(50)),
      match(3, hours(2)),
      match(4, hours(26)),
    ],
    3,
  );
  expect(rows.map((m) => m.match_id)).toEqual([3, 4, 5]);
});

it("shows the next three fixtures with the model's call, each linking to the match's pick", async () => {
  mockUpcoming.mockResolvedValue([
    match(10, hours(3)),
    match(11, hours(4), { probabilities: { home_win: 0.2, draw: 0.3, away_win: 0.5 } }),
    match(12, hours(5), { probabilities: { home_win: 0.3, draw: 0.4, away_win: 0.3 } }),
    match(13, hours(6)),
  ]);

  render(<NextUpStrip />);

  const items = await screen.findAllByRole("listitem");
  expect(items).toHaveLength(3);
  expect(mockUpcoming).toHaveBeenCalledWith("epl");
  expect(within(items[0]).getByRole("link")).toHaveAttribute("href", "/football/epl/match/10#pick");
  expect(items[0]).toHaveTextContent("Home 10 v Away 10");
  expect(items[0]).toHaveTextContent("Home 10 55%");
  expect(items[1]).toHaveTextContent("Away 11 50%");
  expect(items[2]).toHaveTextContent("Draw 40%");
  expect(screen.getByRole("heading", { name: "Next up · Premier League" })).toBeInTheDocument();
});

it("renders nothing when the fetch fails or nothing is left to play", async () => {
  mockUpcoming.mockRejectedValue(new Error("cold start"));
  const { container, unmount } = render(<NextUpStrip />);
  await waitFor(() => expect(container).toBeEmptyDOMElement());
  unmount();

  mockUpcoming.mockResolvedValue([match(1, hours(-72), { status: "finished", score_home: 1, score_away: 0 })]);
  const second = render(<NextUpStrip />);
  await waitFor(() => expect(second.container).toBeEmptyDOMElement());
});
