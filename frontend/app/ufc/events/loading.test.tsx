import { render, screen } from "@testing-library/react";
import UfcEventsLoading from "./loading";

it("announces a single 'Loading events…' status", () => {
  render(<UfcEventsLoading />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading events…");
});
