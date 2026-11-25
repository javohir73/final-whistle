import { render, screen } from "@testing-library/react";
import FightLoading from "./loading";

it("announces a single loading status", () => {
  render(<FightLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
});

it("renders shimmer placeholders", () => {
  const { container } = render(<FightLoading />);
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});
