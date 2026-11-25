import { render, screen, within } from "@testing-library/react";
import EventsPage, { EVENTS_PAGE, offsetParam } from "./page";
import { getUfcEventsServer } from "@/lib/api";
import { PAST_LIST, UPCOMING_LIST } from "@/components/ufc/fixtures.testutil";
import type { UfcEventSummary } from "@/lib/ufcTypes";

jest.mock("@/lib/api");
const mockEvents = getUfcEventsServer as jest.MockedFunction<typeof getUfcEventsServer>;
afterEach(() => jest.resetAllMocks());

const mkPast = (_: unknown, i: number): UfcEventSummary => ({ ...PAST_LIST[1], slug: `ufc-3${10 + i}`, name: `UFC 3${10 + i}` });

it("asks for one extra row and offers Show more", async () => {
  mockEvents.mockImplementation(async (when) => ({ events: when === "past" ? Array.from({ length: 21 }, mkPast) : UPCOMING_LIST }));
  render(await EventsPage({ searchParams: Promise.resolve({}) }));
  expect(EVENTS_PAGE).toBe(20);
  expect(mockEvents).toHaveBeenCalledWith("past", 21, 0);
  expect(mockEvents).toHaveBeenCalledWith("upcoming", 21, 0);
  expect(within(screen.getByRole("region", { name: "Results" })).getAllByRole("link", { name: /^UFC 3\d\d/ })).toHaveLength(20);
  expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/ufc/events?past=20");
  expect(screen.queryByRole("link", { name: "Back to the start" })).not.toBeInTheDocument();
});

it("keeps the other list's offset and offers a way back", async () => {
  mockEvents.mockImplementation(async (when) => ({ events: when === "past" ? Array.from({ length: 21 }, mkPast) : UPCOMING_LIST }));
  render(await EventsPage({ searchParams: Promise.resolve({ up: "20", past: "40" }) }));
  expect(mockEvents).toHaveBeenCalledWith("past", 21, 40);
  expect(mockEvents).toHaveBeenCalledWith("upcoming", 21, 20);
  expect(screen.getByRole("link", { name: "Show more" })).toHaveAttribute("href", "/ufc/events?up=20&past=60");
  const backs = screen.getAllByRole("link", { name: "Back to the start" }).map((a) => a.getAttribute("href"));
  expect(backs).toEqual(["/ufc/events?past=40", "/ufc/events?up=20"]);
});

it("ignores a bad offset", () => {
  expect(offsetParam("-3")).toBe(0);
  expect(offsetParam("abc")).toBe(0);
  expect(offsetParam("40")).toBe(40);
  expect(offsetParam("1.5")).toBe(0);
  expect(offsetParam("1e3")).toBe(0);
  expect(offsetParam("10000")).toBe(10000);
  expect(offsetParam("10001")).toBe(0);
  expect(offsetParam(["20", "40"])).toBe(0);
  expect(offsetParam(undefined)).toBe(0);
  expect(offsetParam("")).toBe(0);
});

it("gives the first page for hand-typed bad params", async () => {
  mockEvents.mockResolvedValue({ events: [] });
  render(await EventsPage({ searchParams: Promise.resolve({ up: "abc", past: "99999" }) }));
  expect(mockEvents).toHaveBeenCalledWith("upcoming", 21, 0);
  expect(mockEvents).toHaveBeenCalledWith("past", 21, 0);
});

it("stops offering Show more past the API's offset cap", async () => {
  mockEvents.mockImplementation(async (when) => ({ events: when === "past" ? Array.from({ length: 21 }, mkPast) : [] }));
  render(await EventsPage({ searchParams: Promise.resolve({ past: "9990" }) }));
  expect(screen.queryByRole("link", { name: "Show more" })).not.toBeInTheDocument();
});

it("shows the intentional empty states", async () => {
  mockEvents.mockResolvedValue({ events: [] });
  render(await EventsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByText("No upcoming cards are listed yet.")).toBeInTheDocument();
  expect(screen.getByText("No results yet. Finished cards appear here.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "Events" })).toBeInTheDocument();
});

it("survives a feed error in one list", async () => {
  mockEvents.mockImplementation(async (when) => {
    if (when === "past") throw new Error("down");
    return { events: UPCOMING_LIST };
  });
  render(await EventsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("link", { name: UPCOMING_LIST[0].name })).toBeInTheDocument();
  expect(screen.getByText("We could not reach the fight feed. Try again in a minute.")).toBeInTheDocument();
  expect(screen.queryByText("No results yet. Finished cards appear here.")).not.toBeInTheDocument();
});
