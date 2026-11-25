import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { UfcMyPicksView } from "./UfcMyPicksView";
import { FINISHED_EVENT, UPCOMING_EVENT } from "./fixtures.testutil";
import type {
  UfcMyBout,
  UfcMyPicksResponse,
  UfcPick,
  UfcPicksSummaryResponse,
  UfcPicksTotals,
} from "@/lib/ufcTypes";

const mockOpenSignIn = jest.fn();
let mockAuth: { user: { id: number } | null; loading: boolean } = { user: null, loading: false };
jest.mock("@/components/AuthProvider", () => ({
  useAuth: () => ({ ...mockAuth, openSignIn: mockOpenSignIn }),
}));

const DEVICE = "7b0f6d52-3c1a-4e1f-9d3a-1a2b3c4d5e6f";
const NEXT = UPCOMING_EVENT.slug;
const PAST = FINISHED_EVENT.slug;
const LOST = "ufc-300-2026-10-10";

const MAIN_ID = 401933595; // Israel Adesanya v Shara Magomedov, main card
const TBA_ID = 401933596; // Max Holloway v TBA
const CANCELLED_ID = 401933597;
const PRELIM_ID = 401936473; // Mateusz Rębecki v Elves Brener
const PRELIM_2_ID = 401933606; // Abdul Hussein v Maximiliano Bartholomew Wolfeschlegelsteinhausen

const none: UfcPicksTotals = { picked: 0, graded: 0, points: 0, winner_method: 0 };
const pick = (over: Partial<UfcPick> = {}): UfcPick => ({
  winner: "b", method: "decision", created_at: "2026-12-01T00:00:00Z", state: "pending",
  points: null, winner_correct: null, method_correct: null, ...over,
});
const myBout = (id: number, a: string, b: string, over: Partial<UfcMyBout> = {}): UfcMyBout => ({
  bout_id: id, status: "scheduled", fighter_a: a, fighter_b: b, locks_at: "2026-12-05T18:00:00Z",
  picks_open: true, pick: null, model: null, ...over,
});
const nextCard = (over: Partial<UfcMyPicksResponse> = {}): UfcMyPicksResponse => ({
  event: { slug: NEXT, name: UPCOMING_EVENT.name, first_bout_utc: "2026-12-05T15:00:00Z" },
  handle: null,
  bouts: [
    myBout(MAIN_ID, "Israel Adesanya", "Shara Magomedov"),
    myBout(TBA_ID, "Max Holloway", "TBA", { picks_open: false }),
    myBout(CANCELLED_ID, "Jalin Turner", "Bobby Green", { status: "cancelled", picks_open: false }),
    myBout(PRELIM_ID, "Mateusz Rębecki", "Elves Brener", { locks_at: "2026-12-05T15:00:00Z" }),
    myBout(PRELIM_2_ID, "Abdul Hussein", "Maximiliano Bartholomew Wolfeschlegelsteinhausen", { locks_at: "2026-12-05T15:00:00Z" }),
  ],
  changed_picks: [],
  totals: none,
  disclaimer: "d",
  ...over,
});
const pastCard = (): UfcMyPicksResponse => ({
  event: { slug: PAST, name: FINISHED_EVENT.name, first_bout_utc: "2026-11-21T18:00:00Z" },
  handle: "SwiftStriker42",
  bouts: [
    myBout(1, "Jiří Procházka", "Navajo Stirling", { status: "finished", picks_open: false,
      pick: pick({ winner: "b", method: "ko_tko", state: "graded", points: 5 }) }),
    myBout(2, "Aljamain Sterling", "Kevin Vallejos", { status: "finished", picks_open: false,
      pick: pick({ winner: "b", method: "submission", state: "graded", points: 2 }) }),
    myBout(3, "Dan Hooker", "Brian Ortega", { status: "finished", picks_open: false,
      pick: pick({ winner: "a", method: "decision", state: "graded", points: 0 }) }),
    myBout(4, "Bobby Green", "Jalin Turner", { status: "finished", picks_open: false,
      pick: pick({ winner: "a", method: "decision", state: "void" }) }),
    myBout(5, "Unpicked One", "Unpicked Two", { status: "finished", picks_open: false }),
  ],
  changed_picks: [],
  totals: { picked: 4, graded: 3, points: 7, winner_method: 1 },
  disclaimer: "d",
});
const summaryOf = (cards: UfcPicksSummaryResponse["cards"], totals: UfcPicksTotals): UfcPicksSummaryResponse => ({
  handle: "SwiftStriker42", cards, totals,
});
const PAST_ROW = { slug: PAST, name: FINISHED_EVENT.name, first_bout_utc: "2026-11-21T18:00:00Z",
  picked: 4, graded: 3, points: 7, winner_method: 1 };

