import { render, screen, within } from "@testing-library/react";
import { UfcFighterView } from "./UfcFighterView";
import { FIGHTER, FIGHTER_DRAW_NC, FIGHTER_NO_HISTORY, FIGHTER_PLACEHOLDER, freezeNow } from "./fixtures.testutil";

const setTz = (tz: string) =>
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz, confirmed: true }));

beforeEach(() => {
  setTz("Australia/Sydney");
  freezeNow("2026-11-25T12:00:00Z");
});
afterEach(() => jest.useRealTimers());

it("heads the page with country and record", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  expect(screen.getByRole("heading", { level: 1, name: "Jiří Procházka" })).toBeInTheDocument();
  expect(screen.getByText("UFC fighter")).toBeInTheDocument();
  expect(screen.getByText("Czech Republic · UFC record 1-1-0")).toBeInTheDocument();
  expect(screen.getByText("14 October 1992")).toBeInTheDocument();
  expect(screen.getByText("6′ 3″")).toBeInTheDocument();
  expect(screen.getByText("80″")).toBeInTheDocument();
  expect(screen.getByText("Orthodox")).toBeInTheDocument();
});

it("lists fights upcoming first with result chips", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  expect(within(rows[0]).getByText("Upcoming")).toBeInTheDocument();
  expect(within(rows[0]).getByText("Sun 7 Feb 2027")).toBeInTheDocument();
  expect(within(rows[0]).getByRole("link", { name: "Israel Adesanya" })).toHaveAttribute(
    "href",
    "/ufc/fighter/israel-adesanya-4285679",
  );
  expect(within(rows[1]).getByText("Loss")).toBeInTheDocument();
  expect(within(rows[1]).getByText("KO/TKO · R2")).toBeInTheDocument();
  expect(within(rows[1]).getAllByRole("link", { name: FIGHTER.bouts[1].event.name })[0]).toHaveAttribute(
    "href",
    `/ufc/event/${FIGHTER.bouts[1].event.slug}`,
  );
  expect(within(rows[2]).getByText("Win")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Submission · R1")).toBeInTheDocument();
});

it("shows draw and no contest plainly", () => {
  render(<UfcFighterView fighter={FIGHTER_DRAW_NC} />);
  expect(screen.getByText("Draw")).toBeInTheDocument();
  expect(screen.getByText("No contest")).toBeInTheDocument();
  expect(screen.getByText("United States · UFC record 16-4-1, 1 NC")).toBeInTheDocument();
});

it("works with no history", () => {
  render(<UfcFighterView fighter={FIGHTER_NO_HISTORY} />);
  expect(screen.getByText("Russia")).toBeInTheDocument();
  expect(screen.queryByText(/No UFC fights/i)).toBeNull();
  expect(screen.getByText("Height, reach and date of birth are not available yet.")).toBeInTheDocument();
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(1);
  expect(within(rows[0]).getByText("Upcoming")).toBeInTheDocument();
});

it("says so when there are no fights at all, and drops an unknown country", () => {
  render(<UfcFighterView fighter={{ ...FIGHTER_NO_HISTORY, country: null, bouts: [] }} />);
  expect(screen.queryByText(/No UFC fights/i)).toBeNull();
  expect(screen.getByText("No fights to show yet.")).toBeInTheDocument();
  expect(screen.queryByText(/on record/i)).toBeNull();
  expect(screen.queryByRole("table")).toBeNull();
});

it("shows only the facts that are known", () => {
  render(<UfcFighterView fighter={{ ...FIGHTER_NO_HISTORY, reach_in: 74 }} />);
  expect(screen.getByText("74″")).toBeInTheDocument();
  expect(screen.getByText("Reach")).toBeInTheDocument();
  expect(screen.queryByText("Height")).toBeNull();
  expect(screen.queryByText(/not available yet/)).toBeNull();
});

