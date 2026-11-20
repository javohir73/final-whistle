/** Component unit tests (task 6.9). */
import { render, screen } from "@testing-library/react";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { GroupTable } from "@/components/GroupTable";
import type { MatchSummary, StandingRow } from "@/lib/types";

describe("DisclaimerBanner", () => {
  it("states it is not betting advice", () => {
    render(<DisclaimerBanner />);
    expect(screen.getByRole("note")).toHaveTextContent(/not betting advice/i);
  });
});

describe("GroupTable", () => {
  const standings: StandingRow[] = [
    { team_id: 1, team: "Mexico", projected_points: 6, projected_goals_for: 5, projected_goal_diff: 3, qualification_prob: 0.87 },
    { team_id: 2, team: "South Korea", projected_points: 5, projected_goals_for: 4, projected_goal_diff: 1, qualification_prob: 0.6 },
    { team_id: 3, team: "Czechia", projected_points: 4, projected_goals_for: 3, projected_goal_diff: 0, qualification_prob: 0.41 },
    { team_id: 4, team: "South Africa", projected_points: 2, projected_goals_for: 2, projected_goal_diff: -4, qualification_prob: 0.12 },
  ];

  it("renders all teams with qualification percentages", () => {
    render(<GroupTable standings={standings} />);
    expect(screen.getByText("87%")).toBeInTheDocument();
    // The Floodlight table is a flex layout carrying ARIA table roles, so the
    // four teams surface as rows beneath the header row.
    expect(screen.getAllByRole("row")).toHaveLength(5);
    for (const team of ["Mexico", "South Korea", "Czechia", "South Africa"]) {
      expect(screen.getByText(team)).toBeInTheDocument();
    }
  });
});
