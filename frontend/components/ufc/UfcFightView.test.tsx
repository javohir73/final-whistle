import { render, screen } from "@testing-library/react";
import { UfcFightView } from "./UfcFightView";
import { DECISION_BOUT, KO_BOUT, SCHEDULED_BOUT } from "./fixtures.testutil";

beforeEach(() => window.localStorage.setItem("pp:timezone", "Australia/Sydney"));

it("shows a scheduled fight with the tape only", () => {
  render(<UfcFightView bout={SCHEDULED_BOUT} />);
  expect(screen.getByRole("link", { name: /UFC Fight Night: Adesanya vs Magomedov/ })).toHaveAttribute(
    "href",
    "/ufc/event/ufc-fight-night-adesanya-vs-magomedov-2026-12-05",
  );
  expect(screen.getByText("Tale of the tape")).toBeInTheDocument();
  expect(screen.queryByText("Fight stats")).toBeNull();
  expect(screen.queryByText("Judges' scorecards")).toBeNull();
});

it("shows stats for a finished fight and judges only when set", () => {
  const { rerender } = render(<UfcFightView bout={KO_BOUT} />);
  expect(screen.getByText("Fight stats")).toBeInTheDocument();
  expect(screen.queryByText("Judges' scorecards")).toBeNull();
  rerender(<UfcFightView bout={DECISION_BOUT} />);
  expect(screen.getByText("Judges' scorecards")).toBeInTheDocument();
});
