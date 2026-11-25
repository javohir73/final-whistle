import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { announceTipsIdentityChanged } from "@/components/play/tipsIdentity";
import { UfcMyPicksView } from "./UfcMyPicksView";
import { FINISHED_EVENT, UPCOMING_EVENT } from "./fixtures.testutil";
import type { UfcEventDetail } from "@/lib/ufcTypes";
import type {
  UfcModelCall,
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
const OLD = "ufc-300-2026-10-10";

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
const summaryOf = (cards: UfcPicksSummaryResponse["cards"], totals: UfcPicksTotals): UfcPicksSummaryResponse => ({
  handle: null, cards, totals,
});
const PAST_ROW = { slug: PAST, name: FINISHED_EVENT.name, first_bout_utc: "2026-11-21T18:00:00Z",
  picked: 4, graded: 3, points: 7, winner_method: 1 };
const withStatus = (status: "finished" | "live", ids: number[]): UfcEventDetail => ({
  ...UPCOMING_EVENT,
  segments: UPCOMING_EVENT.segments.map((seg) => ({
    ...seg, bouts: seg.bouts.map((b) => (ids.includes(b.id) ? { ...b, status } : b)),
  })),
});
const MODEL: UfcModelCall = { model_version: "m1", winner: "a", p_a: 0.54, p_b: 0.46, method: "ko_tko", method_probs: null, reasons: [] };
const withPicks = (picks: Record<number, UfcPick>, over: Partial<UfcMyPicksResponse> = {}): UfcMyPicksResponse => {
  const card = nextCard();
  const bouts = card.bouts.map((b) => (picks[b.bout_id] ? { ...b, pick: picks[b.bout_id] } : b));
  const picked = Object.keys(picks).length;
  return { ...card, bouts, totals: { ...none, picked }, ...over };
};
const SUMMARY_NEXT = { slug: NEXT, name: UPCOMING_EVENT.name, first_bout_utc: null, ...none, picked: 1 };

type Reply = unknown | Error | "pending" | { __http: number } | "abort";
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
    if (reply === "abort") throw new DOMException("aborted", "AbortError");
    if (reply && typeof reply === "object" && "__http" in reply) {
      const status = (reply as { __http: number }).__http;
      return { ok: false, status, json: async () => ({ error: { code: "boom", message: "Server said no" } }) } as Response;
    }
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




const open = (event: UfcEventDetail = UPCOMING_EVENT) => render(<UfcMyPicksView event={event} />);

it("renders the same shell before anything about the player is known", () => {
  mockApi({ mine: { [NEXT]: "pending" }, summary: "pending" });
  open();
  expect(screen.getByText("UFC")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText(`Pick the winner of every fight on ${UPCOMING_EVENT.name}, and how they win.`)).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "How it works" })).toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("Loading your picks");
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  expect(screen.queryByRole("link", { name: /^Pick the winner of/ })).toBeNull();
  // the band's name is just the card name; its link sits outside the heading
  expect(screen.getByRole("heading", { level: 2, name: UPCOMING_EVENT.name })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open the card" })).toHaveAttribute("href", `/ufc/event/${NEXT}`);
  expect(screen.getByRole("link", { name: /Israel Adesanya v Shara Magomedov/ })).toHaveAttribute("href", `/ufc/fight/${MAIN_ID}`);
  // each row reserves its pick slot before the picks arrive, so the list does not grow
  expect(screen.getAllByTestId("pick-slot")).toHaveLength(4);
  expect(screen.queryByText("Sign in")).toBeNull();
});

