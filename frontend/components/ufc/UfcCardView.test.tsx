import { render, screen } from "@testing-library/react";
import { UfcCardView } from "./UfcCardView";
import { EMPTY_EVENT, FINISHED_EVENT, UPCOMING_EVENT, UPCOMING_LIST } from "./fixtures.testutil";
import { ABOUT_NOTE } from "@/lib/ufcDisplay";

beforeEach(() => {
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
});

it("heads the card with its local day and main card time", () => {
  render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
  expect(screen.getByText("UFC · Sun 6 Dec")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: UPCOMING_EVENT.name })).toBeInTheDocument();
  expect(screen.getByText("Main card starts 5:00 am. Times are in your local time.")).toBeInTheDocument();
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
  expect(screen.getByText("Finished")).toBeInTheDocument();
  expect(screen.getByText("KO R2")).toBeInTheDocument();
  expect(screen.getByText("DEC")).toBeInTheDocument();
  expect(screen.getByText("DRAW")).toBeInTheDocument();
  expect(screen.getByText("NC")).toBeInTheDocument();
});