it("does not link a TBA opponent and covers live, cancelled and unconfirmed fights", () => {
  const base = FIGHTER.bouts[0];
  const tba = { slug: "tba-5300001", name: "Opponent TBA", country: null };
  render(
    <UfcFighterView
      fighter={{
        ...FIGHTER,
        bouts: [
          { ...base, id: 1, opponent: tba },
          { ...base, id: 2, status: "live" },
          { ...base, id: 3, status: "cancelled" },
          { ...base, id: 4, status: "finished", outcome: null, method: null },
        ],
      }}
    />,
  );
  const rows = screen.getAllByRole("row").slice(1);
  expect(within(rows[0]).getByText("Opponent TBA")).toBeInTheDocument();
  expect(within(rows[0]).queryByRole("link", { name: "Opponent TBA" })).toBeNull();
  expect(within(rows[1]).getByText("Live")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Cancelled")).toBeInTheDocument();
  expect(within(rows[3]).getByText("Result to be confirmed")).toBeInTheDocument();
});

it("labels a fight with no time by the viewer's local day of the card", () => {
  const bout = { ...FIGHTER.bouts[1], scheduled_utc: null, event: { ...FIGHTER.bouts[1].event, date: "2026-11-21T18:00:00Z" } };
  setTz("Australia/Sydney");
  const { unmount } = render(<UfcFighterView fighter={{ ...FIGHTER, bouts: [bout] }} />);
  expect(screen.getByText("Sun 22 Nov")).toBeInTheDocument();
  unmount();
  setTz("America/Los_Angeles");
  render(<UfcFighterView fighter={{ ...FIGHTER, bouts: [bout] }} />);
  expect(screen.getByText("Sat 21 Nov")).toBeInTheDocument();
});

it("keeps the method and round line under a draw and a no contest", () => {
  render(<UfcFighterView fighter={FIGHTER_DRAW_NC} />);
  expect(screen.getByText("Draw · R3")).toBeInTheDocument();
  expect(screen.getByText("No contest · R1")).toBeInTheDocument();
});

it("never says a fighter with an unknown record has no fights, and shows the country", () => {
  render(<UfcFighterView fighter={{ ...FIGHTER_NO_HISTORY, bouts: [] }} />);
  expect(screen.queryByText(/No UFC fights/i)).toBeNull();
  expect(screen.getByText("Russia")).toBeInTheDocument();
});

it("shows nothing under the name when record and country are both unknown", () => {
  const { container } = render(<UfcFighterView fighter={{ ...FIGHTER_NO_HISTORY, country: null }} />);
  expect(container.textContent).not.toMatch(/No UFC fights/i);
  expect(screen.getByRole("heading", { level: 1 }).parentElement?.querySelector("p")).toBeNull();
});

it("still shows the record when there is one", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  expect(screen.getByText("Czech Republic · UFC record 1-1-0")).toBeInTheDocument();
});

it("links every row's date to its fight", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  const rows = screen.getAllByRole("row").slice(1);
  rows.forEach((row, i) => {
    const link = within(row).getByRole("link", { name: /fight details$/ });
    expect(link).toHaveAttribute("href", `/ufc/fight/${FIGHTER.bouts[i].id}`);
  });
  expect(within(rows[0]).getByRole("link", { name: "Sun 7 Feb 2027 fight details" })).toBeInTheDocument();
});

it("names the card under the opponent for phones", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  const row = screen.getAllByRole("row")[2];
  const links = within(row).getAllByRole("link", { name: FIGHTER.bouts[1].event.name });
  expect(links).toHaveLength(2);
  const phone = links.find((l) => l.closest("td")?.className.includes("min-[900px]:hidden") || l.parentElement?.className.includes("min-[900px]:hidden"));
  expect(phone).toBeDefined();
  expect(phone).toHaveAttribute("href", `/ufc/event/${FIGHTER.bouts[1].event.slug}`);
});

it("adds the year to a fight date that is not this year", () => {
  render(<UfcFighterView fighter={FIGHTER} />);
  expect(screen.getByText("Sun 7 Feb 2027")).toBeInTheDocument();
  expect(screen.getByText("Sun 22 Nov")).toBeInTheDocument();
  const old = { ...FIGHTER.bouts[2], scheduled_utc: "2019-12-05T20:00:00Z" };
  render(<UfcFighterView fighter={{ ...FIGHTER, bouts: [old] }} />);
  expect(screen.getByText("Fri 6 Dec 2019")).toBeInTheDocument();
});

it("lists the facts as terms and definitions, not stat tiles", () => {
  const { container } = render(<UfcFighterView fighter={FIGHTER} />);
  const terms = Array.from(container.querySelectorAll("dt")).map((t) => t.textContent);
  expect(terms).toEqual(["Age", "Born", "Height", "Reach", "Stance"]);
  const defs = Array.from(container.querySelectorAll("dd")).map((t) => t.textContent);
  expect(defs).toEqual(["34", "14 October 1992", "6′ 3″", "80″", "Orthodox"]);
  expect(container.querySelector(".text-stat")).toBeNull();
});

it("hides placeholder measurements", () => {
  const { container } = render(<UfcFighterView fighter={{ ...FIGHTER_PLACEHOLDER, age: 0 }} />);
  expect(container.querySelectorAll("dt")).toHaveLength(0);
  expect(screen.getByText("Height, reach and date of birth are not available yet.")).toBeInTheDocument();
  expect(screen.queryByText("--")).toBeNull();
  expect(screen.queryByText("0″")).toBeNull();
});
