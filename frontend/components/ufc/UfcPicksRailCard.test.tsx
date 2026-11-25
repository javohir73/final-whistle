import { act, fireEvent, render, screen } from "@testing-library/react";
import { UfcPicksRailCard } from "./UfcPicksRailCard";
import { UfcPicksProvider } from "./UfcPicksProvider";
import { FINISHED_EVENT, UPCOMING_EVENT, freezeNow } from "./fixtures.testutil";
import { graded, mineFor, mockMine, pick } from "./BoutPick.fixtures.testutil";
import { UFC_SCORING } from "@/lib/ufcPicks";
import type { UfcEventDetail } from "@/lib/ufcTypes";

const openSignIn = jest.fn();
let authUser: { id: number } | null = null;
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ user: authUser, loading: false, openSignIn }),
}));

const [main] = UPCOMING_EVENT.segments[0].bouts;
const [prelimA, prelimB] = UPCOMING_EVENT.segments[1].bouts;
const [ko, decision] = FINISHED_EVENT.segments[0].bouts;

const view = (event: UfcEventDetail = UPCOMING_EVENT) =>
  render(
    <UfcPicksProvider eventSlug={event.slug}>
      <UfcPicksRailCard event={event} />
    </UfcPicksProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  authUser = null;
  openSignIn.mockClear();
  freezeNow("2026-12-01T00:00:00Z");
});
afterEach(() => jest.useRealTimers());

it("explains the game with the exact scoring copy before any pick", async () => {
  mockMine(mineFor(UPCOMING_EVENT));
  view();
  expect(screen.getByRole("heading", { name: "Your picks" })).toBeInTheDocument();
  await screen.findByText("A free account keeps your picks across devices."); // the picks have arrived
  expect(screen.getByText("Pick the winner of each fight, and how they win.")).toBeInTheDocument();
  expect(screen.getByText("Winner and method 5 points, winner 2.")).toBeInTheDocument();
  expect(UFC_SCORING).toBe("Winner and method 5 points, winner 2.");
  expect(screen.queryByText(/fights picked/)).toBeNull();
});

it("shows the same explanation while the picks load, with nothing about the player", () => {
  mockMine("pending");
  view();
  expect(screen.getByText("Pick the winner of each fight, and how they win.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(screen.queryByRole("link", { name: "My picks" })).toBeNull();
});

it("counts picks, leaving out cancelled and placeholder fights", async () => {
  // 5 fights: main, TBA (never open), cancelled, 2 prelims. Pickable: main + 2 prelims.
  mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() }, [prelimA.id]: { pick: pick() } }));
  view();
  expect(await screen.findByText("2 of 3 fights picked.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My picks" })).toHaveAttribute("href", "/ufc/picks");
  expect(screen.getByRole("link", { name: "Leaderboard" })).toHaveAttribute(
    "href",
    `/ufc/leaderboard?event=${UPCOMING_EVENT.slug}`,
  );
  expect(screen.queryByText(/scored fights/)).toBeNull();
});

it("leaves a fight closed without a pick out of the count", async () => {
  mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
  jest.setSystemTime(new Date("2026-12-05T16:00:00Z")); // prelims have started
  view();
  expect(await screen.findByText("1 of 1 fights picked.")).toBeInTheDocument();
});

it("counts every open fight picked", async () => {
  mockMine(mineFor(UPCOMING_EVENT, {
    [main.id]: { pick: pick() }, [prelimA.id]: { pick: pick() }, [prelimB.id]: { pick: pick() },
  }));
  view();
  expect(await screen.findByText("3 of 3 fights picked.")).toBeInTheDocument();
});

it("shows points on a finished card", async () => {
  mockMine(mineFor(FINISHED_EVENT, { [ko.id]: { pick: graded(5) }, [decision.id]: { pick: graded(0) } }));
  view(FINISHED_EVENT);
  expect(await screen.findByText("2 of 2 fights picked.")).toBeInTheDocument();
  expect(screen.getByText("5 points from 2 scored fights.")).toBeInTheDocument();
});

it("invites a signed-out player to sign in, and not a signed-in one", async () => {
  mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
  const a = view();
  expect(await screen.findByText("A free account keeps your picks across devices.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(openSignIn).toHaveBeenCalledTimes(1);
  a.unmount();
  authUser = { id: 1 };
  mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
  view();
  await screen.findByText(/fights picked/);
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("says what to allow when the browser keeps no storage", async () => {
  jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mockMine(mineFor(UPCOMING_EVENT));
  view();
  expect(await screen.findByText("Picks need your browser's storage to remember you. Allow site data to play.")).toBeInTheDocument();
  jest.restoreAllMocks();
});

it("offers one quiet retry when the picks could not be read", async () => {
  const fetchMock = mockMine("fail");
  view();
  const retry = await screen.findByRole("button", { name: "Try again" });
  expect(screen.getAllByRole("button", { name: /try again/i })).toHaveLength(1);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Pick the winner of each fight, and how they win.")).toBeInTheDocument();
  mockMine(mineFor(UPCOMING_EVENT, { [main.id]: { pick: pick() } }));
  fireEvent.click(retry);
  expect(await screen.findByText("1 of 3 fights picked.")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("is not shown for a card with no fights", async () => {
  mockMine(mineFor(UPCOMING_EVENT));
  const { container } = view({ ...UPCOMING_EVENT, segments: [] });
  await act(async () => {});
  expect(container).toBeEmptyDOMElement();
});
