import { render, screen, within } from "@testing-library/react";
import { UfcFighterView } from "./UfcFighterView";
import { FIGHTER, FIGHTER_DRAW_NC, FIGHTER_NO_HISTORY } from "./fixtures.testutil";

beforeEach(() => {
  window.localStorage.setItem("pp:timezone", "Australia/Sydney");
});

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
  expect(within(rows[0]).getByText("Sun 7 Feb")).toBeInTheDocument();
  expect(within(rows[0]).getByRole("link", { name: "Israel Adesanya" })).toHaveAttribute(
    "href",
    "/ufc/fighter/israel-adesanya-4285679",
  );
  expect(within(rows[1]).getByText("Loss")).toBeInTheDocument();
  expect(within(rows[1]).getByText("KO/TKO · R2")).toBeInTheDocument();
  expect(within(rows[1]).getByRole("link", { name: FIGHTER.bouts[1].event.name })).toHaveAttribute(
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
  expect(screen.getByText("Russia · No UFC fights on record yet")).toBeInTheDocument();
  expect(screen.getByText("Height, reach and date of birth are not available yet.")).toBeInTheDocument();
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(1);
  expect(within(rows[0]).getByText("Upcoming")).toBeInTheDocument();
});

it("says so when there are no fights at all, and drops an unknown country", () => {
  render(<UfcFighterView fighter={{ ...FIGHTER_NO_HISTORY, country: null, bouts: [] }} />);
  expect(screen.getByText("No UFC fights on record yet")).toBeInTheDocument();
  expect(screen.getByText("No fights on record yet.")).toBeInTheDocument();
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
  const tba = { slug: "tba-5300001", name: "TBA", country: null };
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
  expect(within(rows[0]).getByText("TBA")).toBeInTheDocument();
  expect(within(rows[0]).queryByRole("link", { name: "TBA" })).toBeNull();
  expect(within(rows[1]).getByText("Live")).toBeInTheDocument();
  expect(within(rows[2]).getByText("Cancelled")).toBeInTheDocument();
  expect(within(rows[3]).getByText("Result to be confirmed")).toBeInTheDocument();
});

it("keeps a date-only fight on its own day in a western time zone", () => {
  window.localStorage.setItem("pp:timezone", "America/Los_Angeles");
  const bout = { ...FIGHTER.bouts[1], scheduled_utc: null };
  render(<UfcFighterView fighter={{ ...FIGHTER, bouts: [bout] }} />);
  expect(screen.getByText("Sat 21 Nov")).toBeInTheDocument();
});
