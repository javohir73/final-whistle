import { render, screen, within } from "@testing-library/react";
import { TaleOfTheTape } from "./TaleOfTheTape";
import { SCHEDULED_BOUT, UNKNOWN_TAPE_BOUT } from "./fixtures.testutil";

const rowText = (label: string) => {
  const row = screen.getByText(label, { selector: "th, td" }).closest("tr") as HTMLElement;
  return within(row).getAllByRole("cell").map((c) => c.textContent);
};

it("shows known values, dashes for one unknown side, and drops all-unknown rows", () => {
  render(<TaleOfTheTape bout={SCHEDULED_BOUT} />);
  expect(screen.getByRole("heading", { name: "Tale of the tape" })).toBeInTheDocument();
  expect(rowText("Height")).toEqual(["6′ 4″", "Height", "6′ 2″"]);
  expect(rowText("Reach")).toEqual(["80″", "Reach", "–"]);
  expect(rowText("Age")).toEqual(["37", "Age", "–"]);
  expect(rowText("Stance")).toEqual(["Switch", "Stance", "Orthodox"]);
});

it("heads the columns with the two names", () => {
  render(<TaleOfTheTape bout={SCHEDULED_BOUT} />);
  expect(screen.getByRole("columnheader", { name: "Israel Adesanya" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Shara Magomedov" })).toBeInTheDocument();
});

it("omits a row when both sides are unknown", () => {
  const bout = {
    ...SCHEDULED_BOUT,
    tape: {
      a: { age: 30, height_in: null, reach_in: null, stance: null },
      b: { age: 31, height_in: null, reach_in: null, stance: null },
    },
  };
  render(<TaleOfTheTape bout={bout} />);
  expect(screen.getByText("Age")).toBeInTheDocument();
  expect(screen.queryByText("Height")).toBeNull();
  expect(screen.queryByText("Reach")).toBeNull();
  expect(screen.queryByText("Stance")).toBeNull();
});

it("says so when nothing is known", () => {
  render(<TaleOfTheTape bout={UNKNOWN_TAPE_BOUT} />);
  expect(screen.getByText("Measurements for these fighters are not available yet.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
});

it("keeps the b side in the b column", () => {
  render(<TaleOfTheTape bout={{ ...SCHEDULED_BOUT, tape: { a: SCHEDULED_BOUT.tape.b, b: SCHEDULED_BOUT.tape.a } }} />);
  expect(rowText("Reach")).toEqual(["–", "Reach", "80″"]);
});
