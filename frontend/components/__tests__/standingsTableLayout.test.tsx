/** Mobile standings layout contract (EPL table + NRL ladder at 360-430px).
 *
 *  At 390px the numbers used to paint over the club names and the header sat
 *  one column off: the numeric cells were plain flex items, so flex shrank
 *  them by different amounts in the header row (whose "Team" label refuses to
 *  shrink) and in each body row (whose rowheader is `min-w-0` and collapses),
 *  and the crest + name spilled out of a rowheader squeezed narrower than its
 *  content. jsdom has no layout engine, so this pins the structural contract
 *  that makes the geometry hold in a real browser (verified there with a
 *  Playwright sweep at 360/390/430/1280):
 *   - every row has exactly as many columns as the header;
 *   - each numeric column carries identical width/visibility classes in the
 *     header and in every body row, and never shrinks;
 *   - the team column is the only flexible one, and the name truncates on
 *     phones instead of overflowing into the numbers. */
import { render, screen } from "@testing-library/react";
import {
  FULL_LEAGUE_COLUMNS,
  StandingsTable,
  type StandingsColumn,
  type StandingsTableRow,
} from "@/components/StandingsTable";
import { COMPETITIONS } from "@/lib/sports";

/** The classes that decide a column's box: width, responsive visibility and
 *  flex behaviour. Typography/colour may differ between header and cell. */
const GEOMETRY = /^((sm|max-sm):)?(w-|min-w-|hidden$|block$|shrink-0$|flex-1$)/;
const geometry = (el: Element) =>
  [...el.classList].filter((c) => GEOMETRY.test(c)).sort().join(" ");

function columnsOf(row: Element): Element[] {
  return [...row.children].filter((c) =>
    ["columnheader", "rowheader", "cell"].includes(c.getAttribute("role") ?? ""),
  );
}

function expectAlignedColumns(expectedHeaders: string[]) {
  const [header, ...body] = screen.getAllByRole("row");
  const headCols = columnsOf(header);
  expect(headCols.map((c) => c.textContent)).toEqual(expectedHeaders);
  expect(body.length).toBeGreaterThan(0);
  for (const row of body) {
    const cols = columnsOf(row);
    expect(cols).toHaveLength(headCols.length);
    // Numeric columns: same box in the header and in the row, never shrinking.
    cols.slice(1).forEach((cell, j) => {
      expect(geometry(cell)).toBe(geometry(headCols[j + 1]));
      expect(cell).toHaveClass("shrink-0");
    });
    // The team column is the flexible one in both rows, and may shrink to 0.
    expect(cols[0]).toHaveClass("min-w-0", "flex-1");
  }
  expect(headCols[0]).toHaveClass("min-w-0", "flex-1");
}

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

  it("keeps the header and every row on the same fixed column grid", () => {
    expectAlignedColumns(["Team", "P", "W", "D", "L", "GF", "GA", "GD", "Pts"]);
  });

  it("drops only GF/GA below sm, in the header and the rows alike", () => {
    const [header, ...body] = screen.getAllByRole("row");
    const wideOnly = (cols: Element[]) =>
      cols.map((c) => c.classList.contains("hidden") && c.classList.contains("sm:block"));
    const expected = [false, false, false, false, false, true, true, false, false];
    expect(wideOnly(columnsOf(header))).toEqual(expected);
    for (const row of body) expect(wideOnly(columnsOf(row))).toEqual(expected);
  });

  it("never hides Pts or GD on a phone", () => {
    const header = screen.getAllByRole("row")[0];
    for (const label of ["GD", "Pts"]) {
      const col = columnsOf(header).find((c) => c.textContent === label)!;
      expect(col).not.toHaveClass("hidden");
    }
  });

  it("truncates a long club name on phones instead of letting it overflow", () => {
    const name = screen.getByText("Nottingham Forest");
    expect(name).toHaveClass("min-w-0", "max-sm:truncate");
    // The full name stays in the DOM for assistive tech and the link.
    expect(name.closest("a")).toHaveTextContent("Nottingham Forest");
  });
});

describe("NRL ladder (W–L Diff Pts Top 8%)", () => {
  it("keeps the header and every row on the same fixed column grid", () => {
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

  // The NRL home snippet (Pts only) and the match page's "Season so far".
  const subsets: StandingsColumn[][] = [["pts"], ["wl", "diff", "pts"]];
  for (const columns of subsets) {
    it(`aligns a caller-chosen column subset (${columns.join(", ")})`, () => {
      render(<StandingsTable standings={nrlRows} zones={[]} badge="club" columns={columns} />);
      const [header, ...body] = screen.getAllByRole("row");
      for (const row of body) expect(columnsOf(row)).toHaveLength(columnsOf(header).length);
    });
  }
});
