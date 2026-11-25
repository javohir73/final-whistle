import { render, screen, within } from "@testing-library/react";
import { FightStatsCard, JudgesCard } from "./FightStats";
import { DECISION_BOUT, KO_BOUT } from "./fixtures.testutil";

const rowText = (label: string) => {
  const row = screen.getByText(label, { selector: "th, td" }).closest("tr") as HTMLElement;
  return within(row).getAllByRole("cell").map((c) => c.textContent);
};

it("compares the stats", () => {
  render(<FightStatsCard bout={KO_BOUT} />);
  expect(screen.getByRole("heading", { name: "Fight stats" })).toBeInTheDocument();
  expect(rowText("Total strikes")).toEqual(["26 of 48", "Total strikes", "51 of 98"]);
  expect(rowText("Significant strikes")).toEqual(["23 of 40", "Significant strikes", "45 of 90"]);
  expect(rowText("Control time")).toEqual(["0:18", "Control time", "0:00"]);
  expect(rowText("Knockdowns")).toEqual(["0", "Knockdowns", "1"]);
  expect(rowText("Takedowns")).toEqual(["0 of 0", "Takedowns", "0 of 1"]);
});

it("uses dashes for unknown counts and just the landed number when attempts are unknown", () => {
  const stats = {
    a: { ...KO_BOUT.stats!.a, knockdowns: null, total_strikes_attempted: null, control_seconds: null, reversals: null },
    b: { ...KO_BOUT.stats!.b, sig_strikes_landed: null },
  };
  const { container } = render(<FightStatsCard bout={{ ...KO_BOUT, stats }} />);
  expect(rowText("Knockdowns")).toEqual(["–", "Knockdowns", "1"]);
  expect(rowText("Total strikes")[0]).toBe("26");
  expect(rowText("Significant strikes")[2]).toBe("–");
  expect(rowText("Control time")[0]).toBe("–");
  expect(container.textContent).not.toMatch(/null|undefined|NaN/);
});

it("says when stats are missing", () => {
  render(<FightStatsCard bout={{ ...KO_BOUT, stats: null }} />);
  expect(screen.getByText("Fight stats are not available yet.")).toBeInTheDocument();
});

it("lists the judges", () => {
  render(<JudgesCard bout={DECISION_BOUT} />);
  expect(screen.getByRole("heading", { name: "Judges' scorecards" })).toBeInTheDocument();
  expect(rowText("Judge 1")).toEqual(["Judge 1", "27–30"]);
  expect(rowText("Judge 2")).toEqual(["Judge 2", "28–29"]);
  expect(rowText("Judge 3")).toEqual(["Judge 3", "27–30"]);
});
