import { render, screen, within } from "@testing-library/react";
import { MyPicks } from "./MyPicks";
import { getMyLeagueTips } from "@/lib/leagueTips";
import { ApiError, getOrCreateDeviceId } from "@/lib/session";
import { resetRevealStore } from "@/lib/useModelReveal";
import type { LeagueTipsMineMatch, LeagueTipsMineResponse } from "@/lib/types";

jest.mock("@/lib/leagueTips");
jest.mock("@/lib/session", () => {
  const actual = jest.requireActual("@/lib/session");
  return { ...actual, getOrCreateDeviceId: jest.fn() };
});
// The rail card fetches on its own and has its own tests.
jest.mock("@/components/rail/YouAndModelCard", () => ({ YouAndModelCard: () => null }));

const mockMine = getMyLeagueTips as jest.MockedFunction<typeof getMyLeagueTips>;
const mockDevice = getOrCreateDeviceId as jest.MockedFunction<typeof getOrCreateDeviceId>;

const FUTURE = "2099-11-21T15:00:00Z";
let nextId = 300;

function match(over: Partial<LeagueTipsMineMatch> = {}): LeagueTipsMineMatch {
  nextId += 1;
  return {
    id: nextId,
    home: `Home ${nextId}`,
    away: `Away ${nextId}`,
    kickoff_utc: FUTURE,
    status: "scheduled",
    score_home: null,
    score_away: null,
    model: null,
    your_prediction: null,
    ...over,
  };
}

const picked = (h: number, a: number, over: Partial<LeagueTipsMineMatch["your_prediction"]> = {}) => ({
  predicted_home: h, predicted_away: a, points: null, exact: null, graded_at: null, updated_at: null, ...over,
});

function week(matchweek: number, matches: LeagueTipsMineMatch[]): LeagueTipsMineResponse {
  return { league: "epl", matchweek, handle: null, matches, disclaimer: "" };
}

/** Serve weeks by number; no explicit week = `current`; unknown → 404. */
function serve(weeks: Record<number, LeagueTipsMineResponse>, current: number) {
  mockMine.mockImplementation(async (_l, _d, mw) => {
    const w = weeks[mw ?? current];
    if (!w) throw new ApiError(404, "matchweek_not_found", "No such matchweek");
    return w;
  });
}

beforeEach(() => {
  mockDevice.mockReturnValue("device-1");
  resetRevealStore();
  window.localStorage.clear();
});
afterEach(() => jest.resetAllMocks());

