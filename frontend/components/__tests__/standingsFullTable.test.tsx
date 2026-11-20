/** Football standings must be a full league table.
 *
 *  The backend computed played / won / drawn / lost / GF / GA / GD / points in
 *  one pass over finished results and then dropped five of them at the schema
 *  boundary, so a league standings page could show points and goal difference
 *  and nothing else. The data was always there.
 */
import { render, screen, within } from "@testing-library/react";
import { FULL_LEAGUE_COLUMNS, StandingsTable } from "@/components/StandingsTable";
import { COMPETITIONS } from "@/lib/sports";

const ZONES = COMPETITIONS.epl.zones;

const row = {
  team_id: 1,
  team: "Arsenal",
  played: 10,
  won: 6,
  drawn: 3,
  lost: 1,
  projected_goals_for: 18,
  goals_against: 7,
  projected_goal_diff: 11,
  projected_points: 21,
  qualification_prob: null,
};

const renderTable = (r = row) =>
  render(<StandingsTable standings={[r]} zones={ZONES} columns={FULL_LEAGUE_COLUMNS} />);

it("shows all eight conventional columns", () => {
  renderTable();
  for (const label of ["P", "W", "D", "L", "GF", "GA", "GD", "Pts"]) {
    expect(screen.getByText(label)).toBeInTheDocument();
  }
});

it("renders every value from the row", () => {
  const { container } = renderTable();
  const cells = within(container).getAllByRole("cell").map((c) => c.textContent);
  // Position, then P, W, D, L, GF, GA, GD, Pts in order.
  expect(cells).toEqual(["1", "10", "6", "3", "1", "18", "7", "+11", "21"]);
});

it("leaves a cell blank rather than printing 0 when a value is absent", () => {
  // A response from a backend that predates these fields must not read as
  // "played nothing" — a wrong number is worse than an obvious gap.
  const { container } = renderTable({
    ...row,
    won: undefined,
    drawn: undefined,
    lost: undefined,
    goals_against: undefined,
  } as unknown as typeof row);
  const cells = within(container).getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toEqual(["1", "10", "", "", "", "18", "", "+11", "21"]);
});

it("accepts the NRL ladder's wins/losses spelling too", () => {
  // Two spellings exist on purpose: the football API returns won/drawn/lost,
  // the NRL ladder rows carry wins/losses. Neither side was renamed.
  const { container } = render(
    <StandingsTable
      standings={[{ team_id: 2, team: "Broncos", wins: 8, losses: 4 }]}
      zones={ZONES}
      columns={["won", "lost"]}
    />,
  );
  const cells = within(container).getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toEqual(["1", "8", "4"]);
});

it("prints a negative goal difference with a real minus sign", () => {
  const { container } = renderTable({ ...row, projected_goal_diff: -14 });
  const cells = within(container).getAllByRole("cell").map((c) => c.textContent);
  expect(cells).toContain("\u221214");
  expect(cells).not.toContain("-14");
});

it("adds a Next column linking each club's next fixture to its match page", () => {
  render(
    <StandingsTable
      standings={[row]}
      zones={ZONES}
      columns={FULL_LEAGUE_COLUMNS}
      next={{ 1: { label: "v Fulham (H)", href: "/football/epl/match/205", ariaLabel: "Arsenal next: Fulham, at home" } }}
    />,
  );
  expect(screen.getByRole("columnheader", { name: "Next" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Arsenal next: Fulham, at home" })).toHaveAttribute(
    "href",
    "/football/epl/match/205",
  );
  expect(screen.getByText("v Fulham (H)")).toBeInTheDocument();
});

it("has no Next column unless the caller passes next fixtures", () => {
  renderTable();
  expect(screen.queryByRole("columnheader", { name: "Next" })).toBeNull();
});
