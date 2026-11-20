import { render, screen } from "@testing-library/react";
import { GroupFixtureList } from "@/components/GroupFixtureList";
import { TeamFixtures } from "@/components/TeamFixtures";
import type { MatchSummary, MatchStatus } from "@/lib/types";

function fixture(id: number, status: MatchStatus, home = "Arsenal", away = "Chelsea"): MatchSummary {
  return {
    match_id: id,
    stage: "league",
    group: "Premier League",
    kickoff_utc: "2026-08-21T19:00:00Z",
    venue: null,
    venue_city: null,
    venue_country: null,
    is_neutral: false,
    status,
    score_home: null,
    score_away: null,
    minute: null,
    period: null,
    injury_time: null,
    penalty_home: null,
    penalty_away: null,
    goal_events: [],
    teams: { home, away },
    predicted_winner: home,
    probabilities: { home_win: 0.6, draw: 0.25, away_win: 0.15 },
    predicted_score: { home: 2, away: 0, probability: 0.12 },
    confidence: "Medium",
  };
}

function withKickoff(match: MatchSummary, kickoff_utc: string): MatchSummary {
  return { ...match, kickoff_utc };
}

it.each(["postponed", "cancelled", "suspended"] as const)(
  "GroupFixtureList labels %s instead of showing a stale kickoff",
  (status) => {
    render(<GroupFixtureList matches={[fixture(1, status)]} />);
    expect(screen.getByText(status[0].toUpperCase() + status.slice(1))).toBeInTheDocument();
    expect(screen.queryByText(/19:00/)).not.toBeInTheDocument();
  },
);

it("TeamFixtures never lists a cancelled fixture as a next match", () => {
  render(
    <TeamFixtures
      teamName="Arsenal"
      matches={[
        fixture(1, "cancelled", "Arsenal", "Chelsea"),
        withKickoff(
          fixture(2, "scheduled", "Arsenal", "Liverpool"),
          new Date(Date.now() + 60_000).toISOString(),
        ),
      ]}
    />,
  );

  const spines = screen.getAllByRole("link", { name: /^Arsenal v / });
  expect(spines.map((a) => a.getAttribute("href"))).toEqual(["/match/2"]);
});

it("TeamFixtures never lists an old postponed fixture as a next match", () => {
  render(
    <TeamFixtures
      teamName="Arsenal"
      matches={[
        withKickoff(
          fixture(1, "postponed", "Arsenal", "Chelsea"),
          new Date(Date.now() - 60_000).toISOString(),
        ),
        withKickoff(
          fixture(2, "scheduled", "Arsenal", "Liverpool"),
          new Date(Date.now() + 60_000).toISOString(),
        ),
      ]}
    />,
  );

  const spines = screen.getAllByRole("link", { name: /^Arsenal v / });
  expect(spines.map((a) => a.getAttribute("href"))).toEqual(["/match/2"]);
});
