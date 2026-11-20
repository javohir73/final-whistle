/** Club-page fixture list: last result + next matches, and the reveal rule on
 *  the right of each row (same as the matchweek home). */
import { render, screen, waitFor } from "@testing-library/react";
import { TeamFixtures, type TeamFixture } from "@/components/TeamFixtures";
import { toTeamFixture } from "@/app/team/[id]/TeamPageContent";
import { useModelRevealMap, type ModelReveal } from "@/lib/useModelReveal";
import { getMatchSummary } from "@/lib/api";
import type { MatchSummary } from "@/lib/types";

jest.mock("@/lib/useModelReveal", () => ({ useModelRevealMap: jest.fn() }));
jest.mock("@/lib/api", () => ({ getMatchSummary: jest.fn() }));

const mockReveal = useModelRevealMap as jest.MockedFunction<typeof useModelRevealMap>;
const mockSummary = getMatchSummary as jest.MockedFunction<typeof getMatchSummary>;

const NOW = "2026-11-20T00:00:00Z";
const hidden: ModelReveal = { revealed: false, reason: "hidden", pick: null, isLoading: false };

const fx = (over: Partial<TeamFixture>): TeamFixture => ({
  match_id: 1,
  kickoff_utc: "2026-11-21T09:30:00Z",
  status: "scheduled",
  teams: { home: "Newcastle", away: "Arsenal" },
  matchweek: 11,
  competition: "epl",
  ...over,
});

const LAST = fx({
  match_id: 195, status: "finished", kickoff_utc: "2026-11-07T15:00:00Z", matchweek: 10,
  teams: { home: "Arsenal", away: "Hull City" }, score_home: 1, score_away: 0, model: { home: 3, away: 0 },
});
const NEXT = fx({ match_id: 205 });
const LATER = fx({ match_id: 217, kickoff_utc: "2026-11-29T16:30:00Z", matchweek: 12, teams: { home: "Arsenal", away: "Manchester City" } });
const WAY_LATER = fx({ match_id: 231, kickoff_utc: "2026-12-05T16:30:00Z", matchweek: 13 });

function renderList(reveals: Record<number, ModelReveal> = {}) {
  mockReveal.mockReturnValue({ get: (id: number) => reveals[id] ?? hidden, isLoading: false });
  return render(
    <TeamFixtures matches={[WAY_LATER, LATER, NEXT, LAST]} teamName="Arsenal" competition="epl"
      matchBasePath="/football/epl/match" badge="club" now={NOW} />,
  );
}

afterEach(() => jest.clearAllMocks());

it("lists the last result then the next two matches, each linking to its match page", () => {
  renderList({ 195: { revealed: true, reason: "finished", pick: null, isLoading: false } });
  const spines = screen.getAllByRole("link", { name: /^(Arsenal|Newcastle) / });
  expect(spines.map((a) => a.getAttribute("href"))).toEqual([
    "/football/epl/match/195",
    "/football/epl/match/205",
    "/football/epl/match/217",
  ]);
  expect(screen.getByText("Matchweek 10")).toBeInTheDocument();
});

it("shows the model's verdict and score on a finished match", () => {
  renderList({ 195: { revealed: true, reason: "finished", pick: null, isLoading: false } });
  expect(screen.getByText("Right result")).toBeInTheDocument();
  expect(screen.getByText("3–0")).toBeInTheDocument();
});

it("offers 'Pick score' on an open, unpicked fixture and never shows the model there", () => {
  renderList();
  expect(screen.getByRole("link", { name: "Pick the score for Newcastle v Arsenal" })).toHaveAttribute(
    "href",
    "/football/epl/match/205",
  );
  // Only the finished match (public) shows a model score; the open rows don't.
  expect(screen.getAllByText(/Model/)).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: /^Pick the score/ })).toHaveLength(2);
  expect(mockSummary).not.toHaveBeenCalled();
});

it("after a locked pick shows You and fetches the model's score for that fixture only", async () => {
  mockSummary.mockResolvedValue({ predicted_score: { home: 0, away: 2, probability: 0.1 } } as MatchSummary);
  renderList({
    205: { revealed: true, reason: "locked_pick", isLoading: false,
      pick: { kind: "score", home: 2, away: 1, points: null, exact: null, gradedAt: null } },
  });
  expect(screen.getByText("2–1")).toBeInTheDocument();
  await waitFor(() => expect(screen.getByText("0–2")).toBeInTheDocument());
  expect(mockSummary).toHaveBeenCalledTimes(1);
  expect(mockSummary).toHaveBeenCalledWith(205, "epl");
});

describe("toTeamFixture (server trimming)", () => {
  const summary = (status: string, kickoff: string): MatchSummary =>
    ({
      match_id: 9, kickoff_utc: kickoff, status, teams: { home: "A", away: "B" }, score_home: null, score_away: null,
      matchweek: 11, stage: "group", group: "Premier League",
      predicted_score: { home: 2, away: 1, probability: 0.12 },
      probabilities: { home_win: 0.5, draw: 0.3, away_win: 0.2 },
    }) as unknown as MatchSummary;
  const now = new Date(NOW);

  it("never carries the model's numbers for an open fixture", () => {
    const t = toTeamFixture(summary("scheduled", "2026-11-21T09:30:00Z"), "epl", now);
    expect(t.model).toBeNull();
    expect(JSON.stringify(t)).not.toMatch(/probabilit|predicted/);
  });

  it("carries the model's score once the match is finished", () => {
    expect(toTeamFixture(summary("finished", "2026-11-07T15:00:00Z"), "epl", now).model).toEqual({ home: 2, away: 1 });
  });

  it("carries it for an open fixture in a competition without a pick game (UCL)", () => {
    expect(toTeamFixture(summary("scheduled", "2026-11-25T20:00:00Z"), "ucl", now).model).toEqual({ home: 2, away: 1 });
  });
});
