/** Match-centre route skeleton: the highest cold-start route. One status
 *  announcement; mirrors the max-w-2xl column, the hero and the pick card so
 *  the match centre swaps in without shifting -- and no Overview/Lineups tab
 *  strip, which the page no longer has. */
import { render, screen } from "@testing-library/react";
import MatchLoading from "./loading";

it("announces a single 'Loading match…' status", () => {
  render(<MatchLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading match…");
});

it("keeps the page's max-w-2xl column so there is no layout shift", () => {
  const { container } = render(<MatchLoading />);
  expect(container.querySelector(".max-w-2xl")).toBeInTheDocument();
  expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
});

it("mirrors the rebuilt page: hero, then the pick card, and no tab strip", () => {
  const { container } = render(<MatchLoading />);
  const hero = container.querySelector('[data-skeleton="hero"]');
  const pick = container.querySelector('[data-skeleton="pick"]');
  expect(hero).not.toBeNull();
  expect(pick).not.toBeNull();
  expect(hero!.compareDocumentPosition(pick!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(container.querySelector(".rounded-\\[14px\\].bg-surface-2")).toBeNull();
});
