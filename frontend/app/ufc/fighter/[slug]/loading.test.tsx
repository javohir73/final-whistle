import { render, screen } from "@testing-library/react";
import FighterLoading from "./loading";

it("announces a single 'Loading…' status", () => {
  render(<FighterLoading />);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
});

it("renders shimmer placeholders", () => {
  const { container } = render(<FighterLoading />);
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});
