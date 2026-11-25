import { render, screen } from "@testing-library/react";
import { UfcEventList } from "./UfcEventList";
import { EMPTY_EVENT, UPCOMING_EVENT, UPCOMING_LIST } from "./fixtures.testutil";
import type { UfcEventSummary } from "@/lib/ufcTypes";

beforeEach(() => window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true })));
afterEach(() => window.localStorage.clear());

const list = (events: UfcEventSummary[], over = {}) =>
  render(<UfcEventList title="Upcoming" events={events} emptyText="Nothing here." moreHref={null} backHref={null} {...over} />);

it("lists cards with local date, main event and fight count", () => {
  list(UPCOMING_LIST);
  expect(screen.getByRole("link", { name: UPCOMING_EVENT.name })).toHaveAttribute("href", `/ufc/event/${UPCOMING_EVENT.slug}`);
  expect(screen.getByText("Sun 6 Dec · Israel Adesanya v Shara Magomedov · 4 fights")).toBeInTheDocument();
});

it("shows the empty text", () => {
  list([]);
  expect(screen.getByText("Nothing here.")).toBeInTheDocument();
});

it("still lists a card with no main event and no date", () => {
  list([{ ...EMPTY_EVENT, first_bout_utc: null, bout_count: 0 }]);
  expect(screen.getByRole("link", { name: EMPTY_EVENT.name })).toBeInTheDocument();
  expect(screen.getByText("Date to be confirmed · 0 fights")).toBeInTheDocument();
});

it("says 1 fight for a single fight", () => {
  list([{ ...UPCOMING_LIST[0], bout_count: 1, main_event: null }]);
  expect(screen.getByText("Sun 6 Dec · 1 fight")).toBeInTheDocument();
});

it("offers Show more and Back to the start only when given", () => {
  const { unmount } = list(UPCOMING_LIST);
  expect(screen.queryByRole("link", { name: "Show more" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Back to the start" })).not.toBeInTheDocument();
  unmount();
  list(UPCOMING_LIST, { moreHref: "/ufc/events?up=20", backHref: "/ufc/events" });
  expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/ufc/events?up=20");
  expect(screen.getByRole("link", { name: "Back to the start" })).toHaveAttribute("href", "/ufc/events");
});