it("shows a calm empty state, never sample picks, when nothing is picked yet", async () => {
  const first = match();
  serve({ 11: week(11, [first, match()]) }, 11);
  render(<MyPicks competition="epl" />);
  expect(await screen.findByRole("heading", { name: "No picks yet for Matchweek 11" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Start picking" })).toHaveAttribute("href", `/football/epl/match/${first.id}`);
  expect(screen.queryByText(/Sample/)).toBeNull();
  expect(screen.getByText("Premier League · Matchweek 11")).toBeInTheDocument();
});

it("lists locked picks beside the model's, and links every unpicked match to its pick", async () => {
  const a = match({ your_prediction: picked(2, 1), model: { predicted_home: 2, predicted_away: 0, model_version: "v" } });
  const b = match();
  const c = match();
  serve({ 11: week(11, [a, b, c]) }, 11);
  render(<MyPicks competition="epl" venues={{ [a.id]: "St James' Park" }} />);

  const list = await screen.findByRole("region", { name: "My picks, Matchweek 11" });
  expect(within(list).getByText("2–1")).toBeInTheDocument();
  expect(await within(list).findByText("2–0")).toBeInTheDocument();
  expect(within(list).getByText("St James' Park")).toBeInTheDocument();
  expect(within(list).getAllByRole("link", { name: /^Pick the score for/ })).toHaveLength(2);
  expect(within(list).getByText("1 of 3 picked")).toBeInTheDocument();
  expect(within(list).getByText("Points are added after full time.")).toBeInTheDocument();
  expect(within(list).getByRole("link", { name: "Pick the other 2" })).toHaveAttribute(
    "href",
    `/football/epl/match/${b.id}`,
  );
});

it("never shows the model's score on an open match without a locked pick (reveal rule)", async () => {
  const a = match({ your_prediction: picked(1, 1) });
  // An older API leaking the model on an unpicked open fixture.
  const leak = match({ model: { predicted_home: 4, predicted_away: 3, model_version: "v" } });
  serve({ 11: week(11, [a, leak]) }, 11);
  render(<MyPicks competition="epl" />);
  await screen.findByRole("region", { name: "My picks, Matchweek 11" });
  expect(screen.queryByText("4–3")).toBeNull();
});

it("offers the next matchweek once every match is picked", async () => {
  serve({ 11: week(11, [match({ your_prediction: picked(1, 0) }), match({ your_prediction: picked(0, 0) })]) }, 11);
  render(<MyPicks competition="epl" />);
  expect(await screen.findByText("All 2 picked")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to Matchweek 12" })).toHaveAttribute("href", "/football/epl?mw=12");
  expect(screen.getByRole("link", { name: "Last week’s results" })).toHaveAttribute("href", "/football/epl?mw=10");
});

it("grades a finished week: your verdict and points, else the model's verdict", async () => {
  const past = "2020-01-01T15:00:00Z";
  const mine = match({
    status: "finished", kickoff_utc: past, score_home: 2, score_away: 1,
    model: { predicted_home: 1, predicted_away: 0, model_version: "v" },
    your_prediction: picked(2, 1, { points: 5, exact: true, graded_at: past }),
  });
  const theirs = match({
    status: "finished", kickoff_utc: past, score_home: 0, score_away: 0,
    model: { predicted_home: 1, predicted_away: 0, model_version: "v" },
  });
  serve({ 10: { ...week(10, [mine, theirs]), handle: "SwiftStriker42" } }, 10);
  render(<MyPicks competition="epl" matchweek={10} />);
  expect(await screen.findByText("Exact score · 5")).toBeInTheDocument();
  expect(screen.getByText("Missed")).toBeInTheDocument();
  expect(screen.getByText("You scored 5 points this matchweek.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Share/ })).toBeInTheDocument();
});

it("lists picks already made in the following matchweek in their own card", async () => {
  const later = match({ your_prediction: picked(3, 0) });
  serve({ 11: week(11, [match({ your_prediction: picked(1, 0) }), match()]), 12: week(12, [later, match()]) }, 11);
  render(<MyPicks competition="epl" />);
  const card = await screen.findByRole("region", { name: "My picks, Matchweek 12" });
  expect(within(card).getByText("3–0")).toBeInTheDocument();
  expect(within(card).queryAllByRole("link", { name: /^Pick the score/ })).toHaveLength(0);
});

it("walks past a 'current' week with nothing left to pick", async () => {
  const done = match({ status: "finished", kickoff_utc: "2020-01-01T15:00:00Z", score_home: 1, score_away: 0 });
  serve({ 10: week(10, [done]), 11: week(11, [match()]) }, 10);
  render(<MyPicks competition="epl" />);
  expect(await screen.findByRole("heading", { name: "No picks yet for Matchweek 11" })).toBeInTheDocument();
});

it("says picks open with the fixtures when the league has no data yet", async () => {
  mockMine.mockRejectedValue(new ApiError(404, "no_matchweek_data", "No data"));
  render(<MyPicks competition="laliga" />);
  expect(await screen.findByRole("heading", { name: "Picks open with the fixtures" })).toBeInTheDocument();
});

it("still lists next week's picks when this week has none yet", async () => {
  const later = match({ your_prediction: picked(2, 2) });
  serve({ 11: week(11, [match(), match()]), 12: week(12, [later]) }, 11);
  render(<MyPicks competition="epl" />);
  expect(await screen.findByRole("heading", { name: "No picks yet for Matchweek 11" })).toBeInTheDocument();
  const card = await screen.findByRole("region", { name: "My picks, Matchweek 12" });
  expect(within(card).getByText("2–2")).toBeInTheDocument();
});
