import { render, screen } from "@testing-library/react";
import { UfcCardView } from "./UfcCardView";
import { EMPTY_EVENT, FINISHED_EVENT, NEXT_DAY_EVENT, UPCOMING_EVENT, UPCOMING_LIST } from "./fixtures.testutil";
import { ABOUT_NOTE } from "@/lib/ufcDisplay";

beforeEach(() => {
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
});

it("heads the card with its local day and main card time", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
  expect(screen.getByText("UFC · Sun 6 Dec")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: UPCOMING_EVENT.name })).toBeInTheDocument();
  expect(screen.getByText("Main card starts Sun 6 Dec, 5:00 am. Times are in your local time.")).toBeInTheDocument();
});

it("groups fights by segment, main card first", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
  const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(h2).toEqual(expect.arrayContaining(["Main card, starts 5:00 am", "Prelims, starts 2:00 am"]));
  expect(h2.indexOf("Main card, starts 5:00 am")).toBeLessThan(h2.indexOf("Prelims, starts 2:00 am"));
  expect(screen.getByText("Middleweight · main event · 5 rounds")).toBeInTheDocument();
});

it("says when no fights are announced", () => {
  render(<UfcCardView event={EMPTY_EVENT} upcoming={[]} />);
  expect(screen.getByText("UFC")).toBeInTheDocument();
  expect(screen.getByText("The fights for this card have not been announced yet.")).toBeInTheDocument();
  expect(screen.queryByText("Upcoming cards")).toBeNull();
});

it("lists up to three other upcoming cards and the note about predictions", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
  const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/ufc/event/"));
  expect(links).toHaveLength(3);
  expect(links.some((a) => a.getAttribute("href") === `/ufc/event/${UPCOMING_EVENT.slug}`)).toBe(false);
  const m = UPCOMING_LIST[1].main_event!;
  expect(screen.getByText(`Sun 20 Dec · ${m.fighter_a.name} v ${m.fighter_b.name}`)).toBeInTheDocument();
  expect(screen.getByText(ABOUT_NOTE)).toBeInTheDocument();
});

it("shows results on a finished card", () => {
  render(<UfcCardView event={FINISHED_EVENT} upcoming={[]} />);
  expect(screen.getByText("Finished.")).toBeInTheDocument();
  expect(screen.getByText("KO R2")).toBeInTheDocument();
  expect(screen.getByText("DEC")).toBeInTheDocument();
  expect(screen.getByText("DRAW")).toBeInTheDocument();
  expect(screen.getByText("NC")).toBeInTheDocument();
});

const setTz = (tz: string) => window.localStorage.setItem("pp:timezone", JSON.stringify({ tz, confirmed: true }));

it("gives the main card its day when it falls on the next local day", () => {
  setTz("Europe/London");
  render(<UfcCardView event={NEXT_DAY_EVENT} upcoming={[]} />);
  const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(h2).toEqual(expect.arrayContaining(["Main card, starts Sun 13 Dec, 2:00 am", "Prelims, starts 11:00 pm"]));
  expect(screen.getByText("UFC · Sat 12 Dec")).toBeInTheDocument();
  expect(screen.getByText("Main card starts Sun 13 Dec, 2:00 am. Times are in your local time.")).toBeInTheDocument();
});

it("shows the time alone when both segments are on the card's day", () => {
  setTz("America/New_York");
  render(<UfcCardView event={NEXT_DAY_EVENT} upcoming={[]} />);
  const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
  expect(h2).toEqual(expect.arrayContaining(["Main card, starts 9:00 pm", "Prelims, starts 6:00 pm"]));
});

it("does not repeat the segment's time on every fight", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
  const links = screen.getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/ufc/fight/"));
  expect(links.length).toBeGreaterThan(0);
  for (const a of links) {
    expect(a.getAttribute("aria-label")).toMatch(/, (upcoming|cancelled)$/);
    expect(a.textContent).not.toMatch(/\d:\d\d (am|pm)/);
  }
});

it("labels the rail and links to all cards", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
  expect(screen.getByRole("complementary", { name: "Other cards" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All cards" })).toHaveAttribute("href", "/ufc/events");
});
