/** Match-centre route skeleton: the highest cold-start route. One status
 *  announcement; mirrors the page column, the hero and the pick card so
 *  the match centre swaps in without shifting -- and no Overview/Lineups tab
 *  strip, which the page no longer has. */
import { render, screen } from "@testing-library/react";
import MatchLoading from "./loading";

it("announces a single 'Loading match…' status", () => {
  render(<MatchLoading />);
  expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading match…");
});

it("uses the same full-width site column as the page (no narrow max-w-2xl wrapper) so there is no layout shift", () => {
  // Direction G: the root layout's .fw-wrap container sets width for every
  // page; the per-page max-w-2xl wrapper is gone from both the page and this
  // skeleton.
  const { container } = render(<MatchLoading />);
  expect(container.querySelector(".max-w-2xl")).toBeNull();
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
