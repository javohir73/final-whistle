import { render, screen } from "@testing-library/react";
import UfcEventLoading from "./loading";

it("announces a single 'Loading…' status", () => {
  render(<UfcEventLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading…");
});

it("renders shimmer placeholders", () => {
  const { container } = render(<UfcEventLoading />);
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});