type Reply = unknown | Error | "pending";
type Routes = { mine?: Record<string, Reply>; summary?: Reply };
const calls: string[] = [];
function mockApi(routes: Routes) {
  global.fetch = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const q = new URL(url, "http://x").searchParams;
    const reply: Reply = url.includes("/api/ufc/picks/summary")
      ? routes.summary
      : url.includes("/api/ufc/picks/mine")
        ? routes.mine?.[q.get("event") ?? ""]
        : new Error("unexpected " + url);
    if (reply === "pending") return new Promise<Response>(() => {});
    if (reply instanceof Error || reply === undefined) throw new TypeError("network down");
    return { ok: true, status: 200, json: async () => reply } as Response;
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  calls.length = 0;
  mockOpenSignIn.mockReset();
  mockAuth = { user: null, loading: false };
  window.localStorage.clear();
  window.localStorage.setItem("pp:timezone", JSON.stringify({ tz: "Australia/Sydney", confirmed: true }));
  window.localStorage.setItem("fw_device_id", DEVICE);
  jest.useFakeTimers({ advanceTimers: true, now: new Date("2026-12-01T00:00:00Z") });
});
afterEach(() => jest.useRealTimers());

const open = () => render(<UfcMyPicksView event={UPCOMING_EVENT} />);

it("renders the same shell before anything about the player is known", () => {
  mockApi({ mine: { [NEXT]: "pending" }, summary: "pending" });
  open();
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText(`Pick the winner of every fight on ${UPCOMING_EVENT.name}, and how they win.`)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
  expect(screen.getByText("Winner and method 5 points, winner 2.")).toBeInTheDocument();
  expect(screen.getByText("A locked pick is final.")).toBeInTheDocument();
  expect(screen.getByText("Picks close when that part of the card starts.")).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading your picks");
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  expect(screen.queryByRole("link", { name: /^Pick the winner of/ })).toBeNull();
  expect(screen.getByRole("link", { name: "Open the card" })).toHaveAttribute("href", `/ufc/event/${NEXT}`);
  // the fights are on the page already, each linking to its fight page
  expect(screen.getByRole("link", { name: /Israel Adesanya v Shara Magomedov/ })).toHaveAttribute("href", `/ufc/fight/${MAIN_ID}`);
});

it("greets a new player and sends them to the card", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("You have not picked any fights yet.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", `/ufc/event/${NEXT}`);
  // one way in per open fight; a placeholder fight and a cancelled fight have none
  const pickLinks = screen.getAllByRole("link", { name: /^Pick the winner of/ });
  expect(pickLinks.map((l) => l.getAttribute("href"))).toEqual([
    `/ufc/fight/${MAIN_ID}#pick`, `/ufc/fight/${PRELIM_ID}#pick`, `/ufc/fight/${PRELIM_2_ID}#pick`,
  ]);
  expect(pickLinks[0]).toHaveAccessibleName("Pick the winner of Israel Adesanya v Shara Magomedov");
  // nothing is scored, so no zero is presented as a result
  expect(screen.queryByText(/points from/)).toBeNull();
  expect(screen.queryByText(/Missed/)).toBeNull();
  expect(screen.queryByText("Past cards")).toBeNull();
  expect(screen.queryByText(/Void/)).toBeNull();
});

