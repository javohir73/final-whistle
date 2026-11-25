import { render, screen, within } from "@testing-library/react";
import { UfcCardView } from "./UfcCardView";
import {
  EMPTY_EVENT, FINISHED_EVENT, NEXT_DAY_EVENT, UPCOMING_EVENT, UPCOMING_LIST, freezeNow,
} from "./fixtures.testutil";
import { call, graded, mineFor, mockMine, pick } from "./BoutPick.fixtures.testutil";
import { ABOUT_NOTE } from "@/lib/ufcDisplay";

jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: null, loading: false, openSignIn: jest.fn() }),
}));

beforeEach(() => {
  mockMine("pending");
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
  expect(screen.getByText("UFC · Sat 12 – Sun 13 Dec")).toBeInTheDocument();
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

it("shows a single day in the eyebrow when the whole card falls on it", () => {
  setTz("America/New_York");
  render(<UfcCardView event={NEXT_DAY_EVENT} upcoming={[]} />);
  expect(screen.getByText("UFC · Sat 12 Dec")).toBeInTheDocument();
});

it("names both months when the days straddle a month end", () => {
  setTz("Europe/London");
  const ev = {
    ...NEXT_DAY_EVENT,
    first_bout_utc: "2026-12-31T23:00:00Z",
    segments: NEXT_DAY_EVENT.segments.map((s) => ({
      ...s, scheduled_utc: s.key === "main" ? "2027-01-01T02:00:00Z" : "2026-12-31T23:00:00Z",
    })),
  };
  render(<UfcCardView event={ev} upcoming={[]} />);
  expect(screen.getByText("UFC · Thu 31 Dec – Fri 1 Jan")).toBeInTheDocument();
});

describe("pick status", () => {
  const [main] = UPCOMING_EVENT.segments[0].bouts;
  const [prelimA, prelimB] = UPCOMING_EVENT.segments[1].bouts;

  beforeEach(() => freezeNow("2026-12-01T00:00:00Z"));
  afterEach(() => jest.useRealTimers());

  const section = (name: string) => screen.getByRole("region", { name });

  it("renders nothing about the player on the server, the same HTML for everyone", () => {
    mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
    // jsdom has no MessageChannel or TextEncoder, which the server renderer wants.
    const g = global as unknown as Record<string, unknown>;
    g.MessageChannel ??= require("worker_threads").MessageChannel;
    g.TextEncoder ??= require("util").TextEncoder;
    const { renderToString } = require("react-dom/server") as typeof import("react-dom/server");
    const html = renderToString(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    expect(html).not.toMatch(/You:|Pick winner|Pick the winner of [A-Z]|Picks closed|fights picked/);
  });

  it("looks complete while the picks load, and keeps every row's slot when they arrive", async () => {
    mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
    const { container } = render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    const before = Array.from(container.querySelectorAll("[data-testid=pick-slot]")).map((e) => e.className);
    expect(before).toHaveLength(3); // main, prelim A, prelim B: not the placeholder, not the cancelled fight
    await screen.findByText("You: Shara Magomedov, decision");
    const after = Array.from(container.querySelectorAll("[data-testid=pick-slot]")).map((e) => e.className);
    expect(after).toEqual(before);
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
  });

  it("offers a pick on each open fight", async () => {
    mockMine(mineFor(UPCOMING_EVENT));
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    const link = await screen.findByRole("link", { name: "Pick the winner of Israel Adesanya v Shara Magomedov" });
    expect(link).toHaveAttribute("href", `/ufc/fight/${main.id}#pick`);
    expect(screen.getAllByRole("link", { name: /^Pick the winner of/ })).toHaveLength(3);
    expect(screen.queryByRole("link", { name: /Holloway/ })?.getAttribute("href")).not.toMatch(/#pick/);
  });

  it("locks each part of the card on its own", async () => {
    freezeNow("2026-12-05T16:00:00Z");
    mockMine(mineFor(UPCOMING_EVENT, { [prelimB.id]: { pick: pick({ winner: "a" }) } }));
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    const prelims = section("Prelims");
    const mainCard = section("Main card");
    await within(prelims).findByText("Picks closed");
    expect(within(prelims).getAllByText("Picks closed")).toHaveLength(1);
    expect(within(prelims).getByText("You: Abdul Hussein, decision")).toBeInTheDocument();
    expect(within(mainCard).getAllByRole("link", { name: /^Pick the winner of/ })).toHaveLength(1);
    expect(prelimA.id).toBeDefined();
  });

  it("keeps the rows read-only when the picks cannot be read, with one retry in the rail", async () => {
    mockMine("fail");
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    await screen.findByRole("button", { name: "Try again" });
    expect(screen.queryByRole("link", { name: /^Pick the winner of/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(1);
    expect(within(section("Main card")).queryByRole("button")).toBeNull();
  });

  it("shows the graded verdict on a finished card", async () => {
    mockMine(mineFor(FINISHED_EVENT, { [FINISHED_EVENT.segments[0].bouts[0].id]: { pick: graded(5), model: call() } }));
    render(<UfcCardView event={FINISHED_EVENT} upcoming={[]} />);
    expect(await screen.findByText("Winner and method · 5 points")).toBeInTheDocument();
    expect(screen.getByText("5 points from 1 scored fights.")).toBeInTheDocument();
  });

  it("tells the player once that a pick on a changed fight no longer counts", async () => {
    mockMine(mineFor(UPCOMING_EVENT, {}, {
      changed: [{ bout_id: 9001, fighter_a: "Israel Adesanya", fighter_b: "Old Opponent", pick: pick({ state: "void" }), replaced_by_id: 9 }],
    }));
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    const text = "Your pick on Israel Adesanya v Old Opponent doesn't count because the fight changed.";
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getAllByText(text)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Pick the new fight" })).toHaveAttribute("href", "/ufc/fight/9#pick");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives no link to a replacement that does not exist", async () => {
    mockMine(mineFor(UPCOMING_EVENT, {}, {
      changed: [{ bout_id: 9001, fighter_a: "A One", fighter_b: "B Two", pick: pick({ state: "void" }), replaced_by_id: null }],
    }));
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={[]} />);
    await screen.findByText(/doesn't count because the fight changed/);
    expect(screen.queryByRole("link", { name: "Pick the new fight" })).toBeNull();
  });

  it("puts the rail card above the other cards", async () => {
    mockMine(mineFor(UPCOMING_EVENT));
    render(<UfcCardView event={UPCOMING_EVENT} upcoming={UPCOMING_LIST} />);
    const rail = screen.getByRole("complementary", { name: "Other cards" });
    const heads = within(rail).getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(heads.slice(0, 2)).toEqual(["Your picks", "Upcoming cards"]);
    await screen.findByText("A free account keeps your picks across devices.");
  });
});
