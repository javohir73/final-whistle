/** /team/[id] route skeleton: one status announcement; mirrors the page head
 *  and the main column + rail so the profile drops in without shifting. */
import { render, screen } from "@testing-library/react";
import TeamLoading from "./loading";

it("announces a single 'Loading team…' status", () => {
  render(<TeamLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading team…");
});

it("mirrors the page head and the main column + rail so there is no layout shift", () => {
  const { container } = render(<TeamLoading />);
  expect(container.querySelector("[data-team-skeleton]")).toBeInTheDocument();
  // No page-level width wrapper: the frame owns the container (direction G).
  expect(container.querySelector(".max-w-3xl, .mx-auto")).toBeNull();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});