it("shows the handle once known", async () => {
  mockApi({ mine: { [NEXT]: nextCard({ handle: "SwiftStriker42" }) }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Playing as SwiftStriker42.")).toBeInTheDocument();
});

it("shows open picks with no result and no zeros", async () => {
  const bouts = nextCard().bouts;
  bouts[0] = { ...bouts[0], pick: pick({ winner: "b", method: "decision" }) };
  mockApi({
    mine: { [NEXT]: nextCard({ bouts, totals: { ...none, picked: 1 } }) },
    summary: summaryOf([{ slug: NEXT, name: UPCOMING_EVENT.name, first_bout_utc: null, ...none, picked: 1 }], { ...none, picked: 1 }),
  });
  open();
  expect(await screen.findByText("You: Shara Magomedov, decision")).toBeInTheDocument();
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  expect(screen.queryByText(/points from/)).toBeNull();
  expect(screen.queryByText(/0 points/)).toBeNull();
  expect(screen.getByText(/Nothing is scored yet/)).toBeInTheDocument();
  // the current card is not listed again as a past card
  expect(screen.queryByText("Past cards")).toBeNull();
  // no model call in the payload: none shown
  expect(screen.queryByText(/^Model:/)).toBeNull();
});

it("shows pending, graded 5, 2 and 0, and void picks across two cards", async () => {
  const bouts = nextCard().bouts;
  bouts[0] = { ...bouts[0], pick: pick() };
  mockApi({
    mine: { [NEXT]: nextCard({ bouts, totals: { ...none, picked: 1 } }), [PAST]: pastCard() },
    summary: summaryOf(
      [{ slug: NEXT, name: UPCOMING_EVENT.name, first_bout_utc: null, ...none, picked: 1 }, PAST_ROW],
      { picked: 5, graded: 3, points: 7, winner_method: 1 },
    ),
  });
  open();
  const past = await screen.findByRole("region", { name: FINISHED_EVENT.name });
  await within(past).findByText("You: Navajo Stirling, KO/TKO");
  // card link, totals from the server, leaderboard link
  expect(within(past).getByRole("link", { name: FINISHED_EVENT.name })).toHaveAttribute("href", `/ufc/event/${PAST}`);
  expect(within(past).getByText("7 points · 3 scored fights")).toBeInTheDocument();
  expect(within(past).getByRole("link", { name: "Leaderboard" })).toHaveAttribute("href", `/ufc/leaderboard?event=${PAST}`);
  // graded 5, 2, 0 and void, each by name
  expect(within(past).getByText("Winner and method · 5 points")).toBeInTheDocument();
  expect(within(past).getByText("Winner · 2 points")).toBeInTheDocument();
  expect(within(past).getByText("Missed · 0 points")).toBeInTheDocument();
  const voidChip = within(past).getByText("Void · no points");
  expect(voidChip.className).not.toMatch(/miss/);
  expect(within(past).getByText("Missed · 0 points").className).toMatch(/miss/);
  // fights link to their pages, in full; a fight with no pick is not listed
  expect(within(past).getByRole("link", { name: "Jiří Procházka v Navajo Stirling" })).toHaveAttribute("href", "/ufc/fight/1");
  expect(within(past).queryByText(/Unpicked One/)).toBeNull();
  // the current card shows its pending pick with no result
  expect(screen.getByText("You: Shara Magomedov, decision")).toBeInTheDocument();
  // overall totals come from the summary payload
  expect(screen.getByText("7 points from 3 scored fights.")).toBeInTheDocument();
  expect(calls.some((u) => u.includes("/api/ufc/picks/summary") && u.includes(DEVICE))).toBe(true);
});

it("scores nothing in the browser: totals are the server's, even if they disagree with the rows", async () => {
  mockApi({
    mine: { [NEXT]: nextCard(), [PAST]: pastCard() },
    summary: summaryOf([{ ...PAST_ROW, points: 99, graded: 8 }], { picked: 4, graded: 8, points: 99, winner_method: 1 }),
  });
  open();
  expect(await screen.findByText("99 points · 8 scored fights")).toBeInTheDocument();
});

it("shows a graded winner and method pick on the next card with its model line only when a call is present", async () => {
  const bouts = nextCard().bouts;
  bouts[0] = {
    ...bouts[0], status: "finished", picks_open: false,
    pick: pick({ winner: "a", method: "ko_tko", state: "graded", points: 5 }),
    model: { winner: "a", method: "ko_tko", p_a: 0.54, p_b: 0.46, method_probs: null, version: "m1" } as never,
  };
  mockApi({
    mine: { [NEXT]: nextCard({ bouts, totals: { picked: 1, graded: 1, points: 5, winner_method: 1 } }) },
    summary: summaryOf([], none),
  });
  open();
  expect(await screen.findByText("Winner and method · 5 points")).toBeInTheDocument();
  expect(screen.getByText("5 points from 1 scored fight.")).toBeInTheDocument();
});

it("shows a pick on a fight that changed opponent as void, with a way to the new fight", async () => {
  const card = nextCard({
    changed_picks: [{
      bout_id: 9, fighter_a: "Max Holloway", fighter_b: "Old Opponent",
      pick: pick({ winner: "a", method: "ko_tko", state: "void" }), replaced_by_id: TBA_ID,
    }],
  });
  mockApi({ mine: { [NEXT]: card }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Your pick on Max Holloway v Old Opponent doesn't count because the fight changed.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the new fight" })).toHaveAttribute("href", `/ufc/fight/${TBA_ID}#pick`);
  expect(screen.queryByText(/Missed/)).toBeNull();
});

it("lists past cards only when there are some", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  const { unmount } = open();
  await screen.findByText("You have not picked any fights yet.");
  expect(screen.queryByRole("heading", { name: "Past cards" })).toBeNull();
  unmount();
  mockApi({ mine: { [NEXT]: nextCard(), [PAST]: pastCard() }, summary: summaryOf([PAST_ROW], none) });
  open();
  expect(await screen.findByRole("heading", { name: "Past cards" })).toBeInTheDocument();
  await screen.findByText("You: Navajo Stirling, KO/TKO");
});

it("names a card that has no scored fights yet without a zero", async () => {
  const row = { ...PAST_ROW, points: 0, graded: 0, winner_method: 0 };
  mockApi({ mine: { [NEXT]: nextCard(), [PAST]: pastCard() }, summary: summaryOf([row], none) });
  open();
  expect(await screen.findByText("Not scored yet")).toBeInTheDocument();
  expect(screen.queryByText(/0 points ·/)).toBeNull();
  await screen.findByText("You: Navajo Stirling, KO/TKO");
});

it("ignores a payload for another card", async () => {
  mockApi({ mine: { [NEXT]: pastCard() }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("We could not load your picks.")).toBeInTheDocument();
  expect(screen.queryByText(/^You:/)).toBeNull();
});

it("says so and offers a retry when the summary fails; the shell and the next card still render", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: new Error("down") });
  open();
  expect(await screen.findByText("We could not load your other cards.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText("You have not picked any fights yet.")).toBeInTheDocument();
  mockApi({ mine: { [NEXT]: nextCard(), [PAST]: pastCard() }, summary: summaryOf([PAST_ROW], none) });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { name: "Past cards" })).toBeInTheDocument();
  expect(screen.queryByText("We could not load your other cards.")).toBeNull();
  await screen.findByText("You: Navajo Stirling, KO/TKO");
});

it("keeps the other cards when one card's picks fail to load, and retries just that card", async () => {
  const second = { ...PAST_ROW, slug: LOST, name: "UFC 300", first_bout_utc: "2026-10-10T18:00:00Z" };
  mockApi({
    mine: { [NEXT]: nextCard(), [PAST]: pastCard() }, // LOST has no route: the fetch fails
    summary: summaryOf([PAST_ROW, second], none),
  });
  open();
  const ok = await screen.findByRole("region", { name: FINISHED_EVENT.name });
  await within(ok).findByText("You: Navajo Stirling, KO/TKO");
  const bad = screen.getByRole("region", { name: "UFC 300" });
  expect(await within(bad).findByText("We could not load your picks on this card.")).toBeInTheDocument();
  expect(within(bad).getByRole("link", { name: "UFC 300" })).toHaveAttribute("href", `/ufc/event/${LOST}`);
  expect(within(bad).getByText("7 points · 3 scored fights")).toBeInTheDocument();
  mockApi({ mine: { [LOST]: { ...pastCard(), event: { slug: LOST, name: "UFC 300", first_bout_utc: null } } }, summary: summaryOf([], none) });
  await act(async () => {
    fireEvent.click(within(bad).getByRole("button", { name: "Try again" }));
  });
  await waitFor(() => expect(within(bad).queryByText("We could not load your picks on this card.")).toBeNull());
  expect(await within(bad).findByText("You: Navajo Stirling, KO/TKO")).toBeInTheDocument();
});

it("says so and offers a retry when the next card's picks fail", async () => {
  mockApi({ mine: {}, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("We could not load your picks.")).toBeInTheDocument();
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("You have not picked any fights yet.")).toBeInTheDocument();
});

it("invites a signed-out player to sign in, and not a signed-in one", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  const { unmount } = open();
  expect(screen.getByText("Your picks are saved on this device. A free account keeps them across devices.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
  await act(async () => {});
  unmount();
  mockAuth = { user: { id: 1 }, loading: false };
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  await screen.findByText("You have not picked any fights yet.");
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  expect(screen.queryByText(/free account/)).toBeNull();
});

it("does not flash the sign-in invite while the session is still loading", () => {
  mockAuth = { user: null, loading: true };
  mockApi({ mine: { [NEXT]: "pending" }, summary: "pending" });
  open();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("closes a pick the viewer's clock says has started, and says picks closed", async () => {
  jest.setSystemTime(new Date("2026-12-05T16:00:00Z"));
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  await screen.findByText("You have not picked any fights yet.");
  // prelims (15:00Z) are closed; the main card (18:00Z) is still open
  expect(screen.getAllByText("Picks closed").length).toBe(2);
  expect(screen.getAllByRole("link", { name: /^Pick the winner of/ })).toHaveLength(1);
});

it("asks for site data when storage is blocked", async () => {
  const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  mockApi({ mine: {}, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Picks need your browser's storage to remember you. Allow site data to play.")).toBeInTheDocument();
  expect(calls).toHaveLength(0);
  spy.mockRestore();
});