it("gives a player who has never played the whole first screen", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("You have not picked any fights yet.")).toBeInTheDocument();
  expect(screen.getByText("UFC")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText(`Pick the winner of every fight on ${UPCOMING_EVENT.name}, and how they win.`)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Pick the next card" })).toHaveAttribute("href", `/ufc/event/${NEXT}`);
  expect(screen.getByText("Winner and method 5 points, winner 2.")).toBeInTheDocument();
  expect(screen.getByText("A locked pick is final.")).toBeInTheDocument();
  expect(screen.getByText("Picks close when that part of the card starts.")).toBeInTheDocument();
  const pickLinks = screen.getAllByRole("link", { name: /^Pick the winner of/ });
  expect(pickLinks.map((l) => l.getAttribute("href"))).toEqual([
    `/ufc/fight/${MAIN_ID}#pick`, `/ufc/fight/${PRELIM_ID}#pick`, `/ufc/fight/${PRELIM_2_ID}#pick`,
  ]);
  expect(pickLinks[0]).toHaveAccessibleName("Pick the winner of Israel Adesanya v Shara Magomedov");
  // nothing presented as a result, no past cards, and no sign-in nag to someone who has not played
  expect(screen.queryByText(/points from/)).toBeNull();
  expect(screen.queryByText(/Missed|Void/)).toBeNull();
  expect(screen.queryByRole("heading", { name: "Past cards" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("shows the handle once known", async () => {
  mockApi({ mine: { [NEXT]: nextCard({ handle: "SwiftStriker42" }) }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Playing as SwiftStriker42.")).toBeInTheDocument();
});

it("shows open picks with no result and no zeros", async () => {
  mockApi({
    mine: { [NEXT]: withPicks({ [MAIN_ID]: pick() }) },
    summary: summaryOf([SUMMARY_NEXT], { ...none, picked: 1 }),
  });
  open();
  expect(await screen.findByText("You: Shara Magomedov, decision")).toBeInTheDocument();
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  expect(screen.queryByText(/points from/)).toBeNull();
  expect(screen.getByText("1 pick · none scored yet")).toBeInTheDocument();
  expect(screen.queryByText("Past cards")).toBeNull();
  expect(screen.queryByText(/^Model:/)).toBeNull();
});

it("shows pending, graded 5, 2 and 0, and void picks, and the server's totals", async () => {
  mockApi({
    mine: {
      [NEXT]: withPicks({
        [MAIN_ID]: pick(),
        [PRELIM_ID]: pick({ state: "graded", points: 5, winner: "a", method: "ko_tko" }),
        [PRELIM_2_ID]: pick({ state: "graded", points: 2, winner: "a", method: "decision" }),
        [TBA_ID]: pick({ state: "graded", points: 0 }),
        [CANCELLED_ID]: pick({ state: "void" }),
      }, { totals: { picked: 5, graded: 3, points: 7, winner_method: 1 } }),
    },
    summary: summaryOf([PAST_ROW], { picked: 9, graded: 6, points: 40, winner_method: 3 }),
  });
  open();
  expect(await screen.findByText("Winner and method · 5 points")).toBeInTheDocument();
  expect(screen.getByText("Winner · 2 points")).toBeInTheDocument();
  expect(screen.getByText("7 points from 3 scored fights.")).toBeInTheDocument();
  expect(screen.getByText("40 points from 6 scored fights.")).toBeInTheDocument();
});

it("shows a void pick as void, never as a loss", async () => {
  const mine = withPicks({ [PRELIM_ID]: pick({ state: "void", winner: "a", method: "decision" }) });
  mockApi({ mine: { [NEXT]: mine }, summary: summaryOf([], none) });
  open();
  const chip = await screen.findByText("Void · no points");
  expect(chip.className).not.toMatch(/miss/);
  expect(screen.queryByText(/Missed/)).toBeNull();
});

it("shows a late-void pick on a normally finished fight as void, and counts nothing", async () => {
  const mine = withPicks({ [MAIN_ID]: pick({ state: "void" }) });
  mockApi({ mine: { [NEXT]: mine }, summary: summaryOf([], none) });
  open(withStatus("finished", [MAIN_ID]));
  expect(await screen.findByText("Void · no points")).toBeInTheDocument();
  expect(screen.queryByText(/Missed/)).toBeNull();
  expect(screen.getByText("1 pick · none scored")).toBeInTheDocument();
  expect(screen.queryByText(/points from/)).toBeNull();
});

it("shows a graded 0 plainly as a miss", async () => {
  const mine = withPicks({ [MAIN_ID]: pick({ state: "graded", points: 0 }) }, { totals: { picked: 1, graded: 1, points: 0, winner_method: 0 } });
  mockApi({ mine: { [NEXT]: mine }, summary: summaryOf([], none) });
  open(withStatus("finished", [MAIN_ID]));
  const chip = await screen.findByText("Missed · 0 points");
  expect(chip.className).toMatch(/miss/);
  expect(screen.getByText("0 points from 1 scored fight.")).toBeInTheDocument();
});

it("shows the model's call on a locked fight with a pending pick, when the payload has one", async () => {
  const mine = withPicks({ [MAIN_ID]: pick() });
  mine.bouts[0] = { ...mine.bouts[0], status: "live", picks_open: false, model: MODEL };
  mockApi({ mine: { [NEXT]: mine }, summary: summaryOf([], none) });
  open(withStatus("live", [MAIN_ID]));
  expect(await screen.findByText("Model: Israel Adesanya 54%")).toBeInTheDocument();
  expect(screen.getByText("You: Shara Magomedov, decision")).toBeInTheDocument();
});

it("says a pick on a cancelled fight does not count", async () => {
  mockApi({ mine: { [NEXT]: withPicks({ [CANCELLED_ID]: pick({ state: "void" }) }) }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Your pick does not count because the fight was cancelled.")).toBeInTheDocument();
  expect(screen.getByText("Cancelled")).toBeInTheDocument();
});

it("shows a pick on a fight that changed opponent, with a way to the new fight", async () => {
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

it("lists past cards as one row each, with the server's totals, and no per-card requests", async () => {
  mockApi({
    mine: { [NEXT]: nextCard() },
    summary: summaryOf([SUMMARY_NEXT, PAST_ROW, { ...PAST_ROW, slug: OLD, name: "UFC 300", picked: 1, graded: 1, points: 1, winner_method: 0 }], none),
  });
  open();
  const past = await screen.findByRole("region", { name: "Past cards" });
  expect(within(past).getByRole("link", { name: FINISHED_EVENT.name })).toHaveAttribute("href", `/ufc/event/${PAST}`);
  expect(within(past).getByText("7 points · 3 scored fights")).toBeInTheDocument();
  expect(within(past).getByText("1 point · 1 scored fight")).toBeInTheDocument();
  expect(within(past).getByRole("link", { name: `Leaderboard for ${FINISHED_EVENT.name}` })).toHaveAttribute("href", `/ufc/leaderboard?event=${PAST}`);
  expect(within(past).queryByText(UPCOMING_EVENT.name)).toBeNull();
  expect(calls.filter((u) => u.includes("/picks/mine"))).toHaveLength(1);
});

it("uses the server's totals even if they disagree with anything else", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([{ ...PAST_ROW, points: 99, graded: 8 }], none) });
  open();
  expect(await screen.findByText("99 points · 8 scored fights")).toBeInTheDocument();
});

it("tells the truth about a past card where nothing is scored, pending or void", async () => {
  const row = (over: object) => ({ ...PAST_ROW, points: 0, graded: 0, winner_method: 0, ...over });
  mockApi({
    mine: { [NEXT]: nextCard() },
    summary: summaryOf([
      row({ picked: 2 }),
      row({ slug: OLD, name: "UFC 300", picked: 1, first_bout_utc: "2026-12-19T22:00:00Z" }),
    ], none),
  });
  open();
  expect(await screen.findByText("2 picks · none scored")).toBeInTheDocument();
  expect(screen.getByText("1 pick · none scored yet")).toBeInTheDocument();
  expect(screen.queryByText(/Not scored yet/)).toBeNull();
  expect(screen.queryByText(/0 points/)).toBeNull();
});

it.each([
  ["a network failure", new Error("down")],
  ["an HTTP error", { __http: 500 }],
  ["a timeout", "abort"],
])("says so and offers a retry when the summary fails with %s; the shell and the card still render", async (_n, reply) => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: reply });
  open();
  expect(await screen.findByText("We could not load your other cards.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { level: 1, name: "My picks" })).toBeInTheDocument();
  expect(screen.getByText("You have not picked any fights yet.")).toBeInTheDocument();
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([PAST_ROW], none) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again to load your other cards" }));
  });
  expect(await screen.findByRole("heading", { name: "Past cards" })).toBeInTheDocument();
  expect(screen.queryByText("We could not load your other cards.")).toBeNull();
});

it.each([
  ["an HTTP error", { __http: 429 }],
  ["a timeout", "abort"],
  ["a network failure", new Error("down")],
])("says so and offers a retry when the next card's picks fail with %s", async (_n, reply) => {
  mockApi({ mine: { [NEXT]: reply }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("We could not load your picks.")).toBeInTheDocument();
  expect(screen.queryByText("You have not picked any fights yet.")).toBeNull();
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try again to load your picks" }));
  });
  expect(await screen.findByText("You have not picked any fights yet.")).toBeInTheDocument();
});

it("ignores a payload for another card", async () => {
  mockApi({ mine: { [NEXT]: { ...nextCard(), event: { ...nextCard().event, slug: PAST } } }, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("We could not load your picks.")).toBeInTheDocument();
});

it("refetches when the player's identity changes (sign-in claim)", async () => {
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  await screen.findByText("You have not picked any fights yet.");
  expect(screen.queryByRole("heading", { name: "Past cards" })).toBeNull();
  mockApi({
    mine: { [NEXT]: withPicks({ [MAIN_ID]: pick() }, { handle: "SwiftStriker42" }) },
    summary: summaryOf([PAST_ROW], none),
  });
  await act(async () => {
    announceTipsIdentityChanged();
  });
  expect(await screen.findByText("Playing as SwiftStriker42.")).toBeInTheDocument();
  expect(await screen.findByRole("heading", { name: "Past cards" })).toBeInTheDocument();
  expect(calls.filter((u) => u.includes("/summary")).length).toBeGreaterThanOrEqual(2);
});

it("invites a signed-out player who has played to sign in, and not a signed-in one", async () => {
  mockApi({ mine: { [NEXT]: withPicks({ [MAIN_ID]: pick() }) }, summary: summaryOf([SUMMARY_NEXT], none) });
  const { unmount } = open();
  expect(await screen.findByText("A free account keeps your picks across devices.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(mockOpenSignIn).toHaveBeenCalledTimes(1);
  unmount();
  mockAuth = { user: { id: 1 }, loading: false };
  mockApi({ mine: { [NEXT]: withPicks({ [MAIN_ID]: pick() }) }, summary: summaryOf([SUMMARY_NEXT], none) });
  open();
  await screen.findByText("You: Shara Magomedov, decision");
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  expect(screen.queryByText(/free account/)).toBeNull();
});

it("does not flash the sign-in invite while the session is still loading", async () => {
  mockAuth = { user: null, loading: true };
  mockApi({ mine: { [NEXT]: withPicks({ [MAIN_ID]: pick() }) }, summary: summaryOf([], none) });
  open();
  await screen.findByText("You: Shara Magomedov, decision");
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
});

it("closes a pick the viewer's clock says has started", async () => {
  jest.setSystemTime(new Date("2026-12-05T16:00:00Z"));
  mockApi({ mine: { [NEXT]: nextCard() }, summary: summaryOf([], none) });
  open();
  await screen.findByText("You have not picked any fights yet.");
  expect(screen.getAllByText("Picks closed").length).toBe(2);
  expect(screen.getAllByRole("link", { name: /^Pick the winner of/ })).toHaveLength(1);
});

it("asks for site data when storage is blocked", async () => {
  const spy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
  mockApi({ mine: {}, summary: summaryOf([], none) });
  open();
  expect(await screen.findByText("Picks need your browser's storage to remember you. Allow site data to play.")).toBeInTheDocument();
  expect(calls).toHaveLength(0);
  expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  spy.mockRestore();
});
