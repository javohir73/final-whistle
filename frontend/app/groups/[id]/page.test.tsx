/** The legacy group-detail implementation (served at
 *  /football/wc26/groups/[id]) links straight to final URLs: /groups,
 *  /brackets and /matches are each a redirect hop. */
import { render, screen } from "@testing-library/react";
import GroupDetailPage from "./page";
import { getGroupServer, getUpcomingMatchesServer } from "@/lib/api";
import { getCompetitionTournament } from "@/lib/tournament";
import type { ActiveTournament, Group } from "@/lib/types";

jest.mock("@/lib/api", () => ({
  getGroupServer: jest.fn(),
  getUpcomingMatchesServer: jest.fn(),
}));
jest.mock("@/lib/tournament", () => ({ getCompetitionTournament: jest.fn() }));

const group: Group = {
  id: 3,
  name: "Group C",
  standings: [
    {
      team_id: 10,
      team: "Brazil",
      projected_points: 6,
      projected_goals_for: 4,
      projected_goal_diff: 3,
      qualification_prob: 0.9,
    },
  ],
};

beforeEach(() => {
  (getGroupServer as jest.Mock).mockResolvedValue(group);
  (getUpcomingMatchesServer as jest.Mock).mockResolvedValue([]);
  (getCompetitionTournament as jest.Mock).mockResolvedValue({
    id: 1,
    name: "FIFA World Cup 2026",
    year: 2026,
    format: "knockout",
    has_brackets: true,
  } as ActiveTournament);
});

it("links every exit to its final /football/wc26 URL, never a redirecting legacy path", async () => {
  render(await GroupDetailPage({ params: Promise.resolve({ id: "3" }) }));
  expect(screen.getByRole("link", { name: /All groups/ })).toHaveAttribute(
    "href",
    "/football/wc26/groups",
  );
  expect(screen.getByRole("link", { name: /Tournament odds/ })).toHaveAttribute(
    "href",
    "/football/wc26/bracket",
  );
  expect(screen.getByRole("link", { name: /All matches/ })).toHaveAttribute(
    "href",
    "/football/wc26/fixtures",
  );
  for (const link of screen.getAllByRole("link")) {
    expect(link.getAttribute("href")).not.toMatch(/^\/(groups|brackets|matches|match|team)(\/|$)/);
  }
});
