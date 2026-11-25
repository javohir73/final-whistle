import { render, screen } from "@testing-library/react";
import UfcHomeLoading from "./loading";

it("announces a single 'Loading…' status", () => {
  render(<UfcHomeLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
});

it("renders shimmer placeholders", () => {
  const { container } = render(<UfcHomeLoading />);
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});
