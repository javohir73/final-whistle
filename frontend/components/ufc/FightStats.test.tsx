import { render, screen, within } from "@testing-library/react";
import { FightStatsCard, JudgesCard } from "./FightStats";
import type { UfcStatLine } from "@/lib/ufcTypes";
import { DECISION_BOUT, KO_BOUT } from "./fixtures.testutil";

const rowText = (label: string) => {
  const row = screen.getByText(label, { selector: "th, td" }).closest("tr") as HTMLElement;
  return within(row).getAllByRole("cell").map((c) => c.textContent);
};
// Row label is a row header; values are the cells either side of it.
const cellsOf = (label: string) => {
  const row = screen.getByRole("rowheader", { name: label }).closest("tr") as HTMLElement;
  return within(row).getAllByRole("cell").map((c) => c.textContent);
};

it("compares the stats", () => {
  render(<FightStatsCard bout={KO_BOUT} />);
  expect(screen.getByRole("heading", { name: "Fight stats" })).toBeInTheDocument();
  expect(cellsOf("Total strikes")).toEqual(["26 of 48", "51 of 98"]);
  expect(cellsOf("Significant strikes")).toEqual(["23 of 40", "45 of 90"]);
  expect(cellsOf("Control time")).toEqual(["0:18", "0:00"]);
  expect(cellsOf("Knockdowns")).toEqual(["0", "1"]);
  expect(cellsOf("Takedowns")).toEqual(["0 of 0", "0 of 1"]);
  expect(screen.getByRole("columnheader", { name: "Jiří Procházka" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Navajo Stirling" })).toBeInTheDocument();
});

it("uses dashes for unknown counts and just the landed number when attempts are unknown", () => {
  const stats = {
    a: { ...KO_BOUT.stats!.a, knockdowns: null, total_strikes_attempted: null, control_seconds: null, reversals: null },
    b: { ...KO_BOUT.stats!.b, sig_strikes_landed: null },
  };
  const { container } = render(<FightStatsCard bout={{ ...KO_BOUT, stats }} />);
  expect(cellsOf("Knockdowns")).toEqual(["–", "1"]);
  expect(cellsOf("Total strikes")[0]).toBe("26");
  expect(cellsOf("Significant strikes")[1]).toBe("–");
  expect(cellsOf("Control time")[0]).toBe("–");
  expect(container.textContent).not.toMatch(/null|undefined|NaN/);
});

it("drops a stat row where both sides are unknown and shows the note when none are left", () => {
  const nul = Object.fromEntries(Object.keys(KO_BOUT.stats!.a).map((k) => [k, null])) as unknown as UfcStatLine;
  const { rerender } = render(<FightStatsCard bout={{ ...KO_BOUT, stats: { a: { ...nul, reversals: 1 }, b: nul } }} />);
  expect(screen.getByRole("rowheader", { name: "Reversals" })).toBeInTheDocument();
  expect(screen.queryByRole("rowheader", { name: "Knockdowns" })).toBeNull();
  rerender(<FightStatsCard bout={{ ...KO_BOUT, stats: { a: nul, b: nul } }} />);
  expect(screen.getByText("Fight stats are not available yet.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
});

it("says when stats are missing", () => {
  render(<FightStatsCard bout={{ ...KO_BOUT, stats: null }} />);
  expect(screen.getByText("Fight stats are not available yet.")).toBeInTheDocument();
});

it("lists the judges", () => {
  render(<JudgesCard bout={DECISION_BOUT} />);
  expect(screen.getByRole("heading", { name: "Judges' scorecards" })).toBeInTheDocument();
  expect(cellsOf("Judge 1")).toEqual(["27", "30"]);
  expect(cellsOf("Judge 2")).toEqual(["28", "29"]);
  expect(cellsOf("Judge 3")).toEqual(["27", "30"]);
  expect(screen.getByRole("columnheader", { name: "Aljamain Sterling" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Kevin Vallejos" })).toBeInTheDocument();
});
