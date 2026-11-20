/** Mobile standings layout contract (EPL table + NRL ladder at 320-430px).
 *
 *  History: the flex-div table used to slide its header a column off the
 *  numbers at 390px. The table is now a semantic <table> (direction G), so
 *  header/body alignment comes from the table model itself. What still needs
 *  pinning in jsdom is the phone policy, verified in a real browser at
 *  390/1024/1440 (shots in the redesign scratch folder):
 *   - every row has exactly as many cells as the header;
 *   - a column's visibility classes are identical in its header cell and every
 *     body cell, so hiding a column never misaligns the rest;
 *   - below 640px only position, club, P, GD and Pts stay (W/D/L/GF/GA go),
 *     Pts and P never hide, and below 360px GD / Diff go too;
 *   - long club names wrap at word boundaries on phones instead of being cut. */
import { render, screen } from "@testing-library/react";
import {
  FULL_LEAGUE_COLUMNS,
  StandingsTable,
  type StandingsColumn,
  type StandingsTableRow,
} from "@/components/StandingsTable";
import { COMPETITIONS } from "@/lib/sports";

const eplRows: StandingsTableRow[] = [
  {
    team_id: 1, team: "Manchester City", played: 10, won: 7, drawn: 0, lost: 2,
    projected_goals_for: 20, goals_against: 10, projected_goal_diff: 10, projected_points: 21,
    qualification_prob: null,
  },
  {
    team_id: 2, team: "Nottingham Forest", played: 10, won: 1, drawn: 3, lost: 6,
    projected_goals_for: 6, goals_against: 12, projected_goal_diff: -6, projected_points: 6,
    qualification_prob: null,
  },
];

const nrlRows: StandingsTableRow[] = [
  { team_id: 7, team: "Rabbitohs", wins: 14, losses: 11, diff: 103, points: 28, projected_points: 28, projection_pct: 1 },
  { team_id: 9, team: "Sea Eagles", wins: 11, losses: 13, diff: 99, points: 22, projected_points: 22, projection_pct: 0 },
];

const VIS = /^(max-sm:hidden|max-\[359px\]:hidden|max-md:hidden)$/;
const visibility = (el: Element) => [...el.classList].filter((c) => VIS.test(c)).sort().join(" ");
const cellsOf = (row: Element) => [...row.children];

function expectAlignedColumns(expectedHeaders: string[]) {
  const [header, ...body] = screen.getAllByRole("row");
  const headCols = cellsOf(header);
  expect(headCols.map((c) => c.textContent)).toEqual(["Position", ...expectedHeaders]);
  expect(body.length).toBeGreaterThan(0);
  for (const row of body) {
    const cols = cellsOf(row);
    expect(cols).toHaveLength(headCols.length);
    cols.forEach((cell, j) => expect(visibility(cell)).toBe(visibility(headCols[j])));
  }
}

const phoneHidden = (row: Element) => cellsOf(row).map((c) => c.classList.contains("max-sm:hidden"));
const xsHidden = (row: Element) => cellsOf(row).map((c) => c.classList.contains("max-[359px]:hidden"));

describe("football league table (P W D L GF GA GD Pts)", () => {
  beforeEach(() => {
    render(
      <StandingsTable
        standings={eplRows}
        zones={COMPETITIONS.epl.zones}
        badge="club"
        teamBasePath="/football/epl/team"
        columns={FULL_LEAGUE_COLUMNS}
      />,
    );
  });

  it("keeps the header and every row on the same columns", () => {
    expectAlignedColumns(["Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"]);
  });

  it("keeps position, club, P, GD and Pts on phones and drops W/D/L/GF/GA, in the header and the rows alike", () => {
    const [header, ...body] = screen.getAllByRole("row");
    // Position, Team, P, W, D, L, GF, GA, GD, Pts
    const expected = [false, false, false, true, true, true, true, true, false, false];
    expect(phoneHidden(header)).toEqual(expected);
    for (const row of body) expect(phoneHidden(row)).toEqual(expected);
  });

  it("wraps a long club name on phones instead of cutting it", () => {
    const name = screen.getByText("Nottingham Forest");
    const cell = name.closest("th");
    expect(cell).toHaveClass("max-sm:whitespace-normal");
    expect(cell?.className).not.toMatch(/truncate/);
    expect(name.closest("a")).toHaveTextContent("Nottingham Forest");
  });
});

describe("NRL ladder (W–L Diff Pts Top 8%)", () => {
  it("keeps the header and every row on the same columns, all visible on phones", () => {
    render(
      <StandingsTable
        standings={nrlRows}
        zones={COMPETITIONS.nrl.zones}
        badge="club"
        teamBasePath="/nrl/team"
        teamHeader="Club"
        columns={["wl", "diff", "pts", "top8"]}
      />,
    );
    expectAlignedColumns(["Club", "W–L", "Diff", "Pts", "Top 8%"]);
    expect(phoneHidden(screen.getAllByRole("row")[0]).some(Boolean)).toBe(false);
  });
});

describe("default football path and the WC26 group shape", () => {
  it("aligns the GD/Pts default columns", () => {
    render(<StandingsTable standings={eplRows} zones={[]} />);
    expectAlignedColumns(["Team", "GD", "Pts"]);
  });

  it("aligns the Top-2 qualification column", () => {
    render(<StandingsTable standings={eplRows} zones={[]} showQualification />);
    expectAlignedColumns(["Team", "GD", "Pts", "Top 2"]);
  });

  const subsets: StandingsColumn[][] = [["pts"], ["wl", "diff", "pts"]];
  for (const columns of subsets) {
    it(`aligns a caller-chosen column subset (${columns.join(", ")})`, () => {
      render(<StandingsTable standings={nrlRows} zones={[]} badge="club" columns={columns} />);
      const [header, ...body] = screen.getAllByRole("row");
      for (const row of body) expect(cellsOf(row)).toHaveLength(cellsOf(header).length);
    });
  }
});

describe("320px phones", () => {
  it("drops GD below 360px and keeps P/Pts", () => {
    render(<StandingsTable standings={eplRows} zones={[]} badge="club" columns={FULL_LEAGUE_COLUMNS} />);
    const [header, ...body] = screen.getAllByRole("row");
    const expected = [false, false, false, false, false, false, false, false, true, false];
    expect(xsHidden(header)).toEqual(expected);
    for (const row of body) expect(xsHidden(row)).toEqual(expected);
  });

  it("drops Diff below 360px on the ladder and keeps W–L/Pts/Top 8%", () => {
    render(<StandingsTable standings={nrlRows} zones={[]} badge="club" columns={["wl", "diff", "pts", "top8"]} />);
    const [header, ...body] = screen.getAllByRole("row");
    const expected = [false, false, false, true, false, false];
    expect(xsHidden(header)).toEqual(expected);
    for (const row of body) expect(xsHidden(row)).toEqual(expected);
  });

  it("drops GD from the default GD/Pts table too, never Pts", () => {
    render(<StandingsTable standings={eplRows} zones={[]} />);
    expect(xsHidden(screen.getAllByRole("row")[0])).toEqual([false, false, true, false]);
  });
});
